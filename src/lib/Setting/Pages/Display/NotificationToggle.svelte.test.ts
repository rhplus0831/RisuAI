import { mount, tick, unmount } from 'svelte'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const notificationMocks = vi.hoisted(() => ({
  applyServerBackedSetting: vi.fn(),
  initialize: vi.fn(),
  reconcile: vi.fn(),
  retryCleanup: vi.fn(),
  retryCompensation: vi.fn(),
  retryStorage: vi.fn(),
}))

vi.mock('src/ts/server/settingsOwner.svelte', () => ({
  applyServerBackedSetting: notificationMocks.applyServerBackedSetting,
}))

vi.mock('src/ts/storage/database.svelte', async () => {
  const { getResourceDatabase } = await import('src/ts/__tests__/resourceDatabaseState')
  return { getDatabase: getResourceDatabase }
})

vi.mock('src/ts/server/pushNotificationSetting', async () => {
  const { notificationCoordinatorState } = await import('./NotificationToggle.testState')
  return {
    initializePushNotificationCoordinator: notificationMocks.initialize,
    pushNotificationCoordinatorState: notificationCoordinatorState,
    reconcileChatCompletionPushNotificationSetting: notificationMocks.reconcile,
    retryChatCompletionPushNotificationCleanup: notificationMocks.retryCleanup,
    retryChatCompletionPushNotificationCompensation: notificationMocks.retryCompensation,
    retryChatCompletionPushNotificationStorage: notificationMocks.retryStorage,
  }
})

import { language } from 'src/lang'
import NotificationToggle from './NotificationToggle.svelte'
import { initialNotificationCoordinatorState, notificationCoordinatorState } from './NotificationToggle.testState'
import { replaceResourceDatabase as setDatabaseLite } from 'src/ts/server/resourceState.svelte'
import type { EnablePushNotificationsResult } from 'src/ts/server/pushNotifications'
import { getResourceDatabase as getDatabase, withTestDatabaseWrite } from 'src/ts/__tests__/resourceDatabaseState'

type MountedComponent = Parameters<typeof unmount>[0]

let component: MountedComponent | undefined
let target: HTMLElement

function checkbox(): HTMLInputElement {
  const input = target.querySelector<HTMLInputElement>('input[type="checkbox"]')
  if (!input) throw new Error('notification checkbox not found')
  return input
}

function buttonNamed(name: string): HTMLButtonElement {
  const button = Array.from(target.querySelectorAll('button')).find(
    (candidate) => candidate.textContent?.trim() === name,
  )
  if (!button) throw new Error(`button not found: ${name}`)
  return button
}

beforeEach(() => {
  target = document.createElement('div')
  document.body.appendChild(target)
  setDatabaseLite({ notification: false } as any)
  notificationCoordinatorState.set(initialNotificationCoordinatorState())
  notificationMocks.applyServerBackedSetting.mockReset()
  notificationMocks.initialize.mockReset()
  notificationMocks.initialize.mockResolvedValue(undefined)
  notificationMocks.reconcile.mockReset()
  notificationMocks.retryCleanup.mockReset()
  notificationMocks.retryCompensation.mockReset()
  notificationMocks.retryStorage.mockReset()
  notificationMocks.applyServerBackedSetting.mockImplementation((key: string, value: unknown) => {
    if (key !== 'notification') return
    withTestDatabaseWrite((database) => {
      database.notification = value as boolean
    })
  })
})

afterEach(() => {
  if (component) {
    unmount(component)
    component = undefined
  }
  target.remove()
  setDatabaseLite({} as any)
  notificationCoordinatorState.set(initialNotificationCoordinatorState())
})

describe('NotificationToggle shared push acknowledgement', () => {
  const failedEnablements: Array<{
    name: string
    result: EnablePushNotificationsResult
    message: string
  }> = [
    {
      name: 'permission denial',
      result: { status: 'permission-denied' },
      message: language.permissionDenied,
    },
    {
      name: 'missing Notification API',
      result: { status: 'fallback', reason: 'notification-unavailable' },
      message: language.pushNotifications.setupFailures.notificationUnavailable,
    },
    {
      name: 'undecided permission',
      result: { status: 'fallback', reason: 'permission-default' },
      message: language.pushNotifications.setupFailures.permissionDefault,
    },
    {
      name: 'missing service worker',
      result: { status: 'fallback', reason: 'service-worker-unavailable' },
      message: language.pushNotifications.setupFailures.serviceWorkerUnavailable,
    },
    {
      name: 'missing Push API',
      result: { status: 'fallback', reason: 'push-unavailable' },
      message: language.pushNotifications.setupFailures.pushUnavailable,
    },
    {
      name: 'missing VAPID key',
      result: { status: 'fallback', reason: 'vapid-unavailable' },
      message: language.pushNotifications.setupFailures.vapidUnavailable,
    },
    {
      name: 'browser subscription failure',
      result: { status: 'fallback', reason: 'subscription-failed' },
      message: language.pushNotifications.setupFailures.subscriptionFailed,
    },
    {
      name: 'server registration failure',
      result: {
        status: 'fallback',
        reason: 'server-registration-failed',
        endpoint: 'https://push.example.test/unregistered',
        localCleanup: 'succeeded',
      },
      message: language.pushNotifications.setupFailures.serverRegistrationFailed,
    },
  ]

  it.each(failedEnablements)('renders the shared compensation for $name', async ({ result, message }) => {
    notificationMocks.reconcile.mockImplementationOnce(async () => {
      withTestDatabaseWrite((database) => {
        database.notification = false
      })
      await tick()
      notificationCoordinatorState.set({
        ...initialNotificationCoordinatorState(),
        setupFailure: result as Exclude<EnablePushNotificationsResult, { status: 'enabled' }>,
        compensation: 'accepted',
        cleanup: {
          status: 'disabled',
          subscriptionFound: false,
          localUnsubscribed: null,
          serverDeleted: null,
          pendingEndpoints: [],
          localInspectionPending: false,
          failures: [],
        },
      })
      return { status: 'applied', enabled: true, result, compensation: 'accepted' }
    })
    component = mount(NotificationToggle, { target })

    checkbox().click()

    await vi.waitFor(() => expect(target.querySelector('[role="alert"]')?.textContent).toContain(message))
    expect(target.querySelector('[role="alert"]')?.textContent).toContain(
      language.pushNotifications.compensationAccepted,
    )
    expect(notificationMocks.applyServerBackedSetting.mock.calls).toEqual([['notification', true]])
    expect(notificationMocks.reconcile).toHaveBeenCalledWith(true)
    expect(getDatabase().notification).toBe(false)
    await vi.waitFor(() => expect(checkbox().checked).toBe(false))
  })

  it.each([
    ['accepted', language.pushNotifications.compensationAccepted],
    ['queued', language.pushNotifications.compensationQueued],
    ['failed', language.pushNotifications.compensationFailed],
  ] as const)('shows the exact %s false-setting outcome', async (compensation, message) => {
    notificationCoordinatorState.set({
      ...initialNotificationCoordinatorState(),
      setupFailure: { status: 'fallback', reason: 'vapid-unavailable' },
      compensation,
    })
    component = mount(NotificationToggle, { target })
    await tick()

    expect(target.querySelector('[role="alert"]')?.textContent).toContain(message)
    if (compensation === 'failed') {
      notificationMocks.retryCompensation.mockResolvedValueOnce('accepted')
      buttonNamed(language.pushNotifications.retryCompensation).click()
      await vi.waitFor(() => expect(notificationMocks.retryCompensation).toHaveBeenCalledOnce())
    } else {
      expect(target.textContent).not.toContain(language.pushNotifications.retryCompensation)
    }
  })

  it('renders coordinator pending state', async () => {
    notificationCoordinatorState.set({
      ...initialNotificationCoordinatorState(),
      phase: 'compensating',
      setupFailure: { status: 'permission-denied' },
    })
    component = mount(NotificationToggle, { target })
    await tick()

    expect(notificationMocks.initialize).toHaveBeenCalledOnce()
    expect(target.querySelector('[role="status"]')?.textContent).toContain(language.pushNotifications.compensating)
  })

  it('routes the checkbox through exact compensation retry after a failed false patch', async () => {
    withTestDatabaseWrite((database) => {
      database.notification = true
    })
    notificationCoordinatorState.set({
      ...initialNotificationCoordinatorState(),
      setupFailure: { status: 'fallback', reason: 'vapid-unavailable' },
      compensation: 'failed',
    })
    notificationMocks.retryCompensation.mockResolvedValueOnce('accepted')
    component = mount(NotificationToggle, { target })
    await tick()

    checkbox().click()

    await vi.waitFor(() => expect(notificationMocks.retryCompensation).toHaveBeenCalledOnce())
    expect(notificationMocks.applyServerBackedSetting).not.toHaveBeenCalled()
    expect(notificationMocks.reconcile).not.toHaveBeenCalled()
  })

  it('keeps partial cleanup visible and retryable across unmount and remount', async () => {
    const endpoint = 'https://push.example.test/stale'
    notificationCoordinatorState.set({
      ...initialNotificationCoordinatorState(),
      cleanup: {
        status: 'partial',
        subscriptionFound: true,
        localUnsubscribed: false,
        serverDeleted: false,
        pendingEndpoints: [endpoint],
        localInspectionPending: true,
        failures: [{ step: 'local-unsubscribe' }, { step: 'server-deletion', endpoint }],
      },
      pendingEndpoints: [endpoint],
      localInspectionPending: true,
    })
    notificationMocks.retryCleanup.mockImplementationOnce(async () => {
      notificationCoordinatorState.set({
        ...initialNotificationCoordinatorState(),
        cleanup: {
          status: 'disabled',
          subscriptionFound: false,
          localUnsubscribed: null,
          serverDeleted: true,
          pendingEndpoints: [],
          localInspectionPending: false,
          failures: [],
        },
      })
      return { status: 'applied', enabled: false }
    })

    component = mount(NotificationToggle, { target })
    await tick()
    expect(target.querySelector('[role="alert"]')?.textContent).toContain(
      language.pushNotifications.cleanupFailures.localUnsubscribe,
    )
    expect(target.querySelector('[role="alert"]')?.textContent).toContain(language.pushNotifications.pendingCleanup(1))
    expect(target.querySelector('[role="alert"]')?.textContent).toContain(
      language.pushNotifications.localInspectionPending,
    )

    unmount(component)
    component = undefined
    target.replaceChildren()
    component = mount(NotificationToggle, { target })
    await tick()

    expect(target.querySelector('[role="alert"]')?.textContent).toContain(
      language.pushNotifications.cleanupFailures.serverDeletion,
    )
    buttonNamed(language.pushNotifications.retryCleanup).click()
    await vi.waitFor(() => expect(notificationMocks.retryCleanup).toHaveBeenCalledOnce())
    await vi.waitFor(() => expect(target.querySelector('[role="alert"]')).toBeNull())
  })

  it('retries a device-ledger failure without requiring notifications to be off', async () => {
    withTestDatabaseWrite((database) => {
      database.notification = true
    })
    notificationCoordinatorState.set({
      ...initialNotificationCoordinatorState(),
      retryStorageError: new Error('storage unavailable'),
    })
    component = mount(NotificationToggle, { target })
    await tick()

    expect(target.querySelector('[role="alert"]')?.textContent).toContain(
      language.pushNotifications.cleanupRetryStorageFailed,
    )
    buttonNamed(language.pushNotifications.retryStorage).click()
    await vi.waitFor(() => expect(notificationMocks.retryStorage).toHaveBeenCalledOnce())
  })

  it('shows an unexpected operation failure with a working retry action', async () => {
    notificationCoordinatorState.set({
      ...initialNotificationCoordinatorState(),
      operationError: new Error('unexpected failure'),
    })
    component = mount(NotificationToggle, { target })
    await tick()

    expect(target.querySelector('[role="alert"]')?.textContent).toContain(language.pushNotifications.operationFailed)
    buttonNamed(language.pushNotifications.retryOperation).click()
    await vi.waitFor(() => expect(notificationMocks.retryCleanup).toHaveBeenCalledOnce())
  })
})
