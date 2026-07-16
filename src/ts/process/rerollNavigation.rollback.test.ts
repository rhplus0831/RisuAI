import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

// Reroll/swipe rollback uses the real snapshot and dispatch to prove two things
// end to end:
//   - a swipe captures a chat-scoped rollback (only the active chat is cloned,
//     never the sibling characters), and
//   - a failed tail command restores only the active chat.

vi.mock('../platform', async (importActual) => ({
  ...(await (importActual() as Promise<object>)),
  isFastifyServer: true,
}))

vi.mock('../storage/fastifyStorage', () => ({
  getNodeServerProxyAuth: async () => 'reroll-rollback-token',
}))

const prerollSpies = vi.hoisted(() => ({
  Prereroll: vi.fn(() => null),
  PreUnreroll: vi.fn(() => null),
  addRerolls: vi.fn(),
  clearPrererolls: vi.fn(),
}))
vi.mock('./prereroll', () => prerollSpies)

import { clearCachedServerCommandRevision } from '../server/commands'
import { setResourceWriteGuardEnabled } from '../server/resourceWriteGuard.svelte'
import { selectedCharID } from '../stores.svelte'
import { withCloneInstrumentation } from '../__tests__/cloneCostHarness'
import { testDatabaseState } from '../__tests__/resourceDatabaseState'
import {
  getRerollCandidates,
  getRerollId,
  reroll,
  resetRerollNavigation,
  seedRerollBufferFromAlternates,
  unReroll,
} from './rerollNavigation.svelte'

type Msg = { role: string; data: string; chatId: string }

interface CapturedFetch {
  url: string
  method: string
  body: unknown
}

function bigSiblingMessages(count: number, body: string): Msg[] {
  return Array.from({ length: count }, (_unused, index) => ({
    role: index % 2 === 0 ? 'user' : 'char',
    data: `${body}-${index}`,
    chatId: `sib-${index}`,
  }))
}

/** Active char (index 0) holds a tiny chat; the sibling holds a large transcript
 * so a whole-characters clone is distinguishable from a single-chat clone. */
function seedDb(activeChatId: string | undefined): { siblingSize: number } {
  const body = 'x'.repeat(2000)
  const siblingMessages = bigSiblingMessages(40, body)
  const active: Msg[] = [
    { role: 'user', data: 'hi', chatId: 'u1' },
    { role: 'char', data: 'c2', chatId: 'g2' },
  ]
  testDatabaseState.db = {
    characters: [
      {
        chaId: 'active',
        name: 'Active',
        chatPage: 0,
        chats: [{ id: activeChatId, name: 'A', message: active }],
      },
      {
        chaId: 'big-sibling',
        name: 'Big',
        chatPage: 0,
        chats: [{ id: 'chat-big', name: 'B', message: siblingMessages }],
      },
    ],
  }
  selectedCharID.set(0)
  seedRerollBufferFromAlternates(active, [
    { role: 'char', data: 'c2', chatId: 'g2' },
    { role: 'char', data: 'c1', chatId: 'g1' },
  ])
  return { siblingSize: JSON.stringify(siblingMessages).length }
}

function activeTailUid(): string {
  const character = testDatabaseState.db.characters[0] as unknown as { chats: { message: Msg[] }[] }
  const message = character.chats[0].message
  return message[message.length - 1].chatId
}

function siblingMessageCount(): number {
  return testDatabaseState.db.characters[1].chats[0].message.length
}

async function waitForCallCount(calls: CapturedFetch[], expected: number): Promise<void> {
  for (let attempt = 0; attempt < 20 && calls.length < expected; attempt += 1) {
    await new Promise((resolve) => setTimeout(resolve, 0))
  }
  expect(calls).toHaveLength(expected)
}

async function waitFor(predicate: () => boolean): Promise<void> {
  for (let attempt = 0; attempt < 20 && !predicate(); attempt += 1) {
    await new Promise((resolve) => setTimeout(resolve, 0))
  }
}

beforeEach(() => {
  resetRerollNavigation()
  clearCachedServerCommandRevision()
  setResourceWriteGuardEnabled(false)
  vi.clearAllMocks()
})

afterEach(() => {
  setResourceWriteGuardEnabled(false)
  vi.unstubAllGlobals()
  selectedCharID.set(-1)
})

describe('reroll/swipe chat-scoped rollback (Phase 2)', () => {
  it('a swipe clones only the active chat, never the sibling transcript', () => {
    // No active chat id → `applyTailSlice` skips the network dispatch, isolating the
    // synchronous rollback-baseline capture (the `currentChatScopedSnapshot`).
    const { siblingSize } = seedDb(undefined)
    expect(getRerollId()).toBe(1)

    const instrumented = withCloneInstrumentation(() => {
      void unReroll()
    })

    // The rollback baseline + candidate/message clones stay bounded to the active
    // chat; the large sibling transcript is never serialized.
    expect(instrumented.maxClonedSize).toBeLessThan(siblingSize)
    expect(siblingSize).toBeGreaterThan(50_000)
  })

  it('a failed swipe tail replace restores only the active chat and sends only the changed tail', async () => {
    const calls: CapturedFetch[] = []
    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: RequestInfo | URL, init: RequestInit = {}) => {
        const url = String(input)
        calls.push({
          url,
          method: init.method ?? 'GET',
          body: typeof init.body === 'string' ? JSON.parse(init.body) : null,
        })
        if (url === '/api/v1/bootstrap') {
          return new Response(JSON.stringify({ revision: 10 }), { status: 200 })
        }
        if (url === '/api/v1/commands/chats/chat-active/messages/tail') {
          return new Response(JSON.stringify({ error: 'nope' }), { status: 500 })
        }
        return new Response(JSON.stringify({ error: `unexpected ${url}` }), { status: 404 })
      }) as unknown as typeof fetch,
    )
    seedDb('chat-active')

    // The captured baseline tail is g2; the optimistic swipe overwrites it with g1.
    await unReroll()
    expect(activeTailUid()).toBe('g1')
    await waitForCallCount(calls, 2)
    await waitFor(() => activeTailUid() === 'g2')

    const commandCall = calls.find((call) => call.url === '/api/v1/commands/chats/chat-active/messages/tail')
    expect(commandCall?.method).toBe('POST')
    expect(commandCall?.body).toEqual({
      baseRevision: 10,
      afterMessageId: 'u1',
      messages: [{ role: 'char', data: 'c1', chatId: 'g1' }],
    })

    // The failed tail replace rolls back to the captured active chat only.
    expect(activeTailUid()).toBe('g2')
    // The large sibling transcript was never part of the rollback.
    expect(siblingMessageCount()).toBe(40)
  })

  it('regenerate truncate sends a truncate command instead of the surviving transcript', async () => {
    const calls: CapturedFetch[] = []
    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: RequestInfo | URL, init: RequestInit = {}) => {
        const url = String(input)
        calls.push({
          url,
          method: init.method ?? 'GET',
          body: typeof init.body === 'string' ? JSON.parse(init.body) : null,
        })
        if (url === '/api/v1/bootstrap') {
          return new Response(JSON.stringify({ revision: 10 }), { status: 200 })
        }
        if (url === '/api/v1/commands/chats/chat-active/messages/truncate') {
          return new Response(
            JSON.stringify({
              revision: 11,
              event: { type: 'message.truncated', revision: 11, resource: 'message', parentId: 'chat-active' },
              chatId: 'chat-active',
              afterMessageId: 'u1',
              removedCount: 1,
            }),
            { status: 200 },
          )
        }
        return new Response(JSON.stringify({ error: `unexpected ${url}` }), { status: 404 })
      }) as unknown as typeof fetch,
    )
    seedDb('chat-active')

    const sendChatMain = vi.fn(async () => true)
    await reroll({ sendChatMain, closeMenu: vi.fn() })
    await waitForCallCount(calls, 2)

    const commandCall = calls.find((call) => call.url === '/api/v1/commands/chats/chat-active/messages/truncate')
    expect(commandCall?.method).toBe('POST')
    expect(commandCall?.body).toEqual({
      baseRevision: 10,
      afterMessageId: 'u1',
      preserveRemovedAsAlternates: true,
    })
    expect(sendChatMain).toHaveBeenCalledWith(false, 'g2')
  })

  it('restores and persists the displaced tail when generation fails after truncate', async () => {
    const calls: CapturedFetch[] = []
    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: RequestInfo | URL, init: RequestInit = {}) => {
        const url = String(input)
        calls.push({
          url,
          method: init.method ?? 'GET',
          body: typeof init.body === 'string' ? JSON.parse(init.body) : null,
        })
        if (url === '/api/v1/bootstrap') {
          return new Response(JSON.stringify({ revision: 10 }), { status: 200 })
        }
        if (url === '/api/v1/commands/chats/chat-active/messages/truncate') {
          return new Response(
            JSON.stringify({
              revision: 11,
              event: { type: 'message.truncated', revision: 11, resource: 'message', parentId: 'chat-active' },
              chatId: 'chat-active',
              afterMessageId: 'u1',
              removedCount: 1,
            }),
            { status: 200 },
          )
        }
        if (url === '/api/v1/commands/chats/chat-active/messages/tail') {
          return new Response(
            JSON.stringify({
              revision: 12,
              event: { type: 'messages.replaced', revision: 12, resource: 'message', parentId: 'chat-active' },
              chatId: 'chat-active',
              afterMessageId: 'u1',
              replacedCount: 0,
            }),
            { status: 200 },
          )
        }
        return new Response(JSON.stringify({ error: `unexpected ${url}` }), { status: 404 })
      }) as unknown as typeof fetch,
    )
    seedDb('chat-active')

    await reroll({ sendChatMain: vi.fn(async () => false), closeMenu: vi.fn() })
    expect(activeTailUid()).toBe('g2')
    await waitForCallCount(calls, 3)

    const recoveryCall = calls.find((call) => call.url === '/api/v1/commands/chats/chat-active/messages/tail')
    expect(recoveryCall).toEqual({
      url: '/api/v1/commands/chats/chat-active/messages/tail',
      method: 'POST',
      body: {
        baseRevision: 11,
        afterMessageId: 'u1',
        messages: [{ role: 'char', data: 'c2', chatId: 'g2' }],
      },
    })

    // Active-chat hydration calls this same seeding hook with the persisted
    // primary plus alternates. The recovered candidate remains active after a reload.
    resetRerollNavigation()
    const hydratedMessages = testDatabaseState.db.characters[0].chats[0].message as unknown as Msg[]
    seedRerollBufferFromAlternates(hydratedMessages, [{ role: 'char', data: 'c2', chatId: 'g2' }])
    expect(getRerollId()).toBe(0)
    expect(getRerollCandidates()).toEqual([
      expect.objectContaining({
        index: 0,
        active: true,
        messages: [expect.objectContaining({ chatId: 'g2', data: 'c2' })],
      }),
    ])
  })
})
