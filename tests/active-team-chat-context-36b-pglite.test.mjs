import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'
import { PGlite } from '@electric-sql/pglite'

const migrationUrl = new URL(
  '../supabase/migrations/20260810110534_active_team_chat_context_36b.sql',
  import.meta.url,
)
const reliabilityMigrationUrl = new URL(
  '../supabase/migrations/20260814143539_mobile_chat_reliability_58.sql',
  import.meta.url,
)

const ids = {
  actor: '10000000-0000-4000-8000-000000000001',
  clubAdmin: '10000000-0000-4000-8000-000000000002',
  parent: '10000000-0000-4000-8000-000000000003',
  platform: '10000000-0000-4000-8000-000000000004',
  club: '20000000-0000-4000-8000-000000000001',
  teamA: '30000000-0000-4000-8000-000000000001',
  teamB: '30000000-0000-4000-8000-000000000002',
  teamC: '30000000-0000-4000-8000-000000000003',
  teamArchived: '30000000-0000-4000-8000-000000000004',
  parentRoomA: '40000000-0000-4000-8000-000000000001',
  parentRoomB: '40000000-0000-4000-8000-000000000002',
  parentRoomArchived: '40000000-0000-4000-8000-000000000003',
  staffTeamA: '50000000-0000-4000-8000-000000000001',
  staffTeamB: '50000000-0000-4000-8000-000000000002',
  staffPlayerB: '50000000-0000-4000-8000-000000000003',
  staffClub: '50000000-0000-4000-8000-000000000004',
  staffDirect: '50000000-0000-4000-8000-000000000005',
}

async function setActor(db, actorId) {
  await db.query(`select set_config('request.jwt.claims', $1, false)`, [
    JSON.stringify({ sub: actorId }),
  ])
}

async function createDatabase() {
  const db = new PGlite()
  const migration = await readFile(migrationUrl, 'utf8')
  const reliabilityMigration = await readFile(reliabilityMigrationUrl, 'utf8')

  await db.exec(`
    create role anon;
    create role authenticated;
    create role service_role;
    create schema auth;

    create function auth.uid()
    returns uuid
    language sql
    stable
    as $$
      select (nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'sub')::uuid
    $$;

    create function auth.jwt()
    returns jsonb
    language sql
    stable
    as $$
      select coalesce(nullif(current_setting('request.jwt.claims', true), '')::jsonb, '{}'::jsonb)
    $$;

    create table public.clubs (
      id uuid primary key,
      status text not null default 'active',
      archived_at timestamptz
    );

    create table public.users (
      id uuid primary key,
      club_id uuid,
      display_name text not null default 'Staff',
      name text not null default 'Staff',
      status text not null default 'active',
      role text not null,
      role_label text not null default 'Coach',
      role_rank integer not null
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
      user_id uuid not null,
      team_id uuid not null
    );

    create table public.parent_chat_rooms (
      id uuid primary key,
      room_type text not null default 'team',
      status text not null default 'active',
      title text not null default '',
      club_id uuid not null,
      team_id uuid not null,
      player_id uuid,
      match_day_id uuid,
      updated_at timestamptz not null default statement_timestamp(),
      created_at timestamptz not null default statement_timestamp()
    );

    create table public.parent_chat_messages (
      id uuid primary key default gen_random_uuid(),
      room_id uuid not null,
      club_id uuid not null,
      sender_id uuid not null,
      sender_kind text not null default 'staff',
      sender_name text not null default 'Staff',
      sender_role text not null default 'Coach',
      body text not null,
      deleted_at timestamptz,
      created_at timestamptz not null default statement_timestamp(),
      updated_at timestamptz not null default statement_timestamp()
    );

    create table public.parent_chat_memberships (
      room_id uuid not null,
      club_id uuid not null,
      auth_user_id uuid not null,
      member_kind text not null,
      active boolean not null default true,
      last_read_at timestamptz,
      left_at timestamptz,
      updated_at timestamptz not null default statement_timestamp(),
      unique (room_id, auth_user_id)
    );

    create table public.staff_chat_conversations (
      id uuid primary key default gen_random_uuid(),
      club_id uuid not null,
      team_id uuid,
      type text not null,
      title text not null default '',
      last_message_at timestamptz,
      updated_at timestamptz not null default statement_timestamp()
    );

    create table public.staff_chat_members (
      conversation_id uuid not null,
      club_id uuid not null,
      user_id uuid not null,
      archived_at timestamptz,
      last_read_at timestamptz,
      unique (conversation_id, user_id)
    );

    create table public.staff_chat_messages (
      id uuid primary key default gen_random_uuid(),
      conversation_id uuid not null,
      club_id uuid not null,
      sender_id uuid not null,
      body text not null,
      deleted_at timestamptz,
      deleted_by uuid,
      created_at timestamptz not null default statement_timestamp(),
      updated_at timestamptz not null default statement_timestamp()
    );

    grant select, insert, update on public.staff_chat_messages to authenticated;

    create function public.current_user_club_id()
    returns uuid
    language sql
    stable
    as $$
      select club_id from public.users where id = (select auth.uid())
    $$;

    create function public.parent_chat_staff_can_access_team(
      target_user_id uuid,
      target_club_id uuid,
      target_team_id uuid
    )
    returns boolean
    language sql
    stable
    security definer
    set search_path = pg_catalog, public
    as $$
      select exists (
        select 1
        from public.users staff
        join public.user_club_memberships membership
          on membership.auth_user_id = staff.id
         and membership.club_id = staff.club_id
         and membership.role = staff.role
         and membership.role_rank = staff.role_rank
        join public.team_staff assignment
          on assignment.user_id = staff.id
         and assignment.team_id = target_team_id
        join public.teams team
          on team.id = assignment.team_id
         and team.club_id = target_club_id
         and team.archived_at is null
         and team.status = 'active'
        join public.clubs club
          on club.id = team.club_id
         and club.archived_at is null
         and club.status = 'active'
        where staff.id = target_user_id
          and staff.club_id = target_club_id
          and staff.status = 'active'
          and staff.role not in ('parent_portal', 'super_admin')
          and staff.role_rank >= 20
      )
    $$;

    create function public.parent_chat_user_can_post_room(
      target_room_id uuid,
      target_user_id uuid
    )
    returns boolean
    language sql
    stable
    as $$
      select exists (
        select 1
        from public.parent_chat_rooms room
        where room.id = target_room_id
          and public.parent_chat_staff_can_access_team(
            target_user_id,
            room.club_id,
            room.team_id
          )
      )
    $$;

    create function public.staff_chat_user_can_access_team(
      target_user_id uuid,
      target_team_id uuid,
      target_club_id uuid
    )
    returns boolean
    language sql
    stable
    as $$
      select public.parent_chat_staff_can_access_team(
        target_user_id,
        target_club_id,
        target_team_id
      )
    $$;

    create function public.current_user_can_use_staff_chat(target_club_id uuid)
    returns boolean
    language sql
    stable
    as $$
      select exists (
        select 1
        from public.users actor
        join public.user_club_memberships membership
          on membership.auth_user_id = actor.id
         and membership.club_id = actor.club_id
         and membership.role = actor.role
         and membership.role_rank = actor.role_rank
        where actor.id = (select auth.uid())
          and actor.club_id = target_club_id
          and actor.status = 'active'
          and actor.role not in ('parent_portal', 'super_admin')
          and actor.role_rank >= 20
      )
    $$;

    create function public.can_read_staff_chat_conversation(target_conversation_id uuid)
    returns boolean
    language sql
    stable
    as $$
      select exists (
        select 1
        from public.staff_chat_conversations conversation
        join public.staff_chat_members membership
          on membership.conversation_id = conversation.id
         and membership.user_id = (select auth.uid())
         and membership.archived_at is null
        where conversation.id = target_conversation_id
          and conversation.club_id = public.current_user_club_id()
          and public.current_user_can_use_staff_chat(conversation.club_id)
          and (
            conversation.type in ('club_staff', 'group', 'direct')
            or public.staff_chat_user_can_access_team(
              (select auth.uid()),
              conversation.team_id,
              conversation.club_id
            )
          )
      )
    $$;

    create function public.get_parent_chat_rooms()
    returns table (
      id uuid, room_type text, status text, title text, club_id uuid, club_name text,
      team_id uuid, team_name text, player_id uuid, player_name text, match_day_id uuid,
      opponent text, match_date date, kickoff_time time, kickoff_time_tbc boolean,
      meet_time time, venue_name text, fixture_status text, child_names text[],
      latest_message text, latest_message_at timestamptz, unread_count bigint, can_post boolean
    )
    language sql
    security definer
    as $$
      select
        room.id, room.room_type, room.status, room.title, room.club_id, 'Club',
        room.team_id, 'Team', room.player_id, '', room.match_day_id, '', null::date,
        null::time, false, null::time, '', '', '{}'::text[], '', null::timestamptz,
        0::bigint, true
      from public.parent_chat_rooms room
      where public.parent_chat_staff_can_access_team(
        (select auth.uid()), room.club_id, room.team_id
      )
    $$;

    create function public.get_parent_chat_messages(target_room_id uuid)
    returns table (
      id uuid, room_id uuid, sender_id uuid, sender_kind text, sender_name text,
      sender_role text, body text, deleted_at timestamptz, created_at timestamptz,
      updated_at timestamptz, can_delete boolean
    )
    language sql
    security definer
    as $$
      select message.id, message.room_id, message.sender_id, message.sender_kind,
        message.sender_name, message.sender_role, message.body, message.deleted_at,
        message.created_at, message.updated_at, true
      from public.parent_chat_messages message
      where message.room_id = target_room_id
    $$;

    create function public.send_parent_chat_message(target_room_id uuid, body_value text)
    returns uuid
    language plpgsql
    security definer
    as $$
    declare new_id uuid;
    begin
      insert into public.parent_chat_messages(room_id, club_id, sender_id, body)
      select target_room_id, room.club_id, (select auth.uid()), body_value
      from public.parent_chat_rooms room where room.id = target_room_id
      returning id into new_id;
      return new_id;
    end
    $$;

    create function public.mark_parent_chat_room_read(target_room_id uuid)
    returns timestamptz language sql security definer as $$ select statement_timestamp() $$;

    create function public.delete_parent_chat_message(target_message_id uuid)
    returns void language sql security definer as $$
      update public.parent_chat_messages set deleted_at = statement_timestamp()
      where id = target_message_id
    $$;

    create function public.create_staff_chat_conversation(
      conversation_type text,
      title_value text default '',
      team_id_value uuid default null,
      member_ids uuid[] default '{}'::uuid[]
    )
    returns uuid
    language plpgsql
    security definer
    as $$
    declare new_id uuid;
    begin
      insert into public.staff_chat_conversations(club_id, team_id, type, title)
      values (public.current_user_club_id(), team_id_value, conversation_type, title_value)
      returning id into new_id;
      insert into public.staff_chat_members(conversation_id, club_id, user_id)
      values (new_id, public.current_user_club_id(), (select auth.uid()));
      return new_id;
    end
    $$;

    create function public.mark_staff_chat_conversation_read(conversation_id_value uuid)
    returns void language sql security definer as $$
      update public.staff_chat_members set last_read_at = statement_timestamp()
      where conversation_id = conversation_id_value and user_id = (select auth.uid())
    $$;

    create function public.archive_staff_chat_conversation(conversation_id_value uuid)
    returns void language sql security definer as $$
      update public.staff_chat_members set archived_at = statement_timestamp()
      where conversation_id = conversation_id_value and user_id = (select auth.uid())
    $$;

    create function public.delete_staff_chat_message(message_id_value uuid)
    returns void language sql security definer as $$
      update public.staff_chat_messages
      set deleted_at = statement_timestamp(), deleted_by = (select auth.uid())
      where id = message_id_value
    $$;
  `)

  await db.query(`insert into public.clubs(id) values ($1)`, [ids.club])
  await db.query(`
    insert into public.users(id, club_id, role, role_rank)
    values
      ($1, $5, 'coach', 30),
      ($2, $5, 'admin', 90),
      ($3, $5, 'parent_portal', 10),
      ($4, null, 'super_admin', 100)
  `, [ids.actor, ids.clubAdmin, ids.parent, ids.platform, ids.club])
  await db.query(`
    insert into public.user_club_memberships(auth_user_id, club_id, role, role_rank)
    values ($1, $3, 'coach', 30), ($2, $3, 'admin', 90)
  `, [ids.actor, ids.clubAdmin, ids.club])
  await db.query(`
    insert into public.teams(id, club_id, status, archived_at)
    values
      ($1, $5, 'active', null),
      ($2, $5, 'active', null),
      ($3, $5, 'active', null),
      ($4, $5, 'archived', statement_timestamp())
  `, [ids.teamA, ids.teamB, ids.teamC, ids.teamArchived, ids.club])
  await db.query(`
    insert into public.team_staff(user_id, team_id)
    values ($1, $2), ($1, $3), ($1, $4)
  `, [ids.actor, ids.teamA, ids.teamB, ids.teamArchived])
  await db.query(`
    insert into public.parent_chat_rooms(id, club_id, team_id, title)
    values ($1, $4, $5, 'A'), ($2, $4, $6, 'B'), ($3, $4, $7, 'Archived')
  `, [ids.parentRoomA, ids.parentRoomB, ids.parentRoomArchived, ids.club, ids.teamA, ids.teamB, ids.teamArchived])
  await db.query(`
    insert into public.staff_chat_conversations(id, club_id, team_id, type, title)
    values
      ($1, $6, $7, 'team_staff', 'A'),
      ($2, $6, $8, 'team_staff', 'B'),
      ($3, $6, $8, 'player_staff', 'Player B'),
      ($4, $6, null, 'club_staff', 'Club'),
      ($5, $6, null, 'direct', 'Direct')
  `, [ids.staffTeamA, ids.staffTeamB, ids.staffPlayerB, ids.staffClub, ids.staffDirect, ids.club, ids.teamA, ids.teamB])
  await db.query(`
    insert into public.staff_chat_members(conversation_id, club_id, user_id)
    select id, club_id, $1 from public.staff_chat_conversations
  `, [ids.actor])

  await db.exec(migration)
  await db.exec(`set check_function_bodies = off`)
  await db.exec(reliabilityMigration)
  await db.exec(`set check_function_bodies = on`)
  return db
}

test('staff-side Parent Chat enumerates and operates only the active assigned Team', async () => {
  const db = await createDatabase()
  await setActor(db, ids.actor)

  const teamA = await db.query(`select id from public.get_parent_chat_rooms($1)`, [ids.teamA])
  assert.deepEqual(teamA.rows.map((row) => row.id), [ids.parentRoomA])

  const teamB = await db.query(`select id from public.get_parent_chat_rooms($1)`, [ids.teamB])
  assert.deepEqual(teamB.rows.map((row) => row.id), [ids.parentRoomB])

  await assert.rejects(
    db.query(`select * from public.get_parent_chat_messages($1, $2)`, [ids.parentRoomB, ids.teamA]),
    /not available in the active Team/,
  )
  await assert.rejects(
    db.query(`select id from public.get_parent_chat_rooms($1)`, [ids.teamC]),
    /active Team is not available/,
  )
  await assert.rejects(
    db.query(`select id from public.get_parent_chat_rooms($1)`, [ids.teamArchived]),
    /active Team is not available/,
  )

  await setActor(db, ids.clubAdmin)
  await assert.rejects(
    db.query(`select id from public.get_parent_chat_rooms($1)`, [ids.teamA]),
    /active Team is not available/,
  )

  await setActor(db, ids.parent)
  await assert.rejects(
    db.query(`select id from public.get_parent_chat_rooms($1)`, [ids.teamA]),
    /active Team is not available/,
  )

  await setActor(db, ids.platform)
  await assert.rejects(
    db.query(`select id from public.get_parent_chat_rooms($1)`, [ids.teamA]),
    /active Team is not available/,
  )

  await db.close()
})

test('Staff Chat list, detail, create and send use one validated active Team', async () => {
  const db = await createDatabase()
  await setActor(db, ids.actor)

  const teamA = await db.query(`select id from public.get_staff_chat_conversation_ids($1)`, [ids.teamA])
  assert.deepEqual(teamA.rows.map((row) => row.id).sort(), [
    ids.staffClub,
    ids.staffDirect,
    ids.staffTeamA,
  ].sort())

  const teamB = await db.query(`select id from public.get_staff_chat_conversation_ids($1)`, [ids.teamB])
  assert.deepEqual(teamB.rows.map((row) => row.id).sort(), [
    ids.staffClub,
    ids.staffDirect,
    ids.staffPlayerB,
    ids.staffTeamB,
  ].sort())

  const wrongDetail = await db.query(
    `select public.staff_chat_conversation_in_active_context($1, $2) as allowed`,
    [ids.staffTeamB, ids.teamA],
  )
  assert.equal(wrongDetail.rows[0].allowed, false)

  await assert.rejects(
    db.query(`select public.send_staff_chat_message($1, 'blocked', $2)`, [ids.staffTeamB, ids.teamA]),
    /not available in the active Team/,
  )

  const sent = await db.query(
    `select public.send_staff_chat_message($1, 'allowed', $2) as id`,
    [ids.staffTeamA, ids.teamA],
  )
  assert.ok(sent.rows[0].id)

  await assert.rejects(
    db.query(
      `select public.create_staff_chat_conversation('team_staff', 'forged', $1, '{}'::uuid[], $2)`,
      [ids.teamB, ids.teamA],
    ),
    /must use the active authorised Team/,
  )

  const created = await db.query(
    `select public.create_staff_chat_conversation('team_staff', 'A2', $1, '{}'::uuid[], $1) as id`,
    [ids.teamA],
  )
  assert.ok(created.rows[0].id)

  const privileges = await db.query(`
    select
      has_table_privilege('authenticated', 'public.staff_chat_messages', 'INSERT') as can_insert,
      has_table_privilege('authenticated', 'public.staff_chat_messages', 'UPDATE') as can_update
  `)
  assert.equal(privileges.rows[0].can_insert, false)
  assert.equal(privileges.rows[0].can_update, false)

  await db.query(`delete from public.team_staff where user_id = $1 and team_id = $2`, [ids.actor, ids.teamA])
  await assert.rejects(
    db.query(`select id from public.get_staff_chat_conversation_ids($1)`, [ids.teamA]),
    /active Team is not available/,
  )

  await db.close()
})

test('mobile Chat retry identities return one Parent Chat and Staff Chat message', async () => {
  const db = await createDatabase()
  await setActor(db, ids.actor)

  const parentRequest = '70000000-0000-4000-8000-000000000001'
  const firstParent = await db.query(
    `select public.send_parent_chat_message($1, 'parent retry', $2, $3) as id`,
    [ids.parentRoomA, ids.teamA, parentRequest],
  )
  const secondParent = await db.query(
    `select public.send_parent_chat_message($1, 'parent retry', $2, $3) as id`,
    [ids.parentRoomA, ids.teamA, parentRequest],
  )
  assert.equal(secondParent.rows[0].id, firstParent.rows[0].id)
  const parentCount = await db.query(
    `select count(*)::int as count from public.parent_chat_messages where client_request_id = $1`,
    [parentRequest],
  )
  assert.equal(parentCount.rows[0].count, 1)
  await assert.rejects(
    db.query(
      `select public.send_parent_chat_message($1, 'changed body', $2, $3)`,
      [ids.parentRoomA, ids.teamA, parentRequest],
    ),
    /request identity has already been used/,
  )

  const staffRequest = '70000000-0000-4000-8000-000000000002'
  const firstStaff = await db.query(
    `select public.send_staff_chat_message($1, 'staff retry', $2, $3) as id`,
    [ids.staffTeamA, ids.teamA, staffRequest],
  )
  const secondStaff = await db.query(
    `select public.send_staff_chat_message($1, 'staff retry', $2, $3) as id`,
    [ids.staffTeamA, ids.teamA, staffRequest],
  )
  assert.equal(secondStaff.rows[0].id, firstStaff.rows[0].id)
  const staffCount = await db.query(
    `select count(*)::int as count from public.staff_chat_messages where client_request_id = $1`,
    [staffRequest],
  )
  assert.equal(staffCount.rows[0].count, 1)

  await db.close()
})

test('web clients pass active Team server context and clear stale lists on switch', async () => {
  const [parentDomain, staffDomain, workspace, page] = await Promise.all([
    readFile(new URL('../src/lib/domain/parent-chat.js', import.meta.url), 'utf8'),
    readFile(new URL('../src/lib/domain/staff-chat.js', import.meta.url), 'utf8'),
    readFile(new URL('../src/components/chat/ParentChatWorkspace.jsx', import.meta.url), 'utf8'),
    readFile(new URL('../src/pages/StaffChatPage.jsx', import.meta.url), 'utf8'),
  ])

  assert.match(parentDomain, /active_team_id_value: normalizedScope\.activeTeamId/)
  assert.match(staffDomain, /get_staff_chat_conversation_ids/)
  assert.match(staffDomain, /staff_chat_conversation_in_active_context/)
  assert.doesNotMatch(staffDomain, /Number\(user\?\.roleRank[\s\S]*conversation\.teamId/)
  assert.match(workspace, /activeTeamId: variant === 'staff' \? user\?\.activeTeamId : ''/)
  assert.match(page, /loadRequestIdRef\.current \+= 1[\s\S]*setConversations\(\[\]\)[\s\S]*setMessages\(\[\]\)/)
})
