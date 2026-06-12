import { Readable } from 'node:stream'
import { finished } from 'node:stream/promises'
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify'
import type { AuthState } from '../auth.js'
import { requireAuth } from '../http.js'
import { filterResponseHeaders, normalizeForwardHeaders } from '../proxy.js'
import { PROXY_STREAM_DEFAULT_TIMEOUT_MS, normalizeStreamTimeoutMs } from '../streamJobs.js'

const HUB_METHODS = ['GET', 'POST', 'PUT', 'DELETE', 'PATCH', 'OPTIONS', 'HEAD'] as const
const PUBLIC_HUB_METHODS = new Set(['GET', 'HEAD', 'OPTIONS'])
const METHODS_WITHOUT_BODY = new Set(['GET', 'HEAD'])

const STRIP_REQUEST_HEADERS = new Set(['x-risu-node-path'])

const HUB_TRANSPORT_RESPONSE_HEADERS = new Set(['content-length', 'transfer-encoding'])

const PREFIX = '/api/v1/hub'

export const HUB_FORWARD_DEFAULT_TIMEOUT_MS = PROXY_STREAM_DEFAULT_TIMEOUT_MS

function headerString(value: string | string[] | undefined): string {
  return Array.isArray(value) ? (value[0] ?? '') : (value ?? '')
}

export function normalizeHubForwardTimeoutMs(raw: unknown): number {
  const value = Array.isArray(raw) ? raw[0] : raw
  return normalizeStreamTimeoutMs(value ?? HUB_FORWARD_DEFAULT_TIMEOUT_MS)
}

function hasUpstreamOverride(req: FastifyRequest): boolean {
  return headerString(req.headers['x-risu-node-path']).length > 0
}

function requiresLocalAuth(req: FastifyRequest): boolean {
  return !PUBLIC_HUB_METHODS.has(req.method) || hasUpstreamOverride(req)
}

function buildForwardHeaders(source: Record<string, unknown>, hubOrigin: string): Record<string, string> {
  const out = normalizeForwardHeaders(source)
  for (const key of Object.keys(out)) {
    if (STRIP_REQUEST_HEADERS.has(key.toLowerCase())) {
      delete out[key]
    }
  }
  out['origin'] = hubOrigin
  return out
}

function resolveUpstreamUrl(req: FastifyRequest, hubUrl: string): string {
  const overrideValue = headerString(req.headers['x-risu-node-path'])
  if (typeof overrideValue === 'string' && overrideValue.length > 0) {
    try {
      return decodeURIComponent(overrideValue)
    } catch {
      return overrideValue
    }
  }
  const suffix = req.url.startsWith(PREFIX) ? req.url.slice(PREFIX.length) : req.url
  return hubUrl + (suffix.length > 0 ? suffix : '/')
}

interface HubAbort {
  signal: AbortSignal
  timedOut(): boolean
  clientClosed(): boolean
  cleanup(): void
}

function createHubAbort(req: FastifyRequest, reply: FastifyReply, timeoutMs: number): HubAbort {
  const controller = new AbortController()
  let timeoutFired = false
  let closeFired = false

  const abortForTimeout = (): void => {
    timeoutFired = true
    controller.abort()
  }
  const abortForClose = (): void => {
    closeFired = true
    controller.abort()
  }

  const timer = setTimeout(abortForTimeout, timeoutMs)
  timer.unref?.()

  const onRequestClose = (): void => {
    if (!req.raw.complete) abortForClose()
  }
  const onResponseClose = (): void => {
    if (!reply.raw.writableEnded) abortForClose()
  }

  req.raw.once('close', onRequestClose)
  reply.raw.once('close', onResponseClose)

  return {
    signal: controller.signal,
    timedOut: () => timeoutFired,
    clientClosed: () => closeFired,
    cleanup: () => {
      clearTimeout(timer)
      req.raw.off('close', onRequestClose)
      reply.raw.off('close', onResponseClose)
    },
  }
}

function bufferToForwardBody(buffer: Buffer): BodyInit {
  return new Uint8Array(buffer.buffer as ArrayBuffer, buffer.byteOffset, buffer.byteLength)
}

async function cancelUpstreamBody(upstream: Response): Promise<void> {
  if (!upstream.body) return
  try {
    await upstream.body.cancel()
  } catch {
    // The redirect response is being discarded; cancellation failure should not
    // hide the actual redirect decision.
  }
}

async function forwardOnce(
  reply: FastifyReply,
  upstreamUrl: string,
  method: string,
  headers: Record<string, string>,
  body: Buffer | undefined,
  signal: AbortSignal,
  captureRedirect: boolean,
): Promise<{ status: number; location: string | null }> {
  const fetchInit: RequestInit & { duplex?: 'half' } = {
    method,
    headers,
    redirect: 'manual',
    signal,
  }
  if (body !== undefined) {
    fetchInit.body = bufferToForwardBody(body)
    fetchInit.duplex = 'half'
  }
  const upstream = await fetch(upstreamUrl, fetchInit)

  const location = upstream.headers.get('location')
  if (
    captureRedirect &&
    upstream.status >= 300 &&
    upstream.status < 400 &&
    typeof location === 'string' &&
    location.length > 0
  ) {
    await cancelUpstreamBody(upstream)
    return { status: upstream.status, location }
  }

  for (const [k, v] of Object.entries(filterResponseHeaders(upstream.headers))) {
    if (HUB_TRANSPORT_RESPONSE_HEADERS.has(k.toLowerCase())) continue
    reply.header(k, v)
  }
  reply.code(upstream.status)

  if (upstream.body) {
    const stream = Readable.fromWeb(upstream.body as Parameters<typeof Readable.fromWeb>[0])
    reply.send(stream)
    await finished(stream, { cleanup: true })
  } else {
    await reply.send()
  }
  return { status: upstream.status, location: null }
}

function isAbortError(err: unknown, signal: AbortSignal): boolean {
  return signal.aborted || (err as { name?: string } | null)?.name === 'AbortError'
}

export function registerHubRoutes(app: FastifyInstance, authState: AuthState, hubUrl: string): void {
  const hubOrigin = new URL(hubUrl).origin

  app.register(async (instance) => {
    instance.removeAllContentTypeParsers()
    instance.addContentTypeParser('*', { parseAs: 'buffer' }, (_req, body, done) => {
      done(null, body)
    })

    instance.route({
      method: [...HUB_METHODS],
      url: '/api/v1/hub/*',
      onRequest: async (req, reply) => {
        if (requiresLocalAuth(req)) {
          await requireAuth(authState, req, reply)
        }
      },
      handler: async (req, reply) => {
        const upstreamUrl = resolveUpstreamUrl(req, hubUrl)
        const headers = buildForwardHeaders(req.headers as Record<string, unknown>, hubOrigin)

        const body =
          Buffer.isBuffer(req.body) && !METHODS_WITHOUT_BODY.has(req.method) && req.body.length > 0
            ? req.body
            : undefined

        const timeoutMs = normalizeHubForwardTimeoutMs(req.headers['risu-timeout-ms'])
        const abort = createHubAbort(req, reply, timeoutMs)

        try {
          const first = await forwardOnce(reply, upstreamUrl, req.method, headers, body, abort.signal, true)
          if (first.location) {
            if (body !== undefined) {
              reply.code(502)
              return {
                error: 'Hub request redirects with bodies are not replayed',
              }
            }
            await forwardOnce(reply, first.location, req.method, headers, undefined, abort.signal, false)
          }
        } catch (err) {
          if (isAbortError(err, abort.signal)) {
            if (!reply.raw.headersSent) {
              reply.code(504)
              return {
                error:
                  abort.timedOut() && !abort.clientClosed()
                    ? `Hub request timed out after ${timeoutMs}ms`
                    : 'Hub request aborted',
              }
            }
            reply.raw.end()
            return
          }
          req.log.warn({ err }, 'hub proxy upstream failed')
          if (!reply.raw.headersSent) {
            reply.code(502)
            return {
              error: `Proxy request failed: ${(err as Error)?.message ?? err}`,
            }
          }
          reply.raw.end()
        } finally {
          abort.cleanup()
        }
      },
    })
  })
}
