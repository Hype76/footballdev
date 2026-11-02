import test from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { normalizeCoachCalendarEvent, getCoachCalendarMutationPolicy } from '../apps/mobile-core/src/coachCalendarCore.js'

test('coach calendar preserves cancellation reason and disallows editing cancelled events', () => {
  const event = normalizeCoachCalendarEvent({ id: '1', cancelled_at: '2026-11-02T10:00:00Z', cancellation_reason: '  Rain  ' })
  assert.equal(event.cancellationReason, 'Rain')
  assert.equal(event.status, 'cancelled')
  assert.equal(getCoachCalendarMutationPolicy({ context: { roleRank: 30, paymentAccess: { canMutate: true } }, event }).canEdit, false)
})

test('parent cancellation reads are explicitly linked and return only parent-facing fields', async () => {
  const sql = await readFile(new URL('../supabase/migrations/20261102083200_event_cancellation_reasons.sql', import.meta.url), 'utf8')
  assert.match(sql, /link\.id = parent_link_id_value and link\.auth_user_id = auth\.uid\(\)/)
  assert.match(sql, /link\.status = 'active'[\s\S]*invite\.invite_status <> 'cancelled'/)
  assert.match(sql, /event\.parent_visible is true and event\.parent_audience = 'involved_players'/)
  assert.match(sql, /event\.cancelled_at is null or event\.cancellation_reason is not null/)
  assert.doesNotMatch(sql, /create policy/i)
})

test('training cancellation closes queued requests before updating the event and reports partial failures', async () => {
  const data = await readFile(new URL('../apps/mobile-core/src/coachCalendarData.js', import.meta.url), 'utf8')
  const cancel = data.split('export async function cancelCoachCalendarEvent')[1].split('export async function deleteCoachCalendarEvent')[0]
  assert.ok(cancel.indexOf("from('training_availability_requests')") < cancel.indexOf("from('calendar_events')"))
  assert.match(cancel, /\.in\('status', \['pending', 'queued'\]\)/)
  assert.match(cancel, /Availability requests were closed, but the event could not be cancelled/)
  assert.match(cancel, /cancellation_reason: normalize\(reason\)/)
})
