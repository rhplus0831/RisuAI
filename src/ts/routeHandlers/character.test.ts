// @vitest-environment happy-dom

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { get } from 'svelte/store'
import { selectedCharID } from '../stores.svelte'
import { charactersResourceState, resetServerResourceState } from '../server/resourceState.svelte'
import { applyCharacterRoute } from './character'

const character = (chaId: string, chatId = 'chat-a') =>
  ({ chaId, chatPage: 0, chats: [{ id: chatId, message: [] }] }) as any

beforeEach(() => {
  resetServerResourceState()
  charactersResourceState.characters = [character('owner-a')]
  charactersResourceState.status = 'ready'
  selectedCharID.set(0)
})

afterEach(() => {
  selectedCharID.set(-1)
  resetServerResourceState()
})

describe('character route owner lookup', () => {
  it('keeps a valid route on the resource owner row', async () => {
    const replacePath = vi.fn()
    await applyCharacterRoute(
      { kind: 'character', path: '/character/owner-a/chat-a', chaId: 'owner-a', chatId: 'chat-a' },
      { isFresh: () => true, replacePath },
    )

    expect(replacePath).not.toHaveBeenCalled()
    expect(get(selectedCharID)).toBe(0)
  })

  it('redirects a missing owner without consulting a stale route detail', async () => {
    const replacePath = vi.fn()
    await applyCharacterRoute(
      { kind: 'character', path: '/character/missing/chat-a', chaId: 'missing', chatId: 'chat-a' },
      { isFresh: () => true, replacePath },
    )

    expect(replacePath).toHaveBeenCalledWith('/')
    expect(get(selectedCharID)).toBe(-1)
  })

  it('fences a stale route before changing selection', async () => {
    const replacePath = vi.fn()
    await applyCharacterRoute(
      { kind: 'character', path: '/character/owner-a/chat-a', chaId: 'owner-a', chatId: 'chat-a' },
      { isFresh: () => false, replacePath },
    )

    expect(replacePath).not.toHaveBeenCalled()
  })
})
