import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'

import { PGlite } from '@electric-sql/pglite'

const readinessMigrationUrls = [
  new URL(
    '../supabase/migrations/20260824082411_coach_mobile_parent_notification_readiness.sql',
    import.meta.url,
  ),
  new URL(
    '../supabase/migrations/20260824084025_coach_mobile_parent_notification_readiness_hardening.sql',
    import.meta.url,
  ),
]
const installationPresenceMigrationUrl = new URL(
  '../supabase/migrations/20260825162000_parent_mobile_app_installation_presence.sql',
  import.meta.url,
)

const IDS = {
  actor: '10000000-0000-4000-8000-000000000001',
  club: '20000000-0000-4000-8000-000000000001',
  team: '30000000-0000-4000-8000-000000000001',
  otherTeam: '30000000-0000-4000-8000-000000000002',
  readyParent: '40000000-0000-4000-8000-000000000001',
}

const schemaSql = `
create role anon;
create role authenticated;
create role service_role;
create schema auth;

create table auth.users (
  id uuid primary key
);

create function auth.uid()
returns uuid
language sql
stable
as $$
  select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid;
$$;

create function public.current_user_club_id()
returns uuid
language sql
stable
as $$
  select nullif(current_setting('request.jwt.claim.club_id', true), '')::uuid;
$$;

create function public.current_user_role()
returns text
language sql
stable
as $$
  select coalesce(nullif(current_setting('request.jwt.claim.role', true), ''), '');
$$;

create function public.current_user_role_rank()
returns integer
language sql
stable
as $$
  select coalesce(nullif(current_setting('request.jwt.claim.role_rank', true), '')::integer, 0);
$$;

create table public.teams (
  id uuid primary key,
  club_id uuid not null
);

create table public.players (
  id uuid primary key default gen_random_uuid(),
  club_id uuid not null,
  parent_contacts jsonb not null default '[]'::jsonb,
  parent_email text,
  contact_type text not null default 'parent',
  status text not null default 'active',
  archived_at timestamptz
);

create table public.player_team_memberships (
  player_id uuid not null,
  club_id uuid not null,
  team_id uuid not null,
  status text not null default 'active'
);

create table public.team_staff (
  team_id uuid not null,
  user_id uuid not null
);

create table public.parent_player_links (
  id uuid primary key default gen_random_uuid(),
  club_id uuid not null,
  team_id uuid,
  player_id uuid not null,
  link_type text not null default 'parent',
  email text,
  auth_user_id uuid,
  status text not null default 'pending'
);

`

function installationSchema(tableName) {
  const environmentColumn = tableName === 'mobile_test_parent_push_installations'
    ? "environment text not null default 'test',"
    : ''
  return `
    create table public.${tableName} (
      installation_id uuid primary key default gen_random_uuid(),
      ${environmentColumn}
      auth_user_id uuid,
      expo_push_token text,
      platform text not null default 'ios',
      app_version text not null default '',
      build_number text not null default '',
      detail_level text not null default 'minimal',
      enabled boolean not null default false,
      status text not null default 'unbound',
      last_seen_at timestamptz not null default now(),
      created_at timestamptz not null default now()
    );
  `
}

async function setActor(db, { assigned = true, roleRank = 20 } = {}) {
  await db.query("select set_config('request.jwt.claim.sub', $1, false)", [IDS.actor])
  await db.query("select set_config('request.jwt.claim.club_id', $1, false)", [IDS.club])
  await db.query("select set_config('request.jwt.claim.role', 'coach', false)")
  await db.query("select set_config('request.jwt.claim.role_rank', $1, false)", [String(roleRank)])
  await db.query('delete from public.team_staff')
  if (assigned) {
    await db.query('insert into public.team_staff(team_id, user_id) values ($1, $2)', [IDS.team, IDS.actor])
  }
}

async function verifyReadinessTable(tableName) {
  const db = new PGlite()

  try {
    await db.exec(schemaSql)
    await db.exec(installationSchema('parent_mobile_push_installations'))
    if (tableName !== 'parent_mobile_push_installations') {
      await db.exec(installationSchema(tableName))
    }
    for (const migrationUrl of readinessMigrationUrls) {
      await db.exec(await readFile(migrationUrl, 'utf8'))
    }
    await db.query('insert into auth.users(id) values ($1), ($2)', [IDS.actor, IDS.readyParent])
    await setActor(db)
    await db.query('insert into public.teams(id, club_id) values ($1, $2), ($3, $2)', [IDS.team, IDS.club, IDS.otherTeam])

    const player = await db.query(
      `insert into public.players(club_id, parent_contacts, parent_email)
       values ($1, $2::jsonb, 'ready@example.test')
       returning id`,
      [IDS.club, JSON.stringify([
        { email: ' Ready@Example.Test ', type: 'parent' },
        { email: 'waiting@example.test', type: 'parent' },
        { email: 'ready@example.test', type: 'parent' },
        { email: 'player@example.test', type: 'self' },
      ])],
    )
    const playerId = player.rows[0].id
    await db.query(
      `insert into public.player_team_memberships(player_id, club_id, team_id, status)
       values ($1, $2, $3, 'active')`,
      [playerId, IDS.club, IDS.team],
    )
    await db.query(
      `insert into public.parent_player_links(club_id, team_id, player_id, email, auth_user_id, status)
       values ($1, $2, $3, 'ready@example.test', $4, 'active')`,
      [IDS.club, IDS.team, playerId, IDS.readyParent],
    )
    await db.query(
      `insert into public.${tableName}(auth_user_id, expo_push_token, detail_level, enabled, status)
       values ($1, 'ExpoPushToken[ready]', 'minimal', true, 'active')`,
      [IDS.readyParent],
    )
    await db.exec(await readFile(installationPresenceMigrationUrl, 'utf8'))
    if (tableName === 'parent_mobile_push_installations') {
      const backfilled = await db.query(
        'select count(*)::integer as count from public.parent_mobile_app_installations where auth_user_id = $1',
        [IDS.readyParent],
      )
      assert.equal(backfilled.rows[0].count, 1)
    }
    await db.query("select set_config('request.jwt.claim.sub', $1, false)", [IDS.readyParent])
    const registration = await db.query(
      `select public.register_parent_mobile_app_installation(
        '50000000-0000-4000-8000-000000000001',
        'ios',
        '1.0.0',
        '100'
      ) as registered`,
    )
    assert.equal(registration.rows[0].registered, true)
    await setActor(db)

    const result = await db.query(
      'select * from public.get_team_parent_app_installation_status($1)',
      [IDS.team],
    )

    assert.deepEqual(result.rows, [{
      installed_contact_count: 1,
      parent_contact_count: 2,
      player_id: playerId,
    }])

    await setActor(db, { assigned: false })
    const denied = await db.query(
      'select * from public.get_team_parent_app_installation_status($1)',
      [IDS.team],
    )
    assert.equal(denied.rows.length, 0)
  } finally {
    await db.close()
  }
}

test('installation status works alongside the production Parent notification authority', async () => {
  await verifyReadinessTable('parent_mobile_push_installations')
})

test('installation status works alongside the isolated FP TEST Parent notification authority', async () => {
  await verifyReadinessTable('mobile_test_parent_push_installations')
})
