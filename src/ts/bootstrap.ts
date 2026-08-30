import { get } from 'svelte/store'
import { getDatabase, setResourceWriteGuardEnabled, type Database } from './storage/database.svelte'
import { botMakerMode } from './stores.svelte'
import { LoadingStatusState, selectedCharID } from './stores/coreStores.svelte'
import { currentRoute } from './router'
import { isPreWriterObserverShellEnabled } from './observerShellFlag'
import {
  isPluginRuntimeReady,
  loadPlugins,
  startPluginRuntimeSync,
  stopPluginRuntimeSync,
} from './plugins/plugins.svelte'
import { alertError, alertMd, alertRequiredSelect, waitAlert } from './alert'
import { updateReducedMotion } from './gui/animation'
import { updateColorScheme, updateTextThemeAndCSS } from './gui/colorscheme'
import { language } from 'src/lang'
import { resolveUniquePromptPreset } from '@risuai/shared-core/effective-prompt-template'
import { updateGuisize } from './gui/guisize'
import { fetchServerBootstrap, fetchServerBootstrapReadOnly, type ServerBootstrapRuntime } from './server/bootstrap'
import { subscribeServerCommandEvents, type ServerMemoryEvent, type ServerMemoryJobSnapshot } from './server/events'
import { publishServerMemoryJobEvent } from './server/memoryJobEvents'
import { publishServerBardWikiJobEvent, publishServerBardWikiJobSnapshot } from './server/bardWikiJobEvents'
import {
  deferOwnServerCommandReconciliation,
  initializeServerDatabaseForBootstrap,
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
  beginWriterAccessRecovery,
  completeWriterAccessRecovery,
  enterWriterTakeoverFlow,
  getActiveWriterSessionId,
  peekActiveWriterSessionId,
} from './server/activeWriterSession'
import { observerShellLifecycleStore, setObserverShellLifecycleMode } from './observerShellLifecycle.svelte'
import { startBridgePatchLifecycleFlush } from './server/bridgeFlush'
import { replayPendingMutations } from './server/pendingMutationReplay'
import { applyGenerationOperationBootstrap, configureGenerationOperationProtocol } from './server/generationOperations'
import { configureDisplaySourceProtocol } from './server/displaySources'
import {
  countBlockingPendingMutationRecords,
  preparePendingMutationOutbox,
  readSinglePendingMutationOwner,
} from './server/pendingMutationOutbox'
import { initializeDraftRecoveryScope } from './server/draftRecoveryScope'
import {
  flushPendingMutationReceiptAcknowledgements,
  setPendingMutationDiscardNotifier,
} from './server/durableMutationDispatch'
import {
  acknowledgeCreatedChatTranscriptLocalEffect,
  acknowledgeMessageMutationLocalEffect,
  applyMessageTranslationLocalEffect,
  hydrateActiveChat,
  invalidateChatHydration,
  resetChatHydration,
  requestActiveChatReadinessRefresh,
  setActiveChatReadinessRefreshHook,
  startChatMessageHydration,
  stopChatMessageHydration,
} from './server/chatMessageHydration.svelte'
import {
  hydrateSelectedCharacterShell,
  startSelectedCharacterShellHydration,
  stopSelectedCharacterShellHydration,
} from './server/characterShellHydration.svelte'
import {
  isCharacterLorebookHydrated,
  recordHydratedCharacterLorebooks,
  resetLorebookHydration,
} from './server/lorebookBridge.svelte'
import {
  prepareOpenChatGenerationReattach,
  setActiveGenerationReattachReadinessPredicate,
  startActiveGenerationReattach,
  stopActiveGenerationReattach,
  triggerOpenChatGenerationReattach,
} from './process/reattach'
import { subscribeBrowserLifecycleRecovery } from './server/lifecycleRecovery'
import {
  setGenerationFinalizationPersistences,
  startGenerationFinalizationPersistenceRefresh,
  stopGenerationFinalizationPersistenceRefresh,
} from './process/generationPersistenceState'
import {
  setActiveMessageTranslations,
  startActiveMessageTranslationRefresh,
  stopActiveMessageTranslationRefresh,
} from './server/messageTranslationJobs'
import {
  setActiveGreetingTranslations,
  startActiveGreetingTranslationRefresh,
  stopActiveGreetingTranslationRefresh,
} from './server/greetingTranslations.svelte'
import { applyServerMemoryJobEvent, applyServerMemoryJobSnapshot } from './server/memoryJobProjection.svelte'
import { loadInitialServerResources, refreshInvalidatedServerResources } from './server/resourceInvalidation'
import { ensureResourceSurfaces, stopRouteResourceLoader } from './server/routeResourceLoader'
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
import {
  reconcilePendingRecoveredGenerationEffects,
  setPendingRecoveredGenerationEffects,
} from './process/recoveredGenerationEffects'
import {
  backgroundReady,
  beginStartupAttempt,
  canRenderShell,
  canMutate,
  completeStartupAttempt,
  configureStartupObserverShell,
  failStartupAttempt,
  recordStartupCapabilityFailure,
  recordStartupMilestone,
  restoreStartupWriterCapabilities,
  retryStartupCapability,
  runStartupStep,
  settleStartupChatReadiness,
  settleStartupGenerationRecoveryReadiness,
  startupRetryTargetForMilestone,
  type StartupAttemptFailureCode,
  type StartupMilestone,
  type StartupRetryTarget,
} from './startupReadiness'
import { startStartupTelemetryPublisher } from './server/startupTelemetry'

setPendingMutationDiscardNotifier((key, error) => {
  alertError(`${language.pendingMutationDiscarded}\n\n${language.pendingMutationDiscardedDetail(key, error)}`)
})

const COLOR_SCHEME_RUNTIME_KEYS = new Set(['colorScheme', 'colorSchemeName', 'customBackground'])
const TEXT_THEME_RUNTIME_KEYS = new Set(['textTheme', 'customTextTheme', 'font', 'customFont', 'customCSS'])
const GUI_SIZE_RUNTIME_KEYS = new Set(['textAreaSize', 'textAreaTextSize', 'sideBarSize'])

class FatalBootstrapError extends Error {}

class StartupChatDependencyError extends Error {
  constructor(
    readonly failureCode: Extract<
      StartupAttemptFailureCode,
      | 'selected-character-hydration-failed'
      | 'selected-chat-hydration-failed'
      | 'selected-prompt-template-hydration-failed'
    >,
    message: string,
  ) {
    super(message)
  }
}

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
  if (backgroundReady() && keys.includes('notification')) {
    void reconcileProjectedPushNotificationSetting(getDatabase().notification === true)
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
let stopStartupChatReadinessSync: (() => void) | null = null
let startupChatReadinessEpoch = 0
let startupChatReadinessTarget: string | null = null
let startupChatReattachReady = false
let startupGenerationRecoveryReady = false
let stopStoreRuntimeEffects: (() => void) | null = null
let stopDomObserver: (() => void) | null = null
let stopGlobalErrorHandlers: (() => void) | null = null
let stopPushRuntime: (() => void) | null = null

setActiveGenerationReattachReadinessPredicate(
  () => startupChatReattachReady && startupGenerationRecoveryReady && isPluginRuntimeReady(),
)

function initialSelectedCharFromDatabase(db: Database): number {
  const currentChar = (db as { currentChar?: unknown }).currentChar
  const characterCount = Array.isArray(db.characters) ? db.characters.length : 0
  if (Number.isInteger(currentChar) && (currentChar as number) >= 0 && (currentChar as number) < characterCount) {
    return currentChar as number
  }
  return -1
}

let loadDataInFlight: Promise<void> | null = null
let observerWriterPromotionRetryInFlight: Promise<boolean> | null = null

/**
 * Loads the application data. Concurrent callers share one attempt loop, and a
 * retry resumes at its failed capability because successful coordinator steps
 * are retained.
 */
export function loadData(): Promise<void> {
  startStartupTelemetryPublisher()
  if (backgroundReady()) return Promise.resolve()
  if (loadDataInFlight) return loadDataInFlight

  const running = loadDataUntilSettled().finally(() => {
    loadDataInFlight = null
  })
  loadDataInFlight = running
  return running
}

async function loadDataUntilSettled(): Promise<void> {
  let retryTarget: StartupRetryTarget | null = null
  while (!backgroundReady()) {
    const outcome = retryTarget
      ? await retryStartupCapability(retryTarget, runLoadDataAttempt)
      : await runLoadDataAttempt()
    if (!outcome) return
    retryTarget = outcome
  }
}

async function runLoadDataAttempt(): Promise<StartupRetryTarget | null> {
  const startupAttemptId = beginStartupAttempt()
  const failureCode: StartupAttemptFailureCode = 'writer-bootstrap-failed'
  const observerShellEnabled = isPreWriterObserverShellEnabled()
  configureStartupObserverShell(observerShellEnabled)
  try {
    if (observerShellEnabled) {
      await runStartupStep('observer-shell', loadPreWriterObserverShell)
    }
    await runStartupStep('writer-shell', () => loadWebInitialDatabase({ coordinated: true }))
    await runStartupStep('chat-hydration-runtime', () => {
      startSelectedCharacterShellHydration()
      startChatMessageHydration()
    })
    const backgroundReadiness = runStartupStep('background-readiness', () =>
      settleStartupBackgroundReadiness(startupAttemptId),
    )
    const pluginRuntimeReady = await settleStartupPluginRuntime(startupAttemptId)
    if (pluginRuntimeReady) await settleStartupGenerationRecovery(startupAttemptId)
    try {
      await runStartupStep('chat-readiness', ensureStartupChatReadiness)
      settleStartupChatReadiness(true)
    } catch (error) {
      const dependencyError =
        error instanceof StartupChatDependencyError
          ? error
          : new StartupChatDependencyError('selected-chat-hydration-failed', 'Selected chat hydration failed')
      recordStartupCapabilityFailure(startupAttemptId, dependencyError.failureCode, 'chat-ready')
      settleStartupChatReadiness(false)
      console.warn(dependencyError.message)
    }
    startStartupChatReadinessSync(startupAttemptId)
    await backgroundReadiness
    await reconcileProjectedPushNotificationSetting(getDatabase().notification === true)
    recordStartupMilestone('background-ready')
    completeStartupAttempt(startupAttemptId)
    return null
  } catch (error) {
    const observerReady = observerShellEnabled && canRenderShell()
    const failureMilestone: StartupMilestone = observerReady ? 'writer-ready' : 'observer-ready'
    if (
      observerShellEnabled &&
      get(observerShellLifecycleStore).mode !== 'takeover-denied' &&
      get(observerShellLifecycleStore).mode !== 'auth-lost'
    ) {
      setObserverShellLifecycleMode('unavailable')
    }
    failStartupAttempt(startupAttemptId, failureCode, failureMilestone)
    if (observerReady) {
      console.warn('Writer startup deferred while the observer shell remains available:', error)
      return null
    }
    alertError(error)
    await waitAlert()
    if (error instanceof FatalBootstrapError) return null
    return startupRetryTargetForMilestone(failureMilestone)
  }
}

async function loadPreWriterObserverShell(): Promise<boolean> {
  setObserverShellLifecycleMode('waiting')
  LoadingStatusState.text = 'Loading Server Data...'
  const runtime = await fetchServerBootstrapReadOnly(null, { cacheRevision: false })
  if (runtime.status !== 'ok' || !runtime.bootstrap.initialized) {
    if (runtime.status === 'error') console.warn(`Observer bootstrap failed: ${runtime.error}`)
    return false
  }

  // The observer projection is authenticated server state, not a recovered or
  // optimistic mutation. Install the guard before any part of it can render.
  setResourceWriteGuardEnabled(true)
  const resources = await loadInitialServerResources()
  if (resources.status !== 'ok') {
    if (resources.status === 'error') console.warn(`Observer shell load failed: ${resources.error}`)
    return false
  }

  const database = getDatabase()
  selectedCharID.set(initialSelectedCharFromDatabase(database))
  resetChatHydration()
  resetLorebookHydration()
  setAppliedServerResourceRevision(resources.revision)
  updateColorScheme()
  updateTextThemeAndCSS()
  updateReducedMotion()
  updateHeightMode()
  updateGuisize()
  if (database.botSettingAtStart) botMakerMode.set(true)
  recordStartupMilestone('observer-ready')
  return true
}

/** Idempotent targeted takeover/recovery used by the permanent observer UI. */
export function retryObserverWriterPromotion(): Promise<boolean> {
  if (observerWriterPromotionRetryInFlight) return observerWriterPromotionRetryInFlight

  const retry = (async () => {
    setObserverShellLifecycleMode('retrying')
    if (!backgroundReady()) {
      await loadData()
      return canMutate()
    }

    const startupAttemptId = beginStartupAttempt()
    const recoveringLostWriter = beginWriterAccessRecovery()
    try {
      await loadWebInitialDatabase()
      if (!serverResourceEventSubscription) {
        throw new Error('Server event subscription is unavailable')
      }
      startSelectedCharacterShellHydration()
      startChatMessageHydration()
      try {
        await ensureStartupChatReadiness()
        settleStartupChatReadiness(true)
      } catch (error) {
        const dependencyError =
          error instanceof StartupChatDependencyError
            ? error
            : new StartupChatDependencyError('selected-chat-hydration-failed', 'Selected chat hydration failed')
        recordStartupCapabilityFailure(startupAttemptId, dependencyError.failureCode, 'chat-ready')
        settleStartupChatReadiness(false)
      }
      startStartupChatReadinessSync(startupAttemptId)
      restoreStartupWriterCapabilities()
      if (recoveringLostWriter) completeWriterAccessRecovery(true)
      setObserverShellLifecycleMode('promoted')
      completeStartupAttempt(startupAttemptId)
      return canMutate()
    } catch (error) {
      stopFailedWriterPromotionRuntimes()
      if (recoveringLostWriter) completeWriterAccessRecovery(false)
      setObserverShellLifecycleMode('unavailable')
      failStartupAttempt(startupAttemptId, 'writer-bootstrap-failed', 'writer-ready')
      console.warn('Observer writer promotion retry failed:', error)
      return false
    }
  })().finally(() => {
    if (observerWriterPromotionRetryInFlight === retry) observerWriterPromotionRetryInFlight = null
  })

  observerWriterPromotionRetryInFlight = retry
  return retry
}

function stopFailedWriterPromotionRuntimes(): void {
  stopServerResourceEvents()
  stopActiveMessageTranslationRefresh()
  stopActiveGreetingTranslationRefresh()
  stopActiveGenerationReattach()
  stopGenerationFinalizationPersistenceRefresh()
  stopChatMessageHydration()
}

async function settleStartupPluginRuntime(startupAttemptId: number): Promise<boolean> {
  LoadingStatusState.text = 'Loading Plugins...'
  try {
    await runStartupStep('plugin-runtime', async () => {
      await ensureResourceSurfaces(['runtime:plugins'])
      await loadPlugins()
      startPluginRuntimeSync()
      recordStartupMilestone('plugins-ready')
    })
    return true
  } catch (error) {
    startupGenerationRecoveryReady = false
    settleStartupGenerationRecoveryReadiness(false)
    recordStartupCapabilityFailure(startupAttemptId, 'plugin-initialization-failed', 'plugins-ready')
    console.warn('Plugin runtime initialization failed:', error)
    return false
  }
}

async function settleStartupGenerationRecovery(startupAttemptId: number): Promise<boolean> {
  startupGenerationRecoveryReady = false
  try {
    await runStartupStep('generation-recovery', reconcilePendingRecoveredGenerationEffects)
    startupGenerationRecoveryReady = true
    settleStartupGenerationRecoveryReadiness(true)
    return true
  } catch (error) {
    startupGenerationRecoveryReady = false
    settleStartupGenerationRecoveryReadiness(false)
    recordStartupCapabilityFailure(startupAttemptId, 'generation-recovery-failed', 'chat-ready')
    console.warn('Generation recovery initialization failed:', error)
    return false
  }
}

/** Localized retry used by the plugin-readiness status surface. */
export function retryPluginStartup(): Promise<boolean> {
  return retryStartupCapability('pluginsReady', async () => {
    const startupAttemptId = beginStartupAttempt()
    const pluginRuntimeReady = await settleStartupPluginRuntime(startupAttemptId)
    if (!pluginRuntimeReady) {
      completeStartupAttempt(startupAttemptId)
      return false
    }

    const generationRecoveryReady = await settleStartupGenerationRecovery(startupAttemptId)
    if (generationRecoveryReady) {
      try {
        await runStartupStep('chat-readiness', ensureStartupChatReadiness)
        settleStartupChatReadiness(true)
      } catch (error) {
        const dependencyError =
          error instanceof StartupChatDependencyError
            ? error
            : new StartupChatDependencyError('selected-chat-hydration-failed', 'Selected chat hydration failed')
        recordStartupCapabilityFailure(startupAttemptId, dependencyError.failureCode, 'chat-ready')
        settleStartupChatReadiness(false)
      }
    }
    completeStartupAttempt(startupAttemptId)
    return generationRecoveryReady
  })
}

async function settleStartupBackgroundReadiness(startupAttemptId: number): Promise<void> {
  const resourceReadiness = ensureResourceSurfaces(['runtime:background-effects'])
  const results = await Promise.allSettled([
    runStartupStep('push-runtime', async () => {
      await resourceReadiness
      const pushRuntime = await import('./server/pushNotificationSetting')
      stopPushRuntime ??= pushRuntime.stopPushNotificationCoordinator
      const { initializePushNotificationCoordinator, reconcileChatCompletionPushNotificationSetting } = pushRuntime
      await initializePushNotificationCoordinator()
      await reconcileChatCompletionPushNotificationSetting(getDatabase().notification === true)
    }),
    runStartupStep('background-runtime', async () => {
      await resourceReadiness
      LoadingStatusState.text = 'Checking For Format Update...'

      LoadingStatusState.text = 'Updating States...'
      updateErrorHandling()
      if (!localStorage.getItem('nightlyWarned') && window.location.hostname === 'nightly.risuai.xyz') {
        alertMd(language.nightlyWarning)
        await waitAlert()
        //for testing, leave empty
        localStorage.setItem('nightlyWarned', '')
      }
      if (window.isSecureContext === false && localStorage.getItem('insecureOriginWarned') === null) {
        alertMd(language.insecureOriginWarning)
        await waitAlert()
        localStorage.setItem('insecureOriginWarned', 'true')
      }
      const [runtimeEffects, observer, modelList, modules, customBackground, legacyMemoryNotice] = await Promise.all([
        import('./stores/runtimeEffects.svelte'),
        import('./observer.svelte'),
        import('./model/modellist'),
        import('./process/modules'),
        import('./server/customBackgroundSetting'),
        import('./process/legacyMemoryMigrationNotice'),
      ])
      stopStoreRuntimeEffects ??= runtimeEffects.installStoreRuntimeEffects()
      stopDomObserver ??= observer.startObserveDom()
      customBackground.normalizeLegacyCustomBackgroundSetting()
      legacyMemoryNotice.showLegacyMemoryMigrationNoticeIfNeeded()
      await modelList.registerModelDynamic()
      modules.moduleUpdate()
    }),
  ])

  const labels = ['push runtime', 'optional background runtime'] as const
  const failureCodes: StartupAttemptFailureCode[] = ['push-initialization-failed', 'runtime-initialization-failed']
  results.forEach((result, index) => {
    if (result.status === 'rejected') {
      recordStartupCapabilityFailure(startupAttemptId, failureCodes[index]!, 'background-ready')
      console.warn(`Failed to initialize ${labels[index]}:`, result.reason)
    }
  })
}

/** App/remount cleanup for optional and plugin runtimes that may outlive SSE. */
export function stopDeferredStartupRuntimes(): void {
  stopGlobalErrorHandlers?.()
  stopGlobalErrorHandlers = null
  stopStoreRuntimeEffects?.()
  stopStoreRuntimeEffects = null
  stopDomObserver?.()
  stopDomObserver = null
  stopPushRuntime?.()
  stopPushRuntime = null
  stopPluginRuntimeSync()
  stopRouteResourceLoader()
}

async function reconcileProjectedPushNotificationSetting(enabled: boolean): Promise<void> {
  try {
    const pushRuntime = await import('./server/pushNotificationSetting')
    stopPushRuntime ??= pushRuntime.stopPushNotificationCoordinator
    await pushRuntime.reconcileChatCompletionPushNotificationSetting(enabled)
  } catch (error) {
    console.warn('Failed to reconcile projected push notification setting:', error)
  }
}

async function ensureStartupChatReadiness(): Promise<void> {
  startupChatReattachReady = false
  await ensureResourceSurfaces(['runtime:chat-generation'])
  if (!(await hydrateSelectedCharacterShell())) {
    throw new StartupChatDependencyError(
      'selected-character-hydration-failed',
      'Selected character detail hydration failed',
    )
  }
  if (!(await hydrateActiveChat())) {
    throw new StartupChatDependencyError('selected-chat-hydration-failed', 'Selected chat hydration failed')
  }
  const promptPresetId = currentStartupPromptTemplateOwnerId()
  if (
    !(await ensurePromptTemplateHydrated({
      ...(promptPresetId !== currentGlobalPromptTemplateOwnerId() ? { applyProjection: false } : {}),
      promptPresetId,
      minimumRevision: peekAppliedServerResourceRevision() ?? undefined,
    }))
  ) {
    throw new StartupChatDependencyError(
      'selected-prompt-template-hydration-failed',
      'Selected prompt-template owner hydration failed',
    )
  }
  startupChatReattachReady = true
  startActiveGenerationReattach()
  await prepareOpenChatGenerationReattach()
}

function startStartupChatReadinessSync(startupAttemptId: number): void {
  if (stopStartupChatReadinessSync) return
  startupChatReadinessTarget = currentStartupChatReadinessTarget()
  const refreshReadiness = (options: { force?: boolean } = {}) => {
    const target = currentStartupChatReadinessTarget()
    if (!options.force && target === startupChatReadinessTarget) return
    startupChatReadinessTarget = target
    const readinessEpoch = startupChatReadinessEpoch + 1
    startupChatReadinessEpoch = readinessEpoch
    settleStartupChatReadiness(false)
    void ensureStartupChatReadiness()
      .then(() => {
        if (readinessEpoch === startupChatReadinessEpoch) settleStartupChatReadiness(true)
      })
      .catch((error) => {
        if (readinessEpoch !== startupChatReadinessEpoch) return
        const dependencyError =
          error instanceof StartupChatDependencyError
            ? error
            : new StartupChatDependencyError('selected-chat-hydration-failed', 'Selected chat hydration failed')
        recordStartupCapabilityFailure(startupAttemptId, dependencyError.failureCode, 'chat-ready')
        console.warn(dependencyError.message)
      })
  }
  let initialEmission = true
  const stopSelectedCharacterSync = selectedCharID.subscribe(() => {
    if (initialEmission) {
      initialEmission = false
      return
    }
    refreshReadiness()
  })
  let initialRouteEmission = true
  const stopRouteSync = currentRoute.subscribe(() => {
    if (initialRouteEmission) {
      initialRouteEmission = false
      return
    }
    refreshReadiness()
  })
  setActiveChatReadinessRefreshHook(refreshReadiness)
  stopStartupChatReadinessSync = () => {
    stopSelectedCharacterSync()
    stopRouteSync()
    setActiveChatReadinessRefreshHook(null)
    startupChatReadinessTarget = null
  }
}

function currentStartupChatReadinessTarget(): string {
  const route = get(currentRoute)
  const selectedIndex = get(selectedCharID)
  const character = getDatabase().characters?.[selectedIndex]
  const chatId = character?.chats?.[character?.chatPage ?? 0]?.id
  const promptPresetId = currentStartupPromptTemplateOwnerId()
  return `${route.kind}\u0000${route.path}\u0000${selectedIndex}\u0000${character?.chaId ?? ''}\u0000${chatId ?? ''}\u0000${promptPresetId ?? ''}`
}

function currentStartupPromptTemplateOwnerId(): string | null {
  const database = getDatabase()
  const selectedIndex = get(selectedCharID)
  const character = database.characters?.[selectedIndex]
  const chat = character?.chats?.[character?.chatPage ?? 0]
  const chatPromptPresetId = chat?.generationSettings?.promptPresetId
  if (typeof chatPromptPresetId === 'string' && chatPromptPresetId.trim() !== '') {
    return chatPromptPresetId.trim()
  }

  return currentGlobalPromptTemplateOwnerId()
}

export function currentGlobalPromptTemplateOwnerId(): string | null {
  const database = getDatabase()
  const selectedPromptPresetIndex = database.promptPresetsId
  if (!Number.isInteger(selectedPromptPresetIndex) || selectedPromptPresetIndex < 0) return null
  const selectedPromptPreset = database.promptPresets?.[selectedPromptPresetIndex]
  const selectedPromptPresetId = selectedPromptPreset?.id
  if (typeof selectedPromptPresetId !== 'string' || selectedPromptPresetId.trim() === '') return null
  return resolveUniquePromptPreset(database.promptPresets, selectedPromptPresetId)?.id ?? null
}

export async function loadWebInitialDatabase(options: { coordinated?: boolean } = {}) {
  const runWriterStep: typeof runStartupStep = options.coordinated
    ? runStartupStep
    : (_step, operation) => Promise.resolve().then(operation)
  LoadingStatusState.text = 'Loading Server Data...'
  await runWriterStep('writer-owner-adoption', async () => {
    const pendingMutationOwner = await readSinglePendingMutationOwner()
    if (pendingMutationOwner) {
      adoptPendingMutationWriterSessionId(pendingMutationOwner.writerSessionId)
    }
  })
  const firstBootstrap = await runWriterStep('writer-bootstrap', async () => {
    let result = await fetchServerBootstrap()
    if (result.status === 'active-writer-connected') {
      const selection = await alertRequiredSelect(
        [language.writerConnectDisconnectExisting, language.cancel],
        language.writerConnectConflictBody,
        language.writerConnectConflictTitle,
      )
      if (selection !== '0') {
        setObserverShellLifecycleMode('takeover-denied')
        throw new FatalBootstrapError(language.writerConnectCancelled)
      }
      result = await fetchServerBootstrap(null, { disconnectExistingWriter: true })
    }
    if (result.status !== 'ok') {
      throw new Error(result.status === 'unavailable' ? 'Server bootstrap is unavailable' : result.error)
    }
    return result
  })
  const runtime = await runWriterStep('writer-initialize', () =>
    firstBootstrap.bootstrap.initialized
      ? firstBootstrap.bootstrap
      : initializeFreshServerDatabase(firstBootstrap.bootstrap),
  )
  configureGenerationOperationProtocol(runtime.generationOperationProtocol, runtime.databaseLineage)
  configureDisplaySourceProtocol(runtime.displaySourceProtocol, runtime.databaseLineage, runtime.writerEpoch)

  const { databaseLineage, requestedWriterWasActive, writerEpoch } = firstBootstrap.bootstrap
  if (
    !databaseLineage ||
    typeof requestedWriterWasActive !== 'boolean' ||
    typeof writerEpoch !== 'number' ||
    !Number.isSafeInteger(writerEpoch)
  ) {
    throw new Error('Server bootstrap is missing durable mutation ownership metadata')
  }
  initializeDraftRecoveryScope({
    writerSessionId: getActiveWriterSessionId(),
    databaseLineage,
  })
  await runWriterStep('writer-outbox-prepare', async () => {
    const pendingMutationPreparation = await preparePendingMutationOutbox({
      writerSessionId: getActiveWriterSessionId(),
      writerEpoch,
      databaseLineage,
      requestedWriterWasActive,
    })
    if (pendingMutationPreparation.discarded > 0) {
      alertError(language.pendingMutationDiscarded)
    }
  })
  await runWriterStep('writer-receipt-flush', flushPendingMutationReceiptAcknowledgements)
  await runWriterStep('writer-pending-replay', async () => {
    const pendingMutationReplay = await replayPendingMutations()
    const remainingPendingMutationRecords = await countBlockingPendingMutationRecords()
    if (
      pendingMutationReplay.retained > 0 ||
      remainingPendingMutationRecords === null ||
      remainingPendingMutationRecords > 0
    ) {
      throw new Error(language.pendingMutationReplayRetained)
    }
  })

  const resources = await runWriterStep('writer-resource-hydration', async () => {
    // From this point on the resource database is an authoritative projection.
    // Hydration and reconciliation use trusted apply scopes; raw compatibility
    // writes must never be exposed, even during the initial projection.
    setResourceWriteGuardEnabled(true)
    const result = await loadInitialServerResources({ hooks: serverResourceInvalidationHooks })
    if (result.status !== 'ok') {
      throw new Error(
        result.status === 'unavailable'
          ? 'Server resource APIs are unavailable'
          : `Server resource load failed: ${result.error}`,
      )
    }
    return result
  })

  const database = await runWriterStep('writer-projection-install', async () => {
    const result = getDatabase()
    selectedCharID.set(initialSelectedCharFromDatabase(result))
    resetChatHydration()
    resetLorebookHydration()
    recordHydratedCharacterLorebooks(result.characters)
    setCachedServerCommandRevision(resources.revision)
    setAppliedServerResourceRevision(resources.revision)
    markReplacementDatabaseOwnershipRefreshed({ databaseLineage, writerEpoch })
    setServerCommandSuccessReconciler((event, coalescedEvents, localEffects) =>
      enqueueServerResourceSync(() =>
        processServerCommandEvents(coalescedEvents.length > 0 ? coalescedEvents : [event], localEffects),
      ),
    )
    setServerCommandConflictGapHandler(handleServerCommandConflictGap)
    // The conservative shell boundary is writer-ready, so every visual and
    // selection input used by the root UI must be coherent before events can
    // publish that capability.
    updateColorScheme()
    updateTextThemeAndCSS()
    updateReducedMotion()
    updateHeightMode()
    updateGuisize()
    if (result.botSettingAtStart) botMakerMode.set(true)
    recordStartupMilestone('observer-ready')
    return result
  })
  await runWriterStep('writer-runtime-services', () => {
    applyGenerationOperationBootstrap(runtime, 'startup')
    setPendingRecoveredGenerationEffects(runtime.pendingGenerationEffects ?? [])
    setGenerationFinalizationPersistences(runtime.generationFinalizations ?? [])
    startGenerationFinalizationPersistenceRefresh()
    setActiveMessageTranslations(runtime.activeMessageTranslations ?? [])
    setActiveGreetingTranslations(runtime.activeGreetingTranslations ?? [])
    startActiveMessageTranslationRefresh()
    startActiveGreetingTranslationRefresh()
    stopBridgePatchLifecycleFlush?.()
    stopBridgePatchLifecycleFlush = startBridgePatchLifecycleFlush()
  })
  await runWriterStep('writer-event-subscription', async () => {
    serverResourceRuntimeReplayEnabled = false
    try {
      await startServerResourceEvents({ replayPendingMutations: false })
    } finally {
      serverResourceRuntimeReplayEnabled = true
    }
  })
  return { database }
}

/**
 * One-time first-run seed. The initialize response supplies the new revision,
 * so the pre-initialize runtime metadata remains valid when this client wins
 * the initialization race. A read-only bootstrap retry is only needed when a
 * different client initialized the database first.
 */
async function initializeFreshServerDatabase(initialRuntime: ServerBootstrapRuntime): Promise<ServerBootstrapRuntime> {
  const result = await initializeServerDatabaseForBootstrap()
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

  if (result.status === 'error' && result.reason === 'initialize-conflict') {
    throw new FatalBootstrapError(language.serverDatabaseDamaged)
  }

  throw new Error(`Initial server database seed failed: ${serverCommandFailureMessage(result)}`)
}

function serverCommandFailureMessage(
  result: Exclude<Awaited<ReturnType<typeof initializeServerDatabaseForBootstrap>>, { status: 'ok' }>,
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
  stopStartupChatReadinessSync?.()
  stopStartupChatReadinessSync = null
  setActiveChatReadinessRefreshHook(null)
  startupChatReadinessTarget = null
  startupChatReadinessEpoch += 1
  setServerCommandSuccessReconciler(null)
  setServerCommandConflictGapHandler(null)
  stopSelectedCharacterShellHydration()
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
    onBardWikiEvent: publishServerBardWikiJobEvent,
    onMemorySnapshot: applyServerMemorySnapshot,
    onWriterEvent: (event) => {
      if (event.sessionId !== null && event.sessionId !== getActiveWriterSessionId()) {
        enterWriterTakeoverFlow()
      }
    },
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
    recordStartupMilestone('writer-ready')
    setObserverShellLifecycleMode('promoted')
    if (options.replayPendingMutations !== false) triggerReconnectPendingMutationReplay()
    if (hasPendingReplacementDatabaseRefresh()) {
      enqueueServerResourceSync(async () => {
        if (!isCurrentServerResourceEventEpoch(eventEpoch)) return
        const refreshed = await retryPendingReplacementDatabaseRefresh()
        if (!refreshed) scheduleServerResourceReconnect(eventEpoch)
      })
    }
  } else if (subscription.status === 'error') {
    setObserverShellLifecycleMode('unavailable')
    console.warn(`Server event subscription failed: ${subscription.error}`)
    scheduleServerResourceReconnect(eventEpoch)
  } else if (subscription.status === 'replay-unavailable') {
    setObserverShellLifecycleMode('unavailable')
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
  stopServerResourceRecoveryListeners = subscribeBrowserLifecycleRecovery(() => restartServerResourceEvents())
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
  if (!applyServerMemoryJobEvent(event)) return
  publishServerMemoryJobEvent(event)
}

function applyServerMemorySnapshot(snapshot: ServerMemoryJobSnapshot) {
  applyServerMemoryJobSnapshot(snapshot)
  publishServerBardWikiJobSnapshot({
    streamId: snapshot.streamId,
    version: snapshot.version,
    jobs: snapshot.bardWikiJobs,
  })
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
  const selectedId = database.translatorPresetId
  const selectedPreset =
    typeof selectedId === 'string' ? database.translatorPresets?.find((preset) => preset.id === selectedId) : undefined
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
  if (kind === 'prompt') {
    return resolveUniquePromptPreset(database.promptPresets, presets[selectedIndex]?.id)?.id ?? null
  }
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
  if (!Number.isInteger(selectedIndex) || selectedIndex < 0 || !Array.isArray(database.promptPresets)) return false
  const preset = resolveUniquePromptPreset(database.promptPresets, promptPresetId) as
    | Record<string, unknown>
    | undefined
  if (!preset || preset !== database.promptPresets[selectedIndex]) return false
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
      requestActiveChatReadinessRefresh()
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
    void hydrateSelectedCharacterShell({ supersede: true })
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
  initializeDraftRecoveryScope({
    writerSessionId: getActiveWriterSessionId(),
    databaseLineage,
  })
  const adoption = await adoptReplacementDatabaseOwnership(ownership)
  if (adoption.ownershipChanged) {
    const { discardObserverProjectionState } = await import('./observerProjectionLifecycle')
    await discardObserverProjectionState('lineage-change')
  }
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
  if (stopGlobalErrorHandlers) return
  const { errorHandler, rejectHandler } = createGlobalErrorHandlers()
  window.addEventListener('error', errorHandler)
  window.addEventListener('unhandledrejection', rejectHandler)
  stopGlobalErrorHandlers = () => {
    window.removeEventListener('error', errorHandler)
    window.removeEventListener('unhandledrejection', rejectHandler)
  }
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
