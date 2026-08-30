import { beforeEach, describe, expect, it } from 'vitest'
import { getResourceDatabase, replaceResourceDatabase } from './server/resourceState.svelte'
import type { Database } from './storage/database.svelte'
import { optimisticallyRehomeGenerationReferences } from './generationReferenceCascade'

function seedDatabase(characters: unknown[]): void {
  replaceResourceDatabase({ characters } as unknown as Database)
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
    seedDatabase([])
  })

  it('rehomes and rolls back through the unique character/chat owner', () => {
    seedDatabase([character('character-a', 'chat-a', 'model-deleted')])

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
    seedDatabase([
      character('duplicate-character', 'chat-a', 'model-deleted'),
      character('duplicate-character', 'chat-b', 'model-deleted'),
    ])

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
})
