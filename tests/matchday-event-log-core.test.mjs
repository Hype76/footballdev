import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { test } from 'node:test'

import { normalizeMatchDay } from '../src/lib/domain/match-day.js'

const migrationUrl = new URL('../supabase/migrations/20260704084216_match_day_event_log_core.sql', import.meta.url)
const domainUrl = new URL('../src/lib/domain/match-day.js', import.meta.url)
const staffPageUrl = new URL('../src/pages/MatchDayPage.jsx', import.meta.url)
const selectVolunteerFunctionUrl = new URL('../netlify/functions/select-match-day-volunteer.js', import.meta.url)
const availabilityConfirmFunctionUrl = new URL('../netlify/functions/match-day-availability-confirm.js', import.meta.url)
const sendAvailabilityFunctionUrl = new URL('../netlify/functions/send-match-day-availability-requests.js', import.meta.url)
const parentPortalPageUrl = new URL('../src/pages/ParentPortalPage.jsx', import.meta.url)

test('match day event log migration creates a staff scoped RLS table', async () => {
  const migration = await readFile(migrationUrl, 'utf8')

  assert.match(migration, /create table if not exists public\.match_day_event_log/i)
  assert.match(migration, /match_day_id uuid not null references public\.match_days/i)
  assert.match(migration, /player_id uuid references public\.players/i)
  assert.match(migration, /actor_user_id uuid references auth\.users/i)
  assert.match(migration, /previous_value jsonb/i)
  assert.match(migration, /new_value jsonb/i)
  assert.match(migration, /metadata jsonb not null default '\{\}'::jsonb/i)
  assert.match(migration, /event_type in \([\s\S]*'match_day_created'[\s\S]*'player_selected'[\s\S]*'player_availability_changed'[\s\S]*'match_role_assigned'[\s\S]*'scorer_updated'[\s\S]*'linesman_updated'[\s\S]*'invite_queued'[\s\S]*'note_updated'/i)
  assert.match(migration, /alter table public\.match_day_event_log enable row level security;/i)
  assert.match(migration, /alter table public\.match_day_event_log force row level security;/i)
  assert.match(migration, /revoke all on public\.match_day_event_log from anon;/i)
  assert.match(migration, /revoke all on public\.match_day_event_log from authenticated;/i)
  assert.match(migration, /grant select, insert on public\.match_day_event_log to authenticated;/i)
  assert.match(migration, /create policy match_day_event_log_staff_select_scoped[\s\S]*public\.can_read_match_day\(team_id\)/i)
  assert.match(migration, /create policy match_day_event_log_staff_insert_scoped[\s\S]*public\.can_manage_match_day\(team_id\)/i)
  assert.doesNotMatch(migration, /grant\s+select[\s\S]+to anon/i)
})

test('match day event log migration indexes timeline and player lookups', async () => {
  const migration = await readFile(migrationUrl, 'utf8')

  assert.match(migration, /match_day_event_log_match_created_idx[\s\S]*match_day_id, created_at desc/i)
  assert.match(migration, /match_day_event_log_team_created_idx[\s\S]*club_id, team_id, created_at desc/i)
  assert.match(migration, /match_day_event_log_player_created_idx[\s\S]*where player_id is not null/i)
})

test('domain read model includes event log entries in Match Day payloads', async () => {
  const source = await readFile(domainUrl, 'utf8')

  assert.match(source, /function normalizeMatchDayEventLogEntry/)
  assert.match(source, /match_day_event_log \(\*, players:player_id \(player_name\)\)/)
  assert.match(source, /eventLog,/)

  const match = normalizeMatchDay({
    id: 'match-1',
    club_id: 'club-1',
    team_id: 'team-1',
    opponent: 'Riverside',
    match_day_event_log: [
      {
        id: 'log-1',
        match_day_id: 'match-1',
        event_type: 'match_day_created',
        event_label: 'Fixture created',
        actor_display_name: 'Coach One',
        players: { player_name: 'Ava Green' },
      },
    ],
  })

  assert.equal(match.eventLog.length, 1)
  assert.equal(match.eventLog[0].eventType, 'match_day_created')
  assert.equal(match.eventLog[0].eventLabel, 'Fixture created')
  assert.equal(match.eventLog[0].playerName, 'Ava Green')
})

test('domain writes event log entries after successful core Match Day actions only', async () => {
  const source = await readFile(domainUrl, 'utf8')

  assert.match(source, /export async function createMatchDayEventLogEntry/)
  assert.match(source, /\.from\('match_day_event_log'\)[\s\S]*\.insert\(/)
  assert.match(source, /console\.warn\('Match Day event log write failed'/)
  assert.match(source, /action: 'match_day_created'[\s\S]*await createMatchDayEventLogEntry\(\{[\s\S]*eventType: 'match_day_created'/)
  assert.match(source, /export async function updateMatchDay[\s\S]*const previousSnapshot = await getMatchDayEventLogSnapshot/)
  assert.match(source, /eventType === 'note_updated' \? 'Note updated' : 'Fixture updated'/)
  assert.match(source, /export async function addStaffMatchDayGoal[\s\S]*eventType: 'scorer_updated'/)
  assert.match(source, /return normalizeMatchDayEvent\(data\)/)
})

test('staff Match Day page renders a staff-only event log panel and empty state', async () => {
  const source = await readFile(staffPageUrl, 'utf8')

  assert.match(source, /const eventLog = Array\.isArray\(match\.eventLog\) \? match\.eventLog : \[\]/)
  assert.match(source, /<MatchDayEventLogPanel entries=\{eventLog\} \/>/)
  assert.match(source, /function MatchDayEventLogPanel/)
  assert.match(source, /No event log entries yet\./)
  assert.match(source, /New Match Day changes will appear here\./)
  assert.match(source, /getEventLogActorLabel/)
  assert.match(source, /getEventLogDetail/)
})

test('staff Match Day page renders a readiness panel from existing fixture data only', async () => {
  const source = await readFile(staffPageUrl, 'utf8')
  const panelStart = source.indexOf('function MatchDayReadinessPanel')
  const panelEnd = source.indexOf('function MatchDayEventLogPanel', panelStart)
  const readinessStart = source.indexOf('function getAvailabilityRequestStateLabel')
  const readinessEnd = source.indexOf('function getNeedsAttentionItems', readinessStart)

  assert.notEqual(panelStart, -1)
  assert.notEqual(panelEnd, -1)
  assert.notEqual(readinessStart, -1)
  assert.notEqual(readinessEnd, -1)

  const panelSource = source.slice(panelStart, panelEnd)
  const readinessSource = source.slice(readinessStart, readinessEnd)

  assert.match(source, /<MatchDayReadinessPanel match=\{match\} \/>/)
  assert.match(source, /function getMatchDaySetupReadiness/)
  assert.match(source, /function getMatchDayVisibilityReadiness/)
  assert.match(source, /function getMatchDayAvailabilityReadiness/)
  assert.match(source, /function getMatchDayRoleReadiness/)
  assert.match(source, /function getMatchDayLatestSignalReadiness/)
  assert.match(panelSource, /Match readiness/)
  assert.match(readinessSource, /Fixture details present/)
  assert.match(readinessSource, /Visible to parents/)
  assert.match(readinessSource, /Not visible to parents/)
  assert.match(readinessSource, /No availability request queued/)
  assert.match(readinessSource, /No responses yet/)
  assert.match(readinessSource, /No event log entries yet/)
  assert.match(readinessSource, /getEventLogTypeLabel\(latestEntry\)/)
  assert.match(readinessSource, /getRoleStatus\(match, role\.key\)/)
  assert.doesNotMatch(panelSource, /fetch\(/)
  assert.doesNotMatch(readinessSource, /fetch\(/)
  assert.doesNotMatch(panelSource, /createMatchDayEventLogEntry/)
  assert.doesNotMatch(readinessSource, /createMatchDayEventLogEntry/)
  assert.doesNotMatch(panelSource, /sendMatchDayPushNotification/)
  assert.doesNotMatch(readinessSource, /sendMatchDayPushNotification/)
})

test('staff fixture squad selection logs safe player selected and deselected entries', async () => {
  const source = await readFile(staffPageUrl, 'utf8')

  assert.match(source, /createMatchDayEventLogEntry,/)
  assert.match(source, /async function logFixtureSquadSelectionEvents/)
  assert.match(source, /eventType: 'player_selected'/)
  assert.match(source, /eventType: 'player_deselected'/)
  assert.match(source, /source: 'staff_fixture_squad_selection'/)
  assert.match(source, /selectionMode === 'individual'[\s\S]*deselectedPlayers/)
  assert.match(source, /await logFixtureSquadSelectionEvents\(\{[\s\S]*selectedPlayerIds,[\s\S]*selectionMode,[\s\S]*user,/)
})

test('staff squad selection can reselect a player after deselection before saving', async () => {
  const source = await readFile(staffPageUrl, 'utf8')

  assert.match(source, /const selectedIds = new Set\(current\.selectedPlayerIds\)/)
  assert.match(source, /if \(selectedIds\.has\(playerId\)\) \{[\s\S]*selectedIds\.delete\(playerId\)[\s\S]*\} else \{[\s\S]*selectedIds\.add\(playerId\)/)
  assert.match(source, /selectedPlayerIds: \[\.\.\.selectedIds\]/)
})

test('server volunteer selection logs role changes without changing email queue behavior', async () => {
  const source = await readFile(selectVolunteerFunctionUrl, 'utf8')

  assert.match(source, /async function createMatchDayEventLogEntry/)
  assert.match(source, /\.from\('match_day_event_log'\)[\s\S]*\.insert\(/)
  assert.match(source, /event_type: eventType/)
  assert.match(source, /eventLabel/)
  assert.match(source, /role === 'linesman'[\s\S]*'linesman_updated'/)
  assert.match(source, /action: isRemoved \? 'removed' : 'assigned'/)
  assert.match(source, /notificationQueuedCount: queuedNotifications\.length/)
  assert.match(source, /source: 'select_match_day_volunteer'/)
  assert.match(source, /console\.warn\('Match Day event log write failed'/)
  assert.match(source, /\.from\('scheduled_email_queue'\)[\s\S]*\.insert\(/)
  assert.match(source, /Volunteer selection was saved, but notification email could not be queued\./)
  assert.doesNotMatch(source, /sendEmail\(/)
})

test('availability invite preparation and queueing logs do not create new queue behavior', async () => {
  const source = await readFile(sendAvailabilityFunctionUrl, 'utf8')

  assert.match(source, /async function createMatchDayEventLogEntry/)
  assert.match(source, /eventType: 'invite_prepared'/)
  assert.match(source, /eventType: 'invite_queued'/)
  assert.match(source, /source: 'send_match_day_availability_requests'/)
  assert.match(source, /\.from\('scheduled_email_queue'\)[\s\S]*\.insert\(/)
  assert.match(source, /queuedEmails\.push\(queuedEmail\)/)
  assert.doesNotMatch(source, /sendEmail\(/)
  assert.doesNotMatch(source, /recipientEmail: contact\.email[\s\S]*match_day_event_log/)
})

test('parent availability response logging uses safe public-token metadata', async () => {
  const source = await readFile(availabilityConfirmFunctionUrl, 'utf8')

  assert.match(source, /createSupabaseAdminClient/)
  assert.match(source, /async function createAvailabilityEventLogEntry/)
  assert.match(source, /event_type: 'player_availability_changed'/)
  assert.match(source, /actor_display_name: actorUserId \? 'Parent response' : 'Public response link'/)
  assert.match(source, /actor_role: actorUserId \? 'parent_portal' : 'public_token'/)
  assert.match(source, /source: 'match_day_availability_confirm'/)
  assert.match(source, /previous_value: previousStatus/)
  assert.doesNotMatch(source, /recipient_email[\s\S]*metadata/)
})

test('event log UI renders Batch 2 event types with safe details', async () => {
  const source = await readFile(staffPageUrl, 'utf8')

  assert.match(source, /function getEventLogTypeLabel/)
  assert.match(source, /invite_prepared: 'invite prepared'/)
  assert.match(source, /invite_queued: 'invite queued'/)
  assert.match(source, /linesman_updated: 'linesman'/)
  assert.match(source, /player_availability_changed: 'availability'/)
  assert.match(source, /Availability: \$\{previousStatus \|\| 'not recorded'\} to \$\{nextStatus \|\| 'not recorded'\}/)
  assert.match(source, /Notifications queued: \$\{Number\(entry\.metadata\.notificationQueuedCount\)\}/)
})

test('parent portal does not expose the staff event log in this batch', async () => {
  const parentSource = await readFile(parentPortalPageUrl, 'utf8')
  const staffSource = await readFile(staffPageUrl, 'utf8')

  assert.doesNotMatch(parentSource, /match_day_event_log/i)
  assert.doesNotMatch(parentSource, /Event Log/)
  assert.doesNotMatch(parentSource, /Match readiness/)
  assert.doesNotMatch(parentSource, /No availability request queued/)
  assert.match(staffSource, /Event Log/)
  assert.match(staffSource, /Match readiness/)
})
