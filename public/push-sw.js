self.__footballPlayerInstalledOverActiveWorker = Boolean(self.registration.active)

const PWA_VERSION_REQUEST = 'football-player:pwa-version-request'
const PWA_VERSION_RESPONSE = 'football-player:pwa-version-response'
const PWA_VERSION_RESPONSE_WAIT_MS = 1_000

function normalizeEntryUrl(value) {
  try {
    const url = new URL(String(value ?? ''), self.location.origin)
    return url.origin === self.location.origin ? url.href : ''
  } catch {
    return ''
  }
}

function findEntryUrl(indexHtml) {
  const scriptTags = String(indexHtml ?? '').match(/<script\b[^>]*>/gi) ?? []

  for (const scriptTag of scriptTags) {
    if (!/\btype=["']module["']/i.test(scriptTag)) {
      continue
    }

    const sourceMatch = scriptTag.match(/\bsrc=["']([^"']+)["']/i)
    const entryUrl = normalizeEntryUrl(sourceMatch?.[1])

    if (entryUrl) {
      return entryUrl
    }
  }

  return ''
}

async function loadCurrentEntryUrl() {
  const request = new Request(new URL('/index.html', self.location.origin).href, { cache: 'no-store' })

  try {
    const response = await fetch(request)

    if (response.ok) {
      return findEntryUrl(await response.text())
    }
  } catch {
    // Fall back to the current precached application shell when offline.
  }

  const cachedResponse = await caches.match(request, { ignoreSearch: true })
  return cachedResponse ? findEntryUrl(await cachedResponse.text()) : ''
}

async function refreshStaleAppClients() {
  if (!self.__footballPlayerInstalledOverActiveWorker) {
    return
  }

  const clientList = await self.clients.matchAll({
    type: 'window',
    includeUncontrolled: true,
  })

  if (clientList.length === 0) {
    return
  }

  const requestId = `${Date.now()}:${Math.random()}`
  const clientEntryUrls = new Map()
  const handleVersionResponse = (event) => {
    if (
      event.data?.type === PWA_VERSION_RESPONSE &&
      event.data?.requestId === requestId &&
      event.source?.id
    ) {
      clientEntryUrls.set(event.source.id, normalizeEntryUrl(event.data.entryUrl))
    }
  }

  self.addEventListener('message', handleVersionResponse)
  clientList.forEach((client) => {
    client.postMessage({
      type: PWA_VERSION_REQUEST,
      requestId,
    })
  })

  await new Promise((resolve) => {
    setTimeout(resolve, PWA_VERSION_RESPONSE_WAIT_MS)
  })
  self.removeEventListener('message', handleVersionResponse)

  const currentEntryUrl = await loadCurrentEntryUrl()

  if (!currentEntryUrl) {
    return
  }

  clientList
    .filter((client) => clientEntryUrls.get(client.id) !== currentEntryUrl)
    .forEach((client) => {
      void client.navigate(client.url).catch(() => {})
    })
}

self.addEventListener('activate', (event) => {
  event.waitUntil(refreshStaleAppClients())
})

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
