import fc from 'fast-check'
import { beforeEach, describe, expect, test, vi } from 'vitest'
import type { InlayAsset } from '../inlays'
import {
  getInlayAsset,
  getInlayAssetBlob,
  listInlayAssets,
  postInlayAsset,
  removeInlayAsset,
  setInlayAsset,
  writeInlayImage,
} from '../inlays'

//#region module mocks

/** Server asset upload stub: returns a deterministic asset id from content bytes. */
const serverAssetStore = new Map<string, { bytes: Uint8Array; contentType: string }>()

function fakeAssetId(bytes: Uint8Array): string {
  // Deterministic 64-hex-char id based on byte length for test reproducibility.
  return 'a'.repeat(64 - String(bytes.length).length) + String(bytes.length)
}

vi.mock('src/ts/server/assets', () => ({
  SERVER_INLAY_SIGNATURE_CONTENT_TYPE: 'application/x-risu-inlay-signature+json',
  serverAssetIdFromReference: vi.fn((_id: string) => null),
  uploadServerAssetBytes: vi.fn(async (data: Uint8Array, contentType: string) => {
    const id = fakeAssetId(data)
    serverAssetStore.set(id, { bytes: data, contentType })
    return id
  }),
  readServerAsset: vi.fn(async (id: string) => {
    const entry = serverAssetStore.get(id)
    if (!entry) throw new Error(`Asset not found: ${id}`)
    return {
      bytes: entry.bytes,
      contentType: entry.contentType,
      extension: 'png',
    }
  }),
}))

// happy-dom canvas getContext returns null
const fakeCtx = {
  drawImage: vi.fn(),
}
const origCreateElement = document.createElement.bind(document)
vi.spyOn(document, 'createElement').mockImplementation((tag: string, options?: any) => {
  const el = origCreateElement(tag, options)
  if (tag === 'canvas') {
    ;(el as HTMLCanvasElement).getContext = (() => fakeCtx) as any
    ;(el as HTMLCanvasElement).toBlob = ((cb: BlobCallback) => {
      cb(new Blob(['fake-png'], { type: 'image/png' }))
    }) as any
  }
  return el
})

const store = new Map<string, unknown>()

vi.mock('localforage', () => ({
  default: {
    createInstance: () => ({
      getItem: vi.fn(async (key: string) => store.get(key) ?? null),
      setItem: vi.fn(async (key: string, value: unknown) => {
        store.set(key, value)
      }),
      removeItem: vi.fn(async (key: string) => {
        store.delete(key)
      }),
      iterate: vi.fn(async (cb: (value: unknown, key: string) => void) => {
        for (const [key, value] of store) {
          cb(value, key)
        }
      }),
    }),
  },
}))

vi.mock('uuid', () => ({
  v4: vi.fn(() => 'test-uuid-1234'),
}))

vi.mock(import('src/ts/media'), () => ({
  getImageType: vi.fn(),
}))

vi.mock(import('src/ts/model/modellist'), () => ({
  getModelInfo: vi.fn(),
}))

vi.mock(import('src/ts/storage/database.svelte'), () => ({
  getDatabase: vi.fn(),
}))

vi.mock(
  import('src/ts/util'),
  () =>
    ({
      asBuffer: (arr: Uint8Array) => arr,
    }) as typeof import('src/ts/util'),
)

//#endregion

const supportedAudioExts = ['wav', 'mp3', 'ogg', 'flac'] as const
const supportedVideoExts = ['webm', 'mp4', 'mkv'] as const
const supportedImageExts = ['jpg', 'jpeg', 'png', 'gif', 'webp', 'avif'] as const
const allSupportedExts = [...supportedAudioExts, ...supportedVideoExts, ...supportedImageExts]

function makeImage(
  w: number,
  h: number,
  options: {
    complete?: boolean
    decode?: (() => Promise<void>) | null
    naturalHeight?: number
    naturalWidth?: number
  } = {},
): HTMLImageElement {
  const img = new Image()
  const decode = options.decode === null ? undefined : (options.decode ?? vi.fn(async () => {}))
  Object.defineProperty(img, 'width', { get: () => w })
  Object.defineProperty(img, 'height', { get: () => h })
  Object.defineProperty(img, 'naturalWidth', { get: () => options.naturalWidth ?? w })
  Object.defineProperty(img, 'naturalHeight', { get: () => options.naturalHeight ?? h })
  Object.defineProperty(img, 'complete', { get: () => options.complete ?? true })
  Object.defineProperty(img, 'decode', { value: decode })
  return img
}

beforeEach(() => {
  vi.clearAllMocks()
  store.clear()
  serverAssetStore.clear()
})

describe('setInlayAsset', () => {
  test('uploads to server and remembers metadata in local storage', async () => {
    const asset: InlayAsset = {
      data: new Blob(['hello'], { type: 'text/plain' }),
      ext: 'png',
      height: 100,
      width: 100,
      name: 'test.png',
      type: 'image',
    }

    const assetId = await setInlayAsset('asset-1', asset)

    // The server store received the upload.
    expect(serverAssetStore.has(assetId)).toBe(true)
    // Local store holds metadata without data, keyed by the original id.
    const remembered = store.get('asset-1') as InlayAsset
    expect(remembered).toMatchObject({
      name: 'test.png',
      ext: 'png',
      height: 100,
      width: 100,
      type: 'image',
      serverAssetId: assetId,
    })
    expect(remembered.data).toBeUndefined()
  })

  test('overwrites an existing asset with the same id', async () => {
    const first: InlayAsset = {
      data: new Blob(['a']),
      ext: 'png',
      height: 10,
      name: 'first.png',
      type: 'image',
      width: 10,
    }
    const second: InlayAsset = {
      data: new Blob(['b']),
      ext: 'png',
      height: 20,
      name: 'second.png',
      type: 'image',
      width: 20,
    }

    await setInlayAsset('id-1', first)
    await setInlayAsset('id-1', second)

    expect(store.get('id-1') as InlayAsset).toMatchObject({
      height: 20,
      name: 'second.png',
      type: 'image',
      width: 20,
    })
  })
})

describe('getInlayAsset', () => {
  test('returns null for a non-existent id', async () => {
    const result = await getInlayAsset('does-not-exist')
    expect(result).toBeNull()
  })

  test('returns asset with base64 data URI when metadata has serverAssetId', async () => {
    const serverBytes = new TextEncoder().encode('test-data')
    const assetId = fakeAssetId(serverBytes)
    serverAssetStore.set(assetId, { bytes: serverBytes, contentType: 'image/png' })
    store.set('blob-id', {
      ext: 'png',
      height: 50,
      width: 50,
      name: 'blob-asset.png',
      type: 'image',
      serverAssetId: assetId,
    } satisfies InlayAsset)

    const result = await getInlayAsset('blob-id')

    expect(result!.data).toMatch(/^data:/)
    expect(result!.name).toBe('blob-asset.png')
  })

  test('falls back to legacy local Blob data when no serverAssetId', async () => {
    const blob = new Blob(['legacy-local'], { type: 'image/png' })
    store.set('legacy-id', {
      data: blob,
      ext: 'png',
      height: 50,
      width: 50,
      name: 'legacy.png',
      type: 'image',
    } satisfies InlayAsset)

    const result = await getInlayAsset('legacy-id')

    expect(result!.data).toMatch(/^data:/)
    expect(result!.name).toBe('legacy.png')
  })

  test('falls back to legacy local string data when no serverAssetId', async () => {
    const b64 = 'data:image/png;base64,aGVsbG8='
    store.set('str-id', {
      data: b64,
      ext: 'png',
      height: 50,
      width: 50,
      name: 'string-asset.png',
      type: 'image',
    } satisfies InlayAsset)

    const result = await getInlayAsset('str-id')
    expect(result!.data).toBe(b64)
  })
})

describe('getInlayAssetBlob', () => {
  test('returns null for a non-existent id', async () => {
    const result = await getInlayAssetBlob('does-not-exist')
    expect(result).toBeNull()
  })

  test('returns Blob from server when metadata has serverAssetId', async () => {
    const serverBytes = new TextEncoder().encode('binary-data')
    const assetId = fakeAssetId(serverBytes)
    serverAssetStore.set(assetId, { bytes: serverBytes, contentType: 'image/png' })
    store.set('blob-id', {
      ext: 'png',
      height: 64,
      width: 64,
      name: 'blob.png',
      type: 'image',
      serverAssetId: assetId,
    } satisfies InlayAsset)

    const result = await getInlayAssetBlob('blob-id')
    expect(result!.data).toBeInstanceOf(Blob)
  })

  test('falls back to legacy local Blob when no serverAssetId', async () => {
    const blob = new Blob(['binary-data'], { type: 'image/png' })
    store.set('blob-id', {
      data: blob,
      ext: 'png',
      height: 64,
      width: 64,
      name: 'blob.png',
      type: 'image',
    } satisfies InlayAsset)

    const result = await getInlayAssetBlob('blob-id')
    expect(result!.data).toBeInstanceOf(Blob)
  })

  test('migrates legacy string data to Blob and updates storage', async () => {
    const b64 = 'data:image/png;base64,aGVsbG8='
    store.set('legacy-id', {
      data: b64,
      ext: 'png',
      height: 32,
      width: 32,
      name: 'legacy.png',
      type: 'image',
    } satisfies InlayAsset)

    const result = await getInlayAssetBlob('legacy-id')
    expect(result!.data).toBeInstanceOf(Blob)
  })
})

describe('listInlayAssets', () => {
  test('returns empty array when no assets exist', async () => {
    const result = await listInlayAssets()
    expect(result).toEqual([])
  })

  test('returns all stored assets as [id, asset] tuples', async () => {
    const asset1: InlayAsset = {
      data: new Blob(['a']),
      ext: 'png',
      height: 10,
      width: 10,
      name: 'a.png',
      type: 'image',
    }
    const asset2: InlayAsset = {
      data: new Blob(['b']),
      ext: 'mp3',
      height: 0,
      width: 0,
      name: 'b.mp3',
      type: 'audio',
    }
    store.set('id-a', asset1)
    store.set('id-b', asset2)

    const result = await listInlayAssets()
    expect(result).toMatchObject([
      ['id-a', { name: 'a.png' }],
      ['id-b', { name: 'b.mp3' }],
    ])
  })
})

describe('removeInlayAsset', () => {
  test('does not throw when removing a non-existent id', async () => {
    await expect(removeInlayAsset('nope')).resolves.not.toThrow()
  })
})

describe('postInlayAsset', () => {
  test('uploads audio asset to server and returns server asset id', async () => {
    const data = new Uint8Array([0xff, 0xfb, 0x90, 0x00])
    const result = await postInlayAsset({
      name: 'clip.mp3',
      data,
    })
    expect(result).not.toBeNull()
    expect(serverAssetStore.has(result!)).toBe(true)

    // Local store holds metadata without data.
    const stored = store.get(result!) as InlayAsset
    expect(stored).toMatchObject({
      ext: 'mp3',
      name: 'clip.mp3',
      type: 'audio',
      serverAssetId: result,
    })
    expect(stored.data).toBeUndefined()
  })

  test('uploads video asset to server and returns server asset id', async () => {
    const data = new Uint8Array([0x1a, 0x45, 0xdf, 0xa3])
    const result = await postInlayAsset({
      name: 'video.webm',
      data,
    })
    expect(result).not.toBeNull()
    expect(serverAssetStore.has(result!)).toBe(true)

    const stored = store.get(result!) as InlayAsset
    expect(stored).toMatchObject({
      ext: 'webm',
      name: 'video.webm',
      type: 'video',
      serverAssetId: result,
    })
    expect(stored.data).toBeUndefined()
  })

  test('returns null for any unsupported extension', async () => {
    await fc.assert(
      fc.asyncProperty(
        fc
          .string({ minLength: 1, maxLength: 10 })
          .filter((ext) => !allSupportedExts.includes(ext as any)),
        async (ext) => {
          store.clear()
          serverAssetStore.clear()
          const result = await postInlayAsset({
            name: `file.${ext}`,
            data: new Uint8Array([0x00]),
          })
          expect(result).toBeNull()
        },
      ),
    )
  })

  test('routes audio extensions to audio type', async () => {
    await fc.assert(
      fc.asyncProperty(fc.constantFrom(...supportedAudioExts), async (ext) => {
        store.clear()
        serverAssetStore.clear()
        const result = await postInlayAsset({
          name: `sound.${ext}`,
          data: new Uint8Array([0x00]),
        })
        expect(result).not.toBeNull()
        const stored = store.get(result!) as InlayAsset
        expect(stored.type).toBe('audio')
        expect(stored.ext).toBe(ext)
      }),
    )
  })

  test('routes video extensions to video type', async () => {
    await fc.assert(
      fc.asyncProperty(fc.constantFrom(...supportedVideoExts), async (ext) => {
        store.clear()
        serverAssetStore.clear()
        const result = await postInlayAsset({
          name: `clip.${ext}`,
          data: new Uint8Array([0x00]),
        })
        expect(result).not.toBeNull()
        const stored = store.get(result!) as InlayAsset
        expect(stored.type).toBe('video')
        expect(stored.ext).toBe(ext)
      }),
    )
  })
})

describe('writeInlayImage', () => {
  test('L49: already-complete inlay images decode and upload without waiting for onload', async () => {
    const decode = vi.fn(async () => {})
    const imgObj = makeImage(120, 80, { complete: true, decode })
    let assignedOnload = false
    Object.defineProperty(imgObj, 'onload', {
      configurable: true,
      set() {
        assignedOnload = true
      },
    })

    const result = await writeInlayImage(imgObj, {
      name: 'complete.png',
    })

    expect(decode).toHaveBeenCalledTimes(1)
    expect(assignedOnload).toBe(false)
    expect(serverAssetStore.has(result)).toBe(true)
    expect(store.get(result)).toMatchObject({
      height: 80,
      name: 'complete.png',
      type: 'image',
      width: 120,
    })
  })

  test('L49: broken inlay images reject instead of hanging', async () => {
    const imgObj = makeImage(0, 0, {
      complete: false,
      decode: null,
      naturalHeight: 0,
      naturalWidth: 0,
    })

    const result = writeInlayImage(imgObj)
    imgObj.dispatchEvent(new Event('error'))

    await expect(result).rejects.toThrow('Inlay image failed to load')
    expect(fakeCtx.drawImage).not.toHaveBeenCalled()
    expect(serverAssetStore.size).toBe(0)
  })

  test('L49: decode rejection without dimensions rejects instead of uploading', async () => {
    const decode = vi.fn(async () => {
      throw new Error('decode failed')
    })
    const imgObj = makeImage(0, 0, {
      complete: true,
      decode,
      naturalHeight: 0,
      naturalWidth: 0,
    })

    await expect(writeInlayImage(imgObj)).rejects.toThrow('decode failed')
    expect(fakeCtx.drawImage).not.toHaveBeenCalled()
    expect(serverAssetStore.size).toBe(0)
  })

  test('uploads image to server and stores metadata under both server and custom id', async () => {
    const imgObj = makeImage(200, 100)

    const result = await writeInlayImage(imgObj, {
      name: 'photo.jpg',
      ext: 'jpg',
      id: 'custom-id',
    })

    // Returns the server asset id, not the custom id.
    expect(serverAssetStore.has(result)).toBe(true)

    // Metadata stored under the server asset id.
    const storedByServer = store.get(result) as InlayAsset
    expect(storedByServer).toMatchObject({
      ext: 'png',
      height: 100,
      name: 'photo.jpg',
      type: 'image',
      width: 200,
      serverAssetId: result,
    })
    expect(storedByServer.data).toBeUndefined()

    // Metadata also stored under the caller-provided custom id.
    const storedByCustom = store.get('custom-id') as InlayAsset
    expect(storedByCustom).toMatchObject({
      name: 'photo.jpg',
      serverAssetId: result,
    })
  })

  test('returns server asset id when no custom id is provided', async () => {
    const imgObj = makeImage(50, 50)

    const result = await writeInlayImage(imgObj)
    expect(serverAssetStore.has(result)).toBe(true)

    const stored = store.get(result) as InlayAsset
    expect(stored).toMatchObject({
      type: 'image',
      serverAssetId: result,
    })
  })

  test('output pixels never exceed 1024 * 1024', async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.integer({ min: 1, max: 10000 }),
        fc.integer({ min: 1, max: 10000 }),
        async (w, h) => {
          store.clear()
          serverAssetStore.clear()
          const img = makeImage(w, h)
          const assetId = await writeInlayImage(img, { id: 'prop-img' })
          const stored = store.get(assetId) as InlayAsset

          expect(stored.width * stored.height).toBeLessThanOrEqual(1024 * 1024)
          expect(stored.width).toBeGreaterThan(0)
          expect(stored.height).toBeGreaterThan(0)
        },
      ),
    )
  })

  test('preserves aspect ratio when downscaling', async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.integer({ min: 1025, max: 10000 }),
        fc.integer({ min: 1025, max: 10000 }),
        async (w, h) => {
          store.clear()
          serverAssetStore.clear()
          const img = makeImage(w, h)
          const assetId = await writeInlayImage(img, { id: 'ratio-img' })
          const stored = store.get(assetId) as InlayAsset

          const originalRatio = w / h
          const storedRatio = stored.width / stored.height
          expect(Math.abs(originalRatio - storedRatio) / originalRatio).toBeLessThan(0.01)
        },
      ),
    )
  })

  test('does not resize images within pixel budget', async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.integer({ min: 1, max: 1024 }),
        fc.integer({ min: 1, max: 1024 }),
        async (w, h) => {
          store.clear()
          serverAssetStore.clear()
          const img = makeImage(w, h)
          const assetId = await writeInlayImage(img, { id: 'small-img' })

          const stored = store.get(assetId) as InlayAsset
          expect(stored).toMatchObject({
            height: h,
            width: w,
          })
        },
      ),
    )
  })
})

describe('set -> get round-trip', () => {
  test('preserves metadata through setInlayAsset -> getInlayAsset via server', async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.string({ minLength: 1, maxLength: 20 }),
        fc.string({ minLength: 1, maxLength: 30 }),
        fc.nat({ max: 5000 }),
        fc.nat({ max: 5000 }),
        async (id, name, width, height) => {
          store.clear()
          serverAssetStore.clear()
          // Use a proper image content type so the server read-back resolves to 'image'.
          const blob = new Blob(['data'], { type: 'image/png' })
          const asset: InlayAsset = {
            data: blob,
            ext: 'png',
            height,
            width,
            name,
            type: 'image',
          }

          await setInlayAsset(id, asset)

          const result = await getInlayAsset(id)
          expect(result).toMatchObject({
            data: expect.any(String),
            height,
            width,
            name,
            type: 'image',
          })
        },
      ),
    )
  })
})

describe('set -> remove -> get', () => {
  test('asset is always null after removal', async () => {
    await fc.assert(
      fc.asyncProperty(fc.string({ minLength: 1, maxLength: 20 }), async (id) => {
        store.clear()
        serverAssetStore.clear()
        const asset: InlayAsset = {
          data: new Blob(['x']),
          ext: 'png',
          height: 1,
          width: 1,
          name: 'tmp.png',
          type: 'image',
        }

        await setInlayAsset(id, asset)
        expect(await getInlayAsset(id)).not.toBeNull()

        await removeInlayAsset(id)
        expect(await getInlayAsset(id)).toBeNull()
      }),
    )
  })
})
