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
    sinceRevision?: number | null
    onCommandEvent: (event: {
      type: string
      revision: number
      resource: string
      id?: string
      parentId?: string
      origin?: { writerSessionId: string }
    }) => void
    onMemoryEvent?: (event: { type: 'memory.job'; sideEffect?: { kind: string; payload: unknown } }) => void
    onError?: (error: string) => void
    onClose?: () => void
  }>,
  unsubscribe: vi.fn(),
  subscribe: vi.fn(
    async (input: {
      sinceRevision?: number | null
      onCommandEvent: (event: {
        type: string
        revision: number
        resource: string
        id?: string
        parentId?: string
        origin?: { writerSessionId: string }
      }) => void
      onMemoryEvent?: (event: { type: 'memory.job'; sideEffect?: { kind: string; payload: unknown } }) => void
      onError?: (error: string) => void
      onClose?: () => void
    }) => {
      serverEventsState.subscriptions.push(input)
      return { status: 'ok' as const, unsubscribe: serverEventsState.unsubscribe }
    },
  ),
}))
const serverProjectionState = vi.hoisted(() => ({
  fetchResource: vi.fn(),
}))
const serverCommandsState = vi.hoisted(() => ({
  initialize: vi.fn(),
}))
const promptTemplateHydrationSpies = vi.hoisted(() => ({
  resetPromptTemplateHydration: vi.fn(),
  startPromptTemplateHydration: vi.fn(),
  markPromptTemplateProjectionApplied: vi.fn(),
}))
const activeGenerationReattachSpies = vi.hoisted(() => ({
  setActiveGenerationJobs: vi.fn(),
  startActiveGenerationReattach: vi.fn(),
  triggerOpenChatGenerationReattach: vi.fn(),
}))
const memoryJobEventSpies = vi.hoisted(() => ({
  publishServerMemoryJobEvent: vi.fn(),
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
    isFastifyServer: true,
  }
})

vi.mock('./server/bootstrap', () => ({
  fetchServerBootstrapProjection: serverBootstrapState.fetch,
  fetchServerBootstrapProjectionReadOnly: serverBootstrapState.fetchReadOnly,
}))

vi.mock('./server/events', () => ({
  subscribeServerCommandEvents: serverEventsState.subscribe,
}))

vi.mock('./server/memoryJobEvents', () => memoryJobEventSpies)

vi.mock('./server/projection', () => ({
  fetchServerProjectionResource: serverProjectionState.fetchResource,
  canUseServerProjection: () => true,
  fetchServerChatMessages: vi.fn(),
}))

vi.mock('./server/promptTemplateHydration', () => promptTemplateHydrationSpies)

vi.mock('./server/commands', async (importActual) => {
  const actual = await importActual<typeof import('./server/commands')>()
  return {
    ...actual,
    initializeServerDatabase: serverCommandsState.initialize,
  }
})

vi.mock('./process/reattach', () => activeGenerationReattachSpies)

// Chat-message hydration is exercised in its own tests; stub it here so the
// surgical-sync assertions (fetch counts) are unaffected by hydration calls.
const hydrationSpies = vi.hoisted(() => ({
  startChatMessageHydration: vi.fn(),
  hydrateActiveChat: vi.fn(async () => undefined),
  hydrateActiveCharacterLorebook: vi.fn(async () => undefined),
  resetChatHydration: vi.fn(),
  ensureAllChatsHydrated: vi.fn(async () => undefined),
  ensureAllCharacterLorebooksHydrated: vi.fn(async () => undefined),
  hydrateChatMessages: vi.fn(async () => undefined),
  applyServerChatMessagesProjection: vi.fn(() => true),
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

import {
  calculateServerProjectionReconnectDelayMs,
  loadData,
  loadWebInitialDatabase,
  stopServerProjectionEvents,
} from './bootstrap'
import { alertError } from './alert'
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
import { getActiveWriterSessionId } from './server/activeWriterSession'
import { getProtocolDiagnosticsSnapshot, type FullBootstrapResyncReason } from './server/protocolDiagnostics'
import { DBState, LoadingStatusState, hypaV3ProgressStore, loadedStore, selectedCharID } from './stores.svelte'

function serverDefaultDatabase() {
  return {
    characters: [],
    modules: [],
    personas: [{ id: 'default-persona', name: 'User', personaPrompt: '', icon: '', note: '' }],
    botPresets: [{ id: 'default-preset', name: 'Default' }],
    colorScheme: { type: 'dark' },
    customTextTheme: {},
    language: 'en',
    textTheme: 'standard',
    font: 'default',
    animationSpeed: 0.4,
    heightMode: 'normal',
    textAreaSize: 0,
    sideBarSize: 0,
    textAreaTextSize: 0,
    formatversion: 5,
    characterOrder: [],
  }
}

beforeEach(() => {
  stopServerProjectionEvents()
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
  serverEventsState.subscribe.mockImplementation(async (input: any) => {
    serverEventsState.subscriptions.push(input)
    return { status: 'ok' as const, unsubscribe: serverEventsState.unsubscribe }
  })
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
  serverCommandsState.initialize.mockReset()
  serverCommandsState.initialize.mockResolvedValue({
    status: 'ok',
    revision: 1,
    initialized: true,
    event: { type: 'state.initialized', revision: 1, resource: 'state' },
  })
  activeGenerationReattachSpies.setActiveGenerationJobs.mockClear()
  promptTemplateHydrationSpies.resetPromptTemplateHydration.mockClear()
  promptTemplateHydrationSpies.startPromptTemplateHydration.mockClear()
  promptTemplateHydrationSpies.markPromptTemplateProjectionApplied.mockClear()
  activeGenerationReattachSpies.startActiveGenerationReattach.mockClear()
  activeGenerationReattachSpies.triggerOpenChatGenerationReattach.mockClear()
  memoryJobEventSpies.publishServerMemoryJobEvent.mockClear()
  clearCachedServerCommandRevision()
  forageSpies.Init.mockClear()
  forageSpies.getItem.mockClear()
  forageSpies.setItem.mockClear()
  persistenceSpies.saveDb.mockClear()
  persistenceSpies.makeColdData.mockClear()
  hydrationSpies.startChatMessageHydration.mockClear()
  hydrationSpies.hydrateActiveChat.mockClear()
  hydrationSpies.hydrateActiveCharacterLorebook.mockClear()
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
  vi.mocked(alertError).mockClear()
})

// The surgical-sync decision tree processes command events on a serial promise
// chain; drain the microtask queue so a no-op (echo-skip) outcome has settled.
async function flushServerProjectionSync(): Promise<void> {
  for (let i = 0; i < 50; i += 1) {
    await Promise.resolve()
  }
}

type ProtocolDiagnosticsSnapshot = ReturnType<typeof getProtocolDiagnosticsSnapshot>

function fullBootstrapReasonCount(snapshot: ProtocolDiagnosticsSnapshot, reason: string): number {
  return snapshot.fullBootstrapResync[reason] ?? 0
}

function unexpectedFullBootstrapCount(snapshot: ProtocolDiagnosticsSnapshot): number {
  return Object.values(snapshot.unexpectedFullBootstrapResync).reduce((total, count) => total + count, 0)
}

function fullBootstrapResourceCount(snapshot: ProtocolDiagnosticsSnapshot, resource: string): number {
  return snapshot.fullBootstrapResyncResources[resource] ?? 0
}

function expectFullBootstrapResyncDelta(
  before: ProtocolDiagnosticsSnapshot,
  reason: FullBootstrapResyncReason,
  resource?: string,
): void {
  const after = getProtocolDiagnosticsSnapshot()
  expect(fullBootstrapReasonCount(after, reason) - fullBootstrapReasonCount(before, reason)).toBe(1)
  expect(unexpectedFullBootstrapCount(after) - unexpectedFullBootstrapCount(before)).toBe(0)
  if (resource !== undefined) {
    expect(fullBootstrapResourceCount(after, resource) - fullBootstrapResourceCount(before, resource)).toBe(1)
  }
}

async function installErrorHandlersForTest(): Promise<{
  errorHandler: EventListener
  rejectionHandler: EventListener
}> {
  serverBootstrapState.response = {
    status: 'ok',
    projection: {
      revision: 5,
      database: serverDefaultDatabase(),
    },
  }
  const addEventListenerSpy = vi.spyOn(window, 'addEventListener')
  try {
    await loadData()

    const errorHandler = addEventListenerSpy.mock.calls.filter(([type]) => type === 'error').at(-1)?.[1] as
      | EventListener
      | undefined
    const rejectionHandler = addEventListenerSpy.mock.calls
      .filter(([type]) => type === 'unhandledrejection')
      .at(-1)?.[1] as EventListener | undefined

    if (!errorHandler || !rejectionHandler) {
      throw new Error('Expected bootstrap to register global error handlers')
    }

    vi.mocked(alertError).mockClear()
    return { errorHandler, rejectionHandler }
  } finally {
    addEventListenerSpy.mockRestore()
  }
}

describe('web bootstrap startup source', () => {
  it('L37/I21: global handlers ignore null error events and undefined rejections without useless alerts', async () => {
    const consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => undefined)
    try {
      const { errorHandler, rejectionHandler } = await installErrorHandlersForTest()

      expect(() => {
        errorHandler({ error: null, message: '', target: null } as unknown as ErrorEvent)
      }).not.toThrow()
      expect(() => {
        errorHandler({ target: null } as unknown as ErrorEvent)
      }).not.toThrow()
      expect(() => {
        rejectionHandler({ reason: undefined } as unknown as PromiseRejectionEvent)
      }).not.toThrow()
      expect(() => {
        rejectionHandler({ reason: null } as unknown as PromiseRejectionEvent)
      }).not.toThrow()
      expect(() => {
        rejectionHandler({ reason: { code: 'plain-object' } } as unknown as PromiseRejectionEvent)
      }).not.toThrow()

      expect(alertError).not.toHaveBeenCalled()
    } finally {
      consoleErrorSpy.mockRestore()
    }
  })

  it('L37: resource-target global errors skip generic application alerts', async () => {
    const consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => undefined)
    try {
      const { errorHandler } = await installErrorHandlersForTest()
      const img = document.createElement('img')
      const error = new Error('image failed')

      expect(() => {
        errorHandler({ error, message: error.message, target: img } as unknown as ErrorEvent)
      }).not.toThrow()

      expect(alertError).not.toHaveBeenCalled()
    } finally {
      consoleErrorSpy.mockRestore()
    }
  })

  it('L37: useful global Error objects and message strings still alert', async () => {
    const consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => undefined)
    try {
      const { errorHandler, rejectionHandler } = await installErrorHandlersForTest()
      const thrown = new Error('global boom')
      const rejected = new Error('rejected boom')

      errorHandler({ error: thrown, message: '', target: null } as unknown as ErrorEvent)
      errorHandler({ error: null, message: 'script message', target: null } as unknown as ErrorEvent)
      rejectionHandler({ reason: rejected } as unknown as PromiseRejectionEvent)
      rejectionHandler({ reason: 'rejected message' } as unknown as PromiseRejectionEvent)

      expect(alertError).toHaveBeenCalledWith(thrown)
      expect(alertError).toHaveBeenCalledWith('script message')
      expect(alertError).toHaveBeenCalledWith(rejected)
      expect(alertError).toHaveBeenCalledWith('rejected message')
    } finally {
      consoleErrorSpy.mockRestore()
    }
  })

  it('loads the Fastify bootstrap projection without entering localForage', async () => {
    await loadWebInitialDatabase()

    expect(DBState.db.language).toBe('en')
    expect(DBState.db.characters).toEqual([])
    expect(DBState.db.apiType).toBeUndefined()
    expect(isServerProjectionWriteGuardEnabled()).toBe(true)
    expect(() => {
      DBState.db.language = 'ja'
    }).toThrow()
    expect(LoadingStatusState.text).toBe('Loading Server Projection...')
    expect(forageSpies.Init).not.toHaveBeenCalled()
    expect(forageSpies.getItem).not.toHaveBeenCalled()
    expect(forageSpies.setItem).not.toHaveBeenCalled()
    expect(serverEventsState.subscribe).toHaveBeenCalledTimes(1)
    expect(serverEventsState.subscriptions[0].sinceRevision).toBe(5)
    expect(promptTemplateHydrationSpies.resetPromptTemplateHydration).toHaveBeenCalledTimes(1)
    expect(promptTemplateHydrationSpies.startPromptTemplateHydration).toHaveBeenCalledTimes(1)
  })

  it('hydrates a selected character shell during Fastify startup', async () => {
    serverBootstrapState.response = {
      status: 'ok',
      projection: {
        revision: 5,
        database: {
          characters: [
            {
              __serverCharacterShell: true,
              chaId: 'char-a',
              name: 'Ada shell',
              chats: [{ id: 'chat-a', name: 'Chat A', message: [] }],
              chatPage: 0,
              chatFolders: [],
            },
          ],
          currentChar: 0,
          modules: [],
          personas: [],
          language: 'en',
        },
      },
    }
    serverProjectionState.fetchResource.mockImplementation(async (resource: string) => {
      if (resource === 'characterRow') {
        return {
          status: 'ok' as const,
          revision: 5,
          mode: 'character-row' as const,
          characterId: 'char-a',
          character: {
            chaId: 'char-a',
            name: 'Ada full',
            desc: 'Hydrated description',
            firstMessage: 'Hello',
            chats: [{ id: 'chat-a', name: 'Chat A', message: [] }],
            chatPage: 0,
            chatFolders: [],
            globalLore: [],
          },
        }
      }
      return { status: 'ok' as const, revision: 5, mode: 'full' as const }
    })

    await loadWebInitialDatabase()

    expect(serverProjectionState.fetchResource).toHaveBeenCalledWith('characterRow', { id: 'char-a' })
    expect(DBState.db.characters[0]).toMatchObject({
      chaId: 'char-a',
      name: 'Ada full',
      desc: 'Hydrated description',
      firstMessage: 'Hello',
    })
    expect(DBState.db.characters[0]).not.toHaveProperty('__serverCharacterShell')
    expect(hydrationSpies.hydrateActiveChat).toHaveBeenCalled()
    expect(hydrationSpies.hydrateActiveCharacterLorebook).toHaveBeenCalled()
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

  it('skips own command events by writer origin before the command response advances revision', async () => {
    await loadWebInitialDatabase()
    expect(peekCachedServerCommandRevision()).toBe(5)
    const writerSessionId = getActiveWriterSessionId()

    const subscription = serverEventsState.subscriptions[0]
    subscription.onCommandEvent({
      type: 'character.selected',
      revision: 6,
      resource: 'characterSelection',
      id: 'char-a',
      origin: { writerSessionId },
    })
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
    // Merging `characters` re-stubs every chat, so the hydration cache is reset
    // and the open chat re-hydrated.
    expect(hydrationSpies.resetChatHydration).toHaveBeenCalled()
    expect(hydrationSpies.hydrateActiveChat).toHaveBeenCalledWith({ force: true })
    expect(activeGenerationReattachSpies.triggerOpenChatGenerationReattach).toHaveBeenCalledTimes(1)
  })

  it('applies a promptItem projection and marks promptTemplate hydrated', async () => {
    await loadWebInitialDatabase()
    serverProjectionState.fetchResource.mockImplementation(async () => ({
      status: 'ok' as const,
      revision: 6,
      mode: 'fields' as const,
      fields: {
        promptTemplate: [{ id: 'prompt-a', type: 'plain', text: 'hydrated', role: 'system' }],
      },
    }))

    const subscription = serverEventsState.subscriptions[0]
    subscription.onCommandEvent({ type: 'promptItem.updated', revision: 6, resource: 'promptItem', id: 'prompt-a' })

    await vi.waitFor(() => {
      expect(DBState.db.promptTemplate).toEqual([{ id: 'prompt-a', type: 'plain', text: 'hydrated', role: 'system' }])
    })
    expect(promptTemplateHydrationSpies.markPromptTemplateProjectionApplied).toHaveBeenCalledTimes(1)
    expect(peekCachedServerCommandRevision()).toBe(6)
  })

  it('applies a character-lorebook projection to one character without rehydrating chats', async () => {
    serverBootstrapState.response = {
      status: 'ok',
      projection: {
        revision: 5,
        database: {
          characters: [
            { chaId: 'char-a', name: 'Ada', globalLore: [], chats: [{ id: 'chat-a' }] },
            {
              chaId: 'char-b',
              name: 'Babbage',
              globalLore: [{ key: 'old', content: 'old' }],
              chats: [{ id: 'chat-b' }],
            },
          ],
          currentChar: 0,
          modules: [],
          personas: [],
          language: 'en',
        },
      },
    }
    await loadWebInitialDatabase()
    hydrationSpies.resetChatHydration.mockClear()
    hydrationSpies.hydrateActiveChat.mockClear()

    serverProjectionState.fetchResource.mockImplementation(async () => ({
      status: 'ok' as const,
      revision: 6,
      mode: 'character-lorebook' as const,
      characterId: 'char-a',
      globalLore: [{ key: 'new', content: 'new lore' }],
    }))

    const subscription = serverEventsState.subscriptions[0]
    subscription.onCommandEvent({
      type: 'lorebook.entries.replaced',
      revision: 6,
      resource: 'characterLorebook',
      id: 'char-a',
    })

    await vi.waitFor(() => {
      expect(peekCachedServerCommandRevision()).toBe(6)
    })
    expect(serverProjectionState.fetchResource).toHaveBeenCalledWith('characterLorebook', {
      id: 'char-a',
      parentId: undefined,
    })
    // Only char-a's globalLore changed; char-b is untouched.
    expect(DBState.db.characters?.[0].globalLore).toEqual([{ key: 'new', content: 'new lore' }])
    expect(DBState.db.characters?.[1].globalLore).toEqual([{ key: 'old', content: 'old' }])
    // No broad characters merge, so no chat re-stub / re-hydration.
    expect(hydrationSpies.resetChatHydration).not.toHaveBeenCalled()
    expect(hydrationSpies.hydrateActiveChat).not.toHaveBeenCalled()
    expect(serverBootstrapState.fetchReadOnly).not.toHaveBeenCalled()
  })

  it('applies a character-row projection to one character, preserving hydrated chats', async () => {
    const initialGenerationSettings = {
      configured: true,
      personaId: 'persona-a',
      presetId: 'preset-a',
      jailbreakToggle: false,
      sidebarToggles: {},
    }
    const projectedGenerationSettings = {
      configured: true,
      personaId: 'persona-b',
      presetId: 'preset-b',
      jailbreakToggle: true,
      sidebarToggles: { mode: 'fast' },
    }
    serverBootstrapState.response = {
      status: 'ok',
      projection: {
        revision: 5,
        database: {
          characters: [
            {
              chaId: 'char-a',
              name: 'Ada',
              chats: [
                {
                  id: 'chat-a',
                  message: [{ role: 'user', data: 'hi' }],
                  generationSettings: initialGenerationSettings,
                },
              ],
            },
            { chaId: 'char-b', name: 'Babbage', chats: [{ id: 'chat-b', message: [] }] },
          ],
          currentChar: 0,
          modules: [],
          personas: [],
          language: 'en',
        },
      },
    }
    await loadWebInitialDatabase()
    hydrationSpies.resetChatHydration.mockClear()
    hydrationSpies.hydrateActiveChat.mockClear()

    serverProjectionState.fetchResource.mockImplementation(async () => ({
      status: 'ok' as const,
      revision: 6,
      mode: 'character-row' as const,
      characterId: 'char-a',
      // Shipped row is message-free (stubbed chats).
      character: {
        chaId: 'char-a',
        name: 'Ada Lovelace',
        chats: [
          {
            id: 'chat-a',
            message: [],
            generationSettings: projectedGenerationSettings,
          },
        ],
      },
    }))

    const subscription = serverEventsState.subscriptions[0]
    subscription.onCommandEvent({
      type: 'character.updated',
      revision: 6,
      resource: 'characterRow',
      id: 'char-a',
    })

    await vi.waitFor(() => {
      expect(peekCachedServerCommandRevision()).toBe(6)
    })
    expect(serverProjectionState.fetchResource).toHaveBeenCalledWith('characterRow', {
      id: 'char-a',
      parentId: undefined,
    })
    // char-a's metadata updated; its already-hydrated chat messages are kept.
    expect(DBState.db.characters?.[0].name).toBe('Ada Lovelace')
    expect(DBState.db.characters?.[0].chats?.[0].message).toEqual([{ role: 'user', data: 'hi' }])
    expect(DBState.db.characters?.[0].chats?.[0].generationSettings).toEqual(projectedGenerationSettings)
    // char-b is untouched.
    expect(DBState.db.characters?.[1].name).toBe('Babbage')
    // No broad characters merge → no chat re-stub / re-hydration / full bootstrap.
    expect(hydrationSpies.resetChatHydration).not.toHaveBeenCalled()
    expect(hydrationSpies.hydrateActiveChat).not.toHaveBeenCalled()
    expect(serverBootstrapState.fetchReadOnly).not.toHaveBeenCalled()
  })

  it('applies a generation-chat projection to the changed chat and re-arms reattach', async () => {
    serverBootstrapState.response = {
      status: 'ok',
      projection: {
        revision: 5,
        database: {
          characters: [
            {
              chaId: 'char-a',
              name: 'Ada',
              chats: [{ id: 'chat-a', message: [{ role: 'user', data: 'hi', chatId: 'm1' }] }],
              chatPage: 0,
            },
          ],
          currentChar: 0,
          modules: [],
          personas: [],
          language: 'en',
        },
      },
    }
    await loadWebInitialDatabase()
    hydrationSpies.resetChatHydration.mockClear()
    hydrationSpies.hydrateActiveChat.mockClear()
    hydrationSpies.applyServerChatMessagesProjection.mockClear()
    activeGenerationReattachSpies.triggerOpenChatGenerationReattach.mockClear()

    const generatedTail = [
      { role: 'user', data: 'hi', chatId: 'm1' },
      { role: 'char', data: 'fresh answer', chatId: 'gen-1' },
    ]
    serverProjectionState.fetchResource.mockImplementation(async () => ({
      status: 'ok' as const,
      revision: 6,
      mode: 'generation-chat' as const,
      chatId: 'chat-a',
      message: generatedTail,
      alternates: [],
    }))

    const subscription = serverEventsState.subscriptions[0]
    subscription.onCommandEvent({
      type: 'generation.persisted',
      revision: 6,
      resource: 'generation',
      id: 'gen-1',
      parentId: 'chat-a',
    })

    await vi.waitFor(() => {
      expect(peekCachedServerCommandRevision()).toBe(6)
    })
    expect(serverProjectionState.fetchResource).toHaveBeenCalledWith('generation', {
      id: 'gen-1',
      parentId: 'chat-a',
    })
    // The changed chat's message tail is applied surgically (no broad re-stub).
    expect(hydrationSpies.applyServerChatMessagesProjection).toHaveBeenCalledWith(
      'chat-a',
      generatedTail,
      undefined,
      [],
    )
    // The open-chat generation reattach is re-armed.
    expect(activeGenerationReattachSpies.triggerOpenChatGenerationReattach).toHaveBeenCalledTimes(1)
    expect(hydrationSpies.resetChatHydration).not.toHaveBeenCalled()
    expect(serverBootstrapState.fetchReadOnly).not.toHaveBeenCalled()
  })

  it('applies character selection projections without replacing characters or rehydrating chats', async () => {
    serverBootstrapState.response = {
      status: 'ok',
      projection: {
        revision: 5,
        database: {
          characters: [
            { chaId: 'char-a', name: 'Ada', lastInteraction: 1, chats: [{ id: 'chat-a' }] },
            { chaId: 'char-b', name: 'Babbage', lastInteraction: 2, chats: [{ id: 'chat-b' }] },
          ],
          currentChar: 0,
          modules: [],
          personas: [],
          language: 'en',
        },
      },
    }
    await loadWebInitialDatabase()
    hydrationSpies.resetChatHydration.mockClear()
    hydrationSpies.hydrateActiveChat.mockClear()
    activeGenerationReattachSpies.triggerOpenChatGenerationReattach.mockClear()

    serverProjectionState.fetchResource.mockImplementation(async () => ({
      status: 'ok' as const,
      revision: 6,
      mode: 'character-selection' as const,
      characterId: 'char-b',
      currentChar: 1,
      lastInteraction: 222,
    }))

    const subscription = serverEventsState.subscriptions[0]
    subscription.onCommandEvent({
      type: 'character.selected',
      revision: 6,
      resource: 'characterSelection',
      id: 'char-b',
    })

    await vi.waitFor(() => {
      expect(get(selectedCharID)).toBe(1)
    })
    expect((DBState.db as unknown as { currentChar?: number }).currentChar).toBe(1)
    expect(DBState.db.characters).toEqual([
      { chaId: 'char-a', name: 'Ada', lastInteraction: 1, chats: [{ id: 'chat-a' }] },
      { chaId: 'char-b', name: 'Babbage', lastInteraction: 222, chats: [{ id: 'chat-b' }] },
    ])
    expect(serverProjectionState.fetchResource).toHaveBeenCalledWith('characterSelection', {
      id: 'char-b',
      parentId: undefined,
    })
    expect(peekCachedServerCommandRevision()).toBe(6)
    expect(hydrationSpies.resetChatHydration).not.toHaveBeenCalled()
    expect(hydrationSpies.hydrateActiveChat).not.toHaveBeenCalled()
    expect(activeGenerationReattachSpies.triggerOpenChatGenerationReattach).not.toHaveBeenCalled()
  })

  it('hydrates a shell selected by a character-selection projection', async () => {
    serverBootstrapState.response = {
      status: 'ok',
      projection: {
        revision: 5,
        database: {
          characters: [
            { chaId: 'char-a', name: 'Ada', chats: [{ id: 'chat-a', message: [] }], chatPage: 0 },
            {
              __serverCharacterShell: true,
              chaId: 'char-b',
              name: 'Babbage shell',
              chats: [{ id: 'chat-b', name: 'Chat B', message: [] }],
              chatPage: 0,
              chatFolders: [],
            },
          ],
          currentChar: 0,
          modules: [],
          personas: [],
          language: 'en',
        },
      },
    }
    await loadWebInitialDatabase()
    hydrationSpies.resetChatHydration.mockClear()
    hydrationSpies.hydrateActiveChat.mockClear()
    hydrationSpies.hydrateActiveCharacterLorebook.mockClear()

    serverProjectionState.fetchResource.mockImplementation(async (resource: string) => {
      if (resource === 'characterSelection') {
        return {
          status: 'ok' as const,
          revision: 6,
          mode: 'character-selection' as const,
          characterId: 'char-b',
          currentChar: 1,
          lastInteraction: 222,
        }
      }
      if (resource === 'characterRow') {
        return {
          status: 'ok' as const,
          revision: 6,
          mode: 'character-row' as const,
          characterId: 'char-b',
          character: {
            chaId: 'char-b',
            name: 'Babbage full',
            desc: 'Hydrated Babbage',
            firstMessage: 'Hello from B',
            lastInteraction: 222,
            chats: [{ id: 'chat-b', name: 'Chat B', message: [] }],
            chatPage: 0,
            chatFolders: [],
            globalLore: [],
          },
        }
      }
      return { status: 'ok' as const, revision: 6, mode: 'full' as const }
    })

    const subscription = serverEventsState.subscriptions[0]
    subscription.onCommandEvent({
      type: 'character.selected',
      revision: 6,
      resource: 'characterSelection',
      id: 'char-b',
    })

    await vi.waitFor(() => {
      expect(DBState.db.characters?.[1]?.desc).toBe('Hydrated Babbage')
    })
    expect(get(selectedCharID)).toBe(1)
    expect(serverProjectionState.fetchResource).toHaveBeenCalledWith('characterSelection', {
      id: 'char-b',
      parentId: undefined,
    })
    expect(serverProjectionState.fetchResource).toHaveBeenCalledWith('characterRow', { id: 'char-b' })
    expect(DBState.db.characters[1]).not.toHaveProperty('__serverCharacterShell')
    expect(hydrationSpies.resetChatHydration).not.toHaveBeenCalled()
    expect(hydrationSpies.hydrateActiveChat).toHaveBeenCalled()
    expect(hydrationSpies.hydrateActiveCharacterLorebook).toHaveBeenCalled()
  })

  it('advances empty targeted projection events without full bootstrap or hydration reset', async () => {
    await loadWebInitialDatabase()
    expect(peekCachedServerCommandRevision()).toBe(5)
    hydrationSpies.resetChatHydration.mockClear()
    hydrationSpies.hydrateActiveChat.mockClear()

    serverProjectionState.fetchResource.mockImplementation(async () => ({
      status: 'ok' as const,
      revision: 6,
      mode: 'fields' as const,
      fields: {},
    }))

    const subscription = serverEventsState.subscriptions[0]
    subscription.onCommandEvent({ type: 'asset.created', revision: 6, resource: 'asset' })

    await vi.waitFor(() => {
      expect(peekCachedServerCommandRevision()).toBe(6)
    })
    expect(serverProjectionState.fetchResource).toHaveBeenCalledWith('asset', {
      id: undefined,
      parentId: undefined,
    })
    expect(serverBootstrapState.fetchReadOnly).not.toHaveBeenCalled()
    expect(hydrationSpies.resetChatHydration).not.toHaveBeenCalled()
    expect(hydrationSpies.hydrateActiveChat).not.toHaveBeenCalled()
  })

  it('full-bootstraps when the server cannot narrow the resource', async () => {
    await loadWebInitialDatabase()
    activeGenerationReattachSpies.triggerOpenChatGenerationReattach.mockClear()
    serverBootstrapState.response = {
      status: 'ok',
      projection: {
        revision: 6,
        database: { characters: [], modules: [], personas: [], language: 'ko' },
      },
    }

    const subscription = serverEventsState.subscriptions[0]
    // The default projection mock returns mode 'full' for this resource.
    const diagnosticsBefore = getProtocolDiagnosticsSnapshot()
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
    // The sprawling `settings` resource is attributed to the per-resource
    // full-bootstrap fallback count for the measurement.
    expectFullBootstrapResyncDelta(diagnosticsBefore, 'projection-full-mode', 'settings')
  })

  it('full-bootstraps restored state events so the active projection changes', async () => {
    await loadWebInitialDatabase()
    serverBootstrapState.response = {
      status: 'ok',
      projection: {
        revision: 6,
        database: {
          characters: [{ chaId: 'restored-char', name: 'Restored', chats: [] }],
          modules: [],
          personas: [],
          language: 'ko',
        },
      },
    }

    const subscription = serverEventsState.subscriptions[0]
    subscription.onCommandEvent({ type: 'state.restored', revision: 6, resource: 'state' })

    await vi.waitFor(() => {
      expect(DBState.db).toMatchObject({
        language: 'ko',
        characters: [{ chaId: 'restored-char', name: 'Restored', chats: [] }],
      })
    })
    expect(serverProjectionState.fetchResource).toHaveBeenCalledWith('state', {
      id: undefined,
      parentId: undefined,
    })
    expect(serverBootstrapState.fetchReadOnly).toHaveBeenCalledTimes(1)
    expect(peekCachedServerCommandRevision()).toBe(6)
    expect(activeGenerationReattachSpies.triggerOpenChatGenerationReattach).toHaveBeenCalledTimes(1)
  })

  it('full-bootstraps when a contiguous targeted projection fetch fails', async () => {
    await loadWebInitialDatabase()
    serverProjectionState.fetchResource.mockImplementation(async () => ({
      status: 'error' as const,
      error: 'projection failed',
    }))
    serverBootstrapState.response = {
      status: 'ok',
      projection: {
        revision: 6,
        database: { characters: [], modules: [], personas: [], language: 'ko' },
      },
    }

    const subscription = serverEventsState.subscriptions[0]
    const diagnosticsBefore = getProtocolDiagnosticsSnapshot()
    subscription.onCommandEvent({ type: 'chat.updated', revision: 6, resource: 'chat' })

    await vi.waitFor(() => {
      expect(DBState.db.language).toBe('ko')
    })
    expect(serverProjectionState.fetchResource).toHaveBeenCalledWith('chat', {
      id: undefined,
      parentId: undefined,
    })
    expect(serverBootstrapState.fetchReadOnly).toHaveBeenCalledTimes(1)
    expect(peekCachedServerCommandRevision()).toBe(6)
    expectFullBootstrapResyncDelta(diagnosticsBefore, 'projection-error')
  })

  it('full-bootstraps when an event arrives without a cached baseline', async () => {
    await loadWebInitialDatabase()
    clearCachedServerCommandRevision()
    serverBootstrapState.response = {
      status: 'ok',
      projection: {
        revision: 6,
        database: { characters: [], modules: [], personas: [], language: 'ko' },
      },
    }

    const subscription = serverEventsState.subscriptions[0]
    const diagnosticsBefore = getProtocolDiagnosticsSnapshot()
    subscription.onCommandEvent({ type: 'chat.updated', revision: 6, resource: 'chat' })

    await vi.waitFor(() => {
      expect(DBState.db.language).toBe('ko')
    })
    expect(serverProjectionState.fetchResource).not.toHaveBeenCalled()
    expect(serverBootstrapState.fetchReadOnly).toHaveBeenCalledTimes(1)
    expect(peekCachedServerCommandRevision()).toBe(6)
    expectFullBootstrapResyncDelta(diagnosticsBefore, 'no-baseline')
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
    const diagnosticsBefore = getProtocolDiagnosticsSnapshot()
    subscription.onCommandEvent({ type: 'chat.updated', revision: 9, resource: 'chat' })

    await vi.waitFor(() => {
      expect(DBState.db.language).toBe('ko')
    })
    expect(serverProjectionState.fetchResource).not.toHaveBeenCalled()
    expect(serverBootstrapState.fetchReadOnly).toHaveBeenCalledTimes(1)
    expect(peekCachedServerCommandRevision()).toBe(9)
    expectFullBootstrapResyncDelta(diagnosticsBefore, 'revision-gap')
  })

  it('syncs the active selected character after a full-bootstrap resync', async () => {
    serverBootstrapState.response = {
      status: 'ok',
      projection: {
        revision: 5,
        database: {
          characters: [
            { chaId: 'char-a', name: 'Ada', chats: [{ id: 'chat-a', message: [] }], chatPage: 0 },
            {
              chaId: 'char-b',
              name: 'Babbage full',
              desc: 'Initial full row',
              chats: [{ id: 'chat-b', name: 'Chat B', message: [] }],
              chatPage: 0,
              chatFolders: [],
            },
          ],
          currentChar: 1,
          modules: [],
          personas: [],
          language: 'en',
        },
      },
    }
    await loadWebInitialDatabase()
    expect(get(selectedCharID)).toBe(1)
    hydrationSpies.resetChatHydration.mockClear()
    hydrationSpies.hydrateActiveChat.mockClear()
    hydrationSpies.hydrateActiveCharacterLorebook.mockClear()
    activeGenerationReattachSpies.triggerOpenChatGenerationReattach.mockClear()

    serverBootstrapState.response = {
      status: 'ok',
      projection: {
        revision: 9,
        database: {
          characters: [
            {
              chaId: 'char-a',
              name: 'Ada full',
              desc: 'Server-selected full row',
              chats: [{ id: 'chat-a', message: [] }],
              chatPage: 0,
            },
            {
              __serverCharacterShell: true,
              chaId: 'char-b',
              name: 'Babbage shell',
              chats: [{ id: 'chat-b', name: 'Chat B', message: [] }],
              chatPage: 0,
              chatFolders: [],
            },
          ],
          currentChar: 0,
          modules: [],
          personas: [],
          language: 'ko',
        },
      },
    }
    const subscription = serverEventsState.subscriptions[0]
    subscription.onCommandEvent({ type: 'chat.updated', revision: 9, resource: 'chat' })

    await vi.waitFor(() => {
      expect(get(selectedCharID)).toBe(0)
    })
    expect(DBState.db.language).toBe('ko')
    expect(DBState.db.characters[0]).toMatchObject({
      chaId: 'char-a',
      desc: 'Server-selected full row',
    })
    expect(DBState.db.characters[1]).toMatchObject({
      __serverCharacterShell: true,
      chaId: 'char-b',
    })
    expect(serverProjectionState.fetchResource).not.toHaveBeenCalled()
    expect(hydrationSpies.resetChatHydration).toHaveBeenCalled()
    expect(hydrationSpies.hydrateActiveChat).toHaveBeenCalledWith({ force: true })
    expect(hydrationSpies.hydrateActiveCharacterLorebook).toHaveBeenCalledWith({ force: true })
    expect(activeGenerationReattachSpies.triggerOpenChatGenerationReattach).toHaveBeenCalledTimes(1)
  })

  it('re-subscribes with a replay cursor after the event stream drops', async () => {
    vi.useFakeTimers()
    const randomSpy = vi.spyOn(Math, 'random').mockReturnValue(0.5)
    try {
      await loadWebInitialDatabase()
      expect(serverEventsState.subscribe).toHaveBeenCalledTimes(1)

      const subscription = serverEventsState.subscriptions[0]
      subscription.onError?.('stream dropped')

      await vi.advanceTimersByTimeAsync(1000)

      // Reconnected by asking the server to replay after the last applied revision.
      expect(serverEventsState.subscribe).toHaveBeenCalledTimes(2)
      expect(serverEventsState.subscriptions[1].sinceRevision).toBe(5)
      expect(serverBootstrapState.fetchReadOnly).not.toHaveBeenCalled()
      expect(peekCachedServerCommandRevision()).toBe(5)
    } finally {
      stopServerProjectionEvents()
      randomSpy.mockRestore()
      vi.useRealTimers()
    }
  })

  it('L45: calculates bounded jittered exponential reconnect delays', () => {
    expect(calculateServerProjectionReconnectDelayMs(0, () => 0.5)).toBe(1000)
    expect(calculateServerProjectionReconnectDelayMs(1, () => 0.5)).toBe(2000)
    expect(calculateServerProjectionReconnectDelayMs(2, () => 0.5)).toBe(4000)
    expect(calculateServerProjectionReconnectDelayMs(5, () => 0.5)).toBe(30000)
    expect(calculateServerProjectionReconnectDelayMs(10, () => 1)).toBe(30000)
    expect(calculateServerProjectionReconnectDelayMs(0, () => Number.NaN)).toBe(1000)
  })

  it('L45: keeps one pending reconnect timer for repeated stream failures', async () => {
    vi.useFakeTimers()
    const randomSpy = vi.spyOn(Math, 'random').mockReturnValue(0.5)
    try {
      await loadWebInitialDatabase()
      expect(serverEventsState.subscribe).toHaveBeenCalledTimes(1)

      const subscription = serverEventsState.subscriptions[0]
      subscription.onError?.('stream dropped')
      subscription.onClose?.()
      subscription.onError?.('still dropped')

      expect(vi.getTimerCount()).toBe(1)
      await vi.advanceTimersByTimeAsync(999)
      expect(serverEventsState.subscribe).toHaveBeenCalledTimes(1)

      await vi.advanceTimersByTimeAsync(1)

      expect(serverEventsState.subscribe).toHaveBeenCalledTimes(2)
      expect(serverEventsState.subscriptions[1].sinceRevision).toBe(5)
    } finally {
      stopServerProjectionEvents()
      randomSpy.mockRestore()
      vi.useRealTimers()
    }
  })

  it('L45: schedules increasing reconnect delays during a simulated outage', async () => {
    vi.useFakeTimers()
    const randomSpy = vi.spyOn(Math, 'random').mockReturnValue(0.5)
    try {
      await loadWebInitialDatabase()
      expect(serverEventsState.subscribe).toHaveBeenCalledTimes(1)

      const subscribeMock = serverEventsState.subscribe as any
      subscribeMock.mockImplementation(async (input: any) => {
        serverEventsState.subscriptions.push(input)
        return { status: 'error' as const, error: 'offline' }
      })

      serverEventsState.subscriptions[0].onClose?.()

      await vi.advanceTimersByTimeAsync(999)
      expect(serverEventsState.subscribe).toHaveBeenCalledTimes(1)
      await vi.advanceTimersByTimeAsync(1)
      expect(serverEventsState.subscribe).toHaveBeenCalledTimes(2)

      await vi.advanceTimersByTimeAsync(1999)
      expect(serverEventsState.subscribe).toHaveBeenCalledTimes(2)
      await vi.advanceTimersByTimeAsync(1)
      expect(serverEventsState.subscribe).toHaveBeenCalledTimes(3)

      await vi.advanceTimersByTimeAsync(3999)
      expect(serverEventsState.subscribe).toHaveBeenCalledTimes(3)
      await vi.advanceTimersByTimeAsync(1)
      expect(serverEventsState.subscribe).toHaveBeenCalledTimes(4)
    } finally {
      stopServerProjectionEvents()
      randomSpy.mockRestore()
      vi.useRealTimers()
    }
  })

  it('L45: resets reconnect backoff to the base delay after a successful subscribe', async () => {
    vi.useFakeTimers()
    const randomSpy = vi.spyOn(Math, 'random').mockReturnValue(0.5)
    try {
      await loadWebInitialDatabase()
      expect(serverEventsState.subscribe).toHaveBeenCalledTimes(1)

      const subscribeMock = serverEventsState.subscribe as any
      subscribeMock
        .mockImplementationOnce(async (input: any) => {
          serverEventsState.subscriptions.push(input)
          return { status: 'error' as const, error: 'offline' }
        })
        .mockImplementationOnce(async (input: any) => {
          serverEventsState.subscriptions.push(input)
          return { status: 'ok' as const, unsubscribe: serverEventsState.unsubscribe }
        })

      serverEventsState.subscriptions[0].onClose?.()
      await vi.advanceTimersByTimeAsync(1000)
      expect(serverEventsState.subscribe).toHaveBeenCalledTimes(2)

      await vi.advanceTimersByTimeAsync(1999)
      expect(serverEventsState.subscribe).toHaveBeenCalledTimes(2)
      await vi.advanceTimersByTimeAsync(1)
      expect(serverEventsState.subscribe).toHaveBeenCalledTimes(3)

      serverEventsState.subscriptions[2].onClose?.()
      await vi.advanceTimersByTimeAsync(999)
      expect(serverEventsState.subscribe).toHaveBeenCalledTimes(3)
      await vi.advanceTimersByTimeAsync(1)
      expect(serverEventsState.subscribe).toHaveBeenCalledTimes(4)
    } finally {
      stopServerProjectionEvents()
      randomSpy.mockRestore()
      vi.useRealTimers()
    }
  })

  it('L45: stop clears pending reconnect and resets the next outage to base delay', async () => {
    vi.useFakeTimers()
    const randomSpy = vi.spyOn(Math, 'random').mockReturnValue(0.5)
    try {
      await loadWebInitialDatabase()
      expect(serverEventsState.subscribe).toHaveBeenCalledTimes(1)

      const subscribeMock = serverEventsState.subscribe as any
      subscribeMock.mockImplementationOnce(async (input: any) => {
        serverEventsState.subscriptions.push(input)
        return { status: 'error' as const, error: 'offline' }
      })

      serverEventsState.subscriptions[0].onClose?.()
      await vi.advanceTimersByTimeAsync(1000)
      expect(serverEventsState.subscribe).toHaveBeenCalledTimes(2)

      stopServerProjectionEvents()
      await vi.advanceTimersByTimeAsync(30000)
      expect(serverEventsState.subscribe).toHaveBeenCalledTimes(2)

      await loadWebInitialDatabase()
      expect(serverEventsState.subscribe).toHaveBeenCalledTimes(3)

      serverEventsState.subscriptions[2].onClose?.()
      await vi.advanceTimersByTimeAsync(999)
      expect(serverEventsState.subscribe).toHaveBeenCalledTimes(3)
      await vi.advanceTimersByTimeAsync(1)
      expect(serverEventsState.subscribe).toHaveBeenCalledTimes(4)
    } finally {
      stopServerProjectionEvents()
      randomSpy.mockRestore()
      vi.useRealTimers()
    }
  })

  it('full-bootstraps when reconnect replay is unavailable', async () => {
    vi.useFakeTimers()
    const randomSpy = vi.spyOn(Math, 'random').mockReturnValue(0.5)
    try {
      await loadWebInitialDatabase()
      expect(serverEventsState.subscribe).toHaveBeenCalledTimes(1)
      const subscribeMock = serverEventsState.subscribe as any
      subscribeMock.mockImplementationOnce(async (input: any) => {
        serverEventsState.subscriptions.push(input)
        return {
          status: 'replay-unavailable' as const,
          error: 'event_replay_unavailable',
          currentRevision: 6,
        }
      })
      serverBootstrapState.response = {
        status: 'ok',
        projection: {
          revision: 6,
          database: { characters: [], modules: [], personas: [], language: 'ko' },
        },
      }

      const subscription = serverEventsState.subscriptions[0]
      const diagnosticsBefore = getProtocolDiagnosticsSnapshot()
      subscription.onClose?.()

      await vi.advanceTimersByTimeAsync(1000)

      await flushServerProjectionSync()
      expect(DBState.db.language).toBe('ko')
      expect(serverEventsState.subscribe).toHaveBeenCalledTimes(2)
      expect(serverBootstrapState.fetchReadOnly).toHaveBeenCalledTimes(1)
      expect(peekCachedServerCommandRevision()).toBe(6)
      expectFullBootstrapResyncDelta(diagnosticsBefore, 'event-replay-unavailable')

      await vi.advanceTimersByTimeAsync(1999)
      expect(serverEventsState.subscribe).toHaveBeenCalledTimes(2)
      await vi.advanceTimersByTimeAsync(1)

      expect(serverEventsState.subscribe).toHaveBeenCalledTimes(3)
      expect(serverBootstrapState.fetchReadOnly.mock.invocationCallOrder[0]).toBeLessThan(
        serverEventsState.subscribe.mock.invocationCallOrder[2],
      )
    } finally {
      stopServerProjectionEvents()
      randomSpy.mockRestore()
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
    expect(memoryJobEventSpies.publishServerMemoryJobEvent).toHaveBeenCalledWith({
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

  it('preserves the selected server character during Fastify-served startup', async () => {
    serverBootstrapState.response = {
      status: 'ok',
      projection: {
        revision: 5,
        database: {
          characters: [
            { chaId: 'char-a', name: 'Ada', chats: [{ id: 'chat-a', message: [] }], chatPage: 0 },
            {
              chaId: 'char-b',
              name: 'Babbage',
              chats: [{ id: 'chat-b', message: [] }],
              chatPage: 0,
            },
          ],
          currentChar: 1,
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

    expect(get(selectedCharID)).toBe(1)
    expect(hydrationSpies.startChatMessageHydration).toHaveBeenCalledTimes(1)
    expect(hydrationSpies.hydrateActiveChat).toHaveBeenCalledTimes(1)
  })

  it('seeds a missing server database before marking startup loaded', async () => {
    serverBootstrapState.response = {
      status: 'ok',
      projection: {
        revision: 0,
        database: null,
      },
    }
    serverBootstrapState.fetchReadOnly.mockResolvedValueOnce({
      status: 'ok',
      projection: {
        revision: 1,
        database: serverDefaultDatabase(),
      },
    })

    await loadData()

    expect(serverCommandsState.initialize).toHaveBeenCalledTimes(1)
    expect(serverCommandsState.initialize).toHaveBeenCalledWith()
    expect(serverBootstrapState.fetchReadOnly).toHaveBeenCalledTimes(1)
    expect(DBState.db).toMatchObject({
      characters: [],
      botPresets: [{ id: 'default-preset', name: 'Default' }],
      personas: [{ id: 'default-persona', name: 'User' }],
    })
    expect(peekCachedServerCommandRevision()).toBe(1)
    expect(get(loadedStore)).toBe(true)
  })

  it('keeps startup unloaded when a missing database cannot be seeded', async () => {
    serverBootstrapState.response = {
      status: 'ok',
      projection: {
        revision: 0,
        database: null,
      },
    }
    serverCommandsState.initialize.mockResolvedValue({
      status: 'error',
      error: 'write failed',
    })

    await loadData()

    expect(serverCommandsState.initialize).toHaveBeenCalledTimes(1)
    expect(get(loadedStore)).toBe(false)
  })
})
