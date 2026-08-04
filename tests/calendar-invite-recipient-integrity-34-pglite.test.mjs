import { PGlite } from '@electric-sql/pglite'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { test } from 'node:test'

const migrationUrl = new URL('../supabase/migrations/20260804120936_fp_v1_calendar_invite_recipient_integrity_34.sql', import.meta.url)
const migration = await readFile(migrationUrl, 'utf8')

const ids = {
  club: '10000000-0000-4000-8000-000000000001',
  team: '20000000-0000-4000-8000-000000000001',
  otherTeam: '20000000-0000-4000-8000-000000000002',
  parentA: '30000000-0000-4000-8000-000000000001',
  parentB: '30000000-0000-4000-8000-000000000002',
  adult: '30000000-0000-4000-8000-000000000003',
  playerParent: '40000000-0000-4000-8000-000000000001',
  playerAdult: '40000000-0000-4000-8000-000000000002',
  playerNoRecipient: '40000000-0000-4000-8000-000000000003',
  crossTeamPlayer: '40000000-0000-4000-8000-000000000004',
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

  await db.exec(migration)

  await db.exec(`
    insert into auth.users(id, email, raw_user_meta_data, email_confirmed_at) values
      ('${ids.parentA}', 'parent-a@example.invalid', '{"display_name":"Parent A"}', now()),
      ('${ids.parentB}', 'parent-b@example.invalid', '{"display_name":"Parent B"}', now()),
      ('${ids.adult}', 'adult-player@example.invalid', '{"display_name":"Adult Player"}', now());
    insert into public.users(id, club_id, email, name, display_name, status) values
      ('${ids.parentA}', '${ids.club}', 'parent-a@example.invalid', 'Parent A', 'Parent A', 'active'),
      ('${ids.parentB}', '${ids.club}', 'parent-b@example.invalid', 'Parent B', 'Parent B', 'active');
    insert into public.players(id, club_id, team_id, player_name, parent_email, contact_type, status) values
      ('${ids.playerParent}', '${ids.club}', '${ids.team}', 'Linked Child', 'parent-a@example.invalid', 'parent', 'active'),
      ('${ids.playerAdult}', '${ids.club}', '${ids.team}', 'Adult Player', 'adult-player@example.invalid', 'self', 'active'),
      ('${ids.playerNoRecipient}', '${ids.club}', '${ids.team}', 'No Recipient', 'invitation-only@example.invalid', 'parent', 'active'),
      ('${ids.crossTeamPlayer}', '${ids.club}', '${ids.otherTeam}', 'Other Team Player', 'parent-a@example.invalid', 'parent', 'active');
    insert into public.parent_player_links(club_id, team_id, player_id, auth_user_id, email, status) values
      ('${ids.club}', '${ids.team}', '${ids.playerParent}', '${ids.parentA}', 'parent-a@example.invalid', 'active'),
      ('${ids.club}', '${ids.team}', '${ids.playerParent}', '${ids.parentB}', 'parent-b@example.invalid', 'active'),
      ('${ids.club}', '${ids.otherTeam}', '${ids.crossTeamPlayer}', '${ids.parentA}', 'parent-a@example.invalid', 'active');
    insert into public.adult_player_account_links(club_id, team_id, player_id, user_id, status, verified_at) values
      ('${ids.club}', '${ids.team}', '${ids.playerAdult}', '${ids.adult}', 'active', now());
  `)

  return db
}

test('canonical mapper emits only the production-approved closed set', async () => {
  const db = await createDatabase()
  const result = await db.query(`
    select input, public.canonical_calendar_invite_recipient_type(input) as canonical
    from unnest(array[
      'parent', 'guardian', 'parent_guardian', 'adult_player', 'player', 'parent_and_player',
      'staff', 'invitation_only', '', null
    ]::text[]) input
  `)

  assert.deepEqual(result.rows, [
    { input: 'parent', canonical: 'parent_guardian' },
    { input: 'guardian', canonical: 'parent_guardian' },
    { input: 'parent_guardian', canonical: 'parent_guardian' },
    { input: 'adult_player', canonical: 'player' },
    { input: 'player', canonical: 'player' },
    { input: 'parent_and_player', canonical: 'parent_and_player' },
    { input: 'staff', canonical: null },
    { input: 'invitation_only', canonical: null },
    { input: '', canonical: null },
    { input: null, canonical: null },
  ])
  await db.close()
})

test('Parent A, Parent B, and Adult Player resolve independently with canonical types', async () => {
  const db = await createDatabase()
  const result = await db.query(`
    select player_id, recipient_email, recipient_type, parent_link_id is not null as has_parent_link
    from public.event_player_eligible_recipients(
      '${ids.club}',
      '${ids.team}',
      array['${ids.playerParent}'::uuid, '${ids.playerAdult}'::uuid]
    )
    order by player_id, recipient_email
  `)

  assert.deepEqual(result.rows, [
    {
      player_id: ids.playerParent,
      recipient_email: 'parent-a@example.invalid',
      recipient_type: 'parent_guardian',
      has_parent_link: true,
    },
    {
      player_id: ids.playerParent,
      recipient_email: 'parent-b@example.invalid',
      recipient_type: 'parent_guardian',
      has_parent_link: true,
    },
    {
      player_id: ids.playerAdult,
      recipient_email: 'adult-player@example.invalid',
      recipient_type: 'player',
      has_parent_link: false,
    },
  ])
  await db.close()
})

test('no-recipient, invitation-only, and cross-Team paths fail closed', async () => {
  const db = await createDatabase()
  const result = await db.query(`
    select player_id
    from public.event_player_eligible_recipients(
      '${ids.club}',
      '${ids.team}',
      array['${ids.playerNoRecipient}'::uuid, '${ids.crossTeamPlayer}'::uuid]
    )
  `)

  assert.deepEqual(result.rows, [])
  await db.close()
})

test('table trigger canonicalizes approved aliases and rejects unknown direct values', async () => {
  const db = await createDatabase()
  await db.exec(`
    insert into public.calendar_event_invites(club_id, team_id, player_id, recipient_type) values
      ('${ids.club}', '${ids.team}', '${ids.playerParent}', 'parent'),
      ('${ids.club}', '${ids.team}', '${ids.playerAdult}', 'adult_player');
  `)
  const stored = await db.query('select recipient_type from public.calendar_event_invites order by recipient_type')
  assert.deepEqual(stored.rows, [
    { recipient_type: 'parent_guardian' },
    { recipient_type: 'player' },
  ])

  await assert.rejects(
    db.exec(`
      insert into public.calendar_event_invites(club_id, team_id, player_id, recipient_type)
      values ('${ids.club}', '${ids.team}', '${ids.playerNoRecipient}', 'staff')
    `),
    /Unsupported Calendar invitation recipient class/,
  )
  await assert.rejects(
    db.exec(`
      insert into public.calendar_event_invites(club_id, team_id, player_id, recipient_type)
      values ('${ids.club}', '${ids.team}', '${ids.playerNoRecipient}', null)
    `),
    /Unsupported Calendar invitation recipient class/,
  )
  await db.close()
})
