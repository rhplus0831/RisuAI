import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import type { character } from '../storage/database.svelte'
import type { AgentPresetStepRecord } from '../agentPresetRecords'
import {
  clearPendingChatGenerationSettingsSave,
  registerPendingChatGenerationSettingsSave,
} from './chatGenerationSettingsResourceGuard'
import { normalizeModelRoleProfiles } from '../model/modelProfileRecords'
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
  applyLegacyPresetCollectionResource,
  applyLegacyPresetPatchLocalEffect,
  applyAgentPresetPatchLocalEffect,
  applyAgentPresetStepPatchLocalEffect,
  applyPersonaMutationLocalEffect,
  applyPersonaPatchLocalEffect,
  applyPresetReorderLocalEffect,
  applyTranslatorPresetPatchLocalEffect,
  applyLegacyPresetRowResource,
  applySettingsResource,
  applySettingsGroupResource,
  applySettingsPatchLocalEffect,
  applyPluginCollectionMutationLocalEffect,
  applyPluginProviderLocalEffect,
  applyPluginStorageLocalEffect,
  applyModuleCollectionMutationLocalEffect,
  applyModuleEnabledLocalEffect,
  applyPromptItemMutationLocalEffect,
  applyGlobalLorebookMutationLocalEffect,
  applyLoadoutMutationLocalEffect,
  applyLorebookMutationLocalEffect,
  areServerDatabaseResourcesReady,
  charactersResourceState,
  captureCharacterRowProjectionEpoch,
  captureCharacterLorebookProjectionEpoch,
  captureCollectionProjectionEpoch,
  captureLorebookPageProjectionEpoch,
  captureLegacyPresetResourceBaseline,
  captureSettingsGroupProjectionEpoch,
  captureSettingsProjectionEpoch,
  collectionsResourceState,
  composeResourceDatabaseSnapshot,
  getResourceDatabase,
  hasCharacterRowProjectionEpochChanged,
  hasCharacterLorebookProjectionEpochChanged,
  hasNewerCharacterLorebookBodyResourceRevision,
  hasCollectionProjectionEpochChanged,
  hasLorebookPageProjectionEpochChanged,
  hasSettingsGroupProjectionEpochChanged,
  hasSettingsProjectionEpochChanged,
  isSettingsAcknowledgementTainted,
  isSettingsGroupAcknowledgementTainted,
  isCollectionAcknowledgementTainted,
  markCollectionAcknowledgementTainted,
  markCharacterLorebookBodyResourceRevision,
  markSettingsGroupAcknowledgementTainted,
  markSettingsAcknowledgementTainted,
  replaceResourceDatabase,
  resetServerResourceState,
  setResourceDatabaseWriteGuardEnabled,
  settingsResourceState,
  withResourceDatabaseWrite,
} from './resourceState.svelte'
import { SERVER_SETTINGS_KEYS_BY_GROUP } from './settingsGroups'

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

function canonicalAgentPresetStep(id: string, overrides: Partial<AgentPresetStepRecord> = {}): AgentPresetStepRecord {
  return {
    id,
    name: id,
    enabled: true,
    phase: 'beforeMain',
    dependencies: [],
    instruction: '',
    model: { mode: 'inheritMain' },
    runtime: {},
    inputScopes: [],
    outputKey: id,
    outputFormat: 'text',
    destination: 'promptOutput',
    failurePolicy: { mode: 'required' },
    ...overrides,
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

  it('reconciles legacy preset shells without discarding unaffected hydrated bodies', () => {
    applyCollectionsResource({
      revision: 3,
      collections: {
        ...completeCollections(),
        botPresets: [
          { id: 'preset-a', name: 'A', mainPrompt: 'A resident', temperature: 10 },
          { id: 'preset-b', name: 'B', mainPrompt: 'B resident', temperature: 20 },
          { id: 'preset-c', name: 'C', mainPrompt: 'C resident', temperature: 30 },
        ] as never,
      },
    })
    const baseline = captureLegacyPresetResourceBaseline(['preset-a'])
    const epoch = captureCollectionProjectionEpoch('botPresets')
    withResourceDatabaseWrite(() => {
      getResourceDatabase().botPresets[0].temperature = 99
    })

    expect(
      applyLegacyPresetCollectionResource({
        revision: 4,
        shells: [
          { id: 'preset-b', name: 'B renamed' },
          { id: 'preset-a', name: 'A renamed' },
          { id: 'preset-d', name: 'D' },
        ],
        presetRows: [{ id: 'preset-a', name: 'A renamed', mainPrompt: 'A authoritative', temperature: 40 }],
        baseline,
      }),
    ).toBe(true)

    expect(getResourceDatabase().botPresets).toEqual([
      { id: 'preset-b', name: 'B renamed', mainPrompt: 'B resident', temperature: 20 },
      { id: 'preset-a', name: 'A renamed', mainPrompt: 'A authoritative', temperature: 99 },
      { id: 'preset-d', name: 'D' },
    ])
    expect(collectionsResourceState.revisions.botPresets).toBe(4)
    expect(hasCollectionProjectionEpochChanged('botPresets', epoch)).toBe(true)
  })

  it('hydrates one exact legacy preset row and rejects malformed reconciliation payloads', () => {
    applyCollectionsResource({
      revision: 3,
      collections: {
        ...completeCollections(),
        botPresets: [
          { id: 'preset-a', name: 'A' },
          { id: 'preset-b', name: 'B', mainPrompt: 'B resident' },
        ] as never,
      },
    })
    const baseline = captureLegacyPresetResourceBaseline(['preset-a'])

    expect(
      applyLegacyPresetRowResource({
        revision: 4,
        presetId: 'preset-a',
        preset: { id: 'preset-a', name: 'A', mainPrompt: 'A hydrated' },
        baseline,
      }),
    ).toBe(true)
    expect(getResourceDatabase().botPresets).toEqual([
      { id: 'preset-a', name: 'A', mainPrompt: 'A hydrated' },
      { id: 'preset-b', name: 'B', mainPrompt: 'B resident' },
    ])

    const beforeMalformed = JSON.stringify(getResourceDatabase().botPresets)
    expect(
      applyLegacyPresetRowResource({
        revision: 5,
        presetId: 'preset-a',
        preset: { id: 'preset-wrong', name: 'Wrong' },
      }),
    ).toBe(false)
    expect(
      applyLegacyPresetCollectionResource({
        revision: 5,
        shells: [
          { id: 'preset-a', name: 'A' },
          { id: 'preset-a', name: 'Duplicate' },
        ],
        presetRows: [],
      }),
    ).toBe(false)
    expect(JSON.stringify(getResourceDatabase().botPresets)).toBe(beforeMalformed)
  })

  it('applies canonical legacy preset fields without advancing or untainting the collection projection', () => {
    applyCollectionsResource({
      revision: 3,
      collections: {
        ...completeCollections(),
        botPresets: [
          {
            id: 'preset-a',
            name: 'Optimistic name',
            temperature: 99,
            agentPresetDefaultId: 'agent-old',
          },
          { id: 'preset-b', name: 'Resident sibling' },
        ] as never,
      },
    })
    const epoch = captureCollectionProjectionEpoch('botPresets')
    markCollectionAcknowledgementTainted('botPresets')

    expect(
      applyLegacyPresetPatchLocalEffect({
        revision: 4,
        presetId: 'preset-a',
        fields: {
          name: {
            attempted: { present: true, value: 'Optimistic name' },
            canonical: { present: true, value: 'Canonical name' },
          },
          temperature: {
            attempted: { present: true, value: 40 },
            canonical: { present: true, value: 41 },
          },
          agentPresetDefaultId: {
            attempted: { present: true, value: 'agent-old' },
            canonical: { present: false },
          },
        },
      }),
    ).toBe(true)

    expect(getResourceDatabase().botPresets).toEqual([
      { id: 'preset-a', name: 'Canonical name', temperature: 99 },
      { id: 'preset-b', name: 'Resident sibling' },
    ])
    expect(collectionsResourceState.revisions.botPresets).toBe(4)
    expect(hasCollectionProjectionEpochChanged('botPresets', epoch)).toBe(false)
    expect(isCollectionAcknowledgementTainted('botPresets')).toBe(true)
  })

  it('rejects malformed or ambiguous legacy preset local effects', () => {
    applyCollectionsResource({
      revision: 3,
      collections: {
        ...completeCollections(),
        botPresets: [{ id: 'preset-a', name: 'A' }] as never,
      },
    })

    expect(
      applyLegacyPresetPatchLocalEffect({
        revision: 4,
        presetId: 'preset-a',
        fields: {
          id: {
            attempted: { present: true, value: 'preset-a' },
            canonical: { present: true, value: 'preset-a' },
          },
        },
      }),
    ).toBe(false)
    expect(
      applyLegacyPresetPatchLocalEffect({
        revision: 4,
        presetId: 'preset-a',
        fields: {
          name: {
            attempted: { present: true } as never,
            canonical: { present: true, value: 'Canonical' },
          },
        },
      }),
    ).toBe(false)

    collectionsResourceState.values.botPresets = [
      { id: 'preset-a', name: 'A' },
      { id: 'preset-a', name: 'Duplicate' },
    ] as never
    expect(
      applyLegacyPresetPatchLocalEffect({
        revision: 4,
        presetId: 'preset-a',
        fields: {},
      }),
    ).toBe(false)
  })

  it('fences legacy and model preset reorders while preserving newer live orders', () => {
    replaceResourceDatabase(
      {
        ...completeCollections(),
        characters: [],
        botPresets: [
          { id: 'preset-b', name: 'Newer B' },
          { id: 'preset-a', name: 'Newer A' },
        ],
        botPresetsId: 0,
        modelPresets: [
          { id: 'model-c', name: 'Newer C' },
          { id: 'model-b', name: 'Newer B' },
          { id: 'model-a', name: 'Newer A' },
        ],
        modelPresetsId: 1,
      } as never,
      3,
    )
    const legacyPresets = getResourceDatabase().botPresets
    const modelPresets = getResourceDatabase().modelPresets

    expect(
      applyPresetReorderLocalEffect({
        revision: 4,
        presetKind: 'legacy',
        presetIds: ['preset-a', 'preset-b'],
        selectedPresetId: 'preset-b',
        settingsWritten: false,
      }),
    ).toBe(true)
    expect(getResourceDatabase().botPresets).toBe(legacyPresets)
    expect(getResourceDatabase().botPresets.map((preset) => preset.id)).toEqual(['preset-b', 'preset-a'])
    expect(collectionsResourceState.revisions.botPresets).toBe(4)
    expect(collectionsResourceState.revisions.modelPresets).toBe(3)
    expect(settingsResourceState.fullRevision).toBe(3)

    expect(
      applyPresetReorderLocalEffect({
        revision: 5,
        presetKind: 'model',
        presetIds: ['model-a', 'model-b', 'model-c'],
        selectedPresetId: 'model-b',
        settingsWritten: true,
      }),
    ).toBe(true)
    expect(getResourceDatabase().modelPresets).toBe(modelPresets)
    expect(getResourceDatabase().modelPresets.map((preset) => preset.id)).toEqual(['model-c', 'model-b', 'model-a'])
    expect(collectionsResourceState.revisions.botPresets).toBe(4)
    expect(collectionsResourceState.revisions.modelPresets).toBe(5)
    expect(collectionsResourceState.revisions.promptPresets).toBe(3)
    expect(collectionsResourceState.fullRevision).toBe(3)
    expect(settingsResourceState.fullRevision).toBe(5)
  })

  it('rejects preset reorder fences with mismatched membership or a noncanonical selected pointer', () => {
    replaceResourceDatabase(
      {
        ...completeCollections(),
        characters: [],
        botPresets: [
          { id: 'preset-a', name: 'A' },
          { id: 'preset-b', name: 'B' },
        ],
        botPresetsId: 0,
        modelPresets: [
          { id: 'model-a', name: 'A' },
          { id: 'model-b', name: 'B' },
        ],
        modelPresetsId: -1,
      } as never,
      3,
    )

    expect(
      applyPresetReorderLocalEffect({
        revision: 4,
        presetKind: 'legacy',
        presetIds: ['preset-a', 'preset-c'],
        selectedPresetId: 'preset-a',
        settingsWritten: false,
      }),
    ).toBe(false)
    expect(collectionsResourceState.revisions.botPresets).toBe(3)

    expect(
      applyPresetReorderLocalEffect({
        revision: 4,
        presetKind: 'model',
        presetIds: ['model-a', 'model-b'],
        selectedPresetId: 'model-a',
        settingsWritten: true,
      }),
    ).toBe(false)
    expect(collectionsResourceState.revisions.modelPresets).toBe(3)
    expect(settingsResourceState.fullRevision).toBe(3)
  })

  it('fences an accepted persona PATCH while preserving later row and settings edits', () => {
    replaceResourceDatabase(
      {
        ...completeCollections(),
        characters: [],
        personas: [
          {
            id: 'persona-a',
            name: 'Newer local name',
            icon: 'newer-local-icon',
            personaPrompt: 'Attempted prompt',
            note: 'Attempted note',
          },
        ],
        selectedPersona: 0,
        username: 'Newer local name',
        userIcon: 'newer-local-icon',
        personaPrompt: 'Attempted prompt',
        userNote: 'Attempted note',
      } as never,
      3,
    )
    const collectionEpoch = captureCollectionProjectionEpoch('personas')
    const settingsEpoch = captureSettingsProjectionEpoch()
    markCollectionAcknowledgementTainted('personas')
    markSettingsAcknowledgementTainted()

    expect(
      applyPersonaPatchLocalEffect({
        revision: 4,
        personaId: 'persona-a',
        attemptedPatch: { personaPrompt: 'Attempted prompt', note: 'Attempted note' },
        attemptedPersona: {
          id: 'persona-a',
          name: 'Attempted name',
          icon: 'attempted-icon',
          personaPrompt: 'Attempted prompt',
          note: 'Attempted note',
        },
        attemptedLegacyProfile: {
          username: 'Attempted name',
          userIcon: 'attempted-icon',
          personaPrompt: 'Attempted prompt',
          userNote: 'Attempted note',
        },
        legacyProfileProjectionApplied: true,
      }),
    ).toBe(true)

    expect(getResourceDatabase()).toMatchObject({
      username: 'Newer local name',
      userIcon: 'newer-local-icon',
      personaPrompt: 'Attempted prompt',
      userNote: 'Attempted note',
      personas: [
        expect.objectContaining({
          id: 'persona-a',
          name: 'Newer local name',
          icon: 'newer-local-icon',
          personaPrompt: 'Attempted prompt',
          note: 'Attempted note',
        }),
      ],
    })
    expect(collectionsResourceState.revisions.personas).toBe(4)
    expect(settingsResourceState.fullRevision).toBe(4)
    expect(hasCollectionProjectionEpochChanged('personas', collectionEpoch)).toBe(false)
    expect(hasSettingsProjectionEpochChanged(settingsEpoch)).toBe(false)
    expect(isCollectionAcknowledgementTainted('personas')).toBe(true)
    expect(isSettingsAcknowledgementTainted()).toBe(true)
  })

  it('fences an accepted persona PATCH after a later optimistic delete removed the row', () => {
    replaceResourceDatabase(
      {
        ...completeCollections(),
        characters: [],
        personas: [{ id: 'persona-b', name: 'B', icon: '', personaPrompt: 'B', note: '' }],
        selectedPersona: 0,
        username: 'B',
        userIcon: '',
        personaPrompt: 'B',
        userNote: '',
      } as never,
      3,
    )

    expect(
      applyPersonaPatchLocalEffect({
        revision: 4,
        personaId: 'persona-a',
        attemptedPatch: { name: 'Edited A' },
        attemptedPersona: {
          id: 'persona-a',
          name: 'Edited A',
          icon: '',
          personaPrompt: 'A',
          note: '',
        },
        attemptedLegacyProfile: {
          username: 'Edited A',
          userIcon: '',
          personaPrompt: 'A',
          userNote: '',
        },
        legacyProfileProjectionApplied: true,
      }),
    ).toBe(true)

    expect(getResourceDatabase()).toMatchObject({
      personas: [{ id: 'persona-b', name: 'B' }],
      selectedPersona: 0,
      username: 'B',
      personaPrompt: 'B',
    })
    expect(collectionsResourceState.revisions.personas).toBe(4)
    expect(settingsResourceState.fullRevision).toBe(4)
  })

  it('rejects malformed or ambiguous persona PATCH local effects', () => {
    replaceResourceDatabase(
      {
        ...completeCollections(),
        characters: [],
        personas: [{ id: 'persona-a', name: 'A', icon: '', personaPrompt: '', note: '' }],
      } as never,
      3,
    )
    const baseEffect = {
      revision: 4,
      personaId: 'persona-a',
      attemptedPatch: { name: 'Attempted' },
      attemptedPersona: { id: 'persona-a', name: 'Attempted', icon: '', personaPrompt: '', note: '' },
      attemptedLegacyProfile: {
        username: 'Attempted',
        userIcon: '',
        personaPrompt: '',
        userNote: '',
      },
      legacyProfileProjectionApplied: true,
    }

    expect(
      applyPersonaPatchLocalEffect({
        ...baseEffect,
        attemptedPatch: { name: 'Different' },
      }),
    ).toBe(false)
    expect(
      applyPersonaPatchLocalEffect({
        ...baseEffect,
        attemptedLegacyProfile: { ...baseEffect.attemptedLegacyProfile, username: 'Different' },
      }),
    ).toBe(false)

    collectionsResourceState.values.personas = [
      { id: 'persona-a', name: 'A' },
      { id: 'persona-a', name: 'Duplicate' },
    ] as never
    expect(applyPersonaPatchLocalEffect(baseEffect)).toBe(false)
  })

  it('fences only persona mutation slices the server wrote while preserving newer optimistic values', () => {
    replaceResourceDatabase(
      {
        ...completeCollections(),
        characters: [],
        personas: [
          { id: 'persona-b', name: 'Newer B', icon: '', personaPrompt: 'B', note: '' },
          { id: 'persona-a', name: 'Newer A', icon: '', personaPrompt: 'A', note: '' },
        ],
        selectedPersona: 0,
        username: 'Newer B',
        userIcon: '',
        personaPrompt: 'Newer B prompt',
        userNote: 'Newer B note',
      } as never,
      3,
    )
    const collectionEpoch = captureCollectionProjectionEpoch('personas')
    const settingsEpoch = captureSettingsProjectionEpoch()
    markCollectionAcknowledgementTainted('personas')
    markSettingsAcknowledgementTainted()

    expect(
      applyPersonaMutationLocalEffect({
        revision: 4,
        operation: 'create',
        collectionWritten: true,
        settingsWritten: false,
      }),
    ).toBe(true)
    expect(collectionsResourceState.revisions.personas).toBe(4)
    expect(settingsResourceState.fullRevision).toBe(3)

    expect(
      applyPersonaMutationLocalEffect({
        revision: 5,
        operation: 'select',
        collectionWritten: false,
        settingsWritten: true,
      }),
    ).toBe(true)
    expect(collectionsResourceState.revisions.personas).toBe(4)
    expect(settingsResourceState.fullRevision).toBe(5)

    expect(
      applyPersonaMutationLocalEffect({
        revision: 6,
        operation: 'delete',
        collectionWritten: true,
        settingsWritten: true,
      }),
    ).toBe(true)
    expect(collectionsResourceState.revisions.personas).toBe(6)
    expect(settingsResourceState.fullRevision).toBe(6)
    expect(getResourceDatabase()).toMatchObject({
      selectedPersona: 0,
      username: 'Newer B',
      personaPrompt: 'Newer B prompt',
      userNote: 'Newer B note',
      personas: [
        expect.objectContaining({ id: 'persona-b', name: 'Newer B' }),
        expect.objectContaining({ id: 'persona-a', name: 'Newer A' }),
      ],
    })
    expect(hasCollectionProjectionEpochChanged('personas', collectionEpoch)).toBe(false)
    expect(hasSettingsProjectionEpochChanged(settingsEpoch)).toBe(false)
    expect(isCollectionAcknowledgementTainted('personas')).toBe(true)
    expect(isSettingsAcknowledgementTainted()).toBe(true)
  })

  it('rejects malformed or unresolvable persona mutation fences', () => {
    replaceResourceDatabase(
      {
        ...completeCollections(),
        characters: [],
        personas: [{ id: 'persona-a', name: 'A', icon: '', personaPrompt: '', note: '' }],
        selectedPersona: 0,
        username: 'A',
        userIcon: '',
        personaPrompt: '',
        userNote: '',
      } as never,
      3,
    )
    expect(
      applyPersonaMutationLocalEffect({
        revision: 4,
        operation: 'create',
        collectionWritten: false,
        settingsWritten: false,
      }),
    ).toBe(false)

    collectionsResourceState.values.personas = [
      { id: 'persona-a', name: 'A' },
      { id: 'persona-a', name: 'Duplicate' },
    ] as never
    expect(
      applyPersonaMutationLocalEffect({
        revision: 4,
        operation: 'reorder',
        collectionWritten: true,
        settingsWritten: false,
      }),
    ).toBe(false)

    collectionsResourceState.values.personas = [{ id: 'persona-a', name: 'A' }] as never
    ;(settingsResourceState.value as Record<string, unknown>).selectedPersona = -1
    expect(
      applyPersonaMutationLocalEffect({
        revision: 4,
        operation: 'select',
        collectionWritten: false,
        settingsWritten: true,
      }),
    ).toBe(false)
  })

  it('fences an accepted translator preset PATCH while preserving later row and language edits', () => {
    replaceResourceDatabase(
      {
        ...completeCollections(),
        characters: [],
        translatorPresets: [
          { id: 'translator-a', name: 'A', prompt: 'newer local prompt', maxResponse: 321 },
          { id: 'translator-b', name: 'B', prompt: 'b prompt', maxResponse: 200 },
        ],
        translatorPresetId: 0,
        translatorPrompt: 'newer local prompt',
        translatorMaxResponse: 321,
      } as never,
      3,
    )
    const collectionEpoch = captureCollectionProjectionEpoch('translatorPresets')
    const languageEpoch = captureSettingsGroupProjectionEpoch('language')
    markCollectionAcknowledgementTainted('translatorPresets')
    markSettingsGroupAcknowledgementTainted('language')

    expect(
      applyTranslatorPresetPatchLocalEffect({
        revision: 4,
        presetId: 'translator-a',
        attemptedPatch: { prompt: 'attempted prompt', maxResponse: 300 },
        attemptedPreset: {
          id: 'translator-a',
          name: 'A',
          prompt: 'attempted prompt',
          maxResponse: 300,
        },
        selectedPresetId: 'translator-a',
      }),
    ).toBe(true)

    expect(getResourceDatabase()).toMatchObject({
      translatorPresetId: 0,
      translatorPrompt: 'newer local prompt',
      translatorMaxResponse: 321,
    })
    expect(getResourceDatabase().translatorPresets[0]).toMatchObject({
      id: 'translator-a',
      prompt: 'newer local prompt',
      maxResponse: 321,
    })
    expect(collectionsResourceState.revisions.translatorPresets).toBe(4)
    expect(settingsResourceState.groupRevisions.language).toBe(4)
    expect(settingsResourceState.fullRevision).toBe(3)
    expect(hasCollectionProjectionEpochChanged('translatorPresets', collectionEpoch)).toBe(false)
    expect(hasSettingsGroupProjectionEpochChanged('language', languageEpoch)).toBe(false)
    expect(isCollectionAcknowledgementTainted('translatorPresets')).toBe(true)
    expect(isSettingsGroupAcknowledgementTainted('language')).toBe(true)
  })

  it('rejects malformed, unready, or selection-ambiguous translator preset PATCH local effects', () => {
    replaceResourceDatabase(
      {
        ...completeCollections(),
        characters: [],
        translatorPresets: [
          { id: 'translator-a', name: 'A', prompt: 'a prompt', maxResponse: 100 },
          { id: 'translator-b', name: 'B', prompt: 'b prompt', maxResponse: 200 },
        ],
        translatorPresetId: 0,
        translatorPrompt: 'a prompt',
        translatorMaxResponse: 100,
      } as never,
      3,
    )
    const baseEffect = {
      revision: 4,
      presetId: 'translator-b',
      attemptedPatch: { prompt: 'updated prompt' },
      attemptedPreset: {
        id: 'translator-b',
        name: 'B',
        prompt: 'updated prompt',
        maxResponse: 200,
      },
      selectedPresetId: 'translator-a',
    }

    expect(
      applyTranslatorPresetPatchLocalEffect({
        ...baseEffect,
        attemptedPreset: { ...baseEffect.attemptedPreset, prompt: 'different' },
      }),
    ).toBe(false)
    expect(
      applyTranslatorPresetPatchLocalEffect({
        ...baseEffect,
        selectedPresetId: 'translator-b',
      }),
    ).toBe(false)

    collectionsResourceState.statuses.translatorPresets = 'idle'
    expect(applyTranslatorPresetPatchLocalEffect(baseEffect)).toBe(false)
    collectionsResourceState.statuses.translatorPresets = 'ready'
    settingsResourceState.status = 'idle'
    expect(applyTranslatorPresetPatchLocalEffect(baseEffect)).toBe(false)

    settingsResourceState.status = 'ready'
    collectionsResourceState.values.translatorPresets = [
      { id: 'translator-a', name: 'A', prompt: 'a prompt', maxResponse: 100 },
      { id: 'translator-a', name: 'Duplicate', prompt: 'duplicate', maxResponse: 100 },
    ] as never
    expect(applyTranslatorPresetPatchLocalEffect(baseEffect)).toBe(false)
    expect(collectionsResourceState.revisions.translatorPresets).toBe(3)
    expect(settingsResourceState.groupRevisions.language).toBeUndefined()
  })

  it('applies canonical Agent Preset fields while preserving later edits and acknowledgement fences', () => {
    replaceResourceDatabase(
      {
        ...completeCollections(),
        characters: [],
        agentPresets: [
          {
            id: 'ap_a',
            name: '  Attempted Name  ',
            description: null,
            enabled: true,
            version: 1,
            steps: [
              {
                id: 'aps_a',
                name: 'Step',
                enabled: true,
                phase: 'beforeMain',
                dependencies: [],
                instruction: 'newer instruction',
                model: { mode: 'inheritMain' },
                runtime: {},
                inputScopes: [],
                outputKey: ' facts ',
                outputFormat: 'text',
                destination: 'promptOutput',
                failurePolicy: { mode: 'required' },
              },
            ],
          },
        ],
      } as never,
      3,
    )
    const epoch = captureSettingsGroupProjectionEpoch('agents')
    markSettingsGroupAcknowledgementTainted('agents')
    withResourceDatabaseWrite((database) => {
      database.agentPresets[0].name = 'newer local name'
    })

    expect(
      applyAgentPresetPatchLocalEffect({
        revision: 4,
        presetId: 'ap_a',
        fields: {
          name: {
            attempted: { present: true, value: '  Attempted Name  ' },
            canonical: { present: true, value: 'Attempted Name' },
          },
          description: {
            attempted: { present: true, value: null },
            canonical: { present: false },
          },
        },
        updatedAt: 400,
      }),
    ).toBe(true)
    expect(getResourceDatabase().agentPresets[0]).toMatchObject({
      name: 'newer local name',
      updatedAt: 400,
    })
    expect((settingsResourceState.value as { agentPresets: unknown[] }).agentPresets[0]).not.toHaveProperty(
      'description',
    )
    expect(settingsResourceState.groupRevisions.agents).toBe(4)
    expect(hasSettingsGroupProjectionEpochChanged('agents', epoch)).toBe(false)
    expect(isSettingsGroupAcknowledgementTainted('agents')).toBe(true)

    expect(
      applyAgentPresetStepPatchLocalEffect({
        revision: 5,
        presetId: 'ap_a',
        stepId: 'aps_a',
        fields: {
          outputKey: {
            attempted: { present: true, value: ' facts ' },
            canonical: { present: true, value: 'facts' },
          },
          instruction: {
            attempted: { present: true, value: 'attempted instruction' },
            canonical: { present: true, value: 'attempted instruction' },
          },
        },
        updatedAt: 500,
      }),
    ).toBe(true)
    expect(getResourceDatabase().agentPresets[0].steps[0]).toMatchObject({
      outputKey: 'facts',
      instruction: 'newer instruction',
    })
    expect(getResourceDatabase().agentPresets[0].updatedAt).toBe(500)
    expect(settingsResourceState.groupRevisions.agents).toBe(5)
    expect(hasSettingsGroupProjectionEpochChanged('agents', epoch)).toBe(false)
  })

  it('accepts a step acknowledgement that is valid against the actual preset siblings', () => {
    replaceResourceDatabase(
      {
        ...completeCollections(),
        characters: [],
        agentPresets: [
          {
            id: 'ap_a',
            name: 'A',
            enabled: true,
            version: 1,
            steps: [
              canonicalAgentPresetStep('aps_source'),
              canonicalAgentPresetStep('aps_target', {
                dependencies: ['aps_source'],
              }),
            ],
          },
        ],
      } as never,
      3,
    )

    expect(
      applyAgentPresetStepPatchLocalEffect({
        revision: 4,
        presetId: 'ap_a',
        stepId: 'aps_target',
        fields: {
          dependencies: {
            attempted: { present: true, value: ['aps_source'] },
            canonical: { present: true, value: ['aps_source'] },
          },
        },
        updatedAt: 400,
      }),
    ).toBe(true)
    expect(getResourceDatabase().agentPresets[0].steps[1].dependencies).toEqual(['aps_source'])
    expect(getResourceDatabase().agentPresets[0].updatedAt).toBe(400)
    expect(settingsResourceState.groupRevisions.agents).toBe(4)
  })

  it.each([
    {
      label: 'a missing dependency',
      stepId: 'aps_target',
      field: 'dependencies',
      value: ['aps_missing'],
      steps: [canonicalAgentPresetStep('aps_target', { dependencies: ['aps_missing'] })],
    },
    {
      label: 'a sibling output-key collision introduced while the acknowledgement was in flight',
      stepId: 'aps_target',
      field: 'outputKey',
      value: 'shared_output',
      steps: [
        canonicalAgentPresetStep('aps_source', { outputKey: 'shared_output' }),
        canonicalAgentPresetStep('aps_target', { outputKey: 'shared_output' }),
      ],
    },
    {
      label: 'a dependency cycle introduced while the acknowledgement was in flight',
      stepId: 'aps_target',
      field: 'dependencies',
      value: ['aps_source'],
      steps: [
        canonicalAgentPresetStep('aps_source', { dependencies: ['aps_target'] }),
        canonicalAgentPresetStep('aps_target', { dependencies: ['aps_source'] }),
      ],
    },
  ])('rejects a step acknowledgement when the resulting live preset has $label', ({ stepId, field, value, steps }) => {
    replaceResourceDatabase(
      {
        ...completeCollections(),
        characters: [],
        agentPresets: [{ id: 'ap_a', name: 'A', enabled: true, version: 1, steps }],
      } as never,
      3,
    )

    expect(
      applyAgentPresetStepPatchLocalEffect({
        revision: 4,
        presetId: 'ap_a',
        stepId,
        fields: {
          [field]: {
            attempted: { present: true, value },
            canonical: { present: true, value },
          },
        },
        updatedAt: 400,
      }),
    ).toBe(false)
    expect(getResourceDatabase().agentPresets[0]).not.toHaveProperty('updatedAt')
    expect(settingsResourceState.groupRevisions.agents).toBeUndefined()
    expect(settingsResourceState.fullRevision).toBe(3)
  })

  it('rejects malformed or ambiguous Agent Preset field local effects', () => {
    replaceResourceDatabase(
      {
        ...completeCollections(),
        characters: [],
        agentPresets: [{ id: 'ap_a', name: 'A', enabled: true, version: 1, steps: [] }],
      } as never,
      3,
    )
    const baseEffect = {
      revision: 4,
      presetId: 'ap_a',
      fields: {
        name: {
          attempted: { present: true as const, value: 'Attempted' },
          canonical: { present: true as const, value: 'Canonical' },
        },
      },
      updatedAt: 400,
    }

    expect(applyAgentPresetPatchLocalEffect({ ...baseEffect, fields: {} })).toBe(false)
    expect(
      applyAgentPresetPatchLocalEffect({
        ...baseEffect,
        fields: {
          name: {
            attempted: { present: true, value: 'Attempted' },
            canonical: { present: false },
          },
        },
      }),
    ).toBe(false)

    settingsResourceState.status = 'idle'
    expect(applyAgentPresetPatchLocalEffect(baseEffect)).toBe(false)
    settingsResourceState.status = 'ready'
    ;(settingsResourceState.value as { agentPresets: unknown[] }).agentPresets.push({
      id: 'ap_a',
      name: 'Duplicate',
      enabled: true,
      version: 1,
      steps: [],
    })
    expect(applyAgentPresetPatchLocalEffect(baseEffect)).toBe(false)
    expect(settingsResourceState.groupRevisions.agents).toBeUndefined()
  })

  it('intentionally resets hydrated legacy bodies on a complete collection refresh', () => {
    applyCollectionsResource({
      revision: 3,
      collections: {
        ...completeCollections(),
        botPresets: [{ id: 'preset-a', name: 'A', mainPrompt: 'resident body' }] as never,
      },
    })

    expect(
      applyCollectionsResource({
        revision: 4,
        collections: { ...completeCollections(), botPresets: [{ id: 'preset-a', name: 'A shell' }] as never },
      }),
    ).toBe(true)
    expect(getResourceDatabase().botPresets).toEqual([{ id: 'preset-a', name: 'A shell' }])
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

  it('fences overlapping model and provider reads while preserving unrelated provider settings', () => {
    applySettingsResource({
      revision: 1,
      settings: {
        openAIKey: 'provider-old',
        modelProfiles: [{ id: 'profile-old', name: 'Old Profile' }],
        modelRoleProfiles: normalizeModelRoleProfiles(undefined),
        modelRuntimeDefaults: { maxContext: 4_096 },
        theme: 'dark',
      },
    })
    const initialProviderEpoch = captureSettingsGroupProjectionEpoch('providers')
    const initialModelsEpoch = captureSettingsGroupProjectionEpoch('models')
    markSettingsGroupAcknowledgementTainted('providers')
    markSettingsGroupAcknowledgementTainted('models')

    expect(
      applySettingsGroupResource(
        {
          revision: 2,
          group: 'providers',
          settings: {
            openAIKey: 'provider-new',
            modelProfiles: [{ id: 'profile-provider', name: 'Provider Profile' }],
            modelRoleProfiles: normalizeModelRoleProfiles({
              chatMain: { mode: 'profile', profileId: 'profile-provider' },
            }),
            modelRuntimeDefaults: { maxContext: 8_192 },
          },
        },
        SERVER_SETTINGS_KEYS_BY_GROUP.providers,
      ),
    ).toBe(true)
    expect(settingsResourceState.groupRevisions).toMatchObject({ providers: 2, models: 2 })
    expect(hasSettingsGroupProjectionEpochChanged('providers', initialProviderEpoch)).toBe(true)
    expect(hasSettingsGroupProjectionEpochChanged('models', initialModelsEpoch)).toBe(true)
    expect(isSettingsGroupAcknowledgementTainted('providers')).toBe(false)
    expect(isSettingsGroupAcknowledgementTainted('models')).toBe(false)

    expect(
      applySettingsGroupResource(
        {
          revision: 1,
          group: 'models',
          settings: { modelProfiles: [{ id: 'profile-stale', name: 'Stale Profile' }] },
        },
        SERVER_SETTINGS_KEYS_BY_GROUP.models,
      ),
    ).toBe(false)

    const providerEpoch = captureSettingsGroupProjectionEpoch('providers')
    const modelsEpoch = captureSettingsGroupProjectionEpoch('models')
    markSettingsGroupAcknowledgementTainted('providers')
    markSettingsGroupAcknowledgementTainted('models')
    expect(
      applySettingsGroupResource(
        {
          revision: 3,
          group: 'models',
          settings: {
            modelProfiles: [{ id: 'profile-model', name: 'Model Profile' }],
            modelRoleProfiles: normalizeModelRoleProfiles({
              chatMain: { mode: 'profile', profileId: 'profile-model' },
            }),
            modelRuntimeDefaults: { maxContext: 16_384 },
          },
        },
        SERVER_SETTINGS_KEYS_BY_GROUP.models,
      ),
    ).toBe(true)
    expect(getResourceDatabase()).toMatchObject({
      openAIKey: 'provider-new',
      modelProfiles: [{ id: 'profile-model', name: 'Model Profile' }],
      modelRoleProfiles: { chatMain: { mode: 'profile', profileId: 'profile-model' } },
      modelRuntimeDefaults: { maxContext: 16_384 },
      theme: 'dark',
    })
    expect(settingsResourceState.groupRevisions).toMatchObject({ providers: 2, models: 3 })
    expect(hasSettingsGroupProjectionEpochChanged('providers', providerEpoch)).toBe(true)
    expect(hasSettingsGroupProjectionEpochChanged('models', modelsEpoch)).toBe(true)
    expect(isSettingsGroupAcknowledgementTainted('providers')).toBe(true)
    expect(isSettingsGroupAcknowledgementTainted('models')).toBe(false)

    expect(
      applySettingsGroupResource(
        {
          revision: 2,
          group: 'providers',
          settings: {
            openAIKey: 'provider-stale',
            modelProfiles: [{ id: 'profile-stale', name: 'Stale Profile' }],
          },
        },
        SERVER_SETTINGS_KEYS_BY_GROUP.providers,
      ),
    ).toBe(false)
    expect(getResourceDatabase()).toMatchObject({
      openAIKey: 'provider-new',
      modelProfiles: [{ id: 'profile-model', name: 'Model Profile' }],
    })
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

  it('keeps prompt acknowledgement taint and projection epoch through local effects until an authoritative read', () => {
    applySettingsResource({
      revision: 1,
      settings: { mainPrompt: 'optimistic' },
    })
    const projectionEpoch = captureSettingsGroupProjectionEpoch('prompt')
    markSettingsGroupAcknowledgementTainted('prompt')

    expect(
      applySettingsPatchLocalEffect({
        revision: 2,
        group: 'prompt',
        attemptedPatch: { mainPrompt: 'optimistic' },
        settings: { mainPrompt: 'canonical' },
      }),
    ).toBe(true)
    expect(getResourceDatabase().mainPrompt).toBe('canonical')
    expect(hasSettingsGroupProjectionEpochChanged('prompt', projectionEpoch)).toBe(false)
    expect(isSettingsGroupAcknowledgementTainted('prompt')).toBe(true)

    expect(
      applySettingsGroupResource(
        {
          revision: 3,
          group: 'prompt',
          settings: { mainPrompt: 'authoritative' },
        },
        ['mainPrompt'],
      ),
    ).toBe(true)
    expect(hasSettingsGroupProjectionEpochChanged('prompt', projectionEpoch)).toBe(true)
    expect(isSettingsGroupAcknowledgementTainted('prompt')).toBe(false)

    markSettingsGroupAcknowledgementTainted('prompt')
    expect(applySettingsResource({ revision: 4, settings: { mainPrompt: 'full' } })).toBe(true)
    expect(isSettingsGroupAcknowledgementTainted('prompt')).toBe(false)
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

  it('fences exact root and preset prompt-owner mutations without rewriting bodies or advancing epochs', () => {
    const rootItems = [{ id: 'root-a', type: 'plain', text: 'root optimistic' }]
    const presetItems = [{ id: 'preset-a-item', type: 'plain', text: 'preset optimistic' }]
    applyCollectionsResource({
      revision: 3,
      collections: {
        ...completeCollections(),
        promptTemplate: rootItems as never,
        promptPresets: [{ id: 'preset-a', name: 'Preset A', promptTemplate: presetItems }] as never,
      },
    })
    const rootEpoch = captureCollectionProjectionEpoch('promptTemplate')
    const presetEpoch = captureCollectionProjectionEpoch('promptPresets')

    expect(
      applyPromptItemMutationLocalEffect({
        revision: 4,
        operation: 'update',
        promptPresetId: null,
        itemId: 'root-a',
        ownerState: { enabled: true, items: rootItems },
      }),
    ).toBe(true)
    expect(
      applyPromptItemMutationLocalEffect({
        revision: 5,
        operation: 'create',
        promptPresetId: 'preset-a',
        itemId: 'preset-a-item',
        ownerState: { enabled: true, items: presetItems },
      }),
    ).toBe(true)

    expect(getResourceDatabase().promptTemplate).toEqual(rootItems)
    expect(getResourceDatabase().promptPresets[0].promptTemplate).toEqual(presetItems)
    expect(collectionsResourceState.revisions.promptTemplate).toBe(4)
    expect(collectionsResourceState.revisions.promptPresets).toBe(5)
    expect(hasCollectionProjectionEpochChanged('promptTemplate', rootEpoch)).toBe(false)
    expect(hasCollectionProjectionEpochChanged('promptPresets', presetEpoch)).toBe(false)

    withResourceDatabaseWrite((database) => {
      delete (database as unknown as Record<string, unknown>).promptTemplate
    })
    expect(
      applyPromptItemMutationLocalEffect({
        revision: 6,
        operation: 'enable',
        promptPresetId: null,
        enabled: false,
        ownerState: { enabled: false },
      }),
    ).toBe(true)
    expect(getResourceDatabase()).not.toHaveProperty('promptTemplate')
    expect(collectionsResourceState.revisions.promptTemplate).toBe(6)
    expect(hasCollectionProjectionEpochChanged('promptTemplate', rootEpoch)).toBe(false)
  })

  it('allows later prompt row fields while keeping operation outcomes and projections canonical', () => {
    applyCollectionsResource({
      revision: 3,
      collections: {
        ...completeCollections(),
        promptTemplate: [{ id: 'root-a', text: 'live' }] as never,
        promptPresets: [
          { id: 'preset-a', promptTemplate: [{ id: 'item-a' }] },
          { id: 'preset-a', promptTemplate: [{ id: 'item-b' }] },
        ] as never,
      },
    })

    expect(
      applyPromptItemMutationLocalEffect({
        revision: 4,
        operation: 'update',
        promptPresetId: null,
        itemId: 'root-a',
        ownerState: { enabled: true, items: [{ id: 'root-a', text: 'not live' }] },
      }),
    ).toBe(true)
    expect(getResourceDatabase().promptTemplate).toEqual([{ id: 'root-a', text: 'live' }])
    expect(
      applyPromptItemMutationLocalEffect({
        revision: 5,
        operation: 'reorder',
        promptPresetId: null,
        itemIds: ['root-a'],
        ownerState: { enabled: true, items: [{ id: 'root-a', text: 'not live' }] },
      }),
    ).toBe(true)
    expect(
      applyPromptItemMutationLocalEffect({
        revision: 6,
        operation: 'create',
        promptPresetId: null,
        itemId: 'new-root',
        ownerState: {
          enabled: true,
          items: [
            { id: 'root-a', text: 'live' },
            { id: 'new-root', text: 'missing locally' },
          ],
        },
      }),
    ).toBe(false)
    expect(
      applyPromptItemMutationLocalEffect({
        revision: 4,
        operation: 'create',
        promptPresetId: 'preset-a',
        itemId: 'item-a',
        ownerState: { enabled: true, items: [{ id: 'item-a' }] },
      }),
    ).toBe(false)
    expect(
      applyPromptItemMutationLocalEffect({
        revision: 4,
        operation: 'reorder',
        promptPresetId: null,
        itemIds: ['root-a', 'root-a'],
        ownerState: {
          enabled: true,
          items: [
            { id: 'root-a', text: 'live' },
            { id: 'root-a', text: 'duplicate' },
          ],
        },
      }),
    ).toBe(false)
  })

  it('fences scoped lorebook mutations without replacing newer entries and advances only the body projection', () => {
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
    expect(hasCharacterLorebookProjectionEpochChanged('char-a', lorebookEpoch)).toBe(true)
    expect(hasNewerCharacterLorebookBodyResourceRevision('char-a', 4)).toBe(true)
    expect(hasCharacterRowProjectionEpochChanged('char-a', rowEpoch)).toBe(false)
  })

  it('fences top-level lorebook collection and page slices independently without replacing newer optimism', () => {
    const lorebooks = [
      { id: 'book-b', name: 'Newer B', data: [canonicalLorebookEntry('entry-b')] },
      { id: 'book-a', name: 'Newer A', data: [canonicalLorebookEntry('entry-a')] },
      { id: 'book-c', name: 'Newer C', data: [] },
    ]
    applySettingsResource({ revision: 3, settings: { loreBookPage: 0 } })
    applyCollectionsResource({
      revision: 3,
      collections: { ...completeCollections(), loreBook: lorebooks as never },
    })
    const collectionEpoch = captureCollectionProjectionEpoch('loreBook')
    const pageEpoch = captureLorebookPageProjectionEpoch()

    expect(applyGlobalLorebookMutationLocalEffect({ revision: 4, operation: 'create', lorebookId: 'book-c' })).toBe(
      true,
    )
    expect(applyGlobalLorebookMutationLocalEffect({ revision: 5, operation: 'update', lorebookId: 'book-a' })).toBe(
      true,
    )
    expect(
      applyGlobalLorebookMutationLocalEffect({
        revision: 6,
        operation: 'select',
        lorebookId: 'book-b',
        selectedLorebookId: 'book-b',
      }),
    ).toBe(true)
    expect(applyGlobalLorebookMutationLocalEffect({ revision: 7, operation: 'delete', lorebookId: 'book-a' })).toBe(
      true,
    )
    expect(
      applyGlobalLorebookMutationLocalEffect({
        revision: 8,
        operation: 'reorder',
        lorebookIds: ['book-b', 'book-a', 'book-c'],
        selectedLorebookId: 'book-b',
      }),
    ).toBe(true)

    expect(getResourceDatabase().loreBook).toEqual(lorebooks)
    expect(getResourceDatabase().loreBookPage).toBe(0)
    expect(collectionsResourceState.revisions.loreBook).toBe(8)
    expect(settingsResourceState.loreBookPageRevision).toBe(8)
    expect(hasCollectionProjectionEpochChanged('loreBook', collectionEpoch)).toBe(false)
    expect(hasLorebookPageProjectionEpochChanged(pageEpoch)).toBe(false)
  })

  it('preserves a newer fenced lorebook page across stale full settings and clears it on equal authority', () => {
    applySettingsResource({ revision: 3, settings: { loreBookPage: 0, language: 'en' } })
    applyCollectionsResource({
      revision: 3,
      collections: {
        ...completeCollections(),
        loreBook: [
          { id: 'book-a', name: 'Book A', data: [] },
          { id: 'book-b', name: 'Book B', data: [] },
        ] as never,
      },
    })
    withResourceDatabaseWrite((database) => {
      database.loreBookPage = 1
    })
    const pageEpoch = captureLorebookPageProjectionEpoch()
    expect(
      applyGlobalLorebookMutationLocalEffect({
        revision: 5,
        operation: 'select',
        lorebookId: 'book-b',
        selectedLorebookId: 'book-b',
      }),
    ).toBe(true)

    expect(applySettingsResource({ revision: 4, settings: { loreBookPage: 0, language: 'ko' } })).toBe(true)
    expect(getResourceDatabase()).toMatchObject({ loreBookPage: 1, language: 'ko' })
    expect(settingsResourceState.loreBookPageRevision).toBe(5)
    expect(hasLorebookPageProjectionEpochChanged(pageEpoch)).toBe(false)

    expect(applySettingsResource({ revision: 5, settings: { loreBookPage: 0, language: 'ja' } })).toBe(true)
    expect(getResourceDatabase()).toMatchObject({ loreBookPage: 0, language: 'ja' })
    expect(settingsResourceState.loreBookPageRevision).toBeNull()
    expect(hasLorebookPageProjectionEpochChanged(pageEpoch)).toBe(true)
  })

  it('rejects top-level lorebook fences for malformed owning projections', () => {
    applySettingsResource({ revision: 3, settings: { loreBookPage: 0 } })
    applyCollectionsResource({
      revision: 3,
      collections: {
        ...completeCollections(),
        loreBook: [
          { id: 'duplicate', name: 'A', data: [] },
          { id: 'duplicate', name: 'B', data: [] },
        ] as never,
      },
    })

    expect(
      applyGlobalLorebookMutationLocalEffect({
        revision: 4,
        operation: 'select',
        lorebookId: 'duplicate',
        selectedLorebookId: 'duplicate',
      }),
    ).toBe(false)
    expect(applyGlobalLorebookMutationLocalEffect({ revision: 4, operation: 'create', lorebookId: 'book-c' })).toBe(
      false,
    )
    expect(collectionsResourceState.revisions.loreBook).toBe(3)
    expect(settingsResourceState.loreBookPageRevision).toBeNull()
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
      applySettingsGroupResource(
        {
          revision: 3,
          group: 'modules',
          settings: { enabledModules: ['stale-module'] },
        },
        ['enabledModules'],
      ),
    ).toBe(false)
    expect(getResourceDatabase().enabledModules).toEqual(['mod-b'])

    expect(
      applySettingsGroupResource(
        {
          revision: 5,
          group: 'modules',
          settings: { enabledModules: ['group-module'] },
        },
        ['enabledModules'],
      ),
    ).toBe(true)
    expect(getResourceDatabase().enabledModules).toEqual(['group-module'])
    expect(settingsResourceState.enabledModulesRevision).toBe(5)
    expect(settingsResourceState.groupRevisions.modules).toBe(5)

    expect(
      applySettingsResource({ revision: 6, settings: { enabledModules: ['server-module'], language: 'ja' } }),
    ).toBe(true)
    expect(getResourceDatabase()).toMatchObject({ enabledModules: ['server-module'], language: 'ja' })
    expect(settingsResourceState.enabledModulesRevision).toBeNull()
  })

  it('fences optimistic loadout mutation slices without advancing projection epochs', () => {
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

    expect(applyLoadoutMutationLocalEffect({ revision: 4, operation: 'create', loadoutId: 'loadout-b' })).toBe(true)
    expect(applyLoadoutMutationLocalEffect({ revision: 5, operation: 'delete', loadoutId: 'loadout-c' })).toBe(true)
    expect(applyLoadoutMutationLocalEffect({ revision: 6, operation: 'favorite', loadoutId: 'loadout-a' })).toBe(true)
    expect(applyLoadoutMutationLocalEffect({ revision: 7, operation: 'touch', loadoutId: 'loadout-a' })).toBe(true)

    expect(getResourceDatabase().loadouts[0]).toMatchObject({
      favorite: true,
      lastUsed: 300,
      characterIds: ['char-a', 'char-b'],
    })
    expect(getResourceDatabase().lastLoadedLoadoutName).toBe('Newer Loadout')
    expect(collectionsResourceState.revisions.loadouts).toBe(7)
    expect(settingsResourceState.groupRevisions.sidebar).toBe(7)
    expect(hasCollectionProjectionEpochChanged('loadouts', collectionEpoch)).toBe(false)
    expect(hasSettingsGroupProjectionEpochChanged('sidebar', settingsEpoch)).toBe(false)

    applyCollectionsResource(
      { revision: 8, collections: { loadouts: [{ ...canonicalLoadout(), lastUsed: 600 }] } },
      'loadouts',
    )
    expect(hasCollectionProjectionEpochChanged('loadouts', collectionEpoch)).toBe(true)
    expect(hasSettingsGroupProjectionEpochChanged('sidebar', settingsEpoch)).toBe(false)
    applySettingsGroupResource(
      { revision: 9, group: 'sidebar', settings: { lastLoadedLoadoutName: 'Authoritative' } },
      ['lastLoadedLoadoutName'],
    )
    expect(hasSettingsGroupProjectionEpochChanged('sidebar', settingsEpoch)).toBe(true)
  })

  it('rejects loadout acknowledgements for non-canonical collection or settings projections', () => {
    applySettingsResource({ revision: 3, settings: { lastLoadedLoadoutName: 'Before' } })
    applyCollectionsResource({
      revision: 3,
      collections: { ...completeCollections(), loadouts: [{ ...canonicalLoadout(), legacyMetadata: true } as never] },
    })

    expect(applyLoadoutMutationLocalEffect({ revision: 4, operation: 'create', loadoutId: 'loadout-b' })).toBe(false)
    withResourceDatabaseWrite(() => {
      getResourceDatabase().loadouts = [canonicalLoadout(), canonicalLoadout()] as never
    })
    expect(applyLoadoutMutationLocalEffect({ revision: 4, operation: 'delete', loadoutId: 'loadout-a' })).toBe(false)
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

  it('keeps narrow pointers newer than settings and resolves selection by character id', () => {
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
      currentChar: 0,
      characters: [{ chaId: 'char-a', lastInteraction: 88 }, { chaId: 'char-b' }],
    })
  })

  it('keeps character pointers newer than an unrelated settings acknowledgement fence', () => {
    replaceResourceDatabase(
      {
        ...completeCollections(),
        characters: [metadataCharacter('char-a', 'Ada'), metadataCharacter('char-b', 'Bea')],
        characterOrder: ['char-a'],
        currentChar: 0,
        modelPresets: [
          { id: 'model-a', name: 'A' },
          { id: 'model-b', name: 'B' },
        ],
        modelPresetsId: 0,
      } as never,
      3,
    )
    applyCharactersResource({
      revision: 4,
      characters: [metadataCharacter('char-a', 'Ada'), metadataCharacter('char-b', 'Bea')],
      characterOrder: ['char-a', 'char-b'],
      currentChar: 1,
    })

    expect(
      applyPresetReorderLocalEffect({
        revision: 5,
        presetKind: 'model',
        presetIds: ['model-a', 'model-b'],
        selectedPresetId: 'model-a',
        settingsWritten: true,
      }),
    ).toBe(true)

    expect(settingsResourceState.fullRevision).toBe(5)
    expect(settingsResourceState.pointerValueRevisions).toEqual({ characterOrder: 3, currentChar: 3 })
    expect(getResourceDatabase()).toMatchObject({
      characterOrder: ['char-a', 'char-b'],
      currentChar: 1,
    })
    expect(composeResourceDatabaseSnapshot()).toMatchObject({
      characterOrder: ['char-a', 'char-b'],
      currentChar: 1,
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

  it('preserves a newer resident lorebook across stale rows and accepts a newer row-owned body', () => {
    const resident = metadataCharacter('char-a', 'Resident')
    resident.globalLore = [{ key: 'resident', content: 'kept' }] as never
    applyCharactersResource({
      revision: 1,
      characters: [resident],
      characterOrder: ['char-a'],
      currentChar: 0,
    })
    markCharacterLorebookBodyResourceRevision('char-a', 4)

    const targeted = metadataCharacter('char-a', 'Targeted')
    targeted.globalLore = [{ key: 'stale-targeted', content: 'must not replace' }] as never
    expect(applyCharacterResource({ revision: 2, character: targeted })).toBe(true)
    expect(getResourceDatabase().characters[0].globalLore).toEqual([{ key: 'resident', content: 'kept' }])

    const listed = metadataCharacter('char-a', 'Listed')
    listed.globalLore = [{ key: 'stale-listed', content: 'must not replace' }] as never
    expect(
      applyCharactersResource({
        revision: 3,
        characters: [listed],
        characterOrder: ['char-a'],
        currentChar: 0,
      }),
    ).toBe(true)
    expect(getResourceDatabase().characters[0].globalLore).toEqual([{ key: 'resident', content: 'kept' }])

    const newer = metadataCharacter('char-a', 'Newer')
    newer.globalLore = [{ key: 'newer-row', content: 'authoritative' }] as never
    expect(applyCharacterResource({ revision: 5, character: newer })).toBe(true)
    expect(getResourceDatabase().characters[0].globalLore).toEqual([{ key: 'newer-row', content: 'authoritative' }])
    expect(hasNewerCharacterLorebookBodyResourceRevision('char-a', 4)).toBe(true)
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

      const acknowledged = metadataCharacter('char-a', 'Acknowledged')
      acknowledged.chats = [
        {
          id: 'chat-a',
          message: [],
          generationSettings: pendingSettings,
        } as unknown as (typeof acknowledged.chats)[number],
      ]
      expect(applyCharacterResource({ revision: 4, character: acknowledged })).toBe(true)

      const afterAcknowledgement = metadataCharacter('char-a', 'After acknowledgement')
      afterAcknowledgement.chats = [
        {
          id: 'chat-a',
          message: [],
          generationSettings: staleSettings,
        } as unknown as (typeof afterAcknowledgement.chats)[number],
      ]
      expect(applyCharacterResource({ revision: 5, character: afterAcknowledgement })).toBe(true)
      expect(getResourceDatabase().characters[0].chats[0].generationSettings).toEqual(staleSettings)
    } finally {
      clearPendingChatGenerationSettingsSave(pending)
    }
  })
})
