import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'

const migrationUrl = new URL('../supabase/migrations/20260715131232_calendar_event_notify_command_hotfix.sql', import.meta.url)
const authoritativeScopeMigrationUrl = new URL('../supabase/migrations/20260715171154_calendar_event_notify_authoritative_scope.sql', import.meta.url)
const sessionsPageUrl = new URL('../src/pages/SessionsPage.jsx', import.meta.url)
const calendarDomainUrl = new URL('../src/lib/domain/calendar-events.js', import.meta.url)
const inviteDomainUrl = new URL('../src/lib/domain/calendar-event-invites.js', import.meta.url)
const matchDayDomainUrl = new URL('../src/lib/domain/match-day.js', import.meta.url)

const [migration, authoritativeScopeMigration, sessionsPage, calendarDomain, inviteDomain, matchDayDomain] = await Promise.all([
  readFile(migrationUrl, 'utf8'),
  readFile(authoritativeScopeMigrationUrl, 'utf8'),
  readFile(sessionsPageUrl, 'utf8'),
  readFile(calendarDomainUrl, 'utf8'),
  readFile(inviteDomainUrl, 'utf8'),
  readFile(matchDayDomainUrl, 'utf8'),
])

test('reproduces the released Match Day edit omission before proving the repaired branch', () => {
  const matchBranch = sessionsPage.slice(
    sessionsPage.indexOf("} else if (sourceType === 'match-day')"),
    sessionsPage.indexOf("} else {", sessionsPage.indexOf("} else if (sourceType === 'match-day')") + 1),
  )

  assert.match(matchBranch, /getCalendarParentVisibility\(\{ form: calendarForm, safeTeamId, user \}\)/)
  assert.match(matchBranch, /await updateMatchDay/)
  assert.match(matchBranch, /await syncInvites\(\{ matchDayId: savedMatch\.id/)
  assert.ok(matchBranch.indexOf('await updateMatchDay') < matchBranch.indexOf('await syncInvites'))
})

test('Match Day invite synchronization imports the display helper used after save', () => {
  assert.match(sessionsPage, /import \{ getMatchDayDisplayName \} from '\.\.\/lib\/matchday-display\.js'/)
  assert.match(sessionsPage, /await syncInvites\(\{ matchDayId: savedMatch\.id, sourceTitle: getMatchDayDisplayName\(savedMatch\) \}\)/)
})

test('edit form restores Match Day parent scope and retains one retry token until save', () => {
  assert.match(sessionsPage, /sourceType === 'match-day'[\s\S]*source\.parentAudience[\s\S]*source\.parentVisible/)
  assert.match(sessionsPage, /name === 'notifyInvitedFamilies'[\s\S]*current\.notificationRequestToken \|\| createNotificationRequestToken\(\)/)
  assert.match(sessionsPage, /requestToken: calendarForm\.notificationRequestToken/)
})

test('client calls the exact five-argument RPC for Calendar or Match Day', () => {
  assert.match(calendarDomain, /calendar_event_id_value: normalizedEventSource === 'calendar' \? normalizedEventId : null/)
  assert.match(calendarDomain, /match_day_id_value: normalizedEventSource === 'match-day' \? normalizedEventId : null/)
  assert.match(calendarDomain, /notification_request_token_value: normalizedRequestToken/)
  assert.match(calendarDomain, /supabase\.rpc\('sync_calendar_event_parent_scope_v2'[\s\S]*player_ids_value: normalizedSelectionMode === 'whole_squad' \? \[\] : normalizedPlayerIds/)
  assert.match(calendarDomain, /supabase\.rpc\('notify_calendar_event_parents'[\s\S]*player_ids_value: \[\]/)
  assert.match(calendarDomain, /notificationCommandId/)
})

test('database generates a durable command identity and uses the browser token only for retry correlation', () => {
  assert.match(migration, /calendar_event_notification_commands[\s\S]*id uuid primary key default gen_random_uuid\(\)/i)
  assert.match(migration, /notification_request_token_value uuid/i)
  assert.match(migration, /insert into public\.calendar_event_notification_commands/i)
  assert.match(migration, /notification_command_id, lower\(recipient_email\)/i)
  assert.match(migration, /calendar-notify-command:', command_record\.id/i)
  assert.match(migration, /if command_record\.result is not null[\s\S]*return command_record\.result/i)
})

test('unchanged event commands are independent of material revisions', () => {
  assert.match(migration, /event_revision bigint not null/i)
  assert.match(migration, /request_token uuid not null/i)
  assert.match(migration, /notificationCommandId', command_record\.id/i)
  assert.doesNotMatch(migration, /on conflict \(calendar_event_id, event_revision, notification_type, lower\(recipient_email\)\)/i)
})

test('Match Day revisions cover Calendar-visible details without tracking scores or timer noise', () => {
  const triggerStart = migration.indexOf('create or replace function public.set_match_day_notification_revision')
  const triggerEnd = migration.indexOf('drop trigger if exists match_days_set_notification_revision')
  const trigger = migration.slice(triggerStart, triggerEnd)

  assert.match(trigger, /new\.opponent/)
  assert.match(trigger, /new\.match_date/)
  assert.match(trigger, /new\.venue_name/)
  assert.match(trigger, /new\.notes/)
  assert.match(trigger, /new\.parent_visible/)
  assert.doesNotMatch(trigger, /new\.home_score/)
  assert.doesNotMatch(trigger, /new\.timer_/)
  assert.match(matchDayDomain, /notificationRevision/)
})

test('Portal scope is durable, informational, and independent of email eligibility', () => {
  const portalInsert = migration.indexOf('insert into public.calendar_event_invites')
  const emailLoop = migration.indexOf('for recipient in')

  assert.ok(portalInsert > 0)
  assert.ok(emailLoop > portalInsert)
  assert.match(migration, /match_day_id uuid references public\.match_days/)
  assert.match(migration, /response_requirement = 'informational'/)
  assert.match(migration, /link\.status = 'active'/)
  assert.doesNotMatch(migration.slice(emailLoop, migration.indexOf('end loop;', emailLoop)), /auth_user_id is not null/)
  assert.match(inviteDomain, /matchDayId: row\.match_day_id/)
})

test('Parent Calendar reads informational involved-player Match Day scope without availability rows', () => {
  const parentQuery = migration.slice(migration.indexOf('create function public.get_parent_portal_match_days'))

  assert.match(parentQuery, /join public\.calendar_event_invites invite/)
  assert.match(parentQuery, /invite\.player_id = link\.player_id/)
  assert.match(parentQuery, /invite\.response_requirement = 'informational'/)
  assert.match(parentQuery, /fixture\.parent_audience = 'involved_players'/)
  assert.doesNotMatch(parentQuery, /insert into public\.match_day_availability_requests/)
})

test('queue failures are isolated after Portal upsert and produce structured partial success', () => {
  assert.match(migration, /begin[\s\S]*insert into public\.scheduled_email_queue[\s\S]*exception when others then/i)
  assert.match(migration, /portal_ready_email_partial/)
  assert.match(migration, /portal_ready_no_eligible_email/)
  assert.match(migration, /no_parent_scope/)
  assert.match(migration, /portalCreatedCount/)
  assert.match(migration, /eligibleRecipientCount/)
  assert.match(migration, /failedCount/)
})

test('authority, scope, grants, and hidden ledgers remain fail closed', () => {
  assert.match(migration, /actor\.role in \('parent_portal', 'super_admin'\)/)
  assert.match(migration, /coalesce\(actor\.status, 'active'\) <> 'active'/)
  assert.match(migration, /from public\.team_staff staff/)
  assert.match(migration, /outside this event team or are no longer active/)
  assert.match(migration, /revoke all privileges on table public\.calendar_event_notification_commands from public, anon, authenticated/)
  assert.match(migration, /revoke execute on function public\.notify_calendar_event_parents\(uuid, text, uuid, uuid, uuid\[\]\) from anon/)
  assert.match(migration, /grant execute on function public\.notify_calendar_event_parents\(uuid, text, uuid, uuid, uuid\[\]\) to authenticated, service_role/)
  assert.match(authoritativeScopeMigration, /Notification recipients are resolved from saved server-side event scope/)
  assert.match(authoritativeScopeMigration, /revoke all on function public\.notify_calendar_event_parents_authoritative_scope_internal[\s\S]*from public, anon, authenticated/)
})
