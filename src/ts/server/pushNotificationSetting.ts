import {
  disableChatCompletionPushNotifications,
  enableChatCompletionPushNotifications,
  type EnablePushNotificationsResult,
} from './pushNotifications'

export type PushNotificationSettingApplyResult = EnablePushNotificationsResult | { status: 'disabled' }

export type PushNotificationSettingReconcileOutcome<TResult = PushNotificationSettingApplyResult> =
  | { status: 'applied'; enabled: boolean; result: TResult }
  | { status: 'superseded'; enabled: boolean }
  | { status: 'error'; enabled: boolean; error: unknown }

export interface PushNotificationSettingReconciler<TResult> {
  reconcile(enabled: boolean): Promise<PushNotificationSettingReconcileOutcome<TResult>>
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
    reconcile(enabled: boolean): Promise<PushNotificationSettingReconcileOutcome<TResult>> {
      if (desiredState === enabled && currentRequest) return currentRequest.promise

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

const pushNotificationSettingReconciler = createPushNotificationSettingReconciler(
  async (enabled): Promise<PushNotificationSettingApplyResult> => {
    if (enabled) return enableChatCompletionPushNotifications()
    await disableChatCompletionPushNotifications()
    return { status: 'disabled' }
  },
)

export function reconcileChatCompletionPushNotificationSetting(
  enabled: boolean,
): Promise<PushNotificationSettingReconcileOutcome> {
  return pushNotificationSettingReconciler.reconcile(enabled)
}
