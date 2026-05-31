import { activeWriterSessionHeader, handleActiveWriterStaleResponse } from './activeWriterSession'

const SERVER_ASSET_ID_RE = /^[a-f0-9]{64}$/
const LOCAL_ASSET_PATH_RE = /^assets\/([a-f0-9]{64})\.[a-z0-9]+$/i

export const SERVER_INLAY_SIGNATURE_CONTENT_TYPE = 'application/x-risu-inlay-signature+json'

export const SERVER_ASSET_CONTENT_TYPES: Record<string, string> = {
  onnx: 'application/x-onnx',
  png: 'image/png',
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  webp: 'image/webp',
  gif: 'image/gif',
  avif: 'image/avif',
  mp3: 'audio/mpeg',
  wav: 'audio/wav',
  ogg: 'audio/ogg',
  flac: 'audio/flac',
  weba: 'audio/webm',
  webm: 'video/webm',
  mp4: 'video/mp4',
  mkv: 'video/x-matroska',
  svg: 'image/svg+xml',
  css: 'text/css',
  ttf: 'font/ttf',
  otf: 'font/otf',
  woff: 'font/woff',
  woff2: 'font/woff2',
  json: SERVER_INLAY_SIGNATURE_CONTENT_TYPE,
}

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

export function serverAssetContentType(fileExtension: string): string {
  const contentType = SERVER_ASSET_CONTENT_TYPES[fileExtension]
  if (!contentType) {
    throw new Error(`Unsupported server asset extension: ${fileExtension}`)
  }
  return contentType
}

function extensionFromContentType(contentType: string): string {
  return (
    Object.entries(SERVER_ASSET_CONTENT_TYPES).find(([, type]) => type === contentType)?.[0] ??
    'png'
  )
}

async function advanceServerAssetRevision(revision: unknown): Promise<void> {
  // A new asset bumps the repository revision; advance the cached command
  // revision so the next command does not race on a stale baseRevision.
  if (typeof revision === 'number') {
    const { setCachedServerCommandRevision } = await import('./commands')
    setCachedServerCommandRevision(revision)
  }
}

export async function uploadServerAssetBytes(
  data: Uint8Array,
  contentType: string,
): Promise<string> {
  const auth = await resolveServerAssetAuth(undefined)
  const uploadBody = data.buffer.slice(
    data.byteOffset,
    data.byteOffset + data.byteLength,
  ) as ArrayBuffer
  const response = await fetch('/api/v1/assets', {
    method: 'POST',
    headers: {
      'content-type': contentType,
      'risu-auth': auth,
      ...activeWriterSessionHeader(),
    },
    body: uploadBody,
  })
  if (!response.ok) {
    handleActiveWriterStaleResponse(response)
    const body = await response.text().catch(() => '')
    throw new Error(body || `Failed to upload server asset: ${response.status}`)
  }
  const responseBody = (await response.json()) as { assetId?: unknown; revision?: unknown }
  if (typeof responseBody.assetId !== 'string') {
    throw new Error('Server asset upload response missing assetId')
  }
  await advanceServerAssetRevision(responseBody.revision)
  return responseBody.assetId
}

export async function uploadServerAsset(data: Uint8Array, fileExtension: string): Promise<string> {
  return uploadServerAssetBytes(data, serverAssetContentType(fileExtension))
}

export interface ReadServerAssetResult {
  bytes: Uint8Array
  contentType: string
  extension: string
}

export async function readServerAsset(
  loc: string,
  options: ReadServerAssetOptions = {},
): Promise<ReadServerAssetResult> {
  const assetUrl = serverAssetUrl(loc)
  if (!assetUrl) {
    throw new Error(`Unsupported server asset reference: ${loc}`)
  }
  const auth = await resolveServerAssetAuth(options.auth)
  const fetchImpl = options.fetchImpl ?? fetch
  const response = await fetchImpl(assetUrl, {
    headers: {
      'risu-auth': auth,
    },
  })
  if (!response.ok) {
    throw new Error(`Failed to read server asset: ${response.status}`)
  }
  const contentType =
    response.headers.get('content-type')?.split(';')[0] ?? 'application/octet-stream'
  return {
    bytes: new Uint8Array(await response.arrayBuffer()),
    contentType,
    extension: extensionFromContentType(contentType),
  }
}

export async function readServerAssetBytes(
  loc: string,
  options: ReadServerAssetOptions = {},
): Promise<Uint8Array> {
  if (!serverAssetUrl(loc)) {
    throw new Error(`Unsupported server asset reference: ${loc}`)
  }
  return (await readServerAsset(loc, options)).bytes
}
async function resolveServerAssetAuth(auth: string | undefined): Promise<string> {
  if (auth !== undefined) return auth
  const { getNodeServerProxyAuth } = await import('../storage/nodeStorage')
  return getNodeServerProxyAuth()
}
