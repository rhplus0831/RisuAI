import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import type { character } from '../storage/database.svelte'
import {
  clearPendingChatGenerationSettingsSave,
  registerPendingChatGenerationSettingsSave,
} from './chatGenerationSettingsResourceGuard'
import {
  SERVER_COLLECTION_NAMES,
  applyCharacterCollectionMutationLocalEffect,
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
  applyPluginCollectionMutationLocalEffect,
  applyPluginProviderLocalEffect,
  applyPluginStorageLocalEffect,
  applyModuleCollectionMutationLocalEffect,
  applyModuleEnabledLocalEffect,
  applyLoadoutMutationLocalEffect,
  applyLorebookMutationLocalEffect,
  areServerDatabaseResourcesReady,
  charactersResourceState,
  captureCharacterRowProjectionEpoch,
  captureCharacterLorebookProjectionEpoch,
  captureCollectionProjectionEpoch,
  captureSettingsGroupProjectionEpoch,
  collectionsResourceState,
  composeResourceDatabaseSnapshot,
  getResourceDatabase,
  hasCharacterRowProjectionEpochChanged,
  hasCharacterLorebookProjectionEpochChanged,
  hasCollectionProjectionEpochChanged,
  hasSettingsGroupProjectionEpochChanged,
  markCharacterLorebookProjectionApplied,
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

function canonicalLoadout(id = 'loadout-a') {
  return {
    id,
    name: 'Loadout A',
    lastUsed: 100,
    favorite: false,
    characterIds: ['char-a'],
    modules: [],
    globalVariables: {},
    presetName: '',
    modelPresetId: '',
    modelPresetName: '',
    promptPresetId: '',
    promptPresetName: '',
    personaId: '',
  }
}

function canonicalLorebookEntry(id: string, content = id) {
  return {
    id,
    key: id,
    secondkey: '',
    insertorder: 100,
    comment: id,
    content,
    mode: 'normal' as const,
    alwaysActive: false,
    selective: false,
  }
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

  it('fences optimistic plugin mutations without replacing newer records or order', () => {
    applySettingsResource({ revision: 3, settings: { currentPluginProvider: 'plugin-a' } })
    applyCollectionsResource({
      revision: 3,
      collections: {
        ...completeCollections(),
        plugins: [
          { name: 'plugin-b', script: 'newer-b', arguments: {}, realArg: {}, customLink: [], argMeta: {} },
          { name: 'plugin-a', script: 'newer-a', arguments: {}, realArg: {}, customLink: [], argMeta: {} },
        ],
      },
    })

    expect(
      applyPluginCollectionMutationLocalEffect({
        revision: 4,
        operation: 'update',
        pluginId: 'plugin-a',
      }),
    ).toBe(true)
    expect(
      applyPluginCollectionMutationLocalEffect({
        revision: 5,
        operation: 'reorder',
        pluginIds: ['plugin-a', 'plugin-b'],
      }),
    ).toBe(true)

    expect(getResourceDatabase().plugins).toEqual([
      { name: 'plugin-b', script: 'newer-b', arguments: {}, realArg: {}, customLink: [], argMeta: {} },
      { name: 'plugin-a', script: 'newer-a', arguments: {}, realArg: {}, customLink: [], argMeta: {} },
    ])
    expect(collectionsResourceState.revisions.plugins).toBe(5)
    expect(collectionsResourceState.revision).toBe(5)
  })

  it('fences an accepted provider selection while retaining a newer queued selection', () => {
    applySettingsResource({ revision: 3, settings: { currentPluginProvider: 'newer-provider' } })

    expect(applyPluginProviderLocalEffect({ revision: 4, provider: 'accepted-provider' })).toBe(true)

    expect(getResourceDatabase().currentPluginProvider).toBe('newer-provider')
    expect(settingsResourceState.groupRevisions.providers).toBe(4)
    expect(settingsResourceState.revision).toBe(4)
  })

  it('fences optimistic module definitions without replacing newer records or order', () => {
    applyCollectionsResource({
      revision: 3,
      collections: {
        ...completeCollections(),
        modules: [
          { id: 'mod-b', name: 'Newer B', description: '', cjs: 'newer-b' },
          { id: 'mod-a', name: 'Newer A', description: '', cjs: 'newer-a' },
        ],
      },
    })

    expect(
      applyModuleCollectionMutationLocalEffect({
        revision: 4,
        operation: 'update',
        moduleId: 'mod-a',
      }),
    ).toBe(true)
    expect(
      applyModuleCollectionMutationLocalEffect({
        revision: 5,
        operation: 'reorder',
        moduleIds: ['mod-a', 'mod-b'],
      }),
    ).toBe(true)

    expect(getResourceDatabase().modules).toEqual([
      { id: 'mod-b', name: 'Newer B', description: '', cjs: 'newer-b' },
      { id: 'mod-a', name: 'Newer A', description: '', cjs: 'newer-a' },
    ])
    expect(collectionsResourceState.revisions.modules).toBe(5)
    expect(collectionsResourceState.revision).toBe(5)
  })

  it('fences scoped lorebook mutations without replacing newer entries or advancing projection epochs', () => {
    const globalEntry = canonicalLorebookEntry('global-entry', 'global newer')
    const characterEntry = canonicalLorebookEntry('character-entry', 'character newer')
    const chatEntry = canonicalLorebookEntry('chat-entry', 'chat newer')
    applyCollectionsResource({
      revision: 3,
      collections: {
        ...completeCollections(),
        loreBook: [{ id: 'book-a', name: 'Book A', data: [globalEntry] }] as never,
      },
    })
    const ada = metadataCharacter('char-a', 'Ada')
    ada.globalLore = [characterEntry] as never
    ada.chats = [{ id: 'chat-a', message: [], localLore: [chatEntry] }] as never
    applyCharactersResource({
      revision: 3,
      characters: [ada],
      characterOrder: ['char-a'],
      currentChar: 0,
    })

    const globalEpoch = captureCollectionProjectionEpoch('loreBook')
    const rowEpoch = captureCharacterRowProjectionEpoch('char-a')
    const lorebookEpoch = captureCharacterLorebookProjectionEpoch('char-a')

    expect(
      applyLorebookMutationLocalEffect({
        revision: 4,
        scope: 'global',
        operation: 'upsert',
        lorebookId: 'book-a',
      }),
    ).toBe(true)
    expect(
      applyLorebookMutationLocalEffect({
        revision: 5,
        scope: 'character',
        operation: 'replace',
        characterId: 'char-a',
      }),
    ).toBe(true)
    expect(
      applyLorebookMutationLocalEffect({
        revision: 6,
        scope: 'chat',
        operation: 'reorder',
        characterId: 'char-a',
        chatId: 'chat-a',
      }),
    ).toBe(true)

    expect(getResourceDatabase().loreBook[0].data).toEqual([globalEntry])
    expect(getResourceDatabase().characters[0].globalLore).toEqual([characterEntry])
    expect(getResourceDatabase().characters[0].chats[0].localLore).toEqual([chatEntry])
    expect(collectionsResourceState.revisions.loreBook).toBe(4)
    expect(charactersResourceState.rowRevisions['char-a']).toBe(6)
    expect(hasCollectionProjectionEpochChanged('loreBook', globalEpoch)).toBe(false)
    expect(hasCharacterRowProjectionEpochChanged('char-a', rowEpoch)).toBe(false)
    expect(hasCharacterLorebookProjectionEpochChanged('char-a', lorebookEpoch)).toBe(false)

    markCharacterLorebookProjectionApplied('char-a')
    expect(hasCharacterLorebookProjectionEpochChanged('char-a', lorebookEpoch)).toBe(true)
    expect(hasCharacterRowProjectionEpochChanged('char-a', rowEpoch)).toBe(false)
  })

  it('rejects lorebook acknowledgements for malformed or missing live targets', () => {
    applyCollectionsResource({
      revision: 3,
      collections: {
        ...completeCollections(),
        loreBook: [
          { id: 'duplicate', name: 'A', data: [canonicalLorebookEntry('entry-a')] },
          { id: 'duplicate', name: 'B', data: [canonicalLorebookEntry('entry-b')] },
        ] as never,
      },
    })
    const ada = metadataCharacter('char-a', 'Ada')
    ada.globalLore = [{ id: 'malformed' }] as never
    ada.chats = [{ id: 'chat-a', message: [], localLore: [canonicalLorebookEntry('chat-entry')] }] as never
    applyCharactersResource({
      revision: 3,
      characters: [ada],
      characterOrder: ['char-a'],
      currentChar: 0,
    })

    expect(
      applyLorebookMutationLocalEffect({
        revision: 4,
        scope: 'global',
        operation: 'replace',
        lorebookId: 'duplicate',
      }),
    ).toBe(false)
    expect(
      applyLorebookMutationLocalEffect({
        revision: 4,
        scope: 'character',
        operation: 'replace',
        characterId: 'char-a',
      }),
    ).toBe(false)
    expect(
      applyLorebookMutationLocalEffect({
        revision: 4,
        scope: 'chat',
        operation: 'replace',
        characterId: 'char-a',
        chatId: 'missing-chat',
      }),
    ).toBe(false)
    expect(collectionsResourceState.revisions.loreBook).toBe(3)
    expect(charactersResourceState.rowRevisions['char-a']).toBe(3)
  })

  it('fences enabled modules as one settings slice and preserves it across an older full read', () => {
    applySettingsResource({ revision: 3, settings: { enabledModules: ['mod-a'], language: 'en' } })
    withResourceDatabaseWrite(() => {
      getResourceDatabase().enabledModules = ['mod-b']
    })

    expect(applyModuleEnabledLocalEffect({ revision: 4, moduleId: 'mod-a', enabled: true })).toBe(true)
    expect(getResourceDatabase().enabledModules).toEqual(['mod-b'])
    expect(settingsResourceState.enabledModulesRevision).toBe(4)

    expect(applySettingsResource({ revision: 3, settings: { enabledModules: ['stale-module'], language: 'ko' } })).toBe(
      true,
    )
    expect(getResourceDatabase()).toMatchObject({ enabledModules: ['mod-b'], language: 'ko' })
    expect(settingsResourceState.revision).toBe(4)
    expect(settingsResourceState.enabledModulesRevision).toBe(4)

    expect(
      applySettingsResource({ revision: 5, settings: { enabledModules: ['server-module'], language: 'ja' } }),
    ).toBe(true)
    expect(getResourceDatabase()).toMatchObject({ enabledModules: ['server-module'], language: 'ja' })
    expect(settingsResourceState.enabledModulesRevision).toBeNull()
  })

  it('fences optimistic loadout favorite and touch slices without advancing projection epochs', () => {
    applySettingsResource({ revision: 3, settings: { lastLoadedLoadoutName: 'Before' } })
    applyCollectionsResource({
      revision: 3,
      collections: { ...completeCollections(), loadouts: [canonicalLoadout()] },
    })
    const collectionEpoch = captureCollectionProjectionEpoch('loadouts')
    const settingsEpoch = captureSettingsGroupProjectionEpoch('sidebar')
    withResourceDatabaseWrite(() => {
      const loadout = getResourceDatabase().loadouts[0]
      loadout.favorite = true
      loadout.lastUsed = 300
      loadout.characterIds.push('char-b')
      getResourceDatabase().lastLoadedLoadoutName = 'Newer Loadout'
    })

    expect(applyLoadoutMutationLocalEffect({ revision: 4, operation: 'favorite', loadoutId: 'loadout-a' })).toBe(true)
    expect(applyLoadoutMutationLocalEffect({ revision: 5, operation: 'touch', loadoutId: 'loadout-a' })).toBe(true)

    expect(getResourceDatabase().loadouts[0]).toMatchObject({
      favorite: true,
      lastUsed: 300,
      characterIds: ['char-a', 'char-b'],
    })
    expect(getResourceDatabase().lastLoadedLoadoutName).toBe('Newer Loadout')
    expect(collectionsResourceState.revisions.loadouts).toBe(5)
    expect(settingsResourceState.groupRevisions.sidebar).toBe(5)
    expect(hasCollectionProjectionEpochChanged('loadouts', collectionEpoch)).toBe(false)
    expect(hasSettingsGroupProjectionEpochChanged('sidebar', settingsEpoch)).toBe(false)

    applyCollectionsResource(
      { revision: 6, collections: { loadouts: [{ ...canonicalLoadout(), lastUsed: 600 }] } },
      'loadouts',
    )
    expect(hasCollectionProjectionEpochChanged('loadouts', collectionEpoch)).toBe(true)
    expect(hasSettingsGroupProjectionEpochChanged('sidebar', settingsEpoch)).toBe(false)
    applySettingsGroupResource(
      { revision: 7, group: 'sidebar', settings: { lastLoadedLoadoutName: 'Authoritative' } },
      ['lastLoadedLoadoutName'],
    )
    expect(hasSettingsGroupProjectionEpochChanged('sidebar', settingsEpoch)).toBe(true)
  })

  it('rejects loadout acknowledgements for malformed collection or settings projections', () => {
    applySettingsResource({ revision: 3, settings: { lastLoadedLoadoutName: 'Before' } })
    applyCollectionsResource({
      revision: 3,
      collections: { ...completeCollections(), loadouts: [canonicalLoadout(), canonicalLoadout()] },
    })

    expect(applyLoadoutMutationLocalEffect({ revision: 4, operation: 'favorite', loadoutId: 'loadout-a' })).toBe(false)
    withResourceDatabaseWrite(() => {
      getResourceDatabase().loadouts = [canonicalLoadout()] as never
      delete (getResourceDatabase() as unknown as Record<string, unknown>).lastLoadedLoadoutName
    })
    expect(applyLoadoutMutationLocalEffect({ revision: 4, operation: 'touch', loadoutId: 'loadout-a' })).toBe(false)
    expect(collectionsResourceState.revisions.loadouts).toBe(3)
    expect(settingsResourceState.groupRevisions.sidebar).toBeUndefined()
  })

  it('rejects unsafe module acknowledgements so authoritative reads remain available', () => {
    applySettingsResource({ revision: 3, settings: { enabledModules: ['mod-a', 'mod-a'] } })
    applyCollectionsResource({
      revision: 3,
      collections: {
        ...completeCollections(),
        modules: [
          { id: 'mod-a', name: 'A', description: '' },
          { id: 'mod-a', name: 'Duplicate', description: '' },
        ],
      },
    })

    expect(applyModuleEnabledLocalEffect({ revision: 4, moduleId: 'mod-a', enabled: true })).toBe(false)
    expect(applyModuleCollectionMutationLocalEffect({ revision: 4, operation: 'update', moduleId: 'mod-a' })).toBe(
      false,
    )
  })

  it('merges character details by stable id and drops stale rows', () => {
    const beforeCollection = captureCharacterRowProjectionEpoch('char-a')
    applyCharactersResource({
      revision: 3,
      characters: [metadataCharacter('char-a', 'Old')],
      characterOrder: ['char-a'],
      currentChar: 0,
    })
    expect(hasCharacterRowProjectionEpochChanged('char-a', beforeCollection)).toBe(true)
    const beforeTargeted = captureCharacterRowProjectionEpoch('char-a')
    expect(applyCharacterResource({ revision: 5, character: metadataCharacter('char-a', 'New') })).toBe(true)
    expect(hasCharacterRowProjectionEpochChanged('char-a', beforeTargeted)).toBe(true)
    const beforeStale = captureCharacterRowProjectionEpoch('char-a')
    expect(applyCharacterResource({ revision: 4, character: metadataCharacter('char-a', 'Stale') })).toBe(false)
    expect(hasCharacterRowProjectionEpochChanged('char-a', beforeStale)).toBe(false)

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

  it('fences optimistic character collection mutations without replacing newer list, order, or selection edits', () => {
    applyCharactersResource({
      revision: 3,
      characters: [metadataCharacter('char-a', 'Ada'), metadataCharacter('char-b', 'Bea')],
      characterOrder: ['char-a', 'char-b'],
      currentChar: 1,
    })
    withResourceDatabaseWrite(() => {
      getResourceDatabase().characters.push(metadataCharacter('char-c', 'Cora'))
      getResourceDatabase().characters.push(metadataCharacter('char-d', 'Dara'))
      getResourceDatabase().characters.splice(1, 1)
      getResourceDatabase().characterOrder = ['char-d', 'char-c', 'char-a']
      ;(getResourceDatabase() as unknown as { currentChar: number }).currentChar = 0
    })

    expect(
      applyCharacterCollectionMutationLocalEffect({
        revision: 4,
        operation: 'create',
        characterId: 'char-c',
        selectedCharacterId: 'char-b',
      }),
    ).toBe(true)
    expect(
      applyCharacterCollectionMutationLocalEffect({
        revision: 5,
        operation: 'createAndSelect',
        characterId: 'char-d',
        selectedCharacterId: 'char-d',
      }),
    ).toBe(true)
    expect(
      applyCharacterCollectionMutationLocalEffect({
        revision: 6,
        operation: 'delete',
        characterId: 'char-b',
        selectedCharacterId: 'char-d',
      }),
    ).toBe(true)

    expect(getResourceDatabase().characters.map((candidate) => candidate.chaId)).toEqual(['char-a', 'char-c', 'char-d'])
    expect(getResourceDatabase().characterOrder).toEqual(['char-d', 'char-c', 'char-a'])
    expect((getResourceDatabase() as unknown as { currentChar: number }).currentChar).toBe(0)
    expect(charactersResourceState.listRevision).toBe(6)
    expect(charactersResourceState.orderRevision).toBe(6)
    expect(charactersResourceState.selectionRevision).toBe(6)
    expect(charactersResourceState.rowRevisions).toEqual({
      'char-a': 3,
      'char-b': 6,
      'char-c': 4,
      'char-d': 5,
    })
  })

  it('acknowledges a non-selecting first character create while retaining an empty selection', () => {
    applyCharactersResource({
      revision: 1,
      characters: [],
      characterOrder: [],
      currentChar: -1,
    })
    withResourceDatabaseWrite(() => {
      getResourceDatabase().characters.push(metadataCharacter('char-first', 'First'))
      getResourceDatabase().characterOrder = ['char-first']
    })

    expect(
      applyCharacterCollectionMutationLocalEffect({
        revision: 2,
        operation: 'create',
        characterId: 'char-first',
        selectedCharacterId: null,
      }),
    ).toBe(true)
    expect((getResourceDatabase() as unknown as { currentChar: number }).currentChar).toBe(-1)
    expect(charactersResourceState.listRevision).toBe(2)
    expect(charactersResourceState.selectionRevision).toBe(2)
  })

  it('rejects character collection acknowledgements when the optimistic projection is unsafe', () => {
    applyCharactersResource({
      revision: 3,
      characters: [metadataCharacter('char-a', 'Ada')],
      characterOrder: ['char-a'],
      currentChar: 0,
    })
    withResourceDatabaseWrite(() => {
      getResourceDatabase().characters.push(metadataCharacter('char-b', 'Bea'))
    })
    const effect = {
      revision: 4,
      operation: 'create' as const,
      characterId: 'char-b',
      selectedCharacterId: 'char-a',
    }

    expect(applyCharacterCollectionMutationLocalEffect(effect)).toBe(false)
    withResourceDatabaseWrite(() => {
      getResourceDatabase().characterOrder = ['char-a', 'char-b']
      ;(getResourceDatabase() as unknown as { currentChar: number }).currentChar = 9
    })
    expect(applyCharacterCollectionMutationLocalEffect(effect)).toBe(false)
    withResourceDatabaseWrite(() => {
      ;(getResourceDatabase() as unknown as { currentChar: number }).currentChar = 0
    })
    expect(
      applyCharacterCollectionMutationLocalEffect({
        ...effect,
        operation: 'delete',
      }),
    ).toBe(false)
    expect(
      applyCharacterCollectionMutationLocalEffect({
        ...effect,
        characterId: 'char-missing',
      }),
    ).toBe(false)
    expect(charactersResourceState.listRevision).toBe(3)
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
