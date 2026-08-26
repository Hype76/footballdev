import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import test from 'node:test'
import { fileURLToPath } from 'node:url'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const migration = fs.readFileSync(
  path.join(root, 'supabase', 'migrations', '20260826175527_chat_read_path_performance_75.sql'),
  'utf8',
)

function functionSource(name, nextName = '') {
  const start = migration.indexOf(`create or replace function public.${name}`)
  assert.notEqual(start, -1, `${name} must be present`)
  const end = nextName
    ? migration.indexOf(`create or replace function public.${nextName}`, start)
    : migration.indexOf(`comment on function`, start)
  return migration.slice(start, end === -1 ? migration.length : end)
}

test('Parent Chat inbox reads do not run room reconciliation', () => {
  const rooms = functionSource(
    'get_parent_chat_rooms()',
    'get_parent_portal_chat_notification_preferences',
  )
  const latestActivity = functionSource('parent_portal_latest_chat_activity')

  for (const source of [rooms, latestActivity]) {
    assert.match(source, /\bstable\b/i)
    assert.doesNotMatch(source, /parent_chat_ensure_rooms_for_current_user/i)
    assert.doesNotMatch(source, /parent_chat_reconcile_room/i)
    assert.doesNotMatch(source, /\b(insert|update|delete)\s+(?:into\s+|from\s+)?public\./i)
  }
})

test('notification preferences use the authorised room set without loading full room payloads', () => {
  const preferences = functionSource(
    'get_parent_portal_chat_notification_preferences',
    'parent_portal_latest_chat_activity',
  )

  assert.match(preferences, /from public\.parent_chat_rooms room/i)
  assert.match(preferences, /parent_chat_user_can_access_room\(room\.id, actor_id\)/i)
  assert.match(preferences, /parent_chat_room_matches_parent_link/i)
  assert.match(preferences, /message\.created_at >= history_cutoff/i)
  assert.doesNotMatch(preferences, /get_parent_portal_chat_rooms/i)
  assert.doesNotMatch(preferences, /\b(insert|update|delete)\s+(?:into\s+|from\s+)?public\./i)
})

test('Match Day detail is a read-only active-Team and club-authorised read model', () => {
  const detail = functionSource('get_staff_match_day_detail')

  assert.match(detail, /\bstable\b/i)
  assert.match(detail, /security definer/i)
  assert.match(detail, /match_day\.club_id = public\.current_user_club_id\(\)/i)
  assert.match(detail, /match_day\.team_id is null or match_day\.team_id = active_team_id_value/i)
  assert.match(detail, /public\.can_read_match_day\(match_day\.team_id\)/i)
  for (const relation of [
    'match_day_availability_requests',
    'match_day_events',
    'match_day_final_reports',
    'match_day_role_assignments',
    'match_day_scorer_interest',
  ]) {
    assert.match(detail, new RegExp(`'${relation}'`))
  }
  assert.doesNotMatch(detail, /\b(insert|update|delete)\s+(?:into\s+|from\s+)?public\./i)
})
