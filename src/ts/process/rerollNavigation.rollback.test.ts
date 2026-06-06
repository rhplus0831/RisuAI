import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

// Phase 2 reroll/swipe rollback narrowing proof. Unlike the unit/guard suites
// (which mock `../chatCommands`), this suite keeps the REAL snapshot + dispatch so
// it can prove two things end to end:
//   - a swipe captures a chat-scoped rollback (only the active chat is cloned,
//     never the sibling characters), and
//   - a failed `dispatchReplaceMessagesScoped` restores only the active chat.

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
import { setServerProjectionWriteGuardEnabled } from '../server/projectionWriteGuard.svelte'
import { DBState, selectedCharID } from '../stores.svelte'
import { withCloneInstrumentation } from '../__tests__/cloneCostHarness'
import {
  getRerollId,
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
  ;(DBState as { db: unknown }).db = {
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
  const character = (DBState as { db: { characters: { chats: { message: Msg[] }[] }[] } }).db
    .characters[0]
  const message = character.chats[0].message
  return message[message.length - 1].chatId
}

function siblingMessageCount(): number {
  return (DBState as { db: { characters: { chats: { message: Msg[] }[] }[] } }).db.characters[1]
    .chats[0].message.length
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
  setServerProjectionWriteGuardEnabled(false)
  vi.clearAllMocks()
})

afterEach(() => {
  setServerProjectionWriteGuardEnabled(false)
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

  it('a failed swipe replace restores only the active chat (sibling untouched)', async () => {
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
        if (url === '/api/v1/commands/chats/chat-active/messages') {
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

    // The failed replace rolls back to the captured active chat only.
    expect(activeTailUid()).toBe('g2')
    // The large sibling transcript was never part of the rollback.
    expect(siblingMessageCount()).toBe(40)
  })
})
