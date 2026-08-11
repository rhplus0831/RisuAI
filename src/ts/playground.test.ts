import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { get } from 'svelte/store'

const playgroundState = vi.hoisted(() => ({
  database: {
    characters: [] as Array<Record<string, unknown>>,
    characterOrder: [] as string[],
    currentChar: -1,
  },
}))

const playgroundMocks = vi.hoisted(() => ({
  alertNormal: vi.fn(),
  dispatchCreateAndSelectCharacter: vi.fn(),
  dispatchSelectCharacter: vi.fn(),
}))

vi.mock('./alert', () => ({
  alertNormal: playgroundMocks.alertNormal,
}))

vi.mock('../lang', () => ({
  language: { characterCreationQueued: 'Character creation queued' },
}))

vi.mock('./characterState', () => ({
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
  currentCharacterStateSnapshot: () => ({
    characters: structuredClone(playgroundState.database.characters),
    characterOrder: structuredClone(playgroundState.database.characterOrder),
    currentChar: playgroundState.database.currentChar,
    selectedCharID: playgroundState.database.currentChar,
  }),
  dispatchCreateAndSelectCharacter: playgroundMocks.dispatchCreateAndSelectCharacter,
  dispatchSelectCharacter: playgroundMocks.dispatchSelectCharacter,
  restoreCharacterState: (snapshot: {
    characters: Array<Record<string, unknown>>
    characterOrder: string[]
    currentChar: number
    selectedCharID: number
  }) => {
    playgroundState.database.characters = structuredClone(snapshot.characters)
    playgroundState.database.characterOrder = structuredClone(snapshot.characterOrder)
    playgroundState.database.currentChar = snapshot.currentChar
  },
}))

vi.mock('./server/resourceWriteGuard.svelte', () => ({
  withTrustedResourceWrite: <T>(write: () => T) => write(),
}))

vi.mock('./server/commands', () => ({
  canUseServerCommands: () => true,
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

function successfulCreateResult() {
  return {
    status: 'accepted' as const,
    result: {
      status: 'ok' as const,
      revision: 11,
      event: { type: 'character.createdAndSelected', revision: 11, resource: 'character' },
      characterId: PLAYGROUND_CHARACTER_ID,
    },
  }
}

beforeEach(() => {
  playgroundState.database.characters = []
  playgroundState.database.characterOrder = []
  playgroundState.database.currentChar = -1
  selectedCharID.set(-1)
  PlaygroundStore.set(0)
  for (const mock of Object.values(playgroundMocks)) mock.mockReset()
  playgroundMocks.dispatchCreateAndSelectCharacter.mockResolvedValue(successfulCreateResult())
})

afterEach(() => {
  vi.restoreAllMocks()
})

describe('openPlaygroundChat', () => {
  it('projects and selects a new character through the durable create-and-select dispatcher', async () => {
    const accepted = deferred<ReturnType<typeof successfulCreateResult>>()
    playgroundMocks.dispatchCreateAndSelectCharacter.mockReturnValueOnce(accepted.promise)

    const opening = openPlaygroundChat()

    expect(playgroundMocks.dispatchCreateAndSelectCharacter).toHaveBeenCalledWith(
      expect.objectContaining({ chaId: PLAYGROUND_CHARACTER_ID }),
      expect.objectContaining({ characters: [], selectedCharID: -1 }),
      expect.any(Number),
      { shouldRestoreSelection: expect.any(Function) },
    )
    expect(playgroundState.database.characters.map((character) => character.chaId)).toEqual([PLAYGROUND_CHARACTER_ID])
    expect(playgroundState.database.currentChar).toBe(0)
    expect(get(selectedCharID)).toBe(0)
    expect(get(PlaygroundStore)).toBe(2)

    accepted.resolve(successfulCreateResult())
    await opening
  })

  it('keeps the starter chat in the optimistic first-create projection', async () => {
    await openPlaygroundChat()

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
  })

  it('keeps a transiently retained playground projection usable instead of stranding the mode', async () => {
    playgroundMocks.dispatchCreateAndSelectCharacter.mockResolvedValueOnce({
      status: 'queued',
      result: { status: 'unavailable' },
    })
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined)

    await openPlaygroundChat()

    expect(playgroundState.database.characters[0]?.chaId).toBe(PLAYGROUND_CHARACTER_ID)
    expect(get(selectedCharID)).toBe(0)
    expect(get(PlaygroundStore)).toBe(2)
    expect(playgroundMocks.alertNormal).toHaveBeenCalledWith('Character creation queued')
    expect(warn).not.toHaveBeenCalled()
  })

  it('restores the prior mode and selection after a terminal create rollback', async () => {
    playgroundState.database.characters = [{ chaId: 'char-a', name: 'A', chats: [] }]
    playgroundState.database.characterOrder = ['char-a']
    playgroundState.database.currentChar = 0
    selectedCharID.set(0)
    PlaygroundStore.set(4)
    playgroundMocks.dispatchCreateAndSelectCharacter.mockImplementationOnce(
      async (
        _character: Record<string, unknown>,
        previous: {
          characters: Array<Record<string, unknown>>
          characterOrder: string[]
          currentChar: number
          selectedCharID: number
        },
        _lastInteraction: number,
        options: { shouldRestoreSelection: () => boolean },
      ) => {
        playgroundState.database.characters = structuredClone(previous.characters)
        playgroundState.database.characterOrder = structuredClone(previous.characterOrder)
        playgroundState.database.currentChar = previous.currentChar
        if (options.shouldRestoreSelection()) selectedCharID.set(previous.selectedCharID)
        return {
          status: 'failed',
          result: { status: 'error', error: 'invalid create', reason: 'invalid-request' },
        }
      },
    )
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined)

    await openPlaygroundChat()

    expect(playgroundState.database.characters.map((character) => character.chaId)).toEqual(['char-a'])
    expect(playgroundState.database.currentChar).toBe(0)
    expect(get(selectedCharID)).toBe(0)
    expect(get(PlaygroundStore)).toBe(4)
    expect(warn).toHaveBeenCalledWith(
      'Unable to create playground character',
      expect.objectContaining({
        status: 'failed',
        result: expect.objectContaining({ status: 'error', reason: 'invalid-request' }),
      }),
    )
  })

  it('restores the prior mode when dispatch completes without a live projection', async () => {
    PlaygroundStore.set(7)
    vi.spyOn(console, 'warn').mockImplementation(() => undefined)
    playgroundMocks.dispatchCreateAndSelectCharacter.mockImplementationOnce(async () => {
      playgroundState.database.characters = []
      playgroundState.database.currentChar = -1
      selectedCharID.set(-1)
      return { status: 'failed', result: { status: 'unavailable' } }
    })

    await openPlaygroundChat()

    expect(get(PlaygroundStore)).toBe(7)
    expect(get(selectedCharID)).toBe(-1)
  })

  it('restores the prior mode and selection when durable staging throws synchronously', async () => {
    playgroundState.database.characters = [{ chaId: 'char-a', name: 'A', chats: [] }]
    playgroundState.database.characterOrder = ['char-a']
    playgroundState.database.currentChar = 0
    selectedCharID.set(0)
    PlaygroundStore.set(8)
    playgroundMocks.dispatchCreateAndSelectCharacter.mockImplementationOnce(() => {
      throw new RangeError('Pending mutation payload is too large')
    })
    vi.spyOn(console, 'warn').mockImplementation(() => undefined)

    await expect(openPlaygroundChat()).resolves.toBeUndefined()

    expect(playgroundState.database.characters.map((character) => character.chaId)).toEqual(['char-a'])
    expect(playgroundState.database.currentChar).toBe(0)
    expect(get(selectedCharID)).toBe(0)
    expect(get(PlaygroundStore)).toBe(8)
  })

  it('does not submit a duplicate create when the playground route remounts while creation is queued', async () => {
    const queued = deferred<{ status: 'queued'; result: { status: 'unavailable' } }>()
    playgroundMocks.dispatchCreateAndSelectCharacter.mockReturnValueOnce(queued.promise)

    const firstOpening = openPlaygroundChat()
    selectedCharID.set(-1)
    const secondOpening = openPlaygroundChat()

    expect(playgroundMocks.dispatchCreateAndSelectCharacter).toHaveBeenCalledOnce()
    expect(playgroundMocks.dispatchSelectCharacter).not.toHaveBeenCalled()
    expect(
      playgroundState.database.characters.filter((character) => character.chaId === PLAYGROUND_CHARACTER_ID),
    ).toHaveLength(1)

    queued.resolve({ status: 'queued', result: { status: 'unavailable' } })
    await Promise.all([firstOpening, secondOpening])
    expect(get(selectedCharID)).toBe(0)
    expect(get(PlaygroundStore)).toBe(2)
    expect(playgroundMocks.alertNormal).toHaveBeenCalledWith('Character creation queued')
  })

  it('restores the original mode when a fresh reopen shares a create that later fails terminally', async () => {
    playgroundState.database.characters = [{ chaId: 'char-a', name: 'A', chats: [] }]
    playgroundState.database.characterOrder = ['char-a']
    playgroundState.database.currentChar = 0
    selectedCharID.set(0)
    PlaygroundStore.set(6)
    const command = deferred<void>()
    let firstRouteIsFresh = true
    let reopenedRouteIsFresh = true
    playgroundMocks.dispatchCreateAndSelectCharacter.mockImplementationOnce(
      async (
        _character: Record<string, unknown>,
        previous: {
          characters: Array<Record<string, unknown>>
          characterOrder: string[]
          currentChar: number
          selectedCharID: number
        },
        _lastInteraction: number,
        options: { shouldRestoreSelection: () => boolean },
      ) => {
        await command.promise
        playgroundState.database.characters = structuredClone(previous.characters)
        playgroundState.database.characterOrder = structuredClone(previous.characterOrder)
        playgroundState.database.currentChar = previous.currentChar
        if (options.shouldRestoreSelection()) selectedCharID.set(previous.selectedCharID)
        return {
          status: 'failed',
          result: { status: 'error', error: 'invalid create', reason: 'invalid-request' },
        }
      },
    )
    vi.spyOn(console, 'warn').mockImplementation(() => undefined)

    const firstOpening = openPlaygroundChat({ isFresh: () => firstRouteIsFresh })
    firstRouteIsFresh = false
    const reopened = openPlaygroundChat({ isFresh: () => reopenedRouteIsFresh })
    expect(playgroundMocks.dispatchCreateAndSelectCharacter).toHaveBeenCalledOnce()

    command.resolve()
    await Promise.all([firstOpening, reopened])

    expect(playgroundState.database.characters.map((character) => character.chaId)).toEqual(['char-a'])
    expect(playgroundState.database.currentChar).toBe(0)
    expect(get(selectedCharID)).toBe(0)
    expect(get(PlaygroundStore)).toBe(6)
    reopenedRouteIsFresh = false
  })

  it('does not reselect or restore playground state after its route becomes stale', async () => {
    const command = deferred<void>()
    let routeIsFresh = true
    playgroundMocks.dispatchCreateAndSelectCharacter.mockImplementationOnce(
      async (
        _character: Record<string, unknown>,
        _previous: unknown,
        _lastInteraction: number,
        options: { shouldRestoreSelection: () => boolean },
      ) => {
        await command.promise
        playgroundState.database.characters = []
        playgroundState.database.currentChar = -1
        if (options.shouldRestoreSelection()) selectedCharID.set(0)
        return {
          status: 'failed',
          result: { status: 'error', error: 'invalid create', reason: 'invalid-request' },
        }
      },
    )

    const opening = openPlaygroundChat({ isFresh: () => routeIsFresh })
    expect(get(selectedCharID)).toBe(0)
    expect(get(PlaygroundStore)).toBe(2)

    routeIsFresh = false
    PlaygroundStore.set(0)
    selectedCharID.set(-1)
    command.resolve()
    await opening

    expect(get(PlaygroundStore)).toBe(0)
    expect(get(selectedCharID)).toBe(-1)
  })
})
