// Workbox serializes this function into the generated service worker. Keep it
// self-contained: invitation URLs must never become persistent cache keys.
export function shouldCacheAppNavigation({ request, url }) {
  return request.mode === 'navigate'
    && !/^\/(?:workspace|club)-invite(?:\/|$)/i.test(url.pathname)
}
