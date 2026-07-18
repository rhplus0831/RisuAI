import { get } from 'svelte/store'
import { getDatabase, setResourceWriteGuardEnabled, type Database } from './storage/database.svelte'
import { botMakerMode, selectedCharID, loadedStore, LoadingStatusState } from './stores.svelte'
import { loadPlugins, startPluginRuntimeSync } from './plugins/plugins.svelte'
import { alertError, alertMd, alertTOS, waitAlert } from './alert'
import { updateReducedMotion } from './gui/animation'
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
  notifyServerCommandLocalEffectApplied,
  peekAppliedServerResourceRevision,
  peekCachedServerCommandRevision,
  setAppliedServerResourceRevision,
  setCachedServerCommandRevision,
  setServerCommandConflictGapHandler,
  setServerCommandSuccessReconciler,
  type CommandEvent,
  type AgentPresetCollectionMutationLocalEffect,
  type AgentPresetPatchLocalEffect,
  type AgentPresetStepPatchLocalEffect,
  type LegacyPresetPatchLocalEffect,
  type PresetReorderLocalEffect,
  type PersonaMutationLocalEffect,
  type PersonaPatchLocalEffect,
  type ServerCommandLocalEffect,
  type TranslatorPresetPatchLocalEffect,
} from './server/commands'
import {
  adoptPendingMutationWriterSessionId,
  getActiveWriterSessionId,
  peekActiveWriterSessionId,
} from './server/activeWriterSession'
import { startBridgePatchLifecycleFlush } from './server/bridgeFlush'
import { replayPendingMutations } from './server/pendingMutationReplay'
import {
  countPendingMutationRecords,
  preparePendingMutationOutbox,
  readSinglePendingMutationOwner,
} from './server/pendingMutationOutbox'
import { flushPendingMutationReceiptAcknowledgements } from './server/durableMutationDispatch'
import {
  acknowledgeCreatedChatTranscriptLocalEffect,
  acknowledgeMessageMutationLocalEffect,
  applyMessageTranslationLocalEffect,
  hydrateActiveChat,
  invalidateChatHydration,
  resetChatHydration,
  startChatMessageHydration,
} from './server/chatMessageHydration.svelte'
import {
  isCharacterLorebookHydrated,
  recordHydratedCharacterLorebooks,
  resetLorebookHydration,
} from './server/lorebookBridge.svelte'
import {
  setActiveGenerationJobs,
  startActiveGenerationReattach,
  triggerOpenChatGenerationReattach,
} from './process/reattach'
import { setActiveMessageTranslations, startActiveMessageTranslationRefresh } from './server/messageTranslationJobs'
import { applyServerHypaV3Progress } from './process/request/serverMemory'
import { shouldAcceptMemoryJobUpdate } from './server/memoryJobOrdering'
import {
  initializePushNotificationCoordinator,
  reconcileChatCompletionPushNotificationSetting,
} from './server/pushNotificationSetting'
import { loadInitialServerResources, refreshInvalidatedServerResources } from './server/resourceInvalidation'
import {
  forceServerDatabaseReplacementRefresh,
  forceServerResourceRefresh,
  serverResourceInvalidationHooks,
} from './server/resourceRefresh'
import {
  adoptReplacementDatabaseOwnership,
  hasPendingReplacementDatabaseRefresh,
  isReplacementDatabaseOwnershipRefreshPending,
  markReplacementDatabaseOwnershipRefreshed,
  waitForLocalReplacementDatabaseOperations,
  wasReplacementDatabaseOwnershipRefreshed,
  type ReplacementDatabaseOwnership,
} from './server/replacementDatabaseOwnership'
import {
  resolveSelectedCharacterIndexAfterRefresh,
  trackSelectedCharacterDuringRefresh,
  type SelectedCharacterRefreshSnapshot,
} from './server/selectedCharacterRefresh'
import {
  applyCharacterCollectionMutationLocalEffect,
  applyCharacterPatchLocalEffect,
  applyCharacterOrderLocalEffect,
  applyCharacterRowMutationLocalEffect,
  applyCharacterSelectionLocalEffect,
  applyChatPatchLocalEffect,
  applyChatGenerationSettingsLocalEffect,
  applySettingsPatchLocalEffect,
  applyPluginCollectionMutationLocalEffect,
  applyPluginProviderLocalEffect,
  applyPluginStorageLocalEffect,
  applyModuleCollectionMutationLocalEffect,
  applyModuleEnabledLocalEffect,
  applyPromptItemMutationLocalEffect,
  applyLegacyPresetPatchLocalEffect,
  applyPresetReorderLocalEffect,
  applyAgentPresetCollectionMutationLocalEffect,
  applyAgentPresetPatchLocalEffect,
  applyAgentPresetStepPatchLocalEffect,
  applyPersonaMutationLocalEffect,
  applyPersonaPatchLocalEffect,
  applyTranslatorPresetPatchLocalEffect,
  applySplitPresetPatchLocalEffect,
  applyGlobalLorebookMutationLocalEffect,
  applyLoadoutMutationLocalEffect,
  applyLorebookMutationLocalEffect,
  hasChatBodyProjectionEpochChanged,
  hasCharacterLorebookProjectionEpochChanged,
  hasCharacterRowProjectionEpochChanged,
  hasCollectionProjectionEpochChanged,
  hasLorebookPageProjectionEpochChanged,
  hasSettingsGroupProjectionEpochChanged,
  hasSettingsProjectionEpochChanged,
  isCollectionAcknowledgementTainted,
  isSettingsAcknowledgementTainted,
  isSettingsGroupAcknowledgementTainted,
} from './server/resourceState.svelte'
import { withServerResourceApply, withTrustedResourceWrite } from './server/resourceWriteGuard.svelte'
import { hasDestructiveRefreshEpochChanged } from './server/staleStateGuards'
import {
  ensurePromptTemplateHydrated,
  hasPromptTemplateOwnerProjectionEpochChanged,
  isPromptTemplateOwnerAcknowledgementTainted,
  isPromptTemplateHydrated,
  markPromptTemplateProjectionApplied,
  peekPromptTemplateOwnerRevision,
} from './server/promptTemplateHydration'
import { setSettingsRuntimeProjectionHook } from './server/settingsRuntimeProjectionHooks'
import { updateHeightMode } from './gui/heightMode'
import { normalizeLegacyCustomBackgroundSetting } from './server/customBackgroundSetting'

const COLOR_SCHEME_RUNTIME_KEYS = new Set(['colorScheme', 'colorSchemeName', 'customBackground'])
const TEXT_THEME_RUNTIME_KEYS = new Set(['textTheme', 'customTextTheme', 'font', 'customFont', 'customCSS'])
const GUI_SIZE_RUNTIME_KEYS = new Set(['textAreaSize', 'textAreaTextSize', 'sideBarSize'])

function hasProjectedRuntimeKey(keys: readonly string[], candidates: ReadonlySet<string>): boolean {
  return keys.some((key) => candidates.has(key))
}

setSettingsRuntimeProjectionHook((keys) => {
  const colorSchemeChanged = hasProjectedRuntimeKey(keys, COLOR_SCHEME_RUNTIME_KEYS)
  if (colorSchemeChanged) updateColorScheme()
  if (colorSchemeChanged || hasProjectedRuntimeKey(keys, TEXT_THEME_RUNTIME_KEYS)) updateTextThemeAndCSS()
  if (hasProjectedRuntimeKey(keys, GUI_SIZE_RUNTIME_KEYS)) updateGuisize()
  if (keys.includes('animationSpeed') || keys.includes('reducedMotion')) updateReducedMotion()
  if (keys.includes('heightMode')) updateHeightMode()
  if (get(loadedStore) && keys.includes('notification')) {
    void reconcileChatCompletionPushNotificationSetting(getDatabase().notification === true)
  }
})

const SERVER_RESOURCE_RECONNECT_BASE_DELAY_MS = 1000
const SERVER_RESOURCE_RECONNECT_MAX_DELAY_MS = 30_000
const SERVER_RESOURCE_RECONNECT_JITTER_RATIO = 0.2
const SERVER_RESOURCE_EVENT_STALE_TIMEOUT_MS = 60_000

let serverResourceEventSubscription: { unsubscribe: () => void } | null = null
let stopBridgePatchLifecycleFlush: (() => void) | null = null
// Serializes resource invalidation so the applied revision cursor advances in
// command-event order.
let serverResourceSyncChain: Promise<void> = Promise.resolve()
let serverResourceEventsDesired = false
let serverResourceReconnectTimer: ReturnType<typeof setTimeout> | null = null
let serverResourceReconnectAttempt = 0
let serverResourceEventEpoch = 0
let serverResourceLastFrameAt = 0
let serverResourceEventWatchdogTimer: ReturnType<typeof setTimeout> | null = null
let stopServerResourceRecoveryListeners: (() => void) | null = null
let reconnectPendingMutationReplay: Promise<void> | null = null
let serverResourceRuntimeReplayEnabled = false

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
export async function loadData(): Promise<void> {
  const loaded = get(loadedStore)
  if (!loaded) {
    try {
      await loadWebInitialDatabase()
      const db = getDatabase()
      await initializePushNotificationCoordinator()
      void reconcileChatCompletionPushNotificationSetting(db.notification === true)
      LoadingStatusState.text = 'Loading Plugins...'
      try {
        await loadPlugins()
      } catch (error) {}
      startPluginRuntimeSync()
      LoadingStatusState.text = 'Checking For Format Update...'

      LoadingStatusState.text = 'Updating States...'
      updateColorScheme()
      updateTextThemeAndCSS()
      updateReducedMotion()
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
      void reconcileChatCompletionPushNotificationSetting(getDatabase().notification === true)
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
      await waitAlert()
      if (!get(loadedStore)) await loadData()
    }
  }
}

export async function loadWebInitialDatabase() {
  LoadingStatusState.text = 'Loading Server Data...'
  const pendingMutationOwner = await readSinglePendingMutationOwner()
  if (pendingMutationOwner) {
    adoptPendingMutationWriterSessionId(pendingMutationOwner.writerSessionId)
  }
  const firstBootstrap = await fetchServerBootstrap()
  if (firstBootstrap.status !== 'ok') {
    throw new Error(firstBootstrap.status === 'unavailable' ? 'Server bootstrap is unavailable' : firstBootstrap.error)
  }
  const runtime = firstBootstrap.bootstrap.initialized
    ? firstBootstrap.bootstrap
    : await initializeFreshServerDatabase(firstBootstrap.bootstrap)

  const { databaseLineage, requestedWriterWasActive, writerEpoch } = firstBootstrap.bootstrap
  if (
    !databaseLineage ||
    typeof requestedWriterWasActive !== 'boolean' ||
    typeof writerEpoch !== 'number' ||
    !Number.isSafeInteger(writerEpoch)
  ) {
    throw new Error('Server bootstrap is missing durable mutation ownership metadata')
  }
  const pendingMutationPreparation = await preparePendingMutationOutbox({
    writerSessionId: getActiveWriterSessionId(),
    writerEpoch,
    databaseLineage,
    requestedWriterWasActive,
  })
  if (pendingMutationPreparation.discarded > 0) {
    alertError(language.pendingMutationDiscarded)
  }
  await flushPendingMutationReceiptAcknowledgements()
  const pendingMutationReplay = await replayPendingMutations()
  const remainingPendingMutationRecords = await countPendingMutationRecords()
  if (
    pendingMutationReplay.retained > 0 ||
    remainingPendingMutationRecords === null ||
    remainingPendingMutationRecords > 0
  ) {
    throw new Error(language.pendingMutationReplayRetained)
  }

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
  if (!(await ensurePromptTemplateHydrated({ minimumRevision: resources.revision }))) {
    throw new Error('Selected prompt-template owner hydration failed')
  }
  setCachedServerCommandRevision(resources.revision)
  setAppliedServerResourceRevision(resources.revision)
  markReplacementDatabaseOwnershipRefreshed({ databaseLineage, writerEpoch })
  setServerCommandSuccessReconciler((event, coalescedEvents, localEffects) =>
    enqueueServerResourceSync(() =>
      processServerCommandEvents(coalescedEvents.length > 0 ? coalescedEvents : [event], localEffects),
    ),
  )
  setServerCommandConflictGapHandler(handleServerCommandConflictGap)
  setResourceWriteGuardEnabled(true)
  setActiveGenerationJobs(runtime.activeGenerationJobs ?? [])
  setActiveMessageTranslations(runtime.activeMessageTranslations ?? [])
  startActiveMessageTranslationRefresh()
  startActiveGenerationReattach()
  startChatMessageHydration()
  void hydrateActiveChat()
  stopBridgePatchLifecycleFlush?.()
  stopBridgePatchLifecycleFlush = startBridgePatchLifecycleFlush()
  serverResourceRuntimeReplayEnabled = false
  await startServerResourceEvents({ replayPendingMutations: false })
  serverResourceRuntimeReplayEnabled = true
  normalizeLegacyCustomBackgroundSetting()
}

/**
 * One-time first-run seed. The initialize response supplies the new revision,
 * so the pre-initialize runtime metadata remains valid when this client wins
 * the initialization race. A read-only bootstrap retry is only needed when a
 * different client initialized the database first.
 */
async function initializeFreshServerDatabase(initialRuntime: ServerBootstrapRuntime): Promise<ServerBootstrapRuntime> {
  if (!canUseServerCommands()) {
    throw new Error('Initial server database seed failed: server commands unavailable')
  }

  const result = await initializeServerDatabase()
  if (result.status === 'ok') {
    setCachedServerCommandRevision(result.revision)
    if (result.initialized === true) {
      return {
        ...initialRuntime,
        initialized: true,
        revision: result.revision,
      }
    }

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
  serverResourceRuntimeReplayEnabled = false
  serverResourceEventEpoch += 1
  teardownServerResourceSubscription()
  stopServerResourceRecoveryListeners?.()
  stopServerResourceRecoveryListeners = null
  stopBridgePatchLifecycleFlush?.()
  stopBridgePatchLifecycleFlush = null
  setServerCommandSuccessReconciler(null)
  setServerCommandConflictGapHandler(null)
  if (serverResourceReconnectTimer) {
    clearTimeout(serverResourceReconnectTimer)
    serverResourceReconnectTimer = null
  }
  serverResourceReconnectAttempt = 0
}

async function startServerResourceEvents(options: { replayPendingMutations?: boolean } = {}) {
  const eventEpoch = serverResourceEventEpoch + 1
  serverResourceEventEpoch = eventEpoch
  teardownServerResourceSubscription()
  serverResourceEventsDesired = true
  ensureServerResourceRecoveryListeners()
  const subscription = await subscribeServerCommandEvents({
    sinceRevision: peekAppliedServerResourceRevision(),
    onCommandEvent: handleServerCommandEvent,
    onMemoryEvent: applyServerMemoryEvent,
    onFrame: (frame) =>
      recordServerResourceEventFrame(eventEpoch, frame.event === 'message' && frame.data.length === 0),
    onError: (error) => {
      if (!isCurrentServerResourceEventEpoch(eventEpoch)) return
      console.warn(error)
      if (error.includes('Malformed command event frame')) {
        enqueueServerResourceSync(async () => {
          if (!isCurrentServerResourceEventEpoch(eventEpoch)) return
          await forceServerResourceRefresh('malformed-command-event')
          scheduleServerResourceReconnect(eventEpoch)
        })
        return
      }
      scheduleServerResourceReconnect(eventEpoch)
    },
    onClose: () => {
      if (!isCurrentServerResourceEventEpoch(eventEpoch)) return
      scheduleServerResourceReconnect(eventEpoch)
    },
  })
  if (!isCurrentServerResourceEventEpoch(eventEpoch)) {
    if (subscription.status === 'ok') subscription.unsubscribe()
    return
  }
  if (subscription.status === 'ok') {
    serverResourceReconnectAttempt = 0
    serverResourceEventSubscription = subscription
    recordServerResourceEventFrame(eventEpoch)
    if (options.replayPendingMutations !== false) triggerReconnectPendingMutationReplay()
    if (hasPendingReplacementDatabaseRefresh()) {
      enqueueServerResourceSync(async () => {
        if (!isCurrentServerResourceEventEpoch(eventEpoch)) return
        const refreshed = await retryPendingReplacementDatabaseRefresh()
        if (!refreshed) scheduleServerResourceReconnect(eventEpoch)
      })
    }
  } else if (subscription.status === 'error') {
    console.warn(`Server event subscription failed: ${subscription.error}`)
    scheduleServerResourceReconnect(eventEpoch)
  } else if (subscription.status === 'replay-unavailable') {
    console.warn(`Server event replay unavailable at revision ${subscription.currentRevision}; refreshing resources`)
    enqueueServerResourceSync(async () => {
      if (!isCurrentServerResourceEventEpoch(eventEpoch)) return
      await refreshAfterUnavailableEventReplay()
      scheduleServerResourceReconnect(eventEpoch)
    })
  }
}

async function refreshAfterUnavailableEventReplay(): Promise<void> {
  const reconciliation = await reconcileReplacementDatabaseOwnership()
  if (reconciliation === null) return
  const replacementRefresh =
    reconciliation.ownershipChanged ||
    isReplacementDatabaseOwnershipRefreshPending(reconciliation.ownership) ||
    !wasReplacementDatabaseOwnershipRefreshed(reconciliation.ownership)
  const refresh = replacementRefresh
    ? await forceServerDatabaseReplacementRefresh('event-replay-unavailable')
    : await forceServerResourceRefresh('event-replay-unavailable')
  if (replacementRefresh && refresh.status === 'ok') {
    markReplacementDatabaseOwnershipRefreshed(reconciliation.ownership)
  }
}

async function retryPendingReplacementDatabaseRefresh(): Promise<boolean> {
  const reconciliation = await reconcileReplacementDatabaseOwnership()
  if (reconciliation === null) return false
  if (!isReplacementDatabaseOwnershipRefreshPending(reconciliation.ownership)) return true
  const refresh = await forceServerDatabaseReplacementRefresh('database-replacement-reconnect')
  if (refresh.status !== 'ok') {
    if (refresh.status === 'error') {
      console.warn(`Pending server database replacement refresh failed: ${refresh.error}`)
    }
    return false
  }
  markReplacementDatabaseOwnershipRefreshed(reconciliation.ownership)
  return true
}

function teardownServerResourceSubscription() {
  clearServerResourceEventWatchdog()
  serverResourceEventSubscription?.unsubscribe()
  serverResourceEventSubscription = null
}

function scheduleServerResourceReconnect(eventEpoch = serverResourceEventEpoch) {
  if (serverResourceReconnectTimer || !serverResourceEventsDesired || eventEpoch !== serverResourceEventEpoch) {
    return
  }
  const delayMs = calculateServerResourceReconnectDelayMs(serverResourceReconnectAttempt)
  serverResourceReconnectAttempt += 1
  serverResourceReconnectTimer = setTimeout(() => {
    serverResourceReconnectTimer = null
    if (!isCurrentServerResourceEventEpoch(eventEpoch)) return
    void (async () => {
      await startServerResourceEvents()
    })()
  }, delayMs)
}

function recordServerResourceEventFrame(eventEpoch: number, retryPendingMutations = false): void {
  if (!isCurrentServerResourceEventEpoch(eventEpoch)) return
  serverResourceLastFrameAt = Date.now()
  armServerResourceEventWatchdog(eventEpoch, SERVER_RESOURCE_EVENT_STALE_TIMEOUT_MS)
  if (serverResourceRuntimeReplayEnabled && retryPendingMutations) triggerReconnectPendingMutationReplay()
}

function armServerResourceEventWatchdog(eventEpoch: number, delayMs: number): void {
  clearServerResourceEventWatchdog()
  serverResourceEventWatchdogTimer = setTimeout(
    () => {
      serverResourceEventWatchdogTimer = null
      if (!isCurrentServerResourceEventEpoch(eventEpoch)) return
      const remainingMs = SERVER_RESOURCE_EVENT_STALE_TIMEOUT_MS - (Date.now() - serverResourceLastFrameAt)
      if (remainingMs > 0) {
        armServerResourceEventWatchdog(eventEpoch, remainingMs)
        return
      }
      console.warn('Server event stream heartbeat timed out; reconnecting')
      teardownServerResourceSubscription()
      scheduleServerResourceReconnect(eventEpoch)
    },
    Math.max(1, delayMs),
  )
}

function clearServerResourceEventWatchdog(): void {
  if (!serverResourceEventWatchdogTimer) return
  clearTimeout(serverResourceEventWatchdogTimer)
  serverResourceEventWatchdogTimer = null
}

function isCurrentServerResourceEventEpoch(eventEpoch: number): boolean {
  return serverResourceEventsDesired && eventEpoch === serverResourceEventEpoch
}

function ensureServerResourceRecoveryListeners(): void {
  if (stopServerResourceRecoveryListeners || typeof window === 'undefined' || typeof document === 'undefined') return
  const handleVisibilityChange = () => {
    if (document.visibilityState === 'visible') restartServerResourceEvents()
  }
  const handleOnline = () => restartServerResourceEvents()
  document.addEventListener('visibilitychange', handleVisibilityChange)
  window.addEventListener('online', handleOnline)
  stopServerResourceRecoveryListeners = () => {
    document.removeEventListener('visibilitychange', handleVisibilityChange)
    window.removeEventListener('online', handleOnline)
  }
}

function restartServerResourceEvents(): void {
  if (!serverResourceEventsDesired) return
  if (serverResourceReconnectTimer) {
    clearTimeout(serverResourceReconnectTimer)
    serverResourceReconnectTimer = null
  }
  void startServerResourceEvents()
}

function triggerReconnectPendingMutationReplay(): void {
  if (!serverResourceEventsDesired || reconnectPendingMutationReplay) return
  const replay = (async () => {
    const summary = await replayPendingMutations()
    if (summary.discarded === 0) return
    await enqueueServerResourceSync(async () => {
      await forceServerResourceRefresh('pending-mutation-replay-discarded')
    })
  })().catch((error) => console.warn('Pending mutation reconnect replay failed', error))
  reconnectPendingMutationReplay = replay
  void replay.finally(() => {
    if (reconnectPendingMutationReplay === replay) reconnectPendingMutationReplay = null
  })
}

function handleServerCommandConflictGap(currentRevision: number, appliedRevision: number): void {
  if (currentRevision <= appliedRevision) return
  void enqueueServerResourceSync(async () => {
    const latestAppliedRevision = peekAppliedServerResourceRevision()
    if (latestAppliedRevision !== null && latestAppliedRevision >= currentRevision) return
    try {
      await forceServerResourceRefresh('conflict-gap')
    } finally {
      restartServerResourceEvents()
    }
  })
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

async function processServerCommandEvents(
  events: readonly CommandEvent[],
  localEffects: ReadonlyMap<number, ServerCommandLocalEffect> = new Map(),
): Promise<void> {
  if (events.length === 0) return

  const sortedEvents = [...events].sort((left, right) => left.revision - right.revision)
  let pendingAuthoritativeEvents: CommandEvent[] = []

  const flushPendingAuthoritativeEvents = async (): Promise<boolean> => {
    if (pendingAuthoritativeEvents.length === 0) return true
    const pending = pendingAuthoritativeEvents
    pendingAuthoritativeEvents = []
    return processAuthoritativeServerCommandEvents(pending)
  }

  for (const event of sortedEvents) {
    const localEffect = localEffects.get(event.revision)
    if (!localEffect) {
      pendingAuthoritativeEvents.push(event)
      continue
    }

    if (!(await flushPendingAuthoritativeEvents())) return
    const appliedRevision = peekAppliedServerResourceRevision()
    if (appliedRevision !== null && event.revision <= appliedRevision) continue

    if (
      appliedRevision !== null &&
      event.revision === appliedRevision + 1 &&
      applyContiguousServerCommandLocalEffect(event, localEffect)
    ) {
      notifyServerCommandLocalEffectApplied(event, localEffect)
      advanceKnownServerCommandRevision(event.revision)
      setAppliedServerResourceRevision(event.revision)
      continue
    }

    // A local acknowledgement can only advance a contiguous cursor. A gap or
    // an effect whose target disappeared must retain the ordinary authoritative
    // invalidation path.
    if (!(await processAuthoritativeServerCommandEvents([event]))) return
  }

  await flushPendingAuthoritativeEvents()
}

function applyLegacyPresetPatchAcknowledgement(
  event: CommandEvent,
  localEffect: LegacyPresetPatchLocalEffect,
): boolean {
  if (
    event.type !== 'preset.updated' ||
    event.resource !== 'presetRow' ||
    event.id !== localEffect.presetId ||
    event.parentId !== undefined ||
    !Number.isInteger(localEffect.collectionProjectionEpoch) ||
    localEffect.collectionProjectionEpoch < 0 ||
    hasCollectionProjectionEpochChanged('botPresets', localEffect.collectionProjectionEpoch) ||
    isCollectionAcknowledgementTainted('botPresets')
  ) {
    return false
  }
  return withServerResourceApply(() =>
    applyLegacyPresetPatchLocalEffect({
      revision: event.revision,
      presetId: localEffect.presetId,
      fields: localEffect.fields,
    }),
  )
}

function applyPresetReorderAcknowledgement(event: CommandEvent, localEffect: PresetReorderLocalEffect): boolean {
  const collectionName = localEffect.presetKind === 'legacy' ? 'botPresets' : 'modelPresets'
  const expectedType = localEffect.presetKind === 'legacy' ? 'preset.reordered' : 'modelPreset.reordered'
  const expectedResource =
    localEffect.presetKind === 'legacy'
      ? localEffect.settingsWritten
        ? 'presetCollectionWithPointer'
        : 'presetCollection'
      : 'modelPreset'
  if (
    event.type !== expectedType ||
    event.resource !== expectedResource ||
    event.id !== undefined ||
    event.parentId !== undefined ||
    !Number.isInteger(localEffect.collectionProjectionEpoch) ||
    localEffect.collectionProjectionEpoch < 0 ||
    !Number.isInteger(localEffect.settingsProjectionEpoch) ||
    localEffect.settingsProjectionEpoch < 0 ||
    hasCollectionProjectionEpochChanged(collectionName, localEffect.collectionProjectionEpoch) ||
    isCollectionAcknowledgementTainted(collectionName) ||
    (localEffect.settingsWritten &&
      (hasSettingsProjectionEpochChanged(localEffect.settingsProjectionEpoch) || isSettingsAcknowledgementTainted())) ||
    currentPresetReorderSelection(localEffect.presetKind) !== localEffect.selectedPresetId
  ) {
    return false
  }
  return withTrustedResourceWrite(() =>
    applyPresetReorderLocalEffect({
      revision: event.revision,
      presetKind: localEffect.presetKind,
      presetIds: localEffect.presetIds,
      selectedPresetId: localEffect.selectedPresetId,
      settingsWritten: localEffect.settingsWritten,
    }),
  )
}

function applyPersonaPatchAcknowledgement(event: CommandEvent, localEffect: PersonaPatchLocalEffect): boolean {
  if (
    event.type !== 'persona.updated' ||
    event.resource !== 'persona' ||
    event.id !== localEffect.personaId ||
    event.parentId !== undefined ||
    !Number.isInteger(localEffect.collectionProjectionEpoch) ||
    localEffect.collectionProjectionEpoch < 0 ||
    !Number.isInteger(localEffect.settingsProjectionEpoch) ||
    localEffect.settingsProjectionEpoch < 0 ||
    hasCollectionProjectionEpochChanged('personas', localEffect.collectionProjectionEpoch) ||
    isCollectionAcknowledgementTainted('personas') ||
    (localEffect.legacyProfileProjectionApplied &&
      (hasSettingsProjectionEpochChanged(localEffect.settingsProjectionEpoch) || isSettingsAcknowledgementTainted()))
  ) {
    return false
  }
  return withTrustedResourceWrite(() =>
    applyPersonaPatchLocalEffect({
      revision: event.revision,
      personaId: localEffect.personaId,
      attemptedPatch: localEffect.attemptedPatch,
      attemptedPersona: localEffect.attemptedPersona,
      attemptedLegacyProfile: localEffect.attemptedLegacyProfile,
      legacyProfileProjectionApplied: localEffect.legacyProfileProjectionApplied,
    }),
  )
}

function applyPersonaMutationAcknowledgement(event: CommandEvent, localEffect: PersonaMutationLocalEffect): boolean {
  const expectedEventType: Record<PersonaMutationLocalEffect['operation'], string> = {
    create: 'persona.created',
    delete: 'persona.deleted',
    select: 'persona.selected',
    reorder: 'persona.reordered',
  }
  const targetExpected = localEffect.operation !== 'reorder'
  if (
    event.type !== expectedEventType[localEffect.operation] ||
    event.resource !== 'persona' ||
    event.parentId !== undefined ||
    (targetExpected ? event.id !== localEffect.targetPersonaId : event.id !== undefined) ||
    (targetExpected ? typeof localEffect.targetPersonaId !== 'string' : localEffect.targetPersonaId !== null) ||
    !Number.isInteger(localEffect.collectionProjectionEpoch) ||
    localEffect.collectionProjectionEpoch < 0 ||
    !Number.isInteger(localEffect.settingsProjectionEpoch) ||
    localEffect.settingsProjectionEpoch < 0 ||
    hasCollectionProjectionEpochChanged('personas', localEffect.collectionProjectionEpoch) ||
    isCollectionAcknowledgementTainted('personas') ||
    (localEffect.settingsWritten &&
      (hasSettingsProjectionEpochChanged(localEffect.settingsProjectionEpoch) || isSettingsAcknowledgementTainted()))
  ) {
    return false
  }
  return withTrustedResourceWrite(() =>
    applyPersonaMutationLocalEffect({
      revision: event.revision,
      operation: localEffect.operation,
      collectionWritten: localEffect.collectionWritten,
      settingsWritten: localEffect.settingsWritten,
    }),
  )
}

function applyAgentPresetCollectionMutationAcknowledgement(
  event: CommandEvent,
  localEffect: AgentPresetCollectionMutationLocalEffect,
): boolean {
  const expectedType = localEffect.operation === 'reorder' ? 'agentPreset.reordered' : 'agentPreset.default.updated'
  const expectedEventId =
    localEffect.operation === 'default' ? (localEffect.agentPresetDefaultId ?? undefined) : undefined
  if (
    event.type !== expectedType ||
    event.resource !== 'agentPreset' ||
    event.id !== expectedEventId ||
    event.parentId !== undefined ||
    !Number.isInteger(localEffect.settingsProjectionEpoch) ||
    localEffect.settingsProjectionEpoch < 0 ||
    hasSettingsGroupProjectionEpochChanged('agents', localEffect.settingsProjectionEpoch) ||
    isSettingsGroupAcknowledgementTainted('agents') ||
    isSettingsAcknowledgementTainted()
  ) {
    return false
  }
  return withTrustedResourceWrite(() =>
    applyAgentPresetCollectionMutationLocalEffect({
      revision: event.revision,
      operation: localEffect.operation,
      presetIds: localEffect.presetIds,
      agentPresetDefaultId: localEffect.agentPresetDefaultId,
    }),
  )
}

function applyAgentPresetPatchAcknowledgement(event: CommandEvent, localEffect: AgentPresetPatchLocalEffect): boolean {
  if (
    event.type !== 'agentPreset.updated' ||
    event.resource !== 'agentPreset' ||
    event.id !== localEffect.presetId ||
    event.parentId !== undefined ||
    !Number.isInteger(localEffect.settingsProjectionEpoch) ||
    localEffect.settingsProjectionEpoch < 0 ||
    hasSettingsGroupProjectionEpochChanged('agents', localEffect.settingsProjectionEpoch) ||
    isSettingsGroupAcknowledgementTainted('agents') ||
    isSettingsAcknowledgementTainted()
  ) {
    return false
  }
  return withTrustedResourceWrite(() =>
    applyAgentPresetPatchLocalEffect({
      revision: event.revision,
      presetId: localEffect.presetId,
      fields: localEffect.fields,
      updatedAt: localEffect.updatedAt,
    }),
  )
}

function applyAgentPresetStepPatchAcknowledgement(
  event: CommandEvent,
  localEffect: AgentPresetStepPatchLocalEffect,
): boolean {
  if (
    event.type !== 'agentPreset.step.updated' ||
    event.resource !== 'agentPreset' ||
    event.id !== localEffect.stepId ||
    event.parentId !== localEffect.presetId ||
    !Number.isInteger(localEffect.settingsProjectionEpoch) ||
    localEffect.settingsProjectionEpoch < 0 ||
    hasSettingsGroupProjectionEpochChanged('agents', localEffect.settingsProjectionEpoch) ||
    isSettingsGroupAcknowledgementTainted('agents') ||
    isSettingsAcknowledgementTainted()
  ) {
    return false
  }
  return withTrustedResourceWrite(() =>
    applyAgentPresetStepPatchLocalEffect({
      revision: event.revision,
      presetId: localEffect.presetId,
      stepId: localEffect.stepId,
      fields: localEffect.fields,
      updatedAt: localEffect.updatedAt,
    }),
  )
}

function applyTranslatorPresetPatchAcknowledgement(
  event: CommandEvent,
  localEffect: TranslatorPresetPatchLocalEffect,
): boolean {
  const database = getDatabase()
  const selectedIndex = database.translatorPresetId
  const selectedPreset = Number.isInteger(selectedIndex) ? database.translatorPresets?.[selectedIndex] : undefined
  if (
    event.type !== 'translatorPreset.updated' ||
    event.resource !== 'translatorPreset' ||
    event.id !== localEffect.presetId ||
    event.parentId !== undefined ||
    !Number.isInteger(localEffect.collectionProjectionEpoch) ||
    localEffect.collectionProjectionEpoch < 0 ||
    !Number.isInteger(localEffect.languageSettingsProjectionEpoch) ||
    localEffect.languageSettingsProjectionEpoch < 0 ||
    selectedPreset?.id !== localEffect.selectedPresetId ||
    hasCollectionProjectionEpochChanged('translatorPresets', localEffect.collectionProjectionEpoch) ||
    isCollectionAcknowledgementTainted('translatorPresets') ||
    hasSettingsGroupProjectionEpochChanged('language', localEffect.languageSettingsProjectionEpoch) ||
    isSettingsGroupAcknowledgementTainted('language') ||
    isSettingsAcknowledgementTainted()
  ) {
    return false
  }
  return withTrustedResourceWrite(() =>
    applyTranslatorPresetPatchLocalEffect({
      revision: event.revision,
      presetId: localEffect.presetId,
      attemptedPatch: localEffect.attemptedPatch,
      attemptedPreset: localEffect.attemptedPreset,
      selectedPresetId: localEffect.selectedPresetId,
    }),
  )
}

function applyContiguousServerCommandLocalEffect(event: CommandEvent, localEffect: ServerCommandLocalEffect): boolean {
  if (
    localEffect.destructiveRefreshEpoch !== undefined &&
    (!Number.isInteger(localEffect.destructiveRefreshEpoch) ||
      localEffect.destructiveRefreshEpoch < 0 ||
      hasDestructiveRefreshEpochChanged(localEffect.destructiveRefreshEpoch))
  ) {
    return false
  }

  switch (localEffect.kind) {
    case 'agentPresetCollectionMutation':
      return applyAgentPresetCollectionMutationAcknowledgement(event, localEffect)
    case 'agentPresetPatch':
      return applyAgentPresetPatchAcknowledgement(event, localEffect)
    case 'agentPresetStepPatch':
      return applyAgentPresetStepPatchAcknowledgement(event, localEffect)
    case 'legacyPresetPatch':
      return applyLegacyPresetPatchAcknowledgement(event, localEffect)
    case 'presetReorder':
      return applyPresetReorderAcknowledgement(event, localEffect)
    case 'personaPatch':
      return applyPersonaPatchAcknowledgement(event, localEffect)
    case 'personaMutation':
      return applyPersonaMutationAcknowledgement(event, localEffect)
    case 'translatorPresetPatch':
      return applyTranslatorPresetPatchAcknowledgement(event, localEffect)
    case 'chatGenerationSettings':
      if (
        event.type !== 'chat.updated' ||
        event.resource !== 'characterRow' ||
        event.id !== localEffect.chatId ||
        event.parentId !== localEffect.characterId ||
        (localEffect.characterRowProjectionEpoch !== undefined &&
          (!Number.isInteger(localEffect.characterRowProjectionEpoch) ||
            localEffect.characterRowProjectionEpoch < 0 ||
            hasCharacterRowProjectionEpochChanged(localEffect.characterId, localEffect.characterRowProjectionEpoch)))
      ) {
        return false
      }
      return withServerResourceApply(() =>
        applyChatGenerationSettingsLocalEffect({
          revision: event.revision,
          characterId: localEffect.characterId,
          chatId: localEffect.chatId,
          attemptedGenerationSettings: localEffect.attemptedGenerationSettings,
          generationSettings: localEffect.generationSettings,
        }),
      )
    case 'characterPatch':
      if (event.resource !== 'characterRow' || event.id !== localEffect.characterId) return false
      return withServerResourceApply(() =>
        applyCharacterPatchLocalEffect({
          revision: event.revision,
          characterId: localEffect.characterId,
          patch: localEffect.patch,
        }),
      )
    case 'characterSelection':
      if (event.resource !== 'characterSelection' || event.id !== localEffect.characterId) return false
      return withServerResourceApply(() =>
        applyCharacterSelectionLocalEffect({
          revision: event.revision,
          characterId: localEffect.characterId,
          lastInteraction: localEffect.lastInteraction,
        }),
      )
    case 'characterCollectionMutation': {
      const expectedType =
        localEffect.operation === 'create'
          ? 'character.created'
          : localEffect.operation === 'createAndSelect'
            ? 'character.createdAndSelected'
            : 'character.deleted'
      if (
        event.type !== expectedType ||
        event.resource !== 'character' ||
        event.id !== localEffect.characterId ||
        event.parentId !== undefined
      ) {
        return false
      }
      return withServerResourceApply(() =>
        applyCharacterCollectionMutationLocalEffect({
          revision: event.revision,
          operation: localEffect.operation,
          characterId: localEffect.characterId,
          selectedCharacterId: localEffect.selectedCharacterId,
        }),
      )
    }
    case 'chatPatch':
      if (
        event.resource !== 'characterRow' ||
        event.id !== localEffect.chatId ||
        event.parentId !== localEffect.characterId
      ) {
        return false
      }
      return withServerResourceApply(() =>
        applyChatPatchLocalEffect({
          revision: event.revision,
          characterId: localEffect.characterId,
          chatId: localEffect.chatId,
          patch: localEffect.patch,
          select: localEffect.select,
        }),
      )
    case 'chatStructureMutation': {
      if (hasDestructiveRefreshEpochChanged(localEffect.optimisticEpoch)) return false
      if (hasCharacterRowProjectionEpochChanged(localEffect.characterId, localEffect.optimisticRowEpoch)) {
        return false
      }
      const expectedType =
        localEffect.operation === 'create'
          ? 'chat.created'
          : localEffect.operation === 'delete'
            ? 'chat.deleted'
            : localEffect.operation === 'fork'
              ? 'chat.forked'
              : localEffect.operation === 'reorder'
                ? 'chat.reordered'
                : localEffect.operation === 'folderCreate'
                  ? 'chatFolder.created'
                  : localEffect.operation === 'folderDelete'
                    ? 'chatFolder.deleted'
                    : 'chatFolder.reordered'
      const createsTranscript = localEffect.operation === 'create' || localEffect.operation === 'fork'
      const reorders = localEffect.operation === 'reorder' || localEffect.operation === 'folderReorder'
      if (
        event.type !== expectedType ||
        event.parentId !== localEffect.characterId ||
        (event.resource !== 'characterRow' && !(createsTranscript && event.resource === 'chatTranscript')) ||
        (reorders ? event.id !== undefined : event.id !== localEffect.targetId)
      ) {
        return false
      }
      if (
        reorders &&
        (!Array.isArray(localEffect.attemptedIds) ||
          localEffect.attemptedIds.some((id) => typeof id !== 'string' || id.trim() === '') ||
          new Set(localEffect.attemptedIds).size !== localEffect.attemptedIds.length)
      ) {
        return false
      }
      if (!reorders && (typeof localEffect.targetId !== 'string' || localEffect.targetId.trim() === '')) return false

      if (createsTranscript) {
        const attemptedGenerationSettings = localEffect.attemptedGenerationSettings
        const generationSettings = localEffect.generationSettings
        if (
          !Object.prototype.hasOwnProperty.call(localEffect, 'attemptedGenerationSettings') ||
          !Object.prototype.hasOwnProperty.call(localEffect, 'generationSettings') ||
          (attemptedGenerationSettings !== null &&
            (!attemptedGenerationSettings ||
              typeof attemptedGenerationSettings !== 'object' ||
              Array.isArray(attemptedGenerationSettings))) ||
          (generationSettings !== null &&
            (!generationSettings || typeof generationSettings !== 'object' || Array.isArray(generationSettings)))
        ) {
          return false
        }
      }

      let createdChatMatches: Array<{ characterId: string; message: unknown }> = []
      if (createsTranscript) {
        createdChatMatches = (getDatabase().characters ?? []).flatMap((character) =>
          (character.chats ?? [])
            .filter((chat) => chat.id === localEffect.targetId)
            .map((chat) => ({ characterId: character.chaId, message: chat.message })),
        )
        if (
          createdChatMatches.length !== 1 ||
          createdChatMatches[0].characterId !== localEffect.characterId ||
          !Array.isArray(createdChatMatches[0].message)
        ) {
          return false
        }
      }

      return withServerResourceApply(() => {
        if (
          !applyCharacterRowMutationLocalEffect({
            revision: event.revision,
            characterId: localEffect.characterId,
            targetId: localEffect.targetId ?? localEffect.characterId,
          })
        ) {
          return false
        }
        if (createsTranscript && localEffect.targetId) {
          const createdChat = (getDatabase().characters ?? [])
            .find((character) => character.chaId === localEffect.characterId)
            ?.chats?.find((chat) => chat.id === localEffect.targetId)
          if (
            createdChat &&
            JSON.stringify(createdChat.generationSettings ?? null) ===
              JSON.stringify(localEffect.attemptedGenerationSettings)
          ) {
            if (localEffect.generationSettings === null) {
              delete createdChat.generationSettings
            } else {
              createdChat.generationSettings = JSON.parse(
                JSON.stringify(localEffect.generationSettings),
              ) as typeof createdChat.generationSettings
            }
          }
          return acknowledgeCreatedChatTranscriptLocalEffect(localEffect.targetId)
        }
        if (localEffect.operation === 'delete' && localEffect.targetId) {
          invalidateChatHydration(localEffect.targetId)
        }
        return true
      })
    }
    case 'settingsPatch': {
      const writesHypaV3Presets = Object.prototype.hasOwnProperty.call(localEffect.attemptedPatch, 'hypaV3Presets')
      if (
        event.type !== 'settings.updated' ||
        event.resource !== (writesHypaV3Presets ? 'settingsWithHypaV3Presets' : 'settings') ||
        event.id !== localEffect.group ||
        event.parentId !== undefined
      ) {
        return false
      }
      if (
        !Number.isInteger(localEffect.settingsProjectionEpoch) ||
        localEffect.settingsProjectionEpoch < 0 ||
        hasSettingsGroupProjectionEpochChanged(localEffect.group, localEffect.settingsProjectionEpoch) ||
        isSettingsGroupAcknowledgementTainted(localEffect.group)
      ) {
        return false
      }
      return withServerResourceApply(() =>
        applySettingsPatchLocalEffect({
          revision: event.revision,
          group: localEffect.group,
          attemptedPatch: localEffect.attemptedPatch,
          settings: localEffect.settings,
        }),
      )
    }
    case 'pluginStorage': {
      const expectedType =
        localEffect.operation === 'put'
          ? 'pluginStorage.updated'
          : localEffect.operation === 'delete'
            ? 'pluginStorage.deleted'
            : 'pluginStorage.bulkUpdated'
      if (event.resource !== 'pluginStorage' || event.type !== expectedType) return false
      if (localEffect.operation === 'bulk' ? event.id !== undefined : event.id !== localEffect.key) return false
      return withServerResourceApply(() => applyPluginStorageLocalEffect({ revision: event.revision }))
    }
    case 'pluginCollectionMutation': {
      const expectedType =
        localEffect.operation === 'create'
          ? 'plugin.created'
          : localEffect.operation === 'update'
            ? 'plugin.updated'
            : localEffect.operation === 'delete'
              ? 'plugin.deleted'
              : localEffect.operation === 'enable'
                ? 'plugin.enabled'
                : 'plugin.reordered'
      if (event.resource !== 'pluginCollection' || event.type !== expectedType) return false
      if (localEffect.operation === 'reorder' ? event.id !== undefined : event.id !== localEffect.pluginId) return false
      return withServerResourceApply(() =>
        applyPluginCollectionMutationLocalEffect({
          revision: event.revision,
          operation: localEffect.operation,
          pluginId: localEffect.pluginId,
          pluginIds: localEffect.pluginIds,
        }),
      )
    }
    case 'pluginProvider':
      if (
        event.type !== 'plugin.provider.selected' ||
        event.resource !== 'pluginProvider' ||
        event.id !== localEffect.provider
      ) {
        return false
      }
      return withServerResourceApply(() =>
        applyPluginProviderLocalEffect({ revision: event.revision, provider: localEffect.provider }),
      )
    case 'moduleCollectionMutation': {
      const expectedType =
        localEffect.operation === 'create'
          ? 'module.created'
          : localEffect.operation === 'update'
            ? 'module.updated'
            : localEffect.operation === 'reorder'
              ? 'module.reordered'
              : localEffect.operation === 'lorebooks'
                ? 'lorebook.entries.replaced'
                : localEffect.operation === 'scripts'
                  ? 'scriptDefinitions.replaced'
                  : 'triggerDefinitions.replaced'
      const expectedResource =
        localEffect.operation === 'create'
          ? 'moduleCreated'
          : localEffect.operation === 'reorder'
            ? 'moduleReordered'
            : localEffect.operation === 'scripts'
              ? 'moduleScriptDefinition'
              : localEffect.operation === 'triggers'
                ? 'moduleTriggerDefinition'
                : 'moduleUpdated'
      if (event.type !== expectedType || event.resource !== expectedResource || event.parentId !== undefined) {
        return false
      }
      if (localEffect.operation === 'reorder' ? event.id !== undefined : event.id !== localEffect.moduleId) {
        return false
      }
      const definitionProjectionEpoch = localEffect.collectionProjectionEpoch
      if (
        (localEffect.operation === 'scripts' || localEffect.operation === 'triggers') &&
        (typeof definitionProjectionEpoch !== 'number' ||
          !Number.isInteger(definitionProjectionEpoch) ||
          definitionProjectionEpoch < 0 ||
          hasCollectionProjectionEpochChanged('modules', definitionProjectionEpoch))
      ) {
        return false
      }
      return withServerResourceApply(() =>
        applyModuleCollectionMutationLocalEffect({
          revision: event.revision,
          operation: localEffect.operation,
          moduleId: localEffect.moduleId,
          moduleIds: localEffect.moduleIds,
        }),
      )
    }
    case 'moduleEnabled':
      if (
        event.type !== 'module.enabled' ||
        event.resource !== 'moduleEnabled' ||
        event.id !== localEffect.moduleId ||
        event.parentId !== undefined
      ) {
        return false
      }
      return withServerResourceApply(() =>
        applyModuleEnabledLocalEffect({
          revision: event.revision,
          moduleId: localEffect.moduleId,
          enabled: localEffect.enabled,
        }),
      )
    case 'promptItemMutation': {
      const expectedType = {
        create: 'prompt.item.created',
        update: 'prompt.item.updated',
        delete: 'prompt.item.deleted',
        reorder: 'prompt.item.reordered',
        enable: 'prompt.item.enabled',
      }[localEffect.operation]
      const collectionName = localEffect.promptPresetId === null ? 'promptTemplate' : 'promptPresets'
      const itemOperation =
        localEffect.operation === 'create' || localEffect.operation === 'update' || localEffect.operation === 'delete'
      if (
        expectedType === undefined ||
        event.type !== expectedType ||
        event.resource !== 'promptItem' ||
        event.parentId !== (localEffect.promptPresetId ?? undefined) ||
        (itemOperation ? event.id !== localEffect.itemId : event.id !== undefined) ||
        (localEffect.promptPresetId !== null &&
          (typeof localEffect.promptPresetId !== 'string' || localEffect.promptPresetId.trim() === '')) ||
        !Number.isInteger(localEffect.collectionProjectionEpoch) ||
        localEffect.collectionProjectionEpoch < 0 ||
        !Number.isInteger(localEffect.ownerProjectionEpoch) ||
        localEffect.ownerProjectionEpoch < 0 ||
        hasCollectionProjectionEpochChanged(collectionName, localEffect.collectionProjectionEpoch) ||
        hasPromptTemplateOwnerProjectionEpochChanged(localEffect.promptPresetId, localEffect.ownerProjectionEpoch) ||
        !isPromptTemplateHydrated(localEffect.promptPresetId) ||
        isPromptTemplateOwnerAcknowledgementTainted(localEffect.promptPresetId) ||
        peekPromptTemplateOwnerRevision(localEffect.promptPresetId) === null
      ) {
        return false
      }

      return withServerResourceApply(() => {
        if (
          !applyPromptItemMutationLocalEffect({
            revision: event.revision,
            operation: localEffect.operation,
            promptPresetId: localEffect.promptPresetId,
            itemId: localEffect.itemId,
            itemIds: localEffect.itemIds,
            enabled: localEffect.enabled,
            ownerState: localEffect.ownerState,
          })
        ) {
          return false
        }
        markPromptTemplateProjectionApplied(localEffect.promptPresetId, event.revision, {
          advanceProjectionEpoch: false,
        })
        return true
      })
    }
    case 'splitPresetPatch': {
      const collectionName = localEffect.presetKind === 'model' ? 'modelPresets' : 'promptPresets'
      const expectedType = localEffect.presetKind === 'model' ? 'modelPreset.updated' : 'promptPreset.updated'
      const expectedResource = localEffect.presetKind === 'model' ? 'modelPreset' : 'promptPreset'
      const selectedModelPresetId = currentSplitPresetId('model')
      const selectedPromptPresetId = currentSplitPresetId('prompt')
      const selectedPresetId = localEffect.presetKind === 'model' ? selectedModelPresetId : selectedPromptPresetId
      if (
        event.type !== expectedType ||
        event.resource !== expectedResource ||
        event.id !== localEffect.presetId ||
        event.parentId !== undefined ||
        !Number.isInteger(localEffect.collectionProjectionEpoch) ||
        localEffect.collectionProjectionEpoch < 0 ||
        hasCollectionProjectionEpochChanged(collectionName, localEffect.collectionProjectionEpoch) ||
        isCollectionAcknowledgementTainted(collectionName) ||
        selectedPresetId !== localEffect.selectedPresetId ||
        (localEffect.presetKind === 'model' && selectedPromptPresetId !== localEffect.selectedPromptPresetId)
      ) {
        return false
      }
      if (
        localEffect.selectedProjectionApplied &&
        (!Number.isInteger(localEffect.settingsProjectionEpoch) ||
          localEffect.settingsProjectionEpoch < 0 ||
          hasSettingsProjectionEpochChanged(localEffect.settingsProjectionEpoch) ||
          isSettingsAcknowledgementTainted() ||
          selectedPresetId !== localEffect.presetId)
      ) {
        return false
      }
      if (localEffect.ownerProjectionApplied) {
        if (
          localEffect.presetKind !== 'prompt' ||
          selectedPromptPresetId !== localEffect.presetId ||
          !Number.isInteger(localEffect.promptOwnerProjectionEpoch) ||
          (localEffect.promptOwnerProjectionEpoch as number) < 0 ||
          !Number.isInteger(localEffect.promptOwnerRevision) ||
          (localEffect.promptOwnerRevision as number) < 0 ||
          hasPromptTemplateOwnerProjectionEpochChanged(
            localEffect.presetId,
            localEffect.promptOwnerProjectionEpoch as number,
          ) ||
          !isPromptTemplateHydrated(localEffect.presetId) ||
          isPromptTemplateOwnerAcknowledgementTainted(localEffect.presetId) ||
          peekPromptTemplateOwnerRevision(localEffect.presetId) !== localEffect.promptOwnerRevision ||
          !selectedPromptPresetOwnsTemplate(localEffect.presetId)
        ) {
          return false
        }
      }

      return withServerResourceApply(() => {
        if (
          !applySplitPresetPatchLocalEffect({
            revision: event.revision,
            presetKind: localEffect.presetKind,
            presetId: localEffect.presetId,
            attemptedPatch: localEffect.attemptedPatch,
            preset: localEffect.preset,
            attemptedSettings: localEffect.attemptedSettings,
            settings: localEffect.settings,
            selectedProjectionApplied: localEffect.selectedProjectionApplied,
            ownerProjectionApplied: localEffect.ownerProjectionApplied,
          })
        ) {
          return false
        }
        if (localEffect.ownerProjectionApplied) {
          markPromptTemplateProjectionApplied(localEffect.presetId, event.revision, {
            advanceProjectionEpoch: false,
          })
        }
        return true
      })
    }
    case 'globalLorebookMutation': {
      const expectedType =
        localEffect.operation === 'create'
          ? 'lorebook.created'
          : localEffect.operation === 'update'
            ? 'lorebook.updated'
            : localEffect.operation === 'delete'
              ? 'lorebook.deleted'
              : localEffect.operation === 'reorder'
                ? 'lorebook.reordered'
                : 'lorebook.selected'
      if (event.type !== expectedType || event.resource !== 'globalLorebook' || event.parentId !== undefined) {
        return false
      }

      const changesCollection = localEffect.operation !== 'select'
      const changesPage =
        localEffect.operation === 'delete' || localEffect.operation === 'reorder' || localEffect.operation === 'select'
      if (
        changesCollection &&
        (typeof localEffect.collectionProjectionEpoch !== 'number' ||
          !Number.isInteger(localEffect.collectionProjectionEpoch) ||
          localEffect.collectionProjectionEpoch < 0 ||
          hasCollectionProjectionEpochChanged('loreBook', localEffect.collectionProjectionEpoch))
      ) {
        return false
      }
      if (
        changesPage &&
        (typeof localEffect.pageProjectionEpoch !== 'number' ||
          !Number.isInteger(localEffect.pageProjectionEpoch) ||
          localEffect.pageProjectionEpoch < 0 ||
          hasLorebookPageProjectionEpochChanged(localEffect.pageProjectionEpoch))
      ) {
        return false
      }

      if (localEffect.operation === 'reorder') {
        if (
          event.id !== undefined ||
          !Array.isArray(localEffect.lorebookIds) ||
          localEffect.lorebookIds.some((id) => typeof id !== 'string' || id.trim() === '') ||
          new Set(localEffect.lorebookIds).size !== localEffect.lorebookIds.length ||
          (localEffect.selectedLorebookId !== null &&
            (typeof localEffect.selectedLorebookId !== 'string' ||
              localEffect.selectedLorebookId.trim() === '' ||
              !localEffect.lorebookIds.includes(localEffect.selectedLorebookId)))
        ) {
          return false
        }
      } else if (
        typeof localEffect.lorebookId !== 'string' ||
        localEffect.lorebookId.trim() === '' ||
        event.id !== localEffect.lorebookId ||
        (localEffect.operation === 'select' && localEffect.selectedLorebookId !== localEffect.lorebookId)
      ) {
        return false
      }

      return withServerResourceApply(() =>
        applyGlobalLorebookMutationLocalEffect({
          revision: event.revision,
          operation: localEffect.operation,
          lorebookId: localEffect.lorebookId,
          lorebookIds: localEffect.lorebookIds,
          selectedLorebookId: localEffect.selectedLorebookId,
        }),
      )
    }
    case 'lorebookMutation': {
      if (
        localEffect.operation !== 'replace' &&
        localEffect.operation !== 'upsert' &&
        localEffect.operation !== 'delete' &&
        localEffect.operation !== 'reorder'
      ) {
        return false
      }

      if (localEffect.scope === 'global') {
        if (
          event.type !== 'lorebook.entries.replaced' ||
          event.resource !== 'globalLorebook' ||
          event.id !== localEffect.lorebookId ||
          event.parentId !== undefined ||
          typeof localEffect.collectionProjectionEpoch !== 'number' ||
          !Number.isInteger(localEffect.collectionProjectionEpoch) ||
          localEffect.collectionProjectionEpoch < 0 ||
          hasCollectionProjectionEpochChanged('loreBook', localEffect.collectionProjectionEpoch)
        ) {
          return false
        }
      } else if (localEffect.scope === 'character') {
        if (
          event.type !== 'lorebook.entries.replaced' ||
          event.resource !== 'characterLorebook' ||
          event.id !== localEffect.characterId ||
          event.parentId !== undefined ||
          typeof localEffect.characterRowProjectionEpoch !== 'number' ||
          !Number.isInteger(localEffect.characterRowProjectionEpoch) ||
          localEffect.characterRowProjectionEpoch < 0 ||
          typeof localEffect.characterLorebookProjectionEpoch !== 'number' ||
          !Number.isInteger(localEffect.characterLorebookProjectionEpoch) ||
          localEffect.characterLorebookProjectionEpoch < 0 ||
          typeof localEffect.characterId !== 'string' ||
          !isCharacterLorebookHydrated(localEffect.characterId) ||
          hasCharacterRowProjectionEpochChanged(localEffect.characterId, localEffect.characterRowProjectionEpoch) ||
          hasCharacterLorebookProjectionEpochChanged(
            localEffect.characterId,
            localEffect.characterLorebookProjectionEpoch,
          )
        ) {
          return false
        }
      } else if (
        localEffect.scope !== 'chat' ||
        event.type !== 'lorebook.entries.replaced' ||
        event.resource !== 'characterRow' ||
        event.id !== localEffect.chatId ||
        event.parentId !== localEffect.characterId ||
        typeof localEffect.characterId !== 'string' ||
        typeof localEffect.characterRowProjectionEpoch !== 'number' ||
        !Number.isInteger(localEffect.characterRowProjectionEpoch) ||
        localEffect.characterRowProjectionEpoch < 0 ||
        hasCharacterRowProjectionEpochChanged(localEffect.characterId, localEffect.characterRowProjectionEpoch)
      ) {
        return false
      }

      return withServerResourceApply(() =>
        applyLorebookMutationLocalEffect({
          revision: event.revision,
          scope: localEffect.scope,
          operation: localEffect.operation,
          lorebookId: localEffect.lorebookId,
          characterId: localEffect.characterId,
          chatId: localEffect.chatId,
        }),
      )
    }
    case 'loadoutMutation': {
      const expectedType = {
        create: 'loadout.created',
        delete: 'loadout.deleted',
        favorite: 'loadout.favorited',
        touch: 'loadout.touched',
      }[localEffect.operation]
      if (
        event.type !== expectedType ||
        event.resource !== 'loadout' ||
        event.id !== localEffect.loadoutId ||
        event.parentId !== undefined ||
        typeof localEffect.loadoutsProjectionEpoch !== 'number' ||
        !Number.isInteger(localEffect.loadoutsProjectionEpoch) ||
        localEffect.loadoutsProjectionEpoch < 0 ||
        hasCollectionProjectionEpochChanged('loadouts', localEffect.loadoutsProjectionEpoch)
      ) {
        return false
      }
      if (
        localEffect.operation === 'touch' &&
        (typeof localEffect.settingsProjectionEpoch !== 'number' ||
          !Number.isInteger(localEffect.settingsProjectionEpoch) ||
          localEffect.settingsProjectionEpoch < 0 ||
          typeof localEffect.loadedName !== 'string' ||
          localEffect.loadedName.trim() === '' ||
          hasSettingsGroupProjectionEpochChanged('sidebar', localEffect.settingsProjectionEpoch))
      ) {
        return false
      }
      return withServerResourceApply(() =>
        applyLoadoutMutationLocalEffect({
          revision: event.revision,
          operation: localEffect.operation,
          loadoutId: localEffect.loadoutId,
        }),
      )
    }
    case 'characterDefinitionMutation': {
      const expectedType =
        localEffect.operation === 'scripts' ? 'scriptDefinitions.replaced' : 'triggerDefinitions.replaced'
      if (
        event.type !== expectedType ||
        event.resource !== 'characterRow' ||
        event.id !== localEffect.characterId ||
        event.parentId !== undefined ||
        !Number.isInteger(localEffect.optimisticRowEpoch) ||
        localEffect.optimisticRowEpoch < 0 ||
        hasCharacterRowProjectionEpochChanged(localEffect.characterId, localEffect.optimisticRowEpoch)
      ) {
        return false
      }
      return withServerResourceApply(() =>
        applyCharacterRowMutationLocalEffect({
          revision: event.revision,
          characterId: localEffect.characterId,
          targetId: localEffect.characterId,
        }),
      )
    }
    case 'messageTranslation':
      if (
        event.type !== 'message.updated' ||
        event.resource !== 'message' ||
        event.id !== localEffect.messageId ||
        event.parentId !== localEffect.chatId
      ) {
        return false
      }
      return withServerResourceApply(() =>
        applyMessageTranslationLocalEffect(localEffect.chatId, localEffect.messageId, localEffect.translation),
      )
    case 'messageMutation': {
      const expectedType =
        localEffect.operation === 'append'
          ? 'message.appended'
          : localEffect.operation === 'update'
            ? 'message.updated'
            : localEffect.operation === 'delete'
              ? 'message.deleted'
              : localEffect.operation === 'truncate'
                ? 'message.truncated'
                : 'messages.replaced'
      if (
        event.type !== expectedType ||
        event.resource !== 'message' ||
        event.parentId !== localEffect.chatId ||
        (localEffect.messageId === undefined ? event.id !== undefined : event.id !== localEffect.messageId) ||
        !Number.isInteger(localEffect.chatBodyProjectionEpoch) ||
        localEffect.chatBodyProjectionEpoch < 0 ||
        hasChatBodyProjectionEpochChanged(localEffect.chatId, localEffect.chatBodyProjectionEpoch)
      ) {
        return false
      }
      return withServerResourceApply(() => acknowledgeMessageMutationLocalEffect(localEffect.chatId))
    }
    case 'characterRowMutation': {
      const expectedType =
        localEffect.operation === 'chatFolderUpdate' ? 'chatFolder.updated' : 'chat.scriptstate.updated'
      if (
        event.type !== expectedType ||
        event.resource !== 'characterRow' ||
        event.id !== localEffect.targetId ||
        event.parentId !== localEffect.characterId
      ) {
        return false
      }
      return withServerResourceApply(() =>
        applyCharacterRowMutationLocalEffect({
          revision: event.revision,
          characterId: localEffect.characterId,
          targetId: localEffect.targetId,
        }),
      )
    }
    case 'characterOrder':
      if (event.type !== 'character.reordered' || event.resource !== 'characterOrder' || event.id !== undefined) {
        return false
      }
      return withServerResourceApply(() =>
        applyCharacterOrderLocalEffect({ revision: event.revision, attemptedOrder: localEffect.attemptedOrder }),
      )
  }
}

function currentSplitPresetId(kind: 'model' | 'prompt'): string | null {
  const database = getDatabase()
  const presets = kind === 'model' ? database.modelPresets : database.promptPresets
  const selectedIndex = kind === 'model' ? database.modelPresetsId : database.promptPresetsId
  if (!Number.isInteger(selectedIndex) || selectedIndex < 0 || !Array.isArray(presets)) return null
  const id = presets[selectedIndex]?.id
  return typeof id === 'string' && id.trim() !== '' ? id : null
}

function currentPresetReorderSelection(kind: PresetReorderLocalEffect['presetKind']): string | null {
  if (kind === 'model') return currentSplitPresetId('model')
  const database = getDatabase()
  const selectedIndex = database.botPresetsId
  if (!Number.isInteger(selectedIndex) || selectedIndex < 0 || !Array.isArray(database.botPresets)) return null
  const id = database.botPresets[selectedIndex]?.id
  return typeof id === 'string' && id.trim() !== '' ? id : null
}

function selectedPromptPresetOwnsTemplate(promptPresetId: string): boolean {
  const database = getDatabase()
  const selectedIndex = database.promptPresetsId
  if (!Number.isInteger(selectedIndex) || selectedIndex < 0) return false
  const preset = database.promptPresets?.[selectedIndex] as Record<string, unknown> | undefined
  return preset?.id === promptPresetId && Object.prototype.hasOwnProperty.call(preset, 'promptTemplate')
}

async function processAuthoritativeServerCommandEvents(events: readonly CommandEvent[]): Promise<boolean> {
  if (events.length === 0) return true

  if (events.some(isDatabaseReplacementEvent)) {
    const reconciliation = await reconcileReplacementDatabaseOwnership()
    if (reconciliation === null) {
      scheduleServerResourceReconnect()
      return false
    }
    if (
      !reconciliation.ownershipChanged &&
      !isReplacementDatabaseOwnershipRefreshPending(reconciliation.ownership) &&
      wasReplacementDatabaseOwnershipRefreshed(reconciliation.ownership)
    ) {
      return true
    }
    const refresh = await forceServerDatabaseReplacementRefresh('database-replacement-event', {
      resource: 'state',
    })
    if (refresh.status === 'ok') {
      markReplacementDatabaseOwnershipRefreshed(reconciliation.ownership)
      return true
    }
    if (refresh.status === 'error') {
      console.warn(`Server database replacement refresh failed: ${refresh.error}`)
    }
    scheduleServerResourceReconnect()
    return false
  }

  const selectionTracker = trackSelectedCharacterDuringRefresh()
  try {
    const result = await refreshInvalidatedServerResources(events, {
      appliedRevision: peekAppliedServerResourceRevision(),
      hooks: serverResourceInvalidationHooks,
    })

    if (result.status !== 'ok') {
      if (result.status === 'error') console.warn(`Server resource invalidation failed: ${result.error}`)
      scheduleServerResourceReconnect()
      return false
    }
    if (result.scope === 'none') return true

    reconcileSelectedCharacterAfterResourceRefresh(events, selectionTracker.snapshot())

    if (result.scope === 'full') {
      // Full character projections omit chat bodies. Clear their hydration
      // identities before prompt-template hydration can fail so the active
      // transcript is still fetched from its body endpoint.
      resetChatHydration()
      resetLorebookHydration()
      recordHydratedCharacterLorebooks(getDatabase().characters)
      void hydrateActiveChat({ force: true })
    } else {
      recordHydratedCharacterLorebooks(getDatabase().characters)
    }

    if (
      result.scope === 'full' &&
      !(await ensurePromptTemplateHydrated({ force: true, minimumRevision: result.revision }))
    ) {
      console.warn('Server resource invalidation failed: selected prompt-template owner hydration failed')
      scheduleServerResourceReconnect()
      return false
    }

    if (result.scope === 'full') {
      triggerOpenChatGenerationReattach()
    }

    advanceKnownServerCommandRevision(result.revision)
    setAppliedServerResourceRevision(result.revision)
    return true
  } finally {
    selectionTracker.stop()
  }
}

function isDatabaseReplacementEvent(event: CommandEvent): boolean {
  return event.type === 'state.restored' || event.type === 'state.imported'
}

async function reconcileReplacementDatabaseOwnership(): Promise<{
  ownership: ReplacementDatabaseOwnership
  ownershipChanged: boolean
} | null> {
  await waitForLocalReplacementDatabaseOperations()
  const runtime = await fetchServerBootstrapReadOnly(null, { cacheRevision: false })
  if (runtime.status !== 'ok') {
    if (runtime.status === 'error') {
      console.warn(`Server database ownership refresh failed: ${runtime.error}`)
    }
    return null
  }
  const { databaseLineage, writerEpoch } = runtime.bootstrap
  if (!databaseLineage || typeof writerEpoch !== 'number' || !Number.isSafeInteger(writerEpoch) || writerEpoch < 0) {
    console.warn('Server database ownership refresh failed: bootstrap ownership metadata is missing')
    return null
  }
  const ownership = {
    databaseLineage,
    writerEpoch,
  }
  const adoption = await adoptReplacementDatabaseOwnership(ownership)
  if (adoption.discarded > 0) alertError(language.backupQueuedChangesDiscarded)
  return { ownership, ownershipChanged: adoption.ownershipChanged }
}

function reconcileSelectedCharacterAfterResourceRefresh(
  events: readonly CommandEvent[],
  selection: SelectedCharacterRefreshSnapshot,
): void {
  const database = getDatabase()
  if (!selection.selectionChanged && events.some((event) => event.resource === 'characterSelection')) {
    selectedCharID.set(initialSelectedCharFromDatabase(database))
    return
  }
  if (selection.target.selectedIndex < 0) return

  selectedCharID.set(resolveSelectedCharacterIndexAfterRefresh(selection.target))
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
export function createGlobalErrorHandlers() {
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
  return { errorHandler, rejectHandler }
}

function updateErrorHandling() {
  const { errorHandler, rejectHandler } = createGlobalErrorHandlers()
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
