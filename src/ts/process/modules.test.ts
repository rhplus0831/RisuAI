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
type ModuleDatabaseFixture = {
  enabledModules?: string[]
  moduleIntergration?: string
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

import { applyModule, getModuleTriggers, importModule, refreshModules } from './modules'
import { DBState } from '../stores.svelte'
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
    getDatabase.mockReset()
    getDatabase.mockReturnValue({ modules: [] })
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
