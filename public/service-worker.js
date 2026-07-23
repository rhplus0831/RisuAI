self.addEventListener('install', () => {
  self.skipWaiting()
})

self.addEventListener('activate', (event) => {
  event.waitUntil(self.clients.claim())
})

self.addEventListener('push', (event) => {
  event.waitUntil(showChatCompletionNotification(event))
})

self.addEventListener('notificationclick', (event) => {
  event.notification.close()
  event.waitUntil(focusOrOpenApp(event.notification.data?.url ?? '/'))
})

const NOTIFICATION_ROUTE_MESSAGE_TYPE = 'risuai:notification-route'
const NOTIFICATION_ROUTE_ACK_TYPE = 'risuai:notification-route-ack'
const NOTIFICATION_ROUTE_ACK_TIMEOUT_MS = 1000

async function focusOrOpenApp(path) {
  const targetUrl = new URL(path, self.location.origin).href
  const windowClients = await self.clients.matchAll({
    type: 'window',
    includeUncontrolled: true,
  })

  for (const client of windowClients) {
    if (new URL(client.url).origin === self.location.origin && 'focus' in client) {
      const focusedClient = (await client.focus()) ?? client
      if (focusedClient.url === targetUrl) return focusedClient

      const acknowledged = await requestClientNavigation(focusedClient, targetUrl)
      if (acknowledged || focusedClient.url === targetUrl) return focusedClient

      return 'navigate' in focusedClient ? navigateClient(focusedClient, targetUrl) : focusedClient
    }
  }

  if (self.clients.openWindow) {
    return self.clients.openWindow(targetUrl)
  }
}

function requestClientNavigation(client, targetUrl) {
  if (!('postMessage' in client) || typeof MessageChannel !== 'function') {
    return Promise.resolve(false)
  }

  const channel = new MessageChannel()
  return new Promise((resolve) => {
    let settled = false
    const finish = (acknowledged) => {
      if (settled) return
      settled = true
      clearTimeout(timeout)
      channel.port1.close()
      resolve(acknowledged)
    }
    const timeout = setTimeout(() => finish(false), NOTIFICATION_ROUTE_ACK_TIMEOUT_MS)

    channel.port1.onmessage = (event) => {
      if (event.data?.type === NOTIFICATION_ROUTE_ACK_TYPE) finish(true)
    }
    channel.port1.onmessageerror = () => finish(false)

    try {
      client.postMessage(
        {
          type: NOTIFICATION_ROUTE_MESSAGE_TYPE,
          url: targetUrl,
        },
        [channel.port2],
      )
    } catch {
      finish(false)
    }
  })
}

async function navigateClient(client, targetUrl) {
  try {
    return await client.navigate(targetUrl)
  } catch {
    return client
  }
}

async function showChatCompletionNotification(event) {
  const payload = readPushPayload(event)
  const windowClients = await self.clients.matchAll({
    type: 'window',
    includeUncontrolled: true,
  })

  if (windowClients.some((client) => client.focused || client.visibilityState === 'visible')) {
    return
  }

  try {
    return await self.registration.showNotification(payload.title, notificationOptions(payload))
  } catch {
    return self.registration.showNotification(
      payload.title,
      notificationOptions({
        ...payload,
        icon: '/logo_192.png',
        badge: '/logo_192.png',
      }),
    )
  }
}

function notificationOptions(payload) {
  return {
    body: payload.body,
    icon: payload.icon,
    badge: payload.badge,
    tag: 'risuai-chat-completion',
    data: { url: payload.url },
  }
}

function readPushPayload(event) {
  if (event.data) {
    try {
      const data = event.data.json()
      return {
        title: typeof data.title === 'string' ? data.title : 'Risuai',
        body: typeof data.body === 'string' ? data.body : 'Chat processing complete.',
        icon: typeof data.icon === 'string' ? data.icon : '/logo_192.png',
        badge: typeof data.badge === 'string' ? data.badge : '/logo_192.png',
        url: typeof data.url === 'string' ? data.url : '/',
      }
    } catch {
      // Fall through to the generic completion payload.
    }
  }

  return {
    title: 'Risuai',
    body: 'Chat processing complete.',
    icon: '/logo_192.png',
    badge: '/logo_192.png',
    url: '/',
  }
}
