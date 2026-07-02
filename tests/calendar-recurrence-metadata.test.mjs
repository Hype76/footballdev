import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { test } from 'node:test'

import { buildFootballCalendarEvents } from '../src/lib/football-calendar-events.js'

const sessionsPageUrl = new URL('../src/pages/SessionsPage.jsx', import.meta.url)

test('recurring calendar grid occurrences keep recurrence and series metadata for the modal', () => {
  const events = buildFootballCalendarEvents({
    calendarEvents: [
      {
        id: 'calendar-series-1',
        clubId: 'club-a',
        teamId: 'team-a',
        eventType: 'training',
        title: 'FP TEST Recurring Training',
        startsAt: '2026-08-05T09:00:00',
        endsAt: '2026-08-05T10:00:00',
        location: 'Football Player Stadium',
        notes: 'Training Kit Please',
        recurrenceFrequency: 'weekly',
        recurrenceUntil: '2026-08-26',
        canEdit: true,
      },
    ],
  })

  const generatedOccurrence = events.find((event) => event.id === 'calendar:calendar-series-1:2026-08-12')

  assert.ok(generatedOccurrence)
  assert.equal(generatedOccurrence.sourceType, 'calendar')
  assert.equal(generatedOccurrence.sourceId, 'calendar-series-1')
  assert.equal(generatedOccurrence.occurrenceDate, '2026-08-12')
  assert.equal(generatedOccurrence.date, '2026-08-12')
  assert.equal(generatedOccurrence.time, '09:00')
  assert.equal(generatedOccurrence.data.recurrenceFrequency, 'weekly')
  assert.equal(generatedOccurrence.data.recurrenceUntil, '2026-08-26')
  assert.equal(generatedOccurrence.data.recurrenceOccurrenceDate, '2026-08-12')
  assert.equal(generatedOccurrence.data.recurrenceOccurrenceIndex, 1)
  assert.equal(generatedOccurrence.data.recurrenceSeriesId, 'calendar-series-1')
  assert.equal(generatedOccurrence.data.isGeneratedOccurrence, true)
  assert.equal(generatedOccurrence.data.isRecurring, true)
  assert.equal(generatedOccurrence.data.startsAt, '2026-08-12T09:00:00')
  assert.equal(generatedOccurrence.data.endsAt, '2026-08-12T10:00:00')
  assert.equal(generatedOccurrence.data.seriesStartsAt, '2026-08-05T09:00:00')
  assert.equal(generatedOccurrence.data.seriesEndsAt, '2026-08-05T10:00:00')
})

test('non-recurring calendar events still open as one-off modal items', () => {
  const events = buildFootballCalendarEvents({
    calendarEvents: [
      {
        id: 'calendar-one-off-1',
        clubId: 'club-a',
        teamId: 'team-a',
        eventType: 'training',
        title: 'FP TEST One Off Training',
        startsAt: '2026-08-05T09:00:00',
        endsAt: '2026-08-05T10:00:00',
        recurrenceFrequency: 'none',
        recurrenceUntil: '',
        canEdit: true,
      },
    ],
  })

  assert.equal(events.length, 1)
  assert.equal(events[0].data.recurrenceFrequency, 'none')
  assert.equal(events[0].data.isRecurring, false)
  assert.equal(events[0].data.isGeneratedOccurrence, false)
  assert.equal(events[0].data.startsAt, '2026-08-05T09:00:00')
  assert.equal(events[0].data.seriesStartsAt, '2026-08-05T09:00:00')
})

test('calendar modal saves recurring calendar events through the stored series date', async () => {
  const source = await readFile(sessionsPageUrl, 'utf8')

  assert.match(source, /function getCalendarEventSeriesDateTimeFields/)
  assert.match(source, /event\?\.occurrenceDate \|\| source\.recurrenceOccurrenceDate/)
  assert.match(source, /const baseStartsAt = source\.seriesStartsAt \|\| source\.startsAt/)
  assert.match(source, /const baseEndsAt = source\.seriesEndsAt \|\| source\.endsAt/)
  assert.match(source, /const dayShift = getDayShift\(occurrenceDate, form\?\.date\)/)
  assert.match(source, /const seriesDateTimeFields = getCalendarEventSeriesDateTimeFields\(\{ event: activeEvent, form: calendarForm \}\)/)
  assert.match(source, /startsAt: seriesDateTimeFields\.startsAt/)
  assert.match(source, /endsAt: seriesDateTimeFields\.endsAt/)
})
