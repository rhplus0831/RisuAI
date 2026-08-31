import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

// Unit-drive the extracted reroll swipe state machine. Keep `stores.svelte` real
// (the resource database is the live state the machine reads/writes) and mock only the command
// layer plus the prefetch buffer.

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
import type { ActiveChatTarget } from '../chatCommands'
import { withCloneInstrumentation } from '../__tests__/cloneCostHarness'
import { testDatabaseState } from '../__tests__/resourceDatabaseState'
import { charactersResourceState } from '../server/resourceState.svelte'
import {
  clearRerollBuffer,
  getRerollBuffer,
  getRerollCandidates,
  getRerollId,
  markRerollChar,
  newReroll,
  recordGeneratedReroll,
  reroll,
  resetRerollNavigation,
  resetRerollOnCharChange,
  seedRerollBufferFromAlternates,
  selectRerollCandidate,
  unReroll,
} from './rerollNavigation.svelte'

type Msg = { role: string; data: string; chatId: string; generationInfo?: { generationId: string } }

function setupChat(message: Msg[], charIndex = 0): void {
  testDatabaseState.db = {
    characters: [
      { chaId: 'c1', chatPage: 0, chats: [{ id: 'chat-1', message }] },
      { chaId: 'c2', chatPage: 0, chats: [{ id: 'chat-2', message: [] }] },
    ],
  }
  selectedCharID.set(charIndex)
}

function targetFor(charIndex = 0): ActiveChatTarget {
  const character = testDatabaseState.db.characters[charIndex]
  return {
    selectedCharID: charIndex,
    chatPage: character.chatPage,
    characterId: character.chaId,
    chatId: character.chats[character.chatPage].id,
  }
}

function tailUids(): string[] {
  const character = testDatabaseState.db.characters[0] as unknown as { chats: { message: Msg[] }[] }
  return character.chats[0].message.map((m) => m.chatId)
}

function bufferUids(target?: ActiveChatTarget): string[][] {
  return getRerollBuffer(target).map((entry) => entry.map((m) => (m as unknown as Msg).chatId))
}

beforeEach(() => {
  resetRerollNavigation()
  vi.clearAllMocks()
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
    expect(commandSpies.dispatchReplaceTailMessagesScoped).toHaveBeenCalledTimes(1)
    expect(commandSpies.dispatchReplaceTailMessagesScoped.mock.calls[0][0]).toBe('chat-1')
    expect(commandSpies.dispatchReplaceTailMessagesScoped.mock.calls[0][1]).toBe('u1')
    expect(
      commandSpies.dispatchReplaceTailMessagesScoped.mock.calls[0][2].map((message: Msg) => message.chatId),
    ).toEqual(['g2'])
    expect(commandSpies.dispatchReplaceMessagesScoped).not.toHaveBeenCalled()
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

  it('delegates a prefetched tail swap to the scoped command owner', async () => {
    setupChat([
      { role: 'user', data: 'hi', chatId: 'u1' },
      { role: 'char', data: 'active', chatId: 'g1', generationInfo: { generationId: 'generation-1' } },
    ])
    prerollSpies.Prereroll.mockReturnValueOnce('prefetched')

    await reroll({ sendChatMain: vi.fn(), closeMenu: vi.fn() })

    const tail = testDatabaseState.db.characters[0].chats[0].message.at(-1) as unknown as Msg
    expect(tail.data).toBe('prefetched')
    expect(commandSpies.dispatchUpdateMessageScoped).toHaveBeenCalledWith(
      'g1',
      { data: 'prefetched' },
      expect.objectContaining({ characterId: 'c1', chatId: 'chat-1' }),
    )
  })

  it('rerolling past the newest candidate generates a new one (regenerate)', async () => {
    seedThreeCandidates() // active = g3 at id 2 (the end)
    const sendChatMain = vi.fn(async () => {
      // The exact assistant remains authoritative through operation admission.
      expect(tailUids()).toEqual(['u1', 'g3'])
      testDatabaseState.db.characters[0].chats[0].message[1] = {
        role: 'char',
        data: 'c4',
        chatId: 'g4',
      }
      return true
    })
    await reroll({ sendChatMain, closeMenu: vi.fn() })
    // At the end of the buffer, ask the server to replace the still-present
    // assistant by its stable id.
    expect(sendChatMain).toHaveBeenCalledTimes(1)
    expect(sendChatMain).toHaveBeenCalledWith(false, 'g3')
    expect(tailUids()).toEqual(['u1', 'g4'])
    expect(bufferUids()).toEqual([['g1'], ['g2'], ['g3'], ['g4']])
    expect(commandSpies.dispatchReplaceMessagesScoped).not.toHaveBeenCalled()
  })

  it('leaves the authoritative assistant untouched when regenerate returns false', async () => {
    seedThreeCandidates()
    const sendChatMain = vi.fn(async () => false)

    await reroll({ sendChatMain, closeMenu: vi.fn() })

    expect(sendChatMain).toHaveBeenCalledWith(false, 'g3')
    expect(tailUids()).toEqual(['u1', 'g3'])
    expect(getRerollId()).toBe(2)
    expect(commandSpies.dispatchReplaceTailMessagesScoped).not.toHaveBeenCalled()
  })

  it('keeps the authoritative assistant while propagating a regenerate exception', async () => {
    seedThreeCandidates()
    const failure = new Error('regenerate preflight failed')
    const sendChatMain = vi.fn(async () => {
      throw failure
    })

    await expect(reroll({ sendChatMain, closeMenu: vi.fn() })).rejects.toBe(failure)

    expect(tailUids()).toEqual(['u1', 'g3'])
    expect(commandSpies.dispatchReplaceTailMessagesScoped).not.toHaveBeenCalled()
  })

  it('selectRerollCandidate jumps directly to a saved candidate', async () => {
    seedThreeCandidates()
    await selectRerollCandidate(0)
    expect(getRerollId()).toBe(0)
    expect(tailUids()).toEqual(['u1', 'g1'])
    expect(commandSpies.dispatchReplaceTailMessagesScoped).toHaveBeenCalledTimes(1)
    expect(
      commandSpies.dispatchReplaceTailMessagesScoped.mock.calls[0][2].map((message: Msg) => message.chatId),
    ).toEqual(['g1'])
  })

  it('fails closed without moving the swipe pointer when a candidate duplicates an owned message id', async () => {
    const active: Msg[] = [
      { role: 'user', data: 'hi', chatId: 'u1' },
      { role: 'char', data: 'active', chatId: 'g3' },
    ]
    setupChat(active)
    seedRerollBufferFromAlternates(active, [
      { role: 'char', data: 'active', chatId: 'g3' },
      { role: 'char', data: 'duplicate id', chatId: 'u1' },
    ])

    await selectRerollCandidate(0)

    expect(getRerollId()).toBe(1)
    expect(tailUids()).toEqual(['u1', 'g3'])
    expect(commandSpies.dispatchReplaceTailMessagesScoped).not.toHaveBeenCalled()
  })

  it('newReroll regenerates instead of moving to the next saved candidate', async () => {
    seedThreeCandidates()
    await selectRerollCandidate(0)
    const sendChatMain = vi.fn(async () => {
      expect(tailUids()).toEqual(['u1', 'g1'])
      testDatabaseState.db.characters[0].chats[0].message[1] = {
        role: 'char',
        data: 'c4',
        chatId: 'g4',
      }
      return true
    })
    await newReroll({ sendChatMain, closeMenu: vi.fn() })
    expect(getRerollId()).toBe(3)
    expect(sendChatMain).toHaveBeenCalledTimes(1)
    expect(sendChatMain).toHaveBeenCalledWith(false, 'g1')
    expect(tailUids()).toEqual(['u1', 'g4'])
  })

  it('getRerollCandidates exposes active candidate metadata for the list UI', () => {
    seedThreeCandidates()
    expect(
      getRerollCandidates().map((candidate) => ({
        index: candidate.index,
        active: candidate.active,
        uids: candidate.messages.map((message) => (message as unknown as Msg).chatId),
      })),
    ).toEqual([
      { index: 0, active: false, uids: ['g1'] },
      { index: 1, active: false, uids: ['g2'] },
      { index: 2, active: true, uids: ['g3'] },
    ])
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
    const target = targetFor()
    markRerollChar(target)
    testDatabaseState.db.characters[0].chats[0].message.push({
      role: 'char',
      data: 'A1',
      chatId: 'g1',
    } as never)
    recordGeneratedReroll(1, target)
    expect(bufferUids()).toEqual([['g1']])
    expect(getRerollId()).toBe(0)
  })

  it('keeps a cross-chat regenerate buffer owned by its origin chat', async () => {
    setupChat([
      { role: 'user', data: 'hi', chatId: 'u1' },
      { role: 'char', data: 'old reply', chatId: 'g-old' },
    ])
    const originTarget = targetFor()
    const sendChatMain = vi.fn(async () => {
      selectedCharID.set(1)
      testDatabaseState.db.characters[0].chats[0].message[1] = {
        role: 'char',
        data: 'new reply',
        chatId: 'g-new',
      } as never
      return true
    })

    await reroll({ sendChatMain, closeMenu: vi.fn() })

    expect(bufferUids(originTarget)).toEqual([['g-old'], ['g-new']])
    expect(getRerollBuffer()).toEqual([])
    await unReroll()
    expect(getRerollBuffer()).toEqual([])
    expect(bufferUids(originTarget)).toEqual([['g-old'], ['g-new']])
    expect(testDatabaseState.db.characters[1].chats[0].message).toEqual([])
    expect(commandSpies.dispatchReplaceTailMessagesScoped).not.toHaveBeenCalled()

    selectedCharID.set(0)
    expect(bufferUids()).toEqual([['g-old'], ['g-new']])
    expect(getRerollId()).toBe(1)
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
    expect(prerollSpies.clearPrererolls).not.toHaveBeenCalled()
  })

  it('preserves each character buffer when the selected character changes', () => {
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
    const firstTarget = targetFor(0)
    // Switch character → the current view has its own empty state.
    selectedCharID.set(1)
    resetRerollOnCharChange()
    expect(getRerollBuffer()).toEqual([])
    expect(getRerollId()).toBe(-1)
    expect(bufferUids(firstTarget)).toEqual([['g1'], ['g2']])
    expect(prerollSpies.clearPrererolls).not.toHaveBeenCalled()

    selectedCharID.set(0)
    expect(bufferUids()).toEqual([['g1'], ['g2']])
    expect(getRerollId()).toBe(1)
  })

  it('preserves each chat buffer and active index when the selected chat changes', async () => {
    const active: Msg[] = [
      { role: 'user', data: 'hi', chatId: 'u1' },
      { role: 'char', data: 'c2', chatId: 'g2' },
    ]
    setupChat(active)
    testDatabaseState.db.characters[0].chats.push({
      id: 'chat-1b',
      message: [{ role: 'char', data: 'other', chatId: 'other-g1' }],
    } as never)
    seedRerollBufferFromAlternates(active, [
      { role: 'char', data: 'c2', chatId: 'g2' },
      { role: 'char', data: 'c1', chatId: 'g1' },
    ])
    expect(getRerollBuffer().length).toBe(2)
    await unReroll()
    expect(getRerollId()).toBe(0)
    const firstTarget = targetFor(0)

    testDatabaseState.db.characters[0].chatPage = 1
    resetRerollOnCharChange()

    expect(getRerollBuffer()).toEqual([])
    expect(getRerollId()).toBe(-1)
    expect(bufferUids(firstTarget)).toEqual([['g1'], ['g2']])
    expect(getRerollId(firstTarget)).toBe(0)
    expect(prerollSpies.clearPrererolls).not.toHaveBeenCalled()

    testDatabaseState.db.characters[0].chatPage = 0
    expect(bufferUids()).toEqual([['g1'], ['g2']])
    expect(getRerollId()).toBe(0)
  })

  it('clears only the confirming chat and leaves another chat candidate index unchanged', async () => {
    const firstMessages: Msg[] = [
      { role: 'user', data: 'first user', chatId: 'a-u1' },
      { role: 'char', data: 'first active', chatId: 'a-g2' },
    ]
    setupChat(firstMessages)
    seedRerollBufferFromAlternates(firstMessages, [
      { role: 'char', data: 'first active', chatId: 'a-g2' },
      { role: 'char', data: 'first older', chatId: 'a-g1' },
    ])
    await unReroll()
    const firstTarget = targetFor(0)

    selectedCharID.set(1)
    const secondTarget = targetFor(1)
    testDatabaseState.db.characters[1].chats[0].message.push(
      { role: 'user', data: 'second user', chatId: 'b-u1' } as never,
      { role: 'char', data: 'second reply', chatId: 'b-g1' } as never,
    )
    recordGeneratedReroll(1, secondTarget)
    clearRerollBuffer(secondTarget)

    expect(getRerollBuffer(secondTarget)).toEqual([])
    expect(bufferUids(firstTarget)).toEqual([['a-g1'], ['a-g2']])
    expect(getRerollId(firstTarget)).toBe(0)
  })
})

describe('reroll clone cost', () => {
  // A long transcript whose tail is a single freshly generated row. The clone-cost
  // harness proves the post-send / regenerate paths never deep-clone the whole
  // transcript just to keep its trailing rows.
  function bigTranscript(prefixCount: number): Msg[] {
    const body = 'y'.repeat(2000)
    const prefix: Msg[] = Array.from({ length: prefixCount }, (_unused, index) => ({
      role: index % 2 === 0 ? 'user' : 'char',
      data: `${body}-${index}`,
      chatId: `p-${index}`,
    }))
    return [...prefix, { role: 'user', data: 'last user', chatId: 'lu' }]
  }

  it('recordGeneratedReroll clones only the generated tail, not the whole transcript', () => {
    const transcript = bigTranscript(40)
    setupChat(transcript)
    const fullSize = JSON.stringify(transcript).length
    expect(fullSize).toBeGreaterThan(50_000)
    // Simulate a generation appending one assistant row to the existing tail.
    testDatabaseState.db.characters[0].chats[0].message.push({
      role: 'char',
      data: 'fresh reply',
      chatId: 'g-fresh',
    } as never)
    const previousLength = transcript.length

    const instrumented = withCloneInstrumentation(() => recordGeneratedReroll(previousLength, targetFor()))

    expect(
      getRerollBuffer()
        .at(-1)
        ?.map((m) => (m as unknown as Msg).chatId),
    ).toEqual(['g-fresh'])
    // The only deep clone is of the single appended row, far below the transcript.
    expect(instrumented.maxClonedSize).toBeLessThan(fullSize)
    expect(instrumented.maxClonedSize).toBeLessThan(5_000)
  })

  it('reroll regenerate preserves the target without deep-cloning the whole transcript', async () => {
    const transcript = [...bigTranscript(40), { role: 'char', data: 'assistant tail', chatId: 'g-tail' } as Msg]
    setupChat(transcript)
    const fullSize = JSON.stringify(transcript).length
    expect(fullSize).toBeGreaterThan(50_000)
    // One buffered candidate positioned at the end → reroll() submits a targeted
    // regenerate without cloning or mutating the authoritative transcript.
    seedRerollBufferFromAlternates(transcript, [{ role: 'char', data: 'assistant tail', chatId: 'g-tail' }])
    expect(getRerollId()).toBe(0)
    const sendChatMain = vi.fn(async () => true)

    const instrumented = withCloneInstrumentation(() => reroll({ sendChatMain, closeMenu: vi.fn() }))
    await instrumented.result

    // The assistant target stays in place until server-owned replacement.
    expect(sendChatMain).toHaveBeenCalledWith(false, 'g-tail')
    expect(tailUids().at(-1)).toBe('g-tail')
    expect(instrumented.maxClonedSize).toBeLessThan(fullSize)
    expect(instrumented.maxClonedSize).toBeLessThan(5_000)
  })
})
