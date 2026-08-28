import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('src/ts/server/commands', async (importActual) => {
  const actual = await importActual<typeof import('src/ts/server/commands')>()
  return {
    ...actual,
    canUseServerCommands: vi.fn(() => false),
  }
})

import {
  applyImportedModuleLorebookRows,
  applyImportedModuleRegexRows,
  parseImportedLorebookRows,
} from './ModuleMenu.svelte'
import type { RisuModule } from 'src/ts/process/modules'
import type { customscript, loreBook, triggerscript } from 'src/ts/storage/database.svelte'
import { resetServerBackedLorebookBridgeForTests } from 'src/ts/server/lorebookBridge.svelte'
import {
  getResourceDatabase as getDatabase,
  replaceResourceDatabase as setDatabaseLite,
} from 'src/ts/server/resourceState.svelte'

let liveModule: RisuModule
let draftModule: RisuModule

function cloneJsonValue<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T
}

function loreEntry(id: string, content: string): loreBook {
  return {
    id,
    key: id,
    comment: id,
    content,
    mode: 'normal',
    insertorder: 100,
    alwaysActive: false,
    secondkey: '',
    selective: false,
  }
}

function regexEntry(id: string, out: string): customscript {
  return {
    id,
    comment: id,
    in: id,
    out,
    type: 'editinput',
  }
}

function triggerEntry(id: string, comment: string): triggerscript {
  return {
    id,
    comment,
    type: 'manual',
    conditions: [],
    effect: [],
  }
}

function jsonFile(payload: unknown, name = 'import.json') {
  return {
    name,
    data: new TextEncoder().encode(JSON.stringify(payload)),
  }
}

function seedModule(): void {
  const module: RisuModule = {
    id: 'module-import',
    name: 'Import module',
    description: '',
    lorebook: [loreEntry('lore-initial', 'initial lore')],
    regex: [regexEntry('regex-initial', 'initial regex')],
    trigger: [triggerEntry('trigger-initial', 'initial trigger')],
  }
  const db = {
    characters: [],
    enabledModules: [],
    loreBook: [],
    loreBookPage: 0,
    modules: [module],
    useAdditionalAssetsPreview: false,
  } as any
  setDatabaseLite(db)
  liveModule = getDatabase().modules[0] as RisuModule
  draftModule = cloneJsonValue(liveModule)
}

beforeEach(() => {
  vi.clearAllMocks()
  seedModule()
})

afterEach(() => {
  resetServerBackedLorebookBridgeForTests()
  setDatabaseLite({} as any)
})

describe('ModuleMenu stale import guards', () => {
  it('delayed lorebook import preserves concurrent module lorebook edits', () => {
    const moduleId = draftModule.id
    const importedRows = parseImportedLorebookRows([
      jsonFile({
        type: 'risu',
        ver: 1,
        data: [loreEntry('lore-imported', 'imported lore')],
      }),
    ])

    liveModule.lorebook = [
      loreEntry('lore-initial', 'concurrent edit'),
      loreEntry('lore-concurrent-add', 'concurrent add'),
    ]
    draftModule.lorebook = cloneJsonValue(liveModule.lorebook)

    expect(applyImportedModuleLorebookRows(moduleId, draftModule, importedRows)).toBe(true)
    expect(liveModule.lorebook?.map((entry) => entry.content)).toEqual([
      'concurrent edit',
      'concurrent add',
      'imported lore',
    ])
    expect(draftModule.lorebook).toEqual(liveModule.lorebook)
  })

  it('remints a duplicate id when a .risu lorebook is re-imported into the same module', () => {
    const moduleId = draftModule.id
    const importedRows = parseImportedLorebookRows([
      jsonFile({
        type: 'risu',
        ver: 1,
        data: [loreEntry('lore-initial', 'round-trip import')],
      }),
    ])

    expect(applyImportedModuleLorebookRows(moduleId, draftModule, importedRows)).toBe(true)

    const ids = liveModule.lorebook?.map((entry) => entry.id) ?? []
    expect(ids[0]).toBe('lore-initial')
    expect(ids[1]).not.toBe('lore-initial')
    expect(new Set(ids).size).toBe(2)
  })

  it.each([
    ['cancel', null],
    ['empty result', []],
  ])('lorebook %s preserves concurrent module lorebook edits', (_label, importedRows) => {
    const moduleId = draftModule.id

    liveModule.lorebook = [loreEntry('lore-initial', 'concurrent retained')]
    draftModule.lorebook = cloneJsonValue(liveModule.lorebook)

    expect(applyImportedModuleLorebookRows(moduleId, draftModule, importedRows)).toBe(false)
    expect(liveModule.lorebook?.map((entry) => entry.content)).toEqual(['concurrent retained'])
    expect(draftModule.lorebook).toEqual(liveModule.lorebook)
  })

  it('delayed regex import preserves concurrent module regex edits and latest triggers', () => {
    const moduleId = draftModule.id
    const importedRows = [regexEntry('regex-imported', 'imported regex')]

    liveModule.regex = [
      regexEntry('regex-initial', 'concurrent edit'),
      regexEntry('regex-concurrent-add', 'concurrent add'),
    ]
    liveModule.trigger = [triggerEntry('trigger-initial', 'concurrent trigger')]
    draftModule.regex = cloneJsonValue(liveModule.regex)
    draftModule.trigger = cloneJsonValue(liveModule.trigger)

    expect(applyImportedModuleRegexRows(moduleId, draftModule, importedRows)).toBe(true)
    expect(liveModule.regex?.map((entry) => entry.out)).toEqual(['concurrent edit', 'concurrent add', 'imported regex'])
    expect(liveModule.trigger?.map((entry) => entry.comment)).toEqual(['concurrent trigger'])
    expect(draftModule.regex).toEqual(liveModule.regex)
    expect(draftModule.trigger).toEqual(liveModule.trigger)
  })
})
