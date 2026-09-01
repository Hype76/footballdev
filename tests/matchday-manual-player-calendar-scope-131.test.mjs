import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { test } from 'node:test'

const migration = await readFile(
  new URL('../supabase/migrations/20260901123000_matchday_manual_player_calendar_scope_repair.sql', import.meta.url),
  'utf8',
)

test('manual Match Day participant scope is independent from invitation delivery state', () => {
  assert.match(migration, /join public\.calendar_event_invites invite[\s\S]*invite\.player_id = link\.player_id[\s\S]*invite\.invite_status <> 'cancelled'/)
  assert.doesNotMatch(migration, /invite\.response_requirement = 'informational'/)
  assert.doesNotMatch(migration, /from public\.match_day_availability_requests request/)
})

test('parent Match Day calendar remains relationship scoped and authenticated', () => {
  assert.match(migration, /link\.id = parent_link_id_value[\s\S]*link\.auth_user_id = \(select auth\.uid\(\)\)[\s\S]*link\.status = 'active'/)
  assert.match(migration, /link\.club_id = fixture\.club_id[\s\S]*link\.team_id = fixture\.team_id/)
  assert.match(migration, /fixture\.parent_visible is true[\s\S]*fixture\.parent_audience = 'involved_players'/)
  assert.match(migration, /security definer[\s\S]*set search_path = ''/)
  assert.match(migration, /revoke execute on function public\.get_parent_portal_match_days\(uuid\) from anon;/)
  assert.match(migration, /grant execute on function public\.get_parent_portal_match_days\(uuid\) to authenticated;/)
})
