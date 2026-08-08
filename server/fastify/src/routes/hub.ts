import { Readable } from 'node:stream'
import { finished } from 'node:stream/promises'
import type { DatabaseSync } from 'node:sqlite'
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify'
import type { AuthState } from '../auth.js'
import { requireAuth } from '../http.js'
import { MASKED_PROVIDER_SECRET } from '../providerSecrets.js'
import { filterResponseHeaders, normalizeForwardHeaders } from '../proxy.js'
import { loadSettingsFromSqlite } from '../repository.js'
import { PROXY_STREAM_DEFAULT_TIMEOUT_MS, normalizeStreamTimeoutMs } from '../streamJobs.js'

const HUB_METHODS = ['GET', 'POST', 'PUT', 'DELETE', 'PATCH', 'OPTIONS', 'HEAD'] as const
const PUBLIC_HUB_METHODS = new Set(['GET', 'HEAD', 'OPTIONS'])
const METHODS_WITHOUT_BODY = new Set(['GET', 'HEAD'])

const STRIP_REQUEST_HEADERS = new Set(['x-risu-node-path'])

const HUB_TRANSPORT_RESPONSE_HEADERS = new Set(['content-length', 'transfer-encoding'])

const PREFIX = '/api/v1/hub'
const REALM_REMOVE_PATH = `${PREFIX}/hub/remove`
export const REALM_REMOVE_BODY_MAX_BYTES = 1_024
const REALM_REMOVE_ID_MAX_BYTES = 256
const REALM_ACCOUNT_TOKEN_MAX_BYTES = 8_192
const REALM_QUERY_PATHS = new Set([`${PREFIX}/realm`, `${PREFIX}/realm/`])
const REALM_QUERY_KEYS = ['search', 'page', 'nsfw', 'sort', 'web'] as const
const REALM_QUERY_DEFAULTS = {
  search: '',
  page: '0',
  nsfw: 'false',
  sort: '',
  web: 'other',
} satisfies Record<(typeof REALM_QUERY_KEYS)[number], string>

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

function setForwardHeader(headers: Record<string, string>, name: string, value: string): void {
  for (const key of Object.keys(headers)) {
    if (key.toLowerCase() === name.toLowerCase()) delete headers[key]
  }
  headers[name] = value
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

type RealmRemoveBodyResult = { ok: true; body: Buffer } | { ok: false; statusCode: 400 | 409 | 413; error: string }

function realmRemoveForwardBody(db: DatabaseSync, body: Buffer | undefined): RealmRemoveBodyResult {
  if (!body || body.length === 0) {
    return { ok: false, statusCode: 400, error: 'Invalid Realm removal request' }
  }
  if (body.length > REALM_REMOVE_BODY_MAX_BYTES) {
    return { ok: false, statusCode: 413, error: 'Realm removal request is too large' }
  }

  let parsed: unknown
  try {
    parsed = JSON.parse(body.toString('utf8'))
  } catch {
    return { ok: false, statusCode: 400, error: 'Invalid Realm removal request' }
  }

  if (!isRecord(parsed) || Object.keys(parsed).length !== 1 || !Object.hasOwn(parsed, 'id')) {
    return { ok: false, statusCode: 400, error: 'Invalid Realm removal request' }
  }
  const id = parsed.id
  if (
    typeof id !== 'string' ||
    id.length === 0 ||
    id !== id.trim() ||
    Buffer.byteLength(id, 'utf8') > REALM_REMOVE_ID_MAX_BYTES ||
    /[\s/?#\u0000-\u001f\u007f]/u.test(id)
  ) {
    return { ok: false, statusCode: 400, error: 'Invalid Realm removal request' }
  }

  const settings = loadSettingsFromSqlite(db)
  const account = settings?.account
  const token = isRecord(account) ? account.token : undefined
  if (
    typeof token !== 'string' ||
    token.length === 0 ||
    token === MASKED_PROVIDER_SECRET ||
    Buffer.byteLength(token, 'utf8') > REALM_ACCOUNT_TOKEN_MAX_BYTES
  ) {
    return { ok: false, statusCode: 409, error: 'Realm account credentials are unavailable' }
  }

  return {
    ok: true,
    body: Buffer.from(JSON.stringify({ id, token })),
  }
}

function resolveRealmQuerySuffix(url: string): string | null {
  const parsed = new URL(url, 'http://risu.local')
  if (!REALM_QUERY_PATHS.has(parsed.pathname) || parsed.search.length === 0) {
    return null
  }

  const legacyArg = REALM_QUERY_KEYS.map((key) => {
    return `${key}==${parsed.searchParams.get(key) ?? REALM_QUERY_DEFAULTS[key]}`
  }).join('&&')

  return `/realm/${encodeURIComponent(legacyArg)}`
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
  const realmQuerySuffix = resolveRealmQuerySuffix(req.url)
  if (realmQuerySuffix) {
    return hubUrl + realmQuerySuffix + '?cache=30'
  }
  const suffix = req.url.startsWith(PREFIX) ? req.url.slice(PREFIX.length) : req.url
  return hubUrl + (suffix.length > 0 ? suffix : '/')
}

export function resolveHubRedirectUrl(location: string, upstreamUrl: string, hubOrigin: string): string | null {
  try {
    const redirectUrl = new URL(location, upstreamUrl)
    if ((redirectUrl.protocol !== 'http:' && redirectUrl.protocol !== 'https:') || redirectUrl.origin !== hubOrigin) {
      return null
    }
    return redirectUrl.href
  } catch {
    return null
  }
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

async function forwardHubRequest(
  req: FastifyRequest,
  reply: FastifyReply,
  upstreamUrl: string,
  headers: Record<string, string>,
  body: Buffer | undefined,
) {
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
      // The initial target is either the configured Hub or an explicitly
      // authenticated complete-URL override. Pin the one allowed redirect to
      // that already-authorized target's origin.
      const redirectUrl = resolveHubRedirectUrl(first.location, upstreamUrl, new URL(upstreamUrl).origin)
      if (!redirectUrl) {
        reply.code(502)
        return {
          error: 'Hub redirect target is not allowed',
        }
      }
      await forwardOnce(reply, redirectUrl, req.method, headers, undefined, abort.signal, false)
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
}

export function registerHubRoutes(app: FastifyInstance, db: DatabaseSync, authState: AuthState, hubUrl: string): void {
  const hubOrigin = new URL(hubUrl).origin

  app.register(async (instance) => {
    instance.removeAllContentTypeParsers()
    instance.addContentTypeParser('*', { parseAs: 'buffer' }, (_req, body, done) => {
      done(null, body)
    })

    instance.post(
      REALM_REMOVE_PATH,
      {
        bodyLimit: REALM_REMOVE_BODY_MAX_BYTES,
        compress: false,
        onRequest: async (req, reply) => {
          await requireAuth(authState, req, reply)
        },
      },
      async (req, reply) => {
        // This is the only Hub operation that receives a server-owned secret.
        // Keep its route and target exact so proxy overrides and query variants
        // cannot turn it into a credential-forwarding primitive.
        if (req.url !== REALM_REMOVE_PATH || hasUpstreamOverride(req)) {
          reply.code(400)
          return { error: 'Invalid Realm removal route' }
        }

        const removal = realmRemoveForwardBody(db, Buffer.isBuffer(req.body) ? req.body : undefined)
        if (removal.ok === false) {
          reply.code(removal.statusCode)
          return { error: removal.error }
        }

        const headers = buildForwardHeaders(req.headers as Record<string, unknown>, hubOrigin)
        setForwardHeader(headers, 'content-type', 'application/json')
        return await forwardHubRequest(req, reply, `${hubUrl}/hub/remove`, headers, removal.body)
      },
    )

    instance.route({
      method: [...HUB_METHODS],
      url: '/api/v1/hub/*',
      compress: false,
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
        return await forwardHubRequest(req, reply, upstreamUrl, headers, body)
      },
    })
  })
}
