import { beforeEach, describe, expect, it, vi } from 'vitest'
import { get } from 'svelte/store'

type ServerBootstrapMockResponse =
  | {
      status: 'ok'
      projection: {
        revision: number
        database: Record<string, unknown> | null
      }
    }
  | { status: 'error'; error: string }
  | { status: 'unavailable' }

const platformState = vi.hoisted(() => ({ isFastifyServer: true }))
const serverBootstrapState = vi.hoisted(() => ({
  fetch: vi.fn(),
  fetchReadOnly: vi.fn(),
  response: {
    status: 'ok' as const,
    projection: {
      revision: 5,
      database: {
        characters: [],
        modules: [],
        personas: [],
        language: 'en',
      },
    },
  } as ServerBootstrapMockResponse,
}))
const serverEventsState = vi.hoisted(() => ({
  subscriptions: [] as Array<{
    onCommandEvent: (event: {
      type: string
      revision: number
      resource: string
      id?: string
      parentId?: string
    }) => void
    onMemoryEvent?: (event: {
      type: 'memory.job'
      sideEffect?: { kind: string; payload: unknown }
    }) => void
    onError?: (error: string) => void
  }>,
  unsubscribe: vi.fn(),
  subscribe: vi.fn(
    async (input: {
      onCommandEvent: (event: {
        type: string
        revision: number
        resource: string
        id?: string
        parentId?: string
      }) => void
      onMemoryEvent?: (event: {
        type: 'memory.job'
        sideEffect?: { kind: string; payload: unknown }
      }) => void
      onError?: (error: string) => void
    }) => {
      serverEventsState.subscriptions.push(input)
      return { status: 'ok' as const, unsubscribe: serverEventsState.unsubscribe }
    },
  ),
}))
const serverProjectionState = vi.hoisted(() => ({
  fetchResource: vi.fn(),
}))
const forageSpies = vi.hoisted(() => ({
  Init: vi.fn(async () => undefined),
  getItem: vi.fn(async () => undefined),
  setItem: vi.fn(async () => undefined),
}))
const persistenceSpies = vi.hoisted(() => ({
  saveDb: vi.fn(async () => undefined),
  makeColdData: vi.fn(async () => undefined),
}))

vi.mock('./platform', async (importActual) => {
  const actual = await importActual<typeof import('./platform')>()
  return {
    ...actual,
    get isFastifyServer() {
      return platformState.isFastifyServer
    },
  }
})

vi.mock('./server/bootstrap', () => ({
  fetchServerBootstrapProjection: serverBootstrapState.fetch,
  fetchServerBootstrapProjectionReadOnly: serverBootstrapState.fetchReadOnly,
}))

vi.mock('./server/events', () => ({
  subscribeServerCommandEvents: serverEventsState.subscribe,
}))

vi.mock('./server/projection', () => ({
  fetchServerProjectionResource: serverProjectionState.fetchResource,
  canUseServerProjection: () => platformState.isFastifyServer,
  fetchServerChatMessages: vi.fn(),
}))

// Phase 4.3 chat-message hydration is exercised in its own tests; stub it here so
// the surgical-sync assertions (fetch counts) are unaffected by hydration calls.
const hydrationSpies = vi.hoisted(() => ({
  startChatMessageHydration: vi.fn(),
  hydrateActiveChat: vi.fn(async () => undefined),
  hydrateActiveCharacterLorebook: vi.fn(async () => undefined),
  resetChatHydration: vi.fn(),
  ensureAllChatsHydrated: vi.fn(async () => undefined),
  ensureAllCharacterLorebooksHydrated: vi.fn(async () => undefined),
  hydrateChatMessages: vi.fn(async () => undefined),
}))
vi.mock('./server/chatMessageHydration.svelte', () => hydrationSpies)

vi.mock('./globalApi.svelte', () => ({
  forageStorage: forageSpies,
  saveDb: persistenceSpies.saveDb,
  getDbBackups: vi.fn(async () => []),
  getBasename: vi.fn((value: string) => value.split('/').pop() ?? value),
  checkCharOrder: vi.fn(),
  downloadFile: vi.fn(),
  saveAsset: vi.fn(),
}))

vi.mock('./storage/risuSave', () => ({
  decodeRisuSave: vi.fn(async () => ({ characters: [], language: 'en' })),
  encodeRisuSaveLegacy: vi.fn(() => new Uint8Array([1, 2, 3])),
}))

vi.mock('./update', () => ({ checkRisuUpdate: vi.fn(async () => undefined) }))
vi.mock('./plugins/plugins.svelte', () => ({ loadPlugins: vi.fn(async () => undefined) }))
vi.mock('./alert', () => ({
  alertError: vi.fn(),
  alertMd: vi.fn(),
  alertTOS: vi.fn(async () => true),
  waitAlert: vi.fn(async () => undefined),
  alertConfirm: vi.fn(async () => false),
  alertInput: vi.fn(async () => ''),
  alertNormal: vi.fn(),
}))
vi.mock('./characterCards', () => ({ characterURLImport: vi.fn() }))
vi.mock('./gui/animation', () => ({ updateAnimationSpeed: vi.fn() }))
vi.mock('./gui/colorscheme', () => ({
  updateColorScheme: vi.fn(),
  updateTextThemeAndCSS: vi.fn(),
  defaultColorScheme: {},
}))
vi.mock('./gui/guisize', () => ({ updateGuisize: vi.fn() }))
vi.mock('./observer.svelte', () => ({ startObserveDom: vi.fn() }))
vi.mock('./hotkey', () => ({ initMobileGesture: vi.fn() }))
vi.mock('./process/modules', () => ({
  getModuleLorebooks: vi.fn(() => []),
  getModules: vi.fn(() => []),
  moduleUpdate: vi.fn(),
}))
vi.mock('./process/coldstorage.svelte', () => ({ makeColdData: persistenceSpies.makeColdData }))
vi.mock('./characters', () => ({ updateLorebooks: vi.fn((entries) => entries) }))
vi.mock('./model/modellist', async (importActual) => {
  const actual = await importActual<typeof import('./model/modellist')>()
  return {
    ...actual,
    getModelInfo: vi.fn(() => ({ type: 'chat' })),
    registerModelDynamic: vi.fn(),
  }
})

import { loadData, loadWebInitialDatabase } from './bootstrap'
import {
  isServerProjectionWriteGuardEnabled,
  setServerProjectionWriteGuardEnabled,
  withTrustedServerProjectionWrite,
} from './storage/database.svelte'
import {
  clearCachedServerCommandRevision,
  peekCachedServerCommandRevision,
  setCachedServerCommandRevision,
} from './server/commands'
import { DBState, LoadingStatusState, hypaV3ProgressStore, loadedStore } from './stores.svelte'

beforeEach(() => {
  platformState.isFastifyServer = true
  serverBootstrapState.fetch.mockImplementation(async () => serverBootstrapState.response)
  serverBootstrapState.fetchReadOnly.mockImplementation(async () => serverBootstrapState.response)
  serverBootstrapState.response = {
    status: 'ok',
    projection: {
      revision: 5,
      database: {
        characters: [],
        modules: [],
        personas: [],
        language: 'en',
      },
    },
  }
  serverBootstrapState.fetch.mockClear()
  serverBootstrapState.fetchReadOnly.mockClear()
  serverEventsState.subscriptions = []
  serverEventsState.unsubscribe.mockClear()
  serverEventsState.subscribe.mockClear()
  // Default: the server cannot narrow the resource → full bootstrap. Targeted
  // tests override this per-case.
  serverProjectionState.fetchResource.mockReset()
  serverProjectionState.fetchResource.mockImplementation(async () => ({
    status: 'ok' as const,
    revision: 6,
    mode: 'full' as const,
  }))
  clearCachedServerCommandRevision()
  forageSpies.Init.mockClear()
  forageSpies.getItem.mockClear()
  forageSpies.setItem.mockClear()
  persistenceSpies.saveDb.mockClear()
  persistenceSpies.makeColdData.mockClear()
  hydrationSpies.startChatMessageHydration.mockClear()
  hydrationSpies.hydrateActiveChat.mockClear()
  hydrationSpies.resetChatHydration.mockClear()
  hydrationSpies.ensureAllChatsHydrated.mockClear()
  hydrationSpies.hydrateChatMessages.mockClear()
  setServerProjectionWriteGuardEnabled(false)
  DBState.db = {} as any
  LoadingStatusState.text = ''
  hypaV3ProgressStore.set({
    open: false,
    miniMsg: '',
    msg: '',
    subMsg: '',
  })
  loadedStore.set(false)
})

// The surgical-sync decision tree processes command events on a serial promise
// chain; drain the microtask queue so a no-op (echo-skip) outcome has settled.
async function flushServerProjectionSync(): Promise<void> {
  for (let i = 0; i < 50; i += 1) {
    await Promise.resolve()
  }
}

describe('web bootstrap startup source', () => {
  it('loads the Fastify bootstrap projection without entering localForage', async () => {
    await loadWebInitialDatabase()

    expect(DBState.db.language).toBe('en')
    expect(DBState.db.characters).toEqual([])
    expect(isServerProjectionWriteGuardEnabled()).toBe(true)
    expect(() => {
      DBState.db.language = 'ja'
    }).toThrow()
    expect(LoadingStatusState.text).toBe('Loading Server Projection...')
    expect(forageSpies.Init).not.toHaveBeenCalled()
    expect(forageSpies.getItem).not.toHaveBeenCalled()
    expect(forageSpies.setItem).not.toHaveBeenCalled()
    expect(serverEventsState.subscribe).toHaveBeenCalledTimes(1)
  })

  it('skips its own echoed command events without any refetch', async () => {
    await loadWebInitialDatabase()
    expect(peekCachedServerCommandRevision()).toBe(5)

    // The writer just issued a command, which cached its post-command revision.
    setCachedServerCommandRevision(6)

    const subscription = serverEventsState.subscriptions[0]
    // The echoed event carries the revision we already applied.
    subscription.onCommandEvent({ type: 'settings.updated', revision: 6, resource: 'settings' })
    await flushServerProjectionSync()

    expect(serverProjectionState.fetchResource).not.toHaveBeenCalled()
    expect(serverBootstrapState.fetchReadOnly).not.toHaveBeenCalled()
    expect(peekCachedServerCommandRevision()).toBe(6)
  })

  it('targeted-fetches a foreign contiguous event for just its resource', async () => {
    await loadWebInitialDatabase()
    expect(peekCachedServerCommandRevision()).toBe(5)

    serverProjectionState.fetchResource.mockImplementation(async () => ({
      status: 'ok' as const,
      revision: 6,
      mode: 'fields' as const,
      fields: { characters: [{ chaId: 'char-a', name: 'Ada', chats: [] }] },
    }))

    const subscription = serverEventsState.subscriptions[0]
    subscription.onCommandEvent({ type: 'chat.updated', revision: 6, resource: 'chat' })

    await vi.waitFor(() => {
      expect(DBState.db.characters).toEqual([{ chaId: 'char-a', name: 'Ada', chats: [] }])
    })
    expect(serverProjectionState.fetchResource).toHaveBeenCalledWith('chat', {
      id: undefined,
      parentId: undefined,
    })
    expect(serverBootstrapState.fetchReadOnly).not.toHaveBeenCalled()
    expect(peekCachedServerCommandRevision()).toBe(6)
    // Phase 4.3: merging the `characters` slice re-stubs every chat, so the
    // hydration cache is reset and the open chat re-hydrated.
    expect(hydrationSpies.resetChatHydration).toHaveBeenCalled()
    expect(hydrationSpies.hydrateActiveChat).toHaveBeenCalledWith({ force: true })
  })

  it('full-bootstraps when the server cannot narrow the resource', async () => {
    await loadWebInitialDatabase()
    serverBootstrapState.response = {
      status: 'ok',
      projection: {
        revision: 6,
        database: { characters: [], modules: [], personas: [], language: 'ko' },
      },
    }

    const subscription = serverEventsState.subscriptions[0]
    // The default projection mock returns mode 'full' for this resource.
    subscription.onCommandEvent({ type: 'settings.updated', revision: 6, resource: 'settings' })

    await vi.waitFor(() => {
      expect(DBState.db.language).toBe('ko')
    })
    expect(serverProjectionState.fetchResource).toHaveBeenCalledWith('settings', {
      id: undefined,
      parentId: undefined,
    })
    expect(serverBootstrapState.fetchReadOnly).toHaveBeenCalledTimes(1)
    expect(peekCachedServerCommandRevision()).toBe(6)
  })

  it('full-bootstraps on a revision gap, without a targeted fetch', async () => {
    await loadWebInitialDatabase()
    serverBootstrapState.response = {
      status: 'ok',
      projection: {
        revision: 9,
        database: { characters: [], modules: [], personas: [], language: 'ko' },
      },
    }

    const subscription = serverEventsState.subscriptions[0]
    // revision 9 is a gap over the applied baseline of 5.
    subscription.onCommandEvent({ type: 'chat.updated', revision: 9, resource: 'chat' })

    await vi.waitFor(() => {
      expect(DBState.db.language).toBe('ko')
    })
    expect(serverProjectionState.fetchResource).not.toHaveBeenCalled()
    expect(serverBootstrapState.fetchReadOnly).toHaveBeenCalledTimes(1)
    expect(peekCachedServerCommandRevision()).toBe(9)
  })

  it('re-subscribes and full-bootstraps after the event stream drops', async () => {
    vi.useFakeTimers()
    try {
      await loadWebInitialDatabase()
      expect(serverEventsState.subscribe).toHaveBeenCalledTimes(1)

      serverBootstrapState.response = {
        status: 'ok',
        projection: {
          revision: 6,
          database: { characters: [], modules: [], personas: [], language: 'ko' },
        },
      }

      const subscription = serverEventsState.subscriptions[0]
      subscription.onError?.('stream dropped')

      await vi.advanceTimersByTimeAsync(1000)

      // Reconnected and reconciled the full projection.
      expect(serverEventsState.subscribe).toHaveBeenCalledTimes(2)
      expect(serverBootstrapState.fetchReadOnly).toHaveBeenCalledTimes(1)
      expect(DBState.db.language).toBe('ko')
      expect(peekCachedServerCommandRevision()).toBe(6)
    } finally {
      vi.useRealTimers()
    }
  })

  it('applies server memory progress events without refreshing the projection', async () => {
    await loadWebInitialDatabase()
    const subscription = serverEventsState.subscriptions[0]

    subscription.onMemoryEvent?.({
      type: 'memory.job',
      sideEffect: {
        kind: 'hypav3_progress',
        payload: {
          open: true,
          miniMsg: '2',
          msg: '[Hypa V3] Summarizing...',
          subMsg: '2 queued',
          status: 'running',
          queuedCount: 2,
        },
      },
    })

    expect(get(hypaV3ProgressStore)).toEqual({
      open: true,
      miniMsg: '2',
      msg: '[Hypa V3] Summarizing...',
      subMsg: '2 queued',
    })
    expect(serverBootstrapState.fetch).toHaveBeenCalledTimes(1)
    expect(serverBootstrapState.fetchReadOnly).not.toHaveBeenCalled()
  })

  it('blocks direct Fastify projection writes after the guard is enabled', async () => {
    await loadWebInitialDatabase()

    expect(isServerProjectionWriteGuardEnabled()).toBe(true)
    expect(() => {
      DBState.db.language = 'ja'
    }).toThrow()

    serverBootstrapState.response = {
      status: 'ok',
      projection: {
        revision: 6,
        database: {
          characters: [{ chaId: 'char-a', name: 'Ada', chats: [] }],
          modules: [],
          personas: [],
          language: 'ko',
        },
      },
    }

    const subscription = serverEventsState.subscriptions[0]
    subscription.onCommandEvent({ type: 'settings.updated', revision: 6, resource: 'settings' })

    await vi.waitFor(() => {
      expect(DBState.db.language).toBe('ko')
    })
    expect(DBState.db.characters).toEqual([{ chaId: 'char-a', name: 'Ada', chats: [] }])
    expect(() => {
      DBState.db.characters.push({ chaId: 'char-b', name: 'Babbage', chats: [] } as any)
    }).toThrow()
  })

  it('allows command-owned trusted projection writes and re-freezes afterward', async () => {
    await loadWebInitialDatabase()
    setServerProjectionWriteGuardEnabled(true)

    withTrustedServerProjectionWrite(() => {
      DBState.db.language = 'ja'
      DBState.db.characters.push({ chaId: 'char-command', name: 'Command', chats: [] } as any)
    })

    expect(DBState.db.language).toBe('ja')
    expect(DBState.db.characters).toEqual([{ chaId: 'char-command', name: 'Command', chats: [] }])
    expect(() => {
      DBState.db.language = 'ko'
    }).toThrow()
    expect(() => {
      DBState.db.characters.push({ chaId: 'char-direct', name: 'Direct', chats: [] } as any)
    }).toThrow()
  })

  it('reports unavailable Fastify bootstrap without loading local persistence', async () => {
    serverBootstrapState.response = { status: 'unavailable' }

    await expect(loadWebInitialDatabase()).rejects.toThrow('Server bootstrap is unavailable')

    expect(LoadingStatusState.text).toBe('Loading Server Projection...')
    expect(isServerProjectionWriteGuardEnabled()).toBe(false)
    expect(forageSpies.Init).not.toHaveBeenCalled()
    expect(forageSpies.getItem).not.toHaveBeenCalled()
    expect(forageSpies.setItem).not.toHaveBeenCalled()
    expect(serverEventsState.subscribe).not.toHaveBeenCalled()
  })

  it('reports Fastify bootstrap errors without loading local persistence', async () => {
    serverBootstrapState.response = { status: 'error', error: 'missing_auth' }

    await expect(loadWebInitialDatabase()).rejects.toThrow('missing_auth')

    expect(LoadingStatusState.text).toBe('Loading Server Projection...')
    expect(isServerProjectionWriteGuardEnabled()).toBe(false)
    expect(serverEventsState.subscribe).not.toHaveBeenCalled()
    expect(forageSpies.Init).not.toHaveBeenCalled()
    expect(forageSpies.getItem).not.toHaveBeenCalled()
    expect(forageSpies.setItem).not.toHaveBeenCalled()
  })

  it('skips local persistence maintenance during Fastify-served startup', async () => {
    serverBootstrapState.response = {
      status: 'ok',
      projection: {
        revision: 5,
        database: {
          characters: [],
          modules: [],
          personas: [],
          language: 'en',
          formatversion: 5,
          characterOrder: [],
          mainPrompt: '',
          loreBookToken: 8000,
        } as any,
      },
    }

    await loadData()

    expect(isServerProjectionWriteGuardEnabled()).toBe(true)
    expect(() => {
      DBState.db.language = 'ja'
    }).toThrow()
    expect(forageSpies.Init).not.toHaveBeenCalled()
    expect(forageSpies.getItem).not.toHaveBeenCalled()
    expect(forageSpies.setItem).not.toHaveBeenCalled()
    expect(persistenceSpies.makeColdData).not.toHaveBeenCalled()
    expect(persistenceSpies.saveDb).not.toHaveBeenCalled()
    expect(serverEventsState.subscribe).toHaveBeenCalledTimes(1)
  })
})
