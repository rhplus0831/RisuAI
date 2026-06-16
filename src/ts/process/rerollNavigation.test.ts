import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

// Unit-drive the extracted reroll swipe state machine. Keep `stores.svelte` real
// (DBState is the live state the machine reads/writes) and mock only the command
// layer plus the prefetch buffer.

const commandSpies = vi.hoisted(() => ({
  currentChatScopedSnapshot: vi.fn(() => ({ snapshot: true })),
  dispatchReplaceTailMessagesScoped: vi.fn(),
  dispatchReplaceMessagesScoped: vi.fn(),
  dispatchTruncateMessagesScoped: vi.fn(async () => null as unknown),
  dispatchUpdateMessageScoped: vi.fn(),
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
  clearPrererolls: vi.fn(),
}))
vi.mock('./prereroll', () => prerollSpies)

import { DBState, selectedCharID } from '../stores.svelte'
import { withCloneInstrumentation } from '../__tests__/cloneCostHarness'
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

function deferred<T>() {
  let resolve!: (value: T) => void
  const promise = new Promise<T>((resolver) => {
    resolve = resolver
  })
  return { promise, resolve }
}

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
  const character = (DBState as { db: { characters: { chats: { message: Msg[] }[] }[] } }).db.characters[0]
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

  it('rerolling past the newest candidate generates a new one (regenerate)', async () => {
    seedThreeCandidates() // active = g3 at id 2 (the end)
    const sendChatMain = vi.fn(async () => {})
    await reroll({ sendChatMain, closeMenu: vi.fn() })
    // At the end of the buffer → pops the assistant tail back to the user row and
    // asks for a regenerate keyed by the old assistant id.
    expect(sendChatMain).toHaveBeenCalledTimes(1)
    expect(sendChatMain).toHaveBeenCalledWith(false, 'g3')
    expect(tailUids()).toEqual(['u1'])
    expect(commandSpies.dispatchTruncateMessagesScoped).toHaveBeenCalledWith(
      'chat-1',
      'u1',
      expect.objectContaining({ snapshot: true }),
      { preserveRemovedAsAlternates: true },
    )
    expect(commandSpies.dispatchReplaceMessagesScoped).not.toHaveBeenCalled()
  })

  it('rerolling past the newest candidate waits for truncate persistence before regenerating', async () => {
    seedThreeCandidates()
    const truncate = deferred<{
      status: 'ok'
      revision: number
      event: { type: string; revision: number; resource: string }
    }>()
    commandSpies.dispatchTruncateMessagesScoped.mockReturnValueOnce(truncate.promise)
    const sendChatMain = vi.fn(async () => {})

    const rerollPromise = reroll({ sendChatMain, closeMenu: vi.fn() })

    expect(commandSpies.dispatchTruncateMessagesScoped).toHaveBeenCalledTimes(1)
    expect(sendChatMain).not.toHaveBeenCalled()

    truncate.resolve({
      status: 'ok',
      revision: 11,
      event: { type: 'message.truncated', revision: 11, resource: 'message' },
    })
    await rerollPromise

    expect(sendChatMain).toHaveBeenCalledTimes(1)
    expect(sendChatMain).toHaveBeenCalledWith(false, 'g3')
  })

  it('rerolling past the newest candidate skips generation when truncate persistence fails', async () => {
    seedThreeCandidates()
    commandSpies.dispatchTruncateMessagesScoped.mockResolvedValueOnce({ status: 'error', error: 'truncate failed' })
    const sendChatMain = vi.fn(async () => {})

    await reroll({ sendChatMain, closeMenu: vi.fn() })

    expect(commandSpies.dispatchTruncateMessagesScoped).toHaveBeenCalledTimes(1)
    expect(sendChatMain).not.toHaveBeenCalled()
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

  it('newReroll regenerates instead of moving to the next saved candidate', async () => {
    seedThreeCandidates()
    await selectRerollCandidate(0)
    const sendChatMain = vi.fn(async () => {})
    await newReroll({ sendChatMain, closeMenu: vi.fn() })
    expect(getRerollId()).toBe(0)
    expect(sendChatMain).toHaveBeenCalledTimes(1)
    expect(sendChatMain).toHaveBeenCalledWith(false, 'g1')
    expect(tailUids()).toEqual(['u1'])
    expect(commandSpies.dispatchTruncateMessagesScoped).toHaveBeenCalledWith(
      'chat-1',
      'u1',
      expect.objectContaining({ snapshot: true }),
      { preserveRemovedAsAlternates: true },
    )
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
    expect(prerollSpies.clearPrererolls).not.toHaveBeenCalled()
  })

  it('resetRerollOnCharChange wipes the buffer and preroll candidates when the character changed', () => {
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
    expect(prerollSpies.clearPrererolls).toHaveBeenCalledTimes(1)
  })

  it('resetRerollOnCharChange wipes the buffer and preroll candidates when the chat changed', () => {
    const active: Msg[] = [
      { role: 'user', data: 'hi', chatId: 'u1' },
      { role: 'char', data: 'c2', chatId: 'g2' },
    ]
    setupChat(active)
    DBState.db.characters[0].chats.push({
      id: 'chat-1b',
      message: [{ role: 'char', data: 'other', chatId: 'other-g1' }],
    } as never)
    seedRerollBufferFromAlternates(active, [
      { role: 'char', data: 'c2', chatId: 'g2' },
      { role: 'char', data: 'c1', chatId: 'g1' },
    ])
    expect(getRerollBuffer().length).toBe(2)

    DBState.db.characters[0].chatPage = 1
    resetRerollOnCharChange()

    expect(getRerollBuffer()).toEqual([])
    expect(getRerollId()).toBe(-1)
    expect(prerollSpies.clearPrererolls).toHaveBeenCalledTimes(1)
  })
})

describe('reroll clone cost (Phase 3 cheap wins)', () => {
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
    DBState.db.characters[0].chats[0].message.push({
      role: 'char',
      data: 'fresh reply',
      chatId: 'g-fresh',
    } as never)
    const previousLength = transcript.length

    const instrumented = withCloneInstrumentation(() => recordGeneratedReroll(previousLength))

    expect(
      getRerollBuffer()
        .at(-1)
        ?.map((m) => (m as unknown as Msg).chatId),
    ).toEqual(['g-fresh'])
    // The only deep clone is of the single appended row, far below the transcript.
    expect(instrumented.maxClonedSize).toBeLessThan(fullSize)
    expect(instrumented.maxClonedSize).toBeLessThan(5_000)
  })

  it('reroll regenerate truncates in place without deep-cloning the whole transcript', async () => {
    const transcript = [...bigTranscript(40), { role: 'char', data: 'assistant tail', chatId: 'g-tail' } as Msg]
    setupChat(transcript)
    const fullSize = JSON.stringify(transcript).length
    expect(fullSize).toBeGreaterThan(50_000)
    // One buffered candidate positioned at the end → reroll() takes the regenerate
    // (truncate + send) branch.
    seedRerollBufferFromAlternates(transcript, [{ role: 'char', data: 'assistant tail', chatId: 'g-tail' }])
    expect(getRerollId()).toBe(0)
    const sendChatMain = vi.fn(async () => {})

    const instrumented = withCloneInstrumentation(() => reroll({ sendChatMain, closeMenu: vi.fn() }))
    await instrumented.result

    // The assistant tail is dropped (regenerate keyed by its id) and only the
    // surviving rows remain — without serializing the whole transcript.
    expect(sendChatMain).toHaveBeenCalledWith(false, 'g-tail')
    expect(tailUids().at(-1)).toBe('lu')
    expect(instrumented.maxClonedSize).toBeLessThan(fullSize)
    expect(instrumented.maxClonedSize).toBeLessThan(5_000)
  })
})
