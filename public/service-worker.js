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

async function focusOrOpenApp(path) {
  const targetUrl = new URL(path, self.location.origin).href
  const windowClients = await self.clients.matchAll({
    type: 'window',
    includeUncontrolled: true,
  })

  for (const client of windowClients) {
    if (new URL(client.url).origin === self.location.origin && 'focus' in client) {
      const navigatedClient = 'navigate' in client ? await navigateClient(client, targetUrl) : client
      return (navigatedClient ?? client).focus()
    }
  }

  if (self.clients.openWindow) {
    return self.clients.openWindow(targetUrl)
  }
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
