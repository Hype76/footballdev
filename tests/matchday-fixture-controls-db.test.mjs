import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { test } from 'node:test'

import { PGlite } from '@electric-sql/pglite'

const migration = readFileSync(
  new URL('../supabase/migrations/20260717194345_matchday_fixture_controls.sql', import.meta.url),
  'utf8',
)

const ACTOR_ID = '10000000-0000-0000-0000-000000000001'
const CLUB_A_ID = '20000000-0000-0000-0000-000000000001'
const CLUB_B_ID = '20000000-0000-0000-0000-000000000002'
const TEAM_A_ID = '30000000-0000-0000-0000-000000000001'
const TEAM_B_ID = '30000000-0000-0000-0000-000000000002'
const TEAM_C_ID = '30000000-0000-0000-0000-000000000003'

async function createDatabase() {
  const db = new PGlite()
  await db.exec(`
    create role anon;
    create role authenticated;
    create role service_role;
    create schema auth;

    create table auth.users (id uuid primary key);
    create function auth.uid() returns uuid language sql stable as $$
      select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid
    $$;
    create function auth.jwt() returns jsonb language sql stable as $$
      select coalesce(nullif(current_setting('request.jwt.claims', true), '')::jsonb, '{}'::jsonb)
    $$;

    create table public.clubs (id uuid primary key, name text not null);
    create table public.teams (id uuid primary key, club_id uuid not null references public.clubs(id), name text not null);
    create table public.users (
      id uuid primary key references auth.users(id),
      club_id uuid references public.clubs(id),
      role text not null,
      role_rank integer not null,
      status text not null default 'active'
    );
    create table public.team_staff (
      team_id uuid not null references public.teams(id),
      user_id uuid not null references public.users(id),
      primary key (team_id, user_id)
    );

    create function public.current_user_club_id() returns uuid language sql stable as $$
      select club_id from public.users where id = auth.uid()
    $$;
    create function public.current_user_role() returns text language sql stable as $$
      select role from public.users where id = auth.uid()
    $$;
    create function public.current_user_role_rank() returns integer language sql stable as $$
      select role_rank from public.users where id = auth.uid()
    $$;

    create table public.match_days (
      id uuid primary key,
      club_id uuid not null references public.clubs(id),
      team_id uuid references public.teams(id),
      opponent text not null default '',
      match_date date,
      kickoff_time time,
      kickoff_time_tbc boolean not null default false,
      arrival_time time,
      home_away text not null default 'home',
      venue_name text not null default '',
      venue_address text not null default '',
      notes text not null default '',
      scorer_request_message text not null default '',
      request_scorer boolean not null default false,
      request_linesman boolean not null default false,
      request_referee boolean not null default false,
      parent_visible boolean not null default false,
      parent_audience text not null default 'none',
      status text not null default 'scheduled',
      home_score integer not null default 0,
      away_score integer not null default 0,
      created_at timestamptz not null default now(),
      updated_at timestamptz not null default now(),
      phase_started_at timestamptz,
      timer_started_at timestamptz,
      timer_paused_at timestamptz,
      timer_elapsed_seconds integer not null default 0,
      timer_status text not null default 'not_started',
      full_time_resume_status text,
      concluded_at timestamptz,
      concluded_by uuid,
      previous_hidden_at timestamptz
    );

    create table public.players (id uuid primary key, club_id uuid, team_id uuid);
    create table public.parent_player_links (
      id uuid primary key,
      auth_user_id uuid,
      club_id uuid,
      team_id uuid,
      player_id uuid,
      status text
    );
    create table public.calendar_event_invites (
      id uuid primary key default gen_random_uuid(),
      match_day_id uuid,
      club_id uuid,
      team_id uuid,
      player_id uuid,
      invite_status text,
      response_requirement text
    );
    create table public.calendar_event_notification_commands (
      id uuid primary key default gen_random_uuid(),
      match_day_id uuid,
      completed_at timestamptz
    );
    create table public.calendar_event_notification_events (
      id uuid primary key default gen_random_uuid(),
      match_day_id uuid,
      status text
    );
    create table public.match_day_notification_events (
      id uuid primary key default gen_random_uuid(),
      match_day_id uuid,
      status text
    );
    create table public.match_day_availability_requests (id uuid primary key default gen_random_uuid(), match_day_id uuid);
    create table public.match_day_player_availability_history (id uuid primary key default gen_random_uuid(), match_day_id uuid);
    create table public.match_day_final_reports (id uuid primary key default gen_random_uuid(), match_day_id uuid);
    create table public.parent_chat_rooms (id uuid primary key default gen_random_uuid(), match_day_id uuid);
    create table public.match_day_role_assignments (id uuid primary key default gen_random_uuid(), match_day_id uuid);
    create table public.match_day_player_squad_decisions (
      id uuid primary key default gen_random_uuid(),
      match_day_id uuid,
      club_id uuid,
      team_id uuid,
      player_id uuid,
      status text,
      updated_at timestamptz
    );
    create table public.match_day_events (
      id uuid primary key default gen_random_uuid(),
      match_day_id uuid,
      event_type text,
      team_side text,
      minute integer,
      scorer_name text,
      scorer_initials text,
      scorer_shirt_number text,
      assist_name text,
      assist_initials text,
      assist_shirt_number text,
      home_score integer,
      away_score integer,
      notes text,
      created_by_name text,
      created_at timestamptz not null default now()
    );
    create table public.match_day_event_log (
      id uuid primary key default gen_random_uuid(),
      club_id uuid not null,
      team_id uuid not null,
      match_day_id uuid not null,
      player_id uuid,
      actor_user_id uuid,
      actor_display_name text not null default '',
      actor_role text not null default '',
      event_type text not null,
      event_label text not null,
      previous_value jsonb,
      new_value jsonb,
      metadata jsonb not null default '{}'::jsonb,
      created_at timestamptz not null default now(),
      constraint match_day_event_log_event_type_check check (event_type in ('match_day_updated'))
    );
    create table public.audit_logs (
      id uuid primary key default gen_random_uuid(),
      club_id uuid,
      actor_id uuid,
      actor_email text,
      actor_name text,
      actor_role_label text,
      actor_role_rank integer,
      action text not null,
      entity_type text not null,
      entity_id uuid,
      metadata jsonb not null default '{}'::jsonb,
      created_at timestamptz not null default now()
    );

    create function public.get_parent_portal_match_days_calendar_notify_hotfix_legacy(parent_link_id_value uuid)
    returns table (
      id uuid, club_id uuid, team_id uuid, team_name text, opponent text, match_date date,
      kickoff_time time, kickoff_time_tbc boolean, arrival_time time, home_away text,
      venue_name text, venue_address text, notes text, scorer_request_message text,
      request_scorer boolean, request_linesman boolean, request_referee boolean, status text,
      home_score integer, away_score integer, created_at timestamptz, updated_at timestamptz,
      phase_started_at timestamptz, timer_started_at timestamptz, timer_paused_at timestamptz,
      timer_elapsed_seconds integer, timer_status text, availability_status text,
      availability_responded_at timestamptz, squad_decision_state text, squad_decision_updated_at timestamptz,
      volunteer_scorer_response text, volunteer_linesman_response text, volunteer_referee_response text,
      volunteer_responded_at timestamptz, has_interest boolean, is_scorer boolean,
      role_assignments jsonb, events jsonb
    ) language sql stable as $$ select null::uuid, null::uuid, null::uuid, null::text, null::text,
      null::date, null::time, null::boolean, null::time, null::text, null::text, null::text, null::text,
      null::text, null::boolean, null::boolean, null::boolean, null::text, null::integer, null::integer,
      null::timestamptz, null::timestamptz, null::timestamptz, null::timestamptz, null::timestamptz,
      null::integer, null::text, null::text, null::timestamptz, null::text, null::timestamptz,
      null::text, null::text, null::text, null::timestamptz, null::boolean, null::boolean,
      null::jsonb, null::jsonb where false $$;

    create function public.get_parent_portal_match_days(parent_link_id_value uuid)
    returns setof public.match_days language sql stable as $$ select * from public.match_days where false $$;

    create function public.set_match_day_timer_state(match_day_id_value uuid, action_value text)
    returns jsonb language plpgsql security definer set search_path = '' as $$
    declare
      saved_match public.match_days%rowtype;
      now_value timestamptz := now();
    begin
      if action_value <> 'start' then
        raise exception 'Test fixture only supports start.';
      end if;

      update public.match_days
      set
        status = 'live',
        phase_started_at = now_value,
        timer_started_at = now_value,
        timer_status = 'running',
        updated_at = now_value
      where id = match_day_id_value
      returning * into saved_match;

      insert into public.match_day_event_log (
        club_id, team_id, match_day_id, actor_user_id, actor_display_name,
        actor_role, event_type, event_label, metadata
      ) values (
        saved_match.club_id, saved_match.team_id, saved_match.id, auth.uid(), 'QA Manager',
        public.current_user_role(), 'match_day_updated', 'Timer state updated',
        jsonb_build_object('action', 'start', 'source', 'match_day_timer_rpc')
      );

      return jsonb_build_object(
        'id', saved_match.id,
        'matchDayId', saved_match.id,
        'status', saved_match.status,
        'phaseStartedAt', saved_match.phase_started_at,
        'timerStartedAt', saved_match.timer_started_at,
        'timerElapsedSeconds', saved_match.timer_elapsed_seconds,
        'timerStatus', saved_match.timer_status,
        'updatedAt', saved_match.updated_at
      );
    end;
    $$;
  `)

  await db.exec(migration)
  await db.exec(`
    insert into auth.users(id) values ('${ACTOR_ID}');
    insert into public.clubs(id, name) values ('${CLUB_A_ID}', 'Club A'), ('${CLUB_B_ID}', 'Club B');
    insert into public.teams(id, club_id, name) values
      ('${TEAM_A_ID}', '${CLUB_A_ID}', 'Team A'),
      ('${TEAM_B_ID}', '${CLUB_A_ID}', 'Team B'),
      ('${TEAM_C_ID}', '${CLUB_B_ID}', 'Team C');
    insert into public.users(id, club_id, role, role_rank) values ('${ACTOR_ID}', '${CLUB_A_ID}', 'manager', 50);
    insert into public.team_staff(team_id, user_id) values ('${TEAM_A_ID}', '${ACTOR_ID}');
    select set_config('request.jwt.claim.sub', '${ACTOR_ID}', false);
    select set_config('request.jwt.claims', '{"email":"manager@example.test","name":"QA Manager"}', false);
  `)
  return db
}

async function insertPreviousMatch(db, { clubId = CLUB_A_ID, id, teamId = TEAM_A_ID } = {}) {
  await db.query(`
    insert into public.match_days (
      id, club_id, team_id, opponent, fixture_type, match_date, status, timer_status, concluded_at
    ) values ($1, $2, $3, 'Jeluma QA', 'league', current_date - 2, 'full_time', 'full_time', now())
  `, [id, clubId, teamId])
}

test('candidate fixture classification keeps legacy null and rejects arbitrary stored values', async () => {
  const db = await createDatabase()
  const legacyMatchId = '40000000-0000-0000-0000-000000000006'
  const typedMatchId = '40000000-0000-0000-0000-000000000007'

  await db.query(`
    insert into public.match_days (id, club_id, team_id, opponent, fixture_type)
    values ($1, $2, $3, 'Legacy fixture', null), ($4, $2, $3, 'Cup fixture', 'cup')
  `, [legacyMatchId, CLUB_A_ID, TEAM_A_ID, typedMatchId])

  const fixtures = await db.query('select id, fixture_type from public.match_days order by id')
  assert.deepEqual(fixtures.rows, [
    { id: legacyMatchId, fixture_type: null },
    { id: typedMatchId, fixture_type: 'cup' },
  ])
  await assert.rejects(
    db.query(`
      insert into public.match_days (id, club_id, team_id, opponent, fixture_type)
      values ('40000000-0000-0000-0000-000000000008', $1, $2, 'Hostile fixture', 'playoff')
    `, [CLUB_A_ID, TEAM_A_ID]),
    /match_days_fixture_type_check/,
  )
  await db.close()
})

test('candidate Start match is assigned-team scoped and idempotent', async () => {
  const db = await createDatabase()
  const matchId = '40000000-0000-0000-0000-000000000009'
  await db.query(`
    insert into public.match_days (id, club_id, team_id, opponent, fixture_type, status, timer_status)
    values ($1, $2, $3, 'Ready fixture', 'friendly', 'scheduled', 'not_started')
  `, [matchId, CLUB_A_ID, TEAM_A_ID])

  const first = await db.query('select public.start_match_day($1) as result', [matchId])
  assert.equal(first.rows[0].result.status, 'live')
  assert.equal(first.rows[0].result.timerStatus, 'running')
  assert.equal(first.rows[0].result.timerElapsedSeconds, 0)
  assert.equal(first.rows[0].result.alreadyStarted, false)

  const firstState = await db.query(`
    select timer_started_at, phase_started_at,
      (select count(*) from public.match_day_event_log where match_day_id = $1 and metadata ->> 'action' = 'start')::integer as start_events
    from public.match_days where id = $1
  `, [matchId])
  assert.equal(firstState.rows[0].start_events, 1)

  const retry = await db.query('select public.start_match_day($1) as result', [matchId])
  assert.equal(retry.rows[0].result.alreadyStarted, true)
  const retryState = await db.query(`
    select timer_started_at, phase_started_at,
      (select count(*) from public.match_day_event_log where match_day_id = $1 and metadata ->> 'action' = 'start')::integer as start_events
    from public.match_days where id = $1
  `, [matchId])
  assert.deepEqual(retryState.rows[0], firstState.rows[0])

  const crossTeamMatchId = '40000000-0000-0000-0000-000000000010'
  await db.query(`
    insert into public.match_days (id, club_id, team_id, opponent, fixture_type, status, timer_status)
    values ($1, $2, $3, 'Other team', 'league', 'scheduled', 'not_started')
  `, [crossTeamMatchId, CLUB_A_ID, TEAM_B_ID])
  await assert.rejects(
    db.query('select public.start_match_day($1)', [crossTeamMatchId]),
    /assigned coach or manager access/i,
  )

  const crossClubMatchId = '40000000-0000-0000-0000-000000000014'
  await db.query(`
    insert into public.match_days (id, club_id, team_id, opponent, fixture_type, status, timer_status)
    values ($1, $2, $3, 'Other club', 'tournament', 'scheduled', 'not_started')
  `, [crossClubMatchId, CLUB_B_ID, TEAM_C_ID])
  await assert.rejects(
    db.query('select public.start_match_day($1)', [crossClubMatchId]),
    /assigned coach or manager access/i,
  )

  await db.query('update public.users set role = $1, role_rank = $2 where id = $3', ['parent_portal', 0, ACTOR_ID])
  const parentMatchId = '40000000-0000-0000-0000-000000000011'
  await db.query(`
    insert into public.match_days (id, club_id, team_id, opponent, fixture_type, status, timer_status)
    values ($1, $2, $3, 'Parent denied', 'cup', 'scheduled', 'not_started')
  `, [parentMatchId, CLUB_A_ID, TEAM_A_ID])
  await assert.rejects(
    db.query('select public.start_match_day($1)', [parentMatchId]),
    /assigned coach or manager access/i,
  )

  await db.query('update public.users set role = $1, role_rank = $2 where id = $3', ['manager', 50, ACTOR_ID])
  const completedMatchId = '40000000-0000-0000-0000-000000000015'
  await db.query(`
    insert into public.match_days (
      id, club_id, team_id, opponent, fixture_type, status, timer_status, concluded_at
    ) values ($1, $2, $3, 'Completed fixture', 'friendly', 'full_time', 'full_time', now())
  `, [completedMatchId, CLUB_A_ID, TEAM_A_ID])
  await assert.rejects(
    db.query('select public.start_match_day($1)', [completedMatchId]),
    /completed match cannot be started again/i,
  )
  await db.close()
})

test('candidate migration applies and previous game deletion retains dependencies and deduplicates retry', async () => {
  const db = await createDatabase()
  const matchId = '40000000-0000-0000-0000-000000000001'
  const playerId = '50000000-0000-0000-0000-000000000001'
  const parentLinkId = '60000000-0000-0000-0000-000000000001'
  await insertPreviousMatch(db, { id: matchId })
  await db.query('update public.match_days set parent_visible = true, parent_audience = $1 where id = $2', ['involved_players', matchId])
  await db.query('insert into public.players(id, club_id, team_id) values ($1, $2, $3)', [playerId, CLUB_A_ID, TEAM_A_ID])
  await db.query('insert into public.parent_player_links(id, auth_user_id, club_id, team_id, player_id, status) values ($1, $2, $3, $4, $5, $6)', [parentLinkId, ACTOR_ID, CLUB_A_ID, TEAM_A_ID, playerId, 'active'])
  await db.query('insert into public.calendar_event_invites(match_day_id, club_id, team_id, player_id, invite_status, response_requirement) values ($1, $2, $3, $4, $5, $6)', [matchId, CLUB_A_ID, TEAM_A_ID, playerId, 'sent', 'informational'])
  await db.query('insert into public.match_day_events(match_day_id, event_type) values ($1, $2)', [matchId, 'goal'])
  await db.query('insert into public.match_day_final_reports(match_day_id) values ($1)', [matchId])

  const parentBefore = await db.query('select id, fixture_type from public.get_parent_portal_match_days($1)', [parentLinkId])
  assert.deepEqual(parentBefore.rows, [{ id: matchId, fixture_type: 'league' }])

  const first = await db.query('select public.delete_previous_match_day($1) as result', [matchId])
  assert.equal(first.rows[0].result.deleted, true)
  assert.equal(first.rows[0].result.alreadyDeleted, false)
  assert.equal(first.rows[0].result.retainedRecordCounts.events, 1)
  assert.equal(first.rows[0].result.retainedRecordCounts.finalReports, 1)

  const retained = await db.query(`
    select
      (select count(*) from public.match_day_events where match_day_id = $1)::integer as events,
      (select count(*) from public.match_day_final_reports where match_day_id = $1)::integer as reports,
      (select count(*) from public.match_day_event_log where match_day_id = $1 and event_type = 'previous_game_deleted')::integer as deletion_events,
      (select count(*) from public.audit_logs where entity_id = $1 and action = 'match_day_previous_game_deleted')::integer as audits
  `, [matchId])
  assert.deepEqual(retained.rows[0], { events: 1, reports: 1, deletion_events: 1, audits: 1 })
  const parentAfter = await db.query('select id from public.get_parent_portal_match_days($1)', [parentLinkId])
  assert.deepEqual(parentAfter.rows, [])

  const retry = await db.query('select public.delete_previous_match_day($1) as result', [matchId])
  assert.equal(retry.rows[0].result.alreadyDeleted, true)
  const evidenceAfterRetry = await db.query(`
    select
      (select count(*) from public.match_day_event_log where match_day_id = $1 and event_type = 'previous_game_deleted')::integer as deletion_events,
      (select count(*) from public.audit_logs where entity_id = $1 and action = 'match_day_previous_game_deleted')::integer as audits
  `, [matchId])
  assert.deepEqual(evidenceAfterRetry.rows[0], { deletion_events: 1, audits: 1 })
  await db.close()
})

test('candidate deletion rolls back safely when notification work is pending', async () => {
  const db = await createDatabase()
  const matchId = '40000000-0000-0000-0000-000000000005'
  await insertPreviousMatch(db, { id: matchId })
  await db.query('insert into public.match_day_events(match_day_id, event_type) values ($1, $2)', [matchId, 'goal'])
  await db.query('insert into public.calendar_event_notification_commands(match_day_id) values ($1)', [matchId])

  await assert.rejects(
    db.query('select public.delete_previous_match_day($1)', [matchId]),
    /pending notification work/,
  )

  const state = await db.query(`
    select
      (select deleted_at from public.match_days where id = $1) as deleted_at,
      (select count(*) from public.match_day_events where match_day_id = $1)::integer as events,
      (select count(*) from public.match_day_event_log where match_day_id = $1 and event_type = 'previous_game_deleted')::integer as deletion_events,
      (select count(*) from public.audit_logs where entity_id = $1)::integer as audits
  `, [matchId])
  assert.deepEqual(state.rows[0], { deleted_at: null, events: 1, deletion_events: 0, audits: 0 })
  await db.close()
})

test('candidate deletion denies coach, same-club unassigned team, and cross-club fixtures', async () => {
  const db = await createDatabase()
  const coachMatchId = '40000000-0000-0000-0000-000000000002'
  const crossTeamMatchId = '40000000-0000-0000-0000-000000000003'
  const crossClubMatchId = '40000000-0000-0000-0000-000000000004'
  await insertPreviousMatch(db, { id: coachMatchId })
  await insertPreviousMatch(db, { id: crossTeamMatchId, teamId: TEAM_B_ID })
  await insertPreviousMatch(db, { clubId: CLUB_B_ID, id: crossClubMatchId, teamId: TEAM_C_ID })

  await db.query('update public.users set role = $1, role_rank = $2 where id = $3', ['coach', 30, ACTOR_ID])
  await assert.rejects(
    db.query('select public.delete_previous_match_day($1)', [coachMatchId]),
    /Manager or Team Admin access/,
  )

  await db.query('update public.users set role = $1, role_rank = $2 where id = $3', ['manager', 50, ACTOR_ID])
  await assert.rejects(
    db.query('select public.delete_previous_match_day($1)', [crossTeamMatchId]),
    /Manager or Team Admin access/,
  )
  await assert.rejects(
    db.query('select public.delete_previous_match_day($1)', [crossClubMatchId]),
    /Manager or Team Admin access/,
  )

  const remaining = await db.query('select count(*)::integer as count from public.match_days where deleted_at is null')
  assert.equal(remaining.rows[0].count, 3)
  await db.close()
})

test('candidate deletion allows assigned Team Admin and denies suspended staff', async () => {
  const db = await createDatabase()
  const teamAdminMatchId = '40000000-0000-0000-0000-000000000012'
  const suspendedMatchId = '40000000-0000-0000-0000-000000000013'
  await insertPreviousMatch(db, { id: teamAdminMatchId })
  await insertPreviousMatch(db, { id: suspendedMatchId })

  await db.query('update public.users set role = $1, role_rank = $2 where id = $3', ['head_manager', 70, ACTOR_ID])
  const deleted = await db.query('select public.delete_previous_match_day($1) as result', [teamAdminMatchId])
  assert.equal(deleted.rows[0].result.deleted, true)
  assert.equal(deleted.rows[0].result.alreadyDeleted, false)

  await db.query('update public.users set status = $1 where id = $2', ['suspended', ACTOR_ID])
  await assert.rejects(
    db.query('select public.delete_previous_match_day($1)', [suspendedMatchId]),
    /active staff profile/i,
  )
  const suspendedState = await db.query('select deleted_at from public.match_days where id = $1', [suspendedMatchId])
  assert.equal(suspendedState.rows[0].deleted_at, null)
  await db.close()
})
