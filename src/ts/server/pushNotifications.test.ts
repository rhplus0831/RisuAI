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

interface PushFetchOptions {
  publicKey?: string | null
  postStatus?: number
  deleteStatus?: number
}

function setupPushFetch({ publicKey = 'AQIDBA', postStatus = 200, deleteStatus = 200 }: PushFetchOptions = {}) {
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
        status: method === 'POST' ? postStatus : deleteStatus,
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
    setupPushFetch({ publicKey: null })

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

  it('reports each browser setup prerequisite that can terminate enablement', async () => {
    vi.stubGlobal('Notification', undefined)
    setupServiceWorker({})
    setupPushFetch()
    await expect(enableChatCompletionPushNotifications()).resolves.toEqual({
      status: 'fallback',
      reason: 'notification-unavailable',
    })

    setupNotification('default', 'default')
    await expect(enableChatCompletionPushNotifications()).resolves.toEqual({
      status: 'fallback',
      reason: 'permission-default',
    })

    setupNotification('granted')
    vi.stubGlobal('navigator', {})
    await expect(enableChatCompletionPushNotifications()).resolves.toEqual({
      status: 'fallback',
      reason: 'service-worker-unavailable',
    })

    setupServiceWorker({})
    await expect(enableChatCompletionPushNotifications()).resolves.toEqual({
      status: 'fallback',
      reason: 'push-unavailable',
    })

    setupServiceWorker({
      pushManager: {
        getSubscription: vi.fn(async () => null),
        subscribe: vi.fn(async () => {
          throw new Error('subscription failed')
        }),
      } as unknown as PushManager,
    })
    await expect(enableChatCompletionPushNotifications()).resolves.toEqual({
      status: 'fallback',
      reason: 'subscription-failed',
    })
  })

  it('unsubscribes locally when server registration fails', async () => {
    setupNotification('granted')
    const subscription = pushSubscription('https://push.example.test/unregistered')
    setupServiceWorker({
      pushManager: {
        getSubscription: vi.fn(async () => null),
        subscribe: vi.fn(async () => subscription),
      } as unknown as PushManager,
    })
    setupPushFetch({ postStatus: 503 })

    await expect(enableChatCompletionPushNotifications()).resolves.toEqual({
      status: 'fallback',
      reason: 'server-registration-failed',
      endpoint: subscription.endpoint,
      localCleanup: 'succeeded',
    })
    expect(subscription.unsubscribe).toHaveBeenCalledOnce()
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

    await expect(disableChatCompletionPushNotifications()).resolves.toEqual({
      status: 'disabled',
      subscriptionFound: true,
      localUnsubscribed: true,
      serverDeleted: true,
      pendingEndpoints: [],
      localInspectionPending: false,
      failures: [],
    })

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

  it.each([
    {
      name: 'local unsubscribe only',
      unsubscribeResult: false,
      deleteStatus: 200,
      expectedSteps: ['local-unsubscribe'],
      serverDeleted: true,
    },
    {
      name: 'server deletion only',
      unsubscribeResult: true,
      deleteStatus: 503,
      expectedSteps: ['server-deletion'],
      serverDeleted: false,
    },
    {
      name: 'local unsubscribe and server deletion',
      unsubscribeResult: false,
      deleteStatus: 503,
      expectedSteps: ['local-unsubscribe', 'server-deletion'],
      serverDeleted: false,
    },
  ])(
    'returns retryable partial cleanup when $name fails',
    async ({ unsubscribeResult, deleteStatus, expectedSteps, serverDeleted }) => {
      setupNotification('granted')
      const subscription = pushSubscription('https://push.example.test/partial')
      vi.mocked(subscription.unsubscribe).mockResolvedValue(unsubscribeResult)
      setupServiceWorker({
        pushManager: {
          getSubscription: vi.fn(async () => subscription),
        } as unknown as PushManager,
      })
      const fetchCalls = setupPushFetch({ deleteStatus })

      const result = await disableChatCompletionPushNotifications()

      expect(result).toMatchObject({
        status: 'partial',
        subscriptionFound: true,
        localUnsubscribed: unsubscribeResult,
        serverDeleted,
        pendingEndpoints: [subscription.endpoint],
        localInspectionPending: !unsubscribeResult,
      })
      expect(result.failures.map(({ step }) => step)).toEqual(expectedSteps)
      expect(fetchCalls.some(({ method }) => method === 'DELETE')).toBe(true)
    },
  )

  it('reports a rejected browser unsubscribe and still attempts server deletion', async () => {
    setupNotification('granted')
    const subscription = pushSubscription('https://push.example.test/unsubscribe-rejection')
    const unsubscribeError = new Error('browser rejected unsubscribe')
    vi.mocked(subscription.unsubscribe).mockRejectedValue(unsubscribeError)
    setupServiceWorker({
      pushManager: {
        getSubscription: vi.fn(async () => subscription),
      } as unknown as PushManager,
    })
    const fetchCalls = setupPushFetch()

    const result = await disableChatCompletionPushNotifications()

    expect(result).toMatchObject({
      status: 'partial',
      subscriptionFound: true,
      localUnsubscribed: false,
      serverDeleted: true,
      pendingEndpoints: [subscription.endpoint],
      localInspectionPending: true,
      failures: [{ step: 'local-unsubscribe', endpoint: subscription.endpoint, error: unsubscribeError }],
    })
    expect(fetchCalls.at(-1)).toMatchObject({ method: 'DELETE' })
  })

  it('retries a failed server deletion after the local subscription is already gone', async () => {
    setupNotification('granted')
    const endpoint = 'https://push.example.test/server-retry'
    setupServiceWorker({
      pushManager: {
        getSubscription: vi.fn(async () => null),
      } as unknown as PushManager,
    })
    const fetchCalls = setupPushFetch()

    await expect(disableChatCompletionPushNotifications([endpoint])).resolves.toEqual({
      status: 'disabled',
      subscriptionFound: false,
      localUnsubscribed: null,
      serverDeleted: true,
      pendingEndpoints: [],
      localInspectionPending: false,
      failures: [],
    })
    expect(fetchCalls.at(-1)).toMatchObject({
      method: 'DELETE',
      body: { endpoint },
    })
  })

  it('still deletes a known server endpoint when local subscription inspection fails', async () => {
    setupNotification('granted')
    const endpoint = 'https://push.example.test/inspection-failure'
    setupServiceWorker({
      pushManager: {
        getSubscription: vi.fn(async () => {
          throw new Error('inspection failed')
        }),
      } as unknown as PushManager,
    })
    const fetchCalls = setupPushFetch()

    const result = await disableChatCompletionPushNotifications([endpoint])

    expect(result).toMatchObject({
      status: 'partial',
      subscriptionFound: null,
      localUnsubscribed: null,
      serverDeleted: true,
      pendingEndpoints: [],
      localInspectionPending: true,
    })
    expect(result.failures.map(({ step }) => step)).toEqual(['subscription-inspection'])
    expect(fetchCalls.at(-1)).toMatchObject({ method: 'DELETE', body: { endpoint } })
  })

  it('finishes empty cleanup when unsupported service workers prevented any subscription', async () => {
    vi.stubGlobal('navigator', {})
    setupPushFetch()

    await expect(disableChatCompletionPushNotifications()).resolves.toEqual({
      status: 'disabled',
      subscriptionFound: false,
      localUnsubscribed: null,
      serverDeleted: null,
      pendingEndpoints: [],
      localInspectionPending: false,
      failures: [],
    })
  })

  it('finishes known server-endpoint cleanup without inventing a local inspection marker', async () => {
    const endpoint = 'https://push.example.test/server-only-retry'
    vi.stubGlobal('navigator', {})
    const fetchCalls = setupPushFetch()

    await expect(disableChatCompletionPushNotifications([endpoint], false)).resolves.toEqual({
      status: 'disabled',
      subscriptionFound: false,
      localUnsubscribed: null,
      serverDeleted: true,
      pendingEndpoints: [],
      localInspectionPending: false,
      failures: [],
    })
    expect(fetchCalls.at(-1)).toMatchObject({ method: 'DELETE', body: { endpoint } })
  })

  it('retains a durable local-inspection marker when retry cannot access service workers', async () => {
    vi.stubGlobal('navigator', {})
    setupPushFetch()

    const result = await disableChatCompletionPushNotifications([], true)

    expect(result).toMatchObject({
      status: 'partial',
      subscriptionFound: null,
      pendingEndpoints: [],
      localInspectionPending: true,
      failures: [{ step: 'service-worker' }],
    })
  })
})
