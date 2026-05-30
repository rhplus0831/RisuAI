import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

// Lazy-projection Phase 6c (client): unit-drive the extracted reroll swipe state
// machine. Per the handover, keep `stores.svelte` REAL (DBState is the live state
// the machine reads/writes) and mock only the command layer (the durable dispatch)
// + the prefetch buffer.

const commandSpies = vi.hoisted(() => ({
  currentChatStateSnapshot: vi.fn(() => ({ snapshot: true })),
  dispatchReplaceMessages: vi.fn(),
  dispatchUpdateMessage: vi.fn(),
  ensureMessageId: vi.fn((message: { chatId?: string }) => {
    if (!message.chatId) message.chatId = 'minted'
    return message.chatId
  }),
}))
vi.mock('../chatCommands', () => commandSpies)

const prerollSpies = vi.hoisted(() => ({
  Prereroll: vi.fn(() => null),
  PreUnreroll: vi.fn(() => null),
  addRerolls: vi.fn(),
}))
vi.mock('./prereroll', () => prerollSpies)

import { DBState, selectedCharID } from '../stores.svelte'
import {
  clearRerollBuffer,
  getRerollBuffer,
  getRerollId,
  markRerollChar,
  recordGeneratedReroll,
  reroll,
  resetRerollNavigation,
  resetRerollOnCharChange,
  seedRerollBufferFromAlternates,
  unReroll,
} from './rerollNavigation.svelte'

type Msg = { role: string; data: string; chatId: string; generationInfo?: { generationId: string } }

function setupChat(message: Msg[], charIndex = 0): void {
  ;(DBState as { db: unknown }).db = {
    characters: [
      { chaId: 'c1', chatPage: 0, chats: [{ id: 'chat-1', message }] },
      { chaId: 'c2', chatPage: 0, chats: [{ id: 'chat-2', message: [] }] },
    ],
  }
  selectedCharID.set(charIndex)
}

function tailUids(): string[] {
  const character = (DBState as { db: { characters: { chats: { message: Msg[] }[] }[] } }).db
    .characters[0]
  return character.chats[0].message.map((m) => m.chatId)
}

function bufferUids(): string[][] {
  return getRerollBuffer().map((entry) => entry.map((m) => (m as unknown as Msg).chatId))
}

beforeEach(() => {
  resetRerollNavigation()
  vi.clearAllMocks()
})

afterEach(() => {
  selectedCharID.set(-1)
})

describe('reroll buffer hydration (seedRerollBufferFromAlternates)', () => {
  // The server buffers every candidate of the turn (the active one included), so a
  // round-trip of [oldest..newest] with the newest = active tail reconstructs in
  // chronological order with the active positioned.
  it('rebuilds the swipe buffer in chronological order with the active tail positioned', () => {
    const active: Msg[] = [
      { role: 'user', data: 'hi', chatId: 'u1' },
      { role: 'char', data: 'c3', chatId: 'g3' },
    ]
    setupChat(active)
    // Server ships newest-added first.
    const alternates: Msg[] = [
      { role: 'char', data: 'c3', chatId: 'g3' },
      { role: 'char', data: 'c2', chatId: 'g2' },
      { role: 'char', data: 'c1', chatId: 'g1' },
    ]
    seedRerollBufferFromAlternates(active, alternates)
    expect(bufferUids()).toEqual([['g1'], ['g2'], ['g3']])
    expect(getRerollId()).toBe(2)
  })

  it('appends the active tail when the buffer holds only displaced candidates (legacy rows)', () => {
    const active: Msg[] = [
      { role: 'user', data: 'hi', chatId: 'u1' },
      { role: 'char', data: 'A1', chatId: 'g1' },
    ]
    setupChat(active)
    // Only the displaced (older) candidate — the active 'g1' is absent.
    seedRerollBufferFromAlternates(active, [{ role: 'char', data: 'A0', chatId: 'g0' }])
    expect(bufferUids()).toEqual([['g0'], ['g1']])
    expect(getRerollId()).toBe(1)
  })

  it('dedups candidates by uid', () => {
    const active: Msg[] = [
      { role: 'user', data: 'hi', chatId: 'u1' },
      { role: 'char', data: 'c2', chatId: 'g2' },
    ]
    setupChat(active)
    seedRerollBufferFromAlternates(active, [
      { role: 'char', data: 'c2', chatId: 'g2' },
      { role: 'char', data: 'c2-dup', chatId: 'g2' },
      { role: 'char', data: 'c1', chatId: 'g1' },
    ])
    expect(bufferUids()).toEqual([['g1'], ['g2']])
    expect(getRerollId()).toBe(1)
  })

  it('is a no-op (leaves a fresh buffer) when there are no persisted candidates', () => {
    setupChat([{ role: 'char', data: 'x', chatId: 'g1' }])
    seedRerollBufferFromAlternates([{ role: 'char', data: 'x', chatId: 'g1' }], [])
    expect(getRerollBuffer()).toEqual([])
    expect(getRerollId()).toBe(-1)
  })

  it('does not seed when the active tail is a user message', () => {
    const active: Msg[] = [
      { role: 'char', data: 'a', chatId: 'g1' },
      { role: 'user', data: 'hi', chatId: 'u1' },
    ]
    setupChat(active)
    seedRerollBufferFromAlternates(active, [{ role: 'char', data: 'a', chatId: 'g1' }])
    expect(getRerollBuffer()).toEqual([])
  })
})

describe('reroll swipe navigation (post-seed, durable for free)', () => {
  function seedThreeCandidates(): void {
    const active: Msg[] = [
      { role: 'user', data: 'hi', chatId: 'u1' },
      { role: 'char', data: 'c3', chatId: 'g3' },
    ]
    setupChat(active)
    seedRerollBufferFromAlternates(active, [
      { role: 'char', data: 'c3', chatId: 'g3' },
      { role: 'char', data: 'c2', chatId: 'g2' },
      { role: 'char', data: 'c1', chatId: 'g1' },
    ])
  }

  it('unReroll swaps the active tail to the previous candidate and dispatches it durably', async () => {
    seedThreeCandidates()
    await unReroll()
    expect(getRerollId()).toBe(1)
    expect(tailUids()).toEqual(['u1', 'g2'])
    expect(commandSpies.dispatchReplaceMessages).toHaveBeenCalledTimes(1)
    expect(commandSpies.dispatchReplaceMessages.mock.calls[0][0]).toBe('chat-1')
  })

  it('reroll navigates forward to the next candidate without generating', async () => {
    seedThreeCandidates()
    await unReroll() // → g2 (id 1)
    const sendChatMain = vi.fn()
    await reroll({ sendChatMain, closeMenu: vi.fn() })
    expect(getRerollId()).toBe(2)
    expect(tailUids()).toEqual(['u1', 'g3'])
    expect(sendChatMain).not.toHaveBeenCalled()
  })

  it('rerolling past the newest candidate generates a new one (regenerate)', async () => {
    seedThreeCandidates() // active = g3 at id 2 (the end)
    const sendChatMain = vi.fn(async () => {})
    await reroll({ sendChatMain, closeMenu: vi.fn() })
    // At the end of the buffer → pops the assistant tail back to the user row and
    // asks for a regenerate keyed by the old assistant id.
    expect(sendChatMain).toHaveBeenCalledTimes(1)
    expect(sendChatMain).toHaveBeenCalledWith(false, 'g3')
    expect(tailUids()).toEqual(['u1'])
  })

  it('does not wipe the seeded buffer on the next reroll (char-change guard primed)', async () => {
    seedThreeCandidates()
    // resetRerollOnCharChange runs first inside unReroll; the seed primed lastCharId
    // to the selected char, so the buffer survives.
    await unReroll()
    expect(getRerollBuffer()).toHaveLength(3)
  })
})

describe('reroll buffer lifecycle (generation + confirm boundary)', () => {
  it('records a newly generated tail as the newest candidate', () => {
    setupChat([{ role: 'user', data: 'hi', chatId: 'u1' }])
    markRerollChar()
    DBState.db.characters[0].chats[0].message.push({
      role: 'char',
      data: 'A1',
      chatId: 'g1',
    } as never)
    recordGeneratedReroll(1)
    expect(bufferUids()).toEqual([['g1']])
    expect(getRerollId()).toBe(0)
  })

  it('clearRerollBuffer drops the swipe history (send/continue confirm boundary)', () => {
    setupChat([{ role: 'char', data: 'a', chatId: 'g1' }])
    seedRerollBufferFromAlternates(
      [{ role: 'char', data: 'a', chatId: 'g1' }],
      [
        { role: 'char', data: 'a', chatId: 'g1' },
        { role: 'char', data: 'b', chatId: 'g0' },
      ],
    )
    expect(getRerollBuffer().length).toBeGreaterThan(0)
    clearRerollBuffer()
    expect(getRerollBuffer()).toEqual([])
  })

  it('resetRerollOnCharChange wipes the buffer when the character changed', () => {
    const active: Msg[] = [
      { role: 'user', data: 'hi', chatId: 'u1' },
      { role: 'char', data: 'c2', chatId: 'g2' },
    ]
    setupChat(active)
    seedRerollBufferFromAlternates(active, [
      { role: 'char', data: 'c2', chatId: 'g2' },
      { role: 'char', data: 'c1', chatId: 'g1' },
    ])
    expect(getRerollBuffer().length).toBe(2)
    // Switch character → the next swipe op resets.
    selectedCharID.set(1)
    resetRerollOnCharChange()
    expect(getRerollBuffer()).toEqual([])
    expect(getRerollId()).toBe(-1)
  })
})
