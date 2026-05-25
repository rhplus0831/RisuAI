import { beforeEach, describe, expect, it, vi } from 'vitest'

const platformState = vi.hoisted(() => ({ isFastifyServer: true }))
const selectedFileState = vi.hoisted(() => ({
  file: null as null | { name: string; data: Uint8Array },
}))

const alertError = vi.hoisted(() => vi.fn())
const saveAsset = vi.hoisted(() => vi.fn())
const dispatchCreateModule = vi.hoisted(() => vi.fn())

vi.mock('../platform', () => ({
  get isFastifyServer() {
    return platformState.isFastifyServer
  },
}))

vi.mock('../alert', () => ({
  alertClear: vi.fn(),
  alertConfirm: vi.fn(),
  alertError,
  alertModuleSelect: vi.fn(),
  alertNormal: vi.fn(),
  alertStore: { set: vi.fn() },
  alertWait: vi.fn(),
}))

vi.mock('../storage/database.svelte', () => ({
  getCurrentCharacter: vi.fn(),
  getCurrentChat: vi.fn(),
  getDatabase: vi.fn(() => ({ modules: [] })),
  setCurrentCharacter: vi.fn(),
  setDatabase: vi.fn(),
}))

vi.mock('../globalApi.svelte', () => ({
  AppendableBuffer: class {
    buffer = new Uint8Array()
    append = vi.fn()
  },
  downloadFile: vi.fn(),
  forageStorage: {},
  readImage: vi.fn(),
  saveAsset,
}))

vi.mock('../util', () => ({
  selectSingleFile: vi.fn(async () => selectedFileState.file),
  sleep: vi.fn(),
}))

vi.mock('./lorebook.svelte', () => ({
  convertExternalLorebook: vi.fn(() => []),
}))

vi.mock('../media', () => ({
  compressImage: vi.fn(async (data: Uint8Array) => data),
}))

vi.mock('../rpack/rpack_js', () => ({
  decodeRPack: vi.fn(async (data: Uint8Array) => data),
  encodeRPack: vi.fn(async (data: Uint8Array) => data),
}))

vi.mock('../stores.svelte', () => ({
  DBState: { db: { modules: [] } },
  HideIconStore: { set: vi.fn() },
  moduleBackgroundEmbedding: { set: vi.fn() },
  ReloadGUIPointer: { set: vi.fn() },
}))

vi.mock('../moduleCommands', () => ({
  currentModuleStateSnapshot: vi.fn(() => ({ modules: [], enabledModules: [], characters: [] })),
  dispatchCreateModule,
}))

import { importModule } from './modules'

describe('module imports', () => {
  beforeEach(() => {
    platformState.isFastifyServer = true
    selectedFileState.file = null
    alertError.mockClear()
    saveAsset.mockClear()
    dispatchCreateModule.mockClear()
  })

  it('rejects .risum import before client-side asset decoding in Fastify mode', async () => {
    selectedFileState.file = {
      name: 'module.risum',
      data: new Uint8Array([111, 0, 0, 0]),
    }

    await importModule()

    expect(alertError).toHaveBeenCalledWith(
      'Module file import is not supported in server-backed web mode yet',
    )
    expect(saveAsset).not.toHaveBeenCalled()
    expect(dispatchCreateModule).not.toHaveBeenCalled()
  })
})
