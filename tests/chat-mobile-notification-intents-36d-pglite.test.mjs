import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'
import { PGlite } from '@electric-sql/pglite'

const migrationUrl = new URL(
  '../supabase/migrations/20260810112645_chat_mobile_notification_intents_36d.sql',
  import.meta.url,
)

const id = {
  club: '10000000-0000-4000-8000-000000000001',
  clubB: '10000000-0000-4000-8000-000000000002',
  teamA: '20000000-0000-4000-8000-000000000001',
  teamB: '20000000-0000-4000-8000-000000000002',
  teamArchived: '20000000-0000-4000-8000-000000000003',
  playerA: '30000000-0000-4000-8000-000000000001',
  parentA: '40000000-0000-4000-8000-000000000001',
  parentB: '40000000-0000-4000-8000-000000000002',
  parentWrong: '40000000-0000-4000-8000-000000000003',
  coachA: '40000000-0000-4000-8000-000000000004',
  coachB: '40000000-0000-4000-8000-000000000005',
  coachRemoved: '40000000-0000-4000-8000-000000000006',
  parentLinkA: '50000000-0000-4000-8000-000000000001',
  parentLinkB: '50000000-0000-4000-8000-000000000002',
  parentLinkWrong: '50000000-0000-4000-8000-000000000003',
  parentInstallA: '60000000-0000-4000-8000-000000000001',
  parentInstallB: '60000000-0000-4000-8000-000000000002',
  parentInstallOff: '60000000-0000-4000-8000-000000000003',
  parentInstallWrong: '60000000-0000-4000-8000-000000000004',
  coachInstallA: '70000000-0000-4000-8000-000000000001',
  coachInstallB: '70000000-0000-4000-8000-000000000002',
  coachInstallOff: '70000000-0000-4000-8000-000000000003',
  coachInstallWrong: '70000000-0000-4000-8000-000000000004',
  coachInstallRemoved: '70000000-0000-4000-8000-000000000005',
  parentRoom: '80000000-0000-4000-8000-000000000001',
  staffConversation: '90000000-0000-4000-8000-000000000001',
}

async function createDatabase() {
  const db = new PGlite()
  const migration = await readFile(migrationUrl, 'utf8')

  await db.exec(`
    create role anon;
    create role authenticated;
    create role service_role;
    create schema app_private;
    revoke all on schema app_private from public, anon, authenticated, service_role;

    create table public.clubs (
      id uuid primary key,
      status text not null default 'active',
      archived_at timestamptz
    );
    create table public.users (
      id uuid primary key,
      club_id uuid,
      role text not null,
      role_rank integer not null,
      status text not null default 'active'
    );
    create table public.user_club_memberships (
      auth_user_id uuid not null,
      club_id uuid not null,
      role text not null,
      role_rank integer not null
    );
    create table public.teams (
      id uuid primary key,
      club_id uuid not null,
      status text not null default 'active',
      archived_at timestamptz
    );
    create table public.team_staff (
      id uuid primary key default gen_random_uuid(),
      user_id uuid not null,
      team_id uuid not null
    );
    create table public.players (
      id uuid primary key,
      club_id uuid not null,
      team_id uuid,
      status text not null default 'active'
    );
    create table public.parent_player_links (
      id uuid primary key,
      auth_user_id uuid not null,
      player_id uuid not null,
      club_id uuid not null,
      team_id uuid,
      status text not null default 'active'
    );
    create table public.match_day_player_squad_decisions (
      match_day_id uuid not null,
      club_id uuid not null,
      team_id uuid not null,
      player_id uuid not null,
      status text not null
    );
    create table public.parent_chat_rooms (
      id uuid primary key,
      club_id uuid not null,
      team_id uuid not null,
      player_id uuid,
      match_day_id uuid,
      room_type text not null,
      status text not null default 'active'
    );
    create table public.parent_chat_messages (
      id uuid primary key default gen_random_uuid(),
      room_id uuid not null,
      club_id uuid not null,
      sender_id uuid not null,
      body text not null,
      deleted_at timestamptz
    );
    create table public.staff_chat_conversations (
      id uuid primary key,
      club_id uuid not null,
      team_id uuid,
      type text not null
    );
    create table public.staff_chat_members (
      conversation_id uuid not null,
      club_id uuid not null,
      user_id uuid not null,
      archived_at timestamptz
    );
    create table public.staff_chat_messages (
      id uuid primary key default gen_random_uuid(),
      conversation_id uuid not null,
      club_id uuid not null,
      sender_id uuid not null,
      body text not null,
      deleted_at timestamptz
    );
    create table public.parent_mobile_push_installations (
      installation_id uuid primary key,
      auth_user_id uuid,
      parent_link_id uuid,
      club_id uuid,
      team_id uuid,
      expo_push_token text,
      detail_level text not null,
      enabled boolean not null,
      status text not null
    );
    create table public.coach_mobile_push_installations (
      installation_id uuid primary key,
      auth_user_id uuid,
      user_profile_id uuid,
      club_id uuid,
      team_id uuid,
      context_id text not null,
      app_role text not null,
      expo_push_token text,
      detail_level text not null,
      enabled boolean not null,
      status text not null
    );
    create table public.parent_mobile_notification_events (
      id bigint generated always as identity primary key,
      intent_type text not null,
      constraint parent_mobile_notification_events_intent_check
        check (intent_type in ('parent_message', 'parent_poll', 'matchday_update'))
    );
    create table public.coach_mobile_notification_events (
      id bigint generated always as identity primary key,
      intent_type text not null,
      constraint coach_mobile_notification_events_intent_check
        check (intent_type in ('coach_update', 'scorer_volunteer'))
    );

    create function public.parent_chat_staff_can_access_team(
      target_user_id uuid,
      target_club_id uuid,
      target_team_id uuid
    )
    returns boolean
    language sql
    stable
    security definer
    set search_path = ''
    as $$
      select exists (
        select 1
        from public.users profile
        join public.user_club_memberships membership
          on membership.auth_user_id = profile.id
         and membership.club_id = profile.club_id
         and membership.role = profile.role
         and membership.role_rank = profile.role_rank
        join public.team_staff assignment
          on assignment.user_id = profile.id
         and assignment.team_id = target_team_id
        join public.teams team
          on team.id = assignment.team_id
         and team.club_id = target_club_id
         and team.status = 'active'
         and team.archived_at is null
        join public.clubs club
          on club.id = team.club_id
         and club.status = 'active'
         and club.archived_at is null
        where profile.id = target_user_id
          and profile.club_id = target_club_id
          and profile.status = 'active'
          and profile.role not in ('parent_portal', 'super_admin')
      )
    $$;

    create function public.is_staff_chat_club_wide_staff(target_user_id uuid, target_club_id uuid)
    returns boolean
    language sql
    stable
    security definer
    set search_path = ''
    as $$
      select exists (
        select 1 from public.users profile
        where profile.id = target_user_id
          and profile.club_id = target_club_id
          and profile.status = 'active'
          and profile.role in ('admin', 'head_manager')
      )
    $$;
  `)

  await db.exec(migration)

  await db.exec(`
    insert into public.clubs (id) values ('${id.club}'), ('${id.clubB}');
    insert into public.teams (id, club_id, status, archived_at) values
      ('${id.teamA}', '${id.club}', 'active', null),
      ('${id.teamB}', '${id.club}', 'active', null),
      ('${id.teamArchived}', '${id.club}', 'archived', statement_timestamp());
    insert into public.players (id, club_id, team_id) values
      ('${id.playerA}', '${id.club}', '${id.teamA}');
    insert into public.users (id, club_id, role, role_rank) values
      ('${id.parentA}', '${id.club}', 'parent_portal', 0),
      ('${id.parentB}', '${id.club}', 'parent_portal', 0),
      ('${id.parentWrong}', '${id.club}', 'parent_portal', 0),
      ('${id.coachA}', '${id.club}', 'coach', 30),
      ('${id.coachB}', '${id.club}', 'coach', 30),
      ('${id.coachRemoved}', '${id.club}', 'coach', 30);
    insert into public.user_club_memberships (auth_user_id, club_id, role, role_rank)
    select id, club_id, role, role_rank from public.users;
    insert into public.team_staff (user_id, team_id) values
      ('${id.coachA}', '${id.teamA}'),
      ('${id.coachB}', '${id.teamA}');
    insert into public.parent_player_links (id, auth_user_id, player_id, club_id, team_id, status) values
      ('${id.parentLinkA}', '${id.parentA}', '${id.playerA}', '${id.club}', '${id.teamA}', 'active'),
      ('${id.parentLinkB}', '${id.parentB}', '${id.playerA}', '${id.club}', '${id.teamA}', 'active'),
      ('${id.parentLinkWrong}', '${id.parentWrong}', '${id.playerA}', '${id.club}', '${id.teamB}', 'active');
    insert into public.parent_chat_rooms (id, club_id, team_id, room_type, status) values
      ('${id.parentRoom}', '${id.club}', '${id.teamA}', 'team', 'active');
    insert into public.staff_chat_conversations (id, club_id, team_id, type) values
      ('${id.staffConversation}', '${id.club}', '${id.teamA}', 'team_staff');
    insert into public.staff_chat_members (conversation_id, club_id, user_id, archived_at) values
      ('${id.staffConversation}', '${id.club}', '${id.coachA}', null),
      ('${id.staffConversation}', '${id.club}', '${id.coachB}', null),
      ('${id.staffConversation}', '${id.club}', '${id.coachRemoved}', null);

    insert into public.parent_mobile_push_installations values
      ('${id.parentInstallA}', '${id.parentA}', '${id.parentLinkA}', '${id.club}', '${id.teamA}', 'ExpoPushToken[parent-a]', 'minimal', true, 'active'),
      ('${id.parentInstallB}', '${id.parentB}', '${id.parentLinkB}', '${id.club}', '${id.teamA}', 'ExpoPushToken[parent-b]', 'detailed', true, 'active'),
      ('${id.parentInstallOff}', '${id.parentB}', '${id.parentLinkB}', '${id.club}', '${id.teamA}', 'ExpoPushToken[parent-off]', 'minimal', false, 'active'),
      ('${id.parentInstallWrong}', '${id.parentWrong}', '${id.parentLinkWrong}', '${id.club}', '${id.teamB}', 'ExpoPushToken[parent-wrong]', 'minimal', true, 'active');
    insert into public.coach_mobile_push_installations values
      ('${id.coachInstallA}', '${id.coachA}', '${id.coachA}', '${id.club}', '${id.teamA}', 'team:${id.teamA}', 'coach', 'ExponentPushToken[coach-a]', 'minimal', true, 'active'),
      ('${id.coachInstallB}', '${id.coachB}', '${id.coachB}', '${id.club}', '${id.teamA}', 'team:${id.teamA}', 'coach', 'ExponentPushToken[coach-b]', 'detailed', true, 'active'),
      ('${id.coachInstallOff}', '${id.coachB}', '${id.coachB}', '${id.club}', '${id.teamA}', 'team:${id.teamA}', 'coach', 'ExponentPushToken[coach-off]', 'off', false, 'active'),
      ('${id.coachInstallWrong}', '${id.coachB}', '${id.coachB}', '${id.club}', '${id.teamB}', 'team:${id.teamB}', 'coach', 'ExponentPushToken[coach-wrong]', 'minimal', true, 'active'),
      ('${id.coachInstallRemoved}', '${id.coachRemoved}', '${id.coachRemoved}', '${id.club}', '${id.teamA}', 'team:${id.teamA}', 'coach', 'ExponentPushToken[coach-removed]', 'minimal', true, 'active');
  `)

  return db
}

test('canonical Chat inserts generate only exact authorised app intents', async () => {
  const db = await createDatabase()

  const parentMessage = await db.query(`
    insert into public.parent_chat_messages (room_id, club_id, sender_id, body)
    values ($1, $2, $3, 'Synthetic Parent Chat body')
    returning id
  `, [id.parentRoom, id.club, id.coachA])
  const parentMessageId = parentMessage.rows[0].id

  const parentIntents = await db.query(`
    select recipient_app, installation_id::text, auth_user_id::text
    from public.parent_chat_mobile_notification_intents
    where message_id = $1
    order by recipient_app, installation_id
  `, [parentMessageId])
  assert.deepEqual(parentIntents.rows, [
    { recipient_app: 'coach', installation_id: id.coachInstallB, auth_user_id: id.coachB },
    { recipient_app: 'parent', installation_id: id.parentInstallA, auth_user_id: id.parentA },
    { recipient_app: 'parent', installation_id: id.parentInstallB, auth_user_id: id.parentB },
  ])

  const staffMessage = await db.query(`
    insert into public.staff_chat_messages (conversation_id, club_id, sender_id, body)
    values ($1, $2, $3, 'Synthetic Staff Chat body')
    returning id
  `, [id.staffConversation, id.club, id.coachA])
  const staffIntents = await db.query(`
    select installation_id::text, auth_user_id::text
    from public.staff_chat_mobile_notification_intents
    where message_id = $1
    order by installation_id
  `, [staffMessage.rows[0].id])
  assert.deepEqual(staffIntents.rows, [
    { installation_id: id.coachInstallB, auth_user_id: id.coachB },
  ])

  const parentClaims = await db.query(`
    select recipient_app, installation_id::text, context_id
    from public.claim_parent_chat_mobile_notification_intents(50)
    order by recipient_app, installation_id
  `)
  assert.deepEqual(parentClaims.rows, [
    { recipient_app: 'coach', installation_id: id.coachInstallB, context_id: `team:${id.teamA}` },
    { recipient_app: 'parent', installation_id: id.parentInstallA, context_id: '' },
    { recipient_app: 'parent', installation_id: id.parentInstallB, context_id: '' },
  ])
  const staffClaims = await db.query(`
    select installation_id::text, context_id
    from public.claim_staff_chat_mobile_notification_intents(50)
  `)
  assert.deepEqual(staffClaims.rows, [
    { installation_id: id.coachInstallB, context_id: `team:${id.teamA}` },
  ])

  const intentColumns = await db.query(`
    select table_name, column_name
    from information_schema.columns
    where table_schema = 'public'
      and table_name in (
        'parent_chat_mobile_notification_intents',
        'staff_chat_mobile_notification_intents'
      )
      and column_name in ('body', 'message_body', 'preview')
  `)
  assert.deepEqual(intentColumns.rows, [])

  await db.close()
})

test('claim revalidates removed authority, sender exclusion, Off, and active context', async () => {
  const db = await createDatabase()

  await db.query(`
    insert into public.parent_chat_messages (room_id, club_id, sender_id, body)
    values ($1, $2, $3, 'Synthetic stale Parent Chat body')
  `, [id.parentRoom, id.club, id.coachA])
  await db.query(`
    insert into public.staff_chat_messages (conversation_id, club_id, sender_id, body)
    values ($1, $2, $3, 'Synthetic stale Staff Chat body')
  `, [id.staffConversation, id.club, id.coachA])

  await db.query(`update public.parent_player_links set status = 'revoked' where id = $1`, [id.parentLinkB])
  await db.query(`delete from public.team_staff where user_id = $1 and team_id = $2`, [id.coachB, id.teamA])

  const parentClaims = await db.query(`
    select recipient_app, installation_id::text
    from public.claim_parent_chat_mobile_notification_intents(50)
    order by recipient_app, installation_id
  `)
  assert.deepEqual(parentClaims.rows, [
    { recipient_app: 'parent', installation_id: id.parentInstallA },
  ])
  const staffClaims = await db.query(`select * from public.claim_staff_chat_mobile_notification_intents(50)`)
  assert.deepEqual(staffClaims.rows, [])

  const skipped = await db.query(`
    select
      (select count(*)::int from public.parent_chat_mobile_notification_intents where status = 'skipped') as parent_skipped,
      (select count(*)::int from public.staff_chat_mobile_notification_intents where status = 'skipped') as staff_skipped
  `)
  assert.deepEqual(skipped.rows[0], { parent_skipped: 2, staff_skipped: 1 })

  const privileges = await db.query(`
    select
      has_function_privilege('authenticated', 'public.claim_parent_chat_mobile_notification_intents(integer)', 'execute') as auth_parent,
      has_function_privilege('authenticated', 'public.claim_staff_chat_mobile_notification_intents(integer)', 'execute') as auth_staff,
      has_function_privilege('service_role', 'public.claim_parent_chat_mobile_notification_intents(integer)', 'execute') as service_parent,
      has_function_privilege('service_role', 'public.claim_staff_chat_mobile_notification_intents(integer)', 'execute') as service_staff
  `)
  assert.deepEqual(privileges.rows[0], {
    auth_parent: false,
    auth_staff: false,
    service_parent: true,
    service_staff: true,
  })

  await db.close()
})
