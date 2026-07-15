import { SHARED_DEFAULT_REQUEST_TIMEOUT_MS, SHARED_MAX_REQUEST_TIMEOUT_MS } from './requestTimeouts.js'

const STRIP_REQUEST_HEADERS = new Set([
  'host',
  'connection',
  'content-length',
  'keep-alive',
  'proxy-authenticate',
  'proxy-authorization',
  'proxy-connection',
  'risu-auth',
  'risu-timeout-ms',
  'risu-url',
  'risu-header',
  'te',
  'trailer',
  'transfer-encoding',
  'upgrade',
])

const STRIP_RESPONSE_HEADERS = new Set([
  'content-security-policy',
  'content-security-policy-report-only',
  'clear-site-data',
  'cache-control',
  'content-encoding',
  'content-length',
  'connection',
  'keep-alive',
  'proxy-authenticate',
  'proxy-authorization',
  'proxy-connection',
  'te',
  'trailer',
  'transfer-encoding',
  'upgrade',
])

function connectionHeaderTokens(value: string | null | undefined): Set<string> {
  return new Set(
    (value ?? '')
      .split(',')
      .map((token) => token.trim().toLowerCase())
      .filter(Boolean),
  )
}

export const PROXY_FETCH_DEFAULT_TIMEOUT_MS = SHARED_DEFAULT_REQUEST_TIMEOUT_MS
export const PROXY_FETCH_MAX_TIMEOUT_MS = SHARED_MAX_REQUEST_TIMEOUT_MS

export function getRequestTimeoutMs(raw: unknown): number {
  const value = Array.isArray(raw) ? raw[0] : raw
  if (typeof value !== 'string' || value.trim().length === 0) {
    return PROXY_FETCH_DEFAULT_TIMEOUT_MS
  }
  const ms = Number.parseInt(value, 10)
  if (!Number.isFinite(ms) || ms <= 0) return PROXY_FETCH_DEFAULT_TIMEOUT_MS
  return Math.min(PROXY_FETCH_MAX_TIMEOUT_MS, Math.max(1, Math.floor(ms)))
}

export interface TimeoutController {
  signal: AbortSignal
  timedOut(): boolean
  cleanup(): void
}

export function createTimeoutController(timeoutMs: number): TimeoutController {
  const controller = new AbortController()
  let timeoutFired = false
  const timer = setTimeout(() => {
    timeoutFired = true
    controller.abort()
  }, timeoutMs)
  timer.unref?.()
  return {
    signal: controller.signal,
    timedOut: () => timeoutFired,
    cleanup: () => clearTimeout(timer),
  }
}

export function decodeRisuUrl(raw: unknown): string | null {
  const value = Array.isArray(raw) ? raw[0] : raw
  if (typeof value !== 'string' || value.length === 0) return null
  try {
    return decodeURIComponent(value)
  } catch {
    return null
  }
}

export function parseRisuHeader(raw: unknown): Record<string, string> | null {
  const value = Array.isArray(raw) ? raw[0] : raw
  if (typeof value !== 'string' || value.length === 0) return null
  try {
    const parsed = JSON.parse(decodeURIComponent(value))
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return null
    const out: Record<string, string> = {}
    for (const [k, v] of Object.entries(parsed as Record<string, unknown>)) {
      if (typeof k !== 'string') continue
      if (typeof v === 'string') out[k] = v
    }
    return out
  } catch {
    return null
  }
}

export function normalizeForwardHeaders(input: Record<string, unknown> | undefined | null): Record<string, string> {
  const out: Record<string, string> = {}
  if (!input || typeof input !== 'object') return out
  let connection = ''
  for (const [name, value] of Object.entries(input)) {
    if (name.toLowerCase() !== 'connection') continue
    connection = Array.isArray(value)
      ? value.filter((entry) => typeof entry === 'string').join(',')
      : String(value ?? '')
  }
  const dynamicHopHeaders = connectionHeaderTokens(connection)
  for (const [k, v] of Object.entries(input)) {
    if (typeof k !== 'string') continue
    if (STRIP_REQUEST_HEADERS.has(k.toLowerCase()) || dynamicHopHeaders.has(k.toLowerCase())) continue
    if (typeof v === 'string') {
      out[k] = v
    } else if (Array.isArray(v)) {
      const joined = v.filter((entry): entry is string => typeof entry === 'string').join(', ')
      if (joined.length > 0) out[k] = joined
    }
  }
  return out
}

export function filterResponseHeaders(source: Headers): Record<string, string> {
  const out: Record<string, string> = {}
  const dynamicHopHeaders = connectionHeaderTokens(source.get('connection'))
  for (const [k, v] of source.entries()) {
    if (STRIP_RESPONSE_HEADERS.has(k.toLowerCase()) || dynamicHopHeaders.has(k.toLowerCase())) continue
    out[k] = v
  }
  return out
}

const STRIP_PLUGIN_RESPONSE_HEADERS = new Set(['proxy-authenticate', 'set-cookie', 'set-cookie2', 'www-authenticate'])

export function filterPluginResponseHeaders(source: Headers): Record<string, string> {
  const out = filterResponseHeaders(source)
  // Plugin transport uses node:http(s) and therefore returns the upstream's
  // encoded bytes verbatim (unlike fetch, which transparently decompresses).
  // Preserve the encoding label while continuing to strip stale framing.
  const contentEncoding = source.get('content-encoding')
  if (contentEncoding && !connectionHeaderTokens(source.get('connection')).has('content-encoding')) {
    out['content-encoding'] = contentEncoding
  }
  for (const name of Object.keys(out)) {
    if (STRIP_PLUGIN_RESPONSE_HEADERS.has(name.toLowerCase())) delete out[name]
  }
  return out
}

export function bufferToBodyInit(buffer: Buffer): BodyInit {
  const body = new Uint8Array(buffer.length)
  body.set(buffer)
  return body
}
