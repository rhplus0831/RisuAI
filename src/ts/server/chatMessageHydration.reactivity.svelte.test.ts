import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { flushSync } from 'svelte'
import { testDatabaseState } from '../__tests__/resourceDatabaseState'

// Real resource write guard (so we exercise the real read-only proxy and
// resource-backed reassignment that drives re-render), but force reads on.
vi.mock('./resourceReads', () => ({
  canUseServerResourceReads: () => true,
}))

import { selectedCharID } from '../stores.svelte'
import { hydrateServerChatMessages } from '../storage/database.svelte'
import { setResourceWriteGuardEnabled } from './resourceWriteGuard.svelte'
import {
  isCharacterLorebookHydrationPending,
  isChatMessageHydrationPending,
  resetChatHydration,
} from './chatMessageHydration.svelte'
import { markCharacterLorebookHydrated, resetLorebookHydration } from './lorebookBridge.svelte'

function seedStubChat() {
  ;(testDatabaseState as { db: unknown }).db = {
    characters: [
      {
        chaId: 'char-1',
        chatPage: 0,
        chats: [{ id: 'chat-1', message: [] }],
      },
    ],
  }
  selectedCharID.set(0)
  // Mirror bootstrap: wrap testDatabaseState.db in the read-only server projection.
  setResourceWriteGuardEnabled(true)
}

beforeEach(() => {
  resetChatHydration()
  resetLorebookHydration()
  seedStubChat()
})

afterEach(() => {
  setResourceWriteGuardEnabled(false)
  selectedCharID.set(-1)
  ;(testDatabaseState as { db: unknown }).db = {}
})

describe('active-chat loading flag reactivity (real resource guard)', () => {
  it('flips from loading to loaded when hydrated messages are applied', () => {
    const seen: boolean[] = []
    const stop = $effect.root(() => {
      // Mirror DefaultChatScreen.svelte's `activeChatMessagesLoading` derived.
      const character = $derived(testDatabaseState.db.characters?.[0])
      const chat = $derived(character?.chats?.[character?.chatPage ?? 0])
      const loading = $derived(isChatMessageHydrationPending(chat?.id, chat?.message?.length ?? 0))
      $effect(() => {
        seen.push(loading)
      })
    })

    flushSync()
    // First paint: empty stub, nothing fetched yet -> loading.
    expect(seen.at(-1)).toBe(true)

    // The hydration apply (trusted projection write) lands the messages.
    const applied = hydrateServerChatMessages('chat-1', [
      { role: 'user', data: 'hi', chatId: 'm1' },
      { role: 'char', data: 'yo', chatId: 'm2' },
    ])
    expect(applied).toBe(true)

    flushSync()
    // After messages land, the overlay must clear so the chat renders.
    expect(seen.at(-1)).toBe(false)

    stop()
  })

  it('notifies the lorebook loading predicate when a full refresh clears both hydration registries', () => {
    setResourceWriteGuardEnabled(false)
    ;(testDatabaseState as { db: unknown }).db = {
      enableLorebookStubs: true,
      characters: [
        {
          chaId: 'char-1',
          chatPage: 0,
          chats: [{ id: 'chat-1', message: [] }],
          globalLore: [],
        },
      ],
    }
    selectedCharID.set(0)
    markCharacterLorebookHydrated('char-1')
    setResourceWriteGuardEnabled(true)

    const seen: boolean[] = []
    const stop = $effect.root(() => {
      $effect(() => {
        seen.push(isCharacterLorebookHydrationPending('char-1'))
      })
    })
    flushSync()
    expect(seen.at(-1)).toBe(false)

    // This is the production reset order in resourceRefresh/bootstrap.
    resetChatHydration()
    resetLorebookHydration()
    flushSync()

    expect(seen.at(-1)).toBe(true)
    stop()
  })
})
