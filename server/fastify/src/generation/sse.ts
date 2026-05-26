export function hasNonIgnorableSseTail(tail: string): boolean {
  for (const line of tail.replace(/\r\n/g, '\n').split('\n')) {
    const trimmed = line.trim()
    if (trimmed.length === 0) continue
    if (trimmed.startsWith(':')) continue
    return true
  }
  return false
}
