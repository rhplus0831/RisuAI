const STRIP_REQUEST_HEADERS = new Set([
  'host',
  'connection',
  'content-length',
  'risu-auth',
  'risu-timeout-ms',
  'risu-url',
  'risu-header',
])

const STRIP_RESPONSE_HEADERS = new Set([
  'content-security-policy',
  'content-security-policy-report-only',
  'clear-site-data',
  'cache-control',
  'content-encoding',
])

export function getRequestTimeoutMs(raw: unknown): number | null {
  const value = Array.isArray(raw) ? raw[0] : raw
  if (typeof value !== 'string') return null
  const ms = Number.parseInt(value, 10)
  if (!Number.isFinite(ms) || ms <= 0) return null
  return ms
}

export interface TimeoutController {
  signal: AbortSignal | undefined
  cleanup(): void
}

export function createTimeoutController(timeoutMs: number | null): TimeoutController {
  if (!timeoutMs) {
    return { signal: undefined, cleanup: () => {} }
  }
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), timeoutMs)
  return {
    signal: controller.signal,
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

export function normalizeForwardHeaders(
  input: Record<string, unknown> | undefined | null,
): Record<string, string> {
  const out: Record<string, string> = {}
  if (!input || typeof input !== 'object') return out
  for (const [k, v] of Object.entries(input)) {
    if (typeof k !== 'string') continue
    if (STRIP_REQUEST_HEADERS.has(k.toLowerCase())) continue
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
  for (const [k, v] of source.entries()) {
    if (STRIP_RESPONSE_HEADERS.has(k.toLowerCase())) continue
    out[k] = v
  }
  return out
}

export function bufferToBodyInit(buffer: Buffer): BodyInit {
  const body = new Uint8Array(buffer.length)
  body.set(buffer)
  return body
}
