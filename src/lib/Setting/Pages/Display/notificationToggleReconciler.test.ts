import { describe, expect, it, vi } from 'vitest'
import { createNotificationToggleReconciler } from './notificationToggleReconciler'

interface Deferred<T> {
  promise: Promise<T>
  resolve: (value: T) => void
}

function deferred<T>(): Deferred<T> {
  let resolve!: (value: T) => void
  const promise = new Promise<T>((next) => {
    resolve = next
  })
  return { promise, resolve }
}

describe('notification toggle reconciliation', () => {
  it('disables after an in-flight enable when the latest setting is off', async () => {
    const enable = deferred<void>()
    const disable = deferred<void>()
    const calls: string[] = []
    const applyDesiredState = vi.fn(async (enabled: boolean) => {
      calls.push(`${enabled ? 'enable' : 'disable'}:start`)
      await (enabled ? enable.promise : disable.promise)
      calls.push(`${enabled ? 'enable' : 'disable'}:end`)
    })
    const reconciler = createNotificationToggleReconciler(applyDesiredState)

    const first = reconciler.reconcile(true)
    await vi.waitFor(() => expect(applyDesiredState).toHaveBeenCalledTimes(1))
    expect(applyDesiredState).toHaveBeenLastCalledWith(true)

    const latest = reconciler.reconcile(false)
    expect(applyDesiredState).toHaveBeenCalledTimes(1)

    enable.resolve()
    await vi.waitFor(() => expect(applyDesiredState).toHaveBeenCalledTimes(2))
    expect(applyDesiredState).toHaveBeenLastCalledWith(false)

    disable.resolve()
    await Promise.all([first, latest])
    expect(calls).toEqual(['enable:start', 'enable:end', 'disable:start', 'disable:end'])
  })

  it('enables after an in-flight disable when the latest setting is on', async () => {
    const disable = deferred<void>()
    const enable = deferred<void>()
    const calls: string[] = []
    const applyDesiredState = vi.fn(async (enabled: boolean) => {
      calls.push(`${enabled ? 'enable' : 'disable'}:start`)
      await (enabled ? enable.promise : disable.promise)
      calls.push(`${enabled ? 'enable' : 'disable'}:end`)
    })
    const reconciler = createNotificationToggleReconciler(applyDesiredState)

    const first = reconciler.reconcile(false)
    await vi.waitFor(() => expect(applyDesiredState).toHaveBeenCalledTimes(1))
    expect(applyDesiredState).toHaveBeenLastCalledWith(false)

    const latest = reconciler.reconcile(true)
    expect(applyDesiredState).toHaveBeenCalledTimes(1)

    disable.resolve()
    await vi.waitFor(() => expect(applyDesiredState).toHaveBeenCalledTimes(2))
    expect(applyDesiredState).toHaveBeenLastCalledWith(true)

    enable.resolve()
    await Promise.all([first, latest])
    expect(calls).toEqual(['disable:start', 'disable:end', 'enable:start', 'enable:end'])
  })
})
