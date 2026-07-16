import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'

const migrationUrl = new URL('../supabase/migrations/20260715171154_calendar_event_notify_authoritative_scope.sql', import.meta.url)
const sessionsPageUrl = new URL('../src/pages/SessionsPage.jsx', import.meta.url)
const calendarDomainUrl = new URL('../src/lib/domain/calendar-events.js', import.meta.url)
const deliveryMigrationUrl = new URL('../supabase/migrations/20260716110436_calendar_notify_delivery_hotfix.sql', import.meta.url)
const notificationStatusUrl = new URL('../src/lib/domain/calendar-notification-status.js', import.meta.url)

const [migration, sessionsPage, calendarDomain, deliveryMigration, notificationStatus] = await Promise.all([
  readFile(migrationUrl, 'utf8'),
  readFile(sessionsPageUrl, 'utf8'),
  readFile(calendarDomainUrl, 'utf8'),
  readFile(deliveryMigrationUrl, 'utf8'),
  readFile(notificationStatusUrl, 'utf8'),
])

test('saved Portal scope is committed before the notification command', () => {
  const syncInvitesStart = sessionsPage.indexOf('const syncInvites = async')
  const syncInvitesEnd = sessionsPage.indexOf('\n      if (saveTrainingAsSession', syncInvitesStart)
  const flow = sessionsPage.slice(syncInvitesStart, syncInvitesEnd)
  const scopeIndex = flow.indexOf('await syncCalendarEventParentScope')
  const notifyIndex = flow.indexOf('await notifyCalendarEventParents')

  assert.ok(scopeIndex > 0)
  assert.ok(notifyIndex > scopeIndex)
  assert.match(flow, /nextCalendarInvites = await getCalendarEventInvites\(\{ user \}\)[\s\S]*if \(notifyRequested\)/)
  assert.match(flow, /catch \(notificationError\)[\s\S]*portal_ready_email_command_failed/)
})

test('involved-player scope is validated and saved as informational Portal state', () => {
  assert.match(migration, /audience_value = 'involved_players'[\s\S]*from unnest\(coalesce\(player_ids_value/)
  assert.match(migration, /player\.club_id = club_id_value[\s\S]*player\.team_id = team_id_value/)
  assert.match(migration, /outside this event team or are no longer active/)
  assert.match(migration, /insert into public\.calendar_event_invites/)
  assert.match(migration, /'active', false, 'informational'/)
  assert.match(migration, /responded_at is not null then public\.calendar_event_invites\.invite_status/)
  assert.doesNotMatch(migration, /responded_at\s*=\s*null/i)
})

test('team-wide scope and email recipients are resolved by the server', () => {
  assert.match(migration, /audience_value = 'all_team_parents'[\s\S]*Team-wide parent scope is resolved by the server/)
  assert.match(migration, /from public\.players player[\s\S]*player\.team_id = team_id_value/)
  assert.match(calendarDomain, /sync_calendar_event_parent_scope_v2'[\s\S]*player_ids_value: normalizedSelectionMode === 'whole_squad' \? \[\] : normalizedPlayerIds/)
  assert.match(deliveryMigration, /normalized_selection_mode = 'whole_squad'[\s\S]*Whole squad player scope is resolved by the server/)
  assert.match(sessionsPage, /playerIds: sharedInvolvedPlayers \? notificationPlayers\.map\(\(player\) => player\.id\) : \[\]/)
})

test('the public notification command rejects browser player and recipient injection', () => {
  assert.match(migration, /if coalesce\(array_length\(player_ids_value, 1\), 0\) > 0 then[\s\S]*Notification recipients are resolved from saved server-side event scope/)
  assert.match(migration, /notify_calendar_event_parents_authoritative_scope_internal\([\s\S]*'\{\}'::uuid\[\]/)
  assert.match(calendarDomain, /notify_calendar_event_parents'[\s\S]*player_ids_value: \[\]/)
})

test('staff authority and hidden helper grants remain fail closed', () => {
  assert.match(migration, /coalesce\(actor\.status, 'active'\) <> 'active'/)
  assert.match(migration, /coalesce\(actor\.role_rank, 0\) < 20/)
  assert.match(migration, /from public\.team_staff staff[\s\S]*staff\.team_id = team_id_value[\s\S]*staff\.user_id = actor\.id/)
  assert.match(migration, /security definer[\s\S]*set search_path = ''/)
  assert.match(migration, /revoke all on function public\.notify_calendar_event_parents_authoritative_scope_internal[\s\S]*from public, anon, authenticated/)
  assert.match(migration, /grant execute on function public\.sync_calendar_event_parent_scope[\s\S]*to authenticated, service_role/)
})

test('same-row updates preserve response evidence and avoid duplicate Portal records', () => {
  assert.match(migration, /on conflict \(club_id, player_id, calendar_event_id, assessment_session_id, match_day_id\) do update/)
  assert.match(migration, /response_requirement = 'informational'/)
  assert.match(migration, /cancelled_at = null/)
  assert.match(migration, /portal_updated_count := least\(existing_portal_count, selected_player_count\)/)
  assert.match(migration, /portal_created_count := greatest\(selected_player_count - existing_portal_count, 0\)/)
})

test('UI distinguishes Portal success from email command and queue failures', () => {
  assert.match(sessionsPage, /getCalendarNotificationToast\(calendarNotificationResult/)
  assert.match(notificationStatus, /parent emails could not be sent\. Please try again/)
  assert.match(notificationStatus, /parent email[\s\S]*being delivered/)
  assert.match(notificationStatus, /parent email[\s\S]*sent/)
  assert.match(notificationStatus, /no eligible parent email addresses were available/)
  assert.match(sessionsPage, /Event saved, parent notification incomplete/)
  assert.match(sessionsPage, /Calendar not saved/)
})

test('notification remains opt-in and one request token survives through save', () => {
  assert.match(sessionsPage, /notifyInvitedFamilies: false/)
  assert.match(sessionsPage, /current\.notificationRequestToken \|\| createNotificationRequestToken\(\)/)
  assert.match(sessionsPage, /requestToken: calendarForm\.notificationRequestToken/)
  assert.match(sessionsPage, /disabled=\{isBusy\}/)
})
