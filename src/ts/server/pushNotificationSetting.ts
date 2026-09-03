import { subscribeBrowserLifecycleRecovery, type BrowserLifecycleRecoveryTrigger } from './lifecycleRecovery'
import { isWriterAccessLost } from './activeWriterSession'
import { readonly, writable, type Readable, type Writable } from 'svelte/store'
import {
  disableChatCompletionPushNotifications,
  enableChatCompletionPushNotifications,
  requestChatCompletionNotificationPermission,
  type DisablePushNotificationsResult,
  type EnablePushNotificationsResult,
} from './pushNotifications'
import {
  initialPushNotificationCoordinatorState,
  pushNotificationStateWriter,
  type PushNotificationCoordinatorState,
  type PushNotificationEnableFailure,
} from './pushNotificationState'
export { pushNotificationCoordinatorState } from './pushNotificationState'
export type {
  PushNotificationCoordinatorPhase,
  PushNotificationCoordinatorState,
  PushNotificationEnableFailure,
} from './pushNotificationState'
import {
  normalizePendingPushEndpoints,
  pushNotificationRetryStorage,
  type PushNotificationRetryStorage,
} from './pushNotificationRetryStorage'

export type PushNotificationSettingApplyResult = EnablePushNotificationsResult | DisablePushNotificationsResult

export type PushNotificationSettingReconcileOutcome<TResult = PushNotificationSettingApplyResult> =
  | {
      status: 'applied'
      enabled: boolean
      result: TResult
    }
  | { status: 'superseded'; enabled: boolean }
  | { status: 'error'; enabled: boolean; error: unknown }

export interface PushNotificationSettingReconciler<TResult> {
  reconcile(enabled: boolean, options?: { force?: boolean }): Promise<PushNotificationSettingReconcileOutcome<TResult>>
}

interface PendingReconciliation<TResult> {
  enabled: boolean
  promise: Promise<PushNotificationSettingReconcileOutcome<TResult>>
  resolve: (outcome: PushNotificationSettingReconcileOutcome<TResult>) => void
  revision: number
}

/**
 * Serialize the device-local push state behind the latest persisted setting.
 * Resource projections and optimistic setting rollbacks can arrive while a
 * permission prompt, subscription, or unsubscribe request is still pending.
 */
export function createPushNotificationSettingReconciler<TResult>(
  applyDesiredState: (enabled: boolean) => Promise<TResult>,
): PushNotificationSettingReconciler<TResult> {
  let desiredState: boolean | null = null
  let desiredRevision = 0
  let appliedRevision = 0
  let running: Promise<void> | null = null
  let currentRequest: PendingReconciliation<TResult> | null = null
  const pending = new Map<number, PendingReconciliation<TResult>>()

  function settleThrough(revision: number, outcome: PushNotificationSettingReconcileOutcome<TResult>): void {
    for (const [pendingRevision, request] of pending) {
      if (pendingRevision > revision) continue
      request.resolve(pendingRevision === revision ? outcome : { status: 'superseded', enabled: request.enabled })
      pending.delete(pendingRevision)
    }
  }

  async function drain(): Promise<void> {
    try {
      while (appliedRevision !== desiredRevision) {
        const revision = desiredRevision
        const enabled = desiredState === true

        try {
          const result = await applyDesiredState(enabled)
          appliedRevision = revision
          settleThrough(revision, { status: 'applied', enabled, result })
        } catch (error) {
          appliedRevision = revision
          settleThrough(revision, { status: 'error', enabled, error })
          if (desiredRevision === revision) {
            // Allow an explicit retry of the same desired state after an
            // unexpected transport failure.
            desiredState = null
            currentRequest = null
          }
        }
      }
    } finally {
      running = null
      if (appliedRevision !== desiredRevision) {
        running = Promise.resolve().then(drain)
      }
    }
  }

  return {
    reconcile(
      enabled: boolean,
      options: { force?: boolean } = {},
    ): Promise<PushNotificationSettingReconcileOutcome<TResult>> {
      if (!options.force && desiredState === enabled && currentRequest) return currentRequest.promise

      desiredState = enabled
      const revision = ++desiredRevision
      let resolve!: (outcome: PushNotificationSettingReconcileOutcome<TResult>) => void
      const promise = new Promise<PushNotificationSettingReconcileOutcome<TResult>>((settle) => {
        resolve = settle
      })
      currentRequest = { enabled, promise, resolve, revision }
      pending.set(revision, currentRequest)
      running ??= Promise.resolve().then(drain)
      return promise
    },
  }
}

interface PushNotificationDeviceApplyReceipt {
  result: PushNotificationSettingApplyResult
  pendingEndpoints: string[]
  localInspectionPending: boolean
  retryStorageError: unknown | null
}

interface PushNotificationRetryHydration {
  pendingEndpoints: string[]
  localInspectionPending: boolean
  retryStorageError: unknown | null
}

export interface PushNotificationDesiredStateApplier {
  apply(enabled: boolean): Promise<PushNotificationDeviceApplyReceipt>
  hydrate(): Promise<PushNotificationRetryHydration>
  retryStorage(): Promise<PushNotificationRetryHydration>
}

export function createPushNotificationSettingApplyDesiredState(
  enablePushNotifications: () => Promise<EnablePushNotificationsResult> = enableChatCompletionPushNotifications,
  disablePushNotifications: (
    pendingEndpoints?: readonly string[],
    requireLocalInspection?: boolean,
  ) => Promise<DisablePushNotificationsResult> = disableChatCompletionPushNotifications,
  retryStorage: PushNotificationRetryStorage = pushNotificationRetryStorage,
): PushNotificationDesiredStateApplier {
  let pendingDisableEndpoints: string[] = []
  let localInspectionPending = false
  let hydrated = false
  let hydrationPromise: Promise<void> | null = null
  let retryStorageError: unknown | null = null

  async function persistPendingEndpoints(): Promise<void> {
    if (!hydrated) return
    try {
      await retryStorage.savePendingCleanup({
        pendingEndpoints: pendingDisableEndpoints,
        localInspectionPending,
      })
      retryStorageError = null
    } catch (error) {
      retryStorageError = error
    }
  }

  async function hydratePendingEndpoints(): Promise<void> {
    if (hydrated) return
    if (hydrationPromise) return hydrationPromise
    hydrationPromise = (async () => {
      try {
        const persisted = await retryStorage.loadPendingCleanup()
        const merged = normalizePendingPushEndpoints([...persisted.pendingEndpoints, ...pendingDisableEndpoints])
        const mergedInspectionPending = persisted.localInspectionPending || localInspectionPending
        const shouldPersistMerge =
          merged.length !== persisted.pendingEndpoints.length ||
          mergedInspectionPending !== persisted.localInspectionPending
        pendingDisableEndpoints = merged
        localInspectionPending = mergedInspectionPending
        hydrated = true
        retryStorageError = null
        if (shouldPersistMerge) await persistPendingEndpoints()
      } catch (error) {
        retryStorageError = error
      } finally {
        hydrationPromise = null
      }
    })()
    return hydrationPromise
  }

  return {
    async hydrate(): Promise<PushNotificationRetryHydration> {
      await hydratePendingEndpoints()
      return {
        pendingEndpoints: [...pendingDisableEndpoints],
        localInspectionPending,
        retryStorageError,
      }
    },

    async retryStorage(): Promise<PushNotificationRetryHydration> {
      await hydratePendingEndpoints()
      if (hydrated) await persistPendingEndpoints()
      return {
        pendingEndpoints: [...pendingDisableEndpoints],
        localInspectionPending,
        retryStorageError,
      }
    },

    async apply(enabled: boolean): Promise<PushNotificationDeviceApplyReceipt> {
      await hydratePendingEndpoints()
      let result: PushNotificationSettingApplyResult
      if (enabled) {
        result = await enablePushNotifications()
        if (result.status === 'enabled') {
          const activeEndpoint = result.endpoint
          pendingDisableEndpoints = pendingDisableEndpoints.filter((endpoint) => endpoint !== activeEndpoint)
          localInspectionPending = false
        }
      } else {
        result = await disablePushNotifications(pendingDisableEndpoints, localInspectionPending)
        pendingDisableEndpoints = normalizePendingPushEndpoints(result.pendingEndpoints)
        localInspectionPending = result.localInspectionPending
      }
      await persistPendingEndpoints()
      return {
        result,
        pendingEndpoints: [...pendingDisableEndpoints],
        localInspectionPending,
        retryStorageError,
      }
    },
  }
}

export interface PushNotificationReconcileOptions {
  /** Only explicit user actions may open a browser permission prompt. */
  requestPermission?: boolean
  force?: boolean
}

export interface PushNotificationCoordinator {
  state: Readable<PushNotificationCoordinatorState>
  initialize(): Promise<void>
  reconcile(
    enabled: boolean,
    options?: PushNotificationReconcileOptions,
  ): Promise<PushNotificationSettingReconcileOutcome>
  retrySetup(): Promise<PushNotificationSettingReconcileOutcome>
  retryStorage(): Promise<void>
  retryCleanup(): Promise<PushNotificationSettingReconcileOutcome>
  dispose(): void
}

export interface CreatePushNotificationCoordinatorDependencies {
  enablePushNotifications?: () => Promise<EnablePushNotificationsResult>
  requestPermission?: () => Promise<unknown>
  disablePushNotifications?: (
    pendingEndpoints?: readonly string[],
    requireLocalInspection?: boolean,
  ) => Promise<DisablePushNotificationsResult>
  retryStorage?: PushNotificationRetryStorage
  state?: Writable<PushNotificationCoordinatorState>
  subscribeRecovery?: typeof subscribeBrowserLifecycleRecovery
  canRetry?: () => boolean
  isOnline?: () => boolean
}

export function isRetryablePushNotificationFailure(failure: PushNotificationEnableFailure): boolean {
  return (
    failure.status === 'fallback' &&
    (failure.reason === 'service-worker-failed' ||
      failure.reason === 'vapid-unavailable' ||
      failure.reason === 'subscription-failed' ||
      failure.reason === 'server-registration-failed')
  )
}

const INITIAL_RETRY_DELAY_MS = 5_000
const MAX_RETRY_DELAY_MS = 60_000

export function createPushNotificationCoordinator(
  dependencies: CreatePushNotificationCoordinatorDependencies = {},
): PushNotificationCoordinator {
  const desiredStateApplier = createPushNotificationSettingApplyDesiredState(
    dependencies.enablePushNotifications,
    dependencies.disablePushNotifications,
    dependencies.retryStorage,
  )
  const transportReconciler = createPushNotificationSettingReconciler((enabled) => desiredStateApplier.apply(enabled))
  const requestPermission = dependencies.requestPermission ?? requestChatCompletionNotificationPermission
  const subscribeRecovery = dependencies.subscribeRecovery ?? subscribeBrowserLifecycleRecovery
  const canRetry = dependencies.canRetry ?? (() => !isWriterAccessLost())
  const isOnline = dependencies.isOnline ?? (() => typeof navigator === 'undefined' || navigator.onLine !== false)
  let stateSnapshot = initialPushNotificationCoordinatorState()
  const stateWritable = dependencies.state ?? writable(stateSnapshot)
  let coordinatorRevision = 0
  let initializationPromise: Promise<void> | null = null
  let activeReconciliation: { enabled: boolean; promise: Promise<PushNotificationSettingReconcileOutcome> } | null =
    null
  let lifecycleGeneration = 0
  let retryTimer: ReturnType<typeof setTimeout> | null = null
  let retryAttempt = 0
  let stopRecovery: (() => void) | null = null
  let requireFreshReconciliation = true
  let lastAttemptAt = -Infinity

  function updateState(patch: Partial<PushNotificationCoordinatorState>): void {
    stateSnapshot = { ...stateSnapshot, ...patch }
    stateWritable.set(stateSnapshot)
  }

  function publishDeviceReceipt(receipt: PushNotificationDeviceApplyReceipt): void {
    updateState({
      pendingEndpoints: [...receipt.pendingEndpoints],
      localInspectionPending: receipt.localInspectionPending,
      retryStorageError: receipt.retryStorageError,
    })
  }

  function cancelRetry(): void {
    if (retryTimer !== null) clearTimeout(retryTimer)
    retryTimer = null
    updateState({ nextRetryAt: null })
  }

  function scheduleRetry(): void {
    if (!stateSnapshot.desiredEnabled || retryTimer !== null || !isOnline() || !canRetry()) return
    if (
      !stateSnapshot.operationError &&
      (!stateSnapshot.setupFailure || !isRetryablePushNotificationFailure(stateSnapshot.setupFailure))
    )
      return
    const delay = Math.min(INITIAL_RETRY_DELAY_MS * 2 ** Math.min(retryAttempt++, 4), MAX_RETRY_DELAY_MS)
    const generation = lifecycleGeneration
    updateState({ nextRetryAt: Date.now() + delay })
    retryTimer = setTimeout(() => {
      retryTimer = null
      updateState({ nextRetryAt: null })
      if (generation !== lifecycleGeneration || !stateSnapshot.desiredEnabled || !canRetry()) return
      if (stateSnapshot.phase !== 'idle') {
        scheduleRetry()
        return
      }
      if (isOnline()) void reconcile(true, { force: true })
    }, delay)
  }

  function retryOnReturn(trigger: BrowserLifecycleRecoveryTrigger): void {
    if (!canRetry()) {
      cancelRetry()
      return
    }
    if (!stateSnapshot.desiredEnabled || activeReconciliation || stateSnapshot.phase !== 'idle' || !isOnline()) return
    if (trigger !== 'online' && Date.now() - lastAttemptAt < 1_000) return
    void reconcile(true, { force: true })
  }

  function recordCleanupOutcome(
    outcome: PushNotificationSettingReconcileOutcome<PushNotificationDeviceApplyReceipt>,
  ): PushNotificationSettingReconcileOutcome {
    if (outcome.status === 'error') {
      updateState({ phase: 'idle', operationError: outcome.error })
      return outcome
    }
    if (outcome.status === 'superseded') return outcome
    publishDeviceReceipt(outcome.result)
    if (outcome.result.result.status !== 'disabled' && outcome.result.result.status !== 'partial') {
      const error = new Error('Push cleanup returned an invalid enable result.')
      updateState({ phase: 'idle', operationError: error })
      return { status: 'error', enabled: false, error }
    }
    updateState({ phase: 'idle', cleanup: outcome.result.result, operationError: null })
    return { status: 'applied', enabled: false, result: outcome.result.result }
  }

  async function initialize(): Promise<void> {
    if (initializationPromise) return initializationPromise
    const generation = lifecycleGeneration
    stopRecovery ??= subscribeRecovery(retryOnReturn)
    initializationPromise = (async () => {
      try {
        updateState({ phase: 'hydrating' })
        const hydration = await desiredStateApplier.hydrate()
        if (generation !== lifecycleGeneration) return
        updateState({ phase: stateSnapshot.desiredEnabled ? 'enabling' : 'idle', ...hydration })
        if (hydration.pendingEndpoints.length === 0 && !hydration.localInspectionPending) return
        updateState({ phase: 'startup-cleanup' })
        const outcome = await transportReconciler.reconcile(false, { force: true })
        if (generation !== lifecycleGeneration) return
        recordCleanupOutcome(outcome)
      } catch (error) {
        if (generation !== lifecycleGeneration) return
        initializationPromise = null
        updateState({ phase: 'idle', operationError: error })
        throw error
      }
    })()
    return initializationPromise
  }

  function reconcile(
    enabled: boolean,
    options: PushNotificationReconcileOptions = {},
  ): Promise<PushNotificationSettingReconcileOutcome> {
    if (enabled && !canRetry()) return Promise.resolve({ status: 'superseded', enabled })
    if (activeReconciliation?.enabled === enabled && !options.force && !options.requestPermission) {
      return activeReconciliation.promise
    }
    const revision = ++coordinatorRevision
    const generation = lifecycleGeneration
    const changed = enabled !== stateSnapshot.desiredEnabled
    if (changed || options.requestPermission) retryAttempt = 0
    if (changed || !enabled || options.force || options.requestPermission) cancelRetry()
    updateState({
      phase: enabled ? 'enabling' : 'disabling',
      desiredEnabled: enabled,
      ...(!enabled ? { setupFailure: null, operationError: null } : {}),
    })

    // Start the permission request synchronously within the click handler. All
    // startup, projection, timer and foreground reconciliations stay passive.
    let permissionRequest: Promise<unknown> | undefined
    if (enabled && options.requestPermission) {
      try {
        permissionRequest = requestPermission()
      } catch (error) {
        permissionRequest = Promise.reject(error)
      }
    }
    const current = () => revision === coordinatorRevision && generation === lifecycleGeneration
    const promise = (async (): Promise<PushNotificationSettingReconcileOutcome> => {
      try {
        await Promise.all([initialize(), permissionRequest])
        if (!current()) return { status: 'superseded', enabled }
        if (enabled && !canRetry()) {
          updateState({ phase: 'idle' })
          return { status: 'superseded', enabled }
        }
        updateState({ phase: enabled ? 'enabling' : 'disabling' })
        lastAttemptAt = Date.now()
        const force = requireFreshReconciliation || options.force || options.requestPermission
        requireFreshReconciliation = false
        const outcome = await transportReconciler.reconcile(enabled, { force })
        if (!current()) return { status: 'superseded', enabled }
        if (outcome.status === 'error') throw outcome.error
        if (outcome.status === 'superseded') return outcome
        if (!enabled) return recordCleanupOutcome(outcome)
        publishDeviceReceipt(outcome.result)
        const result = outcome.result.result
        if (result.status === 'enabled') {
          cancelRetry()
          retryAttempt = 0
          updateState({ phase: 'idle', setupFailure: null, cleanup: null, operationError: null })
        } else if (result.status === 'fallback' || result.status === 'permission-denied') {
          // Device availability must never rewrite the shared user preference.
          updateState({ phase: 'idle', setupFailure: result, operationError: null })
          scheduleRetry()
        } else {
          throw new Error('Push enablement returned an invalid cleanup result.')
        }
        return { status: 'applied', enabled: true, result }
      } catch (error) {
        if (!current()) return { status: 'superseded', enabled }
        updateState({ phase: 'idle', operationError: error })
        scheduleRetry()
        return { status: 'error', enabled, error }
      } finally {
        if (current()) activeReconciliation = null
      }
    })()
    activeReconciliation = { enabled, promise }
    return promise
  }

  function retrySetup(): Promise<PushNotificationSettingReconcileOutcome> {
    if (!stateSnapshot.desiredEnabled) return Promise.resolve({ status: 'superseded', enabled: false })
    return reconcile(true, { requestPermission: true, force: true })
  }

  async function retryStorage(): Promise<void> {
    const generation = lifecycleGeneration
    const revision = coordinatorRevision
    await initialize()
    if (generation !== lifecycleGeneration || revision !== coordinatorRevision || stateSnapshot.phase !== 'idle') return
    updateState({ phase: 'retrying-storage' })
    const hydration = await desiredStateApplier.retryStorage()
    if (generation !== lifecycleGeneration || revision !== coordinatorRevision) return
    updateState({ phase: 'idle', ...hydration })
    scheduleRetry()
  }

  async function retryCleanup(): Promise<PushNotificationSettingReconcileOutcome> {
    if (stateSnapshot.desiredEnabled) return { status: 'superseded', enabled: true }
    return reconcile(false, { force: true })
  }

  function dispose(): void {
    lifecycleGeneration += 1
    coordinatorRevision += 1
    initializationPromise = null
    activeReconciliation = null
    requireFreshReconciliation = true
    cancelRetry()
    retryAttempt = 0
    lastAttemptAt = -Infinity
    stopRecovery?.()
    stopRecovery = null
    updateState(initialPushNotificationCoordinatorState())
  }

  return { state: readonly(stateWritable), initialize, reconcile, retrySetup, retryStorage, retryCleanup, dispose }
}

const pushNotificationCoordinator = createPushNotificationCoordinator({ state: pushNotificationStateWriter })

export function initializePushNotificationCoordinator(): Promise<void> {
  return pushNotificationCoordinator.initialize()
}

export function reconcileChatCompletionPushNotificationSetting(
  enabled: boolean,
  options?: PushNotificationReconcileOptions,
): Promise<PushNotificationSettingReconcileOutcome> {
  return pushNotificationCoordinator.reconcile(enabled, options)
}

export function stopPushNotificationCoordinator(): void {
  pushNotificationCoordinator.dispose()
}

export function retryChatCompletionPushNotificationSetup(): Promise<PushNotificationSettingReconcileOutcome> {
  return pushNotificationCoordinator.retrySetup()
}

export function retryChatCompletionPushNotificationStorage(): Promise<void> {
  return pushNotificationCoordinator.retryStorage()
}

export function retryChatCompletionPushNotificationCleanup(): Promise<PushNotificationSettingReconcileOutcome> {
  return pushNotificationCoordinator.retryCleanup()
}
