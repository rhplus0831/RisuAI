import { readFileSync } from 'node:fs'
import path from 'node:path'
import vm from 'node:vm'
import { describe, expect, it, vi } from 'vitest'

type ServiceWorkerListener = (event: {
  data?: { json: () => unknown }
  notification?: { close: () => void; data?: { url?: string } }
  waitUntil: (promise: Promise<unknown>) => void
}) => void

class TestMessagePort {
  onmessage: ((event: { data: unknown }) => void) | null = null
  onmessageerror: (() => void) | null = null
  peer: TestMessagePort | null = null

  close = vi.fn()

  postMessage(data: unknown): void {
    this.peer?.onmessage?.({ data })
  }
}

class TestMessageChannel {
  port1 = new TestMessagePort()
  port2 = new TestMessagePort()

  constructor() {
    this.port1.peer = this.port2
    this.port2.peer = this.port1
  }
}

function loadServiceWorker() {
  const listeners: Record<string, ServiceWorkerListener> = {}
  const clients = {
    matchAll: vi.fn(),
    openWindow: vi.fn(),
  }
  const self = {
    addEventListener: vi.fn((type: string, listener: ServiceWorkerListener) => {
      listeners[type] = listener
    }),
    clients,
    location: { origin: 'https://app.example.test' },
    registration: {
      showNotification: vi.fn(),
    },
    skipWaiting: vi.fn(),
  }
  const context = vm.createContext({
    clearTimeout,
    MessageChannel: TestMessageChannel,
    setTimeout,
    URL,
    console,
    self,
  })

  vm.runInContext(readFileSync(path.resolve(process.cwd(), 'public/service-worker.js'), 'utf8'), context, {
    filename: 'public/service-worker.js',
  })

  return { clients, listeners, registration: self.registration }
}

function pushNotification(listener: ServiceWorkerListener, payload: unknown): Promise<unknown[]> {
  const pending: Promise<unknown>[] = []
  listener({
    data: {
      json: () => payload,
    },
    waitUntil: (promise) => {
      pending.push(promise)
    },
  })
  return Promise.all(pending)
}

function clickNotification(listener: ServiceWorkerListener, url: string): Promise<unknown[]> {
  const pending: Promise<unknown>[] = []
  listener({
    notification: {
      close: vi.fn(),
      data: { url },
    },
    waitUntil: (promise) => {
      pending.push(promise)
    },
  })
  return Promise.all(pending)
}

describe('notification service worker', () => {
  it('shows push notifications with a Risu badge and character icon from the payload', async () => {
    const { clients, listeners, registration } = loadServiceWorker()
    clients.matchAll.mockResolvedValueOnce([])

    await pushNotification(listeners.push, {
      title: 'Risuai',
      body: 'A reply is waiting.',
      icon: '/api/v1/assets/character-image',
      badge: '/logo_192.png',
      url: '/character/char-a/chat-a',
    })

    expect(registration.showNotification).toHaveBeenCalledWith('Risuai', {
      body: 'A reply is waiting.',
      icon: '/api/v1/assets/character-image',
      badge: '/logo_192.png',
      tag: 'risuai-chat-completion',
      data: { url: '/character/char-a/chat-a' },
    })
  })

  it('retries with the Risu icon when showing with the character icon fails', async () => {
    const { clients, listeners, registration } = loadServiceWorker()
    clients.matchAll.mockResolvedValueOnce([])
    registration.showNotification.mockRejectedValueOnce(new Error('bad icon'))

    await pushNotification(listeners.push, {
      title: 'Risuai',
      body: 'A reply is waiting.',
      icon: '/api/v1/assets/character-image',
      badge: '/logo_192.png',
      url: '/character/char-a/chat-a',
    })

    expect(registration.showNotification).toHaveBeenCalledTimes(2)
    expect(registration.showNotification).toHaveBeenLastCalledWith('Risuai', {
      body: 'A reply is waiting.',
      icon: '/logo_192.png',
      badge: '/logo_192.png',
      tag: 'risuai-chat-completion',
      data: { url: '/character/char-a/chat-a' },
    })
  })

  it('focuses an existing same-origin window and routes through an acknowledged message', async () => {
    const { clients, listeners } = loadServiceWorker()
    const existingClient = {
      focus: vi.fn(),
      navigate: vi.fn(),
      postMessage: vi.fn((message: unknown, ports: TestMessagePort[]) => {
        ports[0].postMessage({ type: 'risuai:notification-route-ack' })
      }),
      url: 'https://app.example.test/',
    }
    existingClient.focus.mockResolvedValue(existingClient)
    clients.matchAll.mockResolvedValueOnce([existingClient])

    await clickNotification(listeners.notificationclick, '/character/char-a/chat-a')

    expect(existingClient.focus).toHaveBeenCalledOnce()
    expect(existingClient.postMessage).toHaveBeenCalledWith(
      {
        type: 'risuai:notification-route',
        url: 'https://app.example.test/character/char-a/chat-a',
      },
      [expect.any(TestMessagePort)],
    )
    expect(existingClient.navigate).not.toHaveBeenCalled()
    expect(clients.openWindow).not.toHaveBeenCalled()
  })

  it('falls back to hard navigation when the existing client does not acknowledge', async () => {
    vi.useFakeTimers()
    try {
      const { clients, listeners } = loadServiceWorker()
      const existingClient = {
        focus: vi.fn(),
        navigate: vi.fn(async () => undefined),
        postMessage: vi.fn(),
        url: 'https://app.example.test/',
      }
      existingClient.focus.mockResolvedValue(existingClient)
      clients.matchAll.mockResolvedValueOnce([existingClient])

      const pendingClick = clickNotification(listeners.notificationclick, '/character/char-a/chat-a')
      await vi.runAllTimersAsync()
      await pendingClick

      expect(existingClient.focus).toHaveBeenCalledOnce()
      expect(existingClient.postMessage).toHaveBeenCalledOnce()
      expect(existingClient.navigate).toHaveBeenCalledWith('https://app.example.test/character/char-a/chat-a')
      expect(clients.openWindow).not.toHaveBeenCalled()
    } finally {
      vi.useRealTimers()
    }
  })

  it('only focuses when the existing client is already at the target URL', async () => {
    const { clients, listeners } = loadServiceWorker()
    const existingClient = {
      focus: vi.fn(),
      navigate: vi.fn(),
      postMessage: vi.fn(),
      url: 'https://app.example.test/character/char-a/chat-a',
    }
    existingClient.focus.mockResolvedValue(existingClient)
    clients.matchAll.mockResolvedValueOnce([existingClient])

    await clickNotification(listeners.notificationclick, '/character/char-a/chat-a')

    expect(existingClient.focus).toHaveBeenCalledOnce()
    expect(existingClient.postMessage).not.toHaveBeenCalled()
    expect(existingClient.navigate).not.toHaveBeenCalled()
    expect(clients.openWindow).not.toHaveBeenCalled()
  })

  it('opens the notification route when there are no window clients', async () => {
    const { clients, listeners } = loadServiceWorker()
    clients.matchAll.mockResolvedValueOnce([])
    clients.openWindow.mockResolvedValueOnce(undefined)

    await clickNotification(listeners.notificationclick, '/character/char-b/chat-b')

    expect(clients.openWindow).toHaveBeenCalledWith('https://app.example.test/character/char-b/chat-b')
  })
})
