import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { test } from 'node:test'

const migrationUrl = new URL('../supabase/migrations/20260616051157_harden_match_days_staff_select_scope.sql', import.meta.url)

function getPolicySection(source) {
  const start = source.indexOf('create policy match_days_staff_select_scoped')
  assert.notEqual(start, -1)
  return source.slice(start)
}

function getFunctionSection(source) {
  const start = source.indexOf('create or replace function public.can_read_match_day')
  assert.notEqual(start, -1)
  const end = source.indexOf('revoke all on function public.can_read_match_day', start)
  assert.notEqual(end, -1)
  return source.slice(start, end)
}

test('migration replaces broad same-club match day select policy with read helper', async () => {
  const migration = await readFile(migrationUrl, 'utf8')
  const policy = getPolicySection(migration)

  assert.match(migration, /drop policy if exists match_days_staff_select_scoped on public\.match_days;/i)
  assert.match(policy, /create policy match_days_staff_select_scoped/i)
  assert.match(policy, /for select\s+to authenticated/i)
  assert.match(policy, /public\.current_user_role\(\) = 'super_admin'/i)
  assert.match(policy, /club_id = public\.current_user_club_id\(\)/i)
  assert.match(policy, /public\.can_read_match_day\(team_id\)/i)
  assert.doesNotMatch(policy, /public\.current_user_role\(\) <> 'parent_portal'/i)
})

test('read helper fails closed for club admin, parents, unassigned teams, and null teams', async () => {
  const migration = await readFile(migrationUrl, 'utf8')
  const helper = getFunctionSection(migration)

  assert.match(helper, /returns boolean/i)
  assert.match(helper, /security definer/i)
  assert.match(helper, /set search_path = public/i)
  assert.match(helper, /public\.current_user_role\(\) = 'super_admin'/i)
  assert.match(helper, /public\.current_user_role\(\) not in \('admin', 'parent_portal', 'super_admin'\)/i)
  assert.match(helper, /public\.current_user_role_rank\(\) >= 20/i)
  assert.match(helper, /target_team_id is not null/i)
  assert.match(helper, /from public\.team_staff ts/i)
  assert.match(helper, /ts\.team_id = target_team_id/i)
  assert.match(helper, /ts\.user_id = auth\.uid\(\)/i)
  assert.doesNotMatch(helper, /public\.current_user_role_rank\(\) >= 50\s+or exists/i)
})

test('read helper execute grants do not expose anon access', async () => {
  const migration = await readFile(migrationUrl, 'utf8')

  assert.match(migration, /revoke all on function public\.can_read_match_day\(uuid\) from public;/i)
  assert.match(migration, /revoke execute on function public\.can_read_match_day\(uuid\) from anon;/i)
  assert.match(migration, /grant execute on function public\.can_read_match_day\(uuid\) to authenticated;/i)
  assert.match(migration, /grant execute on function public\.can_read_match_day\(uuid\) to service_role;/i)
  assert.doesNotMatch(migration, /grant execute on function public\.can_read_match_day\(uuid\) to anon;/i)
})
