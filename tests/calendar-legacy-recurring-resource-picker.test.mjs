import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { test } from 'node:test'

import { buildFootballCalendarEvents } from '../src/lib/football-calendar-events.js'

const sessionsPageUrl = new URL('../src/pages/SessionsPage.jsx', import.meta.url)
const footballCalendarEventsUrl = new URL('../src/lib/football-calendar-events.js', import.meta.url)

function createTrainingSession(overrides = {}) {
  return {
    id: overrides.id,
    clubId: 'club-a',
    teamId: 'team-a',
    team: 'FP TEST Team A',
    sessionType: 'training',
    sessionDate: overrides.sessionDate,
    title: 'FP TEST Legacy Repeat',
    startTime: '18:00',
    endTime: '19:00',
    location: 'Pitch 1',
    notes: 'Weekly technical block',
    createdBy: 'staff-a',
    createdAt: overrides.createdAt || '2026-07-02T09:00:00.000Z',
    status: 'open',
  }
}

test('legacy generated training sessions are inferred as one repeat series', () => {
  const events = buildFootballCalendarEvents({
    sessions: [
      createTrainingSession({ id: 'session-1', sessionDate: '2026-07-03', createdAt: '2026-07-02T09:00:00.000Z' }),
      createTrainingSession({ id: 'session-2', sessionDate: '2026-07-10', createdAt: '2026-07-02T09:00:01.000Z' }),
      createTrainingSession({ id: 'session-3', sessionDate: '2026-07-17', createdAt: '2026-07-02T09:00:02.000Z' }),
    ],
  })

  const sessionEvents = events.filter((event) => event.sourceType === 'session')
  assert.equal(sessionEvents.length, 3)

  for (const event of sessionEvents) {
    assert.equal(event.data.recurrenceFrequency, 'weekly')
    assert.equal(event.data.recurrenceUntil, '2026-07-17')
    assert.deepEqual(event.data.legacyRecurringSeries.sessionIds, ['session-1', 'session-2', 'session-3'])
  }
})

test('legacy recurring training support stays scoped to safe generated session groups', () => {
  const events = buildFootballCalendarEvents({
    sessions: [
      createTrainingSession({ id: 'session-1', sessionDate: '2026-07-03', createdAt: '2026-07-02T09:00:00.000Z' }),
      createTrainingSession({ id: 'session-2', sessionDate: '2026-07-10', createdAt: '2026-07-02T11:00:00.000Z' }),
    ],
  })

  for (const event of events) {
    assert.equal(event.data.legacyRecurringSeries, undefined)
    assert.equal(event.data.recurrenceFrequency, undefined)
  }
})

test('calendar modal source includes legacy recurring session update and delete handling plus scalable picker controls', async () => {
  const [pageSource, calendarSource] = await Promise.all([
    readFile(sessionsPageUrl, 'utf8'),
    readFile(footballCalendarEventsUrl, 'utf8'),
  ])

  assert.match(calendarSource, /function buildLegacySessionSeriesById/)
  assert.match(calendarSource, /createdWindowMs > 30 \* 60 \* 1000/)
  assert.match(calendarSource, /legacyRecurringSeries/)
  assert.match(pageSource, /function isLegacyRecurringSessionEvent/)
  assert.match(pageSource, /getLegacyRecurringSessionSeries\(\{ event: activeEvent, sessions \}\)/)
  assert.match(pageSource, /Choose how to update this repeating event before saving\./)
  assert.match(pageSource, /Choose how to delete this repeating event before continuing\./)
  assert.match(pageSource, /Delete this entire repeat series\? This cannot be undone\./)
  assert.match(pageSource, /Choose from Team Resource Library/)
  assert.match(pageSource, /Search resources/)
  assert.match(pageSource, /Category/)
  assert.match(pageSource, /Apply/)
  assert.match(pageSource, /No matching team resources\./)
})
