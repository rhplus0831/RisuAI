import { beforeEach, describe, expect, it } from 'vitest'
import { getResourceDatabase, replaceResourceDatabase } from './server/resourceState.svelte'
import type { Database } from './storage/database.svelte'
import { optimisticallyRehomeGenerationReferences } from './generationReferenceCascade'

function seedDatabase(input: { characters?: unknown[]; loadouts?: unknown[]; promptPresets?: unknown[] }): void {
  replaceResourceDatabase({
    characters: input.characters ?? [],
    loadouts: input.loadouts ?? [],
    promptPresets: input.promptPresets ?? [],
  } as unknown as Database)
}

function character(chaId: string, chatId: string, modelPresetId: string): unknown {
  return {
    chaId,
    chatPage: 0,
    chats: [{ id: chatId, message: [], generationSettings: { modelPresetId } }],
  }
}

describe('generation reference cascade owner resolution', () => {
  beforeEach(() => {
    seedDatabase({})
  })

  it('rehomes and rolls back through the unique character/chat owner', () => {
    seedDatabase({ characters: [character('character-a', 'chat-a', 'model-deleted')] })

    const cascade = optimisticallyRehomeGenerationReferences({
      getDatabase: getResourceDatabase,
      kind: 'modelPreset',
      deletedId: 'model-deleted',
      replacement: { id: 'model-replacement', name: 'Replacement' },
    })

    expect(cascade.chatCount).toBe(1)
    expect(getResourceDatabase().characters[0].chats[0].generationSettings?.modelPresetId).toBe('model-replacement')

    cascade.rollback()
    expect(getResourceDatabase().characters[0].chats[0].generationSettings?.modelPresetId).toBe('model-deleted')
  })

  it('fails closed when the stable character owner is ambiguous', () => {
    seedDatabase({
      characters: [
        character('duplicate-character', 'chat-a', 'model-deleted'),
        character('duplicate-character', 'chat-b', 'model-deleted'),
      ],
    })

    const cascade = optimisticallyRehomeGenerationReferences({
      getDatabase: getResourceDatabase,
      kind: 'modelPreset',
      deletedId: 'model-deleted',
      replacement: { id: 'model-replacement', name: 'Replacement' },
    })

    expect(cascade.chatCount).toBe(0)
    expect(getResourceDatabase().characters[0].chats[0].generationSettings?.modelPresetId).toBe('model-deleted')
    expect(getResourceDatabase().characters[1].chats[0].generationSettings?.modelPresetId).toBe('model-deleted')
  })

  it('uses explicit collection owners without invoking the aggregate accessor', () => {
    seedDatabase({
      characters: [character('character-a', 'chat-a', 'model-deleted')],
      loadouts: [{ id: 'loadout-a', modelPresetId: 'model-deleted', modelPresetName: 'Deleted' }],
      promptPresets: [{ id: 'prompt-a', recommendedModelPresetId: 'model-deleted' }],
    })
    const aggregateAccessor = () => {
      throw new Error('aggregate database access is forbidden')
    }

    const cascade = optimisticallyRehomeGenerationReferences({
      getDatabase: aggregateAccessor,
      kind: 'modelPreset',
      deletedId: 'model-deleted',
      replacement: { id: 'model-replacement', name: 'Replacement' },
    })

    expect(cascade).toMatchObject({ chatCount: 1, loadoutCount: 1, promptRecommendationCount: 1 })
    expect(getResourceDatabase().loadouts[0]).toMatchObject({
      modelPresetId: 'model-replacement',
      modelPresetName: 'Replacement',
    })
    expect(getResourceDatabase().promptPresets[0].recommendedModelPresetId).toBeNull()

    cascade.rollback()
    expect(getResourceDatabase().loadouts[0]).toMatchObject({
      modelPresetId: 'model-deleted',
      modelPresetName: 'Deleted',
    })
    expect(getResourceDatabase().promptPresets[0].recommendedModelPresetId).toBe('model-deleted')
  })

  it('fails closed when a stable chat id has multiple global owners', () => {
    seedDatabase({
      characters: [
        character('character-a', 'duplicate-chat', 'model-deleted'),
        character('character-b', 'duplicate-chat', 'model-deleted'),
      ],
    })

    const cascade = optimisticallyRehomeGenerationReferences({
      getDatabase: getResourceDatabase,
      kind: 'modelPreset',
      deletedId: 'model-deleted',
      replacement: { id: 'model-replacement' },
    })

    expect(cascade.chatCount).toBe(0)
    expect(getResourceDatabase().characters.map((row) => row.chats[0].generationSettings?.modelPresetId)).toEqual([
      'model-deleted',
      'model-deleted',
    ])
  })

  it('does not roll an owner back across authoritative replacement', () => {
    seedDatabase({ characters: [character('character-a', 'chat-a', 'model-deleted')] })
    const cascade = optimisticallyRehomeGenerationReferences({
      getDatabase: getResourceDatabase,
      kind: 'modelPreset',
      deletedId: 'model-deleted',
      replacement: { id: 'model-replacement' },
    })

    seedDatabase({ characters: [character('character-a', 'chat-a', 'model-authoritative')] })
    cascade.rollback()

    expect(getResourceDatabase().characters[0].chats[0].generationSettings?.modelPresetId).toBe('model-authoritative')
  })
})
