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
  assert.match(pageSource, /If this is a repeat series, the entire series will be deleted\. This cannot be undone\./)
  assert.match(pageSource, /Choose from Team Resource Library/)
  assert.match(pageSource, /Search resources/)
  assert.match(pageSource, /Category/)
  assert.match(pageSource, /Apply/)
  assert.match(pageSource, /No matching team resources\./)
})
import { createRequire } from 'node:module'
const require = createRequire(import.meta.url)
const { parse } = require('@babel/parser')
const pageSource = await readFile(sessionsPageUrl, 'utf8')
const declarations = parse(pageSource, { sourceType: 'module', plugins: ['jsx'] }).program.body
function bindPageFunction(name, deps) {
  const node = declarations.find(item => item.type === 'FunctionDeclaration' && item.id?.name === name)
  assert.ok(node, name)
  return new Function(...Object.keys(deps), `${pageSource.slice(node.start, node.end)};return ${name}`)(...Object.values(deps))
}
const dates = {
  formatDateInput: value => value instanceof Date ? `${value.getFullYear()}-${String(value.getMonth() + 1).padStart(2, '0')}-${String(value.getDate()).padStart(2, '0')}` : String(value || '').slice(0, 10),
  formatTimeInput: value => String(value || '').slice(0, 5),
  addMinutesToTime: () => '18:30',
  getTrimmedFormValue: value => String(value || '').trim(),
}
const legacyEvent = bindPageFunction('isLegacyRecurringSessionEvent', {})
const recurringEvent = bindPageFunction('isRecurringCalendarEvent', { ...dates, isLegacyRecurringSessionEvent: legacyEvent })
const dateChanged = bindPageFunction('hasRecurringCalendarDateTimeChange', { ...dates, isRecurringCalendarEvent: recurringEvent })
const legacySeries = bindPageFunction('getLegacyRecurringSessionSeries', { ...dates, isLegacyRecurringSessionEvent: legacyEvent })
const formFromEvent = bindPageFunction('getFormFromCalendarEvent', { ...dates, getDefaultCalendarForm: date => ({ date }), getFormInviteFields: () => ({}) })
const dayShift = bindPageFunction('getDayShift', dates)
const shiftDate = bindPageFunction('shiftDateByDays', dates)
function sessionEditFixture({ linked = false, missing = false } = {}) {
  const sessions = ['2026-11-03', '2026-11-10', '2026-11-17'].map((date, index) => ({ id: `session-${index + 1}`, sessionDate: date, sessionType: 'training', teamId: 'team-a', attendance: [{ playerId: 'player-a', response: 'attending' }] }))
  const event = { sourceType: 'session', sourceId: 'session-1', date: '2026-11-03', data: { ...sessions[0], startTime: '17:30', endTime: '18:30', title: 'Training', notes: 'Keep notes', recurrenceFrequency: 'weekly', recurrenceUntil: '2026-11-17', ...(linked ? { legacyRecurringSeries: { sessionIds: sessions.map(row => row.id), recurrenceFrequency: 'weekly', recurrenceUntil: '2026-11-17' } } : {}) } }
  const form = formFromEvent(event)
  const calls = []
  const start = pageSource.indexOf('const legacySeriesSessions = getLegacyRecurringSessionSeries({ event: activeEvent, sessions })')
  const end = pageSource.indexOf('\n        } else {\n          for (const sessionDate', start)
  assert.ok(start > 0 && end > start)
  const deps = { ...dates, activeEvent: event, sessions: missing ? sessions.slice(0, 2) : sessions, calendarForm: form, payload: { ...sessions[0], sessionDate: form.date, notes: 'Changed notes' }, user: { id: 'coach' }, getLegacyRecurringSessionSeries: legacySeries, isLegacyRecurringSessionEvent: legacyEvent, hasRecurringCalendarDateTimeChange: dateChanged, getDayShift: dayShift, shiftDateByDays: shiftDate, updateAssessmentSession: async request => { calls.push(structuredClone(request)); return { id: request.sessionId, ...request.session } } }
  const execute = new Function(...Object.keys(deps), `return async () => { const savedSessions = []; ${pageSource.slice(start, end)}; return savedSessions }`)(...Object.values(deps))
  const run = () => { deps.payload.sessionDate = form.date; return execute() }
  return { sessions, event, form, calls, run }
}

test('unlinked older training opens as a single-date edit and updates only that record', async () => {
  const f = sessionEditFixture()
  const before = structuredClone(f.sessions)
  assert.equal(f.form.recurrenceFrequency, 'none')
  assert.equal(f.form.recurrenceUntil, '')
  assert.equal(f.form.notes, 'Keep notes')
  f.form.date = '2026-11-04'
  await f.run()
  assert.deepEqual(f.calls.map(call => call.sessionId), ['session-1'])
  assert.equal(f.calls[0].session.sessionDate, '2026-11-04')
  assert.equal(f.calls[0].session.notes, 'Changed notes')
  assert.deepEqual(f.sessions, before, 'Existing dates and attendance records are not rewritten')
})

test('a verified repeat edit requires explicit scope and a complete loaded series before any update', async () => {
  const missing = sessionEditFixture({ linked: true, missing: true })
  missing.form.repeatUpdateScope = 'entire_series'
  await assert.rejects(missing.run(), /full repeat series could not be loaded/)
  assert.deepEqual(missing.calls, [])
  const f = sessionEditFixture({ linked: true })
  f.form.date = '2026-11-04'
  await assert.rejects(f.run(), /Choose how to update/)
  assert.deepEqual(f.calls, [])
  f.form.repeatUpdateScope = 'entire_series'
  await f.run()
  assert.deepEqual(f.calls.map(call => call.sessionId), ['session-1', 'session-2', 'session-3'])
  assert.deepEqual(f.calls.map(call => call.session.sessionDate), ['2026-11-04', '2026-11-11', '2026-11-18'])
})

test('an unlinked training record still rejects an injected request to move unknown repeat dates', async () => {
  const f = sessionEditFixture()
  f.form.recurrenceFrequency = 'weekly'
  await assert.rejects(f.run(), /saved separately/)
  assert.deepEqual(f.calls, [])
})
