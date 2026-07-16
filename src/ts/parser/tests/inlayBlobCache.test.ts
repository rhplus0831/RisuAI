import { writable } from 'svelte/store'
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import type { LLMModel } from '../../model/modellist'
import type { InlayAsset } from '../../process/files/inlays'
import { clearInlayBlobUrlCacheForTests, INLAY_BLOB_URL_CACHE_LIMIT, ParseMarkdown } from '../parser.svelte'

const mocks = vi.hoisted(() => ({
  db: {
    assetMaxDifference: 4,
    customQuotes: false,
    hideAllImages: false,
  },
  getInlayAssetBlob: vi.fn(),
  modelInfo: {
    id: 'test-model',
    name: 'Test Model',
    provider: 14,
    flags: [],
    format: 19,
    parameters: [],
    tokenizer: 0,
  } satisfies LLMModel,
}))

vi.mock(
  import('../../storage/database.svelte'),
  () =>
    ({
      appVer: '1234.5.67',
      getCurrentCharacter: () => ({}),
      getDatabase: () => mocks.db,
      reapplyPendingPresetProjections: () => {},
    }) as typeof import('../../storage/database.svelte'),
)

vi.mock(import('../../globalApi.svelte'), () => ({
  aiWatermarkingLawApplies: () => false,
  getFileSrc: () => Promise.resolve(''),
}))

vi.mock(import('../../stores.svelte'), () => {
  return {
    CurrentTriggerIdStore: writable(null),
    selIdState: {
      selId: 0,
    },
    selectedCharID: writable(0),
  } as typeof import('../../stores.svelte')
})

vi.mock(import('../../process/files/inlays'), () => ({
  getInlayAssetBlob: mocks.getInlayAssetBlob,
}))

vi.mock(import('../../process/modules'), () => ({
  getModuleAssets: () => [],
  getModuleLorebooks: () => [],
  getModules: () => [],
}))

vi.mock(import('../../process/scripts'), () => ({
  processScriptFull: async (_char: unknown, data: string) => ({ data, emoChanged: false }),
}))

vi.mock(import('../../model/modellist'), () => ({
  getModelInfo: () => mocks.modelInfo,
}))

let nextBlobUrlId = 0
const createObjectURL = vi.fn(() => {
  nextBlobUrlId += 1
  return `blob:test-${nextBlobUrlId}`
})
const revokeObjectURL = vi.fn()

type RenderableType = Extract<InlayAsset['type'], 'audio' | 'image' | 'video'>

function asset(id: string, type: RenderableType): InlayAsset & { data: Blob } {
  const ext = type === 'audio' ? 'mp3' : type === 'video' ? 'mp4' : 'png'
  return {
    data: new Blob([`bytes:${id}`], { type: `${type}/${ext}` }),
    ext,
    name: `${id}.${ext}`,
    type,
  }
}

async function parseInlay(input: string) {
  return ParseMarkdown(input, null, 'pretranslate')
}

beforeEach(() => {
  nextBlobUrlId = 0
  createObjectURL.mockClear()
  revokeObjectURL.mockClear()
  Object.defineProperty(URL, 'createObjectURL', {
    configurable: true,
    value: createObjectURL,
  })
  Object.defineProperty(URL, 'revokeObjectURL', {
    configurable: true,
    value: revokeObjectURL,
  })
  clearInlayBlobUrlCacheForTests()
  createObjectURL.mockClear()
  revokeObjectURL.mockClear()
  mocks.getInlayAssetBlob.mockReset()
  mocks.db.hideAllImages = false
})

afterEach(() => {
  clearInlayBlobUrlCacheForTests()
})

describe('inlay blob URL cache', () => {
  test('K3: cached inlay rendering skips asset byte fetches', async () => {
    mocks.getInlayAssetBlob.mockResolvedValue(asset('image-1', 'image'))

    const first = await parseInlay('{{inlay::image-1}}')
    const second = await parseInlay('{{inlay::image-1}}')

    expect(first).toBe(second)
    expect(mocks.getInlayAssetBlob).toHaveBeenCalledTimes(1)
    expect(createObjectURL).toHaveBeenCalledTimes(1)
  })

  test('L50: blob URL cache evicts least-recently-used entries and revokes object URLs', async () => {
    mocks.getInlayAssetBlob.mockImplementation(async (id: string) => asset(id, 'image'))

    for (let i = 0; i < INLAY_BLOB_URL_CACHE_LIMIT; i += 1) {
      await parseInlay(`{{inlay::asset-${i}}}`)
    }

    await parseInlay('{{inlay::asset-0}}')
    await parseInlay(`{{inlay::asset-${INLAY_BLOB_URL_CACHE_LIMIT}}}`)

    expect(mocks.getInlayAssetBlob).toHaveBeenCalledTimes(INLAY_BLOB_URL_CACHE_LIMIT + 1)
    expect(revokeObjectURL).toHaveBeenCalledTimes(1)
    expect(revokeObjectURL).toHaveBeenCalledWith('blob:test-2')

    await parseInlay('{{inlay::asset-0}}')
    expect(mocks.getInlayAssetBlob).toHaveBeenCalledTimes(INLAY_BLOB_URL_CACHE_LIMIT + 1)
  })

  test('does not revoke an evicted blob URL while rendered media still uses it', async () => {
    mocks.getInlayAssetBlob.mockImplementation(async (id: string) => asset(id, 'image'))

    const rendered = document.createElement('div')
    rendered.innerHTML = await parseInlay('{{inlay::asset-0}}')
    document.body.appendChild(rendered)
    for (let i = 1; i < INLAY_BLOB_URL_CACHE_LIMIT; i += 1) {
      await parseInlay(`{{inlay::asset-${i}}}`)
    }
    await parseInlay(`{{inlay::asset-${INLAY_BLOB_URL_CACHE_LIMIT}}}`)

    expect(revokeObjectURL).not.toHaveBeenCalledWith('blob:test-1')
    mocks.getInlayAssetBlob.mockClear()
    await parseInlay('{{inlay::asset-0}}')
    expect(mocks.getInlayAssetBlob).not.toHaveBeenCalled()
  })

  test('K3/L50: cached and uncached inlays render identical output', async () => {
    const cases: Array<{ id: string; marker: string; type: RenderableType }> = [
      { id: 'image-asset', marker: '{{inlay::image-asset}}', type: 'image' },
      { id: 'audio-asset', marker: '{{inlay::audio-asset}}', type: 'audio' },
      { id: 'video-asset', marker: '{{inlay::video-asset}}', type: 'video' },
      { id: 'wrapped-image', marker: '{{inlayed::wrapped-image}}', type: 'image' },
    ]

    for (const { id, marker, type } of cases) {
      clearInlayBlobUrlCacheForTests()
      mocks.getInlayAssetBlob.mockReset()
      mocks.getInlayAssetBlob.mockResolvedValue(asset(id, type))

      const uncached = await parseInlay(marker)
      mocks.getInlayAssetBlob.mockClear()
      const cached = await parseInlay(marker)

      expect(cached).toBe(uncached)
      expect(mocks.getInlayAssetBlob).not.toHaveBeenCalled()
    }
  })

  test('cached image inlays still respect hideAllImages', async () => {
    mocks.getInlayAssetBlob.mockResolvedValue(asset('hidden-image', 'image'))

    await parseInlay('{{inlay::hidden-image}}')
    mocks.getInlayAssetBlob.mockClear()
    mocks.db.hideAllImages = true

    await expect(parseInlay('{{inlay::hidden-image}}')).resolves.toBe('')
    expect(mocks.getInlayAssetBlob).not.toHaveBeenCalled()
  })
})
