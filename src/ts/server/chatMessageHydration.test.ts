import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const projectionState = vi.hoisted(() => ({
  canUse: vi.fn(() => true),
  fetchChat: vi.fn(),
}))

vi.mock('./projection', () => ({
  canUseServerProjection: projectionState.canUse,
  fetchServerChatMessages: projectionState.fetchChat,
}))

import { DBState, selectedCharID } from '../stores.svelte'
import {
  ensureAllChatsHydrated,
  hydrateActiveChat,
  hydrateChatMessages,
  resetChatHydration,
} from './chatMessageHydration.svelte'

function okResult(chatId: string, message: Array<Record<string, unknown>>) {
  return { status: 'ok' as const, revision: 1, chatId, message }
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

beforeEach(() => {
  projectionState.canUse.mockReturnValue(true)
  projectionState.fetchChat.mockReset()
  resetChatHydration()
  seedTwoStubChats()
})

afterEach(() => {
  selectedCharID.set(-1)
})

const db = () => (DBState as { db: { characters: Array<{ chats: Array<{ id: string; message: unknown[] }> }> } }).db

describe('chat message hydration bridge', () => {
  it('hydrates only the active chat, and dedupes a second call', async () => {
    projectionState.fetchChat.mockResolvedValue(
      okResult('chat-1', [{ role: 'user', data: 'hi', chatId: 'm1' }]),
    )

    await hydrateActiveChat()

    expect(projectionState.fetchChat).toHaveBeenCalledTimes(1)
    expect(projectionState.fetchChat).toHaveBeenCalledWith('chat-1')
    expect(db().characters[0].chats[0].message).toEqual([{ role: 'user', data: 'hi', chatId: 'm1' }])
    // The unrelated chat stays a stub.
    expect(db().characters[0].chats[1].message).toEqual([])

    // Second call is deduped (no refetch).
    await hydrateActiveChat()
    expect(projectionState.fetchChat).toHaveBeenCalledTimes(1)
  })

  it('force re-hydrates even when already cached', async () => {
    projectionState.fetchChat.mockResolvedValue(okResult('chat-1', [{ role: 'user', data: 'a', chatId: 'm1' }]))
    await hydrateActiveChat()
    projectionState.fetchChat.mockResolvedValue(okResult('chat-1', [{ role: 'user', data: 'b', chatId: 'm1' }]))
    await hydrateActiveChat({ force: true })
    expect(projectionState.fetchChat).toHaveBeenCalledTimes(2)
    expect(db().characters[0].chats[0].message).toEqual([{ role: 'user', data: 'b', chatId: 'm1' }])
  })

  it('ensureAllChatsHydrated fills every chat', async () => {
    projectionState.fetchChat.mockImplementation(async (chatId: string) =>
      okResult(chatId, [{ role: 'user', data: chatId, chatId: `m-${chatId}` }]),
    )

    await ensureAllChatsHydrated()

    expect(projectionState.fetchChat).toHaveBeenCalledTimes(2)
    expect(db().characters[0].chats[0].message).toEqual([
      { role: 'user', data: 'chat-1', chatId: 'm-chat-1' },
    ])
    expect(db().characters[0].chats[1].message).toEqual([
      { role: 'user', data: 'chat-2', chatId: 'm-chat-2' },
    ])
  })

  it('resetChatHydration makes ensureAllChatsHydrated refetch re-stubbed chats', async () => {
    projectionState.fetchChat.mockImplementation(async (chatId: string) =>
      okResult(chatId, [{ role: 'user', data: chatId, chatId: `m-${chatId}` }]),
    )
    await ensureAllChatsHydrated()
    expect(projectionState.fetchChat).toHaveBeenCalledTimes(2)

    // Simulate a foreign `characters` event re-stubbing every chat: messages
    // wiped in DBState AND the hydration cache cleared (bootstrap.ts does both).
    for (const chat of db().characters[0].chats) chat.message = []
    resetChatHydration()
    projectionState.fetchChat.mockClear()

    // Without the reset this would skip the cached ids and export empty stubs.
    await ensureAllChatsHydrated()
    expect(projectionState.fetchChat).toHaveBeenCalledTimes(2)
    expect(db().characters[0].chats[0].message).toEqual([
      { role: 'user', data: 'chat-1', chatId: 'm-chat-1' },
    ])
  })

  it('hydrateChatMessages targets a specific (non-active) chat', async () => {
    projectionState.fetchChat.mockResolvedValue(okResult('chat-2', [{ role: 'char', data: 'yo', chatId: 'm2' }]))
    await hydrateChatMessages('chat-2')
    expect(db().characters[0].chats[1].message).toEqual([{ role: 'char', data: 'yo', chatId: 'm2' }])
  })

  it('hydrates hypaV3Data alongside messages, and clears it when absent', async () => {
    // chat-1 has hypaV3Data; chat-2 has none.
    projectionState.fetchChat.mockImplementation(async (chatId: string) =>
      chatId === 'chat-1'
        ? { status: 'ok' as const, revision: 1, chatId, message: [], hypaV3Data: { mainChunks: [1] } }
        : okResult(chatId, []),
    )
    // Seed a stale hypaV3Data on chat-2 to prove an absent value clears it.
    ;(db().characters[0].chats[1] as { hypaV3Data?: unknown }).hypaV3Data = { stale: true }

    await ensureAllChatsHydrated()

    expect((db().characters[0].chats[0] as { hypaV3Data?: unknown }).hypaV3Data).toEqual({
      mainChunks: [1],
    })
    expect((db().characters[0].chats[1] as { hypaV3Data?: unknown }).hypaV3Data).toBeUndefined()
  })

  it('is a no-op when server projection is unavailable', async () => {
    projectionState.canUse.mockReturnValue(false)
    await hydrateActiveChat()
    await ensureAllChatsHydrated()
    expect(projectionState.fetchChat).not.toHaveBeenCalled()
  })
})
