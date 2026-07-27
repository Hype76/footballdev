import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'
import { PGlite } from '@electric-sql/pglite'

const migrationUrl = new URL('../supabase/migrations/20260727182658_parent_chat_child_filter.sql', import.meta.url)
const legacyMigrationUrl = new URL('../supabase/migrations/20260714120000_parent_portal_chat_v1.sql', import.meta.url)

const ids = {
  club: '10000000-0000-4000-8000-000000000001',
  otherClub: '10000000-0000-4000-8000-000000000002',
  team: '20000000-0000-4000-8000-000000000001',
  otherTeam: '20000000-0000-4000-8000-000000000002',
  multiRole: '30000000-0000-4000-8000-000000000001',
  sameEmailOtherAuth: '30000000-0000-4000-8000-000000000002',
  parentOnly: '30000000-0000-4000-8000-000000000003',
  inactiveStaff: '30000000-0000-4000-8000-000000000004',
  playerA: '40000000-0000-4000-8000-000000000001',
  playerB: '40000000-0000-4000-8000-000000000002',
  playerOther: '40000000-0000-4000-8000-000000000003',
  playerParentOnly: '40000000-0000-4000-8000-000000000004',
  linkA: '50000000-0000-4000-8000-000000000001',
  linkB: '50000000-0000-4000-8000-000000000002',
  linkOther: '50000000-0000-4000-8000-000000000003',
  linkParentOnly: '50000000-0000-4000-8000-000000000004',
  directA: '60000000-0000-4000-8000-000000000001',
  directB: '60000000-0000-4000-8000-000000000002',
  directOther: '60000000-0000-4000-8000-000000000003',
  teamRoom: '60000000-0000-4000-8000-000000000004',
  selectedMatchRoom: '60000000-0000-4000-8000-000000000005',
  unrelatedMatchRoom: '60000000-0000-4000-8000-000000000006',
  wrongTeamRoom: '60000000-0000-4000-8000-000000000007',
  selectedMatch: '70000000-0000-4000-8000-000000000001',
  unrelatedMatch: '70000000-0000-4000-8000-000000000002',
}

function extractFunction(source, name) {
  const start = source.indexOf(`create or replace function public.${name}`)
  const nextFunction = source.indexOf('\ncreate or replace function public.', start + 1)
  const nextRevoke = source.indexOf('\nrevoke ', start)
  const candidates = [nextFunction, nextRevoke].filter((value) => value > start)
  const end = Math.min(...candidates)
  assert.ok(start >= 0, `${name} starts`)
  assert.ok(end > start, `${name} ends`)
  return source.slice(start, end)
}

async function setClaims(db, userId) {
  await db.query(`select set_config('request.jwt.claims', $1, false)`, [
    JSON.stringify({ sub: userId, email: 'shared@example.invalid' }),
  ])
}

async function createDatabase() {
  const db = new PGlite()
  const [legacyMigration, migration] = await Promise.all([
    readFile(legacyMigrationUrl, 'utf8'),
    readFile(migrationUrl, 'utf8'),
  ])

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

    create table public.users (
      id uuid primary key,
      club_id uuid not null,
      status text not null default 'active',
      role text not null,
      role_rank integer not null default 0
    );

    create table public.teams (
      id uuid primary key,
      club_id uuid not null
    );

    create table public.team_staff (
      user_id uuid not null,
      team_id uuid not null
    );

    create table public.players (
      id uuid primary key,
      club_id uuid not null,
      team_id uuid,
      player_name text not null,
      status text not null default 'active',
      archived_at timestamptz
    );

    create table public.parent_player_links (
      id uuid primary key,
      club_id uuid not null,
      team_id uuid,
      player_id uuid not null,
      auth_user_id uuid,
      status text not null default 'pending'
    );

    create table public.parent_chat_rooms (
      id uuid primary key,
      club_id uuid not null,
      team_id uuid not null,
      player_id uuid,
      match_day_id uuid,
      room_type text not null,
      status text not null default 'active',
      title text not null default ''
    );

    create table public.match_day_player_squad_decisions (
      match_day_id uuid not null,
      club_id uuid not null,
      team_id uuid not null,
      player_id uuid not null,
      status text not null
    );

    create table public.parent_chat_messages (
      id uuid primary key default gen_random_uuid(),
      room_id uuid not null,
      sender_id uuid not null,
      deleted_at timestamptz,
      created_at timestamptz not null default statement_timestamp()
    );

    create table public.parent_portal_view_states (
      id uuid primary key default gen_random_uuid(),
      auth_user_id uuid not null,
      parent_link_id uuid,
      player_id uuid,
      scope_type text not null,
      category_key text not null,
      last_viewed_at timestamptz not null,
      created_at timestamptz not null default statement_timestamp(),
      updated_at timestamptz not null default statement_timestamp(),
      constraint parent_portal_view_states_scope_identity_check check (
        (
          scope_type = 'child'
          and parent_link_id is not null
          and player_id is not null
          and category_key <> 'chat'
        )
        or (
          scope_type = 'parent_global'
          and parent_link_id is null
          and player_id is null
          and category_key = 'chat'
        )
      )
    );

    create unique index parent_portal_view_states_child_key
    on public.parent_portal_view_states(auth_user_id, parent_link_id, category_key)
    where scope_type = 'child';

    create unique index parent_portal_view_states_global_key
    on public.parent_portal_view_states(auth_user_id, category_key)
    where scope_type = 'parent_global';

    create function public.parent_chat_ensure_rooms_for_current_user()
    returns void
    language sql
    as $$
      select null::void
    $$;

    create function public.get_parent_chat_rooms()
    returns table (
      id uuid,
      room_type text,
      status text,
      title text,
      club_id uuid,
      club_name text,
      team_id uuid,
      team_name text,
      player_id uuid,
      player_name text,
      match_day_id uuid,
      opponent text,
      match_date date,
      kickoff_time time,
      kickoff_time_tbc boolean,
      meet_time time,
      venue_name text,
      fixture_status text,
      child_names text[],
      latest_message text,
      latest_message_at timestamptz,
      unread_count bigint,
      can_post boolean
    )
    language sql
    as $$
      select
        room.id,
        room.room_type,
        room.status,
        room.title,
        room.club_id,
        'Test Club'::text,
        room.team_id,
        'Test Team'::text,
        room.player_id,
        coalesce(player.player_name, '')::text,
        room.match_day_id,
        ''::text,
        null::date,
        null::time,
        false,
        null::time,
        ''::text,
        ''::text,
        '{}'::text[],
        ''::text,
        null::timestamptz,
        0::bigint,
        true
      from public.parent_chat_rooms room
      left join public.players player on player.id = room.player_id
    $$;

    create function public.get_parent_chat_messages(target_room_id uuid)
    returns table (
      id uuid,
      room_id uuid,
      sender_id uuid,
      sender_kind text,
      sender_name text,
      sender_role text,
      body text,
      deleted_at timestamptz,
      created_at timestamptz,
      updated_at timestamptz,
      can_delete boolean
    )
    language sql
    as $$
      select
        null::uuid,
        target_room_id,
        null::uuid,
        ''::text,
        ''::text,
        ''::text,
        ''::text,
        null::timestamptz,
        null::timestamptz,
        null::timestamptz,
        false
      where false
    $$;

    create function public.send_parent_chat_message(target_room_id uuid, body_value text)
    returns uuid
    language sql
    as $$
      select target_room_id
    $$;

    create function public.mark_parent_chat_room_read(target_room_id uuid)
    returns timestamptz
    language sql
    as $$
      select statement_timestamp()
    $$;

    create function public.delete_parent_chat_message(target_message_id uuid)
    returns void
    language sql
    as $$
      select null::void
    $$;

    create function public.parent_portal_latest_category_activity(
      parent_link_id_value uuid,
      category_key_value text
    )
    returns timestamptz
    language sql
    as $$
      select null::timestamptz
    $$;
  `)

  await db.exec(extractFunction(legacyMigration, 'parent_chat_staff_can_access_team'))

  await db.query(`
    insert into public.teams(id, club_id)
    values ($1, $3), ($2, $4)
  `, [ids.team, ids.otherTeam, ids.club, ids.otherClub])
  await db.query(`
    insert into public.users(id, club_id, status, role, role_rank)
    values
      ($1, $5, 'active', 'coach', 30),
      ($2, $5, 'active', 'parent_portal', 0),
      ($3, $5, 'active', 'parent_portal', 0),
      ($4, $5, 'inactive', 'coach', 30)
  `, [
    ids.multiRole,
    ids.sameEmailOtherAuth,
    ids.parentOnly,
    ids.inactiveStaff,
    ids.club,
  ])
  await db.query(`
    insert into public.team_staff(user_id, team_id)
    values ($1, $3), ($2, $3)
  `, [ids.multiRole, ids.inactiveStaff, ids.team])
  await db.query(`
    insert into public.players(id, club_id, team_id, player_name)
    values
      ($1, $5, $6, 'Player A'),
      ($2, $5, $6, 'Player B'),
      ($3, $5, $6, 'Player Other'),
      ($4, $5, $6, 'Player Parent')
  `, [
    ids.playerA,
    ids.playerB,
    ids.playerOther,
    ids.playerParentOnly,
    ids.club,
    ids.team,
  ])
  await db.query(`
    insert into public.parent_player_links(id, club_id, team_id, player_id, auth_user_id, status)
    values
      ($1, $9, $10, $5, $11, 'active'),
      ($2, $9, $10, $6, $11, 'active'),
      ($3, $9, $10, $7, $12, 'active'),
      ($4, $9, $10, $8, $13, 'active')
  `, [
    ids.linkA,
    ids.linkB,
    ids.linkOther,
    ids.linkParentOnly,
    ids.playerA,
    ids.playerB,
    ids.playerOther,
    ids.playerParentOnly,
    ids.club,
    ids.team,
    ids.multiRole,
    ids.sameEmailOtherAuth,
    ids.parentOnly,
  ])
  await db.query(`
    insert into public.parent_chat_rooms(
      id, club_id, team_id, player_id, match_day_id, room_type
    )
    values
      ($1, $8, $9, $10, null, 'parent_staff'),
      ($2, $8, $9, $11, null, 'parent_staff'),
      ($3, $8, $9, $12, null, 'parent_staff'),
      ($4, $8, $9, null, null, 'team'),
      ($5, $8, $9, null, $13, 'match_squad'),
      ($6, $8, $9, null, $14, 'match_squad'),
      ($7, $15, $16, null, null, 'team')
  `, [
    ids.directA,
    ids.directB,
    ids.directOther,
    ids.teamRoom,
    ids.selectedMatchRoom,
    ids.unrelatedMatchRoom,
    ids.wrongTeamRoom,
    ids.club,
    ids.team,
    ids.playerA,
    ids.playerB,
    ids.playerOther,
    ids.selectedMatch,
    ids.unrelatedMatch,
    ids.otherClub,
    ids.otherTeam,
  ])
  await db.query(`
    insert into public.match_day_player_squad_decisions(
      match_day_id, club_id, team_id, player_id, status
    )
    values
      ($1, $3, $4, $5, 'selected'),
      ($2, $3, $4, $6, 'selected')
  `, [
    ids.selectedMatch,
    ids.unrelatedMatch,
    ids.club,
    ids.team,
    ids.playerA,
    ids.playerB,
  ])

  await db.exec(migration)

  return db
}

test('same-auth multi-role eligibility and child room relevance are server-authoritative', async () => {
  const db = await createDatabase()
  await setClaims(db, ids.multiRole)

  const context = await db.query(
    `select * from public.get_parent_portal_chat_context($1)`,
    [ids.linkA],
  )
  assert.equal(context.rows[0].child_filter_available, true)

  for (const roomId of [ids.directA, ids.teamRoom, ids.selectedMatchRoom]) {
    const relevance = await db.query(
      `select public.parent_chat_room_matches_parent_link($1, $2) as allowed`,
      [roomId, ids.linkA],
    )
    assert.equal(relevance.rows[0].allowed, true)
  }

  for (const roomId of [
    ids.directB,
    ids.directOther,
    ids.unrelatedMatchRoom,
    ids.wrongTeamRoom,
  ]) {
    const relevance = await db.query(
      `select public.parent_chat_room_matches_parent_link($1, $2) as allowed`,
      [roomId, ids.linkA],
    )
    assert.equal(relevance.rows[0].allowed, false)
  }

  await assert.rejects(
    db.query(
      `select public.send_parent_portal_chat_message($1, $2, 'safe test', true)`,
      [ids.linkA, ids.directB],
    ),
    /not available for the selected child/,
  )
  const legacyMode = await db.query(
    `select public.send_parent_portal_chat_message($1, $2, 'safe test', false) as room_id`,
    [ids.linkA, ids.directB],
  )
  assert.equal(legacyMode.rows[0].room_id, ids.directB)

  await db.close()
})

test('matching email claims do not merge accounts and inactive or Parent-only staff is not eligible', async () => {
  const db = await createDatabase()

  await setClaims(db, ids.sameEmailOtherAuth)
  await assert.rejects(
    db.query(`select * from public.get_parent_portal_chat_context($1)`, [ids.linkA]),
    /Parent access is not available for this child/,
  )

  await setClaims(db, ids.parentOnly)
  const parentOnly = await db.query(
    `select * from public.get_parent_portal_chat_context($1)`,
    [ids.linkParentOnly],
  )
  assert.equal(parentOnly.rows[0].child_filter_available, false)

  await setClaims(db, ids.inactiveStaff)
  await db.query(
    `update public.parent_player_links set auth_user_id = $1 where id = $2`,
    [ids.inactiveStaff, ids.linkOther],
  )
  const inactiveStaff = await db.query(
    `select * from public.get_parent_portal_chat_context($1)`,
    [ids.linkOther],
  )
  assert.equal(inactiveStaff.rows[0].child_filter_available, false)

  await db.close()
})
