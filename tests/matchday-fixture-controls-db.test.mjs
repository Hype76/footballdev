import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { test } from 'node:test'

import { PGlite } from '@electric-sql/pglite'

const migration = readFileSync(
  new URL('../supabase/migrations/20260717194345_matchday_fixture_controls.sql', import.meta.url),
  'utf8',
)
const manualPlayerCalendarScopeRepair = readFileSync(
  new URL('../supabase/migrations/20260901123000_matchday_manual_player_calendar_scope_repair.sql', import.meta.url),
  'utf8',
)
const pastDeleteRepair = readFileSync(
  new URL('../supabase/migrations/20260817141000_past_match_delete_repair.sql', import.meta.url),
  'utf8',
)

const ACTOR_ID = '10000000-0000-0000-0000-000000000001'
const CLUB_A_ID = '20000000-0000-0000-0000-000000000001'
const CLUB_B_ID = '20000000-0000-0000-0000-000000000002'
const TEAM_A_ID = '30000000-0000-0000-0000-000000000001'
const TEAM_B_ID = '30000000-0000-0000-0000-000000000002'
const TEAM_C_ID = '30000000-0000-0000-0000-000000000003'

function migrationText(name) {
  return readFileSync(new URL(`../supabase/migrations/${name}.sql`, import.meta.url), 'utf8').replaceAll('\r\n', '\n')
}

function migrationFunction(name, signature, delimiter) {
  const sql = migrationText(name)
  const start = sql.toLowerCase().indexOf(`create or replace function ${signature}`)
  assert.ok(start >= 0, signature)
  const body = sql.indexOf(delimiter, start)
  const end = sql.indexOf(delimiter, body + delimiter.length)
  assert.ok(body > start && end > body, signature)
  return sql.slice(start, end + delimiter.length) + ';'
}

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
  await db.exec(manualPlayerCalendarScopeRepair)
  await db.exec(pastDeleteRepair)
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
  await db.query('insert into public.calendar_event_invites(match_day_id, club_id, team_id, player_id, invite_status, response_requirement) values ($1, $2, $3, $4, $5, $6)', [matchId, CLUB_A_ID, TEAM_A_ID, playerId, 'active', 'response_required'])
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

test('past fixture with a stale live timer can be soft deleted without touching its retained history', async () => {
  const db = await createDatabase()
  const matchId = '40000000-0000-0000-0000-000000000020'
  await db.query(`
    insert into public.match_days (
      id, club_id, team_id, opponent, fixture_type, match_date, status, timer_status, timer_started_at
    ) values ($1, $2, $3, 'Stale live fixture', 'league', current_date - 7, 'live', 'running', now() - interval '7 days')
  `, [matchId, CLUB_A_ID, TEAM_A_ID])
  await db.query('insert into public.match_day_events(match_day_id, event_type) values ($1, $2)', [matchId, 'goal'])

  const result = await db.query('select public.delete_previous_match_day_v2($1) as result', [matchId])
  assert.equal(result.rows[0].result.deleted, true)
  assert.equal(result.rows[0].result.alreadyDeleted, false)
  assert.equal(result.rows[0].result.retainedRecordCounts.events, 1)

  const retained = await db.query('select count(*)::integer as count from public.match_day_events where match_day_id = $1', [matchId])
  assert.equal(retained.rows[0].count, 1)
  await db.close()
})

test('future cancelled fixture can be removed through v2 and repeated removal creates one audit', async () => {
  const db = await createDatabase()
  const matchId = '40000000-0000-0000-0000-000000000021'
  try {
    await db.query(`
      insert into public.match_days (id, club_id, team_id, opponent, fixture_type, match_date, status)
      values ($1, $2, $3, 'Cancelled future fixture', 'league', current_date + 7, 'cancelled')
    `, [matchId, CLUB_A_ID, TEAM_A_ID])
    const first = await db.query('select public.delete_previous_match_day_v2($1) as result', [matchId])
    assert.equal(first.rows[0].result.deleted, true)
    assert.equal(first.rows[0].result.alreadyDeleted, false)
    const retry = await db.query('select public.delete_previous_match_day_v2($1) as result', [matchId])
    assert.equal(retry.rows[0].result.alreadyDeleted, true)
    const stored = await db.query(`select deleted_at,
      (select count(*)::integer from public.audit_logs where entity_id = $1 and action = 'match_day_previous_game_deleted') as audits
      from public.match_days where id = $1`, [matchId])
    assert.ok(stored.rows[0].deleted_at)
    assert.equal(stored.rows[0].audits, 1)
  } finally { await db.close() }
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

test('Coach fixture lifecycle locks old details, corrects the timeline and keeps deletion and date guards', async (t) => {
  const db = await createDatabase()
  t.after(() => db.close())
  await db.exec(`
    create schema private;
    create schema app_private;
    alter table public.clubs add column status text, add column timezone_name text;
    alter table public.teams add column status text;
    alter table public.team_staff add column id uuid default gen_random_uuid(), add column role_rank integer default 30;
    create table public.user_club_memberships (auth_user_id uuid, club_id uuid, role text, role_rank integer);
    update public.users set role = 'coach', role_rank = 30;
    insert into public.user_club_memberships select id, club_id, role, role_rank from public.users;
    create table public.match_locations (id uuid, club_id uuid, archived_at timestamptz);
    alter table public.match_days
      add column title text default '',
      add column match_conclusion_rule text default 'normal_time',
      add column match_duration_minutes integer default 90,
      add column current_match_phase text default 'pre_match',
      add column extra_time_half_minutes integer default 10,
      add column extra_time_period_count integer default 2,
      add column normal_time_home_score integer, add column normal_time_away_score integer,
      add column extra_time_home_score integer, add column extra_time_away_score integer,
      add column home_shootout_score integer default 0, add column away_shootout_score integer default 0,
      add column shootout_winner text, add column carpool_enabled boolean default true,
      add column pitch_type text, add column location_id uuid, add column notification_team_name text,
      add column shirt_choice text;
    create function private.is_guest_match_scorer(uuid) returns boolean language sql as $$ select false $$;
    create function public.current_user_is_match_day_scorer(uuid) returns boolean language sql as $$ select false $$;
    create function public.current_user_has_match_day_scorer_assignment(uuid) returns boolean language sql as $$ select false $$;
    create function public.can_manage_match_day(uuid) returns boolean language sql as $$
      select exists (
        select 1 from public.teams team join public.users actor on actor.id=auth.uid() and actor.club_id=team.club_id
        where team.id=$1 and actor.status='active' and (
          actor.role='admin' or exists (select 1 from public.team_staff where team_id=$1 and user_id=actor.id)
        )
      )
    $$;
    create function public.can_read_match_day(uuid) returns boolean language sql as $$ select public.can_manage_match_day($1) $$;
    create function public.current_user_has_club_wide_authority(uuid) returns boolean language sql as $$
      select exists (select 1 from public.users where id=auth.uid() and club_id=$1 and status='active' and role='admin')
    $$;
    alter function public.set_match_day_timer_state(uuid,text) rename to fixture_test_apply_timer;
    create function public.apply_match_day_timer_action(uuid,text,uuid,text,text,uuid)
    returns jsonb language sql as $$ select public.fixture_test_apply_timer($1,$2) $$;
    create sequence public.match_day_event_sequence_seq;
    create function public.match_day_phase_order(text) returns integer language sql as $$ select case when $1='first_half' then 10 when $1='second_half' then 30 else 100 end $$;
    create function public.get_initials_from_full_name(text) returns text language sql as $$ select left($1, 1) $$;
    alter table public.players add column player_name text, add column shirt_number text;
    alter table public.match_day_events
      add column club_id uuid, add column team_id uuid, add column event_status text not null default 'active',
      add column event_sequence bigint default nextval('public.match_day_event_sequence_seq'), add column phase_order integer,
      add column match_phase text, add column stoppage_minute integer, add column scorer_player_id uuid,
      add column assist_player_id uuid, add column participant_identity_version integer, add column is_own_goal boolean,
      add column is_penalty_goal boolean, add column created_by uuid, add column request_id uuid,
      add column correction_reason text, add column correction_metadata jsonb not null default '{}'::jsonb,
      add column corrected_at timestamptz, add column corrected_by uuid, add column corrected_by_name text,
      add column voided_at timestamptz, add column voided_by uuid;
    alter table public.match_day_event_log drop constraint match_day_event_log_event_type_check;
  `)
  await db.exec(migrationFunction('20260728170000_staff_role_assignment_control', 'app_private.actor_can_manage_team_resource(', '$$'))
  await db.exec(migrationFunction('20260731110000_fp_v1_gameday_scorer_authority_02a', 'public.match_day_local_date_is_today(', '$$'))
  await db.exec(migrationFunction('20260902151551_guest_match_day_scorer', 'public.set_match_day_timer_state(', '$function$'))
  await db.exec(migrationText('20260903120639_squad_notification_email_fallback').split('alter table public.match_day_squad_notifications')[0])
  await db.exec(migrationText('20260903120851_coach_conclusion_authority'))
  await db.exec(migrationText('20261030075557_matchday_finish_before_optional_phases'))
  await db.exec(migrationFunction('20260914065046_coach_pitch_and_event_participant_removal', 'public.update_match_day_fixture_for_team(', '$function$'))
  await db.exec(migrationText('20261110130302_coach_match_fixture_lifecycle'))
  await db.exec(migrationFunction('20260731110000_fp_v1_gameday_scorer_authority_02a', 'public.enforce_match_day_gameplay_write()', '$$'))
  await db.exec(migrationFunction('20260928124108_mobile_match_calendar', 'public.enforce_match_day_event_write()', '$function$'))
  await db.exec(migrationFunction('20260902144139_parent_scorer_resume_added_time_own_goals', 'public.set_match_day_event_extended_context()', '$function$'))
  await db.exec(migrationText('20261110161643_coach_concluded_match_timeline').split('-- A self-managed Player')[0])
  await db.exec(`
    create trigger enforce_event before insert or update or delete on public.match_day_events
      for each row execute function public.enforce_match_day_event_write();
    create trigger event_context before insert on public.match_day_events
      for each row execute function public.set_match_day_event_extended_context();
    create trigger enforce_score before update of home_score, away_score on public.match_days
      for each row execute function public.enforce_match_day_gameplay_write();
  `)
  const fixture = '40000000-0000-0000-0000-000000000014'
  const otherTeam = '40000000-0000-0000-0000-000000000015'
  const historic = '40000000-0000-0000-0000-000000000016'
  const londonToday = "(timezone('Europe/London', now())::date)"
  await db.query(`
    insert into public.match_days (id, club_id, team_id, match_date, status, timer_status, concluded_at, home_score, updated_at) values
      ($1, $4, $5, ${londonToday} + 1, 'scheduled', 'not_started', null, 0, now()),
      ($2, $4, $6, ${londonToday}, 'scheduled', 'not_started', null, 0, now()),
      ($3, $4, $5, '2025-03-15', 'full_time', 'full_time', '2025-03-15T16:00:00Z', 3, '2025-03-15T16:00:00Z')
  `, [fixture, otherTeam, historic, CLUB_A_ID, TEAM_A_ID, TEAM_B_ID])
  await assert.rejects(db.query("select public.set_match_day_timer_state($1,'start')", [fixture]), /only be started on the fixture date/)
  await assert.rejects(db.query("select public.set_match_day_timer_state($1,'start')", [otherTeam]), /access is required/)
  await db.query(`update public.match_days set match_date = ${londonToday} - 1 where id = $1`, [fixture])
  await assert.rejects(db.query("select public.set_match_day_timer_state($1,'start')", [fixture]), /only be started on the fixture date/)
  await db.query(`update public.match_days set match_date = ${londonToday} where id = $1`, [fixture])
  const started = await db.query("select public.set_match_day_timer_state($1,'start') as result", [fixture])
  assert.equal(started.rows[0].result.status, 'live')
  await assert.rejects(db.query('select public.delete_match_day_fixture_for_team($1,$2)', [fixture, TEAM_A_ID]), /Finish the active match/)
  await assert.rejects(db.query('select public.delete_match_day_fixture_for_team($1,$2)', [otherTeam, TEAM_B_ID]), /assigned Coach or Manager/)

  const payload = {
    concludedEdit: true, expectedUpdatedAt: '2025-03-15T16:00:00Z', fixtureType: '',
    opponent: 'Corrected FC', homeAway: 'home', shirtChoice: 'away', matchDate: '2025-03-14', kickoffTime: '14:00',
    conclusionRule: 'straight_to_penalties', matchDurationMinutes: 60, extraTimeHalfMinutes: 7, extraTimePeriodCount: 1,
  }
  const update = 'select public.update_match_day_fixture_for_team($1,$2,$3) as result'
  await assert.rejects(db.query(update, [historic, TEAM_B_ID, payload]), /not_permitted/)
  await assert.rejects(db.query(update, [historic, TEAM_A_ID, { ...payload, concludedEdit: false }]), /not_permitted/)
  await assert.rejects(db.query(update, [historic, TEAM_A_ID, payload]), /Fixture details are locked/)
  await assert.rejects(db.query('update public.match_days set opponent=\'Other FC\' where id=$1', [historic]), /Fixture details are locked/)
  await assert.rejects(db.query('update public.match_days set home_score=6 where id=$1', [historic]), /concluded match is read only/)
  await assert.rejects(db.query("insert into public.match_day_events(match_day_id,event_type) values ($1,'goal')", [historic]), /closed matches are read only/)
  const change = 'select public.save_coach_concluded_match_event($1,$2,$3,$4,$5,$6) as result'
  const playerId = randomUUID()
  const outsiderId = randomUUID()
  await db.query('insert into public.players values ($1,$3,$4,\'New scorer\',\'9\'), ($2,$3,$5,\'Other team\',\'1\')',
    [playerId, outsiderId, CLUB_A_ID, TEAM_A_ID, TEAM_B_ID])
  const initialTime = payload.expectedUpdatedAt
  const goalDetails = { eventType: 'goal', teamSide: 'club', minute: 12, reason: 'Missed goal' }
  const goalParams = [historic, initialTime, randomUUID(), null, 'save', goalDetails]
  const goal = (await db.query(change, goalParams)).rows[0].result
  assert.equal(goal.match_phase, 'first_half')
  assert.deepEqual((await db.query(change, goalParams)).rows[0].result, goal)
  await assert.rejects(db.query(change, [historic, initialTime, randomUUID(), goal.id, 'save', goalDetails]), /Refresh it before saving/)
  const updatedAt = async () => (await db.query('select updated_at::text from public.match_days where id=$1', [historic])).rows[0].updated_at
  const version = await updatedAt()
  await assert.rejects(db.query(change, [historic, version, randomUUID(), goal.id, 'save', { ...goalDetails, scorerPlayerId: outsiderId }]), /player from this match team/)
  const edited = (await db.query(change, [historic, version, randomUUID(), goal.id, 'save', {
    ...goalDetails, minute: 57, scorerPlayerId: playerId, assistName: 'Unknown assist',
  }])).rows[0].result
  assert.equal(edited.scorer_name, 'New scorer')
  assert.equal(edited.assist_name, 'Unknown assist')
  assert.equal(edited.match_phase, 'second_half')
  assert.equal(edited.event_status, 'corrected')
  assert.equal(edited.home_score, 4)
  const card = (await db.query(change, [historic, await updatedAt(), randomUUID(), null, 'save', {
    eventType: 'red_card', teamSide: 'club', minute: 40, scorerPlayerId: playerId, reason: 'Missed card',
  }])).rows[0].result
  assert.equal(card.event_type, 'red_card')
  assert.equal(card.home_score, 3)
  await db.query(change, [historic, await updatedAt(), randomUUID(), goal.id, 'void', { reason: 'Duplicate goal' }])
  await db.query(change, [historic, await updatedAt(), randomUUID(), null, 'score', { homeScore: 2, awayScore: 1, reason: 'Verified final score' }])
  const state = (await db.query('select match_date::text, status, home_score, away_score, timer_status from public.match_days where id=$1', [historic])).rows[0]
  assert.deepEqual(state, { match_date: '2025-03-15', status: 'full_time', home_score: 2, away_score: 1, timer_status: 'full_time' })
  await db.query('update public.team_staff set role_rank=20 where user_id=$1', [ACTOR_ID])
  await assert.rejects(db.query(change, [historic, await updatedAt(), randomUUID(), card.id, 'void', { reason: 'Denied' }]), /assigned Coach or Manager/)
  await db.query('update public.team_staff set role_rank=30 where user_id=$1', [ACTOR_ID])
  const grants = (await db.query(`select
    has_function_privilege('anon','public.save_coach_concluded_match_event(uuid,timestamptz,uuid,uuid,text,jsonb)','execute') as anon,
    has_function_privilege('service_role','public.save_coach_concluded_match_event(uuid,timestamptz,uuid,uuid,text,jsonb)','execute') as service`)).rows[0]
  assert.deepEqual(grants, { anon: false, service: false })
  await db.query('insert into public.match_day_notification_events (match_day_id,status) values ($1,\'queued\')', [historic])
  const remove = 'select public.delete_match_day_fixture_for_team($1,$2) as result'
  await assert.rejects(db.query(remove, [historic, TEAM_A_ID]), /notifications to finish/)
  await db.query("update public.match_day_notification_events set status = 'sent' where match_day_id = $1", [historic])
  const deleted = (await db.query(remove, [historic, TEAM_A_ID])).rows[0].result
  assert.equal(deleted.deleted, true)
  assert.deepEqual((await db.query(remove, [historic, TEAM_A_ID])).rows[0].result, deleted)
  const counts = (await db.query(`select
    (select count(*)::int from public.match_days where id=$1 and deleted_at is null) as visible,
    (select count(*)::int from public.match_day_events where match_day_id=$1) as retained,
    (select count(*)::int from public.audit_logs where entity_id=$1 and action='match_day_fixture_deleted') as audited
  `, [historic])).rows[0]
  assert.deepEqual(counts, { visible: 0, retained: 3, audited: 1 })

  await db.exec(migrationText('20260907112202_coach_match_day_offline_commands').split('create or replace function public.apply_coach_match_day_command(')[0])
  await db.exec(migrationText('20261107193737_coach_match_day_command_no_wait'))
  await db.exec('alter table public.match_day_final_reports rename to fixture_test_final_reports')
  await db.exec(migrationText('20260710183205_match_day_final_reports'))
  const authorityMigration = migrationText('20261113085415_prioritise_current_live_match_updates')
  await db.exec(authorityMigration.slice(authorityMigration.indexOf('-- A Club Admin acts'), authorityMigration.indexOf('create or replace function app_private.formation_board_team_role_rank')))
  await db.query("update public.users set role='admin', role_rank=90 where id=$1", [ACTOR_ID])
  await db.query("update public.user_club_memberships set role='admin', role_rank=90 where auth_user_id=$1", [ACTOR_ID])
  await db.query('delete from public.team_staff where user_id=$1', [ACTOR_ID])
  const foreignMatchId = randomUUID()
  await db.query("insert into public.match_days (id,club_id,team_id,match_date,status,timer_status) values ($1,$2,$3,'2025-03-15','cancelled','not_started')",
    [foreignMatchId, CLUB_B_ID, TEAM_C_ID])
  await assert.rejects(db.query(remove, [foreignMatchId, TEAM_C_ID]), /assigned Coach or Manager/)
  assert.equal((await db.query(remove, [otherTeam, TEAM_B_ID])).rows[0].result.deleted, true)
})
