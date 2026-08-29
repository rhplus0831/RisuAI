export type ProxyJobWsEvent =
  | { type: 'job_accepted'; jobId: string }
  | { type: 'upstream_headers'; status: number; headers: Record<string, string> }
  | { type: 'chunk'; dataBase64: string }
  | { type: 'error'; status?: number; message: string }
  | { type: 'done' }
  | { type: 'ping'; ts: number }

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value)
}

function isHttpStatus(value: unknown): value is number {
  return Number.isInteger(value) && (value as number) >= 100 && (value as number) <= 599
}

function isStringRecord(value: unknown): value is Record<string, string> {
  return isRecord(value) && Object.values(value).every((entry) => typeof entry === 'string')
}

function isBase64(value: unknown): value is string {
  return (
    typeof value === 'string' &&
    value.length > 0 &&
    value.length % 4 === 0 &&
    /^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(value)
  )
}

export function parseProxyJobWsEvent(raw: string): ProxyJobWsEvent | null {
  try {
    const parsed = JSON.parse(raw) as unknown
    if (!isRecord(parsed) || typeof parsed.type !== 'string') return null
    switch (parsed.type) {
      case 'job_accepted':
        return typeof parsed.jobId === 'string' && parsed.jobId.length > 0
          ? { type: parsed.type, jobId: parsed.jobId }
          : null
      case 'upstream_headers':
        return isHttpStatus(parsed.status) && isStringRecord(parsed.headers)
          ? { type: parsed.type, status: parsed.status, headers: parsed.headers }
          : null
      case 'chunk':
        return isBase64(parsed.dataBase64) ? { type: parsed.type, dataBase64: parsed.dataBase64 } : null
      case 'error': {
        if (typeof parsed.message !== 'string') return null
        if (parsed.status === undefined) return { type: parsed.type, message: parsed.message }
        if (!isHttpStatus(parsed.status)) return null
        return { type: parsed.type, status: parsed.status, message: parsed.message }
      }
      case 'done':
        return { type: parsed.type }
      case 'ping':
        return typeof parsed.ts === 'number' && Number.isFinite(parsed.ts) ? { type: parsed.type, ts: parsed.ts } : null
      default:
        return null
    }
  } catch {
    return null
  }
}

export function decodeProxyJobWsChunk(dataBase64: string): Uint8Array {
  return Buffer.from(dataBase64, 'base64')
}

export function readProxyJobWsBinaryChunk(data: unknown): Uint8Array | null {
  if (data instanceof ArrayBuffer) {
    return new Uint8Array(data)
  }
  if (ArrayBuffer.isView(data)) {
    return new Uint8Array(data.buffer, data.byteOffset, data.byteLength)
  }
  return null
}

export function formatProxyStreamErrorMessage(status: number | undefined, message: string): string {
  const text = message ?? ''
  if (
    status === 504 ||
    status === 524 ||
    text.includes('Cloudflare') ||
    text.includes('Gateway time-out') ||
    text.includes('A timeout occurred')
  ) {
    return `Cloudflare/origin timeout (${status ?? 'unknown'}). The origin server did not start sending response in time.`
  }
  return text || `Proxy stream failed (${status ?? 'unknown'})`
}
