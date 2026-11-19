export const COACH_PERFORMANCE_STORAGE_KEY = 'fp.mobile.performance.v1.coach'
const MAX_SAMPLES = 60
export const COACH_TIMED_TABS = Object.freeze({ home: 'Home', calendar: 'Calendar', players: 'Players', matchday: 'Match Day', more: 'More' })
export const coachTimingClock = () => typeof globalThis.performance?.now === 'function' ? globalThis.performance.now() : Date.now()

export function createCoachTabTiming({ record, now = coachTimingClock, afterFrame = callback => requestAnimationFrame(callback) }) {
  let current
  return {
    begin(route, startedAt = now()) {
      if (!Object.hasOwn(COACH_TIMED_TABS, route)) return null
      current?.leave()
      const hasData = route !== 'more'
      let screenAt, dataAt, dataStatus
      let screenQueued = false, dataQueued = false, dataRecorded = false
      const log = (stage, at, status, since = startedAt) => record({ name: `tab.${route}.${stage}`, durationMs: at - since, status, source: 'tap' })
      const finishData = () => {
        if (dataRecorded || screenAt === undefined || dataAt === undefined) return
        dataRecorded = true
        log('data', Math.max(screenAt, dataAt), dataStatus, screenAt)
      }
      const visit = {
        screen() {
          if (current !== visit || screenQueued) return
          screenQueued = true
          afterFrame(() => {
            if (current !== visit) return
            screenAt = now()
            log('screen', screenAt, 'success')
            finishData()
          })
        },
        data(status) {
          if (current !== visit || !hasData || dataQueued) return
          dataQueued = true
          afterFrame(() => {
            if (current !== visit) return
            dataAt = now()
            dataStatus = status
            finishData()
          })
        },
        leave() {
          if (current !== visit) return
          current = null
          if (screenAt === undefined) log('screen', now(), 'left')
          if (hasData && !dataRecorded) {
            const leftAt = now()
            log('data', leftAt, 'left', screenAt ?? leftAt)
          }
        },
      }
      current = visit
      return visit
    },
  }
}

const TAB_NAMES = Object.keys(COACH_TIMED_TABS).flatMap(route => route === 'more' ? [`tab.${route}.screen`] : [`tab.${route}.screen`, `tab.${route}.data`])
const ALLOWED_NAMES = new Set([...TAB_NAMES, 'home', 'home.matches', 'home.sessions', 'home.calendar', 'home.development', 'home.chatRooms', 'home.polls', 'home.invites'])

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
      source: sample?.source === 'manual' || sample?.source === 'tap' ? sample.source : 'automatic',
      status: ['error', 'saved', 'left'].includes(sample?.status) ? sample.status : 'success',
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
