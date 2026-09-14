import { PGlite } from '@electric-sql/pglite'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { test } from 'node:test'

const migration = await readFile(
  new URL('../supabase/migrations/20260824092125_parent_training_recurrence_calendar_occurrences_88.sql', import.meta.url),
  'utf8',
)

const ids = {
  club: '10000000-0000-4000-8000-000000000001',
  event: '20000000-0000-4000-8000-000000000001',
  linkA: '30000000-0000-4000-8000-000000000001',
  linkB: '30000000-0000-4000-8000-000000000002',
  parentA: '40000000-0000-4000-8000-000000000001',
  parentB: '40000000-0000-4000-8000-000000000002',
  player: '50000000-0000-4000-8000-000000000001',
  requestPast: '60000000-0000-4000-8000-000000000001',
  requestFuture: '60000000-0000-4000-8000-000000000002',
  requestPlayerPastA: '70000000-0000-4000-8000-000000000001',
  requestPlayerPastB: '70000000-0000-4000-8000-000000000002',
  requestPlayerFutureA: '70000000-0000-4000-8000-000000000003',
  requestPlayerFutureB: '70000000-0000-4000-8000-000000000004',
  team: '80000000-0000-4000-8000-000000000001',
}

async function createDatabase() {
  const db = new PGlite()
  await db.exec(`
    create schema auth;
    create role anon;
    create role authenticated;
    create role service_role;

    create function auth.uid()
    returns uuid
    language sql
    stable
    as $$
      select (nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'sub')::uuid
    $$;

    create table public.parent_player_links (
      id uuid primary key,
      auth_user_id uuid not null,
      status text not null,
      club_id uuid not null,
      team_id uuid not null,
      player_id uuid not null,
      email text
    );
    create table public.assessment_sessions (id uuid primary key, status text);
    create table public.calendar_events (id uuid primary key, cancelled_at timestamptz);
    create table public.training_availability_requests (
      id uuid primary key,
      status text not null,
      occurrence_starts_at timestamptz not null,
      calendar_event_id uuid not null,
      club_id uuid not null,
      team_id uuid not null
    );
    create table public.training_availability_request_players (
      id uuid primary key,
      request_id uuid not null,
      club_id uuid not null,
      team_id uuid not null,
      player_id uuid not null,
      parent_link_id uuid,
      status text not null
    );
    create table public.training_availability_responses (
      request_id uuid not null,
      player_id uuid not null,
      status text not null,
      responded_at timestamptz
    );
    create table public.match_days (id uuid primary key, status text, concluded_at timestamptz);
    create table public.match_day_availability_requests (
      id uuid primary key,
      match_day_id uuid,
      club_id uuid,
      team_id uuid,
      player_id uuid,
      parent_link_id uuid,
      status text,
      expires_at timestamptz,
      updated_at timestamptz,
      created_at timestamptz
    );
    create table public.match_day_player_availability (
      match_day_id uuid,
      player_id uuid,
      status text,
      selected_at timestamptz
    );
    create table public.match_day_player_squad_decisions (
      match_day_id uuid,
      player_id uuid,
      club_id uuid,
      status text
    );

    create table public.legacy_invitation_rows (
      invitation_id text,
      invitation_type text,
      source_record_id uuid,
      source_type text,
      source_event_type text,
      event_id uuid,
      event_type text,
      event_title text,
      event_date date,
      kickoff_time_tbc boolean,
      event_start timestamptz,
      event_end timestamptz,
      event_location text,
      team_name text,
      child_id uuid,
      child_name text,
      parent_link_id uuid,
      role_type text,
      invitation_state text,
      response_state text,
      selection_state text,
      can_respond boolean,
      can_change_response boolean,
      lock_reason text,
      response_deadline timestamptz,
      last_responded_at timestamptz
    );

    create function public.get_parent_portal_invitation_state_match_selection86_legacy(uuid)
    returns setof public.legacy_invitation_rows
    language sql
    stable
    security definer
    as $$ select * from public.legacy_invitation_rows $$;
  `)

  await db.exec(migration)
  await db.exec(`
    insert into public.parent_player_links(id, auth_user_id, status, club_id, team_id, player_id, email) values
      ('${ids.linkA}', '${ids.parentA}', 'active', '${ids.club}', '${ids.team}', '${ids.player}', 'parent-a@example.invalid'),
      ('${ids.linkB}', '${ids.parentB}', 'active', '${ids.club}', '${ids.team}', '${ids.player}', 'parent-b@example.invalid');
    insert into public.calendar_events(id, cancelled_at) values ('${ids.event}', null);
    insert into public.training_availability_requests(id, status, occurrence_starts_at, calendar_event_id, club_id, team_id) values
      ('${ids.requestPast}', 'sent', now() - interval '1 hour', '${ids.event}', '${ids.club}', '${ids.team}'),
      ('${ids.requestFuture}', 'sent', now() + interval '7 days', '${ids.event}', '${ids.club}', '${ids.team}');
    insert into public.training_availability_request_players(id, request_id, club_id, team_id, player_id, parent_link_id, status) values
      ('${ids.requestPlayerPastA}', '${ids.requestPast}', '${ids.club}', '${ids.team}', '${ids.player}', '${ids.linkA}', 'responded'),
      ('${ids.requestPlayerPastB}', '${ids.requestPast}', '${ids.club}', '${ids.team}', '${ids.player}', '${ids.linkB}', 'responded'),
      ('${ids.requestPlayerFutureA}', '${ids.requestFuture}', '${ids.club}', '${ids.team}', '${ids.player}', '${ids.linkA}', 'sent'),
      ('${ids.requestPlayerFutureB}', '${ids.requestFuture}', '${ids.club}', '${ids.team}', '${ids.player}', '${ids.linkB}', 'sent');
    insert into public.training_availability_responses(request_id, player_id, status, responded_at) values
      ('${ids.requestPast}', '${ids.player}', 'available', now() - interval '2 hours');

    insert into public.legacy_invitation_rows
    select
      concat('training_attendance:', request_player.id),
      'training_attendance',
      request_player.id,
      'training_availability',
      'calendar_event',
      request.calendar_event_id,
      'training',
      'Monday Training',
      (request.occurrence_starts_at at time zone 'Europe/London')::date,
      false,
      request.occurrence_starts_at,
      request.occurrence_starts_at + interval '90 minutes',
      'Training Ground',
      'U17 Green',
      request_player.player_id,
      'Linked Child',
      request_player.parent_link_id,
      null,
      case when request.occurrence_starts_at <= now() then 'closed' else 'active' end,
      'awaiting_response',
      'not_applicable',
      true,
      true,
      '',
      request.occurrence_starts_at,
      null
    from public.training_availability_request_players request_player
    join public.training_availability_requests request on request.id = request_player.request_id;
  `)
  return db
}

async function getTrainingOccurrences(db, parentId, linkId) {
  await db.query("select set_config('request.jwt.claims', $1, false)", [JSON.stringify({ sub: parentId })])
  return db.query(`
    select source_record_id, event_start, invitation_state, response_state, can_respond
    from public.get_parent_portal_invitation_state('${linkId}')
    where invitation_type = 'training_attendance'
    order by event_start
  `)
}

test('Parent Calendar preserves every recurring Training occurrence for each active contact', async () => {
  const db = await createDatabase()
  try {
    const parentA = await getTrainingOccurrences(db, ids.parentA, ids.linkA)
    assert.equal(parentA.rows.length, 2)
    assert.deepEqual(parentA.rows.map((row) => row.source_record_id), [
      ids.requestPlayerPastA,
      ids.requestPlayerFutureA,
    ])
    assert.equal(parentA.rows[0].invitation_state, 'closed')
    assert.equal(parentA.rows[0].response_state, 'available')
    assert.equal(parentA.rows[0].can_respond, false)
    assert.equal(parentA.rows[1].invitation_state, 'active')
    assert.equal(parentA.rows[1].response_state, 'awaiting_response')
    assert.equal(parentA.rows[1].can_respond, true)

    const parentB = await getTrainingOccurrences(db, ids.parentB, ids.linkB)
    assert.equal(parentB.rows.length, 2)
    assert.deepEqual(parentB.rows.map((row) => row.source_record_id), [
      ids.requestPlayerPastB,
      ids.requestPlayerFutureB,
    ])
  } finally {
    await db.close()
  }
})
