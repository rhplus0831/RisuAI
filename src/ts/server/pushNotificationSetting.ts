import { readonly, writable, type Readable } from 'svelte/store'
import {
  disableChatCompletionPushNotifications,
  enableChatCompletionPushNotifications,
  type DisablePushNotificationsResult,
  type EnablePushNotificationsResult,
} from './pushNotifications'
import {
  persistServerBackedSettingsPatchWithSettlement,
  type ServerBackedSettingsPersistenceOutcome,
  type ServerBackedSettingsPersistenceReceipt,
} from './settingsBridge.svelte'
import {
  normalizePendingPushEndpoints,
  pushNotificationRetryStorage,
  type PushNotificationRetryStorage,
} from './pushNotificationRetryStorage'

export type PushNotificationSettingApplyResult = EnablePushNotificationsResult | DisablePushNotificationsResult
export type PushNotificationEnableFailure = Exclude<EnablePushNotificationsResult, { status: 'enabled' }>

export type PushNotificationSettingReconcileOutcome<TResult = PushNotificationSettingApplyResult> =
  | {
      status: 'applied'
      enabled: boolean
      result: TResult
      compensation?: ServerBackedSettingsPersistenceOutcome
      cleanup?: DisablePushNotificationsResult
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
        } else if (result.status === 'fallback' && result.endpoint) {
          pendingDisableEndpoints = normalizePendingPushEndpoints([...pendingDisableEndpoints, result.endpoint])
          if (result.localCleanup === 'failed') localInspectionPending = true
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

export type PushNotificationCoordinatorPhase =
  | 'idle'
  | 'hydrating'
  | 'startup-cleanup'
  | 'enabling'
  | 'disabling'
  | 'compensating'
  | 'retrying-compensation'
  | 'retrying-storage'
  | 'retrying-cleanup'

export interface PushNotificationCoordinatorState {
  phase: PushNotificationCoordinatorPhase
  setupFailure: PushNotificationEnableFailure | null
  compensation: ServerBackedSettingsPersistenceOutcome | null
  cleanup: DisablePushNotificationsResult | null
  pendingEndpoints: string[]
  localInspectionPending: boolean
  retryStorageError: unknown | null
  operationError: unknown | null
}

export interface PushNotificationCoordinator {
  state: Readable<PushNotificationCoordinatorState>
  initialize(): Promise<void>
  reconcile(enabled: boolean): Promise<PushNotificationSettingReconcileOutcome>
  retryCompensation(): Promise<ServerBackedSettingsPersistenceOutcome>
  retryStorage(): Promise<void>
  retryCleanup(): Promise<PushNotificationSettingReconcileOutcome>
  dispose(): void
}

export interface CreatePushNotificationCoordinatorDependencies {
  enablePushNotifications?: () => Promise<EnablePushNotificationsResult>
  disablePushNotifications?: (
    pendingEndpoints?: readonly string[],
    requireLocalInspection?: boolean,
  ) => Promise<DisablePushNotificationsResult>
  persistSettingsPatch?: (patch: { notification: false }) => Promise<ServerBackedSettingsPersistenceReceipt>
  retryStorage?: PushNotificationRetryStorage
}

export function createPushNotificationCoordinator(
  dependencies: CreatePushNotificationCoordinatorDependencies = {},
): PushNotificationCoordinator {
  const desiredStateApplier = createPushNotificationSettingApplyDesiredState(
    dependencies.enablePushNotifications,
    dependencies.disablePushNotifications,
    dependencies.retryStorage,
  )
  const transportReconciler = createPushNotificationSettingReconciler((enabled) => desiredStateApplier.apply(enabled))
  const persistSettingsPatch = dependencies.persistSettingsPatch ?? persistServerBackedSettingsPatchWithSettlement
  const initialState: PushNotificationCoordinatorState = {
    phase: 'idle',
    setupFailure: null,
    compensation: null,
    cleanup: null,
    pendingEndpoints: [],
    localInspectionPending: false,
    retryStorageError: null,
    operationError: null,
  }
  const stateWritable = writable(initialState)
  let stateSnapshot = initialState
  let coordinatorRevision = 0
  let initializationPromise: Promise<void> | null = null
  let suppressCompensationRollbackEnable = false
  let suppressNextSettledCompensationRollbackEnable = false
  let queuedCompensationGeneration = 0
  let queuedCompensationCleanup: (() => void) | null = null
  let suppressionResetTimer: ReturnType<typeof setTimeout> | null = null
  let lifecycleGeneration = 0

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

  function recordCleanupOutcome(
    outcome: PushNotificationSettingReconcileOutcome<PushNotificationDeviceApplyReceipt>,
    revision: number,
  ): PushNotificationSettingReconcileOutcome {
    if (outcome.status === 'applied') publishDeviceReceipt(outcome.result)
    if (revision !== coordinatorRevision) return { status: 'superseded', enabled: false }
    if (outcome.status === 'error') {
      updateState({ phase: 'idle', operationError: outcome.error })
      return outcome
    }
    if (outcome.status === 'superseded') return outcome
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
    initializationPromise = (async () => {
      try {
        updateState({ phase: 'hydrating', operationError: null })
        const hydration = await desiredStateApplier.hydrate()
        if (generation !== lifecycleGeneration) return
        updateState({
          phase: 'idle',
          pendingEndpoints: [...hydration.pendingEndpoints],
          localInspectionPending: hydration.localInspectionPending,
          retryStorageError: hydration.retryStorageError,
        })
        if (hydration.pendingEndpoints.length === 0 && !hydration.localInspectionPending) return

        const revision = ++coordinatorRevision
        updateState({ phase: 'startup-cleanup', operationError: null })
        const outcome = await transportReconciler.reconcile(false, { force: true })
        if (generation !== lifecycleGeneration) return
        recordCleanupOutcome(outcome, revision)
      } catch (error) {
        if (generation !== lifecycleGeneration) return
        initializationPromise = null
        updateState({ phase: 'idle', operationError: error })
        throw error
      }
    })()
    return initializationPromise
  }

  function clearQueuedCompensationSettlement(): void {
    queuedCompensationCleanup?.()
    queuedCompensationCleanup = null
    queuedCompensationGeneration += 1
  }

  function armQueuedCompensationSettlement(
    receipt: Extract<ServerBackedSettingsPersistenceReceipt, { status: 'queued' }>,
  ): void {
    clearQueuedCompensationSettlement()
    const generation = queuedCompensationGeneration
    queuedCompensationCleanup = receipt.subscribeSettlement((settlement) => {
      if (generation !== queuedCompensationGeneration || !stateSnapshot.setupFailure) return
      queuedCompensationCleanup = null
      if (settlement === 'failed') {
        suppressNextSettledCompensationRollbackEnable = true
        if (suppressionResetTimer !== null) clearTimeout(suppressionResetTimer)
        suppressionResetTimer = setTimeout(() => {
          suppressionResetTimer = null
          suppressNextSettledCompensationRollbackEnable = false
        }, 0)
      }
      updateState({ compensation: settlement })
    })
  }

  async function persistCompensatingDisable(revision: number): Promise<ServerBackedSettingsPersistenceOutcome> {
    suppressCompensationRollbackEnable = true
    let receipt: ServerBackedSettingsPersistenceReceipt
    try {
      receipt = await persistSettingsPatch({ notification: false })
    } catch (error) {
      receipt = { status: 'failed' }
      if (revision === coordinatorRevision) updateState({ operationError: error })
    } finally {
      suppressCompensationRollbackEnable = false
    }
    const compensation = receipt.status
    if (stateSnapshot.setupFailure) updateState({ compensation })
    if (receipt.status === 'queued') armQueuedCompensationSettlement(receipt)
    else clearQueuedCompensationSettlement()
    return compensation
  }

  async function reconcile(enabled: boolean): Promise<PushNotificationSettingReconcileOutcome> {
    await initialize()
    if (enabled && (suppressCompensationRollbackEnable || suppressNextSettledCompensationRollbackEnable)) {
      suppressNextSettledCompensationRollbackEnable = false
      return { status: 'superseded', enabled: true }
    }

    const revision = ++coordinatorRevision
    if (enabled) clearQueuedCompensationSettlement()
    updateState({
      phase: enabled ? 'enabling' : 'disabling',
      ...(enabled
        ? { setupFailure: null, compensation: null, cleanup: null, operationError: null }
        : { operationError: null }),
    })
    const outcome = await transportReconciler.reconcile(enabled)
    if (outcome.status === 'applied') publishDeviceReceipt(outcome.result)
    if (revision !== coordinatorRevision) return { status: 'superseded', enabled }
    if (outcome.status === 'error') {
      updateState({ phase: 'idle', operationError: outcome.error })
      return outcome
    }
    if (outcome.status === 'superseded') return outcome

    if (!enabled) return recordCleanupOutcome(outcome, revision)
    const enableResult = outcome.result.result
    if (enableResult.status === 'enabled') {
      updateState({
        phase: 'idle',
        setupFailure: null,
        compensation: null,
        cleanup: null,
        operationError: null,
      })
      return { status: 'applied', enabled: true, result: enableResult }
    }
    if (enableResult.status === 'disabled' || enableResult.status === 'partial') {
      const error = new Error('Push enablement returned an invalid cleanup result.')
      updateState({ phase: 'idle', operationError: error })
      return { status: 'error', enabled: true, error }
    }

    const setupFailure = enableResult as PushNotificationEnableFailure
    updateState({ phase: 'compensating', setupFailure, compensation: null })
    const compensation = await persistCompensatingDisable(revision)
    if (revision !== coordinatorRevision) return { status: 'superseded', enabled: true }

    const cleanupOutcome = await transportReconciler.reconcile(false)
    const cleanup = recordCleanupOutcome(cleanupOutcome, revision)
    if (cleanup.status !== 'applied') {
      return {
        status: 'applied',
        enabled: true,
        result: enableResult,
        compensation,
      }
    }
    return {
      status: 'applied',
      enabled: true,
      result: enableResult,
      compensation,
      cleanup: cleanup.result as DisablePushNotificationsResult,
    }
  }

  async function retryCompensation(): Promise<ServerBackedSettingsPersistenceOutcome> {
    await initialize()
    const revision = ++coordinatorRevision
    updateState({ phase: 'retrying-compensation', operationError: null })
    const compensation = await persistCompensatingDisable(revision)
    if (revision !== coordinatorRevision) return compensation
    const cleanupOutcome = await transportReconciler.reconcile(false, { force: true })
    recordCleanupOutcome(cleanupOutcome, revision)
    return compensation
  }

  async function retryStorage(): Promise<void> {
    await initialize()
    const revision = ++coordinatorRevision
    updateState({ phase: 'retrying-storage', operationError: null })
    const hydration = await desiredStateApplier.retryStorage()
    if (revision !== coordinatorRevision) return
    updateState({
      phase: 'idle',
      pendingEndpoints: [...hydration.pendingEndpoints],
      localInspectionPending: hydration.localInspectionPending,
      retryStorageError: hydration.retryStorageError,
    })
  }

  async function retryCleanup(): Promise<PushNotificationSettingReconcileOutcome> {
    await initialize()
    const revision = ++coordinatorRevision
    updateState({ phase: 'retrying-cleanup', operationError: null })
    const outcome = await transportReconciler.reconcile(false, { force: true })
    return recordCleanupOutcome(outcome, revision)
  }

  function dispose(): void {
    lifecycleGeneration += 1
    coordinatorRevision += 1
    initializationPromise = null
    clearQueuedCompensationSettlement()
    if (suppressionResetTimer !== null) {
      clearTimeout(suppressionResetTimer)
      suppressionResetTimer = null
    }
    suppressCompensationRollbackEnable = false
    suppressNextSettledCompensationRollbackEnable = false
    updateState(initialState)
  }

  return {
    state: readonly(stateWritable),
    initialize,
    reconcile,
    retryCompensation,
    retryStorage,
    retryCleanup,
    dispose,
  }
}

const pushNotificationCoordinator = createPushNotificationCoordinator()

export const pushNotificationCoordinatorState = pushNotificationCoordinator.state

export function initializePushNotificationCoordinator(): Promise<void> {
  return pushNotificationCoordinator.initialize()
}

export function reconcileChatCompletionPushNotificationSetting(
  enabled: boolean,
): Promise<PushNotificationSettingReconcileOutcome> {
  return pushNotificationCoordinator.reconcile(enabled)
}

export function stopPushNotificationCoordinator(): void {
  pushNotificationCoordinator.dispose()
}

export function retryChatCompletionPushNotificationCompensation(): Promise<ServerBackedSettingsPersistenceOutcome> {
  return pushNotificationCoordinator.retryCompensation()
}

export function retryChatCompletionPushNotificationStorage(): Promise<void> {
  return pushNotificationCoordinator.retryStorage()
}

export function retryChatCompletionPushNotificationCleanup(): Promise<PushNotificationSettingReconcileOutcome> {
  return pushNotificationCoordinator.retryCleanup()
}
