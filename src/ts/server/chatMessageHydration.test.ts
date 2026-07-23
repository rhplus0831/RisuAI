import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { testDatabaseState } from '../__tests__/resourceDatabaseState'

const projectionState = vi.hoisted(() => ({
  canUse: vi.fn(() => true),
  fetchChat: vi.fn(),
  fetchBulkChat: vi.fn(),
  fetchCharLore: vi.fn(),
  fetchBulkCharLore: vi.fn(),
}))

vi.mock('./hydrationReads', () => ({
  fetchServerBulkCharacterLorebooks: projectionState.fetchBulkCharLore,
  fetchServerBulkChatMessages: projectionState.fetchBulkChat,
  fetchServerChatMessages: projectionState.fetchChat,
  fetchServerCharacterLorebook: projectionState.fetchCharLore,
}))

vi.mock('./resourceReads', () => ({
  canUseServerResourceReads: projectionState.canUse,
}))

import { selectedCharID } from '../stores.svelte'
import { clearCachedServerCommandRevision, setCachedServerCommandRevision } from './commands'
import { isServerChatMessagePlaceholder, type Message } from '../storage/database.svelte'
import {
  BULK_HYDRATION_BATCH_SIZE,
  ACTIVE_CHAT_INITIAL_MESSAGE_WINDOW,
  acknowledgeCreatedChatTranscriptLocalEffect,
  acknowledgeMessageMutationLocalEffect,
  ensureAllCharacterLorebooksHydrated,
  ensureAllChatsHydrated,
  hydrateActiveCharacterLorebook,
  hydrateActiveChat,
  hydrateActiveChatWindow,
  hydrateActiveChatFully,
  hydrateChatMessages,
  applyServerChatMessagesResource,
  applyMessageTranslationLocalEffect,
  hasCharacterLorebookHydrationFailed,
  hasChatMessageHydrationFailed,
  invalidateChatHydration,
  isCharacterLorebookHydrationPending,
  isChatMessageHydrationPending,
  resetChatHydration,
} from './chatMessageHydration.svelte'
import {
  isCharacterLorebookHydrated,
  recordHydratedCharacterLorebooks,
  resetLorebookHydration,
} from './lorebookBridge.svelte'
import { getProtocolDiagnosticsSnapshot } from './protocolDiagnostics'
import {
  getRerollBuffer,
  resetRerollNavigation,
  seedRerollBufferFromAlternates,
} from '../process/rerollNavigation.svelte'
import {
  captureCharacterLorebookBodyProjectionEpoch,
  captureChatBodyProjectionEpoch,
  hasCharacterLorebookBodyProjectionEpochChanged,
  hasChatBodyProjectionEpochChanged,
  hasNewerCharacterLorebookBodyResourceRevision,
  hasNewerChatBodyResourceRevision,
  markCharacterLorebookProjectionApplied,
} from './resourceState.svelte'
import { clearRetainedChatProjections, registerRetainedChatProjection } from './chatRetainedProjection'

function deferred<T>() {
  let resolve!: (value: T) => void
  let reject!: (reason?: unknown) => void
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise
    reject = rejectPromise
  })
  return { promise, resolve, reject }
}

function okResult(chatId: string, message: Array<Record<string, unknown>>) {
  return { status: 'ok' as const, revision: 1, chatId, message, alternates: [] }
}

function okWindowResult(
  chatId: string,
  message: Array<Record<string, unknown>>,
  messageStart: number,
  messageTotal: number,
) {
  return {
    status: 'ok' as const,
    revision: 1,
    chatId,
    message,
    messageStart,
    messageTotal,
    alternates: [],
  }
}

function okBulkResult(chatIds: string[]) {
  return {
    status: 'ok' as const,
    revision: 1,
    chats: chatIds.map((chatId) => ({
      chatId,
      message: [{ role: 'user', data: chatId, chatId: `m-${chatId}` }],
      alternates: [],
    })),
    missing: [],
  }
}

function okBulkLorebookResult(characterIds: string[]) {
  return {
    status: 'ok' as const,
    revision: 1,
    characters: characterIds.map((characterId) => ({
      characterId,
      globalLore: [{ key: characterId, content: 'lore' }],
    })),
    missing: [],
  }
}

function seedTwoStubChats() {
  // Direct stub state: two chats with empty (stubbed) message arrays.
  ;(testDatabaseState as { db: unknown }).db = {
    characters: [
      {
        chaId: 'char-1',
        chatPage: 0,
        chats: [
          { id: 'chat-1', message: [] },
          { id: 'chat-2', message: [] },
        ],
      },
    ],
  }
  selectedCharID.set(0)
}

function seedManyStubChats(count: number) {
  ;(testDatabaseState as { db: unknown }).db = {
    characters: [
      {
        chaId: 'char-1',
        chatPage: 0,
        chats: Array.from({ length: count }, (_, index) => ({
          id: `chat-${index + 1}`,
          message: [],
        })),
      },
    ],
  }
  selectedCharID.set(0)
}

function seedManyLorebookStubCharacters(count: number) {
  ;(testDatabaseState as { db: unknown }).db = {
    enableLorebookStubs: true,
    characters: Array.from({ length: count }, (_, index) => ({
      chaId: `char-${index + 1}`,
      chatPage: 0,
      chats: [{ id: `chat-${index + 1}`, message: [] }],
      globalLore: [],
    })),
  }
  selectedCharID.set(0)
}

beforeEach(() => {
  projectionState.canUse.mockReturnValue(true)
  projectionState.fetchChat.mockReset()
  projectionState.fetchBulkChat.mockReset()
  projectionState.fetchCharLore.mockReset()
  projectionState.fetchBulkCharLore.mockReset()
  projectionState.fetchBulkChat.mockImplementation(async (chatIds: string[]) => okBulkResult(chatIds))
  projectionState.fetchBulkCharLore.mockImplementation(async (characterIds: string[]) =>
    okBulkLorebookResult(characterIds),
  )
  clearCachedServerCommandRevision()
  resetChatHydration()
  resetLorebookHydration()
  resetRerollNavigation()
  clearRetainedChatProjections()
  seedTwoStubChats()
})

afterEach(() => {
  clearRetainedChatProjections()
  selectedCharID.set(-1)
})

const db = () =>
  (testDatabaseState as { db: { characters: Array<{ chats: Array<{ id: string; message: unknown[] }> }> } }).db

describe('chat message hydration bridge', () => {
  it('reapplies a retained transcript projection after authoritative hydration', async () => {
    projectionState.fetchChat.mockResolvedValue(
      okResult('chat-1', [{ role: 'char', data: 'persisted', chatId: 'message-a' }]),
    )
    const release = registerRetainedChatProjection({ kind: 'chat-body', chatId: 'chat-1' }, () => {
      const message = db().characters[0].chats[0].message[0] as Record<string, unknown> | undefined
      if (message?.chatId === 'message-a') message.data = 'retained edit'
    })

    await hydrateActiveChat()

    expect(db().characters[0].chats[0].message).toEqual([{ role: 'char', data: 'retained edit', chatId: 'message-a' }])
    release()
  })

  it('hydrates only the active chat, and dedupes a second call', async () => {
    const projectionEpoch = captureChatBodyProjectionEpoch('chat-1')
    projectionState.fetchChat.mockResolvedValue(okResult('chat-1', [{ role: 'user', data: 'hi', chatId: 'm1' }]))

    await hydrateActiveChat()

    expect(projectionState.fetchChat).toHaveBeenCalledTimes(1)
    expect(projectionState.fetchChat).toHaveBeenCalledWith('chat-1', {
      tail: ACTIVE_CHAT_INITIAL_MESSAGE_WINDOW,
    })
    expect(db().characters[0].chats[0].message).toEqual([{ role: 'user', data: 'hi', chatId: 'm1' }])
    expect(hasNewerChatBodyResourceRevision('chat-1', 0)).toBe(true)
    expect(hasChatBodyProjectionEpochChanged('chat-1', projectionEpoch)).toBe(true)
    // The unrelated chat stays a stub.
    expect(db().characters[0].chats[1].message).toEqual([])

    // Second call is deduped (no refetch).
    await hydrateActiveChat()
    expect(projectionState.fetchChat).toHaveBeenCalledTimes(1)
  })

  it('uses the configured active chat tail window size', async () => {
    ;(testDatabaseState.db as { chatDisplayTailCount?: number }).chatDisplayTailCount = 12
    projectionState.fetchChat.mockResolvedValue(okResult('chat-1', [{ role: 'user', data: 'hi', chatId: 'm1' }]))

    await hydrateActiveChat()

    expect(projectionState.fetchChat).toHaveBeenCalledWith('chat-1', { tail: 12 })
  })

  it('force re-hydrates even when already cached', async () => {
    projectionState.fetchChat.mockResolvedValue(okResult('chat-1', [{ role: 'user', data: 'a', chatId: 'm1' }]))
    await hydrateActiveChat()
    projectionState.fetchChat.mockResolvedValue(okResult('chat-1', [{ role: 'user', data: 'b', chatId: 'm1' }]))
    await hydrateActiveChat({ force: true })
    expect(projectionState.fetchChat).toHaveBeenCalledTimes(2)
    expect(db().characters[0].chats[0].message).toEqual([{ role: 'user', data: 'b', chatId: 'm1' }])
  })

  it('invalidates only one cached chat so it can hydrate again', async () => {
    projectionState.fetchChat.mockImplementation(async (chatId: string) =>
      okResult(chatId, [{ role: 'user', data: `load ${chatId}`, chatId: `m-${chatId}` }]),
    )

    await hydrateChatMessages('chat-1')
    await hydrateChatMessages('chat-2')
    await hydrateChatMessages('chat-1')
    expect(projectionState.fetchChat).toHaveBeenCalledTimes(2)

    invalidateChatHydration('chat-1')
    await hydrateChatMessages('chat-1')
    await hydrateChatMessages('chat-2')

    expect(projectionState.fetchChat).toHaveBeenCalledTimes(3)
    expect(projectionState.fetchChat).toHaveBeenLastCalledWith('chat-1', {})
  })

  it('rejects strict single-chat hydration when the full transcript cannot be loaded', async () => {
    projectionState.fetchChat.mockResolvedValue({ status: 'error', error: 'offline' })

    await expect(hydrateChatMessages('chat-1', { strict: true })).rejects.toThrow(
      'Chat hydration incomplete for: chat-1',
    )
    expect(db().characters[0].chats[0].message).toEqual([])
  })

  it('drops an invalidated in-flight response while allowing an immediate replacement request', async () => {
    const stale = deferred<ReturnType<typeof okResult>>()
    const fresh = deferred<ReturnType<typeof okResult>>()
    projectionState.fetchChat.mockReturnValueOnce(stale.promise).mockReturnValueOnce(fresh.promise)

    const staleRequest = hydrateChatMessages('chat-1')
    expect(projectionState.fetchChat).toHaveBeenCalledTimes(1)
    invalidateChatHydration('chat-1')
    const freshRequest = hydrateChatMessages('chat-1')
    expect(projectionState.fetchChat).toHaveBeenCalledTimes(2)

    stale.resolve(okResult('chat-1', [{ role: 'user', data: 'stale', chatId: 'm-stale' }]))
    await staleRequest
    expect(db().characters[0].chats[0].message).toEqual([])

    fresh.resolve(okResult('chat-1', [{ role: 'user', data: 'fresh', chatId: 'm-fresh' }]))
    await freshRequest
    expect(db().characters[0].chats[0].message).toEqual([{ role: 'user', data: 'fresh', chatId: 'm-fresh' }])
  })

  it('preserves a fully loaded prefix when a ranged generation projection appends', async () => {
    const existingMessages = [
      { role: 'user', data: 'first', chatId: 'm1' },
      { role: 'char', data: 'second', chatId: 'm2' },
    ]
    projectionState.fetchChat.mockResolvedValue(okResult('chat-1', existingMessages))
    await hydrateActiveChatFully()

    const appended = { role: 'char', data: 'generated', chatId: 'm3' }
    expect(applyServerChatMessagesResource('chat-1', [appended], undefined, [], { start: 2, total: 3 })).toBe(true)

    expect(db().characters[0].chats[0].message).toEqual([...existingMessages, appended])
    expect((db().characters[0].chats[0].message as Message[]).some(isServerChatMessagePlaceholder)).toBe(false)

    projectionState.fetchChat.mockClear()
    await hydrateActiveChatWindow(3)
    expect(projectionState.fetchChat).not.toHaveBeenCalled()
  })

  it('hydrates only the active chat tail window and keeps absolute indexes stable', async () => {
    const projectionEpoch = captureChatBodyProjectionEpoch('chat-1')
    projectionState.fetchChat.mockResolvedValue(
      okWindowResult(
        'chat-1',
        [
          { role: 'user', data: 'tail-2', chatId: 'm3' },
          { role: 'char', data: 'tail-1', chatId: 'm4' },
        ],
        2,
        4,
      ),
    )

    await hydrateActiveChat({ loadPages: 2 })

    const messages = db().characters[0].chats[0].message as Message[]
    expect(messages).toHaveLength(4)
    expect(isServerChatMessagePlaceholder(messages[0])).toBe(true)
    expect(isServerChatMessagePlaceholder(messages[1])).toBe(true)
    expect(messages[2]).toEqual({ role: 'user', data: 'tail-2', chatId: 'm3' })
    expect(messages[3]).toEqual({ role: 'char', data: 'tail-1', chatId: 'm4' })
    expect(projectionState.fetchChat).toHaveBeenCalledWith('chat-1', { tail: 2 })
    expect(hasChatBodyProjectionEpochChanged('chat-1', projectionEpoch)).toBe(true)
  })

  it('fetches only newly visible unloaded ranges when the active window expands', async () => {
    projectionState.fetchChat.mockResolvedValueOnce(
      okWindowResult('chat-1', [{ role: 'char', data: 'tail', chatId: 'm4' }], 3, 4),
    )
    await hydrateActiveChat({ loadPages: 1 })
    projectionState.fetchChat.mockResolvedValueOnce(
      okWindowResult(
        'chat-1',
        [
          { role: 'user', data: 'older-1', chatId: 'm1' },
          { role: 'char', data: 'older-2', chatId: 'm2' },
          { role: 'user', data: 'older-3', chatId: 'm3' },
        ],
        0,
        4,
      ),
    )

    await hydrateActiveChatWindow(4)

    expect(projectionState.fetchChat).toHaveBeenNthCalledWith(1, 'chat-1', { tail: 1 })
    expect(projectionState.fetchChat).toHaveBeenNthCalledWith(2, 'chat-1', {
      start: 0,
      limit: 3,
    })
    const messages = db().characters[0].chats[0].message as Array<{ data: string }>
    expect(messages.map((message) => message.data)).toEqual(['older-1', 'older-2', 'older-3', 'tail'])
  })

  it('reports an older-window hydration failure without claiming the range is resident', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    try {
      projectionState.fetchChat.mockResolvedValueOnce(
        okWindowResult('chat-1', [{ role: 'char', data: 'tail', chatId: 'm4' }], 3, 4),
      )
      await hydrateActiveChat({ loadPages: 1 })
      projectionState.fetchChat.mockResolvedValueOnce({ status: 'error', error: 'older range unavailable' })

      await expect(hydrateActiveChatWindow(4)).resolves.toBe(false)

      const messages = db().characters[0].chats[0].message as Message[]
      expect(messages.slice(0, 3).every(isServerChatMessagePlaceholder)).toBe(true)
      expect(messages[3]).toEqual({ role: 'char', data: 'tail', chatId: 'm4' })
    } finally {
      warn.mockRestore()
    }
  })

  it('ensureAllChatsHydrated fills every chat', async () => {
    await ensureAllChatsHydrated()

    expect(projectionState.fetchBulkChat).toHaveBeenCalledTimes(1)
    expect(projectionState.fetchBulkChat).toHaveBeenCalledWith(['chat-1', 'chat-2'])
    expect(projectionState.fetchChat).not.toHaveBeenCalled()
    expect(db().characters[0].chats[0].message).toEqual([{ role: 'user', data: 'chat-1', chatId: 'm-chat-1' }])
    expect(db().characters[0].chats[1].message).toEqual([{ role: 'user', data: 'chat-2', chatId: 'm-chat-2' }])
  })

  it('ensureAllChatsHydrated includes chats that only have a partial active window', async () => {
    projectionState.fetchChat.mockResolvedValueOnce(
      okWindowResult('chat-1', [{ role: 'char', data: 'tail', chatId: 'm2' }], 1, 2),
    )
    await hydrateActiveChat({ loadPages: 1 })
    projectionState.fetchBulkChat.mockClear()

    await ensureAllChatsHydrated()

    expect(projectionState.fetchBulkChat).toHaveBeenCalledWith(['chat-1', 'chat-2'])
    expect(db().characters[0].chats[0].message).toEqual([{ role: 'user', data: 'chat-1', chatId: 'm-chat-1' }])
  })

  it('hydrates 65 chats in sequential 32-id bulk batches', async () => {
    seedManyStubChats(BULK_HYDRATION_BATCH_SIZE * 2 + 1)
    let active = 0
    let maxActive = 0
    projectionState.fetchBulkChat.mockImplementation(async (chatIds: string[]) => {
      active += 1
      maxActive = Math.max(maxActive, active)
      await Promise.resolve()
      active -= 1
      return okBulkResult(chatIds)
    })

    await ensureAllChatsHydrated()

    expect(projectionState.fetchBulkChat.mock.calls.map(([ids]) => ids.length)).toEqual([32, 32, 1])
    expect(projectionState.fetchBulkChat.mock.calls.flatMap(([ids]) => ids)).toEqual(
      Array.from({ length: 65 }, (_, index) => `chat-${index + 1}`),
    )
    expect(maxActive).toBe(1)
    expect(projectionState.fetchChat).not.toHaveBeenCalled()
    expect(db().characters[0].chats.every((chat) => chat.message.length === 1)).toBe(true)
  })

  it('keeps all-chat hydration within the request-count budget', async () => {
    seedManyStubChats(BULK_HYDRATION_BATCH_SIZE * 2 + 1)
    const before = getProtocolDiagnosticsSnapshot().hydration.chat

    await ensureAllChatsHydrated()

    const afterBulk = getProtocolDiagnosticsSnapshot().hydration.chat
    expect(afterBulk.requestsStarted - before.requestsStarted).toBe(3)
    expect(afterBulk.bulkRuns - before.bulkRuns).toBe(1)
    expect(afterBulk.bulkIds - before.bulkIds).toBe(65)
    expect(projectionState.fetchBulkChat).toHaveBeenCalledTimes(3)
    expect(projectionState.fetchChat).not.toHaveBeenCalled()

    await ensureAllChatsHydrated()

    const afterCached = getProtocolDiagnosticsSnapshot().hydration.chat
    expect(afterCached.requestsStarted).toBe(afterBulk.requestsStarted)
    expect(projectionState.fetchBulkChat).toHaveBeenCalledTimes(3)
    expect(projectionState.fetchChat).not.toHaveBeenCalled()
  })

  it('keeps failed chat batches retryable and makes strict runs stop at the failed batch', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    try {
      seedManyStubChats(65)
      projectionState.fetchBulkChat
        .mockImplementationOnce(async (ids: string[]) => okBulkResult(ids))
        .mockResolvedValueOnce({ status: 'error', error: 'middle batch failed' })
        .mockImplementationOnce(async (ids: string[]) => okBulkResult(ids))

      await ensureAllChatsHydrated()

      expect(projectionState.fetchBulkChat.mock.calls.map(([ids]) => ids.length)).toEqual([32, 32, 1])
      expect(
        db()
          .characters[0].chats.slice(0, 32)
          .every((chat) => chat.message.length === 1),
      ).toBe(true)
      expect(
        db()
          .characters[0].chats.slice(32, 64)
          .every((chat) => chat.message.length === 0),
      ).toBe(true)
      expect(db().characters[0].chats[64].message).toHaveLength(1)

      projectionState.fetchBulkChat.mockClear()
      projectionState.fetchBulkChat.mockImplementation(async (ids: string[]) => okBulkResult(ids))
      await ensureAllChatsHydrated()
      expect(projectionState.fetchBulkChat).toHaveBeenCalledTimes(1)
      expect(projectionState.fetchBulkChat.mock.calls[0][0]).toEqual(
        Array.from({ length: 32 }, (_, index) => `chat-${index + 33}`),
      )

      resetChatHydration()
      seedManyStubChats(65)
      projectionState.fetchBulkChat.mockReset()
      projectionState.fetchBulkChat
        .mockImplementationOnce(async (ids: string[]) => okBulkResult(ids))
        .mockResolvedValueOnce({ status: 'error', error: 'strict middle batch failed' })
      await expect(ensureAllChatsHydrated({ strict: true })).rejects.toThrow(
        'Bulk chat hydration failed: strict middle batch failed',
      )
      expect(projectionState.fetchBulkChat).toHaveBeenCalledTimes(2)
      expect(db().characters[0].chats[64].message).toEqual([])
    } finally {
      warn.mockRestore()
    }
  })

  it('stops a non-strict chat batch run when its hydration generation resets', async () => {
    seedManyStubChats(65)
    const secondBatch = deferred<ReturnType<typeof okBulkResult>>()
    projectionState.fetchBulkChat
      .mockImplementationOnce(async (ids: string[]) => okBulkResult(ids))
      .mockReturnValueOnce(secondBatch.promise)

    const pending = ensureAllChatsHydrated()
    await vi.waitFor(() => expect(projectionState.fetchBulkChat).toHaveBeenCalledTimes(2))
    resetChatHydration()
    secondBatch.resolve(okBulkResult(Array.from({ length: 32 }, (_, index) => `chat-${index + 33}`)))
    await pending

    expect(projectionState.fetchBulkChat).toHaveBeenCalledTimes(2)
  })

  it('resetChatHydration makes ensureAllChatsHydrated refetch re-stubbed chats', async () => {
    await ensureAllChatsHydrated()
    expect(projectionState.fetchBulkChat).toHaveBeenCalledTimes(1)

    // Simulate a foreign `characters` event re-stubbing every chat: messages
    // wiped in testDatabaseState AND the hydration cache cleared (bootstrap.ts does both).
    for (const chat of db().characters[0].chats) chat.message = []
    resetChatHydration()
    projectionState.fetchBulkChat.mockClear()

    // Without the reset this would skip the cached ids and export empty stubs.
    await ensureAllChatsHydrated()
    expect(projectionState.fetchBulkChat).toHaveBeenCalledTimes(1)
    expect(db().characters[0].chats[0].message).toEqual([{ role: 'user', data: 'chat-1', chatId: 'm-chat-1' }])
  })

  it('hydrateChatMessages targets a specific (non-active) chat', async () => {
    projectionState.fetchChat.mockResolvedValue(okResult('chat-2', [{ role: 'char', data: 'yo', chatId: 'm2' }]))
    await hydrateChatMessages('chat-2')
    expect(projectionState.fetchChat).toHaveBeenCalledWith('chat-2', {})
    expect(db().characters[0].chats[1].message).toEqual([{ role: 'char', data: 'yo', chatId: 'm2' }])
  })

  it('full active hydration replaces a partial window and marks the chat cached', async () => {
    projectionState.fetchChat.mockResolvedValueOnce(
      okWindowResult('chat-1', [{ role: 'char', data: 'tail', chatId: 'm2' }], 1, 2),
    )
    await hydrateActiveChat({ loadPages: 1 })
    projectionState.fetchChat.mockResolvedValueOnce(
      okResult('chat-1', [
        { role: 'user', data: 'full-1', chatId: 'm1' },
        { role: 'char', data: 'full-2', chatId: 'm2' },
      ]),
    )

    await hydrateActiveChatFully()
    await hydrateActiveChatFully()

    expect(projectionState.fetchChat).toHaveBeenCalledTimes(2)
    expect(projectionState.fetchChat).toHaveBeenNthCalledWith(2, 'chat-1', {})
    expect(db().characters[0].chats[0].message).toEqual([
      { role: 'user', data: 'full-1', chatId: 'm1' },
      { role: 'char', data: 'full-2', chatId: 'm2' },
    ])
  })

  it('hydrates hypaV3Data alongside messages, and clears it when absent', async () => {
    // chat-1 has hypaV3Data; chat-2 has none.
    projectionState.fetchBulkChat.mockResolvedValue({
      status: 'ok',
      revision: 1,
      chats: [
        {
          chatId: 'chat-1',
          message: [],
          hypaV3Data: { mainChunks: [1] },
          alternates: [],
        },
        { chatId: 'chat-2', message: [], alternates: [] },
      ],
      missing: [],
    })
    // Seed a stale hypaV3Data on chat-2 to prove an absent value clears it.
    ;(db().characters[0].chats[1] as { hypaV3Data?: unknown }).hypaV3Data = { stale: true }

    await ensureAllChatsHydrated()

    expect((db().characters[0].chats[0] as { hypaV3Data?: unknown }).hypaV3Data).toEqual({
      mainChunks: [1],
    })
    expect((db().characters[0].chats[1] as { hypaV3Data?: unknown }).hypaV3Data).toBeUndefined()
  })

  it('skips missing bulk chat entries without marking them hydrated', async () => {
    projectionState.fetchBulkChat.mockResolvedValueOnce({
      status: 'ok',
      revision: 1,
      chats: [
        {
          chatId: 'chat-1',
          message: [{ role: 'user', data: 'chat-1', chatId: 'm-chat-1' }],
          alternates: [],
        },
      ],
      missing: ['chat-2'],
    })

    await ensureAllChatsHydrated()

    expect(db().characters[0].chats[0].message).toEqual([{ role: 'user', data: 'chat-1', chatId: 'm-chat-1' }])
    expect(db().characters[0].chats[1].message).toEqual([])

    projectionState.fetchBulkChat.mockClear()
    await ensureAllChatsHydrated()
    expect(projectionState.fetchBulkChat).toHaveBeenCalledWith(['chat-2'])
  })

  it('strict all-chat hydration rejects missing bulk chat entries', async () => {
    projectionState.fetchBulkChat.mockResolvedValueOnce({
      status: 'ok',
      revision: 1,
      chats: [
        {
          chatId: 'chat-1',
          message: [{ role: 'user', data: 'chat-1', chatId: 'm-chat-1' }],
          alternates: [],
        },
      ],
      missing: ['chat-2'],
    })

    await expect(ensureAllChatsHydrated({ strict: true })).rejects.toThrow(/did not return messages for: chat-2/)
  })

  it('drops a stale bulk chat hydration response', async () => {
    setCachedServerCommandRevision(2)
    projectionState.fetchBulkChat.mockResolvedValueOnce({
      status: 'ok',
      revision: 1,
      chats: [
        {
          chatId: 'chat-1',
          message: [{ role: 'user', data: 'old', chatId: 'm-old' }],
          alternates: [],
        },
      ],
      missing: [],
    })

    await ensureAllChatsHydrated()

    expect(db().characters[0].chats[0].message).toEqual([])
    projectionState.fetchBulkChat.mockClear()
    await ensureAllChatsHydrated()
    expect(projectionState.fetchBulkChat).toHaveBeenCalledWith(['chat-1', 'chat-2'])
  })

  it('is a no-op when server projection is unavailable', async () => {
    projectionState.canUse.mockReturnValue(false)
    await hydrateActiveChat()
    await ensureAllChatsHydrated()
    expect(projectionState.fetchChat).not.toHaveBeenCalled()
    expect(projectionState.fetchBulkChat).not.toHaveBeenCalled()
  })

  it('still applies a response when an unrelated command bumps the revision mid-flight', async () => {
    // Real char-open (changeChar) sets selectedCharID (starting this slow chat
    // hydration) AND dispatches a `character.selected` command. That tiny command
    // commits first and advances the cached revision, while the big hydration
    // response carries the older revision it was built at. The messages are NOT
    // stale (select never touched them) and must still render.
    setCachedServerCommandRevision(1)
    projectionState.fetchChat.mockImplementation(async () => {
      // The concurrent select command lands while this fetch is in flight.
      setCachedServerCommandRevision(2)
      return { ...okResult('chat-1', [{ role: 'user', data: 'hi', chatId: 'm1' }]), revision: 1 }
    })

    await hydrateActiveChat()

    expect(db().characters[0].chats[0].message).toEqual([{ role: 'user', data: 'hi', chatId: 'm1' }])
  })

  it('does not let an older hydration replace a newer targeted message projection', async () => {
    const oldHydration = deferred<ReturnType<typeof okResult> & { hypaV3Data: unknown }>()
    projectionState.fetchChat.mockReturnValueOnce(oldHydration.promise)

    const pendingHydration = hydrateActiveChatFully()
    expect(projectionState.fetchChat).toHaveBeenCalledWith('chat-1', {})

    const projectedMessages = [{ role: 'char', data: 'projected', chatId: 'm-projected' }]
    const projectedAlternates = [
      projectedMessages[0],
      { role: 'char', data: 'projected alternate', chatId: 'm-projected-alt' },
    ]
    expect(
      applyServerChatMessagesResource('chat-1', projectedMessages, { source: 'new projection' }, projectedAlternates),
    ).toBe(true)

    oldHydration.resolve({
      ...okResult('chat-1', [{ role: 'char', data: 'old hydration', chatId: 'm-old' }]),
      hypaV3Data: { source: 'old hydration' },
      alternates: [{ role: 'char', data: 'old alternate', chatId: 'm-old-alt' }],
    })
    await pendingHydration

    expect(db().characters[0].chats[0].message).toEqual(projectedMessages)
    expect((db().characters[0].chats[0] as { hypaV3Data?: unknown }).hypaV3Data).toEqual({
      source: 'new projection',
    })
    expect(
      getRerollBuffer()
        .flat()
        .map((message) => message.data),
    ).toEqual(['projected alternate', 'projected'])
  })

  it('applies a translation by stable ids and drops an older transcript hydration', async () => {
    const oldHydration = deferred<ReturnType<typeof okResult>>()
    projectionState.fetchChat.mockReturnValueOnce(oldHydration.promise)
    const pendingHydration = hydrateActiveChatFully()
    const resident = { role: 'user', data: 'hello', chatId: 'm-resident' }
    db().characters[0].chats[0].message.push(resident)
    const translation = {
      source: 'raw' as const,
      text: 'translated',
      sourceHash: 'a'.repeat(64),
      targetLanguage: 'ko',
      inputLanguage: 'en',
      translatorType: 'llm' as const,
      settingsHash: 'b'.repeat(64),
      updatedAt: 123,
    }

    expect(applyMessageTranslationLocalEffect('chat-1', 'm-resident', translation)).toBe(true)
    oldHydration.resolve(okResult('chat-1', [{ role: 'user', data: 'stale', chatId: 'm-stale' }]))
    await pendingHydration

    expect(db().characters[0].chats[0].message).toEqual([{ ...resident, translation }])
    expect(applyMessageTranslationLocalEffect('chat-2', 'm-resident', translation)).toBe(false)
  })

  it('acknowledges a byte-identical optimistic mutation and drops an older hydration', async () => {
    const resident = { role: 'user', data: 'resident', chatId: 'm-resident' }
    db().characters[0].chats[0].message.push(resident)
    const oldHydration = deferred<ReturnType<typeof okResult>>()
    projectionState.fetchChat.mockReturnValueOnce(oldHydration.promise)
    const pendingHydration = hydrateActiveChatFully()
    const projectionEpoch = captureChatBodyProjectionEpoch('chat-1')

    expect(acknowledgeMessageMutationLocalEffect('chat-1')).toBe(true)
    expect(hasChatBodyProjectionEpochChanged('chat-1', projectionEpoch)).toBe(true)
    oldHydration.resolve(okResult('chat-1', [{ role: 'user', data: 'stale', chatId: 'm-stale' }]))
    await pendingHydration

    expect(db().characters[0].chats[0].message).toEqual([resident])
    expect(acknowledgeMessageMutationLocalEffect('missing-chat')).toBe(false)
  })

  it('fences a deferred stale hydration that begins after an optimistic transcript mutation', async () => {
    const optimisticMessage = { role: 'user', data: 'optimistic edit', chatId: 'm-resident' }
    db().characters[0].chats[0].message.push(optimisticMessage)
    const optimisticProjectionEpoch = captureChatBodyProjectionEpoch('chat-1')
    const staleHydration = deferred<ReturnType<typeof okResult>>()
    projectionState.fetchChat.mockReturnValueOnce(staleHydration.promise)

    // This request starts after the optimistic edit, so its freshness snapshot
    // alone cannot distinguish a pre-command server response from the edit.
    const pendingHydration = hydrateActiveChatFully()
    staleHydration.resolve(okResult('chat-1', [{ role: 'user', data: 'pre-command body', chatId: 'm-resident' }]))
    await pendingHydration

    expect(db().characters[0].chats[0].message).toEqual([
      { role: 'user', data: 'pre-command body', chatId: 'm-resident' },
    ])
    expect(hasChatBodyProjectionEpochChanged('chat-1', optimisticProjectionEpoch)).toBe(true)
  })

  it('marks a complete created transcript hydrated and drops an older hydration', async () => {
    const resident = { role: 'user', data: 'created locally', chatId: 'm-created' }
    db().characters[0].chats[0].message.push(resident)
    const oldHydration = deferred<ReturnType<typeof okResult>>()
    projectionState.fetchChat.mockReturnValueOnce(oldHydration.promise)
    const pendingHydration = hydrateActiveChatFully()

    expect(acknowledgeCreatedChatTranscriptLocalEffect('chat-1')).toBe(true)
    oldHydration.resolve(okResult('chat-1', [{ role: 'user', data: 'stale', chatId: 'm-stale' }]))
    await pendingHydration

    expect(db().characters[0].chats[0].message).toEqual([resident])
    expect(isChatMessageHydrationPending('chat-1', 0)).toBe(false)
    expect(acknowledgeCreatedChatTranscriptLocalEffect('missing-chat')).toBe(false)
  })

  it('does not let an older hydration erase an optimistic local message or settle its rolled-back stub', async () => {
    const oldHydration = deferred<ReturnType<typeof okResult> & { hypaV3Data: unknown }>()
    projectionState.fetchChat.mockReturnValueOnce(oldHydration.promise)
    const pendingHydration = hydrateActiveChatFully()

    const localMessage = { role: 'char', data: 'optimistic local', chatId: 'm-local' }
    db().characters[0].chats[0].message.push(localMessage)
    ;(db().characters[0].chats[0] as { hypaV3Data?: unknown }).hypaV3Data = { source: 'optimistic local' }
    seedRerollBufferFromAlternates(
      [localMessage],
      [localMessage, { role: 'char', data: 'local alternate', chatId: 'm-local-alt' }],
    )

    oldHydration.resolve({
      ...okResult('chat-1', [{ role: 'char', data: 'old hydration', chatId: 'm-old' }]),
      hypaV3Data: { source: 'old hydration' },
      alternates: [{ role: 'char', data: 'old alternate', chatId: 'm-old-alt' }],
    })
    await pendingHydration

    expect(db().characters[0].chats[0].message).toEqual([localMessage])
    expect((db().characters[0].chats[0] as { hypaV3Data?: unknown }).hypaV3Data).toEqual({
      source: 'optimistic local',
    })
    expect(
      getRerollBuffer()
        .flat()
        .map((message) => message.data),
    ).toEqual(['local alternate', 'optimistic local'])

    // If the optimistic command then rolls back, the stale response must not
    // have marked this empty stub as an attempted/settled hydration.
    db().characters[0].chats[0].message = []
    delete (db().characters[0].chats[0] as { hypaV3Data?: unknown }).hypaV3Data
    expect(isChatMessageHydrationPending('chat-1', 0)).toBe(true)

    projectionState.fetchChat.mockResolvedValueOnce(
      okResult('chat-1', [{ role: 'user', data: 'fresh retry', chatId: 'm-fresh' }]),
    )
    await hydrateActiveChatFully()
    expect(projectionState.fetchChat).toHaveBeenCalledTimes(2)
    expect(db().characters[0].chats[0].message).toEqual([{ role: 'user', data: 'fresh retry', chatId: 'm-fresh' }])
  })

  it('keeps a pending full hydration fresh across a compatible range hydration write', async () => {
    const tailHydration = deferred<ReturnType<typeof okWindowResult> & { hypaV3Data: unknown }>()
    const fullHydration = deferred<ReturnType<typeof okResult> & { hypaV3Data: unknown }>()
    projectionState.fetchChat.mockImplementation((_chatId: string, range: { tail?: number }) =>
      range.tail === 1 ? tailHydration.promise : fullHydration.promise,
    )

    const pendingTail = hydrateActiveChat({ loadPages: 1 })
    const pendingFull = hydrateActiveChatFully()

    tailHydration.resolve({
      ...okWindowResult('chat-1', [{ role: 'char', data: 'tail', chatId: 'm-tail' }], 1, 2),
      hypaV3Data: { source: 'tail hydration' },
    })
    await pendingTail

    fullHydration.resolve({
      ...okResult('chat-1', [
        { role: 'user', data: 'full head', chatId: 'm-head' },
        { role: 'char', data: 'full tail', chatId: 'm-tail' },
      ]),
      hypaV3Data: { source: 'full hydration' },
    })
    await pendingFull

    expect(db().characters[0].chats[0].message).toEqual([
      { role: 'user', data: 'full head', chatId: 'm-head' },
      { role: 'char', data: 'full tail', chatId: 'm-tail' },
    ])
    expect((db().characters[0].chats[0] as { hypaV3Data?: unknown }).hypaV3Data).toEqual({
      source: 'full hydration',
    })
  })

  it('still drops a response older than the revision already applied at request start', async () => {
    // The genuine stale case the revision guard exists for: we had already applied
    // revision 5 BEFORE issuing this fetch, and the response reflects an older
    // revision 3 -> drop it rather than regress.
    setCachedServerCommandRevision(5)
    projectionState.fetchChat.mockResolvedValue({
      ...okResult('chat-1', [{ role: 'user', data: 'stale', chatId: 'm-old' }]),
      revision: 3,
    })

    await hydrateActiveChat()

    expect(db().characters[0].chats[0].message).toEqual([])
  })
})

describe('isChatMessageHydrationPending', () => {
  it('is pending for an un-hydrated empty stub, and clears once messages arrive', async () => {
    // A fresh open chat: empty stub, never fetched -> loading.
    expect(isChatMessageHydrationPending('chat-1', 0)).toBe(true)

    projectionState.fetchChat.mockResolvedValue(okResult('chat-1', [{ role: 'user', data: 'hi', chatId: 'm1' }]))
    await hydrateActiveChat()

    // Messages present -> not loading.
    expect(isChatMessageHydrationPending('chat-1', 1)).toBe(false)
    // ...and still not loading even if asked with a stale zero count, because the
    // chat is now marked hydrated.
    expect(isChatMessageHydrationPending('chat-1', 0)).toBe(false)
  })

  it('clears for a legitimately empty chat once hydration settles', async () => {
    projectionState.fetchChat.mockResolvedValue(okResult('chat-1', []))
    await hydrateActiveChat()
    // Empty result, but the attempt is done -> show the greeting, not a spinner.
    expect(isChatMessageHydrationPending('chat-1', 0)).toBe(false)
  })

  it('surfaces a failed fetch and returns to loading while it retries', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    try {
      projectionState.fetchChat.mockResolvedValue({ status: 'error', error: 'boom' })
      await hydrateActiveChat()
      expect(isChatMessageHydrationPending('chat-1', 0)).toBe(false)
      expect(hasChatMessageHydrationFailed('chat-1', 0)).toBe(true)
      expect(warn).toHaveBeenCalledWith('chat chat-1 hydration failed: boom')

      const retry = deferred<ReturnType<typeof okResult>>()
      projectionState.fetchChat.mockReturnValueOnce(retry.promise)
      const retryPromise = hydrateActiveChat({ force: true })

      expect(hasChatMessageHydrationFailed('chat-1', 0)).toBe(false)
      expect(isChatMessageHydrationPending('chat-1', 0)).toBe(true)

      retry.resolve(okResult('chat-1', []))
      await retryPromise

      expect(hasChatMessageHydrationFailed('chat-1', 0)).toBe(false)
      expect(isChatMessageHydrationPending('chat-1', 0)).toBe(false)
    } finally {
      warn.mockRestore()
    }
  })

  it('does not surface a failed response from before a hydration reset', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const response = deferred<{ status: 'error'; error: string }>()
    try {
      projectionState.fetchChat.mockReturnValueOnce(response.promise)
      const hydration = hydrateActiveChat()
      resetChatHydration()

      response.resolve({ status: 'error', error: 'stale failure' })
      await hydration

      expect(hasChatMessageHydrationFailed('chat-1', 0)).toBe(false)
      expect(isChatMessageHydrationPending('chat-1', 0)).toBe(true)
    } finally {
      warn.mockRestore()
    }
  })

  it('is never pending when messages are already present', () => {
    expect(isChatMessageHydrationPending('chat-1', 3)).toBe(false)
  })

  it('is never pending when server projection is off', () => {
    projectionState.canUse.mockReturnValue(false)
    expect(isChatMessageHydrationPending('chat-1', 0)).toBe(false)
  })

  it('is never pending without a chat id', () => {
    expect(isChatMessageHydrationPending(undefined, 0)).toBe(false)
  })

  it('becomes pending again after a resync re-stubs the chat', async () => {
    projectionState.fetchChat.mockResolvedValue(okResult('chat-1', [{ role: 'user', data: 'hi', chatId: 'm1' }]))
    await hydrateActiveChat()
    expect(isChatMessageHydrationPending('chat-1', 1)).toBe(false)

    // A foreign re-stub wipes messages and clears the hydration cache.
    resetChatHydration()
    expect(isChatMessageHydrationPending('chat-1', 0)).toBe(true)
  })
})

describe('character globalLore hydration (Phase 5)', () => {
  it('exposes a failed hydration and returns to loading while retrying', async () => {
    ;(testDatabaseState.db as { enableLorebookStubs?: boolean }).enableLorebookStubs = true
    const warning = vi.spyOn(console, 'warn').mockImplementation(() => {})
    projectionState.fetchCharLore.mockResolvedValueOnce({ status: 'error', error: 'offline' })

    expect(isCharacterLorebookHydrationPending('char-1')).toBe(true)
    expect(hasCharacterLorebookHydrationFailed('char-1')).toBe(false)

    await hydrateActiveCharacterLorebook()

    expect(isCharacterLorebookHydrationPending('char-1')).toBe(false)
    expect(hasCharacterLorebookHydrationFailed('char-1')).toBe(true)

    const retry = deferred<{
      status: 'ok'
      revision: number
      characterId: string
      globalLore: unknown[]
    }>()
    projectionState.fetchCharLore.mockReturnValueOnce(retry.promise)
    const retryHydration = hydrateActiveCharacterLorebook({ force: true })

    expect(isCharacterLorebookHydrationPending('char-1')).toBe(true)
    expect(hasCharacterLorebookHydrationFailed('char-1')).toBe(false)

    retry.resolve({
      status: 'ok',
      revision: 1,
      characterId: 'char-1',
      globalLore: [{ key: 'retry', content: 'loaded' }],
    })
    await retryHydration

    expect(isCharacterLorebookHydrationPending('char-1')).toBe(false)
    expect(hasCharacterLorebookHydrationFailed('char-1')).toBe(false)
    expect(isCharacterLorebookHydrated('char-1')).toBe(true)
    warning.mockRestore()
  })

  it('hydrates + marks the open character globalLore when stubs are on', async () => {
    const projectionEpoch = captureCharacterLorebookBodyProjectionEpoch('char-1')
    ;(testDatabaseState.db as { enableLorebookStubs?: boolean }).enableLorebookStubs = true
    projectionState.fetchCharLore.mockResolvedValue({
      status: 'ok',
      revision: 1,
      characterId: 'char-1',
      globalLore: [{ key: 'k', content: 'lore' }],
    })

    expect(isCharacterLorebookHydrated('char-1')).toBe(false)
    await hydrateActiveCharacterLorebook()

    expect(projectionState.fetchCharLore).toHaveBeenCalledWith('char-1')
    expect((db().characters[0] as { globalLore?: unknown[] }).globalLore).toEqual([{ key: 'k', content: 'lore' }])
    // Marked hydrated → the lorebook watcher will now track (and persist) edits.
    expect(isCharacterLorebookHydrated('char-1')).toBe(true)
    expect(hasNewerCharacterLorebookBodyResourceRevision('char-1', 0)).toBe(true)
    expect(hasCharacterLorebookBodyProjectionEpochChanged('char-1', projectionEpoch)).toBe(true)

    // Deduped on a second call (no refetch).
    await hydrateActiveCharacterLorebook()
    expect(projectionState.fetchCharLore).toHaveBeenCalledTimes(1)
  })

  it('hydrates a resident stub after stub mode is turned off', async () => {
    ;(testDatabaseState.db as { enableLorebookStubs?: boolean }).enableLorebookStubs = true
    recordHydratedCharacterLorebooks([{ chaId: 'char-1' }])
    ;(testDatabaseState.db as { enableLorebookStubs?: boolean }).enableLorebookStubs = false
    projectionState.fetchCharLore.mockResolvedValue({
      status: 'ok',
      revision: 1,
      characterId: 'char-1',
      globalLore: [{ key: 'transition', content: 'real lore' }],
    })

    expect(isCharacterLorebookHydrationPending('char-1')).toBe(true)
    await hydrateActiveCharacterLorebook()

    expect(projectionState.fetchCharLore).toHaveBeenCalledWith('char-1')
    expect((db().characters[0] as { globalLore?: unknown[] }).globalLore).toEqual([
      { key: 'transition', content: 'real lore' },
    ])
    expect(isCharacterLorebookHydrationPending('char-1')).toBe(false)
  })

  it('does not let a forced hydration overwrite a newer local lorebook body', async () => {
    ;(testDatabaseState.db as { enableLorebookStubs?: boolean }).enableLorebookStubs = true
    const oldHydration = deferred<{
      status: 'ok'
      revision: number
      characterId: string
      globalLore: unknown[]
    }>()
    projectionState.fetchCharLore.mockReturnValue(oldHydration.promise)

    const pendingHydration = hydrateActiveCharacterLorebook({ force: true })
    const localLore = [{ key: 'local', content: 'newer local lore' }]
    ;(testDatabaseState.db.characters[0] as { globalLore?: unknown[] }).globalLore = localLore
    markCharacterLorebookProjectionApplied('char-1')
    oldHydration.resolve({
      status: 'ok',
      revision: 1,
      characterId: 'char-1',
      globalLore: [{ key: 'old', content: 'older hydration' }],
    })

    await pendingHydration

    expect((testDatabaseState.db.characters[0] as { globalLore?: unknown[] }).globalLore).toEqual(localLore)
  })

  it('hydrates 65 character lorebooks in sequential 32-id bulk batches', async () => {
    seedManyLorebookStubCharacters(BULK_HYDRATION_BATCH_SIZE * 2 + 1)

    await ensureAllCharacterLorebooksHydrated()

    expect(projectionState.fetchBulkCharLore.mock.calls.map(([ids]) => ids.length)).toEqual([32, 32, 1])
    expect(projectionState.fetchBulkCharLore.mock.calls.flatMap(([ids]) => ids)).toEqual(
      Array.from({ length: 65 }, (_, index) => `char-${index + 1}`),
    )
    expect(projectionState.fetchCharLore).not.toHaveBeenCalled()
    expect((testDatabaseState.db.characters[0] as { globalLore?: unknown[] }).globalLore).toEqual([
      { key: 'char-1', content: 'lore' },
    ])
    expect(isCharacterLorebookHydrated('char-1')).toBe(true)
  })

  it('applies bulk lorebooks per id without overwriting a newer local body', async () => {
    seedManyLorebookStubCharacters(2)
    const oldHydration = deferred<ReturnType<typeof okBulkLorebookResult>>()
    projectionState.fetchBulkCharLore.mockReturnValue(oldHydration.promise)

    const pendingHydration = ensureAllCharacterLorebooksHydrated()
    const localLore = [{ key: 'local', content: 'newer local lore' }]
    ;(testDatabaseState.db.characters[0] as { globalLore?: unknown[] }).globalLore = localLore
    markCharacterLorebookProjectionApplied('char-1')
    oldHydration.resolve(okBulkLorebookResult(['char-1', 'char-2']))

    await pendingHydration

    expect((testDatabaseState.db.characters[0] as { globalLore?: unknown[] }).globalLore).toEqual(localLore)
    expect((testDatabaseState.db.characters[1] as { globalLore?: unknown[] }).globalLore).toEqual([
      { key: 'char-2', content: 'lore' },
    ])
  })

  it('keeps all-character lorebook hydration within the request-count budget', async () => {
    seedManyLorebookStubCharacters(BULK_HYDRATION_BATCH_SIZE * 2 + 1)
    const before = getProtocolDiagnosticsSnapshot().hydration.characterLorebook

    await ensureAllCharacterLorebooksHydrated()

    const afterBulk = getProtocolDiagnosticsSnapshot().hydration.characterLorebook
    expect(afterBulk.requestsStarted - before.requestsStarted).toBe(3)
    expect(afterBulk.bulkRuns - before.bulkRuns).toBe(1)
    expect(afterBulk.bulkIds - before.bulkIds).toBe(65)
    expect(projectionState.fetchBulkCharLore).toHaveBeenCalledTimes(3)
    expect(projectionState.fetchCharLore).not.toHaveBeenCalled()

    await ensureAllCharacterLorebooksHydrated()

    const afterCached = getProtocolDiagnosticsSnapshot().hydration.characterLorebook
    expect(afterCached.requestsStarted).toBe(afterBulk.requestsStarted)
    expect(projectionState.fetchBulkCharLore).toHaveBeenCalledTimes(3)
    expect(projectionState.fetchCharLore).not.toHaveBeenCalled()
  })

  it('preserves a lorebook edited between sequential bulk batches', async () => {
    seedManyLorebookStubCharacters(65)
    const localLore = [{ key: 'local', content: 'edited between batches' }]
    projectionState.fetchBulkCharLore.mockImplementationOnce(async (ids: string[]) => {
      ;(testDatabaseState.db.characters[32] as { globalLore?: unknown[] }).globalLore = localLore
      markCharacterLorebookProjectionApplied('char-33')
      return okBulkLorebookResult(ids)
    })

    await ensureAllCharacterLorebooksHydrated()

    expect((testDatabaseState.db.characters[32] as { globalLore?: unknown[] }).globalLore).toEqual(localLore)
    expect(isCharacterLorebookHydrated('char-33')).toBe(false)
    expect(projectionState.fetchBulkCharLore.mock.calls.map(([ids]) => ids.length)).toEqual([32, 32, 1])
  })

  it('keeps failed lorebook batches retryable and rejects a strict failed batch', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    try {
      seedManyLorebookStubCharacters(65)
      projectionState.fetchBulkCharLore
        .mockImplementationOnce(async (ids: string[]) => okBulkLorebookResult(ids))
        .mockResolvedValueOnce({ status: 'error', error: 'middle lorebook batch failed' })
        .mockImplementationOnce(async (ids: string[]) => okBulkLorebookResult(ids))

      await ensureAllCharacterLorebooksHydrated()

      expect(projectionState.fetchBulkCharLore.mock.calls.map(([ids]) => ids.length)).toEqual([32, 32, 1])
      expect(isCharacterLorebookHydrated('char-1')).toBe(true)
      expect(isCharacterLorebookHydrated('char-33')).toBe(false)
      expect(isCharacterLorebookHydrated('char-65')).toBe(true)

      projectionState.fetchBulkCharLore.mockClear()
      projectionState.fetchBulkCharLore.mockImplementation(async (ids: string[]) => okBulkLorebookResult(ids))
      await ensureAllCharacterLorebooksHydrated()
      expect(projectionState.fetchBulkCharLore).toHaveBeenCalledTimes(1)
      expect(projectionState.fetchBulkCharLore.mock.calls[0][0]).toEqual(
        Array.from({ length: 32 }, (_, index) => `char-${index + 33}`),
      )

      resetChatHydration()
      resetLorebookHydration()
      seedManyLorebookStubCharacters(65)
      projectionState.fetchBulkCharLore.mockReset()
      projectionState.fetchBulkCharLore
        .mockImplementationOnce(async (ids: string[]) => okBulkLorebookResult(ids))
        .mockResolvedValueOnce({ status: 'error', error: 'strict lorebook batch failed' })
      await expect(ensureAllCharacterLorebooksHydrated({ strict: true })).rejects.toThrow(
        'Bulk character lorebook hydration failed: strict lorebook batch failed',
      )
      expect(projectionState.fetchBulkCharLore).toHaveBeenCalledTimes(2)
      expect((testDatabaseState.db.characters[64] as { globalLore?: unknown[] }).globalLore).toEqual([])
    } finally {
      warn.mockRestore()
    }
  })

  it('skips missing bulk character lorebook entries without marking them hydrated', async () => {
    seedManyLorebookStubCharacters(2)
    projectionState.fetchBulkCharLore.mockResolvedValueOnce({
      status: 'ok',
      revision: 1,
      characters: [
        {
          characterId: 'char-1',
          globalLore: [{ key: 'char-1', content: 'lore' }],
        },
      ],
      missing: ['char-2'],
    })

    await ensureAllCharacterLorebooksHydrated()

    expect((testDatabaseState.db.characters[0] as { globalLore?: unknown[] }).globalLore).toEqual([
      { key: 'char-1', content: 'lore' },
    ])
    expect((testDatabaseState.db.characters[1] as { globalLore?: unknown[] }).globalLore).toEqual([])
    expect(isCharacterLorebookHydrated('char-1')).toBe(true)
    expect(isCharacterLorebookHydrated('char-2')).toBe(false)

    projectionState.fetchBulkCharLore.mockClear()
    await ensureAllCharacterLorebooksHydrated()
    expect(projectionState.fetchBulkCharLore).toHaveBeenCalledWith(['char-2'])
  })

  it('strict all-character lorebook hydration rejects missing bulk entries', async () => {
    seedManyLorebookStubCharacters(2)
    projectionState.fetchBulkCharLore.mockResolvedValueOnce({
      status: 'ok',
      revision: 1,
      characters: [
        {
          characterId: 'char-1',
          globalLore: [{ key: 'char-1', content: 'lore' }],
        },
      ],
      missing: ['char-2'],
    })

    await expect(ensureAllCharacterLorebooksHydrated({ strict: true })).rejects.toThrow(
      /did not return data for: char-2/,
    )
  })

  it('drops a stale bulk character lorebook hydration response', async () => {
    seedManyLorebookStubCharacters(2)
    setCachedServerCommandRevision(2)
    projectionState.fetchBulkCharLore.mockResolvedValueOnce({
      status: 'ok',
      revision: 1,
      characters: [
        {
          characterId: 'char-1',
          globalLore: [{ key: 'char-1', content: 'old lore' }],
        },
      ],
      missing: [],
    })

    await ensureAllCharacterLorebooksHydrated()

    expect((testDatabaseState.db.characters[0] as { globalLore?: unknown[] }).globalLore).toEqual([])
    expect(isCharacterLorebookHydrated('char-1')).toBe(false)
    projectionState.fetchBulkCharLore.mockClear()
    await ensureAllCharacterLorebooksHydrated()
    expect(projectionState.fetchBulkCharLore).toHaveBeenCalledWith(['char-1', 'char-2'])
  })

  it('is a no-op when stubs are off (globalLore stays resident, no fetch)', async () => {
    await hydrateActiveCharacterLorebook()
    expect(projectionState.fetchCharLore).not.toHaveBeenCalled()
    expect(projectionState.fetchBulkCharLore).not.toHaveBeenCalled()
    expect(isCharacterLorebookHydrated('char-1')).toBe(false)
  })
})
