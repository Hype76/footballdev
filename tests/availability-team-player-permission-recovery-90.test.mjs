import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import test from 'node:test'
import { pathToFileURL } from 'node:url'

const root = process.cwd()

test('Availability retries a transient authenticated RPC failure and keeps a canonical membership fallback', () => {
  const source = fs.readFileSync(path.join(root, 'src/lib/domain/core.js'), 'utf8')

  assert.match(source, /isTeamPlayerAuthorizationError\(membershipPlayersError\)/)
  assert.match(source, /supabase\.auth\.getSession\(\)/)
  assert.match(source, /from\('player_team_memberships'\)/)
  assert.match(source, /\.eq\('team_id', activeMembershipTeamId\)/)
  assert.match(source, /\.eq\('status', 'active'\)/)
  assert.match(source, /getTeamPlayerSessionFailure\(membershipsError\)/)
})

test('membership fallback keeps only valid players and overlays the selected team', async () => {
  const moduleUrl = pathToFileURL(path.join(root, 'src/lib/domain/team-player-read.js')).href
  const { normalizeTeamPlayerMembershipRows } = await import(moduleUrl)
  const rows = normalizeTeamPlayerMembershipRows([
    {
      team_id: 'team-fallback',
      player: { id: 'player-1', player_name: 'Alex', team_id: 'old-team', team: 'Old Team' },
      team: { id: 'team-1', name: 'U14 Green' },
    },
    { team_id: 'team-1', player: null, team: { id: 'team-1', name: 'U14 Green' } },
  ])

  assert.deepEqual(rows, [{
    id: 'player-1',
    player_name: 'Alex',
    team_id: 'team-1',
    team: 'U14 Green',
  }])
})

test('function permission failures are recognised without broadening anonymous access', async () => {
  const moduleUrl = pathToFileURL(path.join(root, 'src/lib/domain/team-player-read.js')).href
  const { isTeamPlayerAuthorizationError } = await import(moduleUrl)

  assert.equal(isTeamPlayerAuthorizationError({ code: '42501' }), true)
  assert.equal(isTeamPlayerAuthorizationError({ message: 'permission denied for function get_team_players' }), true)
  assert.equal(isTeamPlayerAuthorizationError({ code: 'PGRST202' }), false)

  const migration = fs.readFileSync(
    path.join(root, 'supabase/migrations/20260802214626_team_removal_event_scope_26c.sql'),
    'utf8',
  )
  assert.match(migration, /revoke all on function public\.get_team_players\(uuid\) from public, anon;/i)
  assert.match(migration, /grant execute on function public\.get_team_players\(uuid\) to authenticated, service_role;/i)
})
