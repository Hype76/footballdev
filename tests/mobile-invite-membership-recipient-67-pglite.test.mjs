import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { test } from 'node:test'

import { PGlite } from '@electric-sql/pglite'

const originalMigration = await readFile(
  new URL('../supabase/migrations/20260804120936_fp_v1_calendar_invite_recipient_integrity_34.sql', import.meta.url),
  'utf8',
)
const repairMigration = await readFile(
  new URL('../supabase/migrations/20260818085025_mobile_invite_team_membership_recipient_fix.sql', import.meta.url),
  'utf8',
)

const ids = {
  club: '10000000-0000-4000-8000-000000000001',
  team: '20000000-0000-4000-8000-000000000001',
  legacyTeam: '20000000-0000-4000-8000-000000000002',
  parent: '30000000-0000-4000-8000-000000000001',
  canonicalPlayer: '40000000-0000-4000-8000-000000000001',
  legacyOnlyPlayer: '40000000-0000-4000-8000-000000000002',
}

async function createDatabase() {
  const db = new PGlite()

  await db.exec(`
    create schema auth;
    create role anon;
    create role authenticated;
    create role service_role;

    create table auth.users (
      id uuid primary key,
      email text,
      raw_user_meta_data jsonb default '{}'::jsonb,
      deleted_at timestamptz,
      email_confirmed_at timestamptz,
      banned_until timestamptz
    );
    create table public.users (
      id uuid primary key,
      club_id uuid,
      email text,
      name text,
      display_name text,
      status text
    );
    create table public.players (
      id uuid primary key,
      club_id uuid,
      team_id uuid,
      player_name text,
      parent_email text,
      contact_type text,
      status text,
      archived_at timestamptz
    );
    create table public.player_team_memberships (
      id uuid primary key default gen_random_uuid(),
      club_id uuid not null,
      team_id uuid not null,
      player_id uuid not null,
      status text not null,
      ended_at timestamptz
    );
    create table public.parent_player_links (
      id uuid primary key default gen_random_uuid(),
      club_id uuid,
      team_id uuid,
      player_id uuid,
      auth_user_id uuid,
      email text,
      status text
    );
    create table public.adult_player_account_links (
      id uuid primary key default gen_random_uuid(),
      club_id uuid,
      team_id uuid,
      player_id uuid,
      user_id uuid,
      status text,
      verified_at timestamptz,
      revoked_at timestamptz
    );
    create table public.calendar_event_invites (
      id uuid primary key default gen_random_uuid(),
      club_id uuid not null,
      team_id uuid not null,
      player_id uuid not null,
      recipient_type text not null,
      constraint calendar_event_invites_recipient_type_check
        check (recipient_type in ('parent_guardian', 'player', 'parent_and_player'))
    );
  `)
  await db.exec(originalMigration)
  await db.exec(repairMigration)
  await db.exec(`
    insert into auth.users(id, email, raw_user_meta_data, email_confirmed_at)
    values ('${ids.parent}', 'parent@example.invalid', '{"display_name":"Parent"}', now());

    insert into public.users(id, club_id, email, name, display_name, status)
    values ('${ids.parent}', '${ids.club}', 'parent@example.invalid', 'Parent', 'Parent', 'active');

    insert into public.players(id, club_id, team_id, player_name, parent_email, contact_type, status) values
      ('${ids.canonicalPlayer}', '${ids.club}', '${ids.legacyTeam}', 'Canonical Member', 'parent@example.invalid', 'parent', 'active'),
      ('${ids.legacyOnlyPlayer}', '${ids.club}', '${ids.team}', 'Legacy Only', 'parent@example.invalid', 'parent', 'active');

    insert into public.player_team_memberships(club_id, team_id, player_id, status) values
      ('${ids.club}', '${ids.team}', '${ids.canonicalPlayer}', 'active'),
      ('${ids.club}', '${ids.legacyTeam}', '${ids.legacyOnlyPlayer}', 'active');

    insert into public.parent_player_links(club_id, team_id, player_id, auth_user_id, email, status) values
      ('${ids.club}', '${ids.team}', '${ids.canonicalPlayer}', '${ids.parent}', 'parent@example.invalid', 'active'),
      ('${ids.club}', '${ids.team}', '${ids.legacyOnlyPlayer}', '${ids.parent}', 'parent@example.invalid', 'active');
  `)

  return db
}

test('invite recipients follow active canonical Team membership instead of the legacy Player team field', async () => {
  const db = await createDatabase()

  try {
    const result = await db.query(`
      select player_id, recipient_email, recipient_type
      from public.event_player_eligible_recipients(
        '${ids.club}',
        '${ids.team}',
        array['${ids.canonicalPlayer}'::uuid, '${ids.legacyOnlyPlayer}'::uuid]
      )
      order by player_id
    `)

    assert.deepEqual(result.rows, [{
      player_id: ids.canonicalPlayer,
      recipient_email: 'parent@example.invalid',
      recipient_type: 'parent_guardian',
    }])
  } finally {
    await db.close()
  }
})

test('ended canonical Team membership cannot receive an invitation', async () => {
  const db = await createDatabase()

  try {
    await db.exec(`
      update public.player_team_memberships
      set status = 'inactive', ended_at = now()
      where player_id = '${ids.canonicalPlayer}'
    `)
    const result = await db.query(`
      select player_id
      from public.event_player_eligible_recipients(
        '${ids.club}',
        '${ids.team}',
        array['${ids.canonicalPlayer}'::uuid]
      )
    `)

    assert.deepEqual(result.rows, [])
  } finally {
    await db.close()
  }
})
