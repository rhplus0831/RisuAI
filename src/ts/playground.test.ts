import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { get } from 'svelte/store'

const playgroundState = vi.hoisted(() => ({
  database: {
    characters: [] as Array<Record<string, unknown>>,
    currentChar: -1,
  },
  commandShouldFail: false,
  persistedCharacter: null as Record<string, unknown> | null,
}))

const playgroundMocks = vi.hoisted(() => ({
  applyCharactersResource: vi.fn(),
  createAndSelectCharacterCommand: vi.fn(),
  dispatchSelectCharacter: vi.fn(),
  fetchServerCharacters: vi.fn(),
  resetChatHydration: vi.fn(),
  resetLorebookHydration: vi.fn(),
  recordHydratedCharacterLorebooks: vi.fn(),
  runServerCommand: vi.fn(),
}))

vi.mock('./util', () => ({
  findCharacterIndexbyId: (characterId: string) =>
    playgroundState.database.characters.findIndex((character) => character.chaId === characterId),
}))

vi.mock('./characters', () => ({
  characterFormatUpdate: (character: Record<string, unknown>) => {
    const formatted = structuredClone(character)
    const chats = formatted.chats as Array<Record<string, unknown>> | undefined
    if (!chats?.length) {
      formatted.chats = [{ id: 'local-playground-chat', message: [], name: 'Chat 1', note: '', localLore: [] }]
      formatted.chatPage = 0
    }
    return formatted
  },
  createBlankChar: () => ({
    chaId: 'blank',
    chatPage: 0,
    chats: [{ id: 'initial-playground-chat', message: [], name: 'Chat 1', note: '', localLore: [] }],
  }),
}))

vi.mock('./storage/database.svelte', () => ({
  getDatabase: () => playgroundState.database,
  setCharacterByIndex: (index: number, character: Record<string, unknown>) => {
    playgroundState.database.characters[index] = character
  },
}))

vi.mock('./stores.svelte', async () => {
  const { writable } = await import('svelte/store')
  return {
    PlaygroundStore: writable(0),
    selectedCharID: writable(-1),
  }
})

vi.mock('./characterCommands', () => ({
  currentCharacterSelectionSnapshot: () => ({}),
  dispatchSelectCharacter: playgroundMocks.dispatchSelectCharacter,
  initialCharacterChatSnapshot: (character: Record<string, unknown>) =>
    structuredClone((character.chats as Array<Record<string, unknown>>)[0]),
  toCharacterSnapshot: (character: Record<string, unknown>) => {
    const snapshot = structuredClone(character)
    delete snapshot.chats
    return snapshot
  },
}))

vi.mock('./server/resourceWriteGuard.svelte', () => ({
  withTrustedResourceWrite: <T>(write: () => T) => write(),
}))

vi.mock('./server/commands', () => ({
  canUseServerCommands: () => true,
  createAndSelectCharacterCommand: playgroundMocks.createAndSelectCharacterCommand,
  runServerCommand: playgroundMocks.runServerCommand,
}))

vi.mock('./server/resourceReads', () => ({
  fetchServerCharacters: playgroundMocks.fetchServerCharacters,
}))

vi.mock('./server/resourceState.svelte', () => ({
  applyCharactersResource: playgroundMocks.applyCharactersResource,
}))

vi.mock('./server/chatMessageHydration.svelte', () => ({
  resetChatHydration: playgroundMocks.resetChatHydration,
}))

vi.mock('./server/lorebookBridge.svelte', () => ({
  recordHydratedCharacterLorebooks: playgroundMocks.recordHydratedCharacterLorebooks,
  resetLorebookHydration: playgroundMocks.resetLorebookHydration,
}))

import { openPlaygroundChat, PLAYGROUND_CHARACTER_ID } from './playground'
import { PlaygroundStore, selectedCharID } from './stores.svelte'

function deferred<T>(): { promise: Promise<T>; resolve: (value: T) => void } {
  let resolve!: (value: T) => void
  const promise = new Promise<T>((innerResolve) => {
    resolve = innerResolve
  })
  return { promise, resolve }
}

beforeEach(() => {
  playgroundState.database.characters = []
  playgroundState.database.currentChar = -1
  playgroundState.commandShouldFail = false
  playgroundState.persistedCharacter = null
  selectedCharID.set(-1)
  PlaygroundStore.set(0)

  for (const mock of Object.values(playgroundMocks)) mock.mockReset()

  playgroundMocks.createAndSelectCharacterCommand.mockImplementation(
    async (input: { character: Record<string, unknown>; initialChat?: Record<string, unknown> }) => {
      if (playgroundState.commandShouldFail) {
        return { status: 'error', error: 'create failed' }
      }
      playgroundState.persistedCharacter = {
        ...structuredClone(input.character),
        chats: input.initialChat ? [structuredClone(input.initialChat)] : [],
      }
      return {
        status: 'ok',
        revision: 11,
        event: { type: 'character.createdAndSelected', revision: 11, resource: 'character' },
        characterId: PLAYGROUND_CHARACTER_ID,
      }
    },
  )
  playgroundMocks.fetchServerCharacters.mockImplementation(async () => ({
    status: 'ok',
    revision: 11,
    characters: playgroundState.persistedCharacter ? [structuredClone(playgroundState.persistedCharacter)] : [],
  }))
  playgroundMocks.applyCharactersResource.mockImplementation(
    (result: { characters: Array<Record<string, unknown>> }) => {
      playgroundState.database.characters = structuredClone(result.characters)
      return true
    },
  )
  playgroundMocks.runServerCommand.mockImplementation(
    async (input: { command: (baseRevision: number) => Promise<{ status: string }> }) => {
      const result = await input.command(10)
      if (result.status === 'ok') {
        const characters = await playgroundMocks.fetchServerCharacters()
        playgroundMocks.applyCharactersResource(characters)
      }
      return result
    },
  )
})

afterEach(() => {
  vi.restoreAllMocks()
})

describe('openPlaygroundChat', () => {
  it('uses the character collection read completed by command reconciliation', async () => {
    await openPlaygroundChat()

    expect(playgroundMocks.fetchServerCharacters).toHaveBeenCalledTimes(1)
    expect(playgroundMocks.createAndSelectCharacterCommand).toHaveBeenCalledWith(
      expect.objectContaining({
        baseRevision: 10,
        character: expect.objectContaining({ chaId: PLAYGROUND_CHARACTER_ID }),
      }),
    )
    expect(get(selectedCharID)).toBe(0)
    expect(get(PlaygroundStore)).toBe(2)
  })

  it('formats the reconciled first-create character with a local chat before selecting it', async () => {
    await openPlaygroundChat()

    expect(playgroundMocks.createAndSelectCharacterCommand).toHaveBeenCalledWith(
      expect.objectContaining({
        character: expect.not.objectContaining({ chats: expect.anything() }),
        initialChat: expect.objectContaining({
          id: 'initial-playground-chat',
          message: [],
        }),
      }),
    )
    expect(playgroundState.database.characters[0]).toMatchObject({
      chaId: PLAYGROUND_CHARACTER_ID,
      chatPage: 0,
      chats: [
        expect.objectContaining({
          id: 'initial-playground-chat',
          message: [],
        }),
      ],
    })
    expect(get(selectedCharID)).toBe(0)
  })

  it('does not refresh or select a playground character after a failed create', async () => {
    playgroundState.commandShouldFail = true
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined)

    await openPlaygroundChat()

    expect(playgroundMocks.fetchServerCharacters).not.toHaveBeenCalled()
    expect(playgroundState.database.characters).toEqual([])
    expect(get(selectedCharID)).toBe(-1)
    expect(warn).toHaveBeenCalledWith(
      'Unable to create playground character',
      expect.objectContaining({ status: 'error' }),
    )
  })

  it('does not select a newly created playground character after its route becomes stale', async () => {
    const command = deferred<{ status: 'ok' }>()
    playgroundMocks.runServerCommand.mockReturnValueOnce(command.promise)
    let routeIsFresh = true

    const opening = openPlaygroundChat({ isFresh: () => routeIsFresh })
    expect(get(PlaygroundStore)).toBe(2)

    routeIsFresh = false
    PlaygroundStore.set(0)
    selectedCharID.set(-1)
    playgroundState.database.characters = [{ chaId: PLAYGROUND_CHARACTER_ID }]
    command.resolve({ status: 'ok' })
    await opening

    expect(get(PlaygroundStore)).toBe(0)
    expect(get(selectedCharID)).toBe(-1)
  })
})
