import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { test } from 'node:test'

import { PGlite } from '@electric-sql/pglite'

const migration = await readFile(
  new URL('../supabase/migrations/20260818153000_invite_notification_fanout_integrity.sql', import.meta.url),
  'utf8',
)
const publicReleaseMigration = await readFile(
  new URL('../supabase/migrations/20260819160000_public_release_contact_authority_74.sql', import.meta.url),
  'utf8',
)
const contactAuthorityMigration = publicReleaseMigration.split(
  'create or replace function public.get_parent_portal_invitation_state',
)[0]

const ids = {
  club: '10000000-0000-4000-8000-000000000001',
  team: '20000000-0000-4000-8000-000000000001',
  otherTeam: '20000000-0000-4000-8000-000000000002',
  parent: '30000000-0000-4000-8000-000000000001',
  secondParent: '30000000-0000-4000-8000-000000000002',
  player: '40000000-0000-4000-8000-000000000001',
  secondPlayer: '40000000-0000-4000-8000-000000000002',
  link: '50000000-0000-4000-8000-000000000001',
  secondLink: '50000000-0000-4000-8000-000000000002',
  room: '60000000-0000-4000-8000-000000000001',
  message: '70000000-0000-4000-8000-000000000001',
  poll: '80000000-0000-4000-8000-000000000001',
}

async function createDatabase() {
  const db = new PGlite()
  await db.exec(`
    create schema auth;
    create schema app_private;
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
    create table public.players (
      id uuid primary key,
      club_id uuid,
      team_id uuid,
      player_name text,
      parent_email text,
      parent_name text,
      parent_contacts jsonb not null default '[]'::jsonb,
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
      id uuid primary key,
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
    create table public.parent_mobile_notification_events (
      id uuid primary key default gen_random_uuid(),
      installation_id uuid,
      auth_user_id uuid not null,
      parent_link_id uuid not null,
      club_id uuid,
      team_id uuid,
      intent_type text not null,
      title text not null,
      body text not null,
      data jsonb not null default '{}'::jsonb,
      status text not null,
      sent_at timestamptz,
      created_at timestamptz not null default now(),
      read_at timestamptz,
      constraint parent_mobile_notification_events_intent_check
        check (intent_type in ('parent_message', 'parent_poll', 'matchday_update', 'parent_chat', 'resource_shared', 'poll_results'))
    );
    create table public.parent_communication_preferences (
      auth_user_id uuid primary key,
      communication_channel text not null default 'both'
    );
    create table public.parent_chat_rooms (
      id uuid primary key,
      club_id uuid not null,
      team_id uuid not null,
      room_type text not null,
      player_id uuid,
      match_day_id uuid,
      status text not null
    );
    create table public.parent_chat_messages (
      id uuid primary key,
      room_id uuid not null,
      sender_id uuid,
      deleted_at timestamptz
    );
    create table public.polls (
      id uuid primary key,
      club_id uuid not null,
      team_id uuid,
      title text not null,
      audience text not null,
      status text not null
    );
    create table public.match_day_player_squad_decisions (
      match_day_id uuid,
      club_id uuid,
      team_id uuid,
      player_id uuid,
      status text
    );

    create function public.canonical_calendar_invite_recipient_type(value text)
    returns text language sql immutable as $$
      select case value when 'parent' then 'parent_guardian' when 'adult_player' then 'player' end
    $$;
    create function app_private.parent_chat_parent_link_can_receive_notification(uuid, uuid, uuid)
    returns boolean language sql immutable as $$ select true $$;
  `)
  await db.exec(migration)
  await db.exec(contactAuthorityMigration)
  await db.exec(`
    insert into auth.users(id, email, raw_user_meta_data, email_confirmed_at) values
      ('${ids.parent}', 'parent@example.invalid', '{"display_name":"Parent"}', now()),
      ('${ids.secondParent}', 'second@example.invalid', '{"display_name":"Second Parent"}', now());
    insert into public.players(id, club_id, team_id, player_name, parent_email, parent_name, parent_contacts, contact_type, status) values
      ('${ids.player}', '${ids.club}', '${ids.otherTeam}', 'Canonical Player', 'parent@example.invalid', 'Parent', '[{"name":"Parent","email":"parent@example.invalid","type":"parent"}]', 'parent', 'active'),
      ('${ids.secondPlayer}', '${ids.club}', '${ids.team}', 'Wrong Team Player', 'second@example.invalid', 'Second Parent', '[{"name":"Second Parent","email":"second@example.invalid","type":"parent"}]', 'parent', 'active');
    insert into public.player_team_memberships(club_id, team_id, player_id, status) values
      ('${ids.club}', '${ids.team}', '${ids.player}', 'active'),
      ('${ids.club}', '${ids.otherTeam}', '${ids.secondPlayer}', 'active');
    insert into public.parent_player_links(id, club_id, team_id, player_id, auth_user_id, email, status) values
      ('${ids.link}', '${ids.club}', '${ids.team}', '${ids.player}', '${ids.parent}', 'parent@example.invalid', 'active'),
      ('${ids.secondLink}', '${ids.club}', '${ids.team}', '${ids.secondPlayer}', '${ids.secondParent}', 'second@example.invalid', 'active');
  `)
  return db
}

test('active Parent auth accounts resolve without a Coach profile and only from canonical Team membership', async () => {
  const db = await createDatabase()
  try {
    const result = await db.query(`
      select player_id, recipient_email, recipient_type, parent_link_id
      from public.event_player_eligible_recipients(
        '${ids.club}',
        '${ids.team}',
        array['${ids.player}'::uuid, '${ids.secondPlayer}'::uuid]
      )
    `)
    assert.deepEqual(result.rows, [{
      player_id: ids.player,
      recipient_email: 'parent@example.invalid',
      recipient_type: 'parent_guardian',
      parent_link_id: ids.link,
    }])
  } finally {
    await db.close()
  }
})

test('Player contacts still receive email when Parent app authority is unavailable', async () => {
  const blockedStates = [
    "email_confirmed_at = null",
    "banned_until = now() + interval '1 day'",
    "deleted_at = now()",
    "email = 'wrong@example.invalid'",
  ]
  for (const blockedState of blockedStates) {
    const db = await createDatabase()
    try {
      await db.exec(`update auth.users set ${blockedState} where id = '${ids.parent}'`)
      const result = await db.query(`
        select player_id, recipient_email, recipient_type, parent_link_id
        from public.event_player_eligible_recipients(
          '${ids.club}', '${ids.team}', array['${ids.player}'::uuid]
        )
      `)
      assert.deepEqual(result.rows, [{
        player_id: ids.player,
        recipient_email: 'parent@example.invalid',
        recipient_type: 'parent_guardian',
        parent_link_id: null,
      }])
    } finally {
      await db.close()
    }
  }
})

test('Parent Chat and Poll inbox events exist without any registered phone and remain idempotent', async () => {
  const db = await createDatabase()
  try {
    await db.exec(`
      insert into public.parent_chat_rooms(id, club_id, team_id, room_type, status)
      values ('${ids.room}', '${ids.club}', '${ids.team}', 'team', 'active');
      insert into public.parent_chat_messages(id, room_id)
      values ('${ids.message}', '${ids.room}');
      insert into public.polls(id, club_id, team_id, title, audience, status)
      values ('${ids.poll}', '${ids.club}', '${ids.team}', 'Question', 'parents', 'open');
    `)
    const result = await db.query(`
      select intent_type, parent_link_id, installation_id, data ->> 'route' as route, dedupe_key
      from public.parent_mobile_notification_events
      where parent_link_id = '${ids.link}'
      order by intent_type
    `)
    assert.deepEqual(result.rows, [
      {
        intent_type: 'parent_chat',
        parent_link_id: ids.link,
        installation_id: null,
        route: 'chat',
        dedupe_key: `parent_chat:${ids.link}:${ids.message}`,
      },
      {
        intent_type: 'parent_poll',
        parent_link_id: ids.link,
        installation_id: null,
        route: 'polls',
        dedupe_key: `parent_poll:${ids.link}:${ids.poll}`,
      },
    ])
  } finally {
    await db.close()
  }
})
