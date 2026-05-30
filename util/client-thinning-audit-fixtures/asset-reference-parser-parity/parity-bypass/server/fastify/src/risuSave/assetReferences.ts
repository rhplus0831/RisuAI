// Invariant: the server walker accepts the same legacy asset path shape as the
// client parser.

// Accepted: the walker regex text matches the client parser regex.
export function addReference(found: Map<string, Set<string>>, value: unknown, path: string): void {
  const match = typeof value === 'string' ? /^assets\/([a-f0-9]{64})\.[a-z0-9]+$/i.exec(value) : null
  if (!match) return
  const set = found.get(match[1]) ?? new Set<string>()
  set.add(path)
  found.set(match[1], set)
}
