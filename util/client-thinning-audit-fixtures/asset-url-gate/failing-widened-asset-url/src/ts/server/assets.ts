// Adversarial variant of the A4R7 gate-helper defeat: `serverAssetUrl` keeps
// the anchored asset-id regex AND a null reject path (so the old surface-level
// checks are satisfied), but a "sincere refactor" widened it to pass any
// http(s):// URL straight through. The accepted shapes are no longer the
// documented set; the hardened rule flags the raw `loc` passthrough.
export function serverAssetUrl(loc: string): string | null {
  if (loc.startsWith('http://') || loc.startsWith('https://')) {
    return loc
  }
  return /^[a-f0-9]{64}$/.test(loc) ? `/api/v1/assets/${loc}` : null
}

interface ReadServerAssetOptions {
  auth?: string
  fetchImpl?: typeof fetch
}

export async function readServerAssetBytes(
  loc: string,
  options: ReadServerAssetOptions = {},
): Promise<Uint8Array> {
  const assetUrl = serverAssetUrl(loc)
  if (!assetUrl) {
    throw new Error(`Unsupported server asset reference: ${loc}`)
  }
  const auth = options.auth ?? 'fixture-auth'
  const fetchImpl = options.fetchImpl ?? fetch
  const response = await fetchImpl(assetUrl, {
    headers: {
      'risu-auth': auth,
    },
  })
  return new Uint8Array(await response.arrayBuffer())
}
