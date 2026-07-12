import { get } from 'svelte/store'
import { getDatabase, setServerProjectionWriteGuardEnabled, type Database } from './storage/database.svelte'
import { botMakerMode, selectedCharID, loadedStore, LoadingStatusState } from './stores.svelte'
import { loadPlugins } from './plugins/plugins.svelte'
import { alertError, alertMd, alertTOS, waitAlert } from './alert'
import { updateAnimationSpeed } from './gui/animation'
import { updateColorScheme, updateTextThemeAndCSS } from './gui/colorscheme'
import { language } from 'src/lang'
import { startObserveDom } from './observer.svelte'
import { updateGuisize } from './gui/guisize'
import { moduleUpdate } from './process/modules'
import { registerModelDynamic } from './model/modellist'
import { fetchServerBootstrap, fetchServerBootstrapReadOnly, type ServerBootstrapRuntime } from './server/bootstrap'
import { subscribeServerCommandEvents, type ServerMemoryEvent } from './server/events'
import { publishServerMemoryJobEvent } from './server/memoryJobEvents'
import {
  canUseServerCommands,
  deferOwnServerCommandReconciliation,
  initializeServerDatabase,
  peekAppliedServerProjectionRevision,
  peekCachedServerCommandRevision,
  setAppliedServerProjectionRevision,
  setCachedServerCommandRevision,
  setServerCommandSuccessReconciler,
  type CommandEvent,
} from './server/commands'
import { peekActiveWriterSessionId } from './server/activeWriterSession'
import { startBridgePatchLifecycleFlush } from './server/bridgeFlush'
import { hydrateActiveChat, resetChatHydration, startChatMessageHydration } from './server/chatMessageHydration.svelte'
import { recordHydratedCharacterLorebooks, resetLorebookHydration } from './server/lorebookBridge.svelte'
import {
  setActiveGenerationJobs,
  startActiveGenerationReattach,
  triggerOpenChatGenerationReattach,
} from './process/reattach'
import { setActiveMessageTranslations, startActiveMessageTranslationRefresh } from './server/messageTranslationJobs'
import { applyServerHypaV3Progress } from './process/request/serverMemory'
import { shouldAcceptMemoryJobUpdate } from './server/memoryJobOrdering'
import { enableChatCompletionPushNotifications } from './server/pushNotifications'
import { loadInitialServerResources, refreshInvalidatedServerResources } from './server/resourceInvalidation'
import { forceServerResourceRefresh, serverResourceInvalidationHooks } from './server/resourceRefresh'

const SERVER_RESOURCE_RECONNECT_BASE_DELAY_MS = 1000
const SERVER_RESOURCE_RECONNECT_MAX_DELAY_MS = 30_000
const SERVER_RESOURCE_RECONNECT_JITTER_RATIO = 0.2

let serverResourceEventSubscription: { unsubscribe: () => void } | null = null
let stopBridgePatchLifecycleFlush: (() => void) | null = null
// Serializes resource invalidation so the applied revision cursor advances in
// command-event order.
let serverResourceSyncChain: Promise<void> = Promise.resolve()
let serverResourceEventsDesired = false
let serverResourceReconnectTimer: ReturnType<typeof setTimeout> | null = null
let serverResourceReconnectAttempt = 0

function initialSelectedCharFromDatabase(db: Database): number {
  const currentChar = (db as { currentChar?: unknown }).currentChar
  const characterCount = Array.isArray(db.characters) ? db.characters.length : 0
  if (Number.isInteger(currentChar) && (currentChar as number) >= 0 && (currentChar as number) < characterCount) {
    return currentChar as number
  }
  return -1
}

/**
 * Loads the application data.
 */
export async function loadData() {
  const loaded = get(loadedStore)
  if (!loaded) {
    try {
      await loadWebInitialDatabase()
      const db = getDatabase()
      if (db.notification === true) {
        void enableChatCompletionPushNotifications()
      }
      LoadingStatusState.text = 'Loading Plugins...'
      try {
        await loadPlugins()
      } catch (error) {}
      LoadingStatusState.text = 'Checking For Format Update...'

      LoadingStatusState.text = 'Updating States...'
      updateColorScheme()
      updateTextThemeAndCSS()
      updateAnimationSpeed()
      updateHeightMode()
      updateErrorHandling()
      updateGuisize()
      if (!localStorage.getItem('nightlyWarned') && window.location.hostname === 'nightly.risuai.xyz') {
        alertMd(language.nightlyWarning)
        await waitAlert()
        //for testing, leave empty
        localStorage.setItem('nightlyWarned', '')
      }
      if (db.botSettingAtStart) {
        botMakerMode.set(true)
      }
      loadedStore.set(true)
      selectedCharID.set(initialSelectedCharFromDatabase(db))
      startObserveDom()
      registerModelDynamic()
      moduleUpdate()
      alertTOS().then((a) => {
        if (a === false) {
          location.reload()
        }
      })
    } catch (error) {
      alertError(error)
    }
  }
}

export async function loadWebInitialDatabase() {
  LoadingStatusState.text = 'Loading Server Data...'
  const firstBootstrap = await fetchServerBootstrap()
  if (firstBootstrap.status !== 'ok') {
    throw new Error(firstBootstrap.status === 'unavailable' ? 'Server bootstrap is unavailable' : firstBootstrap.error)
  }
  const runtime = firstBootstrap.bootstrap.initialized
    ? firstBootstrap.bootstrap
    : await initializeFreshServerDatabase()

  const resources = await loadInitialServerResources({ hooks: serverResourceInvalidationHooks })
  if (resources.status !== 'ok') {
    throw new Error(
      resources.status === 'unavailable'
        ? 'Server resource APIs are unavailable'
        : `Server resource load failed: ${resources.error}`,
    )
  }

  const database = getDatabase()
  selectedCharID.set(initialSelectedCharFromDatabase(database))
  resetChatHydration()
  resetLorebookHydration()
  recordHydratedCharacterLorebooks(database.characters)
  setCachedServerCommandRevision(resources.revision)
  setAppliedServerProjectionRevision(resources.revision)
  setServerCommandSuccessReconciler((event, coalescedEvents) =>
    enqueueServerResourceSync(() => processServerCommandEvents(coalescedEvents.length > 0 ? coalescedEvents : [event])),
  )
  setServerProjectionWriteGuardEnabled(true)
  setActiveGenerationJobs(runtime.activeGenerationJobs ?? [])
  setActiveMessageTranslations(runtime.activeMessageTranslations ?? [])
  startActiveMessageTranslationRefresh()
  startActiveGenerationReattach()
  startChatMessageHydration()
  void hydrateActiveChat()
  stopBridgePatchLifecycleFlush?.()
  stopBridgePatchLifecycleFlush = startBridgePatchLifecycleFlush()
  await startServerResourceEvents()
}

/**
 * One-time first-run seed. Bootstrap reports only whether SQLite has been
 * initialized; all durable data is subsequently loaded through resource APIs.
 */
async function initializeFreshServerDatabase(): Promise<ServerBootstrapRuntime> {
  if (!canUseServerCommands()) {
    throw new Error('Initial server database seed failed: server commands unavailable')
  }

  const result = await initializeServerDatabase()
  if (result.status === 'ok') {
    setCachedServerCommandRevision(result.revision)
    const bootstrap = await fetchServerBootstrapReadOnly()
    if (bootstrap.status !== 'ok') {
      throw new Error(bootstrap.status === 'unavailable' ? 'Server bootstrap is unavailable' : bootstrap.error)
    }
    if (!bootstrap.bootstrap.initialized) {
      throw new Error('Initial server database seed failed: server is still uninitialized')
    }
    return bootstrap.bootstrap
  }

  throw new Error(`Initial server database seed failed: ${serverCommandFailureMessage(result)}`)
}

function serverCommandFailureMessage(
  result: Exclude<Awaited<ReturnType<typeof initializeServerDatabase>>, { status: 'ok' }>,
): string {
  switch (result.status) {
    case 'conflict':
      return `revision conflict at ${result.currentRevision}`
    case 'error':
      return result.error
    case 'unavailable':
      return 'server commands unavailable'
  }
}

export function stopServerResourceEvents() {
  serverResourceEventsDesired = false
  serverResourceEventSubscription?.unsubscribe()
  serverResourceEventSubscription = null
  stopBridgePatchLifecycleFlush?.()
  stopBridgePatchLifecycleFlush = null
  setServerCommandSuccessReconciler(null)
  if (serverResourceReconnectTimer) {
    clearTimeout(serverResourceReconnectTimer)
    serverResourceReconnectTimer = null
  }
  serverResourceReconnectAttempt = 0
}

async function startServerResourceEvents() {
  teardownServerResourceSubscription()
  serverResourceEventsDesired = true
  const subscription = await subscribeServerCommandEvents({
    sinceRevision: peekAppliedServerProjectionRevision(),
    onCommandEvent: handleServerCommandEvent,
    onMemoryEvent: applyServerMemoryEvent,
    onError: (error) => {
      console.warn(error)
      if (error.includes('Malformed command event frame')) {
        enqueueServerResourceSync(async () => {
          await forceServerResourceRefresh('malformed-command-event')
          scheduleServerResourceReconnect()
        })
        return
      }
      scheduleServerResourceReconnect()
    },
    onClose: () => {
      scheduleServerResourceReconnect()
    },
  })
  if (subscription.status === 'ok') {
    serverResourceReconnectAttempt = 0
    serverResourceEventSubscription = subscription
  } else if (subscription.status === 'error') {
    console.warn(`Server event subscription failed: ${subscription.error}`)
    scheduleServerResourceReconnect()
  } else if (subscription.status === 'replay-unavailable') {
    console.warn(`Server event replay unavailable at revision ${subscription.currentRevision}; refreshing resources`)
    enqueueServerResourceSync(async () => {
      await forceServerResourceRefresh('event-replay-unavailable')
      scheduleServerResourceReconnect()
    })
  }
}

function teardownServerResourceSubscription() {
  serverResourceEventSubscription?.unsubscribe()
  serverResourceEventSubscription = null
}

function scheduleServerResourceReconnect() {
  if (serverResourceReconnectTimer || !serverResourceEventsDesired) return
  const delayMs = calculateServerResourceReconnectDelayMs(serverResourceReconnectAttempt)
  serverResourceReconnectAttempt += 1
  serverResourceReconnectTimer = setTimeout(() => {
    serverResourceReconnectTimer = null
    if (!serverResourceEventsDesired) return
    void (async () => {
      await startServerResourceEvents()
    })()
  }, delayMs)
}

export function calculateServerResourceReconnectDelayMs(attempt: number, random: () => number = Math.random): number {
  const normalizedAttempt = Number.isFinite(attempt) && attempt > 0 ? Math.floor(attempt) : 0
  const exponentialDelay = Math.min(
    SERVER_RESOURCE_RECONNECT_MAX_DELAY_MS,
    SERVER_RESOURCE_RECONNECT_BASE_DELAY_MS * 2 ** normalizedAttempt,
  )
  const randomValue = random()
  const normalizedRandom = Number.isFinite(randomValue) && randomValue >= 0 && randomValue <= 1 ? randomValue : 0.5
  const jitterMultiplier =
    1 - SERVER_RESOURCE_RECONNECT_JITTER_RATIO + normalizedRandom * SERVER_RESOURCE_RECONNECT_JITTER_RATIO * 2
  const jitteredDelay = Math.round(exponentialDelay * jitterMultiplier)

  return Math.min(SERVER_RESOURCE_RECONNECT_MAX_DELAY_MS, Math.max(1, jitteredDelay))
}

function applyServerMemoryEvent(event: ServerMemoryEvent) {
  if (!shouldAcceptMemoryJobUpdate({ chatId: event.chatId, ...event.job })) return
  if (event.sideEffect?.kind === 'hypav3_progress') {
    applyServerHypaV3Progress(event.sideEffect.payload)
  }
  publishServerMemoryJobEvent(event)
}

/**
 * Apply API resource invalidations in command revision order. Dedicated read
 * endpoints own the mapping from event resources to settings, collections,
 * character rows, transcripts, and lorebooks; revision gaps fall back to one
 * complete resource refresh.
 */
function handleServerCommandEvent(event: CommandEvent) {
  if (isOwnCommandEvent(event) && deferOwnServerCommandReconciliation(event)) return
  enqueueServerResourceSync(() => processServerCommandEvents([event]))
}

function enqueueServerResourceSync(task: () => Promise<void>): Promise<void> {
  serverResourceSyncChain = serverResourceSyncChain
    .then(task)
    .catch((error) => console.warn('Server resource sync failed', error))
  return serverResourceSyncChain
}

async function processServerCommandEvents(events: readonly CommandEvent[]): Promise<void> {
  if (events.length === 0) return

  const previousSelectedIndex = get(selectedCharID)
  const previousSelectedCharacterId =
    previousSelectedIndex >= 0 ? getDatabase().characters?.[previousSelectedIndex]?.chaId : undefined
  const result = await refreshInvalidatedServerResources(events, {
    appliedRevision: peekAppliedServerProjectionRevision(),
    hooks: serverResourceInvalidationHooks,
  })

  if (result.status !== 'ok') {
    if (result.status === 'error') console.warn(`Server resource invalidation failed: ${result.error}`)
    scheduleServerResourceReconnect()
    return
  }
  if (result.scope === 'none') return

  reconcileSelectedCharacterAfterResourceRefresh(events, previousSelectedIndex, previousSelectedCharacterId)
  recordHydratedCharacterLorebooks(getDatabase().characters)

  if (result.scope === 'full') {
    resetChatHydration()
    resetLorebookHydration()
    recordHydratedCharacterLorebooks(getDatabase().characters)
    void hydrateActiveChat({ force: true })
    triggerOpenChatGenerationReattach()
  }

  advanceKnownServerCommandRevision(result.revision)
  setAppliedServerProjectionRevision(result.revision)
}

function reconcileSelectedCharacterAfterResourceRefresh(
  events: readonly CommandEvent[],
  previousIndex: number,
  previousCharacterId: string | undefined,
): void {
  const database = getDatabase()
  if (events.some((event) => event.resource === 'characterSelection')) {
    selectedCharID.set(initialSelectedCharFromDatabase(database))
    return
  }
  if (previousIndex < 0) return

  const preservedIndex = previousCharacterId
    ? database.characters.findIndex((character) => character?.chaId === previousCharacterId)
    : -1
  selectedCharID.set(preservedIndex >= 0 ? preservedIndex : initialSelectedCharFromDatabase(database))
}

function isOwnCommandEvent(event: CommandEvent): boolean {
  const writerSessionId = peekActiveWriterSessionId()
  return !!writerSessionId && event.origin?.writerSessionId === writerSessionId
}

function advanceKnownServerCommandRevision(revision: number): void {
  const cached = peekCachedServerCommandRevision()
  if (cached === null || revision > cached) {
    setCachedServerCommandRevision(revision)
  }
}

/**
 * Updates the error handling by adding custom handlers for errors and unhandled promise rejections.
 */
function updateErrorHandling() {
  const errorHandler = (event: ErrorEvent | Event) => {
    console.error(getGlobalErrorLogPayload(event))
    if (isResourceOrWorkerErrorTarget(event.target)) {
      return
    }
    const alertPayload = getUsableGlobalErrorAlertPayload(event)
    if (alertPayload !== null) {
      alertError(alertPayload)
    }
  }
  const rejectHandler = (event: PromiseRejectionEvent) => {
    console.error(event.reason)
    const alertPayload = getUsableRejectionAlertPayload(event.reason)
    if (alertPayload !== null) {
      alertError(alertPayload)
    }
  }
  window.addEventListener('error', errorHandler)
  window.addEventListener('unhandledrejection', rejectHandler)
}

function getGlobalErrorLogPayload(event: ErrorEvent | Event): unknown {
  if ('error' in event) {
    return event.error
  }
  return event
}

function isResourceOrWorkerErrorTarget(target: EventTarget | null): boolean {
  if (target === null || target === window) {
    return false
  }
  if (typeof Worker !== 'undefined' && target instanceof Worker) {
    return true
  }
  return typeof Element !== 'undefined' && target instanceof Element
}

function getUsableGlobalErrorAlertPayload(event: ErrorEvent | Event): Error | string | null {
  const error = 'error' in event ? event.error : undefined
  const errorPayload = getUsableErrorLikeAlertPayload(error)
  if (errorPayload !== null) {
    return errorPayload
  }

  const message = 'message' in event ? event.message : undefined
  return getUsableErrorLikeAlertPayload(message)
}

function getUsableRejectionAlertPayload(reason: unknown): Error | string | null {
  return getUsableErrorLikeAlertPayload(reason)
}

function getUsableErrorLikeAlertPayload(value: unknown): Error | string | null {
  if (value instanceof Error) {
    return value.message.trim() ? value : null
  }
  if (typeof value === 'string') {
    const trimmed = value.trim()
    return trimmed ? trimmed : null
  }
  return null
}

/**
 * Updates the height mode of the document based on the value stored in the database.
 */
function updateHeightMode() {
  const db = getDatabase()
  const root = document.querySelector(':root') as HTMLElement
  switch (db.heightMode) {
    case 'auto':
      root.style.setProperty('--risu-height-size', '100%')
      break
    case 'vh':
      root.style.setProperty('--risu-height-size', '100vh')
      break
    case 'dvh':
      root.style.setProperty('--risu-height-size', '100dvh')
      break
    case 'lvh':
      root.style.setProperty('--risu-height-size', '100lvh')
      break
    case 'svh':
      root.style.setProperty('--risu-height-size', '100svh')
      break
    case 'percent':
      root.style.setProperty('--risu-height-size', '100%')
      break
  }
}
