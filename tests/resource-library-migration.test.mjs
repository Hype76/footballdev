import { migrationSourceUrl } from './helpers/migration-source.mjs'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { test } from 'node:test'

const migrationUrl = migrationSourceUrl('20260702073335_resource_library_v1.sql', 'active')

function getFunction(source, name) {
  const start = source.indexOf(`create or replace function public.${name}`)
  assert.notEqual(start, -1, `${name} function missing`)
  const next = source.indexOf('\ncreate or replace function public.', start + 1)
  return next === -1 ? source.slice(start) : source.slice(start, next)
}

test('Resource Library migration creates private storage bucket and V1 tables', async () => {
  const migration = await readFile(migrationUrl, 'utf8')

  assert.match(migration, /insert into storage\.buckets/i)
  assert.match(migration, /'resource-library'/)
  assert.match(migration, /false,\s*[\r\n\s]*20971520/i)
  assert.match(migration, /allowed_mime_types/i)
  assert.match(migration, /create table if not exists public\.resource_library_items/i)
  assert.match(migration, /create table if not exists public\.resource_library_links/i)
  assert.match(migration, /resource_library_items[\s\S]*team_id uuid not null references public\.teams/i)
  assert.match(migration, /resource_library_links[\s\S]*team_id uuid not null references public\.teams/i)
  assert.match(migration, /linked_type in \('player', 'team'\)/i)
  assert.match(migration, /category in \('general', 'training', 'match_day', 'development', 'admin'\)/i)
  assert.doesNotMatch(migration, /team_id uuid references public\.teams/i)
})

test('Resource Library helpers fail closed for non-staff and enforce team scope', async () => {
  const migration = await readFile(migrationUrl, 'utf8')
  const staffHelper = getFunction(migration, 'is_resource_library_staff')
  const viewHelper = getFunction(migration, 'current_user_can_view_resource_library')
  const manageHelper = getFunction(migration, 'current_user_can_manage_resource_library')
  const teamHelper = getFunction(migration, 'resource_library_user_can_access_team')

  assert.match(staffHelper, /u\.role not in \('parent_portal', 'super_admin'\)/i)
  assert.match(staffHelper, /coalesce\(u\.role_rank, 0\) >= 20/i)
  assert.match(viewHelper, /public\.current_user_role\(\) not in \('parent_portal', 'super_admin'\)/i)
  assert.match(viewHelper, /public\.current_user_role_rank\(\) >= 20/i)
  assert.match(viewHelper, /target_team_id is not null/i)
  assert.match(manageHelper, /public\.current_user_role_rank\(\) >= 50/i)
  assert.match(manageHelper, /target_team_id is not null/i)
  assert.match(teamHelper, /from public\.team_staff ts/i)
  assert.match(teamHelper, /ts\.team_id = target_team_id/i)
  assert.match(teamHelper, /ts\.user_id = target_user_id/i)
})

test('Resource Library links validate same-club player or team targets', async () => {
  const migration = await readFile(migrationUrl, 'utf8')
  const playerScope = getFunction(migration, 'resource_library_player_in_scope')
  const targetAllowed = getFunction(migration, 'resource_library_link_target_allowed')

  assert.match(playerScope, /from public\.players p/i)
  assert.match(playerScope, /p\.club_id = target_club_id/i)
  assert.match(playerScope, /coalesce\(p\.status, 'active'\) <> 'archived'/i)
  assert.match(playerScope, /p\.team_id = target_team_id/i)
  assert.match(targetAllowed, /target_linked_type = 'player'/i)
  assert.match(targetAllowed, /target_linked_type = 'team'/i)
  assert.match(targetAllowed, /target_linked_id = target_team_id/i)
})

test('Resource Library RLS and grants do not expose anonymous or delete access', async () => {
  const migration = await readFile(migrationUrl, 'utf8')

  assert.match(migration, /alter table public\.resource_library_items enable row level security;/i)
  assert.match(migration, /alter table public\.resource_library_links enable row level security;/i)
  assert.match(migration, /revoke all on public\.resource_library_items from anon;/i)
  assert.match(migration, /revoke all on public\.resource_library_links from anon;/i)
  assert.match(migration, /grant select, insert, update on public\.resource_library_items to authenticated;/i)
  assert.match(migration, /grant select, insert, update on public\.resource_library_links to authenticated;/i)
  assert.match(migration, /resource_library_links\.team_id = rli\.team_id/i)
  assert.doesNotMatch(migration, /grant delete on public\.resource_library_/i)
  assert.doesNotMatch(migration, /grant (select|insert|update|delete).* on public\.resource_library_.* to anon/i)
  assert.doesNotMatch(migration, /for delete\s+to authenticated/i)
})

test('Resource Library storage policies keep files private and staff scoped', async () => {
  const migration = await readFile(migrationUrl, 'utf8')

  assert.match(migration, /create policy resource_library_storage_select_staff/i)
  assert.match(migration, /bucket_id = 'resource-library'/i)
  assert.match(migration, /public\.current_user_can_read_resource_file\(name\)/i)
  assert.match(migration, /create policy resource_library_storage_insert_manager/i)
  assert.match(migration, /\(storage\.foldername\(name\)\)\[1\] = public\.current_user_club_id\(\)::text/i)
  assert.match(migration, /\(storage\.foldername\(name\)\)\[2\]/i)
  assert.match(migration, /public\.current_user_can_manage_resource_library\(public\.current_user_club_id\(\), \(\(storage\.foldername\(name\)\)\[2\]\)::uuid\)/i)
  assert.doesNotMatch(migration, /resource_library_storage_.*for delete/i)
})
