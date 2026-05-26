import { Readable } from 'node:stream'
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify'
import type { AuthState } from '../auth.js'
import { requireAuth } from '../http.js'
import { bufferToBodyInit, filterResponseHeaders } from '../proxy.js'

const HUB_METHODS = ['GET', 'POST', 'PUT', 'DELETE', 'PATCH', 'OPTIONS', 'HEAD'] as const

const STRIP_REQUEST_HEADERS = new Set([
  'host',
  'connection',
  'content-length',
  'risu-auth',
  'x-risu-node-path',
])

const HUB_TRANSPORT_RESPONSE_HEADERS = new Set([
  'content-length',
  'transfer-encoding',
])

const PREFIX = '/api/v1/hub'

function buildForwardHeaders(
  source: Record<string, unknown>,
  hubOrigin: string,
): Record<string, string> {
  const out: Record<string, string> = {}
  for (const [k, v] of Object.entries(source)) {
    if (typeof k !== 'string') continue
    if (STRIP_REQUEST_HEADERS.has(k.toLowerCase())) continue
    if (typeof v === 'string') {
      out[k] = v
    } else if (Array.isArray(v)) {
      const joined = v.filter((entry): entry is string => typeof entry === 'string').join(', ')
      if (joined.length > 0) out[k] = joined
    }
  }
  out['origin'] = hubOrigin
  return out
}

function resolveUpstreamUrl(req: FastifyRequest, hubUrl: string): string {
  const override = req.headers['x-risu-node-path']
  const overrideValue = Array.isArray(override) ? override[0] : override
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

async function forwardOnce(
  reply: FastifyReply,
  upstreamUrl: string,
  method: string,
  headers: Record<string, string>,
  body: Buffer | undefined,
): Promise<{ status: number; location: string | null }> {
  const fetchInit: RequestInit & { duplex?: 'half' } = {
    method,
    headers,
    redirect: 'manual',
  }
  if (body !== undefined) {
    fetchInit.body = bufferToBodyInit(body)
    fetchInit.duplex = 'half'
  }
  const upstream = await fetch(upstreamUrl, fetchInit)

  for (const [k, v] of Object.entries(filterResponseHeaders(upstream.headers))) {
    if (HUB_TRANSPORT_RESPONSE_HEADERS.has(k.toLowerCase())) continue
    reply.header(k, v)
  }
  reply.code(upstream.status)

  const location = upstream.headers.get('location')
  if (
    upstream.status >= 300 &&
    upstream.status < 400 &&
    typeof location === 'string' &&
    location.length > 0
  ) {
    return { status: upstream.status, location }
  }

  if (upstream.body) {
    const stream = Readable.fromWeb(
      upstream.body as Parameters<typeof Readable.fromWeb>[0],
    )
    await reply.send(stream)
  } else {
    await reply.send()
  }
  return { status: upstream.status, location: null }
}

export function registerHubRoutes(
  app: FastifyInstance,
  authState: AuthState,
  hubUrl: string,
): void {
  const hubOrigin = new URL(hubUrl).origin

  app.register(async (instance) => {
    instance.removeAllContentTypeParsers()
    instance.addContentTypeParser('*', { parseAs: 'buffer' }, (_req, body, done) => {
      done(null, body)
    })

    instance.route({
      method: [...HUB_METHODS],
      url: '/api/v1/hub/*',
      handler: async (req, reply) => {
        if (!(await requireAuth(authState, req, reply))) return

        const upstreamUrl = resolveUpstreamUrl(req, hubUrl)
        const headers = buildForwardHeaders(
          req.headers as Record<string, unknown>,
          hubOrigin,
        )

        const body =
          Buffer.isBuffer(req.body) && req.method !== 'GET' && req.method !== 'HEAD' && req.body.length > 0
            ? req.body
            : undefined

        try {
          const first = await forwardOnce(reply, upstreamUrl, req.method, headers, body)
          if (first.location) {
            // Express resends the body on the redirect. Reset the reply headers
            // already set by forwardOnce by sending again on a new fetch.
            // Fastify lets reply.send be called only once, so we already pipe
            // through here in the redirect case.
            await forwardOnce(reply, first.location, req.method, headers, body)
          }
        } catch (err) {
          req.log.warn({ err }, 'hub proxy upstream failed')
          if (!reply.raw.headersSent) {
            reply.code(502)
            return {
              error: `Proxy request failed: ${(err as Error)?.message ?? err}`,
            }
          }
          reply.raw.end()
        }
      },
    })
  })
}
