import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'
import { COACH_PERFORMANCE_STORAGE_KEY, createCoachPerformanceDiagnostics, getCoachConnectionLabel } from '../apps/coach-mobile/src/coachPerformanceDiagnosticsCore.js'

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
  assert.match(offline, /runPreparationLoads\([\s\S]*concurrency = 3/)
  assert.doesNotMatch(diagnostics, /userId|clubId|teamId|email/)
})
