import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'
import { COACH_PERFORMANCE_STORAGE_KEY, createCoachPerformanceDiagnostics, getCoachConnectionLabel } from '../apps/coach-mobile/src/coachPerformanceDiagnosticsCore.js'
import { readAllPages } from '../apps/mobile-core/src/coachAvailabilityData.js'
import { buildCoachCalendarEvents } from '../apps/mobile-core/src/coachCalendarCore.js'
import { normalizeCoachInvite } from '../apps/mobile-core/src/coachPhase31ECore.js'
import { countPendingCoachAvailability } from '../apps/mobile-core/src/coachPhase31GCore.js'

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

test('Coach connection diagnostics report available browser hints and an honest native fallback', () => {
  assert.equal(getCoachConnectionLabel({ effectiveType: '4g' }), '4G')
  assert.equal(getCoachConnectionLabel({ type: 'cellular' }), 'CELLULAR')
  assert.equal(getCoachConnectionLabel(null), 'Not available in this app build')
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
  assert.match(calendar, /\.limit\(20\)/)
  assert.match(calendar, /recurrence_frequency,recurrence_until/)
  assert.match(calendar, /readAllPages\(\(\) => createHomeQuery\(\)/)
  const availabilitySummary = (await readFile(new URL('../apps/mobile-core/src/coachPhase31EData.js', import.meta.url), 'utf8'))
    .split('async function getCoachAvailabilityHomeSummary')[1]
    .split('export async function getCoachInvitesAndAvailability')[0]
  assert.match(availabilitySummary, /response_deadline_at/)
  assert.match(availabilitySummary, /readAllPages/g)
  assert.doesNotMatch(availabilitySummary, /\.limit\(250\)/)
  assert.match(offline, /runPreparationLoads\([\s\S]*concurrency = 3/)
  assert.doesNotMatch(diagnostics, /userId|clubId|teamId|email/)
})
