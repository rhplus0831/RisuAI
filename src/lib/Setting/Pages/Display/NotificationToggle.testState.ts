import { writable } from 'svelte/store'
import type { PushNotificationCoordinatorState } from 'src/ts/server/pushNotificationSetting'

export function initialNotificationCoordinatorState(): PushNotificationCoordinatorState {
  return {
    phase: 'idle' as const,
    setupFailure: null,
    compensation: null,
    cleanup: null,
    pendingEndpoints: [] as string[],
    localInspectionPending: false,
    retryStorageError: null,
    operationError: null,
  }
}

export const notificationCoordinatorState = writable(initialNotificationCoordinatorState())
