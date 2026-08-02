import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'

const [pageSource, listSource, modalSource, domainSource, migrationSource, trainingProcessorSource, eventSendSource, matchSendSource] = await Promise.all([
  readFile(new URL('../src/pages/PlayersPage.jsx', import.meta.url), 'utf8'),
  readFile(new URL('../src/components/players/PlayersListSection.jsx', import.meta.url), 'utf8'),
  readFile(new URL('../src/components/players/TeamRemovalModal.jsx', import.meta.url), 'utf8'),
  readFile(new URL('../src/lib/domain/core.js', import.meta.url), 'utf8'),
  readFile(new URL('../supabase/migrations/20260802214626_team_removal_event_scope_26c.sql', import.meta.url), 'utf8'),
  readFile(new URL('../netlify/functions/process-training-availability-requests.js', import.meta.url), 'utf8'),
  readFile(new URL('../netlify/functions/send-event-player-invitation.js', import.meta.url), 'utf8'),
  readFile(new URL('../netlify/functions/send-match-day-availability-requests.js', import.meta.url), 'utf8'),
])

test('Team Player management presents explicit safe removal scopes', () => {
  for (const requiredCopy of [
    'Remove from Team',
    'Remove from Team only',
    'Remove from Team and future events',
    'Existing event participation, including future events, remains unchanged',
    'Past events and historical records remain unchanged',
    'Delete Player record remains a separate protected action',
  ]) {
    assert.match(`${pageSource}\n${listSource}\n${modalSource}`, new RegExp(requiredCopy))
  }

  assert.match(modalSource, /useState\('team_only'\)/)
  assert.doesNotMatch(modalSource, /useState\('team_and_future_events'\)/)
  assert.match(pageSource, /canManageTeamSettings\(user\)/)
  assert.match(domainSource, /Team Admin or Manager access is required/)
  assert.match(domainSource, /preview_player_team_removal/)
  assert.match(domainSource, /remove_player_from_team/)
})

test('migration is atomic, idempotent, scoped, history-preserving, and communication-free', () => {
  assert.match(migrationSource, /player_team_memberships_one_active_key/)
  assert.match(migrationSource, /player_team_removal_commands_actor_request_key/)
  assert.match(migrationSource, /pg_advisory_xact_lock/)
  assert.match(migrationSource, /preview_player_team_removal/)
  assert.match(migrationSource, /remove_player_from_event/)
  assert.match(migrationSource, /team_only/)
  assert.match(migrationSource, /team_and_future_events/)
  assert.match(migrationSource, /'playerRecordPreserved', true/)
  assert.match(migrationSource, /'otherTeamMembershipsPreserved', true/)
  assert.match(migrationSource, /'communicationSent', false/)
  assert.doesNotMatch(migrationSource, /delete from public\.(players|evaluations|training_availability_responses|match_day_player_availability|parent_player_links)/i)
  assert.doesNotMatch(migrationSource, /insert into public\.(scheduled_email_queue|communication_logs|notifications)/i)
})

test('Team-only delivery paths preserve already configured event participation', () => {
  assert.doesNotMatch(eventSendSource, /\.eq\('team_id', scopedEvent\.team_id\)\s*\.neq\('status', 'archived'\)/)
  assert.doesNotMatch(trainingProcessorSource, /player\.team_id === request\.team_id/)
  assert.doesNotMatch(trainingProcessorSource, /\.eq\('team_id', request\.team_id\)\s*\.neq\('status', 'archived'\)\s*\.in\('id', scopedPlayerIds\)/)
  assert.doesNotMatch(matchSendSource, /\.eq\('team_id', match\.team_id\)\s*\.in\('id', authoritativePlayerIds\)/)
  assert.match(migrationSource, /join public\.players player on player\.id = request\.player_id and player\.club_id = request\.club_id/)
  assert.match(migrationSource, /join public\.players player on player\.id = request_player\.player_id and player\.club_id = request_player\.club_id/)
})
