// Invariant: the client parser defines the legacy `assets/<sha256>.<ext>` shape.
const LOCAL_ASSET_PATH_RE = /^assets\/([a-f0-9]{64})\.[a-z0-9]+$/i

export function parseLocalAssetPath(loc: string): string | null {
  const match = LOCAL_ASSET_PATH_RE.exec(loc)
  return match ? match[1] : null
}
