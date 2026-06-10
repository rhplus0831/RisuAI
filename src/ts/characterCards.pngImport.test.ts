import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const dbState = vi.hoisted(() => ({
  db: {
    characters: [] as any[],
    characterOrder: [] as any[],
  },
}))

const alertState = vi.hoisted(() => ({
  alertStoreSet: vi.fn(),
  alertError: vi.fn(),
  alertNormal: vi.fn(),
  alertWait: vi.fn(),
}))

const globalApiState = vi.hoisted(() => ({
  saveAsset: vi.fn(),
  saveAssets: vi.fn(),
  readImage: vi.fn(),
}))

vi.mock('./alert', () => ({
  alertCardExport: vi.fn(),
  alertConfirm: vi.fn(async () => true),
  alertError: alertState.alertError,
  alertInput: vi.fn(async () => ''),
  alertMd: vi.fn(),
  alertNormal: alertState.alertNormal,
  alertProgress: vi.fn(),
  alertStore: {
    set: alertState.alertStoreSet,
  },
  alertTOS: vi.fn(),
  alertWait: alertState.alertWait,
}))

vi.mock('./globalApi.svelte', () => {
  class TestAppendableBuffer {
    deapended = 0
    #buffer = new Uint8Array(128)
    #byteLength = 0

    get buffer(): Uint8Array {
      return this.#buffer.slice(0, this.#byteLength)
    }

    append(data: Uint8Array) {
      const requiredLength = this.#byteLength + data.byteLength
      if (this.#buffer.byteLength < requiredLength) {
        let newLength = this.#buffer.byteLength * 2
        while (newLength < requiredLength) {
          newLength *= 2
        }
        const next = new Uint8Array(newLength)
        next.set(this.#buffer)
        this.#buffer = next
      }
      this.#buffer.set(data, this.#byteLength)
      this.#byteLength += data.byteLength
    }

    deappend(length: number) {
      this.#buffer = this.#buffer.slice(length)
      this.#byteLength -= length
      this.deapended += length
    }

    slice(start: number, end: number) {
      return this.buffer.slice(start - this.deapended, end - this.deapended)
    }

    length() {
      return this.#byteLength + this.deapended
    }

    clear() {
      this.#buffer = new Uint8Array(128)
      this.#byteLength = 0
      this.deapended = 0
    }
  }

  class TestWriter {
    chunks: Uint8Array[] = []
    async init() {}
    async write(data: Uint8Array) {
      this.chunks.push(data)
    }
    close() {}
  }

  return {
    AppendableBuffer: TestAppendableBuffer,
    BlankWriter: TestWriter,
    checkCharOrder: vi.fn(),
    downloadFile: vi.fn(),
    loadAsset: vi.fn(),
    LocalWriter: TestWriter,
    openURL: vi.fn(),
    readImage: globalApiState.readImage,
    saveAsset: globalApiState.saveAsset,
    saveAssets: globalApiState.saveAssets,
    VirtualWriter: TestWriter,
  }
})

vi.mock('./util', () => ({
  blobToUint8Array: vi.fn(async (blob: Blob) => new Uint8Array(await blob.arrayBuffer())),
  checkNullish: (data: unknown) => data === undefined || data === null,
  decryptBuffer: vi.fn(),
  isKnownUri: vi.fn(() => false),
  selectFileByDom: vi.fn(),
  sleep: vi.fn(),
}))

vi.mock('src/lang', () => ({
  language: {
    errors: {
      noData: 'No data',
      wrongPassword: 'Wrong password',
    },
    importedCharacter: 'Imported character',
    inputCardPassword: 'Card password',
    lowLevelAccessConfirm: 'Low-level access?',
    successExport: 'Exported',
    successImport: 'Imported',
  },
}))

vi.mock('./storage/database.svelte', () => ({
  appVer: 'test',
  applyServerProjectionDatabase: vi.fn(),
  defaultSdDataFunc: vi.fn(() => []),
  getCurrentCharacter: vi.fn(),
  getDatabase: vi.fn(() => dbState.db),
  importPreset: vi.fn(),
  setCurrentCharacter: vi.fn(),
  setDatabase: vi.fn(),
  setDatabaseLite: vi.fn(),
}))

vi.mock('./characters', () => ({
  changeChar: vi.fn(),
  characterFormatUpdate: vi.fn(),
}))

vi.mock('./media', () => ({
  compressImage: vi.fn(async (data: Uint8Array) => data),
  getImageType: vi.fn(() => 'PNG'),
}))

vi.mock('./stores.svelte', () => {
  const store = () => ({
    set: vi.fn(),
    subscribe: vi.fn(() => () => {}),
  })
  return {
    DBState: { db: dbState.db },
    selectedCharID: store(),
    SettingsMenuIndex: store(),
    settingsOpen: store(),
    ShowRealmFrameStore: store(),
  }
})

vi.mock('./parser/parser.svelte', () => ({
  hasher: vi.fn(async () => 'hash'),
}))

vi.mock('./process/files/inlays', () => ({
  reencodeImage: vi.fn(async (data: Uint8Array) => data),
}))

vi.mock('./process/processzip', () => ({
  CharXImporter: class {},
  CharXWriter: class {},
}))

vi.mock('./process/modules', () => ({
  exportModule: vi.fn(),
  readModule: vi.fn(),
}))

vi.mock('./characterCommands', () => ({
  currentCharacterStateSnapshot: vi.fn(() => ({
    characters: [],
    characterOrder: [],
    selectedCharID: -1,
  })),
  dispatchCreateCharacter: vi.fn((character: any) => {
    dbState.db.characters.push(character)
  }),
  dispatchUpdateCharacter: vi.fn(),
}))

vi.mock('./moduleCommands', () => ({
  createGlobalModule: vi.fn(),
}))

vi.mock('./server/realmImport', () => ({
  importRealmCharacterFromServer: vi.fn(),
}))

vi.mock('./server/bootstrap', () => ({
  fetchServerBootstrapProjectionReadOnly: vi.fn(),
}))

vi.mock('./server/commands', () => ({
  setCachedServerCommandRevision: vi.fn(),
}))

vi.mock('./server/chatMessageHydration.svelte', () => ({
  resetChatHydration: vi.fn(),
}))

vi.mock('./server/lorebookBridge.svelte', () => ({
  recordHydratedCharacterLorebooks: vi.fn(),
  resetLorebookHydration: vi.fn(),
}))

vi.mock('./storage/fastifyStorage', () => ({
  getNodeServerProxyAuth: vi.fn(async () => 'test-token'),
}))

import { importCharacterProcess } from './characterCards'
import { PngChunk } from './pngChunk'

const BASE_PNG = new Uint8Array(
  Buffer.from(
    'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/p9sAAAAASUVORK5CYII=',
    'base64',
  ),
)

let consoleLogSpy: ReturnType<typeof vi.spyOn>

beforeEach(() => {
  dbState.db = {
    characters: [],
    characterOrder: [],
  }
  alertState.alertStoreSet.mockClear()
  alertState.alertError.mockClear()
  alertState.alertNormal.mockClear()
  alertState.alertWait.mockClear()
  globalApiState.saveAsset.mockReset()
  globalApiState.saveAsset.mockImplementation(async () => 'primary-image')
  globalApiState.saveAssets.mockReset()
  globalApiState.saveAssets.mockImplementation(
    async (assets: readonly { data: Uint8Array }[]) =>
      assets.map((asset, index) => `asset-${index}-${Buffer.from(asset.data).toString('hex')}`),
  )
  globalApiState.readImage.mockReset()
  globalApiState.readImage.mockImplementation(async () => BASE_PNG)
  consoleLogSpy = vi.spyOn(console, 'log').mockImplementation(() => undefined)
})

afterEach(() => {
  consoleLogSpy.mockRestore()
  vi.unstubAllGlobals()
})

describe('PNG character card import', () => {
  it('L51: decodes and slices each PNG embedded asset value once during import', async () => {
    const fixture = await createPngCardFixture()
    const counters = installPngReadCounters(fixture.assetChunkTexts, fixture.assetBase64Values)

    try {
      await importCharacterProcess({
        name: 'multi-asset.png',
        data: fixture.png,
      })
    } finally {
      counters.restore()
    }

    for (const value of fixture.assetBase64Values) {
      expect(counters.valueDecodeCounts.get(value)).toBe(1)
    }
    for (const chunkText of fixture.assetChunkTexts) {
      expect(counters.chunkSliceCounts.get(chunkText)).toBe(1)
    }
    expect(globalApiState.saveAssets.mock.calls[0][0].map((asset) => Array.from(asset.data))).toEqual(
      fixture.assetPayloads.map((asset) => Array.from(asset)),
    )
  })

  it('L51: preserves multi-asset PNG import output and progress order', async () => {
    const fixture = await createPngCardFixture()

    await importCharacterProcess({
      name: 'multi-asset.png',
      data: fixture.png,
    })

    expect(alertState.alertError).not.toHaveBeenCalled()
    expect(globalApiState.saveAsset).toHaveBeenCalledTimes(1)
    expect(globalApiState.saveAssets.mock.calls[0][0].map((asset) => Array.from(asset.data))).toEqual(
      fixture.assetPayloads.map((asset) => Array.from(asset)),
    )
    expect(dbState.db.characters).toHaveLength(1)
    expect(dbState.db.characters[0]).toMatchObject({
      name: 'PNG Multi Asset',
      image: 'primary-image',
      emotionImages: [['smile', 'asset-0-070809']],
      additionalAssets: [['bonus', 'asset-1-01030507', 'webp']],
    })

    const progress = alertState.alertStoreSet.mock.calls
      .map(([entry]) => entry)
      .filter((entry) => entry.type === 'progress')
      .map((entry) => [entry.msg, entry.submsg])

    expect(progress).toEqual([
      ['Loading... (Loading Assets)', '0.00'],
      ['Loading... (Loading Assets)', '50.00'],
      ['Loading... (Saving Assets)', '0.00'],
      ['Loading... (Assets)', '0.00'],
      ['Loading... (Assets)', '50.00'],
    ])
    expect(alertState.alertNormal).toHaveBeenCalledWith('Imported character')
  })

  it('creates PNG card starter chats without generationSettings', async () => {
    const fixture = await createPngCardFixture({
      risuaiExtension: {
        generationSettings: {
          configured: true,
          personaId: 'source-persona',
          presetId: 'source-preset',
          jailbreakToggle: true,
          sidebarToggles: { mode: 'source' },
        },
      },
    })

    await importCharacterProcess({
      name: 'source-generation-settings.png',
      data: fixture.png,
    })

    const chat = dbState.db.characters[0].chats[0]
    expect(chat).toMatchObject({
      message: [],
      note: '',
      name: 'Chat 1',
      localLore: [],
    })
    expect(chat).not.toHaveProperty('generationSettings')
  })
})

async function createPngCardFixture(
  options: { risuaiExtension?: Record<string, unknown> } = {},
) {
  const assetPayloads = [new Uint8Array([7, 8, 9]), new Uint8Array([1, 3, 5, 7])]
  const assetBase64Values = assetPayloads.map((asset) => Buffer.from(asset).toString('base64'))
  const card = {
    spec: 'chara_card_v3',
    data: {
      name: 'PNG Multi Asset',
      description: 'desc',
      first_mes: 'hello',
      mes_example: '',
      personality: '',
      scenario: '',
      creator_notes: '',
      system_prompt: '',
      post_history_instructions: '',
      alternate_greetings: [],
      tags: [],
      creator: '',
      character_version: '1',
      extensions: {
        risuai: options.risuaiExtension ?? {},
      },
      assets: [
        {
          type: 'emotion',
          uri: '__asset:1',
          name: 'smile',
          ext: 'png',
        },
        {
          type: 'x-risu-asset',
          uri: '__asset:2',
          name: 'bonus',
          ext: 'webp',
        },
      ],
    },
  }
  const chunks = {
    'chara-ext-asset_:1': assetBase64Values[0],
    'chara-ext-asset_:2': assetBase64Values[1],
    ccv3: Buffer.from(JSON.stringify(card)).toString('base64'),
  }
  const png = await PngChunk.write(BASE_PNG, chunks)
  if (!png) {
    throw new Error('failed to build PNG fixture')
  }

  return {
    assetBase64Values,
    assetChunkTexts: [
      `chara-ext-asset_:1\u0000${assetBase64Values[0]}`,
      `chara-ext-asset_:2\u0000${assetBase64Values[1]}`,
    ],
    assetPayloads,
    png: new Uint8Array(png),
  }
}

function installPngReadCounters(assetChunkTexts: string[], assetBase64Values: string[]) {
  const RealTextDecoder = globalThis.TextDecoder
  const realDecoder = new RealTextDecoder()
  const valueDecodeCounts = new Map(assetBase64Values.map((value) => [value, 0]))
  const chunkSliceCounts = new Map(assetChunkTexts.map((value) => [value, 0]))

  class CountingTextDecoder extends RealTextDecoder {
    decode(input?: Parameters<TextDecoder['decode']>[0], options?: TextDecodeOptions): string {
      const value = super.decode(input, options)
      if (valueDecodeCounts.has(value)) {
        valueDecodeCounts.set(value, valueDecodeCounts.get(value)! + 1)
      }
      return value
    }
  }

  vi.stubGlobal('TextDecoder', CountingTextDecoder)

  const originalSlice = Uint8Array.prototype.slice
  const sliceSpy = vi
    .spyOn(Uint8Array.prototype, 'slice')
    .mockImplementation(function (this: Uint8Array, start?: number, end?: number): Uint8Array {
      const result = originalSlice.call(this, start, end)
      const value = realDecoder.decode(result)
      if (chunkSliceCounts.has(value)) {
        chunkSliceCounts.set(value, chunkSliceCounts.get(value)! + 1)
      }
      return result
    })

  return {
    chunkSliceCounts,
    valueDecodeCounts,
    restore() {
      sliceSpy.mockRestore()
      vi.unstubAllGlobals()
    },
  }
}
