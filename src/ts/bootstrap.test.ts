import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { get } from 'svelte/store'

const bootstrapApi = vi.hoisted(() => ({
  fetch: vi.fn(),
  fetchReadOnly: vi.fn(),
}))

const resourceApi = vi.hoisted(() => ({
  loadInitial: vi.fn(),
  refreshInvalidated: vi.fn(),
  forceRefresh: vi.fn(),
  hooks: { kind: 'resource-hooks' },
}))

const commandApi = vi.hoisted(() => ({
  initialize: vi.fn(),
  reconciler: null as null | ((event: any, events: any[], localEffects: ReadonlyMap<number, any>) => Promise<void>),
}))

const eventApi = vi.hoisted(() => ({
  subscriptions: [] as Array<{
    sinceRevision?: number | null
    onCommandEvent: (event: TestCommandEvent) => void
    onMemoryEvent?: (event: TestMemoryEvent) => void
    onError?: (error: string) => void
    onClose?: () => void
  }>,
  unsubscribe: vi.fn(),
  subscribe: vi.fn(),
}))

const hydrationApi = vi.hoisted(() => ({
  acknowledgeMessageMutationLocalEffect: vi.fn(() => true),
  applyMessageTranslationLocalEffect: vi.fn(() => true),
  hydrateActiveChat: vi.fn(async () => undefined),
  resetChatHydration: vi.fn(),
  startChatMessageHydration: vi.fn(),
}))

const lorebookApi = vi.hoisted(() => ({
  recordHydratedCharacterLorebooks: vi.fn(),
  resetLorebookHydration: vi.fn(),
}))

const runtimeApi = vi.hoisted(() => ({
  setActiveGenerationJobs: vi.fn(),
  startActiveGenerationReattach: vi.fn(),
  triggerOpenChatGenerationReattach: vi.fn(),
  setActiveMessageTranslations: vi.fn(),
  startActiveMessageTranslationRefresh: vi.fn(),
}))

const bridgeApi = vi.hoisted(() => ({ stop: vi.fn(), start: vi.fn() }))
const memoryApi = vi.hoisted(() => ({ publish: vi.fn(), applyProgress: vi.fn() }))

interface TestCommandEvent {
  type: string
  revision: number
  resource: string
  id?: string
  parentId?: string
  origin?: { writerSessionId: string }
}

interface TestMemoryEvent {
  type: 'memory.job'
  chatId: string
  job: { id: string; kind: string; status: string; attemptCount: number; maxAttempts: number }
  sideEffect?: { kind: 'hypav3_progress'; payload: unknown }
}

vi.mock('./server/bootstrap', () => ({
  fetchServerBootstrap: bootstrapApi.fetch,
  fetchServerBootstrapReadOnly: bootstrapApi.fetchReadOnly,
}))

vi.mock('./server/resourceInvalidation', () => ({
  loadInitialServerResources: resourceApi.loadInitial,
  refreshInvalidatedServerResources: resourceApi.refreshInvalidated,
}))

vi.mock('./server/resourceRefresh', () => ({
  forceServerResourceRefresh: resourceApi.forceRefresh,
  serverResourceInvalidationHooks: resourceApi.hooks,
}))

vi.mock('./server/events', () => ({ subscribeServerCommandEvents: eventApi.subscribe }))
vi.mock('./server/chatMessageHydration.svelte', () => hydrationApi)
vi.mock('./server/lorebookBridge.svelte', () => lorebookApi)
vi.mock('./server/bridgeFlush', () => ({
  startBridgePatchLifecycleFlush: bridgeApi.start,
}))
vi.mock('./process/reattach', () => ({
  setActiveGenerationJobs: runtimeApi.setActiveGenerationJobs,
  startActiveGenerationReattach: runtimeApi.startActiveGenerationReattach,
  triggerOpenChatGenerationReattach: runtimeApi.triggerOpenChatGenerationReattach,
}))
vi.mock('./server/messageTranslationJobs', () => ({
  setActiveMessageTranslations: runtimeApi.setActiveMessageTranslations,
  startActiveMessageTranslationRefresh: runtimeApi.startActiveMessageTranslationRefresh,
}))
vi.mock('./server/memoryJobEvents', () => ({ publishServerMemoryJobEvent: memoryApi.publish }))
vi.mock('./process/request/serverMemory', () => ({ applyServerHypaV3Progress: memoryApi.applyProgress }))

vi.mock('./server/commands', async (importActual) => {
  const actual = await importActual<typeof import('./server/commands')>()
  return {
    ...actual,
    initializeServerDatabase: commandApi.initialize,
    setServerCommandSuccessReconciler: (reconciler: typeof commandApi.reconciler) => {
      commandApi.reconciler = reconciler
      actual.setServerCommandSuccessReconciler(reconciler)
    },
  }
})

vi.mock('./plugins/plugins.svelte', () => ({ loadPlugins: vi.fn(async () => undefined) }))
vi.mock('./alert', () => ({
  alertError: vi.fn(),
  alertMd: vi.fn(),
  alertTOS: vi.fn(async () => true),
  waitAlert: vi.fn(async () => undefined),
}))
vi.mock('./gui/animation', () => ({ updateAnimationSpeed: vi.fn() }))
vi.mock('./gui/colorscheme', () => ({ updateColorScheme: vi.fn(), updateTextThemeAndCSS: vi.fn() }))
vi.mock('./gui/guisize', () => ({ updateGuisize: vi.fn() }))
vi.mock('./observer.svelte', () => ({ startObserveDom: vi.fn() }))
vi.mock('./process/modules', () => ({
  getModuleAssets: vi.fn(() => []),
  getModuleLorebooks: vi.fn(() => []),
  getModules: vi.fn(() => []),
  moduleUpdate: vi.fn(),
}))
vi.mock('./model/modellist', () => ({
  getModelInfo: vi.fn(() => ({ type: 'chat' })),
  registerModelDynamic: vi.fn(),
}))
vi.mock('./server/pushNotifications', () => ({ enableChatCompletionPushNotifications: vi.fn() }))

import {
  calculateServerResourceReconnectDelayMs,
  createGlobalErrorHandlers,
  loadWebInitialDatabase,
  stopServerResourceEvents,
} from './bootstrap'
import { alertError } from './alert'
import {
  clearAppliedServerResourceRevision,
  clearCachedServerCommandRevision,
  peekAppliedServerResourceRevision,
  peekCachedServerCommandRevision,
} from './server/commands'
import { getDatabase, setResourceWriteGuardEnabled, withTrustedResourceWrite } from './storage/database.svelte'
import { replaceResourceDatabase, resetServerResourceState } from './server/resourceState.svelte'
import { selectedCharID } from './stores.svelte'

function runtimeBootstrap(overrides: Record<string, unknown> = {}) {
  return {
    status: 'ok' as const,
    bootstrap: {
      initialized: true,
      revision: 4,
      activeGenerationJobs: [{ chatId: 'chat-a', jobId: 'job-a' }],
      activeMessageTranslations: [{ chatId: 'chat-a', messageId: 'message-a' }],
      ...overrides,
    },
  }
}

function seedResourceDatabase() {
  replaceResourceDatabase(
    {
      characters: [
        {
          type: 'character',
          chaId: 'char-a',
          name: 'Ada',
          chatPage: 0,
          chats: [{ id: 'chat-a', message: [] }],
        },
        {
          type: 'character',
          chaId: 'char-b',
          name: 'Bea',
          chatPage: 0,
          chats: [{ id: 'chat-b', message: [] }],
        },
      ],
      characterOrder: ['char-a', 'char-b'],
      currentChar: 1,
      modules: [],
      personas: [],
      botPresets: [],
      language: 'en',
    } as never,
    5,
  )
}

beforeEach(() => {
  stopServerResourceEvents()
  setResourceWriteGuardEnabled(false)
  resetServerResourceState()
  seedResourceDatabase()
  selectedCharID.set(-1)
  clearCachedServerCommandRevision()
  clearAppliedServerResourceRevision()

  vi.clearAllMocks()
  eventApi.subscriptions = []
  bridgeApi.start.mockReturnValue(bridgeApi.stop)
  bootstrapApi.fetch.mockResolvedValue(runtimeBootstrap())
  bootstrapApi.fetchReadOnly.mockResolvedValue(runtimeBootstrap({ revision: 5 }))
  resourceApi.loadInitial.mockResolvedValue({ status: 'ok', revision: 5, scope: 'full' })
  resourceApi.refreshInvalidated.mockImplementation(async (events: TestCommandEvent | TestCommandEvent[]) => {
    const batch = Array.isArray(events) ? events : [events]
    return { status: 'ok', revision: batch.at(-1)?.revision ?? 5, scope: 'targeted' }
  })
  resourceApi.forceRefresh.mockResolvedValue({ status: 'ok', revision: 9 })
  commandApi.initialize.mockResolvedValue({ status: 'ok', revision: 1, initialized: true })
  eventApi.subscribe.mockImplementation(async (input) => {
    eventApi.subscriptions.push(input)
    return { status: 'ok', unsubscribe: eventApi.unsubscribe }
  })
})

afterEach(() => {
  stopServerResourceEvents()
  vi.useRealTimers()
  vi.restoreAllMocks()
})

describe('API-backed client bootstrap', () => {
  it('loads resource APIs, seeds the resource revision, and starts runtime services', async () => {
    await loadWebInitialDatabase()

    expect(bootstrapApi.fetch).toHaveBeenCalledTimes(1)
    expect(resourceApi.loadInitial).toHaveBeenCalledWith({ hooks: resourceApi.hooks })
    expect(peekCachedServerCommandRevision()).toBe(5)
    expect(peekAppliedServerResourceRevision()).toBe(5)
    expect(get(selectedCharID)).toBe(1)
    expect(runtimeApi.setActiveGenerationJobs).toHaveBeenCalledWith([{ chatId: 'chat-a', jobId: 'job-a' }])
    expect(runtimeApi.setActiveMessageTranslations).toHaveBeenCalledWith([{ chatId: 'chat-a', messageId: 'message-a' }])
    expect(hydrationApi.startChatMessageHydration).toHaveBeenCalledTimes(1)
    expect(eventApi.subscriptions[0]?.sinceRevision).toBe(5)
  })

  it('initializes a fresh server, refetches runtime metadata, then loads resources', async () => {
    bootstrapApi.fetch.mockResolvedValue(runtimeBootstrap({ initialized: false, revision: 0 }))
    bootstrapApi.fetchReadOnly.mockResolvedValue(runtimeBootstrap({ initialized: true, revision: 1 }))

    await loadWebInitialDatabase()

    expect(commandApi.initialize).toHaveBeenCalledTimes(1)
    expect(bootstrapApi.fetchReadOnly).toHaveBeenCalledTimes(1)
    expect(resourceApi.loadInitial).toHaveBeenCalledTimes(1)
  })

  it('rejects unavailable bootstrap and failed resource reads without starting events', async () => {
    bootstrapApi.fetch.mockResolvedValueOnce({ status: 'unavailable' })
    await expect(loadWebInitialDatabase()).rejects.toThrow('Server bootstrap is unavailable')
    expect(eventApi.subscribe).not.toHaveBeenCalled()

    bootstrapApi.fetch.mockResolvedValueOnce(runtimeBootstrap())
    resourceApi.loadInitial.mockResolvedValueOnce({ status: 'error', error: 'settings failed' })
    await expect(loadWebInitialDatabase()).rejects.toThrow('Server resource load failed: settings failed')
    expect(eventApi.subscribe).not.toHaveBeenCalled()
  })

  it('refreshes the targeted API resources for a contiguous command event', async () => {
    await loadWebInitialDatabase()
    const event = { type: 'persona.updated', revision: 6, resource: 'persona', id: 'persona-a' }
    eventApi.subscriptions[0].onCommandEvent(event)

    await vi.waitFor(() => expect(resourceApi.refreshInvalidated).toHaveBeenCalledTimes(1))
    expect(resourceApi.refreshInvalidated).toHaveBeenCalledWith([event], {
      appliedRevision: 5,
      hooks: resourceApi.hooks,
    })
    await vi.waitFor(() => expect(peekAppliedServerResourceRevision()).toBe(6))
  })

  it('applies contiguous generation-settings command effects without a resource read and preserves a newer edit', async () => {
    await loadWebInitialDatabase()
    const attemptedA = {
      configured: true,
      jailbreakToggle: false,
      sidebarToggles: { mode: '0', stale: '1' },
    }
    const canonicalA = {
      configured: true,
      jailbreakToggle: false,
      sidebarToggles: { mode: '0' },
    }
    const attemptedB = {
      configured: true,
      jailbreakToggle: true,
      sidebarToggles: { mode: '1', stale: '1' },
    }
    const canonicalB = {
      configured: true,
      jailbreakToggle: true,
      sidebarToggles: { mode: '1' },
    }
    withTrustedResourceWrite(() => {
      getDatabase().characters[0].chats[0].generationSettings = attemptedB
    })

    const eventA = {
      type: 'chat.updated',
      revision: 6,
      resource: 'characterRow',
      id: 'chat-a',
      parentId: 'char-a',
    }
    await commandApi.reconciler?.(
      eventA,
      [eventA],
      new Map([
        [
          6,
          {
            kind: 'chatGenerationSettings',
            chatId: 'chat-a',
            characterId: 'char-a',
            attemptedGenerationSettings: attemptedA,
            generationSettings: canonicalA,
          },
        ],
      ]),
    )

    expect(resourceApi.refreshInvalidated).not.toHaveBeenCalled()
    expect(getDatabase().characters[0].chats[0].generationSettings).toEqual(attemptedB)
    expect(peekAppliedServerResourceRevision()).toBe(6)

    const eventB = { ...eventA, revision: 7 }
    await commandApi.reconciler?.(
      eventB,
      [eventB],
      new Map([
        [
          7,
          {
            kind: 'chatGenerationSettings',
            chatId: 'chat-a',
            characterId: 'char-a',
            attemptedGenerationSettings: attemptedB,
            generationSettings: canonicalB,
          },
        ],
      ]),
    )

    expect(resourceApi.refreshInvalidated).not.toHaveBeenCalled()
    expect(getDatabase().characters[0].chats[0].generationSettings).toEqual(canonicalB)
    expect(peekAppliedServerResourceRevision()).toBe(7)
  })

  it('acknowledges a contiguous settings patch without re-reading its group', async () => {
    await loadWebInitialDatabase()
    withTrustedResourceWrite(() => {
      getDatabase().theme = 'LIGHT'
    })
    const event = {
      type: 'settings.updated',
      revision: 6,
      resource: 'settings',
      id: 'display',
    }

    await commandApi.reconciler?.(
      event,
      [event],
      new Map([
        [
          6,
          {
            kind: 'settingsPatch',
            group: 'display',
            attemptedPatch: { theme: 'LIGHT' },
            settings: { theme: 'light' },
          },
        ],
      ]),
    )

    expect(resourceApi.refreshInvalidated).not.toHaveBeenCalled()
    expect(getDatabase().theme).toBe('light')
    expect(peekAppliedServerResourceRevision()).toBe(6)
  })

  it('acknowledges contiguous optimistic plugin storage without fetching the full map', async () => {
    await loadWebInitialDatabase()
    withTrustedResourceWrite(() => {
      getDatabase().pluginCustomStorage = { local: { nested: true } }
    })
    const event = {
      type: 'pluginStorage.updated',
      revision: 6,
      resource: 'pluginStorage',
      id: 'local',
    }

    await commandApi.reconciler?.(
      event,
      [event],
      new Map([[6, { kind: 'pluginStorage', operation: 'put', key: 'local' }]]),
    )

    expect(resourceApi.refreshInvalidated).not.toHaveBeenCalled()
    expect(getDatabase().pluginCustomStorage).toEqual({ local: { nested: true } })
    expect(peekAppliedServerResourceRevision()).toBe(6)
  })

  it('applies a contiguous canonical message translation without fetching the transcript', async () => {
    await loadWebInitialDatabase()
    const translation = {
      source: 'raw',
      text: 'translated',
      sourceHash: 'a'.repeat(64),
      targetLanguage: 'ko',
      inputLanguage: 'en',
      translatorType: 'llm',
      settingsHash: 'b'.repeat(64),
      updatedAt: 123,
    }
    const event = {
      type: 'message.updated',
      revision: 6,
      resource: 'message',
      id: 'message-a',
      parentId: 'chat-a',
    }

    await commandApi.reconciler?.(
      event,
      [event],
      new Map([
        [
          6,
          {
            kind: 'messageTranslation',
            chatId: 'chat-a',
            messageId: 'message-a',
            translation,
          },
        ],
      ]),
    )

    expect(resourceApi.refreshInvalidated).not.toHaveBeenCalled()
    expect(hydrationApi.applyMessageTranslationLocalEffect).toHaveBeenCalledWith('chat-a', 'message-a', translation)
    expect(peekAppliedServerResourceRevision()).toBe(6)
  })

  it('acknowledges a contiguous optimistic message append without fetching the transcript', async () => {
    await loadWebInitialDatabase()
    const event = {
      type: 'message.appended',
      revision: 6,
      resource: 'message',
      id: 'message-a',
      parentId: 'chat-a',
    }

    await commandApi.reconciler?.(
      event,
      [event],
      new Map([
        [
          6,
          {
            kind: 'messageMutation',
            operation: 'append',
            chatId: 'chat-a',
            messageId: 'message-a',
          },
        ],
      ]),
    )

    expect(resourceApi.refreshInvalidated).not.toHaveBeenCalled()
    expect(hydrationApi.acknowledgeMessageMutationLocalEffect).toHaveBeenCalledWith('chat-a')
    expect(peekAppliedServerResourceRevision()).toBe(6)
  })

  it('acknowledges a contiguous character patch without a resource read and preserves a newer edit', async () => {
    await loadWebInitialDatabase()
    withTrustedResourceWrite(() => {
      getDatabase().characters[0].name = 'Newer queued edit'
    })
    const event = {
      type: 'character.updated',
      revision: 6,
      resource: 'characterRow',
      id: 'char-a',
    }

    await commandApi.reconciler?.(
      event,
      [event],
      new Map([
        [
          6,
          {
            kind: 'characterPatch',
            characterId: 'char-a',
            patch: { name: 'Accepted edit' },
          },
        ],
      ]),
    )

    expect(resourceApi.refreshInvalidated).not.toHaveBeenCalled()
    expect(getDatabase().characters[0].name).toBe('Newer queued edit')
    expect(peekAppliedServerResourceRevision()).toBe(6)
  })

  it('acknowledges a contiguous character selection without replacing a newer selection', async () => {
    await loadWebInitialDatabase()
    withTrustedResourceWrite(() => {
      getDatabase().characters[0].lastInteraction = 200
    })
    const event = {
      type: 'character.selected',
      revision: 6,
      resource: 'characterSelection',
      id: 'char-a',
    }

    await commandApi.reconciler?.(
      event,
      [event],
      new Map([
        [
          6,
          {
            kind: 'characterSelection',
            characterId: 'char-a',
            lastInteraction: 100,
          },
        ],
      ]),
    )

    expect(resourceApi.refreshInvalidated).not.toHaveBeenCalled()
    expect((getDatabase() as unknown as { currentChar: number }).currentChar).toBe(1)
    expect(getDatabase().characters[0].lastInteraction).toBe(200)
    expect(peekAppliedServerResourceRevision()).toBe(6)
  })

  it('acknowledges a contiguous chat selection without replacing a newer selection', async () => {
    await loadWebInitialDatabase()
    withTrustedResourceWrite(() => {
      getDatabase().characters[0].chats.push({ id: 'chat-newer', message: [] } as never)
      getDatabase().characters[0].chatPage = 1
    })
    const event = {
      type: 'chat.updated',
      revision: 6,
      resource: 'characterRow',
      id: 'chat-a',
      parentId: 'char-a',
    }

    await commandApi.reconciler?.(
      event,
      [event],
      new Map([
        [
          6,
          {
            kind: 'chatPatch',
            characterId: 'char-a',
            chatId: 'chat-a',
            patch: {},
            select: true,
          },
        ],
      ]),
    )

    expect(resourceApi.refreshInvalidated).not.toHaveBeenCalled()
    expect(getDatabase().characters[0].chatPage).toBe(1)
    expect(peekAppliedServerResourceRevision()).toBe(6)
  })

  it('uses a full resource result revision and invalidates chat hydration after a gap', async () => {
    await loadWebInitialDatabase()
    resourceApi.refreshInvalidated.mockResolvedValueOnce({ status: 'ok', revision: 12, scope: 'full' })
    eventApi.subscriptions[0].onCommandEvent({ type: 'state.changed', revision: 9, resource: 'state' })

    await vi.waitFor(() => expect(peekAppliedServerResourceRevision()).toBe(12))
    expect(hydrationApi.resetChatHydration).toHaveBeenCalledTimes(2)
    expect(hydrationApi.hydrateActiveChat).toHaveBeenCalledWith({ force: true })
    expect(runtimeApi.triggerOpenChatGenerationReattach).toHaveBeenCalledTimes(1)
  })

  it('does not advance the applied cursor when an invalidation read fails', async () => {
    await loadWebInitialDatabase()
    resourceApi.refreshInvalidated.mockResolvedValueOnce({ status: 'error', error: 'network down' })
    eventApi.subscriptions[0].onCommandEvent({ type: 'persona.updated', revision: 6, resource: 'persona' })

    await vi.waitFor(() => expect(resourceApi.refreshInvalidated).toHaveBeenCalledTimes(1))
    expect(peekAppliedServerResourceRevision()).toBe(5)
  })

  it('repairs replay and malformed-frame failures through a complete resource refresh', async () => {
    eventApi.subscribe.mockResolvedValueOnce({ status: 'replay-unavailable', currentRevision: 9 })
    await loadWebInitialDatabase()
    await vi.waitFor(() => expect(resourceApi.forceRefresh).toHaveBeenCalledWith('event-replay-unavailable'))

    stopServerResourceEvents()
    eventApi.subscribe.mockImplementationOnce(async (input) => {
      eventApi.subscriptions.push(input)
      return { status: 'ok', unsubscribe: eventApi.unsubscribe }
    })
    await loadWebInitialDatabase()
    eventApi.subscriptions.at(-1)?.onError?.('Malformed command event frame: bad JSON')
    await vi.waitFor(() => expect(resourceApi.forceRefresh).toHaveBeenCalledWith('malformed-command-event'))
  })

  it('publishes memory events without refreshing durable resources', async () => {
    await loadWebInitialDatabase()
    const event: TestMemoryEvent = {
      type: 'memory.job',
      chatId: 'chat-a',
      job: { id: 'job-a', kind: 'hypav3', status: 'running', attemptCount: 1, maxAttempts: 3 },
      sideEffect: { kind: 'hypav3_progress', payload: { progress: 0.5 } },
    }
    eventApi.subscriptions[0].onMemoryEvent?.(event)

    expect(memoryApi.applyProgress).toHaveBeenCalledWith({ progress: 0.5 })
    expect(memoryApi.publish).toHaveBeenCalledWith(event)
    expect(resourceApi.refreshInvalidated).not.toHaveBeenCalled()
  })

  it('stops the resource event subscription and bridge flush', async () => {
    await loadWebInitialDatabase()
    stopServerResourceEvents()
    expect(eventApi.unsubscribe).toHaveBeenCalledTimes(1)
    expect(bridgeApi.stop).toHaveBeenCalledTimes(1)
  })
})

describe('resource event reconnect backoff', () => {
  it('L45: schedules increasing reconnect delays during a simulated outage', async () => {
    vi.useFakeTimers()
    vi.spyOn(Math, 'random').mockReturnValue(0.5)
    eventApi.subscribe.mockImplementation(async (input) => {
      eventApi.subscriptions.push(input)
      if (eventApi.subscriptions.length === 1) {
        return { status: 'ok', unsubscribe: eventApi.unsubscribe }
      }
      return { status: 'error', error: 'offline' }
    })

    await loadWebInitialDatabase()
    eventApi.subscriptions[0].onClose?.()

    await vi.advanceTimersByTimeAsync(999)
    expect(eventApi.subscribe).toHaveBeenCalledTimes(1)
    await vi.advanceTimersByTimeAsync(1)
    expect(eventApi.subscribe).toHaveBeenCalledTimes(2)
    await vi.advanceTimersByTimeAsync(1_999)
    expect(eventApi.subscribe).toHaveBeenCalledTimes(2)
    await vi.advanceTimersByTimeAsync(1)
    expect(eventApi.subscribe).toHaveBeenCalledTimes(3)
  })

  it('L45: keeps one pending reconnect timer for repeated stream failures', async () => {
    vi.useFakeTimers()
    vi.spyOn(Math, 'random').mockReturnValue(0.5)

    await loadWebInitialDatabase()
    eventApi.subscriptions[0].onClose?.()
    eventApi.subscriptions[0].onClose?.()
    await vi.advanceTimersByTimeAsync(1_000)

    expect(eventApi.subscribe).toHaveBeenCalledTimes(2)
  })

  it('L45: resets reconnect backoff to the base delay after a successful subscribe', async () => {
    vi.useFakeTimers()
    vi.spyOn(Math, 'random').mockReturnValue(0.5)

    await loadWebInitialDatabase()
    eventApi.subscriptions[0].onClose?.()
    await vi.advanceTimersByTimeAsync(1_000)
    expect(eventApi.subscribe).toHaveBeenCalledTimes(2)

    eventApi.subscriptions[1].onClose?.()
    await vi.advanceTimersByTimeAsync(999)
    expect(eventApi.subscribe).toHaveBeenCalledTimes(2)
    await vi.advanceTimersByTimeAsync(1)
    expect(eventApi.subscribe).toHaveBeenCalledTimes(3)
  })

  it('L45: stop clears pending reconnect and resets the next outage to base delay', async () => {
    vi.useFakeTimers()
    vi.spyOn(Math, 'random').mockReturnValue(0.5)

    await loadWebInitialDatabase()
    eventApi.subscriptions[0].onClose?.()
    stopServerResourceEvents()
    await vi.advanceTimersByTimeAsync(30_000)
    expect(eventApi.subscribe).toHaveBeenCalledTimes(1)

    await loadWebInitialDatabase()
    eventApi.subscriptions[1].onClose?.()
    await vi.advanceTimersByTimeAsync(999)
    expect(eventApi.subscribe).toHaveBeenCalledTimes(2)
    await vi.advanceTimersByTimeAsync(1)
    expect(eventApi.subscribe).toHaveBeenCalledTimes(3)
  })

  it('uses capped exponential delay with bounded jitter', () => {
    expect(calculateServerResourceReconnectDelayMs(0, () => 0.5)).toBe(1000)
    expect(calculateServerResourceReconnectDelayMs(1, () => 0.5)).toBe(2000)
    expect(calculateServerResourceReconnectDelayMs(2, () => 0.5)).toBe(4000)
    expect(calculateServerResourceReconnectDelayMs(5, () => 0.5)).toBe(30000)
    expect(calculateServerResourceReconnectDelayMs(10, () => 1)).toBe(30000)
    expect(calculateServerResourceReconnectDelayMs(0, () => Number.NaN)).toBe(1000)
  })
})

describe('global bootstrap error handlers', () => {
  it('L37/I21: global handlers ignore null error events and undefined rejections without useless alerts', () => {
    const { errorHandler, rejectHandler } = createGlobalErrorHandlers()

    errorHandler(new ErrorEvent('error'))
    rejectHandler({ reason: undefined } as PromiseRejectionEvent)

    expect(alertError).not.toHaveBeenCalled()
  })

  it('L37: resource-target global errors skip generic application alerts', () => {
    const { errorHandler } = createGlobalErrorHandlers()
    const event = new ErrorEvent('error', { error: new Error('asset failed') })
    Object.defineProperty(event, 'target', { value: document.createElement('img') })

    errorHandler(event)

    expect(alertError).not.toHaveBeenCalled()
  })

  it('L37: useful global Error objects and message strings still alert', () => {
    const { errorHandler, rejectHandler } = createGlobalErrorHandlers()
    const error = new Error('useful error')

    errorHandler(new ErrorEvent('error', { error }))
    rejectHandler({ reason: 'useful rejection' } as PromiseRejectionEvent)

    expect(alertError).toHaveBeenNthCalledWith(1, error)
    expect(alertError).toHaveBeenNthCalledWith(2, 'useful rejection')
  })
})
