import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'

import {
  buildMatchDayPlayerInviteStatusMap,
  getMatchDayPlayerInviteStatus,
} from '../src/lib/domain/calendar-actionable-invites.js'
import { getCalendarNotificationToast } from '../src/lib/domain/calendar-notification-status.js'

const migrationUrl = new URL('../supabase/migrations/20260717081923_calendar_actionable_invites_hotfix.sql', import.meta.url)
const sessionsPageUrl = new URL('../src/pages/SessionsPage.jsx', import.meta.url)
const calendarDomainUrl = new URL('../src/lib/domain/calendar-events.js', import.meta.url)
const parentSummaryUrl = new URL('../supabase/migrations/20260713150000_parent_portal_calendar_invite_integrity.sql', import.meta.url)
const processorUrl = new URL('../netlify/functions/process-scheduled-emails.js', import.meta.url)

const [migration, sessionsPage, calendarDomain, parentSummary, processor] = await Promise.all([
  readFile(migrationUrl, 'utf8'),
  readFile(sessionsPageUrl, 'utf8'),
  readFile(calendarDomainUrl, 'utf8'),
  readFile(parentSummaryUrl, 'utf8'),
  readFile(processorUrl, 'utf8'),
])

test('Match Day Calendar notification reconciles actions before email preparation', () => {
  const wrapperStart = migration.indexOf('create or replace function public.notify_calendar_event_parents')
  const wrapper = migration.slice(wrapperStart)
  const internalIndex = wrapper.indexOf('notify_calendar_event_parents_authoritative_scope_internal')
  const reconcileIndex = wrapper.indexOf('reconcile_match_day_calendar_actions_internal')
  const emailIndex = wrapper.indexOf('prepare_match_day_calendar_action_email_internal')

  assert.ok(internalIndex > 0)
  assert.ok(reconcileIndex > internalIndex)
  assert.ok(emailIndex > reconcileIndex)
  assert.match(wrapper, /if match_day_id_value is null then[\s\S]*return result_value/)
})

test('actionable requests reuse the existing Match Day model and preserve answers', () => {
  assert.match(migration, /insert into public\.match_day_availability_requests/)
  assert.match(migration, /on conflict \(match_day_id, player_id, recipient_email, recipient_type, channel\)/)
  assert.match(migration, /public\.match_day_availability_requests\.status = 'pending'/)
  assert.doesNotMatch(migration, /set status = 'pending'[\s\S]*on conflict/i)
  assert.doesNotMatch(migration, /create table/i)
  assert.doesNotMatch(migration, /delete from public\.match_day_availability_requests/i)
})

test('removed scope only expires unanswered requests and accepted roles remain authoritative', () => {
  assert.match(migration, /set status = 'expired'[\s\S]*request\.status = 'pending'/)
  assert.match(migration, /from public\.match_day_role_assignments assignment/)
  assert.match(migration, /acceptedVolunteerAssignmentCount/)
  assert.doesNotMatch(migration, /delete from public\.match_day_role_assignments/i)
  assert.doesNotMatch(migration, /volunteer_(scorer|linesman|referee)_response\s*=\s*'no_response'/i)
})

test('volunteer actions use configured fixture roles and suppress filled roles', () => {
  assert.match(migration, /fixture\.request_scorer/)
  assert.match(migration, /fixture\.request_linesman/)
  assert.match(migration, /fixture\.request_referee/)
  assert.match(migration, /open_role_count := greatest\(configured_role_count - accepted_assignment_count, 0\)/)
  assert.match(migration, /not exists \([\s\S]*match_day_role_assignments/)
})

test('Parent Portal summary remains the single Pending classification engine', () => {
  assert.match(parentSummary, /match_attendance_items/)
  assert.match(parentSummary, /match_role_items/)
  assert.match(parentSummary, /current_availability_status/)
  assert.match(parentSummary, /awaiting_response/)
  assert.match(parentSummary, /calendar_event_invites/)
  assert.doesNotMatch(sessionsPage, /setPendingInviteCount|calculatePendingInviteCount/)
})

test('action email contains required fixture context and specific Portal CTA', () => {
  for (const label of ['Child:', 'Team:', 'Opponent:', 'Date:', 'Kickoff:', 'Meet time:', 'Venue:', 'Response:']) {
    assert.match(migration, new RegExp(label))
  }
  assert.match(migration, /Action required/)
  assert.match(migration, /Volunteer opportunities/)
  assert.match(migration, /section=invites&eventId=/)
  assert.match(migration, />View and respond</)
  assert.doesNotMatch(migration, /section=calendar&eventId=/)
})

test('the browser supplies no player, guardian, recipient, role or response state', () => {
  assert.match(calendarDomain, /notify_calendar_event_parents'[\s\S]*player_ids_value: \[\]/)
  assert.match(migration, /Notification recipients are resolved from saved server-side event scope/)
  assert.doesNotMatch(calendarDomain, /recipient_ids_value|parent_ids_value|volunteer_roles_value|response_state_value/)
})

test('private helpers and public wrapper use controlled authority boundaries', () => {
  assert.match(migration, /security definer\s+set search_path = ''/)
  assert.match(migration, /revoke all on function public\.reconcile_match_day_calendar_actions_internal\(uuid\) from public, anon, authenticated/)
  assert.match(migration, /revoke all on function public\.prepare_match_day_calendar_action_email_internal\(uuid\) from public, anon, authenticated/)
  assert.match(migration, /coalesce\(actor\.status, 'active'\) <> 'active'/)
  assert.match(migration, /from public\.team_staff staff/)
  assert.match(migration, /player\.club_id = fixture\.club_id/)
  assert.match(migration, /player\.team_id = fixture\.team_id/)
})

test('command delivery preserves action reconciliation fields and immediate processing', () => {
  assert.match(processor, /\.\.\.\(command\.result \|\| \{\}\)/)
  assert.match(processor, /finalState/)
  assert.match(calendarDomain, /await processCalendarNotificationDelivery/)
  assert.match(calendarDomain, /actionReconciliationState/)
  assert.match(sessionsPage, /refreshedMatchDaysAfterNotification = await getMatchDays/)
})

test('staff status comes from authoritative request or response rows', () => {
  const matchDay = {
    status: 'scheduled',
    availabilityRequests: [
      { playerId: 'pending', status: 'pending' },
      { playerId: 'available', status: 'available' },
      { playerId: 'maybe', status: 'maybe' },
      { playerId: 'unavailable', status: 'unavailable' },
      { playerId: 'closed', status: 'expired' },
    ],
  }

  assert.equal(getMatchDayPlayerInviteStatus({ matchDay, playerId: 'selected', selected: true }), 'selected')
  assert.equal(getMatchDayPlayerInviteStatus({ matchDay, playerId: 'pending', selected: true }), 'pending')
  assert.equal(getMatchDayPlayerInviteStatus({ matchDay, playerId: 'available', selected: true }), 'available')
  assert.equal(getMatchDayPlayerInviteStatus({ matchDay, playerId: 'maybe', selected: true }), 'maybe')
  assert.equal(getMatchDayPlayerInviteStatus({ matchDay, playerId: 'unavailable', selected: true }), 'unavailable')
  assert.equal(getMatchDayPlayerInviteStatus({ matchDay, playerId: 'closed', selected: true }), 'closed')
  assert.equal(getMatchDayPlayerInviteStatus({ matchDay, playerId: 'none', selected: false }), 'not_invited')

  const labels = buildMatchDayPlayerInviteStatusMap({ matchDay, selectedPlayerIds: ['selected', 'pending'] })
  assert.equal(labels.selected, 'Selected for invitation')
  assert.equal(labels.pending, 'Invitation pending, no response')
})

test('truthful staff wording covers full, no-role, email failure and reconciliation failure results', () => {
  const base = {
    responseRequirement: 'response_required',
    eventActionType: 'match_day_action_required',
    actionReconciliationState: 'ready',
    playerRequestCreatedCount: 16,
    eligibleRecipientCount: 5,
  }
  const success = getCalendarNotificationToast({
    ...base,
    volunteerRequestCreatedCount: 2,
    deliveredCount: 5,
  }, { entity: 'Fixture', action: 'updated' })
  assert.match(success.message, /16 player invitations and 2 volunteer requests/)
  assert.match(success.message, /5 parent emails sent/)

  const noRoles = getCalendarNotificationToast({ ...base, deliveredCount: 5 })
  assert.doesNotMatch(noRoles.message, /volunteer request/)

  const emailFailed = getCalendarNotificationToast({ ...base, failedCount: 5 })
  assert.match(emailFailed.message, /player invitations available in the Parent Portal, but the email notifications could not be sent/)

  const actionFailed = getCalendarNotificationToast({
    ...base,
    actionReconciliationState: 'failed',
    playerRequestCreatedCount: 0,
  })
  assert.match(actionFailed.message, /Families were not reported as invited/)
})
