import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import type { character } from '../storage/database.svelte'
import {
  clearPendingChatGenerationSettingsSave,
  registerPendingChatGenerationSettingsSave,
} from './chatGenerationSettingsResourceGuard'
import {
  SERVER_COLLECTION_NAMES,
  applyCharacterPatchLocalEffect,
  applyCharacterOrderLocalEffect,
  applyCharacterRowMutationLocalEffect,
  applyCharacterResource,
  applyCharacterOrderResource,
  applyCharacterSelectionLocalEffect,
  applyCharacterSelectionResource,
  applyCharactersResource,
  applyChatPatchLocalEffect,
  applyCollectionsResource,
  applySettingsResource,
  applySettingsGroupResource,
  applySettingsPatchLocalEffect,
  applyPluginStorageLocalEffect,
  areServerDatabaseResourcesReady,
  charactersResourceState,
  collectionsResourceState,
  composeResourceDatabaseSnapshot,
  getResourceDatabase,
  replaceResourceDatabase,
  resetServerResourceState,
  setResourceDatabaseWriteGuardEnabled,
  settingsResourceState,
  withResourceDatabaseWrite,
} from './resourceState.svelte'

function metadataCharacter(chaId: string, name: string): character {
  return {
    chaId,
    name,
    chats: [],
  } as unknown as character
}

function completeCollections() {
  return Object.fromEntries(
    SERVER_COLLECTION_NAMES.map((name) => [name, name === 'pluginCustomStorage' ? { counter: 1 } : []]),
  )
}

beforeEach(() => {
  setResourceDatabaseWriteGuardEnabled(false)
  resetServerResourceState()
  setResourceDatabaseWriteGuardEnabled(true)
})

afterEach(() => {
  setResourceDatabaseWriteGuardEnabled(false)
})

describe('resource-scoped database state', () => {
  it('composes settings, collections, and character metadata without a monolithic database object', () => {
    applySettingsResource({
      revision: 5,
      settings: { language: 'en', currentChar: 1, characterOrder: ['settings-order'] },
    })
    applyCollectionsResource({ revision: 5, collections: completeCollections() })
    applyCharactersResource({
      revision: 4,
      characters: [metadataCharacter('char-a', 'Ada')],
      characterOrder: ['char-a'],
      currentChar: 0,
    })

    const settingsNewer = composeResourceDatabaseSnapshot() as unknown as Record<string, unknown>
    expect(settingsNewer).toMatchObject({
      language: 'en',
      currentChar: 1,
      characterOrder: ['settings-order'],
      characters: [{ chaId: 'char-a', name: 'Ada' }],
      pluginCustomStorage: { counter: 1 },
    })
    expect(areServerDatabaseResourcesReady()).toBe(true)

    applyCharactersResource({
      revision: 6,
      characters: [metadataCharacter('char-a', 'Ada')],
      characterOrder: ['char-a'],
      currentChar: 0,
    })
    expect(composeResourceDatabaseSnapshot()).toMatchObject({ currentChar: 0, characterOrder: ['char-a'] })
  })

  it('exposes a reactive read-through compatibility view and detached snapshots', () => {
    applySettingsResource({ revision: 1, settings: { language: 'en' } })
    applyCollectionsResource({ revision: 1, collections: completeCollections() })
    applyCharactersResource({
      revision: 1,
      characters: [metadataCharacter('char-a', 'Ada')],
      characterOrder: ['char-a'],
      currentChar: 0,
    })

    const compatibility = getResourceDatabase()
    expect(compatibility.language).toBe('en')
    expect(Object.keys(compatibility)).toContain('characters')
    expect(() => {
      compatibility.language = 'ko'
    }).toThrow('outside withResourceDatabaseWrite')

    let capturedCharacters: character[] | undefined
    withResourceDatabaseWrite((database) => {
      database.language = 'ko'
      capturedCharacters = database.characters
      database.characters.push(metadataCharacter('char-b', 'Bea'))
      Object.defineProperty(database, 'globalNote', { configurable: true, value: 'note' })
    })
    expect(compatibility.language).toBe('ko')
    expect(compatibility.characters.map((character) => character.chaId)).toEqual(['char-a', 'char-b'])
    expect(compatibility.globalNote).toBe('note')
    expect(() => capturedCharacters?.push(metadataCharacter('char-c', 'Cee'))).toThrow(
      'outside withResourceDatabaseWrite',
    )

    const snapshot = getResourceDatabase({ snapshot: true })
    snapshot.language = 'fr'
    expect(getResourceDatabase().language).toBe('ko')

    applySettingsResource({ revision: 2, settings: { language: 'ja' } })
    expect(compatibility.language).toBe('ja')
  })

  it('seeds every resource slice from a compatibility database', () => {
    replaceResourceDatabase(
      {
        language: 'en',
        characters: [metadataCharacter('char-a', 'Ada')],
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
      } as unknown as Parameters<typeof replaceResourceDatabase>[0],
      12,
    )

    expect(getResourceDatabase()).toMatchObject({
      language: 'en',
      currentChar: 0,
      characters: [{ chaId: 'char-a' }],
      modules: [],
    })
    expect(collectionsResourceState.fullRevision).toBe(12)
  })

  it('keeps a newer targeted collection value when an older full response arrives', () => {
    expect(
      applyCollectionsResource(
        { revision: 8, collections: { modules: [{ id: 'new', name: 'New', description: '' }] } },
        'modules',
      ),
    ).toBe(true)
    expect(applyCollectionsResource({ revision: 7, collections: completeCollections() })).toBe(true)

    expect(collectionsResourceState.values.modules).toEqual([{ id: 'new', name: 'New', description: '' }])
    expect(collectionsResourceState.revisions.modules).toBe(8)
    expect(collectionsResourceState.fullRevision).toBe(7)
  })

  it('acknowledges optimistic plugin storage without replacing the live map', () => {
    applyCollectionsResource({ revision: 3, collections: completeCollections() })
    withResourceDatabaseWrite(() => {
      getResourceDatabase().pluginCustomStorage = {
        counter: 2,
        largePluginValue: { nested: ['already', 'local'] },
      }
    })

    expect(applyPluginStorageLocalEffect({ revision: 4 })).toBe(true)
    expect(getResourceDatabase().pluginCustomStorage).toEqual({
      counter: 2,
      largePluginValue: { nested: ['already', 'local'] },
    })
    expect(collectionsResourceState.revisions.pluginCustomStorage).toBe(4)
    expect(collectionsResourceState.revision).toBe(4)
  })

  it('merges settings groups with omitted-key deletion and independent revisions', () => {
    applySettingsResource({
      revision: 1,
      settings: {
        language: 'en',
        theme: 'dark',
        customCSS: 'resident',
        textScreenBorder: 'solid',
      },
    })
    expect(
      applySettingsGroupResource(
        {
          revision: 10,
          group: 'language',
          settings: { language: 'ko' },
        },
        ['language'],
      ),
    ).toBe(true)
    // A lower response revision is still valid for a different group.
    expect(
      applySettingsGroupResource(
        {
          revision: 9,
          group: 'display',
          settings: { theme: 'light', textScreenBorder: null },
        },
        ['theme', 'customCSS', 'textScreenBorder'],
      ),
    ).toBe(true)

    expect(getResourceDatabase()).toMatchObject({
      language: 'ko',
      theme: 'light',
      textScreenBorder: null,
    })
    expect(getResourceDatabase()).not.toHaveProperty('customCSS')
    expect(settingsResourceState.groupRevisions).toMatchObject({ language: 10, display: 9 })
    expect(settingsResourceState.revision).toBe(10)
    expect(applySettingsResource({ revision: 8, settings: { language: 'stale', theme: 'stale' } })).toBe(false)
    expect(getResourceDatabase()).toMatchObject({ language: 'ko', theme: 'light' })
  })

  it('acknowledges a settings patch without replacing a newer queued field', () => {
    applySettingsResource({
      revision: 3,
      settings: { theme: 'LIGHT', zoomsize: 88 },
    })
    withResourceDatabaseWrite(() => {
      getResourceDatabase().zoomsize = 120
    })

    expect(
      applySettingsPatchLocalEffect({
        revision: 4,
        group: 'display',
        attemptedPatch: { theme: 'LIGHT', zoomsize: 88 },
        settings: { theme: 'light', zoomsize: 88 },
      }),
    ).toBe(true)

    expect(getResourceDatabase()).toMatchObject({ theme: 'light', zoomsize: 120 })
    expect(settingsResourceState.groupRevisions.display).toBe(4)
    expect(settingsResourceState.revision).toBe(4)
  })

  it('fences the Hypa V3 preset collection included in a memory settings patch', () => {
    applySettingsResource({ revision: 1, settings: { hypaV3: false } })
    applyCollectionsResource({ revision: 1, collections: completeCollections() })
    const presets = [{ name: 'Compact', settings: { summarizationPrompt: 'Summarize' } }]
    withResourceDatabaseWrite(() => {
      getResourceDatabase().hypaV3Presets = presets as never
    })

    expect(
      applySettingsPatchLocalEffect({
        revision: 2,
        group: 'memory',
        attemptedPatch: { hypaV3Presets: presets },
        settings: { hypaV3Presets: presets },
      }),
    ).toBe(true)

    expect(collectionsResourceState.values.hypaV3Presets).toEqual(presets)
    expect(collectionsResourceState.revisions.hypaV3Presets).toBe(2)
    expect(settingsResourceState.groupRevisions.memory).toBe(2)
  })

  it('merges character details by stable id and drops stale rows', () => {
    applyCharactersResource({
      revision: 3,
      characters: [metadataCharacter('char-a', 'Old')],
      characterOrder: ['char-a'],
      currentChar: 0,
    })
    expect(applyCharacterResource({ revision: 5, character: metadataCharacter('char-a', 'New') })).toBe(true)
    expect(applyCharacterResource({ revision: 4, character: metadataCharacter('char-a', 'Stale') })).toBe(false)

    expect(getResourceDatabase().characters[0]?.name).toBe('New')
  })

  it('acknowledges an optimistic character patch without replacing a newer live value', () => {
    applyCharactersResource({
      revision: 3,
      characters: [metadataCharacter('char-a', 'Old'), metadataCharacter('char-b', 'Bea')],
      characterOrder: ['char-a', 'char-b'],
      currentChar: 0,
    })
    withResourceDatabaseWrite(() => {
      getResourceDatabase().characters[0].name = 'Newer queued edit'
    })

    expect(
      applyCharacterPatchLocalEffect({
        revision: 4,
        characterId: 'char-a',
        patch: { name: 'Accepted edit' },
      }),
    ).toBe(true)

    expect(getResourceDatabase().characters[0].name).toBe('Newer queued edit')
    expect(charactersResourceState.rowRevisions).toEqual({ 'char-a': 4, 'char-b': 3 })
    expect(charactersResourceState.revision).toBe(4)
  })

  it('acknowledges a character patch after a newer optimistic delete removed the row', () => {
    applyCharactersResource({
      revision: 3,
      characters: [metadataCharacter('char-a', 'Old')],
      characterOrder: ['char-a'],
      currentChar: 0,
    })
    withResourceDatabaseWrite(() => {
      getResourceDatabase().characters.splice(0, 1)
    })

    expect(
      applyCharacterPatchLocalEffect({
        revision: 4,
        characterId: 'char-a',
        patch: { name: 'Accepted before delete' },
      }),
    ).toBe(true)
    expect(getResourceDatabase().characters).toEqual([])
    expect(charactersResourceState.rowRevisions['char-a']).toBe(4)
  })

  it('keeps narrow order and selection pointers newer than unrelated settings', () => {
    applyCharactersResource({
      revision: 5,
      characters: [metadataCharacter('char-a', 'Ada'), metadataCharacter('char-b', 'Bea')],
      characterOrder: ['char-a', 'char-b'],
      currentChar: 0,
    })
    applySettingsResource({
      revision: 6,
      settings: { characterOrder: ['stale-settings-order'], currentChar: 0 },
    })

    expect(applyCharacterOrderResource({ revision: 7, characterOrder: ['char-b', 'char-a'] })).toBe(true)
    expect(
      applyCharacterSelectionResource({
        revision: 8,
        characterId: 'char-a',
        currentChar: 1,
        lastInteraction: 88,
      }),
    ).toBe(true)

    expect(getResourceDatabase()).toMatchObject({
      characterOrder: ['char-b', 'char-a'],
      currentChar: 1,
      characters: [{ chaId: 'char-a', lastInteraction: 88 }, { chaId: 'char-b' }],
    })
  })

  it('fences optimistic character order and nested-row writes without replacing newer values', () => {
    const ada = metadataCharacter('char-a', 'Ada')
    ada.chats = [{ id: 'chat-a', message: [], scriptstate: { $score: 'newer' } }] as never
    applyCharactersResource({
      revision: 5,
      characters: [ada, metadataCharacter('char-b', 'Bea')],
      characterOrder: ['char-b', 'char-a'],
      currentChar: 0,
    })

    expect(applyCharacterRowMutationLocalEffect({ revision: 6, characterId: 'char-a', targetId: 'chat-a' })).toBe(true)
    expect(applyCharacterOrderLocalEffect({ revision: 7, attemptedOrder: ['char-a', 'char-b'] })).toBe(true)

    expect(getResourceDatabase().characters[0].chats[0].scriptstate).toEqual({ $score: 'newer' })
    expect(getResourceDatabase().characterOrder).toEqual(['char-b', 'char-a'])
    expect(charactersResourceState.rowRevisions['char-a']).toBe(6)
    expect(charactersResourceState.orderRevision).toBe(7)
  })

  it('acknowledges an optimistic character selection without replacing a newer selection', () => {
    const ada = metadataCharacter('char-a', 'Ada')
    ada.lastInteraction = 200
    applyCharactersResource({
      revision: 5,
      characters: [ada, metadataCharacter('char-b', 'Bea')],
      characterOrder: ['char-a', 'char-b'],
      currentChar: 1,
    })

    expect(
      applyCharacterSelectionLocalEffect({
        revision: 6,
        characterId: 'char-a',
        lastInteraction: 100,
      }),
    ).toBe(true)

    expect(charactersResourceState.currentChar).toBe(1)
    expect(getResourceDatabase().characters[0].lastInteraction).toBe(200)
    expect(charactersResourceState.selectionRevision).toBe(6)
    expect(charactersResourceState.rowRevisions).toEqual({ 'char-a': 6, 'char-b': 5 })
  })

  it('acknowledges an optimistic chat update without replacing newer metadata or selection', () => {
    const ada = metadataCharacter('char-a', 'Ada')
    ada.chats = [
      { id: 'chat-a', name: 'Newer queued edit', message: [] },
      { id: 'chat-b', name: 'Newer selection', message: [] },
    ] as never
    ada.chatPage = 1
    applyCharactersResource({
      revision: 5,
      characters: [ada],
      characterOrder: ['char-a'],
      currentChar: 0,
    })

    expect(
      applyChatPatchLocalEffect({
        revision: 6,
        characterId: 'char-a',
        chatId: 'chat-a',
        patch: { name: 'Accepted edit' },
        select: true,
      }),
    ).toBe(true)

    expect(getResourceDatabase().characters[0].chats[0].name).toBe('Newer queued edit')
    expect(getResourceDatabase().characters[0].chatPage).toBe(1)
    expect(charactersResourceState.rowRevisions['char-a']).toBe(6)
  })

  it('preserves resident transcript and hypa bodies across newer metadata lists', () => {
    const resident = metadataCharacter('char-a', 'Old')
    resident.chats = [
      {
        id: 'chat-a',
        name: 'Resident chat',
        message: [{ role: 'user', data: 'resident' }],
        hypaV3Data: { mainChunks: [{ text: 'resident summary' }] },
      } as unknown as (typeof resident.chats)[number],
    ]
    applyCharactersResource({
      revision: 1,
      characters: [resident],
      characterOrder: ['char-a'],
      currentChar: 0,
    })

    const refreshed = metadataCharacter('char-a', 'New')
    refreshed.chats = [
      { id: 'chat-a', name: 'Refreshed metadata', message: [] } as unknown as (typeof refreshed.chats)[number],
    ]
    expect(
      applyCharactersResource({
        revision: 2,
        characters: [refreshed],
        characterOrder: ['char-a'],
        currentChar: 0,
      }),
    ).toBe(true)

    expect(getResourceDatabase().characters[0]).toMatchObject({
      name: 'New',
      chats: [
        {
          name: 'Refreshed metadata',
          message: [{ data: 'resident' }],
          hypaV3Data: { mainChunks: [{ text: 'resident summary' }] },
        },
      ],
    })
  })

  it('preserves a resident lorebook when a targeted or list row refresh omits the stubbed field', () => {
    const resident = metadataCharacter('char-a', 'Resident')
    resident.globalLore = [{ key: 'resident', content: 'kept' }] as never
    applyCharactersResource({
      revision: 1,
      characters: [resident],
      characterOrder: ['char-a'],
      currentChar: 0,
    })

    expect(applyCharacterResource({ revision: 2, character: metadataCharacter('char-a', 'Targeted') })).toBe(true)
    expect(getResourceDatabase().characters[0].globalLore).toEqual([{ key: 'resident', content: 'kept' }])

    expect(
      applyCharactersResource({
        revision: 3,
        characters: [metadataCharacter('char-a', 'Listed')],
        characterOrder: ['char-a'],
        currentChar: 0,
      }),
    ).toBe(true)
    expect(getResourceDatabase().characters[0].globalLore).toEqual([{ key: 'resident', content: 'kept' }])
  })

  it('preserves newer pending generation settings across targeted and list character refreshes', () => {
    const pendingSettings = {
      configured: true,
      jailbreakToggle: true,
      sidebarToggles: { mode: 'newer' },
    }
    const resident = metadataCharacter('char-a', 'Resident')
    resident.chats = [
      { id: 'chat-a', message: [], generationSettings: pendingSettings } as unknown as (typeof resident.chats)[number],
    ]
    applyCharactersResource({
      revision: 1,
      characters: [resident],
      characterOrder: ['char-a'],
      currentChar: 0,
    })
    const pending = registerPendingChatGenerationSettingsSave('chat-a', pendingSettings)

    try {
      const staleSettings = {
        configured: true,
        jailbreakToggle: false,
        sidebarToggles: { mode: 'older' },
      }
      const targeted = metadataCharacter('char-a', 'Targeted')
      targeted.chats = [
        { id: 'chat-a', message: [], generationSettings: staleSettings } as unknown as (typeof targeted.chats)[number],
      ]
      expect(applyCharacterResource({ revision: 2, character: targeted })).toBe(true)
      expect(getResourceDatabase().characters[0].chats[0].generationSettings).toEqual(pendingSettings)

      const listed = metadataCharacter('char-a', 'Listed')
      listed.chats = [
        { id: 'chat-a', message: [], generationSettings: staleSettings } as unknown as (typeof listed.chats)[number],
      ]
      expect(
        applyCharactersResource({
          revision: 3,
          characters: [listed],
          characterOrder: ['char-a'],
          currentChar: 0,
        }),
      ).toBe(true)
      expect(getResourceDatabase().characters[0].chats[0].generationSettings).toEqual(pendingSettings)
    } finally {
      clearPendingChatGenerationSettingsSave(pending)
    }
  })
})
