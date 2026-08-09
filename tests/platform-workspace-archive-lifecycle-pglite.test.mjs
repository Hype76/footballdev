import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'
import { PGlite } from '@electric-sql/pglite'

const migration = await readFile(
  new URL('../supabase/migrations/20260807200526_platform_workspace_archive_lifecycle.sql', import.meta.url),
  'utf8',
)

const ID = Object.freeze({
  actor: '10000000-0000-4000-8000-000000000001',
  club: '20000000-0000-4000-8000-000000000001',
  deletableClub: '20000000-0000-4000-8000-000000000002',
  team: '30000000-0000-4000-8000-000000000001',
})

async function createDatabase() {
  const db = new PGlite()
  await db.exec(`
    create role anon;
    create role authenticated;
    create role service_role;
    create schema auth;
    create schema app_private;

    create table public.users (
      id uuid primary key,
      email text,
      username text,
      name text,
      role text not null,
      role_label text,
      role_rank integer not null default 0,
      club_id uuid,
      status text not null default 'active',
      suspended_at timestamptz
    );

    create table public.clubs (
      id uuid primary key,
      name text not null,
      status text not null default 'active',
      suspended_at timestamptz
    );

    create table public.teams (
      id uuid primary key,
      club_id uuid not null references public.clubs(id),
      name text not null,
      status text not null default 'active',
      updated_at timestamptz not null default timezone('utc', now())
    );

    create table public.players (
      id uuid primary key,
      club_id uuid not null references public.clubs(id),
      team_id uuid references public.teams(id) on delete set null,
      status text not null default 'active'
    );

    create table public.parent_player_links (
      id uuid primary key default gen_random_uuid(),
      auth_user_id uuid not null,
      player_id uuid not null references public.players(id),
      club_id uuid not null references public.clubs(id),
      team_id uuid references public.teams(id) on delete set null,
      status text not null default 'active'
    );

    create table public.audit_logs (
      id uuid primary key default gen_random_uuid(),
      club_id uuid references public.clubs(id),
      actor_id uuid references public.users(id),
      actor_email text,
      actor_name text,
      actor_role_label text,
      actor_role_rank integer not null default 0,
      action text not null,
      entity_type text not null,
      entity_id uuid,
      metadata jsonb not null default '{}'::jsonb
    );

    create function auth.uid()
    returns uuid
    language sql
    stable
    as $function$ select '${ID.actor}'::uuid $function$;

    create function public.current_user_role()
    returns text
    language sql
    stable
    as $function$ select 'super_admin'::text $function$;

    create function public.current_user_has_club_wide_authority(uuid)
    returns boolean
    language sql
    stable
    as $function$ select false $function$;

    create function public.current_user_has_active_team_assignment(uuid, uuid)
    returns boolean
    language sql
    stable
    as $function$ select false $function$;

    create function public.record_security_audit_event(
      text,
      text,
      uuid default null,
      jsonb default '{}'::jsonb,
      uuid default null,
      text default 'info',
      text default 'success',
      text default 'operational',
      text default 'application'
    )
    returns uuid
    language sql
    as $function$ select gen_random_uuid() $function$;

    insert into public.users(id, email, name, role, role_label, role_rank)
    values ('${ID.actor}', 'platform@example.test', 'Platform Admin', 'super_admin', 'Super Admin', 100);

    insert into public.clubs(id, name) values
      ('${ID.club}', 'Archive Lifecycle Club'),
      ('${ID.deletableClub}', 'Archive Delete Club');

    insert into public.teams(id, club_id, name)
    values ('${ID.team}', '${ID.club}', 'Archive Lifecycle Team');
  `)

  await db.exec(migration)
  return db
}

test('migration compiles and Club archive, restore, and delete guard execute', async () => {
  const db = await createDatabase()

  await assert.rejects(
    db.exec(`delete from public.clubs where id = '${ID.deletableClub}'`),
    /club_must_be_archived_before_delete/,
  )

  const archived = await db.query(`
    select public.set_platform_club_archive_state('${ID.deletableClub}', true) as result
  `)
  assert.equal(archived.rows[0].result.status, 'suspended')
  assert.ok(archived.rows[0].result.archivedAt)

  const restored = await db.query(`
    select public.set_platform_club_archive_state('${ID.deletableClub}', false) as result
  `)
  assert.equal(restored.rows[0].result.status, 'active')
  assert.equal(restored.rows[0].result.archivedAt, null)

  await db.query(`select public.set_platform_club_archive_state('${ID.deletableClub}', true)`)
  await db.exec(`delete from public.clubs where id = '${ID.deletableClub}'`)
  const remaining = await db.query(`select count(*)::integer as count from public.clubs where id = '${ID.deletableClub}'`)
  assert.equal(remaining.rows[0].count, 0)
})

test('Team transaction rejects active records, then archive permits restore and permanent delete', async () => {
  const db = await createDatabase()
  const deleteCall = `
    select * from public.delete_platform_team_transaction(
      '${ID.team}',
      '${ID.club}',
      '${ID.actor}',
      'platform@example.test',
      'Platform Admin',
      'super_admin',
      'Super Admin',
      100
    )
  `

  await assert.rejects(db.query(deleteCall), /team_must_be_archived_before_delete/)

  const archived = await db.query(`
    select public.set_platform_team_archive_state('${ID.team}', '${ID.club}', true) as result
  `)
  assert.equal(archived.rows[0].result.status, 'inactive')
  assert.ok(archived.rows[0].result.archivedAt)

  const restored = await db.query(`
    select public.set_platform_team_archive_state('${ID.team}', '${ID.club}', false) as result
  `)
  assert.equal(restored.rows[0].result.status, 'active')
  assert.equal(restored.rows[0].result.archivedAt, null)

  await db.query(`select public.set_platform_team_archive_state('${ID.team}', '${ID.club}', true)`)
  const deleted = await db.query(deleteCall)
  assert.equal(deleted.rows[0].deleted, true)
  assert.equal(deleted.rows[0].team_id, ID.team)

  const audit = await db.query(`select action from public.audit_logs where entity_id = '${ID.team}'`)
  assert.deepEqual(audit.rows.map((row) => row.action), ['platform_team_deleted'])
})
