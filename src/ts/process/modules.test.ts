import { beforeEach, describe, expect, it, vi } from 'vitest'

const selectedFileState = vi.hoisted(() => ({
  file: null as null | { name: string; data: Uint8Array },
}))

const alertModuleSelect = vi.hoisted(() => vi.fn())
const alertNormal = vi.hoisted(() => vi.fn())
const alertError = vi.hoisted(() => vi.fn())
const alertConfirm = vi.hoisted(() => vi.fn())
const saveAsset = vi.hoisted(() => vi.fn())
const saveAssets = vi.hoisted(() => vi.fn())
const createGlobalModule = vi.hoisted(() => vi.fn())
const getCurrentCharacter = vi.hoisted(() => vi.fn())
const getCurrentChatMock = vi.hoisted(() => vi.fn())
type ModuleDatabaseFixture = {
  characters?: unknown[]
  enabledModules?: string[]
  moduleIntergration?: string
  promptPresets?: Array<Record<string, unknown>>
  modules: Array<Record<string, unknown>>
}
const getDatabase = vi.hoisted(() => vi.fn((): ModuleDatabaseFixture => ({ modules: [] })))
const dispatchReplaceCharacterLorebooks = vi.hoisted(() => vi.fn())
const dispatchReplaceCharacterScripts = vi.hoisted(() => vi.fn())
const dispatchReplaceCharacterTriggers = vi.hoisted(() => vi.fn())
const currentLorebookCollectionScopedSnapshot = vi.hoisted(() => vi.fn())
const ensureClientLorebookEntryIds = vi.hoisted(() => vi.fn((entries: unknown) => entries))
const isCharacterLorebookHydrated = vi.hoisted(() => vi.fn(() => true))
const restoreLorebookState = vi.hoisted(() => vi.fn())
const rollbackCharacterLorebookReplacement = vi.hoisted(() => vi.fn())
const ensureClientScriptDefinitionIds = vi.hoisted(() => vi.fn((scripts: unknown) => scripts))
const ensureClientTriggerDefinitionIds = vi.hoisted(() => vi.fn((triggers: unknown) => triggers))
const restoreScriptDefinitionState = vi.hoisted(() => vi.fn())
const rollbackScopedScriptDefinitionReplacement = vi.hoisted(() => vi.fn())
const replaceCharacterLorebooksCommand = vi.hoisted(() => vi.fn(async () => ({ status: 'ok', revision: 1, data: {} })))
const replaceCharacterScriptsCommand = vi.hoisted(() => vi.fn(async () => ({ status: 'ok', revision: 2, data: {} })))
const replaceCharacterTriggersCommand = vi.hoisted(() => vi.fn(async () => ({ status: 'ok', revision: 3, data: {} })))
const runOptimisticCommandSequence = vi.hoisted(() => vi.fn())
const testDatabaseState: { db: Record<string, any> } = {
  db: { modules: [], characters: [] },
}

vi.mock('../platform', () => ({
  isFastifyServer: true,
}))

vi.mock('../alert', () => ({
  alertClear: vi.fn(),
  alertConfirm,
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
  saveAssets,
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
  currentLorebookCollectionScopedSnapshot,
  dispatchReplaceCharacterLorebooks,
  ensureClientLorebookEntryIds,
  isCharacterLorebookHydrated,
  restoreLorebookState,
  rollbackCharacterLorebookReplacement,
}))

vi.mock('../server/scriptDefinitionBridge.svelte', () => ({
  currentScriptDefinitionStateSnapshot: vi.fn(() => ({ characters: [], modules: [] })),
  dispatchReplaceCharacterScripts,
  dispatchReplaceCharacterTriggers,
  ensureClientScriptDefinitionIds,
  ensureClientTriggerDefinitionIds,
  restoreScriptDefinitionState,
  rollbackScopedScriptDefinitionReplacement,
}))

vi.mock('../chatCommands', () => ({
  runOptimisticCommandSequence,
}))

vi.mock('../server/commands', () => ({
  replaceCharacterLorebooksCommand,
  replaceCharacterScriptsCommand,
  replaceCharacterTriggersCommand,
}))

vi.mock('../server/resourceWriteGuard.svelte', () => ({
  withTrustedResourceWrite: (fn: () => void) => fn(),
}))

import {
  applyModule,
  getModuleRegexScripts,
  getModuleTriggers,
  importModule,
  moduleUpdate,
  refreshModules,
} from './modules'
import { moduleBackgroundEmbedding } from '../stores.svelte'
import type { character } from '../storage/database.svelte'
import { language } from 'src/lang'

function buildRisum(module: Record<string, unknown>, assets: readonly Uint8Array[] = []): Uint8Array {
  const main = Buffer.from(
    JSON.stringify({
      type: 'risuModule',
      module,
    }),
  )
  const header = Buffer.alloc(6)
  header.writeUInt8(111, 0)
  header.writeUInt8(0, 1)
  header.writeUInt32LE(main.length, 2)
  const chunks = [header, main]
  for (const asset of assets) {
    const assetLength = Buffer.alloc(4)
    assetLength.writeUInt32LE(asset.length, 0)
    chunks.push(Buffer.from([1]), assetLength, Buffer.from(asset))
  }
  chunks.push(Buffer.from([0]))
  return Buffer.concat(chunks)
}

function cloneJsonValue<T>(value: T): T {
  if (value === undefined) return value
  return JSON.parse(JSON.stringify(value)) as T
}

function snapshotJson(value: unknown): string {
  const snapshot = JSON.stringify(value)
  return snapshot === undefined ? '__undefined__' : snapshot
}

function characterById(characterId: string): Record<string, unknown> | undefined {
  return (testDatabaseState.db.characters as unknown as Array<Record<string, unknown>> | undefined)?.find(
    (candidate) => candidate.chaId === characterId,
  )
}

function installAttemptAwareRollbackMocks(): void {
  currentLorebookCollectionScopedSnapshot.mockImplementation(({ characterId }: { characterId: string }) => {
    const character = characterById(characterId)
    return {
      scopeKey: `character:${characterId}`,
      scopedValue: cloneJsonValue((character?.globalLore as unknown[]) ?? []),
      loreBook: cloneJsonValue(testDatabaseState.db.loreBook ?? []),
      loreBookPage: testDatabaseState.db.loreBookPage ?? 0,
      characters: cloneJsonValue(testDatabaseState.db.characters ?? []),
      modules: cloneJsonValue(testDatabaseState.db.modules ?? []),
      selectedCharID: 0,
    }
  })
  rollbackCharacterLorebookReplacement.mockImplementation(
    (characterId: string, snapshot: { scopedValue?: unknown }, attemptedEntries: unknown[]) => {
      const character = characterById(characterId)
      if (!character || snapshotJson(character.globalLore ?? []) !== snapshotJson(attemptedEntries)) return
      character.globalLore = cloneJsonValue(snapshot.scopedValue ?? [])
    },
  )
  rollbackScopedScriptDefinitionReplacement.mockImplementation(
    (
      rollback:
        | {
            kind: 'characterScripts'
            characterId: string
            scripts: unknown[]
            hadScriptsField?: boolean
          }
        | {
            kind: 'characterTriggers'
            characterId: string
            triggers: unknown[]
            hadTriggersField?: boolean
          },
      attempted:
        | { kind: 'characterScripts'; characterId: string; scripts: unknown[] }
        | { kind: 'characterTriggers'; characterId: string; triggers: unknown[] },
    ) => {
      const character = characterById(rollback.characterId)
      if (!character || rollback.kind !== attempted.kind || rollback.characterId !== attempted.characterId) return
      if (rollback.kind === 'characterScripts') {
        if (attempted.kind !== 'characterScripts') return
        if (snapshotJson(character.customscript) !== snapshotJson(attempted.scripts)) return
        if (rollback.hadScriptsField === false) {
          delete character.customscript
        } else {
          character.customscript = cloneJsonValue(rollback.scripts)
        }
        return
      }
      if (attempted.kind !== 'characterTriggers') return
      if (snapshotJson(character.triggerscript) !== snapshotJson(attempted.triggers)) return
      if (rollback.hadTriggersField === false) {
        delete character.triggerscript
      } else {
        character.triggerscript = cloneJsonValue(rollback.triggers)
      }
    },
  )
}

describe('module imports', () => {
  beforeEach(() => {
    selectedFileState.file = null
    testDatabaseState.db = { modules: [], characters: [] }
    alertError.mockClear()
    saveAsset.mockClear()
    saveAssets.mockReset()
    saveAssets.mockImplementation(async (assets: readonly unknown[]) => assets.map((_, index) => `asset-${index}`))
    createGlobalModule.mockClear()
    alertConfirm.mockReset()
    alertConfirm.mockResolvedValue(true)
    alertModuleSelect.mockReset()
    alertNormal.mockClear()
    getCurrentCharacter.mockReset()
    getCurrentChatMock.mockReset()
    getDatabase.mockReset()
    getDatabase.mockReturnValue({ modules: [] })
    runOptimisticCommandSequence.mockClear()
    replaceCharacterLorebooksCommand.mockReset()
    replaceCharacterLorebooksCommand.mockResolvedValue({ status: 'ok', revision: 1, data: {} })
    replaceCharacterScriptsCommand.mockReset()
    replaceCharacterScriptsCommand.mockResolvedValue({ status: 'ok', revision: 2, data: {} })
    replaceCharacterTriggersCommand.mockReset()
    replaceCharacterTriggersCommand.mockResolvedValue({ status: 'ok', revision: 3, data: {} })
    currentLorebookCollectionScopedSnapshot.mockReset()
    ensureClientLorebookEntryIds.mockReset()
    ensureClientLorebookEntryIds.mockImplementation((entries: unknown) => entries)
    isCharacterLorebookHydrated.mockReset()
    isCharacterLorebookHydrated.mockReturnValue(true)
    rollbackCharacterLorebookReplacement.mockReset()
    ensureClientScriptDefinitionIds.mockReset()
    ensureClientScriptDefinitionIds.mockImplementation((scripts: unknown) => scripts)
    ensureClientTriggerDefinitionIds.mockReset()
    ensureClientTriggerDefinitionIds.mockImplementation((triggers: unknown) => triggers)
    rollbackScopedScriptDefinitionReplacement.mockReset()
    installAttemptAwareRollbackMocks()
    vi.mocked(moduleBackgroundEmbedding.set).mockClear()
    dispatchReplaceCharacterLorebooks.mockClear()
    dispatchReplaceCharacterScripts.mockClear()
    dispatchReplaceCharacterTriggers.mockClear()
    refreshModules()
  })

  it('imports ordinary .risum modules through asset upload and module command helpers', async () => {
    const assetData = new Uint8Array([7, 8, 9])
    selectedFileState.file = {
      name: 'module.risum',
      data: buildRisum(
        {
          id: 'old-id',
          name: 'Imported module',
          description: 'Imported',
          assets: [['portrait', '', 'portrait.webp']],
        },
        [assetData],
      ),
    }

    await importModule()

    expect(saveAssets).toHaveBeenCalledWith([{ data: Buffer.from(assetData), fileName: 'portrait.webp' }])
    expect(createGlobalModule).toHaveBeenCalledWith(
      expect.objectContaining({
        id: expect.not.stringMatching(/^old-id$/),
        name: 'Imported module',
        description: 'Imported',
        assets: [['portrait', 'asset-0', 'portrait.webp']],
      }),
    )
    expect(alertNormal).toHaveBeenCalled()
  })

  it('imports .risum asset tuples with a null filename slot using empty filename fallback', async () => {
    const assetData = new Uint8Array([1, 2, 3])
    selectedFileState.file = {
      name: 'module.risum',
      data: buildRisum(
        {
          id: 'old-id',
          name: 'Imported module',
          description: 'Imported',
          assets: [['portrait', '', null]],
        },
        [assetData],
      ),
    }

    await importModule()

    expect(saveAssets).toHaveBeenCalledWith([{ data: Buffer.from(assetData), fileName: '' }])
    expect(createGlobalModule).toHaveBeenCalledWith(
      expect.objectContaining({
        name: 'Imported module',
        assets: [['portrait', 'asset-0', '']],
      }),
    )
  })

  it('infers upload extension for legacy .risum asset filename tokens', async () => {
    const avifData = new Uint8Array([
      0x00, 0x00, 0x00, 0x18, 0x66, 0x74, 0x79, 0x70, 0x61, 0x76, 0x69, 0x66, 0x00, 0x00, 0x00, 0x00,
    ])
    selectedFileState.file = {
      name: 'module.risum',
      data: buildRisum(
        {
          id: 'old-id',
          name: 'Imported module',
          description: 'Imported',
          assets: [['portrait', '', '1']],
        },
        [avifData],
      ),
    }

    await importModule()

    expect(saveAssets).toHaveBeenCalledWith([{ data: Buffer.from(avifData), fileName: 'asset.avif' }])
    expect(createGlobalModule).toHaveBeenCalledWith(
      expect.objectContaining({
        name: 'Imported module',
        assets: [['portrait', 'asset-0', '1']],
      }),
    )
  })

  it('cancels low-level .risum import before asset upload or module creation', async () => {
    alertConfirm.mockResolvedValue(false)
    selectedFileState.file = {
      name: 'module.risum',
      data: buildRisum(
        {
          id: 'old-id',
          name: 'Low level module',
          description: 'Imported',
          lowLevelAccess: true,
          assets: [['portrait', '', 'portrait.webp']],
        },
        [new Uint8Array([7, 8, 9])],
      ),
    }

    await importModule()

    expect(alertConfirm).toHaveBeenCalled()
    expect(saveAssets).not.toHaveBeenCalled()
    expect(createGlobalModule).not.toHaveBeenCalled()
    expect(alertNormal).not.toHaveBeenCalled()
  })

  it('rejects MCP .risum modules before asset upload or module creation', async () => {
    selectedFileState.file = {
      name: 'module.risum',
      data: buildRisum(
        {
          id: 'old-id',
          name: 'MCP module',
          description: 'Imported',
          lowLevelAccess: true,
          mcp: { url: 'https://example.test/mcp' },
          assets: [['portrait', '', 'portrait.webp']],
        },
        [new Uint8Array([7, 8, 9])],
      ),
    }

    await importModule()

    expect(alertError).toHaveBeenCalledWith('MCP module import is not supported in Fastify server-backed mode yet')
    expect(alertConfirm).not.toHaveBeenCalled()
    expect(saveAssets).not.toHaveBeenCalled()
    expect(createGlobalModule).not.toHaveBeenCalled()
  })

  it('reports no-data for invalid .risum files without asset upload or module creation', async () => {
    selectedFileState.file = {
      name: 'module.risum',
      data: new Uint8Array([111, 0, 0, 0]),
    }

    await importModule()

    expect(alertError).toHaveBeenCalledWith(language.errors.noData)
    expect(saveAssets).not.toHaveBeenCalled()
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
    testDatabaseState.db.characters = [character]
    getCurrentCharacter.mockReturnValue(character)
    getDatabase.mockReturnValue({
      characters: [character],
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
    expect(replaceCharacterLorebooksCommand.mock.invocationCallOrder[0]).toBeLessThan(
      replaceCharacterScriptsCommand.mock.invocationCallOrder[0],
    )
    expect(replaceCharacterScriptsCommand.mock.invocationCallOrder[0]).toBeLessThan(
      replaceCharacterTriggersCommand.mock.invocationCallOrder[0],
    )
    expect(alertNormal).toHaveBeenCalled()
  })

  it('keeps accepted lorebook apply and rolls back only failed script plus trigger tail', async () => {
    alertModuleSelect.mockResolvedValue('mod-a')
    const character = {
      chaId: 'char-a',
      globalLore: [{ comment: 'Existing lore', content: 'old' }],
      customscript: [{ comment: 'Existing regex', in: 'old', out: 'old' }],
      triggerscript: [{ comment: 'Existing trigger', type: 'manual', conditions: [], effect: [] }],
    } as unknown as character
    testDatabaseState.db.characters = [character]
    getCurrentCharacter.mockReturnValue(character)
    getDatabase.mockReturnValue({
      characters: [character],
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

    const [factories, rollback] = runOptimisticCommandSequence.mock.calls[0] as [
      Array<(baseRevision: number) => Promise<{ status: string }>>,
      () => void,
    ]
    await factories[0](10)
    replaceCharacterScriptsCommand.mockResolvedValueOnce({ status: 'conflict', revision: 2, data: {} })
    character.customscript = [{ comment: 'Newer regex', in: 'newer', out: 'newer', type: 'regex' }]

    await factories[1](11)
    rollback()

    expect(replaceCharacterTriggersCommand).not.toHaveBeenCalled()
    expect(rollbackCharacterLorebookReplacement).not.toHaveBeenCalled()
    expect(rollbackScopedScriptDefinitionReplacement).toHaveBeenCalledTimes(2)
    expect(rollbackScopedScriptDefinitionReplacement.mock.calls.map(([entry]) => entry.kind)).toEqual([
      'characterTriggers',
      'characterScripts',
    ])
    expect(character.globalLore).toEqual([
      { comment: 'Existing lore', content: 'old' },
      { comment: 'Module lore', content: 'lore' },
    ])
    expect(character.customscript).toEqual([{ comment: 'Newer regex', in: 'newer', out: 'newer', type: 'regex' }])
    expect(character.triggerscript).toEqual([
      { comment: 'Existing trigger', type: 'manual', conditions: [], effect: [] },
    ])
  })

  it('failure rollback preserves sibling characters and unrelated module/global state', async () => {
    alertModuleSelect.mockResolvedValue('mod-a')
    const target = {
      chaId: 'char-a',
      globalLore: [{ comment: 'Existing lore', content: 'old' }],
      customscript: [{ comment: 'Existing regex', in: 'old', out: 'old' }],
      triggerscript: [{ comment: 'Existing trigger', type: 'manual', conditions: [], effect: [] }],
    } as unknown as character
    const sibling = {
      chaId: 'char-b',
      globalLore: [{ comment: 'Sibling lore', content: 'sibling' }],
      customscript: [{ comment: 'Sibling regex', in: 'sib', out: 'sib' }],
      triggerscript: [{ comment: 'Sibling trigger', type: 'manual', conditions: [], effect: [] }],
    } as unknown as character
    testDatabaseState.db.characters = [target, sibling]
    testDatabaseState.db.modules = [
      {
        id: 'unrelated-module',
        name: 'Unrelated module',
        description: '',
        regex: [{ comment: 'Unrelated module regex', in: 'module', out: 'module', type: 'regex' }],
      },
    ]
    testDatabaseState.db.loreBook = [
      { id: 'global-lore', name: 'Global lore', data: [{ comment: 'Global', content: 'g' }] },
    ] as never
    getCurrentCharacter.mockReturnValue(target)
    getDatabase.mockReturnValue({
      characters: [target, sibling],
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

    const [factories, rollback] = runOptimisticCommandSequence.mock.calls[0] as [
      Array<(baseRevision: number) => Promise<{ status: string }>>,
      () => void,
    ]
    replaceCharacterLorebooksCommand.mockResolvedValueOnce({ status: 'conflict', revision: 1, data: {} })
    sibling.customscript = [{ comment: 'Sibling newer regex', in: 'new-sib', out: 'new-sib', type: 'regex' }]
    ;(testDatabaseState.db.modules as unknown as Array<Record<string, unknown>>)[0].regex = [
      { comment: 'Unrelated module newer regex', in: 'new-module', out: 'new-module', type: 'regex' },
    ]
    ;(testDatabaseState.db.loreBook as Array<Record<string, unknown>>)[0].name = 'Global lore newer'

    await factories[0](10)
    rollback()

    expect(replaceCharacterScriptsCommand).not.toHaveBeenCalled()
    expect(replaceCharacterTriggersCommand).not.toHaveBeenCalled()
    expect(target.globalLore).toEqual([{ comment: 'Existing lore', content: 'old' }])
    expect(target.customscript).toEqual([{ comment: 'Existing regex', in: 'old', out: 'old' }])
    expect(target.triggerscript).toEqual([{ comment: 'Existing trigger', type: 'manual', conditions: [], effect: [] }])
    expect(sibling.customscript).toEqual([
      { comment: 'Sibling newer regex', in: 'new-sib', out: 'new-sib', type: 'regex' },
    ])
    expect(testDatabaseState.db.modules).toEqual([
      {
        id: 'unrelated-module',
        name: 'Unrelated module',
        description: '',
        regex: [{ comment: 'Unrelated module newer regex', in: 'new-module', out: 'new-module', type: 'regex' }],
      },
    ])
    expect(testDatabaseState.db.loreBook).toEqual([
      { id: 'global-lore', name: 'Global lore newer', data: [{ comment: 'Global', content: 'g' }] },
    ])
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
