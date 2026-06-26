import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('../storage/fastifyStorage', () => ({
  getNodeServerProxyAuth: vi.fn(async () => 'push-auth-token'),
}))

import { disableChatCompletionPushNotifications, enableChatCompletionPushNotifications } from './pushNotifications'

interface FetchCall {
  url: string
  method: string
  headers?: Record<string, string>
  body?: unknown
}

function setupNotification(permission: NotificationPermission, requestedPermission = permission) {
  class MockNotification {
    static permission = permission
    static requestPermission = vi.fn(async () => {
      MockNotification.permission = requestedPermission
      return requestedPermission
    })
  }

  vi.stubGlobal('Notification', MockNotification)
  return MockNotification
}

function setupServiceWorker(registration: Partial<ServiceWorkerRegistration>) {
  const serviceWorker = {
    register: vi.fn(async () => registration),
    getRegistration: vi.fn(async () => registration),
  }
  vi.stubGlobal('navigator', { serviceWorker })
  return serviceWorker
}

function pushSubscription(endpoint = 'https://push.example.test/subscription-a'): PushSubscription {
  return {
    endpoint,
    expirationTime: null,
    getKey: vi.fn(),
    options: { userVisibleOnly: true, applicationServerKey: null },
    toJSON: vi.fn(() => ({
      endpoint,
      expirationTime: null,
      keys: {
        auth: 'auth-secret',
        p256dh: 'public-key',
      },
    })),
    unsubscribe: vi.fn(async () => true),
  } as unknown as PushSubscription
}

function setupPushFetch(publicKey: string | null = 'AQIDBA') {
  const calls: FetchCall[] = []
  vi.stubGlobal(
    'fetch',
    vi.fn(async (input: RequestInfo | URL, init: RequestInit = {}) => {
      const url = String(input)
      const method = init.method ?? 'GET'
      calls.push({
        url,
        method,
        headers: init.headers as Record<string, string> | undefined,
        body: typeof init.body === 'string' ? JSON.parse(init.body) : undefined,
      })

      if (url === '/api/v1/push/vapid-public-key') {
        return new Response(JSON.stringify({ publicKey }), {
          headers: { 'content-type': 'application/json' },
        })
      }

      return new Response(JSON.stringify({ status: 'ok' }), {
        headers: { 'content-type': 'application/json' },
      })
    }) as unknown as typeof fetch,
  )

  return calls
}

describe('push notification browser helper', () => {
  let warnSpy: ReturnType<typeof vi.spyOn>

  beforeEach(() => {
    warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {})
  })

  afterEach(() => {
    warnSpy.mockRestore()
    vi.unstubAllGlobals()
    vi.clearAllMocks()
  })

  it('requests permission, registers the service worker, subscribes, and posts the subscription with auth', async () => {
    const NotificationMock = setupNotification('default', 'granted')
    const subscription = pushSubscription()
    const subscribe = vi.fn(async () => subscription)
    const getSubscription = vi.fn(async () => null)
    const serviceWorker = setupServiceWorker({
      pushManager: {
        getSubscription,
        subscribe,
      } as unknown as PushManager,
    })
    const fetchCalls = setupPushFetch()

    await expect(enableChatCompletionPushNotifications()).resolves.toEqual({
      status: 'enabled',
      endpoint: subscription.endpoint,
    })

    expect(NotificationMock.requestPermission).toHaveBeenCalledTimes(1)
    expect(serviceWorker.register).toHaveBeenCalledWith('/service-worker.js')
    expect(getSubscription).toHaveBeenCalledTimes(1)
    expect(subscribe).toHaveBeenCalledWith({
      userVisibleOnly: true,
      applicationServerKey: new Uint8Array([1, 2, 3, 4]),
    })
    expect(fetchCalls).toEqual([
      {
        url: '/api/v1/push/vapid-public-key',
        method: 'GET',
        headers: undefined,
        body: undefined,
      },
      {
        url: '/api/v1/push/subscriptions',
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          'risu-auth': 'push-auth-token',
        },
        body: {
          subscription: {
            endpoint: subscription.endpoint,
            expirationTime: null,
            keys: {
              auth: 'auth-secret',
              p256dh: 'public-key',
            },
          },
        },
      },
    ])
  })

  it('falls back without subscribing when the server has no VAPID public key', async () => {
    const NotificationMock = setupNotification('granted')
    const subscribe = vi.fn()
    const getSubscription = vi.fn()
    setupServiceWorker({
      pushManager: {
        getSubscription,
        subscribe,
      } as unknown as PushManager,
    })
    setupPushFetch(null)

    await expect(enableChatCompletionPushNotifications()).resolves.toEqual({
      status: 'fallback',
      reason: 'vapid-unavailable',
    })

    expect(NotificationMock.requestPermission).toHaveBeenCalledTimes(1)
    expect(getSubscription).not.toHaveBeenCalled()
    expect(subscribe).not.toHaveBeenCalled()
  })

  it('returns permission-denied without touching push transport when notification permission is denied', async () => {
    const NotificationMock = setupNotification('default', 'denied')
    const serviceWorker = setupServiceWorker({})
    setupPushFetch()

    await expect(enableChatCompletionPushNotifications()).resolves.toEqual({ status: 'permission-denied' })

    expect(NotificationMock.requestPermission).toHaveBeenCalledTimes(1)
    expect(serviceWorker.register).not.toHaveBeenCalled()
  })

  it('unsubscribes the local subscription and deletes its endpoint from the server when disabling', async () => {
    setupNotification('granted')
    const subscription = pushSubscription('https://push.example.test/subscription-b')
    const getSubscription = vi.fn(async () => subscription)
    const serviceWorker = setupServiceWorker({
      pushManager: {
        getSubscription,
      } as unknown as PushManager,
    })
    const fetchCalls = setupPushFetch()

    await expect(disableChatCompletionPushNotifications()).resolves.toBeUndefined()

    expect(serviceWorker.getRegistration).toHaveBeenCalledWith('/')
    expect(subscription.unsubscribe).toHaveBeenCalledTimes(1)
    expect(fetchCalls).toEqual([
      {
        url: '/api/v1/push/subscriptions',
        method: 'DELETE',
        headers: {
          'content-type': 'application/json',
          'risu-auth': 'push-auth-token',
        },
        body: {
          endpoint: 'https://push.example.test/subscription-b',
        },
      },
    ])
  })
})
