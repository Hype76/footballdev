import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'

import { PGlite } from '@electric-sql/pglite'

const migrationUrl = new URL(
  '../supabase/migrations/20260825162500_platform_club_delete_dependency_repair.sql',
  import.meta.url,
)

test('permanent Club deletion clears restricted dependencies before Teams and Clubs', async () => {
  const migration = await readFile(migrationUrl, 'utf8')
  const before = (left, right) => {
    assert.notEqual(migration.indexOf(left), -1, `${left} is missing`)
    assert.notEqual(migration.indexOf(right), -1, `${right} is missing`)
    assert.ok(migration.indexOf(left) < migration.indexOf(right), `${left} must run before ${right}`)
  }

  before('delete from public.club_owner_invites', 'delete from public.teams')
  before('delete from public.adult_player_account_links', 'delete from public.players')
  before('delete from public.data_transfer_batches', 'delete from public.clubs')
  before('delete from public.platform_access_assignment_history', 'delete from public.teams')
  before('delete from public.player_team_removal_commands', 'delete from public.teams')
  before('delete from public.workspace_team_transfer_requests', 'delete from public.teams')
  assert.match(migration, /club_owner_invites_team_id_fkey[\s\S]*references public\.teams \(id\)[\s\S]*on delete cascade/i)
})

test('deleting a Team cascades its owner invitation instead of raising the reported foreign-key error', async () => {
  const db = new PGlite()
  try {
    await db.exec(`
      create role anon;
      create role authenticated;
      create role service_role;
      create schema auth;
      create function auth.uid() returns uuid language sql stable as $$ select null::uuid $$;
      create table public.users (id uuid primary key, role text);
      create table public.clubs (id uuid primary key, name text);
      create table public.teams (id uuid primary key, club_id uuid references public.clubs(id) on delete cascade);
      create table public.club_owner_invites (
        id uuid primary key,
        club_id uuid not null references public.clubs(id) on delete cascade,
        team_id uuid references public.teams(id) on delete restrict
      );
      set check_function_bodies = off;
    `)
    await db.exec(await readFile(migrationUrl, 'utf8'))
    await db.exec(`
      insert into public.clubs values ('10000000-0000-4000-8000-000000000001', 'Test Club');
      insert into public.teams values ('20000000-0000-4000-8000-000000000001', '10000000-0000-4000-8000-000000000001');
      insert into public.club_owner_invites values (
        '30000000-0000-4000-8000-000000000001',
        '10000000-0000-4000-8000-000000000001',
        '20000000-0000-4000-8000-000000000001'
      );
      delete from public.teams where id = '20000000-0000-4000-8000-000000000001';
    `)
    const remaining = await db.query('select count(*)::integer as count from public.club_owner_invites')
    assert.equal(remaining.rows[0].count, 0)
  } finally {
    await db.close()
  }
})
