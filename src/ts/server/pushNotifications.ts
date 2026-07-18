import { getNodeServerProxyAuth } from '../storage/fastifyStorage'

const SERVICE_WORKER_URL = '/service-worker.js'
const SERVICE_WORKER_SCOPE = '/'
const VAPID_PUBLIC_KEY_ENDPOINT = '/api/v1/push/vapid-public-key'
const PUSH_SUBSCRIPTIONS_ENDPOINT = '/api/v1/push/subscriptions'
const LOG_PREFIX = '[push notifications]'

export type PushNotificationFallbackReason =
  | 'notification-unavailable'
  | 'permission-default'
  | 'service-worker-unavailable'
  | 'push-unavailable'
  | 'vapid-unavailable'
  | 'subscription-failed'
  | 'server-registration-failed'

export type EnablePushNotificationsResult =
  | { status: 'enabled'; endpoint: string }
  | {
      status: 'fallback'
      reason: PushNotificationFallbackReason
      endpoint?: string
      localCleanup?: 'succeeded' | 'failed'
    }
  | { status: 'permission-denied' }

export type DisablePushNotificationCleanupStep =
  | 'service-worker'
  | 'subscription-inspection'
  | 'local-unsubscribe'
  | 'server-deletion'

export interface DisablePushNotificationFailure {
  step: DisablePushNotificationCleanupStep
  error?: unknown
  endpoint?: string
}

export interface DisablePushNotificationsResult {
  status: 'disabled' | 'partial'
  subscriptionFound: boolean | null
  localUnsubscribed: boolean | null
  serverDeleted: boolean | null
  pendingEndpoints: string[]
  localInspectionPending: boolean
  failures: DisablePushNotificationFailure[]
}

type PushTransportResult = { ok: true } | { ok: false; error: unknown }

export async function enableChatCompletionPushNotifications(): Promise<EnablePushNotificationsResult> {
  const permission = await requestNotificationPermission()
  if (permission === 'denied') return { status: 'permission-denied' }
  if (permission === 'unavailable') return { status: 'fallback', reason: 'notification-unavailable' }
  if (permission !== 'granted') return { status: 'fallback', reason: 'permission-default' }

  if (!canUseServiceWorker()) {
    return { status: 'fallback', reason: 'service-worker-unavailable' }
  }

  const registration = await registerPushServiceWorker()
  if (!registration) return { status: 'fallback', reason: 'service-worker-unavailable' }

  const pushManager = pushManagerForRegistration(registration)
  if (!pushManager) return { status: 'fallback', reason: 'push-unavailable' }

  const publicKey = await fetchVapidPublicKey()
  if (!publicKey) return { status: 'fallback', reason: 'vapid-unavailable' }

  const subscription = await getOrCreatePushSubscription(pushManager, publicKey)
  if (!subscription) return { status: 'fallback', reason: 'subscription-failed' }

  const endpoint = subscription.endpoint
  const registered = await registerPushSubscription(subscription)
  if (!registered.ok) {
    const localCleanup = await unsubscribePushSubscription(subscription)
    return {
      status: 'fallback',
      reason: 'server-registration-failed',
      endpoint,
      localCleanup: localCleanup.ok ? 'succeeded' : 'failed',
    }
  }

  return { status: 'enabled', endpoint }
}

export async function disableChatCompletionPushNotifications(
  pendingEndpoints: readonly string[] = [],
  requireLocalInspection = false,
): Promise<DisablePushNotificationsResult> {
  const failures: DisablePushNotificationFailure[] = []
  const endpoints = new Set(pendingEndpoints)
  let subscriptionFound: boolean | null = null
  let localUnsubscribed: boolean | null = null
  let localInspectionPending = requireLocalInspection

  if (!canUseServiceWorker()) {
    if (requireLocalInspection) {
      failures.push({ step: 'service-worker' })
      localInspectionPending = true
    } else {
      subscriptionFound = false
      localInspectionPending = false
    }
  } else {
    try {
      const registration = await navigator.serviceWorker.getRegistration(SERVICE_WORKER_SCOPE)
      const pushManager = registration ? pushManagerForRegistration(registration) : null
      const subscription = pushManager ? await pushManager.getSubscription() : null
      subscriptionFound = !!subscription
      localInspectionPending = false

      if (subscription) {
        endpoints.add(subscription.endpoint)
        const unsubscribeResult = await unsubscribePushSubscription(subscription)
        localUnsubscribed = unsubscribeResult.ok
        if (unsubscribeResult.ok === false) {
          localInspectionPending = true
          failures.push({
            step: 'local-unsubscribe',
            endpoint: subscription.endpoint,
            error: unsubscribeResult.error,
          })
        }
      }
    } catch (error) {
      warnPushError('Failed to inspect local push subscription.', error)
      localInspectionPending = true
      failures.push({ step: 'subscription-inspection', error })
    }
  }

  let serverDeleted: boolean | null = null
  const failedServerEndpoints: string[] = []
  if (endpoints.size > 0) {
    const deletionResults = await Promise.all(
      [...endpoints].map(async (endpoint) => ({ endpoint, result: await deletePushSubscription(endpoint) })),
    )
    serverDeleted = deletionResults.every(({ result }) => result.ok)
    for (const { endpoint, result } of deletionResults) {
      if (result.ok === false) {
        failedServerEndpoints.push(endpoint)
        failures.push({ step: 'server-deletion', endpoint, error: result.error })
      }
    }
  }

  const localCleanupPending = subscriptionFound === true && localUnsubscribed !== true
  const unresolvedEndpoints = new Set(failedServerEndpoints)
  if (localCleanupPending) {
    for (const endpoint of endpoints) unresolvedEndpoints.add(endpoint)
  }

  return {
    status: failures.length === 0 ? 'disabled' : 'partial',
    subscriptionFound,
    localUnsubscribed,
    serverDeleted,
    pendingEndpoints: [...unresolvedEndpoints],
    localInspectionPending,
    failures,
  }
}

async function requestNotificationPermission(): Promise<NotificationPermission | 'unavailable'> {
  if (typeof Notification === 'undefined' || typeof Notification.requestPermission !== 'function') {
    return 'unavailable'
  }

  try {
    return await Notification.requestPermission()
  } catch (error) {
    warnPushError('Failed to request notification permission.', error)
    return Notification.permission
  }
}

function canUseServiceWorker(): boolean {
  return typeof navigator !== 'undefined' && !!navigator.serviceWorker
}

async function registerPushServiceWorker(): Promise<ServiceWorkerRegistration | null> {
  try {
    return await navigator.serviceWorker.register(SERVICE_WORKER_URL)
  } catch (error) {
    warnPushError('Failed to register the notification service worker.', error)
    return null
  }
}

function pushManagerForRegistration(registration: ServiceWorkerRegistration): PushManager | null {
  const candidate = registration as ServiceWorkerRegistration & { pushManager?: PushManager }
  return candidate.pushManager ?? null
}

async function fetchVapidPublicKey(): Promise<string | null> {
  let response: Response
  try {
    response = await fetch(VAPID_PUBLIC_KEY_ENDPOINT, { method: 'GET' })
  } catch (error) {
    warnPushError('Failed to fetch the VAPID public key.', error)
    return null
  }

  if (!response.ok) {
    warnPushError(`Failed to fetch the VAPID public key: HTTP ${response.status}.`)
    return null
  }

  let body: unknown
  try {
    body = await response.json()
  } catch (error) {
    warnPushError('Failed to parse the VAPID public key response.', error)
    return null
  }

  if (!body || typeof body !== 'object') {
    warnPushError('Failed to parse the VAPID public key response.')
    return null
  }

  const publicKey = (body as { publicKey?: unknown }).publicKey
  if (publicKey === null) return null
  if (typeof publicKey === 'string' && publicKey.length > 0) return publicKey

  warnPushError('The VAPID public key response was invalid.')
  return null
}

async function getOrCreatePushSubscription(
  pushManager: PushManager,
  publicKey: string,
): Promise<PushSubscription | null> {
  try {
    const existingSubscription = await pushManager.getSubscription()
    if (existingSubscription) return existingSubscription

    return await pushManager.subscribe({
      userVisibleOnly: true,
      applicationServerKey: urlBase64ToUint8Array(publicKey),
    })
  } catch (error) {
    warnPushError('Failed to subscribe to browser push notifications.', error)
    return null
  }
}

async function registerPushSubscription(subscription: PushSubscription): Promise<PushTransportResult> {
  try {
    const auth = await getNodeServerProxyAuth()
    const response = await fetch(PUSH_SUBSCRIPTIONS_ENDPOINT, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'risu-auth': auth,
      },
      body: JSON.stringify({ subscription: subscription.toJSON() }),
    })

    if (!response.ok) {
      throw new Error(`HTTP ${response.status}`)
    }

    return { ok: true }
  } catch (error) {
    warnPushError('Failed to register the push subscription with the server.', error)
    return { ok: false, error }
  }
}

async function deletePushSubscription(endpoint: string): Promise<PushTransportResult> {
  try {
    const auth = await getNodeServerProxyAuth()
    const response = await fetch(PUSH_SUBSCRIPTIONS_ENDPOINT, {
      method: 'DELETE',
      headers: {
        'content-type': 'application/json',
        'risu-auth': auth,
      },
      body: JSON.stringify({ endpoint }),
    })

    if (!response.ok) {
      throw new Error(`HTTP ${response.status}`)
    }

    return { ok: true }
  } catch (error) {
    warnPushError('Failed to delete the push subscription from the server.', error)
    return { ok: false, error }
  }
}

async function unsubscribePushSubscription(subscription: PushSubscription): Promise<PushTransportResult> {
  try {
    const unsubscribed = await subscription.unsubscribe()
    if (!unsubscribed) throw new Error('Browser push subscription unsubscribe returned false.')
    return { ok: true }
  } catch (error) {
    warnPushError('Failed to unsubscribe from local push notifications.', error)
    return { ok: false, error }
  }
}

function urlBase64ToUint8Array(base64String: string): Uint8Array<ArrayBuffer> {
  const padding = '='.repeat((4 - (base64String.length % 4)) % 4)
  const base64 = (base64String + padding).replace(/-/g, '+').replace(/_/g, '/')
  const rawData = atob(base64)
  const outputArray = new Uint8Array(rawData.length) as Uint8Array<ArrayBuffer>

  for (let i = 0; i < rawData.length; i += 1) {
    outputArray[i] = rawData.charCodeAt(i)
  }

  return outputArray
}

function warnPushError(message: string, error?: unknown): void {
  if (error === undefined) {
    console.warn(`${LOG_PREFIX} ${message}`)
    return
  }
  console.warn(`${LOG_PREFIX} ${message}`, error)
}
