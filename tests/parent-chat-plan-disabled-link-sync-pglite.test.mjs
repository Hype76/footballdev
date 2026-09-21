import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'

import { PGlite } from '@electric-sql/pglite'

const migration = await readFile(new URL(
  '../supabase/migrations/20260921142952_parent_chat_plan_disabled_parent_link_sync.sql',
  import.meta.url,
), 'utf8')
const chatMigration = await readFile(new URL(
  '../supabase/migrations/20260714120000_parent_portal_chat_v1.sql',
  import.meta.url,
), 'utf8')
const demoRecoveryMigration = await readFile(new URL(
  '../supabase/migrations/20260719092052_p0_demo_reset_atomic_recovery.sql',
  import.meta.url,
), 'utf8')

const ids = {
  actor: '10000000-0000-4000-8000-000000000001',
  club: '20000000-0000-4000-8000-000000000001',
  link: '30000000-0000-4000-8000-000000000001',
  nullCapabilityLink: '30000000-0000-4000-8000-000000000002',
  parent: '40000000-0000-4000-8000-000000000001',
  player: '50000000-0000-4000-8000-000000000001',
  team: '60000000-0000-4000-8000-000000000001',
}

function functionDefinition(source, name) {
  const start = source.indexOf(`create or replace function ${name}(`)
  assert.ok(start >= 0, name)
  const end = source.indexOf('$$;', start)
  assert.ok(end > start, name)
  return source.slice(start, end + 3)
}

async function setActor(db, actorId = ids.actor) {
  await db.query("select set_config('request.jwt.claim.sub', $1, false)", [actorId])
}

async function setParentChat(db, enabled) {
  await db.query('update public.plan_capabilities set enabled = $1 where club_id = $2', [enabled, ids.club])
}

async function createDatabase({ applyFix = true } = {}) {
  const db = new PGlite()
  await db.exec(`
    create role anon;
    create role authenticated;
    create role service_role;
    create schema auth;
    create schema app_private;

    create function auth.uid() returns uuid language sql stable set search_path = '' as $$
      select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid
    $$;
    create function public.platform_access_is_admin_v1(uuid)
    returns boolean language sql stable set search_path = '' as $$ select false $$;

    create table public.plan_capabilities (club_id uuid primary key, enabled boolean not null);
    create function public.can_use_plan_feature(target_club_id uuid, capability_key text)
    returns boolean language sql stable set search_path = '' as $$
      select capability_key = 'parentChat' and coalesce((
        select enabled from public.plan_capabilities where club_id = target_club_id
      ), false)
    $$;

    create table public.users (
      id uuid primary key, club_id uuid, role text, role_rank integer, status text
    );
    create table public.teams (id uuid primary key, club_id uuid not null, name text not null);
    create table public.team_staff (team_id uuid not null, user_id uuid not null);
    create table public.players (
      id uuid primary key, club_id uuid not null, team_id uuid, status text, archived_at timestamptz
    );
    create table public.parent_player_links (
      id uuid primary key, club_id uuid not null, team_id uuid, player_id uuid not null,
      auth_user_id uuid, status text not null
    );
    create table public.match_day_player_squad_decisions (
      match_day_id uuid, club_id uuid, team_id uuid, player_id uuid, status text
    );
    create table public.parent_chat_rooms (
      id uuid primary key default gen_random_uuid(), club_id uuid not null, team_id uuid,
      player_id uuid, match_day_id uuid, room_type text not null, status text not null default 'active',
      title text not null
    );
    create unique index parent_chat_player_room on public.parent_chat_rooms (club_id, team_id, player_id)
      where room_type = 'parent_staff';
    create unique index parent_chat_team_room on public.parent_chat_rooms (club_id, team_id)
      where room_type = 'team';
    create table public.parent_chat_memberships (
      room_id uuid not null, club_id uuid not null, auth_user_id uuid not null,
      member_kind text not null, active boolean not null default true,
      left_at timestamptz, updated_at timestamptz not null default now(),
      unique (room_id, auth_user_id)
    );
    create table public.parent_chat_membership_audit (
      id uuid primary key default gen_random_uuid(), room_id uuid not null,
      club_id uuid not null, auth_user_id uuid not null, member_kind text not null,
      action text not null, reason text not null default 'authoritative_relationship_reconciliation',
      created_at timestamptz not null default now()
    );

    create function app_private.enforce_parent_chat_plan()
    returns trigger language plpgsql security definer set search_path = '' as $$
    declare
      row_value jsonb := case when tg_op = 'DELETE' then to_jsonb(old) else to_jsonb(new) end;
    begin
      if auth.uid() is not null
        and not public.can_use_plan_feature((row_value ->> 'club_id')::uuid, 'parentChat') then
        raise exception using errcode = '42501', message = 'plan_capability_not_available';
      end if;
      return case when tg_op = 'DELETE' then old else new end;
    end;
    $$;
    create trigger enforce_plan_capability_mutation
      before insert or update or delete on public.parent_chat_rooms
      for each row execute function app_private.enforce_parent_chat_plan();
    create trigger enforce_plan_capability_mutation
      before insert or update or delete on public.parent_chat_memberships
      for each row execute function app_private.enforce_parent_chat_plan();

    insert into public.plan_capabilities values ('${ids.club}', false);
    insert into public.teams values ('${ids.team}', '${ids.club}', 'FP TEST U14');
    insert into public.players values ('${ids.player}', '${ids.club}', '${ids.team}', 'active', null);
    insert into public.users values ('${ids.actor}', '${ids.club}', 'coach', 20, 'active');
    insert into public.team_staff values ('${ids.team}', '${ids.actor}');
    insert into public.parent_chat_rooms (club_id, team_id, room_type, title)
      values ('${ids.club}', '${ids.team}', 'team', 'Existing team chat');
  `)
  for (const name of [
    'public.parent_chat_staff_can_access_team',
    'public.parent_chat_parent_can_access_room',
    'public.parent_chat_user_can_access_room',
  ]) {
    await db.exec(functionDefinition(chatMigration, name))
  }
  await db.exec(functionDefinition(chatMigration, 'public.parent_chat_reconcile_room'))
  await db.exec(applyFix
    ? migration
    : functionDefinition(demoRecoveryMigration, 'public.parent_chat_sync_parent_link'))
  await db.exec(`
    create trigger parent_chat_parent_link_sync
      after insert or update of status, auth_user_id, team_id, player_id or delete
      on public.parent_player_links
      for each row execute function public.parent_chat_sync_parent_link();
  `)
  await setActor(db)
  return db
}

test('migration keeps the global Parent Chat mutation gate intact', () => {
  assert.match(migration, /can_use_plan_feature\(link_record\.club_id, 'parentChat'\) is not true/)
  assert.doesNotMatch(migration, /enforce_plan_capability_mutation|drop trigger/i)
})

test('disabled Parent Chat does not block Parent Portal invitation lifecycle', async () => {
  const db = await createDatabase({ applyFix: false })
  try {
    await assert.rejects(db.query(`insert into public.parent_chat_rooms (
      club_id, team_id, player_id, room_type, title
    ) values ($1, $2, $3, 'parent_staff', 'Blocked direct write')`, [ids.club, ids.team, ids.player]), /plan_capability_not_available/)
    const pendingInsert = `insert into public.parent_player_links (
      id, club_id, team_id, player_id, auth_user_id, status
    ) values ($1, $2, $3, $4, null, 'pending')`
    await assert.rejects(db.query(pendingInsert, [ids.link, ids.club, ids.team, ids.player]), /plan_capability_not_available/)
    assert.equal((await db.query('select count(*)::int count from public.parent_player_links')).rows[0].count, 0)
    assert.equal((await db.query('select count(*)::int count from public.parent_chat_membership_audit')).rows[0].count, 0)

    await db.exec(migration)
    await db.query(pendingInsert, [ids.link, ids.club, ids.team, ids.player])
    await db.query("update public.parent_player_links set auth_user_id = $1, status = 'active' where id = $2", [ids.parent, ids.link])
    await db.query("update public.parent_player_links set status = 'revoked' where id = $1", [ids.link])

    assert.equal((await db.query('select status from public.parent_player_links where id = $1', [ids.link])).rows[0].status, 'revoked')
    assert.equal((await db.query('select count(*)::int count from public.parent_chat_rooms')).rows[0].count, 1)
    assert.equal((await db.query('select count(*)::int count from public.parent_chat_memberships')).rows[0].count, 0)

    await db.query('delete from public.plan_capabilities where club_id = $1', [ids.club])
    await db.query(pendingInsert, [ids.nullCapabilityLink, ids.club, ids.team, ids.player])
    assert.equal((await db.query('select status from public.parent_player_links where id = $1', [ids.nullCapabilityLink])).rows[0].status, 'pending')
  } finally {
    await db.close()
  }
})

test('enabled Parent Chat still performs normal room and membership synchronization', async () => {
  const db = await createDatabase()
  try {
    await setParentChat(db, true)
    await db.query(`insert into public.parent_player_links (
      id, club_id, team_id, player_id, auth_user_id, status
    ) values ($1, $2, $3, $4, $5, 'active')`, [ids.link, ids.club, ids.team, ids.player, ids.parent])

    assert.equal((await db.query('select count(*)::int count from public.parent_chat_rooms')).rows[0].count, 2)
    assert.equal((await db.query('select count(*)::int count from public.parent_chat_memberships where active')).rows[0].count, 4)
    const permissions = (await db.query(`select
      has_function_privilege('anon', 'public.parent_chat_sync_parent_link()', 'execute') anon,
      has_function_privilege('authenticated', 'public.parent_chat_sync_parent_link()', 'execute') authenticated,
      has_function_privilege('service_role', 'public.parent_chat_sync_parent_link()', 'execute') service
    `)).rows[0]
    assert.deepEqual(permissions, { anon: false, authenticated: false, service: true })
  } finally {
    await db.close()
  }
})

test('a stale membership cannot preserve room access after revocation while sync is disabled', async () => {
  const db = await createDatabase()
  try {
    await setParentChat(db, true)
    await db.query(`insert into public.parent_player_links (
      id, club_id, team_id, player_id, auth_user_id, status
    ) values ($1, $2, $3, $4, $5, 'active')`, [ids.link, ids.club, ids.team, ids.player, ids.parent])
    const roomId = (await db.query("select id from public.parent_chat_rooms where room_type = 'parent_staff'")).rows[0].id
    assert.equal((await db.query('select public.parent_chat_user_can_access_room($1, $2) allowed', [roomId, ids.parent])).rows[0].allowed, true)

    await setParentChat(db, false)
    await db.query("update public.parent_player_links set status = 'revoked' where id = $1", [ids.link])
    assert.equal((await db.query('select active from public.parent_chat_memberships where room_id = $1 and auth_user_id = $2', [roomId, ids.parent])).rows[0].active, true)

    await setParentChat(db, true)
    assert.equal((await db.query('select public.parent_chat_user_can_access_room($1, $2) allowed', [roomId, ids.parent])).rows[0].allowed, false)
  } finally {
    await db.close()
  }
})
