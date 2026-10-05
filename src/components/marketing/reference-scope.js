export function createReferenceScope(root) {
  let active = true
  const cleanup = [], timeouts = new Set(), intervals = new Set()
  const listen = (target, type, listener, options) => { target.addEventListener(type, listener, options); cleanup.push(() => target.removeEventListener(type, listener, options)) }
  const scopedDocument = new Proxy(document, { get(target, key) {
    if (key === 'querySelector') return selector => root.querySelector(selector)
    if (key === 'querySelectorAll') return selector => root.querySelectorAll(selector)
    if (key === 'getElementById') return id => root.querySelector('#' + CSS.escape(id))
    if (key === 'body') return root
    if (key === 'documentElement') return root.parentElement
    if (key === 'addEventListener') return (...args) => listen(target, ...args)
    const value = Reflect.get(target, key); return typeof value === 'function' ? value.bind(target) : value
  } })
  const scopedWindow = new Proxy(window, { get(target, key) {
    if (key === 'FP_OFFER_SHARE') return { publicOfferUrl: 'https://footballplayer.online/matchday/#first-250', publicOfferLive: true }
    if (key === 'FP_STATS') { const url = import.meta.env.VITE_SUPABASE_URL, key = import.meta.env.VITE_SUPABASE_ANON_KEY; return url && key ? { endpoint: url + '/rest/v1/marketing_matchday_stats?select=matches_recorded,goals_recorded,alerts_sent,teams_active,clubs_active,updated_at&id=eq.true', key } : null }
    if (key === 'document') return scopedDocument
    if (key === 'addEventListener') return (...args) => listen(target, ...args)
    const value = Reflect.get(target, key); return typeof value === 'function' ? value.bind(target) : value
  } })
  const observer = window.IntersectionObserver ? class extends window.IntersectionObserver { constructor(...args) { super(...args); cleanup.push(() => this.disconnect()) } } : undefined
  const media = query => { const value = window.matchMedia(query); return new Proxy(value, { get(target, key) { if (key === 'addEventListener') return (...args) => listen(target, ...args); const result = Reflect.get(target, key); return typeof result === 'function' ? result.bind(target) : result } }) }
  return { document: scopedDocument, window: scopedWindow, IntersectionObserver: observer, matchMedia: media, addEventListener: (...args) => listen(window, ...args),
    fetch: (url, options) => { if (options?.method && options.method !== 'GET') throw new Error('Reference interactions are read only'); return fetch(url, options) },
    setTimeout: (callback, delay) => { const timer = window.setTimeout(() => { if (active) callback() }, delay); timeouts.add(timer); return timer }, clearTimeout: timer => window.clearTimeout(timer),
    setInterval: (callback, delay) => { const timer = window.setInterval(() => { if (active) callback() }, delay); intervals.add(timer); return timer }, clearInterval: timer => window.clearInterval(timer),
    dispose: () => { active = false; cleanup.forEach(fn => fn()); timeouts.forEach(timer => window.clearTimeout(timer)); intervals.forEach(timer => window.clearInterval(timer)); root.parentElement?.classList.remove('js-motion') } }
}
