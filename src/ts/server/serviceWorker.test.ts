import { readFileSync } from 'node:fs'
import path from 'node:path'
import vm from 'node:vm'
import { describe, expect, it, vi } from 'vitest'

type ServiceWorkerListener = (event: {
  data?: { json: () => unknown }
  notification?: { close: () => void; data?: { url?: string } }
  waitUntil: (promise: Promise<unknown>) => void
}) => void

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

  it('navigates an existing same-origin window to the notification route before focusing it', async () => {
    const { clients, listeners } = loadServiceWorker()
    const navigatedClient = {
      focus: vi.fn(async () => undefined),
      url: 'https://app.example.test/character/char-a/chat-a',
    }
    const existingClient = {
      focus: vi.fn(async () => undefined),
      navigate: vi.fn(async () => navigatedClient),
      url: 'https://app.example.test/',
    }
    clients.matchAll.mockResolvedValueOnce([existingClient])

    await clickNotification(listeners.notificationclick, '/character/char-a/chat-a')

    expect(existingClient.navigate).toHaveBeenCalledWith('https://app.example.test/character/char-a/chat-a')
    expect(existingClient.focus).not.toHaveBeenCalled()
    expect(navigatedClient.focus).toHaveBeenCalledOnce()
    expect(clients.openWindow).not.toHaveBeenCalled()
  })

  it('opens the notification route when no same-origin app window is available', async () => {
    const { clients, listeners } = loadServiceWorker()
    clients.matchAll.mockResolvedValueOnce([
      {
        focus: vi.fn(async () => undefined),
        url: 'https://other.example.test/',
      },
    ])
    clients.openWindow.mockResolvedValueOnce(undefined)

    await clickNotification(listeners.notificationclick, '/character/char-b/chat-b')

    expect(clients.openWindow).toHaveBeenCalledWith('https://app.example.test/character/char-b/chat-b')
  })
})
