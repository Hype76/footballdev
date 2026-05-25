self.addEventListener('install', (event) => {
  event.waitUntil(self.skipWaiting())
})

self.addEventListener('activate', (event) => {
  event.waitUntil((async () => {
    const cacheNames = await caches.keys()

    await Promise.all(
      cacheNames
        .filter((cacheName) => cacheName.includes('workbox') || cacheName.includes('app-navigation'))
        .map((cacheName) => caches.delete(cacheName)),
    )

    await self.clients.claim()

    const clients = await self.clients.matchAll({
      type: 'window',
      includeUncontrolled: true,
    })

    await Promise.all(
      clients.map((client) => {
        if ('navigate' in client) {
          return client.navigate(client.url)
        }

        return Promise.resolve()
      }),
    )

    await self.registration.unregister()
  })())
})
