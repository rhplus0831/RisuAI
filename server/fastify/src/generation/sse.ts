export interface SseEventBlock {
  block: string
  rest: string
}

/**
 * Cap for the per-stream accumulation buffer (audit L22). The buffer should
 * only ever hold one partial event block / NDJSON line between reads; an
 * upstream that never sends a delimiter would otherwise grow it without
 * bound. 8 MB is far above any legitimate single event (a whole long
 * completion fits in well under 1 MB) while still bounding a broken upstream.
 */
export const MAX_STREAM_BUFFER_CHARS = 8 * 1024 * 1024

/** Stream-adapter error message emitted when the cap above trips. */
export const STREAM_BUFFER_OVERFLOW_ERROR =
  'upstream stream exceeded the event buffer cap without a delimiter'

export function streamBufferExceedsCap(buffer: string): boolean {
  return buffer.length > MAX_STREAM_BUFFER_CHARS
}

export function popSseEventBlock(buffer: string): SseEventBlock | null {
  const lfIdx = buffer.indexOf('\n\n')
  const crlfIdx = buffer.indexOf('\r\n\r\n')
  if (lfIdx === -1 && crlfIdx === -1) return null

  const useCrlf = crlfIdx !== -1 && (lfIdx === -1 || crlfIdx < lfIdx)
  const sepIdx = useCrlf ? crlfIdx : lfIdx
  const sepLength = useCrlf ? 4 : 2
  return {
    block: buffer.slice(0, sepIdx).replace(/\r\n/g, '\n'),
    rest: buffer.slice(sepIdx + sepLength),
  }
}

export function hasNonIgnorableSseTail(tail: string): boolean {
  for (const line of tail.replace(/\r\n/g, '\n').split('\n')) {
    const trimmed = line.trim()
    if (trimmed.length === 0) continue
    if (trimmed.startsWith(':')) continue
    return true
  }
  return false
}
