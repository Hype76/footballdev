self.addEventListener('push', (event) => {
  let payload = {}

  try {
    payload = event.data ? event.data.json() : {}
  } catch {
    payload = {
      title: 'Football Player',
      body: event.data ? event.data.text() : '',
    }
  }

  const title = String(payload.title || 'Football Player')
  const options = {
    body: String(payload.body || ''),
    icon: payload.icon || '/icons/icon-192.png',
    badge: payload.badge || '/icons/favicon-48.png',
    tag: payload.tag || undefined,
    renotify: payload.renotify === true,
    data: {
      url: payload.url || '/parent-portal',
    },
  }

  event.waitUntil(self.registration.showNotification(title, options))
})

self.addEventListener('notificationclick', (event) => {
  event.notification.close()
  const targetUrl = event.notification?.data?.url || '/parent-portal'
  const url = new URL(targetUrl, self.location.origin).href

  event.waitUntil((async () => {
    const clientList = await self.clients.matchAll({
      type: 'window',
      includeUncontrolled: true,
    })

    for (const client of clientList) {
      if ('focus' in client && client.url.startsWith(self.location.origin)) {
        await client.focus()
        if ('navigate' in client) {
          await client.navigate(url)
        }
        return
      }
    }

    if (self.clients.openWindow) {
      await self.clients.openWindow(url)
    }
  })())
})
