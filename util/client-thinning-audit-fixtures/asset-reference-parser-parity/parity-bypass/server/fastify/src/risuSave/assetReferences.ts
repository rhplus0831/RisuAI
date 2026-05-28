// Server walker side of the asset-reference parity contract. The real walker
// lives in server/fastify/src/risuSave/assetReferences.ts and accepts the same
// legacy shape as the client `LOCAL_ASSET_PATH_RE`.

// Accepted: the walker carries a regex literal whose text is identical to the
// client `LOCAL_ASSET_PATH_RE`, so both sides accept the same asset references.
export function addReference(found: Map<string, Set<string>>, value: unknown, path: string): void {
  const match = typeof value === 'string' ? /^assets\/([a-f0-9]{64})\.[a-z0-9]+$/i.exec(value) : null
  if (!match) return
  const set = found.get(match[1]) ?? new Set<string>()
  set.add(path)
  found.set(match[1], set)
}
