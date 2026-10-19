export const COACH_PERFORMANCE_STORAGE_KEY = 'fp.mobile.performance.v1.coach'
const MAX_SAMPLES = 60
const ALLOWED_NAMES = new Set(['home', 'home.matches', 'home.sessions', 'home.calendar', 'home.development', 'home.chatRooms', 'home.polls', 'home.invites'])

export function createCoachPerformanceDiagnostics({ storage, schedule = setTimeout, cancel = clearTimeout, now = () => new Date() }) {
  let samples = []
  let hydrated = false
  let hydratePromise = null
  let persistTimer = null
  let sequence = 0
  const safeSample = (sample) => {
    const name = String(sample?.name || '')
    const durationMs = Math.max(0, Math.min(120000, Math.round(Number(sample?.durationMs) || 0)))
    if (!ALLOWED_NAMES.has(name)) return null
    return Object.freeze({
      at: String(sample?.at || now().toISOString()),
      durationMs,
      id: String(sample?.id || `${now().getTime()}:${sequence++}`),
      name,
      source: sample?.source === 'manual' ? 'manual' : 'automatic',
      status: sample?.status === 'error' ? 'error' : 'success',
    })
  }
  const trim = values => values.slice(-MAX_SAMPLES)
  const hydrate = async () => {
    if (hydrated) return
    if (!hydratePromise) {
      hydratePromise = storage.getItem(COACH_PERFORMANCE_STORAGE_KEY).then((value) => {
        const stored = JSON.parse(value || '[]')
        const currentIds = new Set(samples.map((sample) => sample.id))
        const restored = Array.isArray(stored) ? stored.map(safeSample).filter(Boolean).filter((sample) => !currentIds.has(sample.id)) : []
        samples = trim([...restored, ...samples])
        hydrated = true
      }).catch(() => { hydrated = true })
    }
    await hydratePromise
  }
  const schedulePersist = () => {
    if (persistTimer) return
    persistTimer = schedule(() => {
      persistTimer = null
      void hydrate().then(() => storage.setItem(COACH_PERFORMANCE_STORAGE_KEY, JSON.stringify(samples))).catch(() => {})
    }, 750)
  }
  return Object.freeze({
    record(sample) {
      const normalized = safeSample(sample)
      if (!normalized) return false
      samples = trim([...samples, normalized])
      schedulePersist()
      return true
    },
    async read() {
      await hydrate()
      return [...samples].reverse()
    },
    async clear() {
      samples = []
      hydrated = true
      hydratePromise = Promise.resolve()
      if (persistTimer) cancel(persistTimer)
      persistTimer = null
      await storage.removeItem(COACH_PERFORMANCE_STORAGE_KEY)
    },
  })
}

export function getCoachConnectionLabel(connection = globalThis.navigator?.connection) {
  const type = String(connection?.type || connection?.effectiveType || '').trim()
  return type ? type.toUpperCase() : 'Not available in this app build'
}
