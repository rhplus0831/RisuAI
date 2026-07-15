import { describe, expect, it, vi } from 'vitest'

vi.mock('./pushNotifications', () => ({
  disableChatCompletionPushNotifications: vi.fn(async () => undefined),
  enableChatCompletionPushNotifications: vi.fn(async () => ({ status: 'enabled', endpoint: 'test' })),
}))

import { createPushNotificationSettingReconciler } from './pushNotificationSetting'

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
})
