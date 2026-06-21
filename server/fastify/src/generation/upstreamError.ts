const MAX_ERROR_DETAIL_CHARS = 2000

function compactDetail(value: string): string {
  const compacted = value.replace(/\s+/g, ' ').trim()
  if (compacted.length <= MAX_ERROR_DETAIL_CHARS) return compacted
  return `${compacted.slice(0, MAX_ERROR_DETAIL_CHARS - 1)}...`
}

export function safeUpstreamUrl(rawUrl: string | undefined): string | undefined {
  if (!rawUrl) return undefined
  try {
    const url = new URL(rawUrl)
    const pathname = url.pathname.length > 0 ? url.pathname : '/'
    return `${url.origin}${pathname}`
  } catch {
    return undefined
  }
}

export interface UpstreamHttpErrorDetails {
  message?: string
  code?: string
}

export function upstreamStatusText(response: Response): string | undefined {
  const text = response.statusText.trim()
  return text.length > 0 ? text : undefined
}

export function formatUpstreamHttpError(
  response: Response,
  url: string | undefined,
  details: UpstreamHttpErrorDetails = {},
): string {
  const statusText = upstreamStatusText(response)
  const status = `HTTP ${response.status}${statusText ? ` ${statusText}` : ''}`
  const safeUrl = safeUpstreamUrl(url)
  const code = details.code ? compactDetail(details.code) : undefined
  const message = details.message ? compactDetail(details.message) : undefined
  const from = safeUrl ? ` from ${safeUrl}` : ''
  const codeText = code ? ` (${code})` : ''
  const bodyText = message ?? 'upstream returned an empty error body'
  return `Provider request failed: ${status}${from}${codeText}: ${bodyText}`
}

export function formatUpstreamFetchError(url: string | undefined, message: string): string {
  const safeUrl = safeUpstreamUrl(url)
  return `upstream fetch failed${safeUrl ? ` for ${safeUrl}` : ''}: ${compactDetail(message)}`
}
