// Server walker side of the asset-reference parity contract. The real walker
// lives in server/fastify/src/risuSave/assetReferences.ts and accepts the same
// legacy shape as the client `LOCAL_ASSET_PATH_RE`.

// Anti-pattern: the walker regex has drifted from the client one (32 hex chars
// here vs the client's 64), so the two sides no longer accept the same set of
// asset references. The audit compares the literal text on each side.
export function addReference(found: Map<string, Set<string>>, value: unknown, path: string): void {
  const match = typeof value === 'string' ? /^assets\/([a-f0-9]{32})\.[a-z0-9]+$/i.exec(value) : null
  if (!match) return
  const set = found.get(match[1]) ?? new Set<string>()
  set.add(path)
  found.set(match[1], set)
}
