import test from 'node:test'
import assert from 'node:assert/strict'
import { applyParentEventCancellations, groupParentInvitationsByEvent, normalizeParentInvitation } from '../src/lib/domain/parent-invitations.js'
import { normalizeMatchDay } from '../src/lib/domain/match-day.js'

test('web fixture normalization distinguishes legacy cancellations from a blank new reason', () => {
  assert.equal(normalizeMatchDay({ status: 'cancelled', cancellation_reason: null }).showCancelled, false)
  assert.equal(normalizeMatchDay({ status: 'cancelled', cancellation_reason: '' }).showCancelled, true)
  assert.equal(normalizeMatchDay({ status: 'cancelled', cancellation_reason: 'Rain' }).showCancelled, true)
})

test('authorized calendar and session cancellations disable responses and carry their reasons', () => {
  const rows = [
    { event_id: 'c', source_event_type: 'calendar_event', invitation_state: 'active', is_pending: true, can_respond: true, can_change_response: true },
    { event_id: 's', source_event_type: 'assessment_session', invitation_state: 'active', is_pending: true, can_respond: true },
    { event_id: 'unrelated', source_event_type: 'calendar_event', invitation_state: 'active', is_pending: true },
  ]
  const result = applyParentEventCancellations(rows, [{ id: 'c', cancelled_at: 'now', cancellation_reason: 'Pitch closed' }], [{ id: 's', status: 'cancelled', cancellation_reason: '' }]).map(normalizeParentInvitation)
  assert.equal(result[0].invitationState, 'cancelled')
  assert.equal(result[0].cancellationReason, 'Pitch closed')
  assert.equal(result[0].canRespond, false)
  assert.equal(result[0].isPending, false)
  assert.equal(result[1].invitationState, 'cancelled')
  assert.equal(result[1].cancellationReason, '')
  assert.equal(result[2].invitationState, 'active')
  assert.equal(groupParentInvitationsByEvent([result[0]])[0].cancellationReason, 'Pitch closed')
})

test('legacy deletion and unrelated event types are not interpreted as deliberate cancellation', () => {
  const rows = [{ event_id: 'x', source_event_type: 'assessment_session', invitation_state: 'active' }]
  assert.deepEqual(applyParentEventCancellations(rows, [{ id: 'x', cancelled_at: 'now', cancellation_reason: 'Other event' }], [{ id: 'x', status: 'cancelled', cancellation_reason: null }]), rows)
})
import { excludeDeletedParentOccurrences, expandCancelledParentSeries } from '../src/lib/parent-cancelled-series.js'

test('old cancelled recurring series retains its upcoming occurrences', () => {
  const [first, second] = expandCancelledParentSeries([{ id: 'series', startsAt: '2024-01-01T18:00:00Z', endsAt: '2024-01-01T19:00:00Z', cancelledAt: '2026-11-01T10:00:00Z', recurrenceFrequency: 'weekly', recurrenceUntil: '2026-11-16' }], new Date('2026-11-02T08:00:00Z'))
  assert.equal(first.occurrenceKey, '2026-11-02')
  assert.equal(second.occurrenceKey, '2026-11-09')
  assert.equal(first.id, 'series')
})

test('cancelled recurring series preserves London wall time through both clock changes', () => {
  const spring = expandCancelledParentSeries([{ id: 'spring', startsAt: '2026-03-22T18:00:00Z', endsAt: '2026-03-22T19:00:00Z', cancelledAt: '2026-03-21T10:00:00Z', recurrenceFrequency: 'weekly', recurrenceUntil: '2026-04-05' }], new Date('2026-03-21T00:00:00Z'))
  assert.deepEqual(spring.map(item => item.startsAt), ['2026-03-22T18:00:00.000Z', '2026-03-29T17:00:00.000Z', '2026-04-05T17:00:00.000Z'])
  const autumn = expandCancelledParentSeries([{ id: 'autumn', startsAt: '2026-10-18T17:00:00Z', endsAt: '2026-10-18T18:00:00Z', cancelledAt: '2026-10-17T10:00:00Z', recurrenceFrequency: 'weekly', recurrenceUntil: '2026-11-01' }], new Date('2026-10-17T00:00:00Z'))
  assert.deepEqual(autumn.map(item => item.startsAt), ['2026-10-18T17:00:00.000Z', '2026-10-25T18:00:00.000Z', '2026-11-01T18:00:00.000Z'])
})

test('monthly cancellations follow the established prior-occurrence month advancement', () => {
  const items = expandCancelledParentSeries([{ id: 'monthly', startsAt: '2026-01-31T18:00:00Z', endsAt: '2026-01-31T19:00:00Z', cancelledAt: '2026-01-01T10:00:00Z', recurrenceFrequency: 'monthly', recurrenceUntil: '2026-04-04' }], new Date('2026-01-01T00:00:00Z'))
  assert.deepEqual(items.map(item => item.occurrenceKey), ['2026-01-31', '2026-03-03', '2026-04-03'])
})

test('cancelled series does not restore previously deleted occurrences', () => {
  const event = { id: 'series', startsAt: '2026-11-02T18:00:00Z', endsAt: '2026-11-02T19:00:00Z', cancelledAt: '2026-11-01T10:00:00Z', recurrenceFrequency: 'weekly', recurrenceUntil: '2026-11-16', deleted_occurrence_dates: ['2026-11-09'] }
  const now = new Date('2026-11-02T08:00:00Z')
  assert.deepEqual(expandCancelledParentSeries([event], now).map(item => item.occurrenceKey), ['2026-11-02', '2026-11-16'])
  assert.deepEqual(expandCancelledParentSeries([{ ...event, deletedOccurrenceDates: ['2026-11-02', '2026-11-09', '2026-11-16'] }], now), [])
  const rows = [{ source_event_type: 'calendar_event', event_id: 'series', event_start: '2026-11-09T18:00:00Z' }, { source_event_type: 'calendar_event', event_id: 'series', event_start: '2026-11-16T18:00:00Z' }, { source_event_type: 'match_day', event_id: 'series', event_start: '2026-11-09T18:00:00Z' }]
  assert.deepEqual(excludeDeletedParentOccurrences(rows, [{ id: 'series', cancelled_at: 'now', cancellation_reason: '', deleted_occurrence_dates: ['2026-11-09'] }]), rows.slice(1))
})
import { applyParentInvitationCancellations, buildParentCalendarEvents } from '../apps/mobile-core/src/parentCalendarCore.js'

test('training availability without a calendar invite is cancelled and visible to the parent', () => {
  const rows = [{ invitation_id: 'request-player', invitation_type: 'training_attendance', source_type: 'training_availability', source_event_type: 'calendar_event', event_id: 'training', event_start: '2026-11-04T18:00:00Z', invitation_state: 'active', response_state: 'awaiting_response', is_pending: true, can_respond: true, can_change_response: true }]
  const scopedEvent = { id: 'training', cancelled_at: '2026-11-02T10:00:00Z', cancellation_reason: 'Pitch closed' }
  const web = applyParentEventCancellations(rows, [scopedEvent]).map(normalizeParentInvitation)[0]
  assert.equal(web.invitationState, 'cancelled')
  assert.equal(web.cancellationReason, 'Pitch closed')
  assert.equal(web.isPending, false)
  assert.equal(web.canRespond, false)
  const mobile = applyParentInvitationCancellations(rows, [scopedEvent])[0]
  assert.equal(mobile.show_cancelled, true)
  assert.equal(mobile.can_respond, false)
  const [event] = buildParentCalendarEvents({ invitations: [{ eventId: mobile.event_id, invitationId: mobile.invitation_id, invitationType: mobile.invitation_type, sourceType: mobile.source_type, eventStart: mobile.event_start, eventTitle: 'Training', invitationState: mobile.invitation_state, responseState: mobile.response_state, cancellationReason: mobile.cancellation_reason, showCancelled: mobile.show_cancelled, isPending: mobile.is_pending }] })
  assert.equal(event.status, 'cancelled')
  assert.equal(event.cancellationReason, 'Pitch closed')
  assert.equal(event.requiresResponse, false)
})

test('training cancellation overlay does not alter another source with the same id', () => {
  const rows = [{ source_event_type: 'match_day', event_id: 'shared-id', invitation_state: 'active', can_respond: true }]
  assert.deepEqual(applyParentInvitationCancellations(rows, [{ id: 'shared-id', cancelled_at: 'now', cancellation_reason: '' }]), rows)
})
