import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { test } from 'node:test'

import {
  buildCoachCalendarEvents,
  buildCoachCalendarOccurrenceDates,
  coachCalendarFormFromEvent,
  getCoachCalendarEventResourceIds,
} from '../apps/mobile-core/src/coachCalendarCore.js'
import { buildParentCalendarEvents } from '../apps/mobile-core/src/parentCalendarCore.js'

const coachScreenUrl = new URL('../apps/coach-mobile/src/CoachOperationalScreens.js', import.meta.url)
const coachDataUrl = new URL('../apps/mobile-core/src/coachCalendarData.js', import.meta.url)
const parentAppUrl = new URL('../apps/parent-mobile/App.js', import.meta.url)
const parentScreenUrl = new URL('../apps/parent-mobile/src/ParentPortalScreens.js', import.meta.url)
const parentEndpointUrl = new URL('../netlify/functions/parent-resource-access.js', import.meta.url)

test('Coach Calendar expands a repeat series into separately selectable dated occurrences', () => {
  assert.deepEqual(buildCoachCalendarOccurrenceDates({
    date: '27-08-2026',
    recurrenceFrequency: 'weekly',
    recurrenceUntil: '17-09-2026',
  }), ['2026-08-27', '2026-09-03', '2026-09-10', '2026-09-17'])

  const events = buildCoachCalendarEvents({
    calendarEvents: [{
      id: 'event-1',
      event_type: 'training',
      recurrence_frequency: 'weekly',
      recurrence_until: '2026-09-10',
      starts_at: '2026-08-27T14:00:00.000Z',
      ends_at: '2026-08-27T15:00:00.000Z',
      team_id: 'team-1',
      title: 'Thursday Training',
    }],
  })

  assert.deepEqual(events.map((event) => event.occurrenceDate), ['2026-08-27', '2026-09-03', '2026-09-10'])
  assert.equal(new Set(events.map((event) => event.id)).size, 3)
  assert.equal(events.every((event) => event.sourceId === 'event-1'), true)
})

test('Coach Resource selection is isolated by event and occurrence date', () => {
  const resources = [
    { id: 'week-1', links: [{ linkedType: 'calendar_event', linkedId: 'event-1', calendarOccurrenceDate: '2026-08-27' }] },
    { id: 'week-2', links: [{ linkedType: 'calendar_event', linkedId: 'event-1', calendarOccurrenceDate: '2026-09-03' }] },
  ]

  assert.deepEqual(getCoachCalendarEventResourceIds(resources, 'event-1', '2026-08-27'), ['week-1'])
  assert.deepEqual(getCoachCalendarEventResourceIds(resources, 'event-1', '2026-09-03'), ['week-2'])
})

test('editing a generated occurrence preserves the repeat series start date', () => {
  const form = coachCalendarFormFromEvent({
    calendarDate: '2026-09-03',
    endsAt: '2026-09-03T15:00:00.000Z',
    eventType: 'training',
    occurrenceDate: '2026-09-03',
    seriesEndsAt: '2026-08-27T15:00:00.000Z',
    seriesStartsAt: '2026-08-27T14:00:00.000Z',
    startsAt: '2026-09-03T14:00:00.000Z',
    title: 'Thursday Training',
  }, { teamId: 'team-1' })

  assert.equal(form.date, '27-08-2026')
})

test('Coach edit form restores existing involved Players and uses a collapsed category picker', async () => {
  const [screen, data] = await Promise.all([readFile(coachScreenUrl, 'utf8'), readFile(coachDataUrl, 'utf8')])
  assert.match(data, /getInvolvedPlayerIdsByEventId/)
  assert.match(data, /involvedPlayerIds: involvedPlayerIdsByEventId/)
  assert.match(screen, /Add or change attachments/)
  assert.match(screen, /Choose a category/)
  assert.match(screen, /Select one or more Resources/)
  assert.match(screen, /syncCoachCalendarEventResources\(user, savedEvent, form\?\.resourceIds \|\| \[\], attachmentOccurrenceDate\)/)
})

test('Parent request and Calendar views use occurrence-scoped direct attachment actions', async () => {
  const [app, screen, endpoint] = await Promise.all([
    readFile(parentAppUrl, 'utf8'),
    readFile(parentScreenUrl, 'utf8'),
    readFile(parentEndpointUrl, 'utf8'),
  ])
  assert.match(app, /buildCalendarResourcesByOccurrence/)
  assert.match(app, /calendarOccurrenceDate:/)
  assert.match(screen, /Array\.isArray\(invitation\.resources\)/)
  assert.match(screen, /onOpenResource\?\.\(invitation, eventResource\)/)
  assert.match(endpoint, /calendar_occurrence_date/)
  assert.match(endpoint, /occurrenceDate: normalizeText\(link\.calendar_occurrence_date\)/)
})

test('Parent invitation occurrence keeps only its own attachments', () => {
  const [event] = buildParentCalendarEvents({
    invitations: [{
      eventId: 'event-1',
      eventStart: '2026-09-03T15:00:00+01:00',
      eventTitle: 'Thursday Training',
      invitationId: 'training:week-2',
      invitationType: 'training_attendance',
      occurrenceDate: '2026-09-03',
      resources: [{ id: 'week-2', occurrenceDate: '2026-09-03', title: 'Week two plan' }],
      sourceRecordId: 'request-player-2',
    }],
  })

  assert.deepEqual(event.resources.map((resource) => resource.id), ['week-2'])
  assert.equal(event.occurrenceDate, '2026-09-03')
})
