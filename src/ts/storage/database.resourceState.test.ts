import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('../process/modules', async (importActual) => {
  const actual = await importActual<typeof import('../process/modules')>()
  return { ...actual, getModuleTriggers: () => [], moduleUpdate: () => {} }
})

import {
  collectionsResourceState,
  charactersResourceState,
  getResourceDatabase,
  getResourceDatabaseFacadeEpoch,
  resetServerResourceState,
  replaceResourceDatabase,
  settingsResourceState,
} from '../server/resourceState.svelte'
import {
  getServerProjectionApplyEpoch,
  setServerProjectionWriteGuardEnabled,
} from '../server/projectionWriteGuard.svelte'
import {
  applyServerProjectionDatabase,
  getDatabase,
  setDatabase,
  setDatabaseLite,
  type Database,
} from './database.svelte'

function databaseFixture(name = 'Ada'): Database {
  return {
    language: 'en',
    characters: [{ chaId: 'char-a', name, chats: [] }],
    characterOrder: ['char-a'],
    currentChar: 0,
    modules: [],
    plugins: [],
    modelPresets: [],
    promptPresets: [],
    botPresets: [],
    promptTemplate: [],
    personas: [],
    loadouts: [],
    loreBook: [],
    translatorPresets: [],
    hypaV3Presets: [],
    pluginCustomStorage: {},
    agentPresets: [],
    customSidebarItems: [],
    chatGenerationTogglePresets: [],
  } as unknown as Database
}

beforeEach(() => {
  setServerProjectionWriteGuardEnabled(false)
  resetServerResourceState()
})

afterEach(() => {
  setServerProjectionWriteGuardEnabled(false)
  resetServerResourceState()
})

describe('database compatibility accessors over resource state', () => {
  it('routes getDatabase through resource slices', () => {
    replaceResourceDatabase(databaseFixture())

    expect(getDatabase()).toBe(getResourceDatabase())
    expect(settingsResourceState.value.language).toBe('en')
    expect(collectionsResourceState.values.modules).toEqual([])
    expect(charactersResourceState.characters[0]?.name).toBe('Ada')

    getDatabase().language = 'ko'
    expect(settingsResourceState.value.language).toBe('ko')

    const snapshot = getDatabase({ snapshot: true })
    snapshot.language = 'fr'
    expect(getDatabase().language).toBe('ko')
  })

  it('makes setDatabase and setDatabaseLite replace the resource-backed database', () => {
    setDatabase(databaseFixture('Normalized'))
    expect(getDatabase().characters[0]?.name).toBe('Normalized')
    expect(settingsResourceState.status).toBe('ready')

    setDatabaseLite(databaseFixture('Lite'))
    expect(getDatabase().characters[0]?.name).toBe('Lite')
    expect(charactersResourceState.characters[0]?.name).toBe('Lite')
  })

  it('seeds resource revisions and apply epochs on an authoritative replacement', () => {
    const beforeFacadeEpoch = getResourceDatabaseFacadeEpoch()
    const beforeApplyEpoch = getServerProjectionApplyEpoch()

    applyServerProjectionDatabase(databaseFixture('Projected'), 17)

    expect(getDatabase().characters[0]?.name).toBe('Projected')
    expect(settingsResourceState.revision).toBe(17)
    expect(collectionsResourceState.fullRevision).toBe(17)
    expect(charactersResourceState.listRevision).toBe(17)
    expect(getResourceDatabaseFacadeEpoch()).toBeGreaterThan(beforeFacadeEpoch)
    expect(getServerProjectionApplyEpoch()).toBeGreaterThan(beforeApplyEpoch)
  })
})
