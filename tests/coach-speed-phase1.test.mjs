import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'
import { COACH_PERFORMANCE_STORAGE_KEY, createCoachPerformanceDiagnostics, createCoachStartupTiming, createCoachTabTiming } from '../apps/coach-mobile/src/coachPerformanceDiagnosticsCore.js'
import { createMobileResourceCache } from '../apps/mobile-core/src/mobileResourceCache.js'
import { readAllPages } from '../apps/mobile-core/src/coachAvailabilityData.js'
import { buildCoachCalendarEvents } from '../apps/mobile-core/src/coachCalendarCore.js'
import { normalizeCoachInvite } from '../apps/mobile-core/src/coachPhase31ECore.js'
import { buildCoachHomeOperationalSnapshot, countPendingCoachAvailability } from '../apps/mobile-core/src/coachPhase31GCore.js'

test('Coach speed diagnostics retain only bounded local timing fields', async () => {
  let stored = JSON.stringify([{ id: 'stored', name: 'home.matches', durationMs: 700, at: '2026-10-19T12:00:00.000Z', status: 'success', source: 'automatic', secret: 'not retained' }])
  let scheduled
  const storage = {
    getItem: async key => { assert.equal(key, COACH_PERFORMANCE_STORAGE_KEY); return stored },
    setItem: async (key, value) => { assert.equal(key, COACH_PERFORMANCE_STORAGE_KEY); stored = value },
    removeItem: async key => { assert.equal(key, COACH_PERFORMANCE_STORAGE_KEY); stored = null },
  }
  const diagnostics = createCoachPerformanceDiagnostics({ storage, schedule: callback => { scheduled = callback; return 1 }, cancel() {}, now: () => new Date('2026-10-19T13:00:00.000Z') })
  assert.equal(diagnostics.record({ name: 'account.email', durationMs: 1, value: 'private@example.com' }), false)
  for (let index = 0; index < 70; index++) diagnostics.record({ name: 'home', durationMs: index, source: 'manual', status: index === 69 ? 'error' : 'success', userId: 'private' })
  const samples = await diagnostics.read()
  assert.equal(samples.length, 60)
  assert.deepEqual(Object.keys(samples[0]).sort(), ['at', 'durationMs', 'id', 'name', 'source', 'status'])
  assert.equal(samples[0].status, 'error')
  assert.equal(samples.some(sample => JSON.stringify(sample).includes('private')), false)
  await scheduled()
  assert.equal(JSON.parse(stored).length, 60)
  await diagnostics.clear()
  assert.equal(stored, null)
})

test('Coach tab diagnostics measure saved and fresh paints from the tap and fence old visits', () => {
  let time = 100
  const frames = [], samples = []
  const tracker = createCoachTabTiming({ record: sample => samples.push(sample), now: () => time, afterFrame: callback => frames.push(callback) })
  const flush = (nextTime) => { time = nextTime; for (const frame of frames.splice(0)) frame() }
  const calendar = tracker.begin('calendar')
  calendar.screen()
  calendar.screen()
  flush(140)
  calendar.data('saved')
  flush(170)
  calendar.data('success')
  flush(1800)
  assert.deepEqual(samples.map(({name, durationMs, status}) => [name, durationMs, status]), [['tab.calendar.screen', 40, 'success'], ['tab.calendar.first', 70, 'saved'], ['tab.calendar.fresh', 1700, 'success']])

  const players = tracker.begin('players')
  players.data('cached')
  flush(1810)
  players.screen()
  flush(1825)
  assert.deepEqual(samples.slice(-3).map(({name, durationMs, status}) => [name, durationMs, status]), [['tab.players.screen', 25, 'success'], ['tab.players.first', 25, 'saved'], ['tab.players.fresh', 25, 'cached']])

  const abandoned = tracker.begin('matchday')
  abandoned.screen()
  flush(1850)
  abandoned.data('error')
  time = 2000
  const more = tracker.begin('more')
  more.screen()
  more.data('success')
  flush(2010)
  abandoned.data('success')
  assert.deepEqual(samples.slice(-4).map(({name, status, durationMs}) => [name, status, durationMs]), [['tab.matchday.first', 'left', 175], ['tab.matchday.fresh', 'left', 175], ['tab.matchday.create', 'left', 175], ['tab.more.screen', 'success', 10]])
  assert.equal(samples.every(sample => sample.source === 'tap'), true)
  assert.equal(tracker.begin('settings'), null)
})

test('Coach startup uses the earliest available marker and measures the first usable screen once', () => {
  const samples = [], frames = []
  const options = { record: value => samples.push(value), now: () => 2100, bundleStart: 200, afterFrame: fn => frames.push(fn) }
  const native = createCoachStartupTiming({ ...options, performance: { rnStartupTiming: { startTime: 35, initializeRuntimeStart: 80 } } })
  native('home')
  frames.shift()()
  native('signin')
  assert.deepEqual(samples, [{ name: 'startup.home', durationMs: 2065, status: 'success', source: 'launch' }])
  const runtime = createCoachStartupTiming({ ...options, performance: { rnStartupTiming: { startTime: 80, initializeRuntimeStart: 80 } } })
  runtime('unlock'); frames.shift()()
  assert.deepEqual(samples.at(-1), { name: 'startup.unlock', durationMs: 2020, status: 'success', source: 'runtime' })
  const fallback = createCoachStartupTiming({ ...options, performance: { rnStartupTiming: { startTime: 1700000000000 } } })
  fallback('choose'); frames.shift()()
  assert.deepEqual(samples.at(-1), { name: 'startup.choose', durationMs: 1900, status: 'success', source: 'bundle' })
})

test('Coach retries an interrupted opening when it reaches a foreground frame', () => {
  const samples = [], frames = []
  let state = 'active', time = 500
  const options = { record: value => samples.push(value), now: () => time, bundleStart: 200, afterFrame: fn => frames.push(fn), performance: null }
  const getState = () => state
  const interrupted = createCoachStartupTiming(options)
  interrupted('workspace', getState)
  state = 'inactive'; frames.shift()()
  assert.deepEqual(samples, [])
  state = 'active'; time = 800; interrupted('workspace', getState)
  time = 820; frames.shift()()
  assert.deepEqual(samples, [{ name: 'startup.workspace', durationMs: 620, status: 'success', source: 'bundle' }])

  const warmedInBackground = createCoachStartupTiming(options)
  warmedInBackground('workspace', getState)
  state = 'background'; warmedInBackground('workspace', getState)
  state = 'active'; time = 18000; warmedInBackground('workspace', getState)
  time = 18023; frames.shift()()
  assert.deepEqual(samples.at(-1), { name: 'startup.workspace', durationMs: 23, status: 'success', source: 'foreground' })
})

test('Coach keeps the last startup result after the tab sample history fills', async () => {
  const diagnostics = createCoachPerformanceDiagnostics({ storage: { getItem: async () => '[]' }, schedule: () => 1 })
  diagnostics.record({ name: 'startup.signin', source: 'launch', durationMs: 500 })
  diagnostics.record({ name: 'startup.workspace', source: 'runtime', durationMs: 4500 })
  for (let index = 0; index < 70; index++) diagnostics.record({ name: 'tab.home.first', source: 'tap', durationMs: index })
  const rows = await diagnostics.read()
  assert.equal(rows.length, 60)
  assert.deepEqual(rows.filter(row => row.name.startsWith('startup.')).map(({name, source, durationMs}) => [name, source, durationMs]), [['startup.workspace', 'runtime', 4500]])
})

test('Coach does not count saved data that never painted and retains a separately painted snapshot after an error', () => {
  const samples = [], frames = []
  let time = 100
  const tracker = createCoachTabTiming({ record: sample => samples.push(sample), now: () => time, afterFrame: callback => frames.push(callback) })
  const paint = nextTime => { time = nextTime; for (const frame of frames.splice(0)) frame() }
  const calendar = tracker.begin('calendar')
  calendar.data('saved'); paint(150)
  calendar.screen(); calendar.data('success'); paint(200)
  assert.deepEqual(samples.filter(row => row.name.startsWith('tab.calendar.')).map(row => row.status), ['success', 'success', 'success'])
  const home = tracker.begin('home')
  home.screen(); home.data('saved'); paint(220)
  home.data('error'); paint(700)
  assert.deepEqual(samples.slice(-2).map(({durationMs, status}) => [durationMs, status]), [[20, 'saved'], [500, 'error']])
})

test('A warm cache hit is distinct from fresh network data, including a shared ongoing request', async () => {
  const cache = createMobileResourceCache()
  let resolve
  const deferred = new Promise(done => { resolve = done })
  const sources = []
  const options = { onSource: source => sources.push(source) }
  const first = cache.read('team:home', () => deferred, options)
  const other = cache.read('team:home', () => assert.fail('Should share the original request'), options)
  assert.equal(first, other)
  resolve(['example'])
  await first
  assert.deepEqual(await cache.read('team:home', () => assert.fail('Should use the cache'), options), ['example'])
  assert.deepEqual(sources, ['network', 'network', 'cache'])
})

test('Coach tab results retain tap source and failed duration without account content', async () => {
  const diagnostics = createCoachPerformanceDiagnostics({ storage: { getItem: async () => '[]' }, schedule: () => 1 })
  diagnostics.record({ name: 'tab.home.data', status: 'error', source: 'tap', durationMs: 17_700, player: 'private' })
  const [sample] = await diagnostics.read()
  assert.equal(sample.source, 'tap')
  assert.equal(sample.durationMs, 17_700)
  assert.equal(sample.status, 'error')
  assert.equal(Object.hasOwn(sample, 'player'), false)
  assert.equal(diagnostics.record({ name: 'tab.more.data' }), false)
})

test('Match Day measures when Create match becomes available independently of the fixture list', () => {
  let time = 100
  const frames = [], samples = []
  const tracker = createCoachTabTiming({ record: sample => samples.push(sample), now: () => time, afterFrame: callback => frames.push(callback) })
  const paint = at => { time = at; for (const frame of frames.splice(0)) frame() }
  const matchDay = tracker.begin('matchday')
  matchDay.screen()
  paint(120)
  matchDay.actionReady()
  matchDay.actionReady()
  paint(160)
  assert.deepEqual(samples.map(({ name, durationMs }) => [name, durationMs]), [
    ['tab.matchday.screen', 20], ['tab.matchday.create', 60],
  ])
  const cancelled = tracker.begin('matchday')
  cancelled.actionReady()
  tracker.begin('more')
  paint(200)
  assert.deepEqual(samples.filter(sample => sample.name === 'tab.matchday.create').map(sample => sample.status), ['success', 'left'])
})

test('Coach Home Calendar retains future occurrences from an older recurring series', () => {
  const events = buildCoachCalendarEvents({ calendarEvents: [{
    id: 'series',
    title: 'Weekly training',
    event_type: 'training',
    starts_at: '2026-10-01T17:00:00.000Z',
    ends_at: '2026-10-01T18:00:00.000Z',
    recurrence_frequency: 'weekly',
    recurrence_until: '2026-11-30',
  }] })
  assert.ok(events.some(event => event.occurrenceDate > '2026-10-19'))
})

test('Coach Home availability pagination reads every row and rejects a later-page failure', async () => {
  const rows = Array.from({ length: 580 }, (_, index) => ({ id: String(index).padStart(3, '0') }))
  const starts = []
  const createQuery = (fail = false) => () => ({
    order() { return this },
    async range(start, end) {
      starts.push(start)
      if (fail && start === 250) return { error: new Error('Later page unavailable') }
      return { data: rows.slice(start, end + 1), error: null }
    },
  })
  assert.equal((await readAllPages(createQuery())).length, 580)
  assert.deepEqual(starts, [0, 250, 500])
  await assert.rejects(readAllPages(createQuery(true)), /Later page unavailable/)
})

test('Coach Home availability excludes expired future training requests', () => {
  const invite = normalizeCoachInvite({
    calendar_event_id: 'training',
    email_sent_at: '2026-10-18T12:00:00.000Z',
    occurrence_starts_at: '2026-10-20T18:00:00.000Z',
    player_id: 'player',
    request_id: 'request',
    response_deadline_at: '2026-10-19T11:00:00.000Z',
    status: 'pending',
  }, 'training')
  assert.equal(countPendingCoachAvailability([invite], new Date('2026-10-19T12:00:00.000Z'), 7), 0)
})

test('Coach Home skips inactive rows beyond every bounded summary limit', () => {
  const future = '2099-10-20T18:00:00.000Z'
  const snapshot = buildCoachHomeOperationalSnapshot({
    now: new Date('2099-10-19T12:00:00.000Z'),
    calendar: [
      ...Array.from({ length: 20 }, (_, index) => ({ id: `cancelled-calendar-${index}`, status: 'cancelled', startsAt: future })),
      { id: 'active-calendar', status: 'scheduled', startsAt: future },
    ],
    matches: [
      ...Array.from({ length: 30 }, (_, index) => ({ id: `closed-match-${index}`, status: index % 2 ? 'completed' : 'full_time', matchDate: '2099-10-20', kickoffTime: '18:00' })),
      { id: 'active-match', status: 'scheduled', matchDate: '2099-10-20', kickoffTime: '19:00' },
    ],
    sessions: [
      ...Array.from({ length: 20 }, (_, index) => ({ id: `closed-session-${index}`, status: index % 2 ? 'completed' : 'cancelled', sessionDate: '2099-10-20', startTime: '18:00' })),
      { id: 'active-session', status: 'open', sessionDate: '2099-10-20', startTime: '19:00' },
    ],
  })
  assert.equal(snapshot.nextCalendar.id, 'active-calendar')
  assert.equal(snapshot.nextMatch.id, 'active-match')
  assert.equal(snapshot.nextSession.id, 'active-session')
})

test('Coach Home uses lean summaries, slower polling and local diagnostics', async () => {
  const [app, calendar, phase, data, offline, diagnostics] = await Promise.all([
    readFile(new URL('../apps/coach-mobile/App.js', import.meta.url), 'utf8'),
    readFile(new URL('../apps/mobile-core/src/coachCalendarData.js', import.meta.url), 'utf8'),
    readFile(new URL('../apps/mobile-core/src/coachPhase31GData.js', import.meta.url), 'utf8'),
    readFile(new URL('../apps/mobile-core/src/data.js', import.meta.url), 'utf8'),
    readFile(new URL('../apps/coach-mobile/src/coachOfflinePreparation.js', import.meta.url), 'utf8'),
    readFile(new URL('../apps/coach-mobile/src/coachPerformanceDiagnostics.js', import.meta.url), 'utf8'),
  ])
  assert.match(app, /HOME_REFRESH_MIN_INTERVAL_MS = 3 \* 60 \* 1000/)
  assert.match(app, /summaryOnly: true/)
  assert.match(app, /CoachSpeedDiagnostics/)
  assert.match(phase, /homeSummary: true/)
  assert.match(phase, /coach:home-availability-summary/)
  const select = data.match(/const COACH_HOME_MATCH_SELECT = '([^']+)'/)?.[1] || ''
  assert.ok(select.includes('match_date'))
  assert.equal(select.includes('match_day_events'), false)
  assert.match(data, /\.gte\('match_date'/)
  assert.match(data, /\.gte\('session_date'/)
  assert.match(data, /\.not\('status', 'in', '\(full_time,completed,cancelled\)'\)/)
  assert.match(data, /\.not\('status', 'in', '\(completed,cancelled\)'\)/)
  assert.match(calendar, /\.limit\(20\)/)
  assert.match(calendar, /\.is\('cancelled_at', null\)/)
  assert.match(calendar, /recurrence_frequency,recurrence_until/)
  assert.match(calendar, /readAllPages\(\(\) => createHomeQuery\(\)/)
  const availabilitySummary = (await readFile(new URL('../apps/mobile-core/src/coachPhase31EData.js', import.meta.url), 'utf8'))
    .split('async function getCoachAvailabilityHomeSummary')[1]
    .split('export async function getCoachInvitesAndAvailability')[0]
  assert.match(availabilitySummary, /response_deadline_at/)
  assert.match(availabilitySummary, /\.in\('status', \['scheduled', 'scorer_request'\]\)/)
  assert.match(availabilitySummary, /readAllPages/g)
  assert.doesNotMatch(availabilitySummary, /\.limit\(250\)/)
  assert.match(offline, /runPreparationLoads\([\s\S]*concurrency = 3/)
  assert.doesNotMatch(diagnostics, /userId|clubId|teamId|email/)
})
