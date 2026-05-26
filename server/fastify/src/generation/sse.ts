export interface SseEventBlock {
  block: string
  rest: string
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
