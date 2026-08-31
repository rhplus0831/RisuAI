import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

// Prove the extracted swipe machine mutates the explicit chat-message owner
// while preserving the command boundary used by the Fastify runtime.

vi.mock('../platform', async (importActual) => ({
  ...(await (importActual() as Promise<object>)),
  isFastifyServer: true,
}))

const commandSpies = vi.hoisted(() => ({
  currentChatScopedSnapshot: vi.fn(() => ({ snapshot: true })),
  dispatchReplaceTailMessagesScoped: vi.fn(),
  dispatchReplaceMessagesScoped: vi.fn(),
  dispatchUpdateMessageScoped: vi.fn(),
}))
vi.mock('../chatCommands', () => commandSpies)

const prerollSpies = vi.hoisted(() => ({
  Prereroll: vi.fn(() => null),
  PreUnreroll: vi.fn(() => null),
  addRerolls: vi.fn(),
  clearPrererolls: vi.fn(),
}))
vi.mock('./prereroll', () => prerollSpies)

import { selectedCharID } from '../stores.svelte'
import { get } from 'svelte/store'
import { testDatabaseState } from '../__tests__/resourceDatabaseState'

import { charactersResourceState } from '../server/resourceState.svelte'
import {
  getRerollId,
  reroll,
  resetRerollNavigation,
  seedRerollBufferFromAlternates,
  unReroll,
} from './rerollNavigation.svelte'
type Msg = { role: 'user' | 'char'; data: string; chatId: string }

function tailUid(): string {
  return (testDatabaseState.db.characters[0].chats[0].message.at(-1) as unknown as Msg).chatId
}

beforeEach(() => {
  resetRerollNavigation()
  vi.clearAllMocks()
  testDatabaseState.db = {
    characters: [{ chaId: 'c1', chatPage: 0, chats: [{ id: 'chat-1', message: [] as Msg[] }] }],
  }
  selectedCharID.set(0)
  commandSpies.currentChatScopedSnapshot.mockImplementation(() => {
    const selectedIndex = get(selectedCharID)
    const character = charactersResourceState.characters[selectedIndex]
    const chat = character?.chats?.[character.chatPage]
    return {
      selectedCharID: selectedIndex,
      characterId: character?.chaId,
      chatId: chat?.id,
      chat: chat ? JSON.parse(JSON.stringify(chat)) : undefined,
    }
  })
  commandSpies.dispatchReplaceTailMessagesScoped.mockImplementation(
    (chatId: string, afterMessageId: string | null, messages: Msg[]) => {
      const chat = charactersResourceState.characters
        .flatMap((character) => character.chats ?? [])
        .find((row) => row.id === chatId)
      if (!chat) return
      const index =
        afterMessageId === null ? -1 : chat.message.findIndex((message) => message.chatId === afterMessageId)
      chat.message = chat.message.slice(0, index + 1).concat(structuredClone(messages) as never)
    },
  )
  commandSpies.dispatchUpdateMessageScoped.mockImplementation((messageId: string, patch: { data?: string }) => {
    const message = charactersResourceState.characters
      .flatMap((character) => character.chats ?? [])
      .flatMap((chat) => chat.message ?? [])
      .find((row) => row.chatId === messageId)
    if (message && patch.data !== undefined) message.data = patch.data
  })
})

afterEach(() => {
  selectedCharID.set(-1)
})

describe('reroll swipe through the chat message owner', () => {
  function seedActiveTranscript(): void {
    const active: Msg[] = [
      { role: 'user', data: 'hi', chatId: 'u1' },
      { role: 'char', data: 'c3', chatId: 'g3' },
    ]
    testDatabaseState.db.characters[0].chats[0].message = active
    seedRerollBufferFromAlternates(active, [
      { role: 'char', data: 'c3', chatId: 'g3' },
      { role: 'char', data: 'c2', chatId: 'g2' },
      { role: 'char', data: 'c1', chatId: 'g1' },
    ])
  }

  it('unReroll swaps the active owner tail', async () => {
    seedActiveTranscript()
    await expect(unReroll()).resolves.toBeUndefined()
    expect(tailUid()).toBe('g2')
    expect(getRerollId()).toBe(1)
    expect(commandSpies.dispatchReplaceTailMessagesScoped).toHaveBeenCalledTimes(1)
    expect(commandSpies.dispatchReplaceMessagesScoped).not.toHaveBeenCalled()
  })

  it('reroll navigates forward through the active owner', async () => {
    seedActiveTranscript()
    await unReroll() // → g2
    await expect(reroll({ sendChatMain: vi.fn(), closeMenu: vi.fn() })).resolves.toBeUndefined()
    expect(tailUid()).toBe('g3')
    expect(getRerollId()).toBe(2)
  })

  it('reroll regenerate submits the active target without mutating it', async () => {
    seedActiveTranscript() // active = [u1, g3], positioned at the end of the buffer
    const sendChatMain = vi.fn(async () => true)
    await expect(reroll({ sendChatMain, closeMenu: vi.fn() })).resolves.toBeUndefined()
    expect(tailUid()).toBe('g3')
    expect(sendChatMain).toHaveBeenCalledWith(false, 'g3')
    expect(commandSpies.dispatchReplaceTailMessagesScoped).not.toHaveBeenCalled()
    expect(commandSpies.dispatchReplaceMessagesScoped).not.toHaveBeenCalled()
  })

  it('leaves a failed regenerate target untouched in its owner', async () => {
    seedActiveTranscript()
    const sendChatMain = vi.fn(async () => false)

    await expect(reroll({ sendChatMain, closeMenu: vi.fn() })).resolves.toBeUndefined()

    expect(tailUid()).toBe('g3')
    expect(commandSpies.dispatchReplaceTailMessagesScoped).not.toHaveBeenCalled()
  })
})
