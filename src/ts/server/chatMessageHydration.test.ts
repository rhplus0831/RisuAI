import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const projectionState = vi.hoisted(() => ({
  canUse: vi.fn(() => true),
  fetchChat: vi.fn(),
  fetchBulkChat: vi.fn(),
  fetchCharLore: vi.fn(),
}))

vi.mock('./projection', () => ({
  canUseServerProjection: projectionState.canUse,
  fetchServerBulkChatMessages: projectionState.fetchBulkChat,
  fetchServerChatMessages: projectionState.fetchChat,
  fetchServerCharacterLorebook: projectionState.fetchCharLore,
}))

import { DBState, selectedCharID } from '../stores.svelte'
import { clearCachedServerCommandRevision, setCachedServerCommandRevision } from './commands'
import {
  BULK_HYDRATION_CONCURRENCY,
  ensureAllCharacterLorebooksHydrated,
  ensureAllChatsHydrated,
  hydrateActiveCharacterLorebook,
  hydrateActiveChat,
  hydrateChatMessages,
  resetChatHydration,
} from './chatMessageHydration.svelte'
import { isCharacterLorebookHydrated, resetLorebookHydration } from './lorebookBridge.svelte'

function okResult(chatId: string, message: Array<Record<string, unknown>>) {
  return { status: 'ok' as const, revision: 1, chatId, message, alternates: [] }
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
  projectionState.fetchBulkChat.mockImplementation(async (chatIds: string[]) =>
    okBulkResult(chatIds),
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
    expect(projectionState.fetchChat).toHaveBeenCalledWith('chat-1')
    expect(db().characters[0].chats[0].message).toEqual([
      { role: 'user', data: 'hi', chatId: 'm1' },
    ])
    // The unrelated chat stays a stub.
    expect(db().characters[0].chats[1].message).toEqual([])

    // Second call is deduped (no refetch).
    await hydrateActiveChat()
    expect(projectionState.fetchChat).toHaveBeenCalledTimes(1)
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

  it('hydrates many chats with one bulk chat request', async () => {
    seedManyStubChats(BULK_HYDRATION_CONCURRENCY * 3)

    await ensureAllChatsHydrated()

    expect(projectionState.fetchBulkChat).toHaveBeenCalledTimes(1)
    expect(projectionState.fetchBulkChat.mock.calls[0][0]).toHaveLength(
      BULK_HYDRATION_CONCURRENCY * 3,
    )
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
    expect(db().characters[0].chats[1].message).toEqual([
      { role: 'char', data: 'yo', chatId: 'm2' },
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

  it('bounds bulk character lorebook hydration concurrency', async () => {
    seedManyLorebookStubCharacters(BULK_HYDRATION_CONCURRENCY * 3)
    let activeRequests = 0
    let maxActiveRequests = 0
    projectionState.fetchCharLore.mockImplementation(async (characterId: string) => {
      activeRequests += 1
      maxActiveRequests = Math.max(maxActiveRequests, activeRequests)
      await new Promise<void>((resolve) => setTimeout(resolve, 0))
      activeRequests -= 1
      return {
        status: 'ok',
        revision: 1,
        characterId,
        globalLore: [{ key: characterId, content: 'lore' }],
      }
    })

    await ensureAllCharacterLorebooksHydrated()

    expect(projectionState.fetchCharLore).toHaveBeenCalledTimes(BULK_HYDRATION_CONCURRENCY * 3)
    expect(maxActiveRequests).toBeLessThanOrEqual(BULK_HYDRATION_CONCURRENCY)
  })

  it('is a no-op when stubs are off (globalLore stays resident, no fetch)', async () => {
    await hydrateActiveCharacterLorebook()
    expect(projectionState.fetchCharLore).not.toHaveBeenCalled()
    expect(isCharacterLorebookHydrated('char-1')).toBe(false)
  })
})
