import test from 'node:test'
import assert from 'node:assert/strict'
import { buildParentCalendarEvents } from '../apps/mobile-core/src/parentCalendarCore.js'
import { normalizeAssessmentSessionRow } from '../src/lib/domain/session-normalizers.js'

test('cancelled parent calendar events retain their optional reason', () => {
  const events = buildParentCalendarEvents({ calendarEvents: [{ id: 'event', title: 'Training', startsAt: '2026-11-03T18:00:00Z', status: 'cancelled', showCancelled: true, cancelledAt: '2026-11-02T10:00:00Z', cancellationReason: 'Pitch closed' }] })
  assert.equal(events.length, 1)
  assert.equal(events[0].status, 'cancelled')
  assert.equal(events[0].cancellationReason, 'Pitch closed')
})

test('session cancellation reason is normalized', () => {
  assert.equal(normalizeAssessmentSessionRow({ id: 's', cancellation_reason: '  Weather  ' }).cancellationReason, 'Weather')
  assert.equal(normalizeAssessmentSessionRow({ id: 's' }).cancellationReason, '')
})

test('cancelled fixtures stay visible to parents without an actionable response', () => {
  const events = buildParentCalendarEvents({ matches: [{ id: 'm', teamName: 'Team', opponent: 'Visitors', matchDate: '2026-11-03', status: 'cancelled', cancellationReason: 'Pitch closed' }], invitations: [{ eventId: 'm', invitationType: 'match_attendance', isPending: true }] })
  assert.equal(events.length, 1)
  assert.equal(events[0].cancellationReason, 'Pitch closed')
  assert.equal(events[0].requiresResponse, false)
})
