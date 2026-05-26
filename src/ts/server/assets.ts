const SERVER_ASSET_ID_RE = /^[a-f0-9]{64}$/
const LOCAL_ASSET_PATH_RE = /^assets\/([a-f0-9]{64})\.[a-z0-9]+$/i

export function serverAssetIdFromReference(loc: string): string | null {
  if (SERVER_ASSET_ID_RE.test(loc)) return loc
  const localPathMatch = LOCAL_ASSET_PATH_RE.exec(loc)
  return localPathMatch?.[1] ?? null
}

export function serverAssetUrl(loc: string): string | null {
  const assetId = serverAssetIdFromReference(loc)
  return assetId ? `/api/v1/assets/${encodeURIComponent(assetId)}` : null
}

interface ReadServerAssetOptions {
  auth?: string
  fetchImpl?: typeof fetch
}

export async function readServerAssetBytes(
  loc: string,
  options: ReadServerAssetOptions = {},
): Promise<Uint8Array> {
  const assetUrl = serverAssetUrl(loc) ?? loc
  const auth =
    options.auth ?? (await (await import('../storage/nodeStorage')).getNodeServerProxyAuth())
  const fetchImpl = options.fetchImpl ?? fetch
  const response = await fetchImpl(assetUrl, {
    headers: {
      'risu-auth': auth,
    },
  })
  if (!response.ok) {
    throw new Error(`Failed to read server asset: ${response.status}`)
  }
  return new Uint8Array(await response.arrayBuffer())
}
