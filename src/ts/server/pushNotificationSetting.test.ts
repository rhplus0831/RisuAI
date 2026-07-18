import { describe, expect, it, vi } from 'vitest'
import { get } from 'svelte/store'

vi.mock('./pushNotifications', () => ({
  disableChatCompletionPushNotifications: vi.fn(async () => ({
    status: 'disabled',
    subscriptionFound: false,
    localUnsubscribed: null,
    serverDeleted: null,
    pendingEndpoints: [],
    localInspectionPending: false,
    failures: [],
  })),
  enableChatCompletionPushNotifications: vi.fn(async () => ({ status: 'enabled', endpoint: 'test' })),
}))

vi.mock('./settingsBridge.svelte', () => ({
  persistServerBackedSettingsPatchWithSettlement: vi.fn(async () => ({ status: 'accepted' })),
}))

import {
  createPushNotificationCoordinator,
  createPushNotificationSettingApplyDesiredState,
  createPushNotificationSettingReconciler,
} from './pushNotificationSetting'
import type { PushNotificationRetryStorage } from './pushNotificationRetryStorage'
import type {
  ServerBackedSettingsFinalSettlement,
  ServerBackedSettingsPersistenceReceipt,
} from './settingsBridge.svelte'
import {
  applySettingsRuntimeProjectionEffects,
  setSettingsRuntimeProjectionHook,
} from './settingsRuntimeProjectionHooks'

interface Deferred<T> {
  promise: Promise<T>
  resolve: (value: T) => void
}

function deferred<T>(): Deferred<T> {
  let resolve!: (value: T) => void
  const promise = new Promise<T>((settle) => {
    resolve = settle
  })
  return { promise, resolve }
}

function memoryRetryStorage(initialEndpoints: string[] = [], initialInspectionPending = false) {
  let persisted = {
    pendingEndpoints: [...initialEndpoints],
    localInspectionPending: initialInspectionPending,
  }
  const storage: PushNotificationRetryStorage = {
    loadPendingCleanup: vi.fn(async () => ({
      pendingEndpoints: [...persisted.pendingEndpoints],
      localInspectionPending: persisted.localInspectionPending,
    })),
    savePendingCleanup: vi.fn(async (state) => {
      persisted = {
        pendingEndpoints: [...state.pendingEndpoints],
        localInspectionPending: state.localInspectionPending,
      }
    }),
  }
  return {
    storage,
    persisted: () => [...persisted.pendingEndpoints],
    inspectionPending: () => persisted.localInspectionPending,
  }
}

function disabledResult() {
  return {
    status: 'disabled' as const,
    subscriptionFound: false,
    localUnsubscribed: null,
    serverDeleted: null,
    pendingEndpoints: [],
    localInspectionPending: false,
    failures: [],
  }
}

function controlledQueuedReceipt(mutationId = 'settings-notification-false') {
  const listeners = new Set<(settlement: ServerBackedSettingsFinalSettlement) => void>()
  const final = deferred<ServerBackedSettingsFinalSettlement>()
  let settled: ServerBackedSettingsFinalSettlement | null = null
  const receipt: ServerBackedSettingsPersistenceReceipt = {
    status: 'queued',
    mutationId,
    settlement: final.promise,
    subscribeSettlement(listener) {
      if (settled) {
        listener(settled)
        return () => {}
      }
      listeners.add(listener)
      return () => listeners.delete(listener)
    },
  }
  return {
    receipt,
    settle(settlement: ServerBackedSettingsFinalSettlement) {
      settled = settlement
      for (const listener of [...listeners]) listener(settlement)
      listeners.clear()
      final.resolve(settlement)
    },
  }
}

describe('push notification setting reconciliation', () => {
  it('coalesces duplicate requests and applies the latest state after an in-flight operation', async () => {
    const enable = deferred<string>()
    const disable = deferred<string>()
    const applyDesiredState = vi.fn((enabled: boolean) => (enabled ? enable.promise : disable.promise))
    const reconciler = createPushNotificationSettingReconciler(applyDesiredState)

    const firstEnable = reconciler.reconcile(true)
    const duplicateEnable = reconciler.reconcile(true)
    expect(duplicateEnable).toBe(firstEnable)
    await vi.waitFor(() => expect(applyDesiredState).toHaveBeenCalledTimes(1))

    const latestDisable = reconciler.reconcile(false)
    enable.resolve('enabled')
    await expect(firstEnable).resolves.toEqual({ status: 'applied', enabled: true, result: 'enabled' })
    await vi.waitFor(() => expect(applyDesiredState).toHaveBeenCalledTimes(2))
    expect(applyDesiredState).toHaveBeenLastCalledWith(false)

    disable.resolve('disabled')
    await expect(latestDisable).resolves.toEqual({ status: 'applied', enabled: false, result: 'disabled' })
  })

  it('skips queued states superseded before transport starts', async () => {
    const applyDesiredState = vi.fn(async (enabled: boolean) => enabled)
    const reconciler = createPushNotificationSettingReconciler(applyDesiredState)

    const enable = reconciler.reconcile(true)
    const disable = reconciler.reconcile(false)

    await expect(enable).resolves.toEqual({ status: 'superseded', enabled: true })
    await expect(disable).resolves.toEqual({ status: 'applied', enabled: false, result: false })
    expect(applyDesiredState).toHaveBeenCalledOnce()
    expect(applyDesiredState).toHaveBeenCalledWith(false)
  })

  it('allows the same desired state to retry after an unexpected failure', async () => {
    const applyDesiredState = vi
      .fn<(enabled: boolean) => Promise<string>>()
      .mockRejectedValueOnce(new Error('temporary failure'))
      .mockResolvedValueOnce('enabled')
    const reconciler = createPushNotificationSettingReconciler(applyDesiredState)

    await expect(reconciler.reconcile(true)).resolves.toMatchObject({
      status: 'error',
      enabled: true,
      error: expect.any(Error),
    })
    await expect(reconciler.reconcile(true)).resolves.toEqual({
      status: 'applied',
      enabled: true,
      result: 'enabled',
    })
    expect(applyDesiredState).toHaveBeenCalledTimes(2)
  })

  it('forces an explicit cleanup retry after a resolved partial result', async () => {
    const applyDesiredState = vi.fn(async () => 'partial')
    const reconciler = createPushNotificationSettingReconciler(applyDesiredState)

    await expect(reconciler.reconcile(false)).resolves.toEqual({
      status: 'applied',
      enabled: false,
      result: 'partial',
    })
    await expect(reconciler.reconcile(false, { force: true })).resolves.toEqual({
      status: 'applied',
      enabled: false,
      result: 'partial',
    })
    expect(applyDesiredState).toHaveBeenCalledTimes(2)
  })

  it('carries an unresolved registration endpoint through disable retries', async () => {
    const endpoint = 'https://push.example.test/pending-registration'
    const enable = vi.fn(async () => ({
      status: 'fallback' as const,
      reason: 'server-registration-failed' as const,
      endpoint,
      localCleanup: 'succeeded' as const,
    }))
    const disable = vi
      .fn()
      .mockResolvedValueOnce({
        status: 'partial' as const,
        subscriptionFound: false,
        localUnsubscribed: null,
        serverDeleted: false,
        pendingEndpoints: [endpoint],
        localInspectionPending: false,
        failures: [{ step: 'server-deletion' as const, endpoint }],
      })
      .mockResolvedValueOnce({
        status: 'disabled' as const,
        subscriptionFound: false,
        localUnsubscribed: null,
        serverDeleted: true,
        pendingEndpoints: [],
        localInspectionPending: false,
        failures: [],
      })
    const retryStorage = memoryRetryStorage()
    const applyDesiredState = createPushNotificationSettingApplyDesiredState(enable, disable, retryStorage.storage)

    await applyDesiredState.apply(true)
    await applyDesiredState.apply(false)
    await applyDesiredState.apply(false)

    expect(disable.mock.calls).toEqual([
      [[endpoint], false],
      [[endpoint], false],
    ])
  })

  it.each([
    { status: 'permission-denied' as const },
    { status: 'fallback' as const, reason: 'notification-unavailable' as const },
    { status: 'fallback' as const, reason: 'permission-default' as const },
    { status: 'fallback' as const, reason: 'service-worker-unavailable' as const },
    { status: 'fallback' as const, reason: 'push-unavailable' as const },
    { status: 'fallback' as const, reason: 'vapid-unavailable' as const },
    { status: 'fallback' as const, reason: 'subscription-failed' as const },
    {
      status: 'fallback' as const,
      reason: 'server-registration-failed' as const,
      endpoint: 'https://push.example.test/unregistered',
      localCleanup: 'succeeded' as const,
    },
  ])('persists false for terminal enable result $status $reason', async (enableResult) => {
    const retryStorage = memoryRetryStorage()
    const persistSettingsPatch = vi.fn(async () => ({ status: 'accepted' as const }))
    const coordinator = createPushNotificationCoordinator({
      enablePushNotifications: vi.fn(async () => enableResult),
      disablePushNotifications: vi.fn(async () => disabledResult()),
      persistSettingsPatch,
      retryStorage: retryStorage.storage,
    })

    await coordinator.reconcile(true)

    expect(persistSettingsPatch).toHaveBeenCalledWith({ notification: false })
    expect(get(coordinator.state)).toMatchObject({
      setupFailure: enableResult,
      compensation: 'accepted',
    })
  })

  it.each(['accepted', 'queued', 'failed'] as const)(
    'centrally exposes a %s exact false-setting compensation receipt',
    async (compensation) => {
      const retryStorage = memoryRetryStorage()
      const queued = controlledQueuedReceipt()
      const persistSettingsPatch = vi.fn(
        async (): Promise<ServerBackedSettingsPersistenceReceipt> =>
          compensation === 'queued' ? queued.receipt : { status: compensation },
      )
      const coordinator = createPushNotificationCoordinator({
        enablePushNotifications: vi.fn(async () => ({
          status: 'fallback' as const,
          reason: 'vapid-unavailable' as const,
        })),
        disablePushNotifications: vi.fn(async () => disabledResult()),
        persistSettingsPatch,
        retryStorage: retryStorage.storage,
      })

      const outcome = await coordinator.reconcile(true)

      expect(persistSettingsPatch).toHaveBeenCalledOnce()
      expect(persistSettingsPatch).toHaveBeenCalledWith({ notification: false })
      expect(outcome).toMatchObject({
        status: 'applied',
        enabled: true,
        result: { status: 'fallback', reason: 'vapid-unavailable' },
        compensation,
        cleanup: { status: 'disabled' },
      })
      expect(get(coordinator.state)).toMatchObject({
        phase: 'idle',
        setupFailure: { status: 'fallback', reason: 'vapid-unavailable' },
        compensation,
        cleanup: { status: 'disabled' },
      })
    },
  )

  it('does not overwrite a queued compensation that settled before subscription', async () => {
    const retryStorage = memoryRetryStorage()
    const queued = controlledQueuedReceipt()
    queued.settle('accepted')
    const coordinator = createPushNotificationCoordinator({
      enablePushNotifications: vi.fn(async () => ({ status: 'permission-denied' as const })),
      disablePushNotifications: vi.fn(async () => disabledResult()),
      persistSettingsPatch: vi.fn(async () => queued.receipt),
      retryStorage: retryStorage.storage,
    })

    const outcome = await coordinator.reconcile(true)

    expect(outcome).toMatchObject({ compensation: 'queued' })
    expect(get(coordinator.state).compensation).toBe('accepted')
  })

  it.each(['accepted', 'failed'] as const)(
    'updates queued compensation after replay is finally %s',
    async (finalSettlement) => {
      const retryStorage = memoryRetryStorage()
      const queued = controlledQueuedReceipt()
      const enablePushNotifications = vi.fn(async () => ({ status: 'permission-denied' as const }))
      const coordinator = createPushNotificationCoordinator({
        enablePushNotifications,
        disablePushNotifications: vi.fn(async () => disabledResult()),
        persistSettingsPatch: vi.fn(async () => queued.receipt),
        retryStorage: retryStorage.storage,
      })

      await coordinator.reconcile(true)
      expect(get(coordinator.state).compensation).toBe('queued')

      queued.settle(finalSettlement)
      const rollbackProjection = finalSettlement === 'failed' ? await coordinator.reconcile(true) : undefined

      expect(get(coordinator.state).compensation).toBe(finalSettlement)
      if (finalSettlement === 'failed') {
        expect(rollbackProjection).toEqual({ status: 'superseded', enabled: true })
        expect(enablePushNotifications).toHaveBeenCalledOnce()
      }
    },
  )

  it('keeps a failed false-setting compensation visibly retryable', async () => {
    const retryStorage = memoryRetryStorage()
    const persistSettingsPatch = vi
      .fn()
      .mockResolvedValueOnce({ status: 'failed' })
      .mockResolvedValueOnce({ status: 'accepted' })
    const coordinator = createPushNotificationCoordinator({
      enablePushNotifications: vi.fn(async () => ({ status: 'permission-denied' as const })),
      disablePushNotifications: vi.fn(async () => disabledResult()),
      persistSettingsPatch,
      retryStorage: retryStorage.storage,
    })

    await coordinator.reconcile(true)
    expect(get(coordinator.state).compensation).toBe('failed')

    await expect(coordinator.retryCompensation()).resolves.toBe('accepted')

    expect(persistSettingsPatch.mock.calls).toEqual([[{ notification: false }], [{ notification: false }]])
    expect(get(coordinator.state)).toMatchObject({
      phase: 'idle',
      setupFailure: { status: 'permission-denied' },
      compensation: 'accepted',
      cleanup: { status: 'disabled' },
    })
  })

  it('does not loop enablement when failed compensation rolls the setting projection back to true', async () => {
    const retryStorage = memoryRetryStorage()
    const enablePushNotifications = vi.fn(async () => ({ status: 'permission-denied' as const }))
    const projectionOutcomes: unknown[] = []
    let projectedNotification = true
    let projectionChain = Promise.resolve()
    let coordinator!: ReturnType<typeof createPushNotificationCoordinator>
    const persistSettingsPatch = vi.fn(async () => {
      projectedNotification = false
      applySettingsRuntimeProjectionEffects(['notification'])
      await projectionChain
      projectedNotification = true
      applySettingsRuntimeProjectionEffects(['notification'])
      await projectionChain
      return { status: 'failed' as const }
    })
    coordinator = createPushNotificationCoordinator({
      enablePushNotifications,
      disablePushNotifications: vi.fn(async () => disabledResult()),
      persistSettingsPatch,
      retryStorage: retryStorage.storage,
    })
    setSettingsRuntimeProjectionHook((keys) => {
      if (!keys.includes('notification')) return
      projectionChain = projectionChain.then(async () => {
        projectionOutcomes.push(await coordinator.reconcile(projectedNotification))
      })
    })

    try {
      await coordinator.reconcile(true)
    } finally {
      setSettingsRuntimeProjectionHook(null)
    }

    expect(projectionOutcomes).toEqual([
      expect.objectContaining({ status: 'applied', enabled: false }),
      { status: 'superseded', enabled: true },
    ])
    expect(enablePushNotifications).toHaveBeenCalledOnce()
    expect(persistSettingsPatch).toHaveBeenCalledOnce()
    expect(get(coordinator.state)).toMatchObject({
      phase: 'idle',
      compensation: 'failed',
      cleanup: { status: 'disabled' },
    })
  })

  it('hydrates and automatically retries a failed DELETE endpoint after reload', async () => {
    const endpoint = 'https://push.example.test/reload-retry'
    const retryStorage = memoryRetryStorage()
    const firstDisable = vi.fn(async () => ({
      status: 'partial' as const,
      subscriptionFound: false,
      localUnsubscribed: null,
      serverDeleted: false,
      pendingEndpoints: [endpoint],
      localInspectionPending: false,
      failures: [{ step: 'server-deletion' as const, endpoint }],
    }))
    const firstCoordinator = createPushNotificationCoordinator({
      enablePushNotifications: vi.fn(async () => ({
        status: 'fallback' as const,
        reason: 'server-registration-failed' as const,
        endpoint,
        localCleanup: 'succeeded' as const,
      })),
      disablePushNotifications: firstDisable,
      persistSettingsPatch: vi.fn(async () => ({ status: 'accepted' as const })),
      retryStorage: retryStorage.storage,
    })

    await firstCoordinator.reconcile(true)

    expect(retryStorage.persisted()).toEqual([endpoint])
    expect(get(firstCoordinator.state)).toMatchObject({
      cleanup: { status: 'partial' },
      pendingEndpoints: [endpoint],
    })

    const reloadedDisable = vi.fn(async () => ({
      ...disabledResult(),
      serverDeleted: true,
    }))
    const reloadedCoordinator = createPushNotificationCoordinator({
      enablePushNotifications: vi.fn(async () => ({ status: 'enabled' as const, endpoint: 'unused' })),
      disablePushNotifications: reloadedDisable,
      persistSettingsPatch: vi.fn(async () => ({ status: 'accepted' as const })),
      retryStorage: retryStorage.storage,
    })

    await reloadedCoordinator.initialize()

    expect(reloadedDisable).toHaveBeenCalledOnce()
    expect(reloadedDisable).toHaveBeenCalledWith([endpoint], false)
    expect(retryStorage.persisted()).toEqual([])
    expect(get(reloadedCoordinator.state)).toMatchObject({
      phase: 'idle',
      cleanup: { status: 'disabled', serverDeleted: true },
      pendingEndpoints: [],
      localInspectionPending: false,
    })
  })

  it('retains an incomplete local inspection across reloads until it succeeds', async () => {
    const retryStorage = memoryRetryStorage([], true)
    const incompleteDisable = vi.fn(async () => ({
      status: 'partial' as const,
      subscriptionFound: false,
      localUnsubscribed: null,
      serverDeleted: null,
      pendingEndpoints: [],
      localInspectionPending: true,
      failures: [{ step: 'service-worker' as const }],
    }))
    const firstCoordinator = createPushNotificationCoordinator({
      enablePushNotifications: vi.fn(async () => ({ status: 'enabled' as const, endpoint: 'unused' })),
      disablePushNotifications: incompleteDisable,
      persistSettingsPatch: vi.fn(async () => ({ status: 'accepted' as const })),
      retryStorage: retryStorage.storage,
    })

    await firstCoordinator.initialize()

    expect(incompleteDisable).toHaveBeenCalledWith([], true)
    expect(retryStorage.inspectionPending()).toBe(true)
    expect(get(firstCoordinator.state)).toMatchObject({
      cleanup: { status: 'partial' },
      localInspectionPending: true,
    })

    const completedDisable = vi.fn(async () => disabledResult())
    const reloadedCoordinator = createPushNotificationCoordinator({
      enablePushNotifications: vi.fn(async () => ({ status: 'enabled' as const, endpoint: 'unused' })),
      disablePushNotifications: completedDisable,
      persistSettingsPatch: vi.fn(async () => ({ status: 'accepted' as const })),
      retryStorage: retryStorage.storage,
    })

    await reloadedCoordinator.initialize()

    expect(completedDisable).toHaveBeenCalledWith([], true)
    expect(retryStorage.inspectionPending()).toBe(false)
    expect(get(reloadedCoordinator.state)).toMatchObject({
      cleanup: { status: 'disabled' },
      localInspectionPending: false,
    })
  })

  it('retries device-ledger storage without changing the push subscription state', async () => {
    const storageFailure = new Error('storage unavailable')
    const retryStorage: PushNotificationRetryStorage = {
      loadPendingCleanup: vi
        .fn()
        .mockRejectedValueOnce(storageFailure)
        .mockResolvedValueOnce({ pendingEndpoints: [], localInspectionPending: false }),
      savePendingCleanup: vi.fn(async () => undefined),
    }
    const enablePushNotifications = vi.fn(async () => ({ status: 'enabled' as const, endpoint: 'unused' }))
    const disablePushNotifications = vi.fn(async () => disabledResult())
    const coordinator = createPushNotificationCoordinator({
      enablePushNotifications,
      disablePushNotifications,
      persistSettingsPatch: vi.fn(async () => ({ status: 'accepted' as const })),
      retryStorage,
    })

    await coordinator.initialize()
    expect(get(coordinator.state).retryStorageError).toBe(storageFailure)

    await coordinator.retryStorage()

    expect(retryStorage.loadPendingCleanup).toHaveBeenCalledTimes(2)
    expect(get(coordinator.state)).toMatchObject({ phase: 'idle', retryStorageError: null })
    expect(enablePushNotifications).not.toHaveBeenCalled()
    expect(disablePushNotifications).not.toHaveBeenCalled()
  })

  it('does not compensate a stale enable failure after a newer disable request', async () => {
    const retryStorage = memoryRetryStorage()
    const enable = deferred<{ status: 'fallback'; reason: 'vapid-unavailable' }>()
    const persistSettingsPatch = vi.fn(async () => ({ status: 'accepted' as const }))
    const disablePushNotifications = vi.fn(async () => disabledResult())
    const coordinator = createPushNotificationCoordinator({
      enablePushNotifications: vi.fn(() => enable.promise),
      disablePushNotifications,
      persistSettingsPatch,
      retryStorage: retryStorage.storage,
    })

    const staleEnable = coordinator.reconcile(true)
    await vi.waitFor(() => expect(get(coordinator.state).phase).toBe('enabling'))
    const latestDisable = coordinator.reconcile(false)
    enable.resolve({ status: 'fallback', reason: 'vapid-unavailable' })

    await expect(staleEnable).resolves.toEqual({ status: 'superseded', enabled: true })
    await expect(latestDisable).resolves.toMatchObject({
      status: 'applied',
      enabled: false,
      result: { status: 'disabled' },
    })
    expect(persistSettingsPatch).not.toHaveBeenCalled()
    expect(disablePushNotifications).toHaveBeenCalledOnce()
    expect(get(coordinator.state)).toMatchObject({
      phase: 'idle',
      setupFailure: null,
      compensation: null,
      cleanup: { status: 'disabled' },
    })
  })
})
