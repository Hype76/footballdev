export const COACH_PERFORMANCE_STORAGE_KEY = 'fp.mobile.performance.v1.coach'
const MAX_SAMPLES = 60
export const COACH_TIMED_TABS = Object.freeze({ home: 'Home', calendar: 'Calendar', players: 'Players', matchday: 'Match Day', more: 'More' })
export const coachTimingClock = () => typeof globalThis.performance?.now === 'function' ? globalThis.performance.now() : Date.now()
const bundleStartedAt = coachTimingClock()
export const COACH_STARTUP_DESTINATIONS = Object.freeze({ workspace: 'Coach workspace', choose: 'Team or club picker', signin: 'Sign-in screen', unlock: 'Unlock screen', recovery: 'Startup recovery' })

export function createCoachStartupTiming({ record, now = coachTimingClock, afterFrame = callback => requestAnimationFrame(callback), performance = globalThis.performance, bundleStart = bundleStartedAt }) {
  let measured = false, queued = false, backgrounded = false
  let foregroundAt, activeDestination
  return (destination, getState = () => 'active') => {
    if (measured || !Object.hasOwn(COACH_STARTUP_DESTINATIONS, destination)) return
    const state = getState()
    if (state === 'background') { backgrounded = true; foregroundAt = undefined }
    if (state === 'background' || state === 'inactive') return
    if (backgrounded && foregroundAt === undefined) foregroundAt = now()
    activeDestination = destination
    if (queued) return
    queued = true
    afterFrame(() => {
      queued = false
      const frameState = getState()
      if (frameState === 'background') { backgrounded = true; foregroundAt = undefined }
      if (frameState === 'background' || frameState === 'inactive') return
      // React Native's optional marker shares the clock used by performance.now().
      const nativeTiming = performance?.rnStartupTiming
      const start = nativeTiming?.startTime ?? performance?.getEntriesByType?.('navigation')?.[0]?.startTime
      const hasStartupMarker = Number.isFinite(start) && start >= 0 && start <= bundleStart
      const at = now()
      const source = backgrounded ? 'foreground' : !hasStartupMarker ? 'bundle' : start === nativeTiming?.initializeRuntimeStart ? 'runtime' : 'launch'
      const since = backgrounded ? (foregroundAt ?? at) : hasStartupMarker ? start : bundleStart
      measured = true
      record({ name: `startup.${activeDestination}`, durationMs: at - since, status: 'success', source })
    })
  }
}

export function createCoachTabTiming({ record, now = coachTimingClock, afterFrame = callback => requestAnimationFrame(callback) }) {
  let current
  return {
    begin(route, startedAt = now()) {
      if (!Object.hasOwn(COACH_TIMED_TABS, route)) return null
      current?.leave()
      const hasData = route !== 'more'
      let screenAt, firstData, freshData, pendingData
      let screenQueued = false, dataQueued = false, firstRecorded = false, freshRecorded = false
      const log = (stage, at, status) => record({ name: `tab.${route}.${stage}`, durationMs: at - startedAt, status, source: 'tap' })
      const finishData = () => {
        if (screenAt === undefined || dataQueued) return
        if (firstData && !firstRecorded) {
          firstRecorded = true
          log('first', Math.max(screenAt, firstData.at), firstData.status)
        }
        if (freshData && !freshRecorded) {
          freshRecorded = true
          log('fresh', Math.max(screenAt, freshData.at), freshData.status)
        }
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
          if (current !== visit || !hasData || freshRecorded) return
          // A later result in the same frame replaces a snapshot that never painted.
          if (pendingData !== 'success') pendingData = status
          if (dataQueued) return
          dataQueued = true
          afterFrame(() => {
            if (current !== visit) return
            dataQueued = false
            const outcome = pendingData
            pendingData = undefined
            const at = now()
            if ((!firstData || (outcome === 'success' && !firstRecorded)) && outcome !== 'error') firstData = { at, status: outcome === 'success' ? 'success' : 'saved' }
            if ((!freshData || (outcome === 'success' && !freshRecorded)) && outcome !== 'saved') freshData = { at, status: outcome }
            finishData()
          })
        },
        leave() {
          if (current !== visit) return
          current = null
          if (screenAt === undefined) log('screen', now(), 'left')
          if (hasData && !firstRecorded) log('first', now(), 'left')
          if (hasData && !freshRecorded) log('fresh', now(), 'left')
        },
      }
      current = visit
      return visit
    },
  }
}

const TAB_NAMES = Object.keys(COACH_TIMED_TABS).flatMap(route => (route === 'more' ? ['screen'] : ['screen', 'data', 'first', 'fresh']).map(stage => `tab.${route}.${stage}`))
const STARTUP_NAMES = Object.keys(COACH_STARTUP_DESTINATIONS).map(destination => `startup.${destination}`)
const ALLOWED_NAMES = new Set([...TAB_NAMES, ...STARTUP_NAMES, 'home', 'home.matches', 'home.sessions', 'home.calendar', 'home.development', 'home.chatRooms', 'home.polls', 'home.invites'])

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
      source: ['manual', 'tap', 'launch', 'runtime', 'bundle', 'foreground'].includes(sample?.source) ? sample.source : 'automatic',
      status: ['error', 'saved', 'left', 'cached'].includes(sample?.status) ? sample.status : 'success',
    })
  }
  const trim = (values) => {
    if (values.length <= MAX_SAMPLES) return values
    const recent = values.slice(-MAX_SAMPLES)
    if (recent.some(sample => sample.name.startsWith('startup.'))) return recent
    const startup = values.slice(0, -MAX_SAMPLES).reverse().find(sample => sample.name.startsWith('startup.'))
    return startup ? [startup, ...recent.slice(1)] : recent
  }
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
