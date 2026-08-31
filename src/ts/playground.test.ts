import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { get } from 'svelte/store'

const playgroundState = vi.hoisted(() => ({
  canUseServerCommands: true,
  charactersResourceState: {
    characters: [] as Array<Record<string, unknown>>,
    characterOrder: [] as string[],
    currentChar: -1,
    revision: 10 as number | null,
    listRevision: 10 as number | null,
    orderRevision: 10 as number | null,
    selectionRevision: 10 as number | null,
    rowRevisions: {} as Record<string, number>,
    status: 'ready' as 'idle' | 'loading' | 'ready' | 'error',
    rowStatuses: {} as Record<string, 'idle' | 'loading' | 'ready' | 'error'>,
    error: null as string | null,
    rowErrors: {} as Record<string, string>,
  },
}))

const playgroundMocks = vi.hoisted(() => ({
  alertNormal: vi.fn(),
  applyCharacterRowMutationScoped: vi.fn(),
  dispatchCreateAndSelectCharacter: vi.fn(),
  dispatchSelectCharacter: vi.fn(),
}))

vi.mock('./alert', () => ({
  alertNormal: playgroundMocks.alertNormal,
}))

vi.mock('../lang', () => ({
  language: { characterCreationQueued: 'Character creation queued' },
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

vi.mock('./stores.svelte', async () => {
  const { writable } = await import('svelte/store')
  return {
    PlaygroundStore: writable(0),
    selectedCharID: writable(-1),
  }
})

vi.mock('./server/resourceState.svelte', () => ({
  charactersResourceState: playgroundState.charactersResourceState,
}))

vi.mock('./characterCommands', async () => {
  const { get } = await import('svelte/store')
  const { selectedCharID } = await import('./stores.svelte')
  return {
    applyCharacterRowMutationScoped: playgroundMocks.applyCharacterRowMutationScoped,
    cloneJsonValue: <T>(value: T): T => JSON.parse(JSON.stringify(value)) as T,
    currentCharacterSelectionSnapshot: (characterId: string) => {
      const matches = playgroundState.charactersResourceState.characters.filter(
        (character) => character.chaId === characterId,
      )
      return {
        characterId,
        lastInteraction: matches.length === 1 ? matches[0].lastInteraction : undefined,
        currentChar: playgroundState.charactersResourceState.currentChar,
        selectedCharID: get(selectedCharID),
      }
    },
    dispatchCreateAndSelectCharacter: playgroundMocks.dispatchCreateAndSelectCharacter,
    dispatchSelectCharacter: playgroundMocks.dispatchSelectCharacter,
    restoreCharacterSelection: (snapshot: {
      characterId: string
      lastInteraction: number | undefined
      currentChar: number
      selectedCharID: number
    }) => {
      const matches = playgroundState.charactersResourceState.characters.filter(
        (character) => character.chaId === snapshot.characterId,
      )
      if (matches.length === 1) matches[0].lastInteraction = snapshot.lastInteraction
      playgroundState.charactersResourceState.currentChar = snapshot.currentChar
      selectedCharID.set(snapshot.selectedCharID)
    },
  }
})

vi.mock('./server/commands', () => ({
  canUseServerCommands: () => playgroundState.canUseServerCommands,
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

function restoreCreateSnapshot(snapshot: {
  characters: Array<Record<string, unknown>>
  characterOrder: string[]
  currentChar: number
  selectedCharID: number
}): void {
  playgroundState.charactersResourceState.characters = structuredClone(snapshot.characters)
  playgroundState.charactersResourceState.characterOrder = structuredClone(snapshot.characterOrder)
  playgroundState.charactersResourceState.currentChar = snapshot.currentChar
  selectedCharID.set(snapshot.selectedCharID)
}

beforeEach(() => {
  playgroundState.canUseServerCommands = true
  Object.assign(playgroundState.charactersResourceState, {
    characters: [],
    characterOrder: [],
    currentChar: -1,
    revision: 10,
    listRevision: 10,
    orderRevision: 10,
    selectionRevision: 10,
    rowRevisions: {},
    status: 'ready',
    rowStatuses: {},
    error: null,
    rowErrors: {},
  })
  selectedCharID.set(-1)
  PlaygroundStore.set(0)
  for (const mock of Object.values(playgroundMocks)) mock.mockReset()
  playgroundMocks.applyCharacterRowMutationScoped.mockImplementation(
    (index: number, characterId: string, mutate: (character: Record<string, unknown>) => void) => {
      const candidate = playgroundState.charactersResourceState.characters[index]
      const matches = playgroundState.charactersResourceState.characters.filter(
        (character) => character.chaId === characterId,
      )
      if (!candidate || candidate.chaId !== characterId || matches.length !== 1) return false
      mutate(candidate)
      return true
    },
  )
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
    expect(playgroundState.charactersResourceState.characters.map((character) => character.chaId)).toEqual([
      PLAYGROUND_CHARACTER_ID,
    ])
    expect(playgroundState.charactersResourceState.currentChar).toBe(0)
    expect(get(selectedCharID)).toBe(0)
    expect(get(PlaygroundStore)).toBe(2)

    accepted.resolve(successfulCreateResult())
    await opening
  })

  it('keeps the starter chat in the optimistic first-create projection', async () => {
    await openPlaygroundChat()

    expect(playgroundState.charactersResourceState.characters[0]).toMatchObject({
      chaId: PLAYGROUND_CHARACTER_ID,
      chatPage: 0,
      chats: [expect.objectContaining({ id: 'initial-playground-chat', message: [] })],
    })
  })

  it('keeps a queued playground projection usable and reports retained intent', async () => {
    playgroundMocks.dispatchCreateAndSelectCharacter.mockResolvedValueOnce({
      status: 'queued',
      result: { status: 'unavailable' },
    })
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined)

    await openPlaygroundChat()

    expect(playgroundState.charactersResourceState.characters[0]?.chaId).toBe(PLAYGROUND_CHARACTER_ID)
    expect(playgroundState.charactersResourceState.currentChar).toBe(0)
    expect(get(selectedCharID)).toBe(0)
    expect(get(PlaygroundStore)).toBe(2)
    expect(playgroundMocks.alertNormal).toHaveBeenCalledWith('Character creation queued')
    expect(warn).not.toHaveBeenCalled()
  })

  it('restores the prior mode and owner selection after a terminal create rollback', async () => {
    playgroundState.charactersResourceState.characters = [{ chaId: 'char-a', name: 'A', chats: [] }]
    playgroundState.charactersResourceState.characterOrder = ['char-a']
    playgroundState.charactersResourceState.currentChar = 0
    selectedCharID.set(0)
    PlaygroundStore.set(4)
    playgroundMocks.dispatchCreateAndSelectCharacter.mockImplementationOnce(
      async (_character: unknown, previous: Parameters<typeof restoreCreateSnapshot>[0]) => {
        restoreCreateSnapshot(previous)
        return {
          status: 'failed',
          result: { status: 'error', error: 'invalid create', reason: 'invalid-request' },
        }
      },
    )
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined)

    await openPlaygroundChat()

    expect(playgroundState.charactersResourceState.characters.map((character) => character.chaId)).toEqual(['char-a'])
    expect(playgroundState.charactersResourceState.currentChar).toBe(0)
    expect(get(selectedCharID)).toBe(0)
    expect(get(PlaygroundStore)).toBe(4)
    expect(warn).toHaveBeenCalledWith(
      'Unable to create playground character',
      expect.objectContaining({ status: 'failed' }),
    )
  })

  it('restores the prior mode when dispatch completes without a live projection', async () => {
    PlaygroundStore.set(7)
    vi.spyOn(console, 'warn').mockImplementation(() => undefined)
    playgroundMocks.dispatchCreateAndSelectCharacter.mockImplementationOnce(async () => {
      playgroundState.charactersResourceState.characters = []
      playgroundState.charactersResourceState.currentChar = -1
      selectedCharID.set(-1)
      return { status: 'failed', result: { status: 'unavailable' } }
    })

    await openPlaygroundChat()

    expect(get(PlaygroundStore)).toBe(7)
    expect(get(selectedCharID)).toBe(-1)
  })

  it('rolls back only its fenced optimistic create when durable staging throws synchronously', async () => {
    playgroundState.charactersResourceState.characters = [{ chaId: 'char-a', name: 'A', chats: [] }]
    playgroundState.charactersResourceState.characterOrder = ['char-a']
    playgroundState.charactersResourceState.currentChar = 0
    selectedCharID.set(0)
    PlaygroundStore.set(8)
    playgroundMocks.dispatchCreateAndSelectCharacter.mockImplementationOnce(() => {
      throw new RangeError('Pending mutation payload is too large')
    })
    vi.spyOn(console, 'warn').mockImplementation(() => undefined)

    await expect(openPlaygroundChat()).resolves.toBeUndefined()

    expect(playgroundState.charactersResourceState.characters.map((character) => character.chaId)).toEqual(['char-a'])
    expect(playgroundState.charactersResourceState.currentChar).toBe(0)
    expect(get(selectedCharID)).toBe(0)
    expect(get(PlaygroundStore)).toBe(8)
  })

  it('does not overwrite a newer authoritative owner when synchronous dispatch failure loses its fence', async () => {
    playgroundState.charactersResourceState.characters = [{ chaId: 'char-a', name: 'A', chats: [] }]
    playgroundState.charactersResourceState.characterOrder = ['char-a']
    playgroundState.charactersResourceState.currentChar = 0
    selectedCharID.set(0)
    playgroundMocks.dispatchCreateAndSelectCharacter.mockImplementationOnce(() => {
      playgroundState.charactersResourceState.listRevision = 11
      playgroundState.charactersResourceState.selectionRevision = 11
      playgroundState.charactersResourceState.characters[1] = {
        chaId: PLAYGROUND_CHARACTER_ID,
        name: 'Authoritative playground',
        chats: [],
      }
      playgroundState.charactersResourceState.currentChar = 1
      selectedCharID.set(1)
      throw new Error('transport setup failed')
    })
    vi.spyOn(console, 'warn').mockImplementation(() => undefined)

    await openPlaygroundChat()

    expect(playgroundState.charactersResourceState.characters).toEqual([
      expect.objectContaining({ chaId: 'char-a' }),
      expect.objectContaining({ chaId: PLAYGROUND_CHARACTER_ID, name: 'Authoritative playground' }),
    ])
    expect(playgroundState.charactersResourceState.currentChar).toBe(1)
    expect(get(selectedCharID)).toBe(1)
  })

  it('does not submit a duplicate create when the route remounts while creation is queued', async () => {
    const queued = deferred<{ status: 'queued'; result: { status: 'unavailable' } }>()
    playgroundMocks.dispatchCreateAndSelectCharacter.mockReturnValueOnce(queued.promise)

    const firstOpening = openPlaygroundChat()
    selectedCharID.set(-1)
    const secondOpening = openPlaygroundChat()

    expect(playgroundMocks.dispatchCreateAndSelectCharacter).toHaveBeenCalledOnce()
    expect(playgroundMocks.dispatchSelectCharacter).not.toHaveBeenCalled()
    expect(
      playgroundState.charactersResourceState.characters.filter(
        (character) => character.chaId === PLAYGROUND_CHARACTER_ID,
      ),
    ).toHaveLength(1)

    queued.resolve({ status: 'queued', result: { status: 'unavailable' } })
    await Promise.all([firstOpening, secondOpening])
    expect(get(selectedCharID)).toBe(0)
    expect(get(PlaygroundStore)).toBe(2)
  })

  it('restores the original mode when a fresh reopen shares a create that later fails terminally', async () => {
    playgroundState.charactersResourceState.characters = [{ chaId: 'char-a', name: 'A', chats: [] }]
    playgroundState.charactersResourceState.characterOrder = ['char-a']
    playgroundState.charactersResourceState.currentChar = 0
    selectedCharID.set(0)
    PlaygroundStore.set(6)
    const command = deferred<void>()
    let firstRouteIsFresh = true
    let reopenedRouteIsFresh = true
    playgroundMocks.dispatchCreateAndSelectCharacter.mockImplementationOnce(
      async (_character: unknown, previous: Parameters<typeof restoreCreateSnapshot>[0]) => {
        await command.promise
        restoreCreateSnapshot(previous)
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

    expect(playgroundState.charactersResourceState.characters.map((character) => character.chaId)).toEqual(['char-a'])
    expect(playgroundState.charactersResourceState.currentChar).toBe(0)
    expect(get(selectedCharID)).toBe(0)
    expect(get(PlaygroundStore)).toBe(6)
    reopenedRouteIsFresh = false
  })

  it('does not reselect or restore playground state after its route becomes stale', async () => {
    const command = deferred<void>()
    let routeIsFresh = true
    playgroundMocks.dispatchCreateAndSelectCharacter.mockImplementationOnce(async () => {
      await command.promise
      playgroundState.charactersResourceState.characters = []
      playgroundState.charactersResourceState.currentChar = -1
      selectedCharID.set(-1)
      return {
        status: 'failed',
        result: { status: 'error', error: 'invalid create', reason: 'invalid-request' },
      }
    })

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

  it('formats and selects an existing unique canonical owner through scoped commands', async () => {
    playgroundState.charactersResourceState.characters = [
      { chaId: PLAYGROUND_CHARACTER_ID, name: 'Old', utilityBot: false, firstMessage: 'Old', chats: [] },
    ]

    await openPlaygroundChat()

    expect(playgroundMocks.applyCharacterRowMutationScoped).toHaveBeenCalledWith(
      0,
      PLAYGROUND_CHARACTER_ID,
      expect.any(Function),
    )
    expect(playgroundState.charactersResourceState.characters[0]).toMatchObject({
      chaId: PLAYGROUND_CHARACTER_ID,
      name: 'assistant',
      utilityBot: true,
      firstMessage: '{{none}}',
      chats: [expect.objectContaining({ id: 'local-playground-chat' })],
    })
    expect(playgroundState.charactersResourceState.currentChar).toBe(0)
    expect(get(selectedCharID)).toBe(0)
    expect(playgroundMocks.dispatchSelectCharacter).toHaveBeenCalledWith(
      PLAYGROUND_CHARACTER_ID,
      expect.objectContaining({ currentChar: -1, selectedCharID: -1 }),
      expect.any(Number),
    )
  })

  it('fails closed for duplicate or errored playground owners', async () => {
    playgroundState.charactersResourceState.characters = [
      { chaId: PLAYGROUND_CHARACTER_ID, chats: [] },
      { chaId: PLAYGROUND_CHARACTER_ID, chats: [] },
    ]

    await openPlaygroundChat()

    expect(get(PlaygroundStore)).toBe(0)
    expect(playgroundMocks.dispatchCreateAndSelectCharacter).not.toHaveBeenCalled()
    expect(playgroundMocks.dispatchSelectCharacter).not.toHaveBeenCalled()

    playgroundState.charactersResourceState.characters = []
    playgroundState.charactersResourceState.status = 'error'
    playgroundState.charactersResourceState.error = 'unavailable'
    await openPlaygroundChat()

    expect(get(PlaygroundStore)).toBe(0)
    expect(playgroundMocks.dispatchCreateAndSelectCharacter).not.toHaveBeenCalled()
  })

  it('uses the revision-less character owner without durable dispatch in local compatibility mode', async () => {
    playgroundState.canUseServerCommands = false
    playgroundState.charactersResourceState.listRevision = null
    playgroundState.charactersResourceState.orderRevision = null
    playgroundState.charactersResourceState.selectionRevision = null

    await openPlaygroundChat()

    expect(playgroundState.charactersResourceState.characters).toEqual([
      expect.objectContaining({ chaId: PLAYGROUND_CHARACTER_ID, name: 'assistant' }),
    ])
    expect(playgroundState.charactersResourceState.currentChar).toBe(0)
    expect(get(selectedCharID)).toBe(0)
    expect(playgroundMocks.dispatchCreateAndSelectCharacter).not.toHaveBeenCalled()
  })
})
