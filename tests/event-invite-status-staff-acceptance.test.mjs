import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'
import {
  buildMatchDayPlayerInviteStateMap,
  resolveEventInvitePlayerStatus,
} from '../src/lib/domain/calendar-actionable-invites.js'

const sessionsPageUrl = new URL('../src/pages/SessionsPage.jsx', import.meta.url)
const actionDomainUrl = new URL('../src/lib/domain/event-availability-staff-actions.js', import.meta.url)
const migrationUrl = new URL(
  '../supabase/migrations/20260728150556_event_invite_status_staff_acceptance.sql',
  import.meta.url,
)

test('event invite status resolver maps canonical availability labels', () => {
  assert.deepEqual(
    ['pending', 'available', 'maybe', 'unavailable'].map((availabilityStatus) =>
      resolveEventInvitePlayerStatus({ availabilityStatus }).primaryLabel),
    ['Awaiting response', 'Available', 'Maybe', 'Unavailable'],
  )
})

test('selected is primary while canonical availability remains available to the UI', () => {
  const selectedAvailable = resolveEventInvitePlayerStatus({
    availabilityStatus: 'available',
    matchFixture: true,
    matchSelectionStatus: 'selected',
  })
  const selectedPending = resolveEventInvitePlayerStatus({
    availabilityStatus: 'pending',
    matchFixture: true,
    matchSelectionStatus: 'selected',
  })

  assert.equal(selectedAvailable.primaryLabel, 'Selected')
  assert.equal(selectedAvailable.secondaryLabel, 'Available')
  assert.equal(selectedAvailable.availabilityStatus, 'available')
  assert.equal(selectedAvailable.accessibleLabel, 'Selected, Available')
  assert.equal(selectedPending.primaryLabel, 'Selected')
  assert.equal(selectedPending.secondaryLabel, 'Awaiting response')
  assert.equal(selectedPending.accessibleLabel, 'Selected, no availability response')
})

test('match event invite state uses canonical response and squad decision records', () => {
  const states = buildMatchDayPlayerInviteStateMap({
    invitedPlayerIds: ['selected-player', 'maybe-player', 'pending-player'],
    matchDay: {
      availabilityRequests: [
        { playerId: 'pending-player', status: 'pending' },
      ],
      playerAvailability: [
        { playerId: 'selected-player', status: 'available' },
        { playerId: 'maybe-player', status: 'maybe' },
      ],
      squadDecisions: [
        { playerId: 'selected-player', status: 'selected' },
      ],
    },
  })

  assert.equal(states['selected-player'].primaryLabel, 'Selected')
  assert.equal(states['selected-player'].availabilityLabel, 'Available')
  assert.equal(states['maybe-player'].primaryLabel, 'Maybe')
  assert.equal(states['pending-player'].primaryLabel, 'Awaiting response')
})

test('event details expose accessible staff acceptance and active refresh', async () => {
  const source = await readFile(sessionsPageUrl, 'utf8')

  assert.match(source, /EventResponseManagerDialog/)
  assert.match(source, /onAcceptOnBehalf=\{\(row\) =>/)
  assert.match(source, /available: form\.eventType === 'training' \? 'Mark attending on behalf' : 'Accept on behalf of player'/)
  assert.match(source, /Current availability:/)
  assert.match(source, /Match selection:/)
  assert.match(source, /min-h-12/)
  assert.match(source, /focus:ring-2/)
  assert.match(source, /window\.setInterval\([\s\S]*10000/)
  assert.match(source, /document\.addEventListener\('visibilitychange'/)
  assert.match(source, /getMatchDay\(\{ user, matchDayId: sourceId \}\)/)
  assert.match(source, /getTrainingAvailabilitySummaryForEvents\(\{ user, eventIds: \[sourceId\] \}\)/)
})

test('staff acceptance client sends only the scoped server command and clears status caches', async () => {
  const source = await readFile(actionDomainUrl, 'utf8')

  assert.match(source, /supabase\.rpc\('accept_event_player_availability_on_behalf'/)
  assert.match(source, /event_id_value: normalizedEventId/)
  assert.match(source, /player_id_value: normalizedPlayerId/)
  assert.match(source, /occurrence_date_value:/)
  assert.match(source, /invalidateMemoryCacheByPrefix\('match-day:'\)/)
  assert.match(source, /invalidateMemoryCacheByPrefix\(`calendar-events:/)
  assert.doesNotMatch(source, /\.from\('match_day_player_availability'\)/)
  assert.doesNotMatch(source, /\.from\('training_availability_responses'\)/)
})

test('staff acceptance migration keeps authority, idempotency, and audit attribution server side', async () => {
  const migration = await readFile(migrationUrl, 'utf8')

  assert.match(migration, /security definer[\s\S]*set search_path = ''/)
  assert.match(migration, /actor_profile\.role = 'parent_portal'/)
  assert.match(migration, /coalesce\(actor_profile\.role_rank, 0\) < 20/)
  assert.match(migration, /public\.can_manage_match_day\(match_row\.team_id\)/)
  assert.match(migration, /public\.current_user_can_access_team\(calendar_event_row\.club_id, calendar_event_row\.team_id\)/)
  assert.match(migration, /player\.club_id = match_row\.club_id[\s\S]*player\.team_id = match_row\.team_id/)
  assert.match(migration, /player\.club_id = calendar_event_row\.club_id[\s\S]*player\.team_id = calendar_event_row\.team_id/)
  assert.match(migration, /invite\.invite_status <> 'cancelled'/)
  assert.match(migration, /previous_status = 'available'[\s\S]*'changed', false/)
  assert.match(migration, /on conflict \(match_day_id, player_id\)/)
  assert.match(migration, /on conflict \(request_id, player_id\)/)
  assert.match(migration, /'source', 'staff_on_behalf'/)
  assert.match(migration, /event_player_availability_accepted_on_behalf/)
  assert.match(migration, /revoke all on function public\.accept_event_player_availability_on_behalf[\s\S]*from public, anon/)
  assert.match(migration, /grant execute on function public\.accept_event_player_availability_on_behalf[\s\S]*to authenticated, service_role/)
})
