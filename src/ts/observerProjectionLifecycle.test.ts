import { IDBFactory } from 'fake-indexeddb'
import { get } from 'svelte/store'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('./process/modules', () => ({
  getModuleAssets: vi.fn(() => []),
  getModuleLorebooks: vi.fn(() => []),
  getModules: vi.fn(() => []),
  moduleUpdate: vi.fn(),
}))
vi.mock('./model/modellist', () => ({ getModelInfo: vi.fn(() => ({ type: 'chat' })) }))

import { discardObserverProjectionState } from './observerProjectionLifecycle'
import {
  peekObserverRouteIntent,
  recordObserverRouteIntent,
  resetObserverRouteIntentForTests,
} from './observerRouteIntent'
import { observerShellLifecycleStore, resetObserverShellLifecycleForTests } from './observerShellLifecycle.svelte'
import { characterShellHydrationState } from './server/characterShellHydration.svelte'
import {
  acknowledgeCreatedChatTranscriptLocalEffect,
  isChatMessageTranscriptHydrated,
} from './server/chatMessageHydration.svelte'
import {
  clearAppliedServerResourceRevision,
  clearCachedServerCommandRevision,
  peekAppliedServerResourceRevision,
  peekCachedServerCommandRevision,
  setAppliedServerResourceRevision,
  setCachedServerCommandRevision,
} from './server/commands'
import {
  clearResourceCache,
  persistResourceCache,
  readResourceCacheSnapshots,
  sha256JsonValue,
} from './server/resourceCache'
import { isCharacterLorebookHydrated, markCharacterLorebookHydrated } from './server/lorebookBridge.svelte'
import { isPromptTemplateHydrated, markPromptTemplateProjectionApplied } from './server/promptTemplateHydration'
import { getResourceDatabase, replaceResourceDatabase, resetServerResourceState } from './server/resourceState.svelte'
import { setResourceWriteGuardEnabled, type Database } from './storage/database.svelte'
import { selectedCharID } from './stores.svelte'

function seedObserverProjection(): void {
  replaceResourceDatabase({
    characterOrder: ['char-a'],
    characters: [
      {
        chaId: 'char-a',
        name: 'Ada',
        type: 'character',
        chats: [{ id: 'chat-a', name: 'Chat', message: [] }],
        chatPage: 0,
      },
    ],
    currentChar: 0,
    username: 'Observer',
  } as unknown as Database)
  selectedCharID.set(0)
  recordObserverRouteIntent({ kind: 'character', path: '/character/char-a', chaId: 'char-a' })
  characterShellHydrationState.rows = {
    'char-a': { status: 'ready', error: null },
  }
}

describe('observer projection lifecycle', () => {
  beforeEach(() => {
    vi.stubGlobal('indexedDB', new IDBFactory())
    setResourceWriteGuardEnabled(false)
    resetServerResourceState()
    resetObserverRouteIntentForTests()
    resetObserverShellLifecycleForTests()
    clearCachedServerCommandRevision()
    clearAppliedServerResourceRevision()
    selectedCharID.set(-1)
  })

  afterEach(async () => {
    await clearResourceCache()
    resetServerResourceState()
    resetObserverRouteIntentForTests()
    resetObserverShellLifecycleForTests()
    clearCachedServerCommandRevision()
    clearAppliedServerResourceRevision()
    selectedCharID.set(-1)
    vi.unstubAllGlobals()
  })

  it.each(['database-replacement', 'lineage-change'] as const)(
    'keeps the authenticated shell visible but clears observer-era intent for %s',
    async (reason) => {
      seedObserverProjection()
      expect(acknowledgeCreatedChatTranscriptLocalEffect('chat-a')).toBe(true)
      markCharacterLorebookHydrated('char-a')
      markPromptTemplateProjectionApplied('preset-a')
      const value = { id: `cached-${reason}` }
      const hash = await sha256JsonValue(value)
      await persistResourceCache([{ key: 'collection:modules', hashes: [hash], values: [value] }])

      await discardObserverProjectionState(reason)

      expect(getResourceDatabase().characters?.[0]?.chaId).toBe('char-a')
      expect(get(selectedCharID)).toBe(0)
      expect(peekObserverRouteIntent()).toBeNull()
      expect(characterShellHydrationState.rows).toEqual({})
      expect(isChatMessageTranscriptHydrated('chat-a')).toBe(false)
      expect(isCharacterLorebookHydrated('char-a')).toBe(false)
      expect(isPromptTemplateHydrated('preset-a')).toBe(false)
      expect((await readResourceCacheSnapshots(['collection:modules']))?.get('collection:modules')?.hashes).toEqual([])
      expect(get(observerShellLifecycleStore)).toMatchObject({ mode: 'waiting', lastDiscardReason: reason })
    },
  )

  it('clears authenticated resources, revisions, cache, and local intent on auth loss', async () => {
    seedObserverProjection()
    setCachedServerCommandRevision(17)
    setAppliedServerResourceRevision(17)
    const value = { id: 'cached-observer-value' }
    const hash = await sha256JsonValue(value)
    await persistResourceCache([{ key: 'collection:modules', hashes: [hash], values: [value] }])

    await discardObserverProjectionState('auth-loss')

    expect(getResourceDatabase().characters).toEqual([])
    expect(get(selectedCharID)).toBe(-1)
    expect(peekObserverRouteIntent()).toBeNull()
    expect(characterShellHydrationState.rows).toEqual({})
    expect(peekCachedServerCommandRevision()).toBeNull()
    expect(peekAppliedServerResourceRevision()).toBeNull()
    expect((await readResourceCacheSnapshots(['collection:modules']))?.get('collection:modules')?.hashes).toEqual([])
    expect(get(observerShellLifecycleStore)).toEqual({ mode: 'auth-lost', lastDiscardReason: 'auth-loss' })
  })
})
