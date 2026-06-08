import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const projectionState = vi.hoisted(() => ({
  canUse: vi.fn(() => true),
  fetchChat: vi.fn(),
  fetchBulkChat: vi.fn(),
  fetchCharLore: vi.fn(),
  fetchBulkCharLore: vi.fn(),
}))

vi.mock('./projection', () => ({
  canUseServerProjection: projectionState.canUse,
  fetchServerBulkCharacterLorebooks: projectionState.fetchBulkCharLore,
  fetchServerBulkChatMessages: projectionState.fetchBulkChat,
  fetchServerChatMessages: projectionState.fetchChat,
  fetchServerCharacterLorebook: projectionState.fetchCharLore,
}))

import { DBState, selectedCharID } from '../stores.svelte'
import { clearCachedServerCommandRevision, setCachedServerCommandRevision } from './commands'
import { isServerChatMessagePlaceholder, type Message } from '../storage/database.svelte'
import {
  BULK_HYDRATION_CONCURRENCY,
  ACTIVE_CHAT_INITIAL_MESSAGE_WINDOW,
  ensureAllCharacterLorebooksHydrated,
  ensureAllChatsHydrated,
  hydrateActiveCharacterLorebook,
  hydrateActiveChat,
  hydrateActiveChatWindow,
  hydrateActiveChatFully,
  hydrateChatMessages,
  isChatMessageHydrationPending,
  resetChatHydration,
} from './chatMessageHydration.svelte'
import { isCharacterLorebookHydrated, resetLorebookHydration } from './lorebookBridge.svelte'
import { getProtocolDiagnosticsSnapshot } from './protocolDiagnostics'

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
  ;(DBState as { db: unknown }).db = {
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
  ;(DBState as { db: unknown }).db = {
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
  ;(DBState as { db: unknown }).db = {
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
  projectionState.fetchBulkChat.mockImplementation(async (chatIds: string[]) =>
    okBulkResult(chatIds),
  )
  projectionState.fetchBulkCharLore.mockImplementation(async (characterIds: string[]) =>
    okBulkLorebookResult(characterIds),
  )
  clearCachedServerCommandRevision()
  resetChatHydration()
  resetLorebookHydration()
  seedTwoStubChats()
})

afterEach(() => {
  selectedCharID.set(-1)
})

const db = () =>
  (DBState as { db: { characters: Array<{ chats: Array<{ id: string; message: unknown[] }> }> } })
    .db

describe('chat message hydration bridge', () => {
  it('hydrates only the active chat, and dedupes a second call', async () => {
    projectionState.fetchChat.mockResolvedValue(
      okResult('chat-1', [{ role: 'user', data: 'hi', chatId: 'm1' }]),
    )

    await hydrateActiveChat()

    expect(projectionState.fetchChat).toHaveBeenCalledTimes(1)
    expect(projectionState.fetchChat).toHaveBeenCalledWith('chat-1', {
      tail: ACTIVE_CHAT_INITIAL_MESSAGE_WINDOW,
    })
    expect(db().characters[0].chats[0].message).toEqual([
      { role: 'user', data: 'hi', chatId: 'm1' },
    ])
    // The unrelated chat stays a stub.
    expect(db().characters[0].chats[1].message).toEqual([])

    // Second call is deduped (no refetch).
    await hydrateActiveChat()
    expect(projectionState.fetchChat).toHaveBeenCalledTimes(1)
  })

  it('uses the configured active chat tail window size', async () => {
    ;(DBState.db as { chatDisplayTailCount?: number }).chatDisplayTailCount = 12
    projectionState.fetchChat.mockResolvedValue(
      okResult('chat-1', [{ role: 'user', data: 'hi', chatId: 'm1' }]),
    )

    await hydrateActiveChat()

    expect(projectionState.fetchChat).toHaveBeenCalledWith('chat-1', { tail: 12 })
  })

  it('force re-hydrates even when already cached', async () => {
    projectionState.fetchChat.mockResolvedValue(
      okResult('chat-1', [{ role: 'user', data: 'a', chatId: 'm1' }]),
    )
    await hydrateActiveChat()
    projectionState.fetchChat.mockResolvedValue(
      okResult('chat-1', [{ role: 'user', data: 'b', chatId: 'm1' }]),
    )
    await hydrateActiveChat({ force: true })
    expect(projectionState.fetchChat).toHaveBeenCalledTimes(2)
    expect(db().characters[0].chats[0].message).toEqual([{ role: 'user', data: 'b', chatId: 'm1' }])
  })

  it('hydrates only the active chat tail window and keeps absolute indexes stable', async () => {
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
    expect(db().characters[0].chats[0].message.map((message) => message.data)).toEqual([
      'older-1',
      'older-2',
      'older-3',
      'tail',
    ])
  })

  it('ensureAllChatsHydrated fills every chat', async () => {
    await ensureAllChatsHydrated()

    expect(projectionState.fetchBulkChat).toHaveBeenCalledTimes(1)
    expect(projectionState.fetchBulkChat).toHaveBeenCalledWith(['chat-1', 'chat-2'])
    expect(projectionState.fetchChat).not.toHaveBeenCalled()
    expect(db().characters[0].chats[0].message).toEqual([
      { role: 'user', data: 'chat-1', chatId: 'm-chat-1' },
    ])
    expect(db().characters[0].chats[1].message).toEqual([
      { role: 'user', data: 'chat-2', chatId: 'm-chat-2' },
    ])
  })

  it('ensureAllChatsHydrated includes chats that only have a partial active window', async () => {
    projectionState.fetchChat.mockResolvedValueOnce(
      okWindowResult('chat-1', [{ role: 'char', data: 'tail', chatId: 'm2' }], 1, 2),
    )
    await hydrateActiveChat({ loadPages: 1 })
    projectionState.fetchBulkChat.mockClear()

    await ensureAllChatsHydrated()

    expect(projectionState.fetchBulkChat).toHaveBeenCalledWith(['chat-1', 'chat-2'])
    expect(db().characters[0].chats[0].message).toEqual([
      { role: 'user', data: 'chat-1', chatId: 'm-chat-1' },
    ])
  })

  it('hydrates many chats with one bulk chat request', async () => {
    seedManyStubChats(BULK_HYDRATION_CONCURRENCY * 3)

    await ensureAllChatsHydrated()

    expect(projectionState.fetchBulkChat).toHaveBeenCalledTimes(1)
    expect(projectionState.fetchBulkChat.mock.calls[0][0]).toHaveLength(
      BULK_HYDRATION_CONCURRENCY * 3,
    )
    expect(projectionState.fetchChat).not.toHaveBeenCalled()
  })

  it('keeps all-chat hydration within the request-count budget', async () => {
    seedManyStubChats(BULK_HYDRATION_CONCURRENCY * 3)
    const before = getProtocolDiagnosticsSnapshot().hydration.chat

    await ensureAllChatsHydrated()

    const afterBulk = getProtocolDiagnosticsSnapshot().hydration.chat
    expect(afterBulk.requestsStarted - before.requestsStarted).toBe(1)
    expect(afterBulk.bulkRuns - before.bulkRuns).toBe(1)
    expect(afterBulk.bulkIds - before.bulkIds).toBe(BULK_HYDRATION_CONCURRENCY * 3)
    expect(projectionState.fetchBulkChat).toHaveBeenCalledTimes(1)
    expect(projectionState.fetchChat).not.toHaveBeenCalled()

    await ensureAllChatsHydrated()

    const afterCached = getProtocolDiagnosticsSnapshot().hydration.chat
    expect(afterCached.requestsStarted).toBe(afterBulk.requestsStarted)
    expect(projectionState.fetchBulkChat).toHaveBeenCalledTimes(1)
    expect(projectionState.fetchChat).not.toHaveBeenCalled()
  })

  it('resetChatHydration makes ensureAllChatsHydrated refetch re-stubbed chats', async () => {
    await ensureAllChatsHydrated()
    expect(projectionState.fetchBulkChat).toHaveBeenCalledTimes(1)

    // Simulate a foreign `characters` event re-stubbing every chat: messages
    // wiped in DBState AND the hydration cache cleared (bootstrap.ts does both).
    for (const chat of db().characters[0].chats) chat.message = []
    resetChatHydration()
    projectionState.fetchBulkChat.mockClear()

    // Without the reset this would skip the cached ids and export empty stubs.
    await ensureAllChatsHydrated()
    expect(projectionState.fetchBulkChat).toHaveBeenCalledTimes(1)
    expect(db().characters[0].chats[0].message).toEqual([
      { role: 'user', data: 'chat-1', chatId: 'm-chat-1' },
    ])
  })

  it('hydrateChatMessages targets a specific (non-active) chat', async () => {
    projectionState.fetchChat.mockResolvedValue(
      okResult('chat-2', [{ role: 'char', data: 'yo', chatId: 'm2' }]),
    )
    await hydrateChatMessages('chat-2')
    expect(projectionState.fetchChat).toHaveBeenCalledWith('chat-2', {})
    expect(db().characters[0].chats[1].message).toEqual([
      { role: 'char', data: 'yo', chatId: 'm2' },
    ])
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

    expect(db().characters[0].chats[0].message).toEqual([
      { role: 'user', data: 'chat-1', chatId: 'm-chat-1' },
    ])
    expect(db().characters[0].chats[1].message).toEqual([])

    projectionState.fetchBulkChat.mockClear()
    await ensureAllChatsHydrated()
    expect(projectionState.fetchBulkChat).toHaveBeenCalledWith(['chat-2'])
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

    expect(db().characters[0].chats[0].message).toEqual([
      { role: 'user', data: 'hi', chatId: 'm1' },
    ])
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

    projectionState.fetchChat.mockResolvedValue(
      okResult('chat-1', [{ role: 'user', data: 'hi', chatId: 'm1' }]),
    )
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

  it('clears after a failed fetch so it never spins forever', async () => {
    projectionState.fetchChat.mockResolvedValue({ status: 'error' })
    await hydrateActiveChat()
    expect(isChatMessageHydrationPending('chat-1', 0)).toBe(false)
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
    projectionState.fetchChat.mockResolvedValue(
      okResult('chat-1', [{ role: 'user', data: 'hi', chatId: 'm1' }]),
    )
    await hydrateActiveChat()
    expect(isChatMessageHydrationPending('chat-1', 1)).toBe(false)

    // A foreign re-stub wipes messages and clears the hydration cache.
    resetChatHydration()
    expect(isChatMessageHydrationPending('chat-1', 0)).toBe(true)
  })
})

describe('character globalLore hydration (Phase 5)', () => {
  it('hydrates + marks the open character globalLore when stubs are on', async () => {
    ;(DBState.db as { enableLorebookStubs?: boolean }).enableLorebookStubs = true
    projectionState.fetchCharLore.mockResolvedValue({
      status: 'ok',
      revision: 1,
      characterId: 'char-1',
      globalLore: [{ key: 'k', content: 'lore' }],
    })

    expect(isCharacterLorebookHydrated('char-1')).toBe(false)
    await hydrateActiveCharacterLorebook()

    expect(projectionState.fetchCharLore).toHaveBeenCalledWith('char-1')
    expect((db().characters[0] as { globalLore?: unknown[] }).globalLore).toEqual([
      { key: 'k', content: 'lore' },
    ])
    // Marked hydrated → the lorebook watcher will now track (and persist) edits.
    expect(isCharacterLorebookHydrated('char-1')).toBe(true)

    // Deduped on a second call (no refetch).
    await hydrateActiveCharacterLorebook()
    expect(projectionState.fetchCharLore).toHaveBeenCalledTimes(1)
  })

  it('hydrates many character lorebooks with one bulk request', async () => {
    seedManyLorebookStubCharacters(BULK_HYDRATION_CONCURRENCY * 3)

    await ensureAllCharacterLorebooksHydrated()

    expect(projectionState.fetchBulkCharLore).toHaveBeenCalledTimes(1)
    expect(projectionState.fetchBulkCharLore.mock.calls[0][0]).toHaveLength(
      BULK_HYDRATION_CONCURRENCY * 3,
    )
    expect(projectionState.fetchCharLore).not.toHaveBeenCalled()
    expect((DBState.db.characters[0] as { globalLore?: unknown[] }).globalLore).toEqual([
      { key: 'char-1', content: 'lore' },
    ])
    expect(isCharacterLorebookHydrated('char-1')).toBe(true)
  })

  it('keeps all-character lorebook hydration within the request-count budget', async () => {
    seedManyLorebookStubCharacters(BULK_HYDRATION_CONCURRENCY * 3)
    const before = getProtocolDiagnosticsSnapshot().hydration.characterLorebook

    await ensureAllCharacterLorebooksHydrated()

    const afterBulk = getProtocolDiagnosticsSnapshot().hydration.characterLorebook
    expect(afterBulk.requestsStarted - before.requestsStarted).toBe(1)
    expect(afterBulk.bulkRuns - before.bulkRuns).toBe(1)
    expect(afterBulk.bulkIds - before.bulkIds).toBe(BULK_HYDRATION_CONCURRENCY * 3)
    expect(projectionState.fetchBulkCharLore).toHaveBeenCalledTimes(1)
    expect(projectionState.fetchCharLore).not.toHaveBeenCalled()

    await ensureAllCharacterLorebooksHydrated()

    const afterCached = getProtocolDiagnosticsSnapshot().hydration.characterLorebook
    expect(afterCached.requestsStarted).toBe(afterBulk.requestsStarted)
    expect(projectionState.fetchBulkCharLore).toHaveBeenCalledTimes(1)
    expect(projectionState.fetchCharLore).not.toHaveBeenCalled()
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

    expect((DBState.db.characters[0] as { globalLore?: unknown[] }).globalLore).toEqual([
      { key: 'char-1', content: 'lore' },
    ])
    expect((DBState.db.characters[1] as { globalLore?: unknown[] }).globalLore).toEqual([])
    expect(isCharacterLorebookHydrated('char-1')).toBe(true)
    expect(isCharacterLorebookHydrated('char-2')).toBe(false)

    projectionState.fetchBulkCharLore.mockClear()
    await ensureAllCharacterLorebooksHydrated()
    expect(projectionState.fetchBulkCharLore).toHaveBeenCalledWith(['char-2'])
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

    expect((DBState.db.characters[0] as { globalLore?: unknown[] }).globalLore).toEqual([])
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
