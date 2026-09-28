import assert from 'node:assert/strict'
import { test } from 'node:test'
import { buildAcceptedParentCalendarEvents, getParentCalendarEventFingerprint } from '../apps/parent-mobile/src/parentDeviceCalendarCore.js'

test('phone calendar includes accepted events once and excludes other responses', () => {
  const start = '2026-10-05T19:00:00.000Z'
  const items = [
    { sourceType: 'calendar_event', sourceId: 'training-1', title: 'Monday training', startsAt: start, responseState: 'available' },
    { sourceType: 'calendar_event', sourceId: 'training-1', title: 'Monday training', startsAt: start, responseState: 'available' },
    { sourceType: 'match_day', sourceId: 'match-1', title: 'Match', startsAt: '2026-10-06T12:00:00.000Z', responseState: 'accepted' },
    { sourceType: 'calendar_event', sourceId: 'maybe-1', startsAt: start, responseState: 'maybe' },
    { sourceType: 'calendar_event', sourceId: 'declined-1', startsAt: start, responseState: 'declined' },
    { sourceType: 'calendar_event', sourceId: 'unanswered-1', startsAt: start, responseState: 'awaiting_response' },
    { sourceType: 'calendar_event', sourceId: 'cancelled-1', startsAt: start, responseState: 'yes', status: 'cancelled' },
  ]
  const events = buildAcceptedParentCalendarEvents(items, new Date('2026-10-01T00:00:00.000Z'))
  assert.equal(events.length, 2)
  assert.equal(events[0].title, 'Monday training')
  assert.equal(events[0].endDate.toISOString(), '2026-10-05T21:00:00.000Z')
  assert.equal(events[1].title, 'Match')
})

test('phone calendar detects a changed time or location for an accepted event', () => {
  const [original] = buildAcceptedParentCalendarEvents([
    { sourceType: 'calendar_event', sourceId: 'training-1', title: 'Monday training', startsAt: '2026-10-05T19:00:00.000Z', endsAt: '2026-10-05T20:30:00.000Z', location: 'Pitch 1', responseState: 'attending' },
  ], new Date('2026-10-01T00:00:00.000Z'))
  const [changed] = buildAcceptedParentCalendarEvents([
    { sourceType: 'calendar_event', sourceId: 'training-1', title: 'Monday training', startsAt: '2026-10-05T19:00:00.000Z', endsAt: '2026-10-05T20:30:00.000Z', location: 'Pitch 3', responseState: 'attending' },
  ], new Date('2026-10-01T00:00:00.000Z'))
  assert.equal(original.key, changed.key)
  assert.notEqual(getParentCalendarEventFingerprint(original), getParentCalendarEventFingerprint(changed))
})
