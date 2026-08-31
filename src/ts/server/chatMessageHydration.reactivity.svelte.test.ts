import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { flushSync } from 'svelte'
import { testDatabaseState } from '../__tests__/resourceDatabaseState'

// Real resource write guard (so we exercise the real read-only proxy and
// resource-backed reassignment that drives re-render), but force reads on.
vi.mock('./resourceReads', () => ({
  canUseServerResourceReads: () => true,
}))

import { selectedCharID } from '../stores.svelte'
import { hydrateServerChatMessages, withTrustedResourceWrite } from '../storage/database.svelte'
import { setResourceWriteGuardEnabled } from './resourceWriteGuard.svelte'
import {
  isCharacterLorebookHydrationPending,
  isChatMessageHydrationPending,
  resetChatHydration,
  setActiveChatReadinessRefreshHook,
  startChatMessageHydration,
  stopChatMessageHydration,
} from './chatMessageHydration.svelte'
import { markCharacterLorebookHydrated, resetLorebookHydration } from './lorebookBridge.svelte'
import {
  clearGenerationPersistence,
  getGenerationFinalizationPersistencesForChat,
  resetGenerationFinalizationPersistencesForTests,
  setGenerationFinalizationPersistences,
} from '../process/generationPersistenceState'

function seedStubChat() {
  ;(testDatabaseState as { db: unknown }).db = {
    currentChar: 0,
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

function seedTwoResidentChats() {
  ;(testDatabaseState as { db: unknown }).db = {
    currentChar: 0,
    characters: [
      {
        chaId: 'char-1',
        chatPage: 0,
        chats: [
          { id: 'chat-1', message: [{ role: 'char', data: 'foreground', chatId: 'foreground-message' }] },
          { id: 'chat-2', message: [{ role: 'char', data: 'background', chatId: 'background-message' }] },
        ],
      },
    ],
  }
  selectedCharID.set(0)
  setResourceWriteGuardEnabled(true)
}

beforeEach(() => {
  stopChatMessageHydration()
  setActiveChatReadinessRefreshHook(null)
  resetChatHydration()
  resetLorebookHydration()
  resetGenerationFinalizationPersistencesForTests()
  seedStubChat()
})

afterEach(() => {
  stopChatMessageHydration()
  setActiveChatReadinessRefreshHook(null)
  resetGenerationFinalizationPersistencesForTests()
  setResourceWriteGuardEnabled(false)
  selectedCharID.set(-1)
  ;(testDatabaseState as { db: unknown }).db = {}
})

describe('active-chat loading flag reactivity (real resource guard)', () => {
  it('notifies readiness when chatPage changes within the selected character', () => {
    setResourceWriteGuardEnabled(false)
    seedTwoResidentChats()
    const refreshReadiness = vi.fn()
    setActiveChatReadinessRefreshHook(refreshReadiness)
    startChatMessageHydration()
    flushSync()
    refreshReadiness.mockClear()

    withTrustedResourceWrite(() => {
      testDatabaseState.db.characters[0].chatPage = 1
    })
    flushSync()

    expect(refreshReadiness).toHaveBeenCalledOnce()
  })

  it('notifies readiness when the active chat prompt-template owner changes', () => {
    setResourceWriteGuardEnabled(false)
    seedTwoResidentChats()
    const refreshReadiness = vi.fn()
    setActiveChatReadinessRefreshHook(refreshReadiness)
    startChatMessageHydration()
    flushSync()
    refreshReadiness.mockClear()

    withTrustedResourceWrite(() => {
      testDatabaseState.db.characters[0].chats[0].generationSettings = { promptPresetId: 'prompt-b' }
    })
    flushSync()

    expect(refreshReadiness).toHaveBeenCalledOnce()
  })

  it('does not invalidate one chat finalization selector when another chat changes', () => {
    const foregroundSeen: number[] = []
    const backgroundSeen: number[] = []
    const stop = $effect.root(() => {
      $effect(() => {
        foregroundSeen.push(getGenerationFinalizationPersistencesForChat('chat-1').length)
      })
      $effect(() => {
        backgroundSeen.push(getGenerationFinalizationPersistencesForChat('chat-2').length)
      })
    })
    flushSync()

    setGenerationFinalizationPersistences([
      { chatId: 'chat-1', messageId: 'message-1', generationId: 'generation-1', state: 'queued' },
      { chatId: 'chat-2', messageId: 'message-2', generationId: 'generation-2', state: 'queued' },
    ])
    flushSync()
    const foregroundRunCount = foregroundSeen.length

    clearGenerationPersistence('chat-2', 'generation-2')
    flushSync()

    expect(foregroundSeen).toEqual([0, 1])
    expect(foregroundSeen).toHaveLength(foregroundRunCount)
    expect(backgroundSeen).toEqual([0, 1, 0])
    stop()
  })

  it('does not invalidate a foreground chat dependency when a background transcript hydrates', () => {
    setResourceWriteGuardEnabled(false)
    seedTwoResidentChats()
    const foregroundSeen: string[] = []
    const backgroundSeen: string[] = []
    const stop = $effect.root(() => {
      $effect(() => {
        foregroundSeen.push(testDatabaseState.db.characters[0].chats[0].message[0].data)
      })
      $effect(() => {
        backgroundSeen.push(testDatabaseState.db.characters[0].chats[1].message[0].data)
      })
    })
    flushSync()

    expect(
      hydrateServerChatMessages('chat-2', [
        { role: 'char', data: 'background complete', chatId: 'background-message' },
      ]),
    ).toBe(true)
    flushSync()

    expect(foregroundSeen).toEqual(['foreground'])
    expect(backgroundSeen).toEqual(['background', 'background complete'])
    stop()
  })

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
      currentChar: 0,
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
