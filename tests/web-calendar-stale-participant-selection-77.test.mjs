import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { test } from 'node:test'

import { getManageableEventPlayerIds } from '../src/lib/domain/event-player-selection.js'

const sessionsPageUrl = new URL('../src/pages/SessionsPage.jsx', import.meta.url)
const migrationUrl = new URL(
  '../supabase/migrations/20260823132521_web_calendar_match_review_authority_77.sql',
  import.meta.url,
)
const [sessionsPage, migration] = await Promise.all([
  readFile(sessionsPageUrl, 'utf8'),
  readFile(migrationUrl, 'utf8'),
])

test('player management opens with only current participants still present in the active roster', () => {
  const result = getManageableEventPlayerIds({
    currentParticipants: [
      { playerId: 'active-player' },
      { playerId: 'stale-player' },
      { playerId: 'active-player' },
      { playerId: '' },
    ],
    rosterPlayers: [
      { id: 'active-player' },
      { id: 'available-player' },
    ],
  })

  assert.deepEqual(result, ['active-player'])
})

test('Calendar player management sanitizes hidden stale participants before preview', () => {
  assert.match(sessionsPage, /const manageableCurrentCalendarEventInvites = useMemo/)
  assert.match(sessionsPage, /currentParticipants: currentCalendarEventInvites/)
  assert.match(sessionsPage, /rosterPlayers: calendarInvitePlayers/)
  assert.match(sessionsPage, /invitedPlayerIds: manageableCurrentCalendarEventInvites\.map/)
  assert.match(sessionsPage, /currentInvites=\{manageableCurrentCalendarEventInvites\}/)
})

test('initial Match evidence excludes Players outside the active event Team', () => {
  assert.match(migration, /from public\.players player/)
  assert.match(migration, /player\.id = evidence\.player_id/)
  assert.match(migration, /player\.club_id = source_club_id/)
  assert.match(migration, /player\.team_id = source_team_id/)
  assert.match(migration, /coalesce\(player\.status, 'active'\) <> 'archived'/)
})

test('saved Match player-management state follows its command and active invitation ledger', () => {
  assert.match(migration, /from public\.event_player_change_commands command/)
  assert.match(migration, /command\.source_type = 'match-day'/)
  assert.match(migration, /command\.match_day_id = event_id_value/)
  assert.match(migration, /from public\.calendar_event_invites invite/)
  assert.match(migration, /invite\.invite_status <> 'cancelled'/)
})
