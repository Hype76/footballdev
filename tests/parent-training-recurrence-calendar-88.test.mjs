import assert from 'node:assert/strict'
import { test } from 'node:test'

import {
  buildParentCalendarEvents,
  getParentCalendarMarkerTone,
  getParentCalendarMonthGrid,
  isParentCalendarActionRequired,
} from '../apps/mobile-core/src/parentCalendarCore.js'

function closedTrainingInvitation(responseState = 'available') {
  return {
    eventEnd: '2026-08-24T10:30:00+01:00',
    eventId: 'event-training',
    eventStart: '2026-08-24T10:00:00+01:00',
    eventTitle: 'Monday Training',
    invitationId: 'training_attendance:request-player-past',
    invitationState: 'closed',
    invitationType: 'training_attendance',
    isPending: false,
    responseState,
    sourceRecordId: 'request-player-past',
    sourceType: 'training_availability',
    teamName: 'U17 Green',
  }
}

test('closed recurring Training remains visible on its original Calendar date', () => {
  const [event] = buildParentCalendarEvents({ invitations: [closedTrainingInvitation()] })

  assert.equal(event.calendarDate, '2026-08-24')
  assert.equal(event.status, 'closed')
  assert.equal(getParentCalendarMarkerTone(event), 'training')
  assert.equal(isParentCalendarActionRequired(event), false)

  const day = getParentCalendarMonthGrid(
    [event],
    new Date('2026-08-01T12:00:00Z'),
    new Date('2026-08-24T11:00:00Z'),
  ).find((item) => item.date === '2026-08-24')

  assert.equal(day.events.length, 1)
  assert.equal(day.events[0].title, 'Monday Training')
})

test('a closed unanswered Training request is history, not a live response marker', () => {
  const [event] = buildParentCalendarEvents({
    invitations: [closedTrainingInvitation('awaiting_response')],
  })

  assert.equal(isParentCalendarActionRequired(event), false)
  assert.equal(getParentCalendarMarkerTone(event), 'training')
})

test('fixture markers require a pending invitation when a match carries an unanswered availability default', () => {
  const match = { id: 'fixture', matchDate: '2026-12-05', availabilityStatus: 'no_response', status: 'scheduled' }
  const invite = { eventId: match.id, invitationType: 'match_attendance', adultPlayerLinkId: 'player-link',
    invitationId: 'match:invite', invitationState: 'active', responseState: 'awaiting_response', isPending: true, canRespond: true }
  for (const [invitations, marker] of [[[], 'match'], [[{ ...invite, isPending: false, canRespond: false }], 'match'], [[invite], 'response']]) {
    const [event] = buildParentCalendarEvents({ matches: [match], invitations })
    assert.equal(getParentCalendarMarkerTone(event), marker)
  }
})
