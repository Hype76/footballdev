async function clearWorkspaceInviteCache() {
  if (!await caches.has('app-navigation')) return
  const cache = await caches.open('app-navigation')
  const requests = await cache.keys()
  await Promise.all(requests
    .filter((request) => /^\/(?:workspace|club)-invite(?:\/|$)/.test(new URL(request.url).pathname))
    .map((request) => cache.delete(request)))
}

self.addEventListener('activate', (event) => {
  event.waitUntil(clearWorkspaceInviteCache().catch(() => {
    // Never log cache keys, request URLs or invitation credentials.
    console.warn('Workspace invite cache cleanup failed')
  }))
})
