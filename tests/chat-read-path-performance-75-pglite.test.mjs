import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'

import { PGlite } from '@electric-sql/pglite'

const migrationUrl = new URL(
  '../supabase/migrations/20260826175527_chat_read_path_performance_75.sql',
  import.meta.url,
)

const ids = {
  club: '10000000-0000-4000-8000-000000000075',
  team: '20000000-0000-4000-8000-000000000075',
  staff: '30000000-0000-4000-8000-000000000075',
  denied: '30000000-0000-4000-8000-000000000076',
  parent: '30000000-0000-4000-8000-000000000077',
  player: '40000000-0000-4000-8000-000000000075',
  parentLink: '50000000-0000-4000-8000-000000000075',
  room: '60000000-0000-4000-8000-000000000075',
  match: '70000000-0000-4000-8000-000000000075',
}

const schemaSql = `
create role anon;
create role authenticated;
create role service_role;
create schema auth;

create function auth.uid()
returns uuid
language sql
stable
as $$
  select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid;
$$;

create table public.clubs (id uuid primary key, name text not null);
create table public.teams (id uuid primary key, club_id uuid not null, name text not null);
create table public.players (
  id uuid primary key,
  club_id uuid not null,
  team_id uuid,
  player_name text not null,
  status text not null default 'active',
  archived_at timestamptz
);
create table public.match_days (
  id uuid primary key,
  club_id uuid not null,
  team_id uuid,
  opponent text not null default '',
  match_date date,
  kickoff_time time,
  kickoff_time_tbc boolean not null default false,
  arrival_time time,
  venue_name text not null default '',
  status text not null default 'scheduled',
  deleted_at timestamptz
);
create table public.parent_player_links (
  id uuid primary key,
  player_id uuid not null,
  auth_user_id uuid not null,
  status text not null default 'active',
  club_id uuid not null,
  team_id uuid,
  email text not null default '',
  created_at timestamptz not null default statement_timestamp()
);
create table public.parent_chat_rooms (
  id uuid primary key,
  room_type text not null,
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
  sender_id uuid not null,
  body text not null,
  deleted_at timestamptz,
  created_at timestamptz not null default statement_timestamp()
);
create table public.parent_chat_memberships (
  room_id uuid not null,
  auth_user_id uuid not null,
  active boolean not null default true,
  notifications_muted boolean not null default false,
  last_read_at timestamptz,
  unique (room_id, auth_user_id)
);
create table public.match_day_scorer_interest (
  id uuid primary key default gen_random_uuid(), match_day_id uuid not null, parent_link_id uuid
);
create table public.match_day_scorer_assignments (
  id uuid primary key default gen_random_uuid(), match_day_id uuid not null
);
create table public.match_day_role_assignments (
  id uuid primary key default gen_random_uuid(), match_day_id uuid not null, parent_link_id uuid
);
create table public.match_day_player_availability (
  id uuid primary key default gen_random_uuid(), match_day_id uuid not null
);
create table public.match_day_player_squad_decisions (
  id uuid primary key default gen_random_uuid(), match_day_id uuid not null, player_id uuid not null, status text not null
);
create table public.match_day_player_availability_history (
  id uuid primary key default gen_random_uuid(), match_day_id uuid not null
);
create table public.match_day_availability_requests (
  id uuid primary key default gen_random_uuid(), match_day_id uuid not null, player_id uuid, parent_link_id uuid
);
create table public.calendar_event_invites (
  id uuid primary key default gen_random_uuid(), match_day_id uuid not null, player_id uuid
);
create table public.match_day_event_log (
  id uuid primary key default gen_random_uuid(), match_day_id uuid not null, player_id uuid
);
create table public.match_day_events (
  id uuid primary key default gen_random_uuid(), match_day_id uuid not null
);
create table public.match_day_shootout_kicks (
  id uuid primary key default gen_random_uuid(), match_day_id uuid not null
);
create table public.match_day_final_reports (
  id uuid primary key default gen_random_uuid(), match_day_id uuid not null
);

create function public.parent_chat_user_can_access_room(target_room_id uuid, target_user_id uuid)
returns boolean
language sql
stable
as $$
  select exists (
    select 1 from public.parent_chat_memberships membership
    where membership.room_id = target_room_id
      and membership.auth_user_id = target_user_id
      and membership.active
  );
$$;

create function public.parent_chat_user_can_post_room(target_room_id uuid, target_user_id uuid)
returns boolean
language sql
stable
as $$ select public.parent_chat_user_can_access_room(target_room_id, target_user_id); $$;

create function public.parent_chat_staff_can_access_team(target_user_id uuid, target_club_id uuid, target_team_id uuid)
returns boolean
language sql
stable
as $$ select false; $$;

create function public.parent_chat_room_matches_parent_link(target_room_id uuid, target_link_id uuid, target_user_id uuid)
returns boolean
language sql
stable
as $$
  select exists (
    select 1
    from public.parent_chat_rooms room
    join public.parent_player_links link on link.id = target_link_id
    where room.id = target_room_id
      and link.auth_user_id = target_user_id
      and link.status = 'active'
      and room.club_id = link.club_id
      and room.team_id = coalesce(link.team_id, room.team_id)
      and (room.player_id is null or room.player_id = link.player_id)
  );
$$;

create function public.get_parent_portal_chat_context(parent_link_id_value uuid)
returns table (parent_link_id uuid)
language sql
stable
security definer
set search_path = ''
as $$
  select link.id
  from public.parent_player_links link
  where link.id = parent_link_id_value
    and link.auth_user_id = (select auth.uid())
    and link.status = 'active';
$$;

create function public.current_user_club_id()
returns uuid
language sql
stable
as $$ select nullif(current_setting('app.club_id', true), '')::uuid; $$;

create function public.can_read_match_day(target_team_id uuid)
returns boolean
language sql
stable
as $$
  select auth.uid() = '${ids.staff}'::uuid and target_team_id = '${ids.team}'::uuid;
$$;
`

async function setActor(db, actorId, clubId = '') {
  await db.query("select set_config('request.jwt.claim.sub', $1, false)", [actorId])
  await db.query("select set_config('app.club_id', $1, false)", [clubId])
}

test('performance migration compiles twice, keeps Chat reads write-free, and protects Match Day scope', async () => {
  const migration = await readFile(migrationUrl, 'utf8')
  const db = new PGlite()

  try {
    await db.exec(schemaSql)
    await db.exec('begin')
    await db.exec(migration)
    await db.exec('rollback')
    await db.exec(migration)
    await db.exec(migration)

    await db.query(
      `insert into public.clubs(id, name) values ($1, 'FP TEST Club')`,
      [ids.club],
    )
    await db.query(
      `insert into public.teams(id, club_id, name) values ($1, $2, 'FP TEST Team')`,
      [ids.team, ids.club],
    )
    await db.query(
      `insert into public.players(id, club_id, team_id, player_name) values ($1, $2, $3, 'FP TEST Player')`,
      [ids.player, ids.club, ids.team],
    )
    await db.query(
      `insert into public.match_days(id, club_id, team_id, opponent, match_date) values ($1, $2, $3, 'FP TEST Opposition', date '2026-08-30')`,
      [ids.match, ids.club, ids.team],
    )
    await db.query(
      `insert into public.parent_player_links(id, player_id, auth_user_id, club_id, team_id, email)
       values ($1, $2, $3, $4, $5, 'parent@example.test')`,
      [ids.parentLink, ids.player, ids.parent, ids.club, ids.team],
    )
    await db.query(
      `insert into public.parent_chat_rooms(id, room_type, title, club_id, team_id, player_id)
       values ($1, 'parent_staff', 'FP TEST Chat', $2, $3, $4)`,
      [ids.room, ids.club, ids.team, ids.player],
    )
    await db.query(
      `insert into public.parent_chat_memberships(room_id, auth_user_id) values ($1, $2)`,
      [ids.room, ids.parent],
    )
    await db.query(
      `insert into public.parent_chat_messages(room_id, sender_id, body) values ($1, $2, 'FP TEST Message')`,
      [ids.room, ids.staff],
    )
    await db.query(
      `insert into public.match_day_player_squad_decisions(match_day_id, player_id, status)
       values ($1, $2, 'selected')`,
      [ids.match, ids.player],
    )

    await setActor(db, ids.parent)
    const before = await db.query(`
      select
        (select count(*) from public.parent_chat_rooms)::int as rooms,
        (select count(*) from public.parent_chat_memberships)::int as memberships,
        (select count(*) from public.parent_chat_messages)::int as messages
    `)
    const rooms = await db.query('select * from public.get_parent_chat_rooms()')
    const preferences = await db.query(
      'select * from public.get_parent_portal_chat_notification_preferences($1, true)',
      [ids.parentLink],
    )
    const activity = await db.query(
      'select public.parent_portal_latest_chat_activity($1) as latest_activity_at',
      [ids.parentLink],
    )
    const after = await db.query(`
      select
        (select count(*) from public.parent_chat_rooms)::int as rooms,
        (select count(*) from public.parent_chat_memberships)::int as memberships,
        (select count(*) from public.parent_chat_messages)::int as messages
    `)

    assert.equal(rooms.rows.length, 1)
    assert.equal(preferences.rows.length, 1)
    assert.ok(activity.rows[0].latest_activity_at)
    assert.deepEqual(after.rows[0], before.rows[0])

    await setActor(db, ids.staff, ids.club)
    const detail = await db.query(
      'select public.get_staff_match_day_detail($1, $2) as result',
      [ids.match, ids.team],
    )
    assert.equal(detail.rows[0].result.id, ids.match)
    assert.equal(detail.rows[0].result.teams.name, 'FP TEST Team')
    assert.equal(detail.rows[0].result.match_day_player_squad_decisions.length, 1)

    await setActor(db, ids.denied, ids.club)
    await assert.rejects(
      db.query('select public.get_staff_match_day_detail($1, $2)', [ids.match, ids.team]),
      /not linked to your active Team/i,
    )
  } finally {
    await db.close()
  }
})
