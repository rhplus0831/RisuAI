import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { Chat, Database } from '../storage/database.svelte'

const ownerState = vi.hoisted(() => ({
  aggregate: {} as any,
  characters: {
    characters: [] as any[],
    currentChar: 0,
    status: 'ready' as 'idle' | 'loading' | 'ready' | 'error',
  },
  collections: {
    values: {} as Record<string, unknown>,
    status: 'ready' as 'idle' | 'loading' | 'ready' | 'error',
    statuses: { promptPresets: 'ready' } as Record<string, 'idle' | 'loading' | 'ready' | 'error'>,
  },
  settings: {
    value: {} as Record<string, unknown>,
    status: 'ready' as 'idle' | 'loading' | 'ready' | 'error',
    groupStatuses: { prompt: 'ready' } as Record<string, 'idle' | 'loading' | 'ready' | 'error'>,
  },
}))

vi.mock('../storage/database.svelte', () => ({
  getDatabase: () => ownerState.aggregate,
  getCurrentChat: () => {
    const character = ownerState.aggregate.characters?.[ownerState.aggregate.currentChar ?? 0]
    return character?.chats?.[character.chatPage]
  },
}))

vi.mock('../characterState', () => ({
  getSelectedCharacterOwner: () => {
    const candidate = ownerState.characters.characters[ownerState.characters.currentChar]
    if (!candidate?.chaId) return undefined
    return ownerState.characters.characters.filter((character) => character.chaId === candidate.chaId).length === 1
      ? candidate
      : undefined
  },
}))

vi.mock('../server/resourceState.svelte', () => ({
  charactersResourceState: ownerState.characters,
  collectionsResourceState: ownerState.collections,
  settingsResourceState: ownerState.settings,
  getCharacterResourceOwner: (characterId: string) => {
    const matches = ownerState.characters.characters.filter((character) => character.chaId === characterId)
    return matches.length === 1 ? matches[0] : undefined
  },
  getChatMetadataOwnerState: (chatId: string) => {
    const matches = ownerState.characters.characters.flatMap((character) =>
      character.chats.filter((candidate: Chat) => candidate.id === chatId),
    )
    return matches.length === 1 ? { chatId } : undefined
  },
}))

import { getActivePromptPresetRegexScripts } from './promptPresetRegex'

function chat(promptPresetId: string): Chat {
  return { id: 'chat-a', generationSettings: { promptPresetId } } as Chat
}

function database(promptPresets: unknown[]): Database {
  return {
    promptPresets,
    presetRegex: [{ id: 'legacy', in: 'legacy', out: 'legacy', type: 'editprocess' }],
  } as unknown as Database
}

beforeEach(() => {
  const currentChat = chat('prompt-owner')
  ownerState.aggregate = {
    currentChar: 0,
    characters: [{ chaId: 'character-a', chatPage: 0, chats: [currentChat] }],
    presetRegex: [{ id: 'aggregate-fallback' }],
    promptPresets: [{ id: 'prompt-owner', presetRegex: [{ id: 'aggregate-owner' }] }],
  }
  ownerState.characters.characters = [{ chaId: 'character-a', chatPage: 0, chats: [currentChat] }]
  ownerState.characters.currentChar = 0
  ownerState.characters.status = 'ready'
  ownerState.collections.values = {
    promptPresets: [{ id: 'prompt-owner', presetRegex: [{ id: 'canonical-owner' }] }],
  }
  ownerState.collections.status = 'ready'
  ownerState.collections.statuses.promptPresets = 'ready'
  ownerState.settings.value = { presetRegex: [{ id: 'canonical-fallback' }] }
  ownerState.settings.status = 'ready'
  ownerState.settings.groupStatuses.prompt = 'ready'
})

describe('getActivePromptPresetRegexScripts', () => {
  it('uses the ready prompt collection and selected chat owners instead of the aggregate', () => {
    expect(getActivePromptPresetRegexScripts()).toEqual([{ id: 'canonical-owner' }])
  })

  it('uses the ready prompt-settings owner for the unbound fallback', () => {
    ownerState.characters.characters[0].chats[0].generationSettings = {}

    expect(getActivePromptPresetRegexScripts()).toEqual([{ id: 'canonical-fallback' }])
  })

  it('fails closed after any required owner errors', () => {
    ownerState.collections.statuses.promptPresets = 'error'

    expect(getActivePromptPresetRegexScripts()).toEqual([])
  })

  it('accepts an explicit chat owner when ambient character selection is unavailable', () => {
    ownerState.characters.status = 'error'

    expect(getActivePromptPresetRegexScripts(undefined, chat('prompt-owner'))).toEqual([{ id: 'canonical-owner' }])
  })

  it('fails closed instead of selecting the first duplicate prompt owner', () => {
    expect(
      getActivePromptPresetRegexScripts(
        database([
          { id: 'prompt-a', presetRegex: [{ id: 'first' }] },
          { id: 'prompt-a', presetRegex: [{ id: 'second' }] },
        ]),
        chat('prompt-a'),
      ),
    ).toEqual([])
  })

  it('does not use the aggregate regex when the selected prompt owner is missing', () => {
    expect(getActivePromptPresetRegexScripts(database([{ id: 'other' }]), chat('prompt-a'))).toEqual([])
  })
})
