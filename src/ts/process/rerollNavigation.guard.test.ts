import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

// Phase 6c: prove the extracted swipe machine is safe under the Fastify read-only
// projection guard — the original component mutated `DBState` directly, which
// throws once the guard wraps it. `isFastifyServer` is forced on so the real
// `withTrustedServerProjectionWrite` actually freezes/snapshots (the unit suite
// otherwise runs off-Fastify, where it is a pass-through).

vi.mock('../platform', async (orig) => ({
  ...(await (orig() as Promise<object>)),
  isFastifyServer: true,
}))

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
import { setServerProjectionWriteGuardEnabled } from '../server/projectionWriteGuard.svelte'
import {
  getRerollId,
  reroll,
  resetRerollNavigation,
  seedRerollBufferFromAlternates,
  unReroll,
} from './rerollNavigation.svelte'

type Msg = { role: string; data: string; chatId: string }

function tailUid(): string {
  return (
    DBState.db.characters[0].chats[0].message.at(-1) as unknown as Msg
  ).chatId
}

beforeEach(() => {
  resetRerollNavigation()
  vi.clearAllMocks()
  ;(DBState as { db: unknown }).db = {
    characters: [
      { chaId: 'c1', chatPage: 0, chats: [{ id: 'chat-1', message: [] as Msg[] }] },
    ],
  }
  selectedCharID.set(0)
})

afterEach(() => {
  setServerProjectionWriteGuardEnabled(false)
  selectedCharID.set(-1)
})

describe('reroll swipe under the read-only projection guard', () => {
  function seedAndFreeze(): void {
    const active: Msg[] = [
      { role: 'user', data: 'hi', chatId: 'u1' },
      { role: 'char', data: 'c3', chatId: 'g3' },
    ]
    ;(DBState as { db: { characters: { chats: { message: Msg[] }[] }[] } }).db.characters[0].chats[0].message =
      active
    seedRerollBufferFromAlternates(active, [
      { role: 'char', data: 'c3', chatId: 'g3' },
      { role: 'char', data: 'c2', chatId: 'g2' },
      { role: 'char', data: 'c1', chatId: 'g1' },
    ])
    // Freeze the projection AFTER seeding (mirrors the live order: hydrate → guard).
    setServerProjectionWriteGuardEnabled(true)
  }

  it('unReroll swaps the active tail without throwing on the frozen projection', async () => {
    seedAndFreeze()
    await expect(unReroll()).resolves.toBeUndefined()
    expect(tailUid()).toBe('g2')
    expect(getRerollId()).toBe(1)
    expect(commandSpies.dispatchReplaceMessages).toHaveBeenCalledTimes(1)
  })

  it('reroll navigates forward on the frozen projection', async () => {
    seedAndFreeze()
    await unReroll() // → g2
    await expect(reroll({ sendChatMain: vi.fn(), closeMenu: vi.fn() })).resolves.toBeUndefined()
    expect(tailUid()).toBe('g3')
    expect(getRerollId()).toBe(2)
  })

  it('a direct projection write still throws (the guard is genuinely active)', () => {
    seedAndFreeze()
    expect(() => {
      ;(DBState.db.characters[0].chats[0].message[0] as Msg).data = 'mutated'
    }).toThrow()
  })
})
