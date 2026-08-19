import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'
import { PGlite } from '@electric-sql/pglite'

const migrationUrl = new URL(
  '../supabase/migrations/20260819112343_training_rsvp_delivery_and_parent_chat_dnd_73.sql',
  import.meta.url,
)

const ids = {
  auth: '10000000-0000-4000-8000-000000000001',
  authOther: '10000000-0000-4000-8000-000000000002',
  club: '20000000-0000-4000-8000-000000000001',
  event: '30000000-0000-4000-8000-000000000001',
  invite: '40000000-0000-4000-8000-000000000001',
  link: '50000000-0000-4000-8000-000000000001',
  player: '60000000-0000-4000-8000-000000000001',
  room: '70000000-0000-4000-8000-000000000001',
  team: '80000000-0000-4000-8000-000000000001',
}

async function createDatabase() {
  const db = new PGlite()
  await db.exec(`
    create role anon;
    create role authenticated;
    create role service_role;
    create schema auth;
    create schema app_private;

    create function auth.uid()
    returns uuid
    language sql
    stable
    as $$
      select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid
    $$;

    create table public.clubs (
      id uuid primary key,
      status text not null default 'active',
      archived_at timestamptz
    );
    create table public.teams (
      id uuid primary key,
      club_id uuid not null,
      status text not null default 'active',
      archived_at timestamptz
    );
    create table public.calendar_events (
      id uuid primary key,
      club_id uuid not null,
      team_id uuid not null
    );
    create table public.training_availability_settings (
      id uuid primary key default gen_random_uuid(),
      calendar_event_id uuid not null,
      club_id uuid not null,
      team_id uuid not null,
      enabled boolean not null
    );
    create table public.calendar_event_invites (
      id uuid primary key,
      calendar_event_id uuid,
      club_id uuid not null,
      team_id uuid not null,
      invite_status text not null default 'active',
      training_availability_requested boolean not null default false,
      notify_requested boolean not null default false,
      response_requirement text not null default 'informational'
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
    create table public.parent_chat_rooms (
      id uuid primary key,
      club_id uuid not null,
      team_id uuid not null,
      player_id uuid,
      match_day_id uuid,
      room_type text not null,
      status text not null default 'active'
    );
    create table public.parent_chat_memberships (
      id uuid primary key default gen_random_uuid(),
      room_id uuid not null,
      club_id uuid not null,
      auth_user_id uuid not null,
      member_kind text not null,
      active boolean not null default true,
      joined_at timestamptz not null default timezone('utc', now()),
      left_at timestamptz,
      last_read_at timestamptz,
      updated_at timestamptz not null default timezone('utc', now()),
      unique (room_id, auth_user_id)
    );
    create table public.match_day_player_squad_decisions (
      match_day_id uuid not null,
      club_id uuid not null,
      team_id uuid not null,
      player_id uuid not null,
      status text not null
    );

    create function public.get_parent_portal_chat_rooms(
      parent_link_id_value uuid,
      child_only_value boolean default false
    )
    returns table (id uuid)
    language sql
    stable
    security definer
    set search_path = ''
    as $$
      select room.id
      from public.parent_chat_rooms room
      join public.parent_player_links link
        on link.id = parent_link_id_value
       and link.auth_user_id = auth.uid()
       and link.club_id = room.club_id
       and coalesce(link.team_id, room.team_id) = room.team_id
       and link.status = 'active'
      where room.status = 'active'
    $$;
  `)

  await db.exec(await readFile(migrationUrl, 'utf8'))
  await db.exec(`
    insert into public.clubs (id) values ('${ids.club}');
    insert into public.teams (id, club_id) values ('${ids.team}', '${ids.club}');
    insert into public.calendar_events (id, club_id, team_id)
    values ('${ids.event}', '${ids.club}', '${ids.team}');
    insert into public.players (id, club_id, team_id)
    values ('${ids.player}', '${ids.club}', '${ids.team}');
    insert into public.parent_player_links (id, auth_user_id, player_id, club_id, team_id)
    values ('${ids.link}', '${ids.auth}', '${ids.player}', '${ids.club}', '${ids.team}');
    insert into public.parent_chat_rooms (id, club_id, team_id, room_type)
    values ('${ids.room}', '${ids.club}', '${ids.team}', 'team');
  `)
  return db
}

test('active Training RSVP settings reject informational invite downgrades', async () => {
  const db = await createDatabase()
  try {
    await db.query(`
      insert into public.training_availability_settings (
        calendar_event_id, club_id, team_id, enabled
      ) values ($1, $2, $3, true)
    `, [ids.event, ids.club, ids.team])
    await db.query(`
      insert into public.calendar_event_invites (
        id, calendar_event_id, club_id, team_id, response_requirement
      ) values ($1, $2, $3, $4, 'informational')
    `, [ids.invite, ids.event, ids.club, ids.team])

    const protectedInvite = await db.query(`
      select training_availability_requested, notify_requested, response_requirement
      from public.calendar_event_invites
      where id = $1
    `, [ids.invite])
    assert.deepEqual(protectedInvite.rows[0], {
      notify_requested: true,
      response_requirement: 'response_required',
      training_availability_requested: true,
    })

    await db.query(`
      update public.calendar_event_invites
      set training_availability_requested = false,
          notify_requested = false,
          response_requirement = 'informational'
      where id = $1
    `, [ids.invite])
    const stillProtected = await db.query(
      'select response_requirement from public.calendar_event_invites where id = $1',
      [ids.invite],
    )
    assert.equal(stillProtected.rows[0].response_requirement, 'response_required')

    await db.query(
      'update public.training_availability_settings set enabled = false where calendar_event_id = $1',
      [ids.event],
    )
    await db.query(`
      update public.calendar_event_invites
      set training_availability_requested = false,
          notify_requested = false,
          response_requirement = 'informational'
      where id = $1
    `, [ids.invite])
    const disabled = await db.query(
      'select response_requirement from public.calendar_event_invites where id = $1',
      [ids.invite],
    )
    assert.equal(disabled.rows[0].response_requirement, 'informational')
  } finally {
    await db.close()
  }
})

test('Parent room DND is child-authorised, server-backed and suppresses only that room', async () => {
  const db = await createDatabase()
  try {
    await db.exec(`set request.jwt.claim.sub = '${ids.auth}'`)
    const muted = await db.query(
      'select public.set_parent_portal_chat_room_notifications($1, $2, true, true) as value',
      [ids.link, ids.room],
    )
    assert.equal(muted.rows[0].value, true)

    const preferences = await db.query(
      'select * from public.get_parent_portal_chat_notification_preferences($1, true)',
      [ids.link],
    )
    assert.deepEqual(preferences.rows, [{ notifications_muted: true, room_id: ids.room }])

    const blocked = await db.query(
      'select app_private.parent_chat_parent_link_can_receive_notification($1, $2, $3) as value',
      [ids.room, ids.auth, ids.link],
    )
    assert.equal(blocked.rows[0].value, false)

    await db.query(
      'select public.set_parent_portal_chat_room_notifications($1, $2, false, true)',
      [ids.link, ids.room],
    )
    const allowed = await db.query(
      'select app_private.parent_chat_parent_link_can_receive_notification($1, $2, $3) as value',
      [ids.room, ids.auth, ids.link],
    )
    assert.equal(allowed.rows[0].value, true)

    await db.exec(`set request.jwt.claim.sub = '${ids.authOther}'`)
    await assert.rejects(
      db.query(
        'select public.set_parent_portal_chat_room_notifications($1, $2, true, true)',
        [ids.link, ids.room],
      ),
      /Parent access is not available/,
    )
  } finally {
    await db.close()
  }
})
