import { readonly, writable } from 'svelte/store'
import type { DisablePushNotificationsResult, EnablePushNotificationsResult } from './pushNotifications'

export type PushNotificationEnableFailure = Exclude<EnablePushNotificationsResult, { status: 'enabled' }>
export type PushNotificationCoordinatorPhase =
  | 'idle'
  | 'hydrating'
  | 'startup-cleanup'
  | 'enabling'
  | 'disabling'
  | 'retrying-storage'
  | 'retrying-cleanup'

export interface PushNotificationCoordinatorState {
  phase: PushNotificationCoordinatorPhase
  desiredEnabled: boolean
  setupFailure: PushNotificationEnableFailure | null
  nextRetryAt: number | null
  cleanup: DisablePushNotificationsResult | null
  pendingEndpoints: string[]
  localInspectionPending: boolean
  retryStorageError: unknown | null
  operationError: unknown | null
}

export function initialPushNotificationCoordinatorState(): PushNotificationCoordinatorState {
  return {
    phase: 'idle',
    desiredEnabled: false,
    setupFailure: null,
    nextRetryAt: null,
    cleanup: null,
    pendingEndpoints: [],
    localInspectionPending: false,
    retryStorageError: null,
    operationError: null,
  }
}

// The shell observes this small store without eagerly loading the push runtime.
export const pushNotificationStateWriter = writable(initialPushNotificationCoordinatorState())
export const pushNotificationCoordinatorState = readonly(pushNotificationStateWriter)
