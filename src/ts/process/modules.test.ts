import { beforeEach, describe, expect, it, vi } from 'vitest'

const selectedFileState = vi.hoisted(() => ({
  file: null as null | { name: string; data: Uint8Array },
}))

const alertModuleSelect = vi.hoisted(() => vi.fn())
const alertNormal = vi.hoisted(() => vi.fn())
const alertError = vi.hoisted(() => vi.fn())
const saveAsset = vi.hoisted(() => vi.fn())
const createGlobalModule = vi.hoisted(() => vi.fn())
const getCurrentCharacter = vi.hoisted(() => vi.fn())
const getCurrentChatMock = vi.hoisted(() => vi.fn())
type ModuleDatabaseFixture = {
  enabledModules?: string[]
  moduleIntergration?: string
  promptPresets?: Array<Record<string, unknown>>
  modules: Array<Record<string, unknown>>
}
const getDatabase = vi.hoisted(() => vi.fn((): ModuleDatabaseFixture => ({ modules: [] })))
const dispatchReplaceCharacterLorebooks = vi.hoisted(() => vi.fn())
const dispatchReplaceCharacterScripts = vi.hoisted(() => vi.fn())
const dispatchReplaceCharacterTriggers = vi.hoisted(() => vi.fn())
const ensureClientLorebookEntryIds = vi.hoisted(() => vi.fn((entries: unknown) => entries))
const restoreLorebookState = vi.hoisted(() => vi.fn())
const ensureClientScriptDefinitionIds = vi.hoisted(() => vi.fn((scripts: unknown) => scripts))
const ensureClientTriggerDefinitionIds = vi.hoisted(() => vi.fn((triggers: unknown) => triggers))
const restoreScriptDefinitionState = vi.hoisted(() => vi.fn())
const replaceCharacterLorebooksCommand = vi.hoisted(() => vi.fn(async () => ({ status: 'ok', revision: 1, data: {} })))
const replaceCharacterScriptsCommand = vi.hoisted(() => vi.fn(async () => ({ status: 'ok', revision: 2, data: {} })))
const replaceCharacterTriggersCommand = vi.hoisted(() => vi.fn(async () => ({ status: 'ok', revision: 3, data: {} })))
const runOptimisticCommandSequence = vi.hoisted(() =>
  vi.fn((commands: Array<(rev: number) => Promise<unknown>>, _rollback: () => void) => {
    void (async () => {
      let rev = 0
      for (const command of commands) {
        await command(rev)
        rev += 1
      }
    })()
  }),
)

vi.mock('../platform', () => ({
  isFastifyServer: true,
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
  getCurrentChat: getCurrentChatMock,
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
  reloadGuiAfterDefinitionChange: vi.fn(),
}))

vi.mock('../moduleCommands', () => ({
  createGlobalModule,
}))

vi.mock('../server/lorebookBridge.svelte', () => ({
  currentLorebookStateSnapshot: vi.fn(() => ({ loreBook: [], characters: [], modules: [] })),
  dispatchReplaceCharacterLorebooks,
  ensureClientLorebookEntryIds,
  restoreLorebookState,
}))

vi.mock('../server/scriptDefinitionBridge.svelte', () => ({
  currentScriptDefinitionStateSnapshot: vi.fn(() => ({ characters: [], modules: [] })),
  dispatchReplaceCharacterScripts,
  dispatchReplaceCharacterTriggers,
  ensureClientScriptDefinitionIds,
  ensureClientTriggerDefinitionIds,
  restoreScriptDefinitionState,
}))

vi.mock('../chatCommands', () => ({
  runOptimisticCommandSequence,
}))

vi.mock('../server/commands', () => ({
  replaceCharacterLorebooksCommand,
  replaceCharacterScriptsCommand,
  replaceCharacterTriggersCommand,
}))

vi.mock('../server/projectionWriteGuard.svelte', () => ({
  withTrustedServerProjectionWrite: (fn: () => void) => fn(),
}))

import {
  applyModule,
  getModuleRegexScripts,
  getModuleTriggers,
  importModule,
  moduleUpdate,
  refreshModules,
} from './modules'
import { DBState, moduleBackgroundEmbedding } from '../stores.svelte'
import type { character } from '../storage/database.svelte'

describe('module imports', () => {
  beforeEach(() => {
    selectedFileState.file = null
    alertError.mockClear()
    saveAsset.mockClear()
    createGlobalModule.mockClear()
    alertModuleSelect.mockReset()
    alertNormal.mockClear()
    getCurrentCharacter.mockReset()
    getCurrentChatMock.mockReset()
    getDatabase.mockReset()
    getDatabase.mockReturnValue({ modules: [] })
    vi.mocked(moduleBackgroundEmbedding.set).mockClear()
    dispatchReplaceCharacterLorebooks.mockClear()
    dispatchReplaceCharacterScripts.mockClear()
    dispatchReplaceCharacterTriggers.mockClear()
    refreshModules()
  })

  it('rejects .risum import before client-side asset decoding in Fastify mode', async () => {
    selectedFileState.file = {
      name: 'module.risum',
      data: new Uint8Array([111, 0, 0, 0]),
    }

    await importModule()

    expect(alertError).toHaveBeenCalledWith('Module file import is not supported in server-backed web mode yet')
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
    } as unknown as character
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
    // The sequencer is fire-and-forget; let microtasks settle.
    await new Promise((resolve) => setTimeout(resolve, 0))

    // applyModule serializes its three child-replacement commands via
    // runOptimisticCommandSequence. Assert the sequencer received factories that
    // build the three commands with the merged arrays.
    expect(runOptimisticCommandSequence).toHaveBeenCalledTimes(1)
    const [factories] = runOptimisticCommandSequence.mock.calls[0]
    expect(factories).toHaveLength(3)

    await factories[0](10)
    expect(replaceCharacterLorebooksCommand).toHaveBeenCalledWith({
      baseRevision: 10,
      characterId: 'char-a',
      entries: [
        { comment: 'Existing lore', content: 'old' },
        { comment: 'Module lore', content: 'lore' },
      ],
    })
    await factories[1](11)
    expect(replaceCharacterScriptsCommand).toHaveBeenCalledWith({
      baseRevision: 11,
      characterId: 'char-a',
      scripts: [
        { comment: 'Existing regex', in: 'old', out: 'old' },
        { comment: 'Module regex', in: 'in', out: 'out' },
      ],
    })
    await factories[2](12)
    expect(replaceCharacterTriggersCommand).toHaveBeenCalledWith({
      baseRevision: 12,
      characterId: 'char-a',
      triggers: [
        { comment: 'Existing trigger', type: 'manual', conditions: [], effect: [] },
        { comment: 'Module trigger', type: 'manual', conditions: [], effect: [] },
      ],
    })
    expect(alertNormal).toHaveBeenCalled()
  })

  it('refreshes active module triggers when module rows are replaced under the same enabled namespace', () => {
    const db = {
      enabledModules: [],
      moduleIntergration: 'aos-ns',
      modules: [
        {
          id: 'module-a',
          name: 'AOS Module',
          namespace: 'aos-ns',
          trigger: [
            {
              comment: '',
              type: 'start',
              conditions: [],
              effect: [{ type: 'triggerlua', code: 'old triggerlua' }],
            },
          ],
        },
      ],
    }
    getDatabase.mockReturnValue(db)

    expect(getModuleTriggers()[0]?.effect?.[0]).toMatchObject({
      type: 'triggerlua',
      code: 'old triggerlua',
    })

    db.modules = [
      {
        id: 'module-a',
        name: 'AOS Module',
        namespace: 'aos-ns',
        trigger: [
          {
            comment: '',
            type: 'start',
            conditions: [],
            effect: [{ type: 'triggerlua', code: 'new triggerlua with AOS' }],
          },
        ],
      },
    ]

    expect(getModuleTriggers()[0]?.effect?.[0]).toMatchObject({
      type: 'triggerlua',
      code: 'new triggerlua with AOS',
    })
  })

  it('refreshes module background embedding when an active module row is replaced in place', () => {
    const db = {
      enabledModules: ['module-a'],
      moduleIntergration: '',
      modules: [
        {
          id: 'module-a',
          name: 'Module A',
          description: '',
          backgroundEmbedding: '<style>.chattext .name { color: red; }</style>',
        },
      ],
    }
    getDatabase.mockReturnValue(db)

    moduleUpdate()
    expect(moduleBackgroundEmbedding.set).toHaveBeenLastCalledWith('\n<style>.chattext .name { color: red; }</style>\n')

    vi.mocked(moduleBackgroundEmbedding.set).mockClear()
    db.modules[0] = {
      id: 'module-a',
      name: 'Module A',
      description: '',
      backgroundEmbedding: '<style>.chattext .name { color: blue; }</style>',
    }

    moduleUpdate()
    expect(moduleBackgroundEmbedding.set).toHaveBeenLastCalledWith(
      '\n<style>.chattext .name { color: blue; }</style>\n',
    )
  })

  it('clears module background embedding when active modules no longer provide one', () => {
    const db = {
      enabledModules: ['module-a'],
      moduleIntergration: '',
      modules: [
        {
          id: 'module-a',
          name: 'Module A',
          description: '',
          backgroundEmbedding: '<style>.chattext .name { color: red; }</style>',
        },
      ],
    }
    getDatabase.mockReturnValue(db)

    moduleUpdate()
    expect(moduleBackgroundEmbedding.set).toHaveBeenLastCalledWith('\n<style>.chattext .name { color: red; }</style>\n')

    vi.mocked(moduleBackgroundEmbedding.set).mockClear()
    db.modules[0] = {
      id: 'module-a',
      name: 'Module A',
      description: '',
      backgroundEmbedding: '',
    }

    moduleUpdate()
    expect(moduleBackgroundEmbedding.set).toHaveBeenLastCalledWith('')
  })

  it('resolves module regex from the active chat selected prompt preset integration', () => {
    getCurrentChatMock.mockReturnValue({
      modules: [],
      generationSettings: {
        promptPresetId: 'chat-preset',
      },
    })
    getCurrentCharacter.mockReturnValue({ modules: [] })
    getDatabase.mockReturnValue({
      enabledModules: [],
      moduleIntergration: 'global-space',
      promptPresets: [
        { id: 'global-preset', moduleIntergration: 'global-space' },
        { id: 'chat-preset', moduleIntergration: 'chat-space' },
      ],
      modules: [
        {
          id: 'global-module',
          namespace: 'global-space',
          regex: [{ comment: 'global regex', in: 'GLOBAL', out: 'global', type: 'editdisplay' }],
        },
        {
          id: 'chat-module',
          namespace: 'chat-space',
          regex: [{ comment: 'chat regex', in: 'CHAT', out: 'chat', type: 'editdisplay' }],
        },
      ],
    })

    expect(getModuleRegexScripts().map((script) => script.comment)).toEqual(['chat regex'])
  })

  it('does not use global prompt integration when the active chat selected prompt has none', () => {
    getCurrentChatMock.mockReturnValue({
      modules: [],
      generationSettings: {
        promptPresetId: 'plain-preset',
      },
    })
    getCurrentCharacter.mockReturnValue({ modules: [] })
    getDatabase.mockReturnValue({
      enabledModules: [],
      moduleIntergration: 'global-space',
      promptPresets: [{ id: 'plain-preset' }],
      modules: [
        {
          id: 'global-module',
          namespace: 'global-space',
          regex: [{ comment: 'global regex', in: 'GLOBAL', out: 'global', type: 'editdisplay' }],
        },
      ],
    })

    expect(getModuleRegexScripts()).toEqual([])
  })

  it('keeps active module cache keys collision-safe for hyphenated ids', () => {
    const db = {
      enabledModules: ['a-b', 'c'],
      moduleIntergration: '',
      modules: [
        {
          id: 'a-b',
          regex: [{ comment: 'first-a-b', in: 'A', out: 'a', type: 'editdisplay' }],
        },
        {
          id: 'c',
          regex: [{ comment: 'first-c', in: 'C', out: 'c', type: 'editdisplay' }],
        },
        {
          id: 'a',
          regex: [{ comment: 'second-a', in: 'A', out: 'a', type: 'editdisplay' }],
        },
        {
          id: 'b-c',
          regex: [{ comment: 'second-b-c', in: 'B', out: 'b', type: 'editdisplay' }],
        },
      ],
    }
    getDatabase.mockReturnValue(db)

    expect(getModuleRegexScripts().map((script) => script.comment)).toEqual(['first-a-b', 'first-c'])

    db.enabledModules = ['a', 'b-c']

    expect(getModuleRegexScripts().map((script) => script.comment)).toEqual(['second-a', 'second-b-c'])
  })

  it('does not mutate module trigger rows when attaching low-level access metadata', () => {
    const trigger = Object.freeze({
      comment: 'readonly trigger',
      type: 'start',
      conditions: [],
      effect: [{ type: 'triggerlua', code: 'return "ok"' }],
    })
    getDatabase.mockReturnValue({
      enabledModules: ['module-a'],
      modules: [
        {
          id: 'module-a',
          name: 'Readonly Module',
          description: '',
          lowLevelAccess: true,
          trigger: [trigger],
        },
      ],
    })

    const [resolvedTrigger] = getModuleTriggers()

    expect(resolvedTrigger).not.toBe(trigger)
    expect(resolvedTrigger).toMatchObject({
      comment: 'readonly trigger',
      lowLevelAccess: true,
    })
    expect('lowLevelAccess' in trigger).toBe(false)
  })
})
