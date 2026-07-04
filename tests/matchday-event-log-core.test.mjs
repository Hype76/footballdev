import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { test } from 'node:test'

import { normalizeMatchDay } from '../src/lib/domain/match-day.js'

const migrationUrl = new URL('../supabase/migrations/20260704084216_match_day_event_log_core.sql', import.meta.url)
const domainUrl = new URL('../src/lib/domain/match-day.js', import.meta.url)
const staffPageUrl = new URL('../src/pages/MatchDayPage.jsx', import.meta.url)
const selectVolunteerFunctionUrl = new URL('../netlify/functions/select-match-day-volunteer.js', import.meta.url)
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

test('server volunteer selection logs role changes without changing email queue behavior', async () => {
  const source = await readFile(selectVolunteerFunctionUrl, 'utf8')

  assert.match(source, /async function createMatchDayEventLogEntry/)
  assert.match(source, /\.from\('match_day_event_log'\)[\s\S]*\.insert\(/)
  assert.match(source, /event_type: eventType/)
  assert.match(source, /eventLabel/)
  assert.match(source, /notificationQueuedCount: queuedNotifications\.length/)
  assert.match(source, /source: 'select_match_day_volunteer'/)
  assert.match(source, /console\.warn\('Match Day event log write failed'/)
  assert.match(source, /\.from\('scheduled_email_queue'\)[\s\S]*\.insert\(/)
  assert.match(source, /Volunteer selection was saved, but notification email could not be queued\./)
  assert.doesNotMatch(source, /sendEmail\(/)
})

test('parent portal does not expose the staff event log in this batch', async () => {
  const parentSource = await readFile(parentPortalPageUrl, 'utf8')
  const staffSource = await readFile(staffPageUrl, 'utf8')

  assert.doesNotMatch(parentSource, /match_day_event_log/i)
  assert.doesNotMatch(parentSource, /Event Log/)
  assert.match(staffSource, /Event Log/)
})
