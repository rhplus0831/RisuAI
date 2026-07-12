import { beforeEach, describe, expect, it, vi } from 'vitest'
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

const commandApi = vi.hoisted(() => ({ initialize: vi.fn() }))

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
  return { ...actual, initializeServerDatabase: commandApi.initialize }
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

import { calculateServerResourceReconnectDelayMs, loadWebInitialDatabase, stopServerResourceEvents } from './bootstrap'
import {
  clearAppliedServerProjectionRevision,
  clearCachedServerCommandRevision,
  peekAppliedServerProjectionRevision,
  peekCachedServerCommandRevision,
} from './server/commands'
import { setServerProjectionWriteGuardEnabled } from './storage/database.svelte'
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
  setServerProjectionWriteGuardEnabled(false)
  resetServerResourceState()
  seedResourceDatabase()
  selectedCharID.set(-1)
  clearCachedServerCommandRevision()
  clearAppliedServerProjectionRevision()

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

describe('API-backed client bootstrap', () => {
  it('loads resource APIs, seeds the resource revision, and starts runtime services', async () => {
    await loadWebInitialDatabase()

    expect(bootstrapApi.fetch).toHaveBeenCalledTimes(1)
    expect(resourceApi.loadInitial).toHaveBeenCalledWith({ hooks: resourceApi.hooks })
    expect(peekCachedServerCommandRevision()).toBe(5)
    expect(peekAppliedServerProjectionRevision()).toBe(5)
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
    await vi.waitFor(() => expect(peekAppliedServerProjectionRevision()).toBe(6))
  })

  it('uses a full resource result revision and invalidates chat hydration after a gap', async () => {
    await loadWebInitialDatabase()
    resourceApi.refreshInvalidated.mockResolvedValueOnce({ status: 'ok', revision: 12, scope: 'full' })
    eventApi.subscriptions[0].onCommandEvent({ type: 'state.changed', revision: 9, resource: 'state' })

    await vi.waitFor(() => expect(peekAppliedServerProjectionRevision()).toBe(12))
    expect(hydrationApi.resetChatHydration).toHaveBeenCalledTimes(2)
    expect(hydrationApi.hydrateActiveChat).toHaveBeenCalledWith({ force: true })
    expect(runtimeApi.triggerOpenChatGenerationReattach).toHaveBeenCalledTimes(1)
  })

  it('does not advance the applied cursor when an invalidation read fails', async () => {
    await loadWebInitialDatabase()
    resourceApi.refreshInvalidated.mockResolvedValueOnce({ status: 'error', error: 'network down' })
    eventApi.subscriptions[0].onCommandEvent({ type: 'persona.updated', revision: 6, resource: 'persona' })

    await vi.waitFor(() => expect(resourceApi.refreshInvalidated).toHaveBeenCalledTimes(1))
    expect(peekAppliedServerProjectionRevision()).toBe(5)
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
  it('uses capped exponential delay with bounded jitter', () => {
    expect(calculateServerResourceReconnectDelayMs(0, () => 0.5)).toBe(1000)
    expect(calculateServerResourceReconnectDelayMs(1, () => 0.5)).toBe(2000)
    expect(calculateServerResourceReconnectDelayMs(2, () => 0.5)).toBe(4000)
    expect(calculateServerResourceReconnectDelayMs(5, () => 0.5)).toBe(30000)
    expect(calculateServerResourceReconnectDelayMs(10, () => 1)).toBe(30000)
    expect(calculateServerResourceReconnectDelayMs(0, () => Number.NaN)).toBe(1000)
  })
})
