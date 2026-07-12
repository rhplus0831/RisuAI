import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

// Prove the extracted swipe machine is safe under the Fastify read-only
// resource guard. `isFastifyServer` is forced on so the real
// `withTrustedResourceWrite` actually freezes/snapshots (the unit suite
// otherwise runs off-Fastify, where it is a pass-through).

vi.mock('../platform', async (importActual) => ({
  ...(await (importActual() as Promise<object>)),
  isFastifyServer: true,
}))

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

import { selectedCharID } from '../stores.svelte'
import { testDatabaseState } from '../__tests__/resourceDatabaseState'
import { setResourceWriteGuardEnabled } from '../server/resourceWriteGuard.svelte'
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
})

afterEach(() => {
  setResourceWriteGuardEnabled(false)
  selectedCharID.set(-1)
})

describe('reroll swipe under the read-only resource guard', () => {
  function seedAndFreeze(): void {
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
    // Freeze the projection AFTER seeding (mirrors the live order: hydrate → guard).
    setResourceWriteGuardEnabled(true)
  }

  it('unReroll swaps the active tail without throwing on the frozen projection', async () => {
    seedAndFreeze()
    await expect(unReroll()).resolves.toBeUndefined()
    expect(tailUid()).toBe('g2')
    expect(getRerollId()).toBe(1)
    expect(commandSpies.dispatchReplaceTailMessagesScoped).toHaveBeenCalledTimes(1)
    expect(commandSpies.dispatchReplaceMessagesScoped).not.toHaveBeenCalled()
  })

  it('reroll navigates forward on the frozen projection', async () => {
    seedAndFreeze()
    await unReroll() // → g2
    await expect(reroll({ sendChatMain: vi.fn(), closeMenu: vi.fn() })).resolves.toBeUndefined()
    expect(tailUid()).toBe('g3')
    expect(getRerollId()).toBe(2)
  })

  it('reroll regenerate truncates the frozen transcript in place without throwing', async () => {
    seedAndFreeze() // active = [u1, g3], positioned at the end of the buffer
    const sendChatMain = vi.fn(async () => {})
    // At the end of the buffer → drop the assistant tail (truncate in place) and
    // ask for a regenerate keyed by the dropped row's id. The in-place truncation
    // reuses the surviving rows, so it must not throw on the read-only projection.
    await expect(reroll({ sendChatMain, closeMenu: vi.fn() })).resolves.toBeUndefined()
    expect(tailUid()).toBe('u1')
    expect(sendChatMain).toHaveBeenCalledWith(false, 'g3')
    expect(commandSpies.dispatchTruncateMessagesScoped).toHaveBeenCalledTimes(1)
    expect(commandSpies.dispatchReplaceMessagesScoped).not.toHaveBeenCalled()
  })

  it('a direct projection write still throws (the guard is genuinely active)', () => {
    seedAndFreeze()
    expect(() => {
      ;(testDatabaseState.db.characters[0].chats[0].message[0] as Msg).data = 'mutated'
    }).toThrow()
  })
})
