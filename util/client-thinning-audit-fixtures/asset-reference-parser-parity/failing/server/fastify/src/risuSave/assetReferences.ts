// Invariant: the server walker accepts the same legacy asset path shape as the
// client parser.

// Violation: the walker regex accepts 32 hex chars while the client parser
// requires 64.
export function addReference(found: Map<string, Set<string>>, value: unknown, path: string): void {
  const match = typeof value === 'string' ? /^assets\/([a-f0-9]{32})\.[a-z0-9]+$/i.exec(value) : null
  if (!match) return
  const set = found.get(match[1]) ?? new Set<string>()
  set.add(path)
  found.set(match[1], set)
}
