import { beforeEach, describe, expect, it, vi } from 'vitest'

const platformState = vi.hoisted(() => ({ isFastifyServer: true }))
const selectedFileState = vi.hoisted(() => ({
  file: null as null | { name: string; data: Uint8Array },
}))

const alertModuleSelect = vi.hoisted(() => vi.fn())
const alertNormal = vi.hoisted(() => vi.fn())
const alertError = vi.hoisted(() => vi.fn())
const saveAsset = vi.hoisted(() => vi.fn())
const createGlobalModule = vi.hoisted(() => vi.fn())
const getCurrentCharacter = vi.hoisted(() => vi.fn())
const getDatabase = vi.hoisted(() => vi.fn(() => ({ modules: [] })))
const dispatchReplaceCharacterLorebooks = vi.hoisted(() => vi.fn())
const dispatchReplaceCharacterScripts = vi.hoisted(() => vi.fn())
const dispatchReplaceCharacterTriggers = vi.hoisted(() => vi.fn())

vi.mock('../platform', () => ({
  get isFastifyServer() {
    return platformState.isFastifyServer
  },
}))

vi.mock('../alert', () => ({
  alertClear: vi.fn(),
  alertConfirm: vi.fn(),
  alertError,
  alertModuleSelect,
  alertNormal,
  alertStore: { set: vi.fn() },
  alertWait: vi.fn(),
}))

vi.mock('../storage/database.svelte', () => ({
  getCurrentCharacter,
  getCurrentChat: vi.fn(),
  getDatabase,
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
  createGlobalModule,
}))

vi.mock('../server/lorebookBridge.svelte', () => ({
  currentLorebookStateSnapshot: vi.fn(() => ({ loreBook: [], characters: [], modules: [] })),
  dispatchReplaceCharacterLorebooks,
}))

vi.mock('../server/scriptDefinitionBridge.svelte', () => ({
  currentScriptDefinitionStateSnapshot: vi.fn(() => ({ characters: [], modules: [] })),
  dispatchReplaceCharacterScripts,
  dispatchReplaceCharacterTriggers,
}))

import { applyModule, importModule } from './modules'
import { DBState } from '../stores.svelte'

describe('module imports', () => {
  beforeEach(() => {
    platformState.isFastifyServer = true
    selectedFileState.file = null
    alertError.mockClear()
    saveAsset.mockClear()
    createGlobalModule.mockClear()
    alertModuleSelect.mockReset()
    alertNormal.mockClear()
    getCurrentCharacter.mockReset()
    getDatabase.mockReset()
    getDatabase.mockReturnValue({ modules: [] })
    dispatchReplaceCharacterLorebooks.mockClear()
    dispatchReplaceCharacterScripts.mockClear()
    dispatchReplaceCharacterTriggers.mockClear()
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
    expect(createGlobalModule).not.toHaveBeenCalled()
  })

  it('routes JSON module imports through the global module command helper', async () => {
    selectedFileState.file = {
      name: 'module.json',
      data: Buffer.from(
        JSON.stringify({
          type: 'risuModule',
          id: 'old-id',
          name: 'Imported module',
          description: 'Imported',
        }),
      ),
    }

    await importModule()

    expect(createGlobalModule).toHaveBeenCalledWith(
      expect.objectContaining({
        id: expect.any(String),
        name: 'Imported module',
        description: 'Imported',
      }),
    )
  })

  it('routes module apply through character child replacement commands', async () => {
    alertModuleSelect.mockResolvedValue('mod-a')
    const character = {
      chaId: 'char-a',
      globalLore: [{ comment: 'Existing lore', content: 'old' }],
      customscript: [{ comment: 'Existing regex', in: 'old', out: 'old' }],
      triggerscript: [{ comment: 'Existing trigger', type: 'manual', conditions: [], effect: [] }],
    }
    DBState.db.characters = [character]
    getCurrentCharacter.mockReturnValue(character)
    getDatabase.mockReturnValue({
      modules: [
        {
          id: 'mod-a',
          name: 'Module A',
          description: '',
          lorebook: [{ comment: 'Module lore', content: 'lore' }],
          regex: [{ comment: 'Module regex', in: 'in', out: 'out' }],
          trigger: [{ comment: 'Module trigger', type: 'manual', conditions: [], effect: [] }],
        },
      ],
    })

    await applyModule()

    expect(dispatchReplaceCharacterLorebooks).toHaveBeenCalledWith(
      'char-a',
      [
        { comment: 'Existing lore', content: 'old' },
        { comment: 'Module lore', content: 'lore' },
      ],
      expect.anything(),
      0,
    )
    expect(dispatchReplaceCharacterScripts).toHaveBeenCalledWith(
      'char-a',
      [
        { comment: 'Existing regex', in: 'old', out: 'old' },
        { comment: 'Module regex', in: 'in', out: 'out' },
      ],
      expect.anything(),
      0,
    )
    expect(dispatchReplaceCharacterTriggers).toHaveBeenCalledWith(
      'char-a',
      [
        { comment: 'Existing trigger', type: 'manual', conditions: [], effect: [] },
        { comment: 'Module trigger', type: 'manual', conditions: [], effect: [] },
      ],
      expect.anything(),
      0,
    )
    expect(alertNormal).toHaveBeenCalled()
  })
})
