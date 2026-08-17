import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'
import { PGlite } from '@electric-sql/pglite'

test('Parent Poll outbox is scoped to active Team families and Formation Boards allow Player sharing', async () => {
  const migration = await readFile(new URL('../supabase/migrations/20260817055249_mobile_feedback_corrective_61.sql', import.meta.url), 'utf8')
  const db = new PGlite()
  await db.exec(`
    create role anon;
    create role authenticated;
    create role service_role;
    create schema auth;
    create schema app_private;
    create table auth.users (id uuid primary key);
    create table public.clubs (id uuid primary key);
    create table public.teams (id uuid primary key, club_id uuid references public.clubs(id));
    create table public.players (id uuid primary key);
    create table public.parent_player_links (
      id uuid primary key,
      auth_user_id uuid references auth.users(id),
      club_id uuid references public.clubs(id),
      team_id uuid references public.teams(id),
      player_id uuid references public.players(id),
      status text not null
    );
    create table public.polls (
      id uuid primary key,
      club_id uuid not null references public.clubs(id),
      team_id uuid references public.teams(id),
      audience text not null,
      status text not null,
      closes_at timestamptz
    );
    create table public.parent_mobile_push_installations (
      installation_id uuid primary key,
      auth_user_id uuid references auth.users(id),
      parent_link_id uuid references public.parent_player_links(id),
      club_id uuid references public.clubs(id),
      team_id uuid references public.teams(id),
      expo_push_token text,
      detail_level text not null,
      enabled boolean not null,
      status text not null
    );
    create table public.formation_board_publications (resource_id uuid primary key);
    create table public.resource_library_links (
      id uuid primary key default gen_random_uuid(),
      resource_id uuid not null,
      linked_type text not null,
      removed_at timestamptz
    );
  `)
  await db.exec(migration)
  await db.exec(`
    insert into public.clubs values ('11111111-1111-4111-8111-111111111111');
    insert into public.teams values
      ('22222222-2222-4222-8222-222222222222', '11111111-1111-4111-8111-111111111111'),
      ('33333333-3333-4333-8333-333333333333', '11111111-1111-4111-8111-111111111111');
    insert into public.players values
      ('44444444-4444-4444-8444-444444444444'),
      ('55555555-5555-4555-8555-555555555555');
    insert into auth.users values
      ('66666666-6666-4666-8666-666666666666'),
      ('77777777-7777-4777-8777-777777777777');
    insert into public.parent_player_links values
      ('88888888-8888-4888-8888-888888888888', '66666666-6666-4666-8666-666666666666', '11111111-1111-4111-8111-111111111111', '22222222-2222-4222-8222-222222222222', '44444444-4444-4444-8444-444444444444', 'active'),
      ('99999999-9999-4999-8999-999999999999', '77777777-7777-4777-8777-777777777777', '11111111-1111-4111-8111-111111111111', '33333333-3333-4333-8333-333333333333', '55555555-5555-4555-8555-555555555555', 'active');
    insert into public.parent_mobile_push_installations values
      ('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', '66666666-6666-4666-8666-666666666666', '88888888-8888-4888-8888-888888888888', '11111111-1111-4111-8111-111111111111', '22222222-2222-4222-8222-222222222222', 'ExpoPushToken[test]', 'minimal', true, 'active'),
      ('bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb', '77777777-7777-4777-8777-777777777777', '99999999-9999-4999-8999-999999999999', '11111111-1111-4111-8111-111111111111', '33333333-3333-4333-8333-333333333333', 'ExpoPushToken[wrong-team]', 'minimal', true, 'active');
    insert into public.polls values ('cccccccc-cccc-4ccc-8ccc-cccccccccccc', '11111111-1111-4111-8111-111111111111', '22222222-2222-4222-8222-222222222222', 'parents', 'open', null);
  `)
  const intents = await db.query('select installation_id, parent_link_id, team_id, status from public.parent_poll_mobile_notification_intents')
  assert.deepEqual(intents.rows, [{
    installation_id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
    parent_link_id: '88888888-8888-4888-8888-888888888888',
    team_id: '22222222-2222-4222-8222-222222222222',
    status: 'pending',
  }])

  const claimed = await db.query('select recipient_app, installation_id, parent_link_id, poll_id from public.claim_parent_poll_mobile_notification_intents(50)')
  assert.deepEqual(claimed.rows, [{
    recipient_app: 'parent',
    installation_id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
    parent_link_id: '88888888-8888-4888-8888-888888888888',
    poll_id: 'cccccccc-cccc-4ccc-8ccc-cccccccccccc',
  }])

  await db.exec(`
    insert into public.formation_board_publications values ('dddddddd-dddd-4ddd-8ddd-dddddddddddd');
    insert into public.resource_library_links (resource_id, linked_type) values ('dddddddd-dddd-4ddd-8ddd-dddddddddddd', 'player');
  `)
  await assert.rejects(
    db.exec("insert into public.resource_library_links (resource_id, linked_type) values ('dddddddd-dddd-4ddd-8ddd-dddddddddddd', 'team')"),
    /formation_board_resource_assignment_forbidden/,
  )
  await db.close()
})
