import localforage from 'localforage'

const PENDING_CLEANUP_KEY = 'pending-cleanup-v1'
const MAX_PENDING_ENDPOINTS = 100
const MAX_ENDPOINT_LENGTH = 8192

const pushNotificationRetryForage = localforage.createInstance({
  name: 'risuai-device-state',
  storeName: 'push_notifications',
})

export interface PushNotificationRetryState {
  pendingEndpoints: string[]
  localInspectionPending: boolean
}

export interface PushNotificationRetryStorage {
  loadPendingCleanup(): Promise<PushNotificationRetryState>
  savePendingCleanup(state: PushNotificationRetryState): Promise<void>
}

export function normalizePendingPushEndpoints(value: unknown): string[] {
  if (!Array.isArray(value)) return []
  const endpoints: string[] = []
  const seen = new Set<string>()
  for (const endpoint of value) {
    if (
      typeof endpoint !== 'string' ||
      endpoint.length === 0 ||
      endpoint.length > MAX_ENDPOINT_LENGTH ||
      seen.has(endpoint)
    ) {
      continue
    }
    seen.add(endpoint)
    endpoints.push(endpoint)
    if (endpoints.length === MAX_PENDING_ENDPOINTS) break
  }
  return endpoints
}

export function normalizePushNotificationRetryState(value: unknown): PushNotificationRetryState {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return { pendingEndpoints: [], localInspectionPending: false }
  }
  const candidate = value as { pendingEndpoints?: unknown; localInspectionPending?: unknown }
  return {
    pendingEndpoints: normalizePendingPushEndpoints(candidate.pendingEndpoints),
    localInspectionPending: candidate.localInspectionPending === true,
  }
}

export const pushNotificationRetryStorage: PushNotificationRetryStorage = {
  async loadPendingCleanup(): Promise<PushNotificationRetryState> {
    return normalizePushNotificationRetryState(await pushNotificationRetryForage.getItem(PENDING_CLEANUP_KEY))
  },

  async savePendingCleanup(state: PushNotificationRetryState): Promise<void> {
    const normalized = normalizePushNotificationRetryState(state)
    if (normalized.pendingEndpoints.length === 0 && !normalized.localInspectionPending) {
      await pushNotificationRetryForage.removeItem(PENDING_CLEANUP_KEY)
      return
    }
    await pushNotificationRetryForage.setItem(PENDING_CLEANUP_KEY, normalized)
  },
}
