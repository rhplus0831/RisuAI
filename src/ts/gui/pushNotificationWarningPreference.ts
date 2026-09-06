import { readonly, writable } from 'svelte/store'

export const PUSH_NOTIFICATION_WARNING_DISMISSED_KEY = 'risu-push-notification-warning-dismissed-v1'

// Keep dismissal usable for this session even when browser storage is blocked.
let sessionDismissed: boolean | undefined

function readDismissed(): boolean {
  if (sessionDismissed !== undefined) return sessionDismissed
  try {
    return globalThis.localStorage?.getItem(PUSH_NOTIFICATION_WARNING_DISMISSED_KEY) === 'true'
  } catch {
    return false
  }
}

const dismissed = writable(false, (set) => {
  set(readDismissed())
  if (typeof window === 'undefined') return

  const onStorage = (event: StorageEvent) => {
    if (event.key !== null && event.key !== PUSH_NOTIFICATION_WARNING_DISMISSED_KEY) return
    try {
      if (event.storageArea !== window.localStorage) return
    } catch {
      return
    }
    sessionDismissed = undefined
    set(readDismissed())
  }
  window.addEventListener('storage', onStorage)
  return () => window.removeEventListener('storage', onStorage)
})

export const pushNotificationWarningDismissed = readonly(dismissed)

export function setPushNotificationWarningDismissed(value: boolean): void {
  sessionDismissed = value
  try {
    if (value) globalThis.localStorage.setItem(PUSH_NOTIFICATION_WARNING_DISMISSED_KEY, 'true')
    else globalThis.localStorage.removeItem(PUSH_NOTIFICATION_WARNING_DISMISSED_KEY)
    sessionDismissed = undefined
  } catch {
    // This preference only controls presentation; notification setup is independent.
  }
  dismissed.set(value)
}
