// @ts-nocheck
import localforage from 'localforage'
import { v4 } from 'uuid'
import { getImageType } from 'src/ts/media'
import { getDatabase } from '../../storage/database.svelte'
import { getModelInfo, LLMFlags, LLMFormat } from 'src/ts/model/modellist'
import { asBuffer } from '../../util'
import {
  readServerAsset,
  serverAssetIdFromReference,
  SERVER_INLAY_SIGNATURE_CONTENT_TYPE,
  uploadServerAssetBytes,
} from '../../server/assets'

export type InlayAsset = {
  data?: string | Blob
  /** File extension */
  ext: string
  height?: number
  name: string
  /** Fastify server asset id for browser-local legacy inlay ids. */
  serverAssetId?: string
  type: 'image' | 'video' | 'audio' | 'signature'
  width?: number
}

const inlayImageExts = ['jpg', 'jpeg', 'png', 'gif', 'webp', 'avif']

const inlayAudioExts = ['wav', 'mp3', 'ogg', 'flac']

const inlayVideoExts = ['webm', 'mp4', 'mkv']

const inlayStorage = localforage.createInstance({
  name: 'inlay',
  storeName: 'inlay',
})

function inlayContentType(type: InlayAsset['type'], ext: string): string {
  if (type === 'signature') return SERVER_INLAY_SIGNATURE_CONTENT_TYPE
  if (type === 'image') return ext === 'jpg' ? 'image/jpeg' : `image/${ext}`
  if (type === 'audio') {
    if (ext === 'mp3') return 'audio/mpeg'
    return `audio/${ext}`
  }
  if (ext === 'mkv') return 'video/x-matroska'
  return `video/${ext}`
}

function inlayTypeFromContentType(contentType: string): InlayAsset['type'] | null {
  if (contentType === SERVER_INLAY_SIGNATURE_CONTENT_TYPE) return 'signature'
  if (contentType.startsWith('image/')) return 'image'
  if (contentType.startsWith('audio/')) return 'audio'
  if (contentType.startsWith('video/')) return 'video'
  return null
}

function dataUriToBytes(data: string): { bytes: Uint8Array; contentType: string } {
  const splitDataURI = data.split(',')
  const byteString = atob(splitDataURI[1] ?? '')
  const contentType = splitDataURI[0]?.split(':')[1]?.split(';')[0] ?? 'application/octet-stream'

  const bytes = new Uint8Array(byteString.length)
  for (let i = 0; i < byteString.length; i++) {
    bytes[i] = byteString.charCodeAt(i)
  }
  return { bytes, contentType }
}

async function blobToBytes(blob: Blob): Promise<Uint8Array> {
  return new Uint8Array(await blob.arrayBuffer())
}

async function uploadInlayAssetToServer(img: InlayAsset): Promise<string> {
  if (img.serverAssetId) return img.serverAssetId
  if (img.data === undefined) {
    throw new Error(`Inlay asset ${img.name} has no local bytes to upload`)
  }

  if (img.data instanceof Blob) {
    const contentType = img.data.type || inlayContentType(img.type, img.ext)
    return uploadServerAssetBytes(await blobToBytes(img.data), contentType)
  }

  if (img.type === 'signature') {
    return uploadServerAssetBytes(
      new TextEncoder().encode(img.data),
      SERVER_INLAY_SIGNATURE_CONTENT_TYPE,
    )
  }

  const { bytes, contentType } = dataUriToBytes(img.data)
  return uploadServerAssetBytes(bytes, contentType || inlayContentType(img.type, img.ext))
}

async function rememberServerInlayAsset(id: string, img: InlayAsset): Promise<void> {
  await inlayStorage.setItem(id, { ...img, data: undefined })
}

export async function postInlayAsset(img: { name: string; data: Uint8Array }) {
  const extention = img.name.split('.').at(-1)?.toLowerCase()
  const imgObj = new Image()

  if (extention && inlayImageExts.includes(extention)) {
    imgObj.src = URL.createObjectURL(new Blob([asBuffer(img.data)], { type: `image/${extention}` }))

    return await writeInlayImage(imgObj, {
      name: img.name,
      ext: extention,
    })
  }

  if (extention && inlayAudioExts.includes(extention)) {
    const assetId = await uploadServerAssetBytes(img.data, inlayContentType('audio', extention))
    await rememberServerInlayAsset(assetId, {
      name: img.name,
      ext: extention,
      type: 'audio',
      serverAssetId: assetId,
    })
    return assetId
  }

  if (extention && inlayVideoExts.includes(extention)) {
    const assetId = await uploadServerAssetBytes(img.data, inlayContentType('video', extention))
    await rememberServerInlayAsset(assetId, {
      name: img.name,
      ext: extention,
      type: 'video',
      serverAssetId: assetId,
    })
    return assetId
  }

  return null
}

export async function writeInlayImage(
  imgObj: HTMLImageElement,
  arg: { name?: string; ext?: string; id?: string } = {},
) {
  let drawHeight = 0
  let drawWidth = 0
  const canvas = document.createElement('canvas')
  const ctx = canvas.getContext('2d')
  await new Promise((resolve) => {
    imgObj.onload = () => {
      drawHeight = imgObj.height
      drawWidth = imgObj.width

      //resize image to fit inlay, if total pixels exceed 1024*1024
      const maxPixels = 1024 * 1024
      const currentPixels = drawHeight * drawWidth

      if (currentPixels > maxPixels) {
        const scaleFactor = Math.sqrt(maxPixels / currentPixels)
        drawWidth = Math.floor(drawWidth * scaleFactor)
        drawHeight = Math.floor(drawHeight * scaleFactor)
      }

      canvas.width = drawWidth
      canvas.height = drawHeight
      ctx.drawImage(imgObj, 0, 0, drawWidth, drawHeight)
      resolve(null)
    }
  })
  const imageBlob = await new Promise((resolve) => canvas.toBlob(resolve, 'image/png'))

  const imgid = arg.id ?? v4()

  const assetId = await uploadServerAssetBytes(await blobToBytes(imageBlob as Blob), 'image/png')
  await rememberServerInlayAsset(assetId, {
    name: arg.name ?? assetId,
    ext: 'png',
    height: drawHeight,
    width: drawWidth,
    type: 'image',
    serverAssetId: assetId,
  })
  if (arg.id && arg.id !== assetId) {
    await rememberServerInlayAsset(arg.id, {
      name: arg.name ?? arg.id,
      ext: 'png',
      height: drawHeight,
      width: drawWidth,
      type: 'image',
      serverAssetId: assetId,
    })
  }
  return assetId
}

export type InlaySignature = {
  signatures: {
    type: 'function' | 'text'
    content: string
  }[]
  sourceFormat: LLMFormat
  source: string
}

export async function saveInlayedSignature(sigid: string, signature: InlaySignature) {
  const data = JSON.stringify(signature)
  const assetId = await uploadServerAssetBytes(
    new TextEncoder().encode(data),
    SERVER_INLAY_SIGNATURE_CONTENT_TYPE,
  )
  await rememberServerInlayAsset(assetId, {
    name: sigid,
    ext: 'json',
    type: 'signature',
    serverAssetId: assetId,
  })
  if (sigid !== assetId) {
    await rememberServerInlayAsset(sigid, {
      name: sigid,
      ext: 'json',
      type: 'signature',
      serverAssetId: assetId,
    })
  }
  return assetId
}

function base64ToBlob(b64: string): Blob {
  const splitDataURI = b64.split(',')
  const byteString = atob(splitDataURI[1])
  const mimeString = splitDataURI[0].split(':')[1].split(';')[0]

  const ab = new ArrayBuffer(byteString.length)
  const ia = new Uint8Array(ab)
  for (let i = 0; i < byteString.length; i++) {
    ia[i] = byteString.charCodeAt(i)
  }

  return new Blob([ab], { type: mimeString })
}

function blobToBase64(blob: Blob): Promise<string> {
  const reader = new FileReader()
  reader.readAsDataURL(blob)
  return new Promise<string>((resolve, reject) => {
    reader.onloadend = () => {
      resolve(reader.result as string)
    }
    reader.onerror = reject
  })
}

// Returns with base64 data URI
export async function getInlayAsset(id: string) {
  const serverAsset = await getServerInlayAssetId(id)
  if (serverAsset) {
    const meta = await inlayStorage.getItem<InlayAsset | null>(id)
    try {
      const stored = await readServerAsset(serverAsset)
      const type = inlayTypeFromContentType(stored.contentType)
      if (type) {
        const data =
          type === 'signature'
            ? new TextDecoder().decode(stored.bytes)
            : `data:${stored.contentType};base64,${Buffer.from(stored.bytes).toString('base64')}`
        return {
          name: meta?.name ?? serverAsset,
          ext: meta?.ext ?? stored.extension,
          height: meta?.height,
          width: meta?.width,
          type,
          serverAssetId: serverAsset,
          data,
        } satisfies InlayAsset & { data: string }
      }
    } catch {
      // Fall through to the browser-local legacy read below.
    }
  }

  const img = await inlayStorage.getItem<InlayAsset | null>(id)
  if (img === null) {
    return null
  }
  if (img.data === undefined) return null

  let data: string
  if (img.data instanceof Blob) {
    data = await blobToBase64(img.data)
  } else {
    data = img.data as string
  }

  return { ...img, data }
}

// Returns with Blob
export async function getInlayAssetBlob(id: string) {
  const serverAsset = await getServerInlayAssetId(id)
  if (serverAsset) {
    const meta = await inlayStorage.getItem<InlayAsset | null>(id)
    try {
      const stored = await readServerAsset(serverAsset)
      const type = inlayTypeFromContentType(stored.contentType)
      if (type) {
        return {
          name: meta?.name ?? serverAsset,
          ext: meta?.ext ?? stored.extension,
          height: meta?.height,
          width: meta?.width,
          type,
          serverAssetId: serverAsset,
          data: new Blob([asBuffer(stored.bytes)], { type: stored.contentType }),
        } satisfies InlayAsset & { data: Blob }
      }
    } catch {
      // Fall through to the browser-local legacy read below.
    }
  }

  const img = await inlayStorage.getItem<InlayAsset | null>(id)
  if (img === null) {
    return null
  }
  if (img.data === undefined) return null

  let data: Blob
  if (typeof img.data === 'string') {
    // Migrate to Blob
    data = base64ToBlob(img.data)
    setInlayAsset(id, { ...img, data })
  } else {
    data = img.data
  }

  return { ...img, data }
}

export async function listInlayAssets(): Promise<[id: string, InlayAsset][]> {
  const assets: [id: string, InlayAsset][] = []
  await inlayStorage.iterate<InlayAsset, void>((value, key) => {
    assets.push([key, value])
  })

  return assets
}

export async function setInlayAsset(id: string, img: InlayAsset) {
  const assetId = await uploadInlayAssetToServer(img)
  await rememberServerInlayAsset(id, { ...img, serverAssetId: assetId })
  if (id !== assetId) {
    await rememberServerInlayAsset(assetId, { ...img, serverAssetId: assetId })
  }
  return assetId
}

export async function removeInlayAsset(id: string) {
  await inlayStorage.removeItem(id)
}

export function supportsInlayImage() {
  const db = getDatabase()
  return getModelInfo(db.aiModel).flags.includes(LLMFlags.hasImageInput)
}

export async function getServerInlayAssetId(id: string): Promise<string | null> {
  const direct = serverAssetIdFromReference(id)
  if (direct) return direct

  const img = await inlayStorage.getItem<InlayAsset | null>(id)
  if (!img) return null
  if (img.serverAssetId) return img.serverAssetId

  const assetId = await uploadInlayAssetToServer(img)
  await rememberServerInlayAsset(id, { ...img, serverAssetId: assetId })
  await rememberServerInlayAsset(assetId, { ...img, serverAssetId: assetId })
  return assetId
}

export async function getInlayAssetMetadata(
  id: string,
): Promise<Pick<InlayAsset, 'height' | 'name' | 'type' | 'width'> | null> {
  const img = await inlayStorage.getItem<InlayAsset | null>(id)
  if (!img) return null
  return {
    name: img.name,
    type: img.type,
    ...(typeof img.height === 'number' ? { height: img.height } : {}),
    ...(typeof img.width === 'number' ? { width: img.width } : {}),
  }
}

export async function reencodeImage(img: Uint8Array) {
  if (getImageType(img) === 'PNG') {
    return img
  }
  const canvas = document.createElement('canvas')
  const imgObj = new Image()
  imgObj.src = URL.createObjectURL(new Blob([asBuffer(img)], { type: `image/png` }))
  await imgObj.decode()
  let drawHeight = imgObj.height
  let drawWidth = imgObj.width
  canvas.width = drawWidth
  canvas.height = drawHeight
  const ctx = canvas.getContext('2d')
  ctx.drawImage(imgObj, 0, 0, drawWidth, drawHeight)
  const b64 = canvas.toDataURL('image/png').split(',')[1]
  const b = Buffer.from(b64, 'base64')
  return b
}
