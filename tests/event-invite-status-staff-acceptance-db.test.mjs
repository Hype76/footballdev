import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'
import { PGlite } from '@electric-sql/pglite'

const migrationUrl = new URL(
  '../supabase/migrations/20260728150556_event_invite_status_staff_acceptance.sql',
  import.meta.url,
)
const responsePolishMigrationUrl = new URL(
  '../supabase/migrations/20260730151849_calendar_response_polish_10a.sql',
  import.meta.url,
)

const IDS = {
  audit: '00000000-0000-0000-0000-000000000001',
  club: '10000000-0000-0000-0000-000000000001',
  otherClub: '10000000-0000-0000-0000-000000000002',
  team: '20000000-0000-0000-0000-000000000001',
  otherTeam: '20000000-0000-0000-0000-000000000002',
  manager: '30000000-0000-0000-0000-000000000001',
  crossTeamStaff: '30000000-0000-0000-0000-000000000002',
  parent: '30000000-0000-0000-0000-000000000003',
  player: '40000000-0000-0000-0000-000000000001',
  uninvitedPlayer: '40000000-0000-0000-0000-000000000002',
  match: '50000000-0000-0000-0000-000000000001',
  closedMatch: '50000000-0000-0000-0000-000000000002',
  trainingEvent: '60000000-0000-0000-0000-000000000001',
  trainingRequest: '70000000-0000-0000-0000-000000000001',
  trainingRequestPlayer: '80000000-0000-0000-0000-000000000001',
}

async function setActor(db, actorId) {
  await db.query(
    `select set_config('request.jwt.claims', $1, false)`,
    [JSON.stringify({ sub: actorId })],
  )
}

async function createDatabase() {
  const db = new PGlite()
  const [migration, responsePolishMigration] = await Promise.all([
    readFile(migrationUrl, 'utf8'),
    readFile(responsePolishMigrationUrl, 'utf8'),
  ])
  const unavailableFunction = responsePolishMigration.match(
    /create or replace function public\.mark_event_player_unavailable_on_behalf[\s\S]*?comment on function public\.mark_event_player_unavailable_on_behalf\(text, uuid, uuid, date\) is[\s\S]*?;/,
  )?.[0]

  assert.ok(unavailableFunction, 'Candidate migration must contain the complete unavailable staff action.')

  await db.exec(`
    create schema auth;
    create role anon;
    create role authenticated;
    create role service_role;

    create function auth.uid()
    returns uuid
    language sql
    stable
    set search_path = ''
    as $$
      select (nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'sub')::uuid
    $$;

    create table public.users (
      id uuid primary key,
      status text,
      role text,
      role_rank integer,
      name text,
      username text,
      email text,
      role_label text,
      club_id uuid
    );

    create table public.team_memberships (
      auth_user_id uuid not null,
      club_id uuid not null,
      team_id uuid not null,
      primary key (auth_user_id, team_id)
    );

    create function public.current_user_can_access_team(target_club_id uuid, target_team_id uuid)
    returns boolean
    language sql
    stable
    security definer
    set search_path = ''
    as $$
      select exists (
        select 1
        from public.users actor
        where actor.id = auth.uid()
          and (
            actor.role = 'super_admin'
            or exists (
              select 1
              from public.team_memberships membership
              where membership.auth_user_id = actor.id
                and membership.club_id = target_club_id
                and membership.team_id = target_team_id
            )
          )
      )
    $$;

    create function public.can_manage_match_day(target_team_id uuid)
    returns boolean
    language sql
    stable
    security definer
    set search_path = ''
    as $$
      select exists (
        select 1
        from public.users actor
        where actor.id = auth.uid()
          and actor.role <> 'parent_portal'
          and actor.role_rank >= 20
          and (
            actor.role = 'super_admin'
            or exists (
              select 1
              from public.team_memberships membership
              where membership.auth_user_id = actor.id
                and membership.club_id = actor.club_id
                and membership.team_id = target_team_id
            )
          )
      )
    $$;

    create table public.players (
      id uuid primary key,
      club_id uuid not null,
      team_id uuid not null,
      status text,
      player_name text
    );

    create table public.match_days (
      id uuid primary key,
      club_id uuid not null,
      team_id uuid not null,
      deleted_at timestamptz,
      status text
    );

    create table public.calendar_events (
      id uuid primary key,
      club_id uuid not null,
      team_id uuid,
      event_type text,
      cancelled_at timestamptz
    );

    create table public.calendar_event_invites (
      id uuid primary key default gen_random_uuid(),
      club_id uuid not null,
      team_id uuid not null,
      match_day_id uuid,
      calendar_event_id uuid,
      player_id uuid not null,
      invite_status text,
      cancelled_at timestamptz
    );

    create table public.match_day_player_availability (
      id uuid primary key default gen_random_uuid(),
      match_day_id uuid not null,
      club_id uuid not null,
      team_id uuid not null,
      player_id uuid not null,
      player_name text not null,
      status text not null,
      selected_by_parent_link_id uuid,
      selected_by_request_id uuid,
      selected_by_name text,
      selected_by_email text,
      selected_at timestamptz,
      created_at timestamptz default timezone('utc', now()),
      updated_at timestamptz default timezone('utc', now()),
      unique (match_day_id, player_id)
    );

    create table public.match_day_player_availability_history (
      id uuid primary key default gen_random_uuid(),
      match_day_id uuid not null,
      club_id uuid not null,
      team_id uuid not null,
      player_id uuid not null,
      request_id uuid,
      parent_link_id uuid,
      player_name text,
      previous_status text,
      status text,
      selected_by_name text,
      selected_by_email text,
      created_at timestamptz default timezone('utc', now())
    );

    create table public.match_day_player_squad_decisions (
      match_day_id uuid not null,
      player_id uuid not null,
      status text not null,
      primary key (match_day_id, player_id)
    );

    create table public.match_day_event_log (
      id uuid primary key default gen_random_uuid(),
      club_id uuid,
      team_id uuid,
      match_day_id uuid,
      player_id uuid,
      actor_user_id uuid,
      actor_display_name text,
      actor_role text,
      event_type text,
      event_label text,
      previous_value jsonb,
      new_value jsonb,
      metadata jsonb,
      created_at timestamptz
    );

    create table public.audit_logs (
      id uuid primary key default gen_random_uuid(),
      club_id uuid,
      actor_id uuid,
      action text,
      entity_type text,
      entity_id uuid,
      metadata jsonb,
      created_at timestamptz
    );

    create table public.training_availability_requests (
      id uuid primary key,
      calendar_event_id uuid not null,
      club_id uuid not null,
      team_id uuid not null,
      occurrence_date date not null,
      occurrence_starts_at timestamptz not null,
      status text not null,
      created_at timestamptz default timezone('utc', now())
    );

    create table public.training_availability_request_players (
      id uuid primary key,
      request_id uuid not null,
      calendar_event_id uuid not null,
      club_id uuid not null,
      team_id uuid not null,
      player_id uuid not null,
      status text not null,
      created_at timestamptz default timezone('utc', now()),
      responded_at timestamptz,
      updated_at timestamptz default timezone('utc', now())
    );

    create table public.training_availability_responses (
      id uuid primary key default gen_random_uuid(),
      request_player_id uuid not null,
      request_id uuid not null,
      club_id uuid not null,
      team_id uuid not null,
      calendar_event_id uuid not null,
      player_id uuid not null,
      parent_link_id uuid,
      status text not null,
      note text,
      responded_by_name text,
      responded_by_email text,
      responded_at timestamptz,
      created_at timestamptz default timezone('utc', now()),
      updated_at timestamptz,
      unique (request_id, player_id)
    );
  `)

  await db.exec(migration)
  await db.exec(unavailableFunction)

  await db.exec(`
    insert into public.users (id, status, role, role_rank, name, username, email, role_label, club_id)
    values
      ('${IDS.manager}', 'active', 'head_manager', 70, 'QA Manager', 'qa-manager', 'manager@example.test', 'Team Admin', '${IDS.club}'),
      ('${IDS.crossTeamStaff}', 'active', 'coach', 20, 'Other Coach', 'other-coach', 'other@example.test', 'Coach', '${IDS.club}'),
      ('${IDS.parent}', 'active', 'parent_portal', 10, 'Parent User', 'parent-user', 'parent@example.test', 'Parent', '${IDS.club}');

    insert into public.team_memberships (auth_user_id, club_id, team_id)
    values
      ('${IDS.manager}', '${IDS.club}', '${IDS.team}'),
      ('${IDS.crossTeamStaff}', '${IDS.club}', '${IDS.otherTeam}'),
      ('${IDS.parent}', '${IDS.club}', '${IDS.team}');

    insert into public.players (id, club_id, team_id, status, player_name)
    values
      ('${IDS.player}', '${IDS.club}', '${IDS.team}', 'active', 'FP TEST Player'),
      ('${IDS.uninvitedPlayer}', '${IDS.club}', '${IDS.team}', 'active', 'Not Invited');

    insert into public.match_days (id, club_id, team_id, status)
    values
      ('${IDS.match}', '${IDS.club}', '${IDS.team}', 'scheduled'),
      ('${IDS.closedMatch}', '${IDS.club}', '${IDS.team}', 'full_time');

    insert into public.calendar_event_invites (club_id, team_id, match_day_id, player_id, invite_status)
    values ('${IDS.club}', '${IDS.team}', '${IDS.match}', '${IDS.player}', 'active');

    insert into public.match_day_player_squad_decisions (match_day_id, player_id, status)
    values ('${IDS.match}', '${IDS.player}', 'selected');

    insert into public.calendar_events (id, club_id, team_id, event_type)
    values ('${IDS.trainingEvent}', '${IDS.club}', '${IDS.team}', 'training');

    insert into public.calendar_event_invites (club_id, team_id, calendar_event_id, player_id, invite_status)
    values ('${IDS.club}', '${IDS.team}', '${IDS.trainingEvent}', '${IDS.player}', 'active');

    insert into public.training_availability_requests (
      id, calendar_event_id, club_id, team_id, occurrence_date, occurrence_starts_at, status
    )
    values (
      '${IDS.trainingRequest}',
      '${IDS.trainingEvent}',
      '${IDS.club}',
      '${IDS.team}',
      '2099-01-01',
      '2099-01-01 18:00:00+00',
      'sent'
    );

    insert into public.training_availability_request_players (
      id, request_id, calendar_event_id, club_id, team_id, player_id, status
    )
    values (
      '${IDS.trainingRequestPlayer}',
      '${IDS.trainingRequest}',
      '${IDS.trainingEvent}',
      '${IDS.club}',
      '${IDS.team}',
      '${IDS.player}',
      'sent'
    );
  `)

  return db
}

test('authorised staff acceptance is idempotent, audited, and keeps match selection', async () => {
  const db = await createDatabase()
  await setActor(db, IDS.manager)

  const first = await db.query(
    `select public.accept_event_player_availability_on_behalf('match', $1, $2, null) result`,
    [IDS.match, IDS.player],
  )
  assert.equal(first.rows[0].result.changed, true)
  assert.equal(first.rows[0].result.source, 'staff_on_behalf')

  const repeat = await db.query(
    `select public.accept_event_player_availability_on_behalf('match', $1, $2, null) result`,
    [IDS.match, IDS.player],
  )
  assert.equal(repeat.rows[0].result.changed, false)

  const evidence = await db.query(`
    select
      (select count(*)::int from public.match_day_player_availability) response_count,
      (select status from public.match_day_player_availability limit 1) response_status,
      (select selected_by_parent_link_id from public.match_day_player_availability limit 1) parent_actor,
      (select count(*)::int from public.match_day_player_availability_history) history_count,
      (select count(*)::int from public.match_day_event_log) event_log_count,
      (select metadata->>'source' from public.match_day_event_log limit 1) event_source,
      (select count(*)::int from public.audit_logs) audit_count,
      (select metadata->>'source' from public.audit_logs limit 1) audit_source,
      (select status from public.match_day_player_squad_decisions limit 1) squad_status
  `)

  assert.deepEqual(evidence.rows[0], {
    audit_count: 1,
    audit_source: 'staff_on_behalf',
    event_log_count: 1,
    event_source: 'staff_on_behalf',
    history_count: 1,
    parent_actor: null,
    response_count: 1,
    response_status: 'available',
    squad_status: 'selected',
  })

  await db.close()
})

test('training staff acceptance is idempotent and identifies the staff actor', async () => {
  const db = await createDatabase()
  await setActor(db, IDS.manager)

  const first = await db.query(
    `select public.accept_event_player_availability_on_behalf('training', $1, $2, '2099-01-01') result`,
    [IDS.trainingEvent, IDS.player],
  )
  const repeat = await db.query(
    `select public.accept_event_player_availability_on_behalf('training', $1, $2, '2099-01-01') result`,
    [IDS.trainingEvent, IDS.player],
  )

  assert.equal(first.rows[0].result.changed, true)
  assert.equal(repeat.rows[0].result.changed, false)

  const evidence = await db.query(`
    select
      (select count(*)::int from public.training_availability_responses) response_count,
      (select status from public.training_availability_responses limit 1) response_status,
      (select parent_link_id from public.training_availability_responses limit 1) parent_actor,
      (select responded_by_name from public.training_availability_responses limit 1) actor_name,
      (select status from public.training_availability_request_players limit 1) request_player_status,
      (select count(*)::int from public.audit_logs) audit_count,
      (select metadata->>'source' from public.audit_logs limit 1) audit_source
  `)

  assert.deepEqual(evidence.rows[0], {
    actor_name: 'QA Manager',
    audit_count: 1,
    audit_source: 'staff_on_behalf',
    parent_actor: null,
    request_player_status: 'responded',
    response_count: 1,
    response_status: 'available',
  })

  await db.close()
})

test('parent, cross-team staff, uninvited players, and closed events are denied', async () => {
  const db = await createDatabase()

  await setActor(db, IDS.parent)
  await assert.rejects(
    db.query(
      `select public.accept_event_player_availability_on_behalf('match', $1, $2, null)`,
      [IDS.match, IDS.player],
    ),
    /Authorised team staff access is required/,
  )

  await setActor(db, IDS.crossTeamStaff)
  await assert.rejects(
    db.query(
      `select public.accept_event_player_availability_on_behalf('match', $1, $2, null)`,
      [IDS.match, IDS.player],
    ),
    /cannot manage this Match Day fixture/,
  )

  await setActor(db, IDS.manager)
  await assert.rejects(
    db.query(
      `select public.accept_event_player_availability_on_behalf('match', $1, $2, null)`,
      [IDS.match, IDS.uninvitedPlayer],
    ),
    /not actively invited/,
  )
  await assert.rejects(
    db.query(
      `select public.accept_event_player_availability_on_behalf('match', $1, $2, null)`,
      [IDS.closedMatch, IDS.player],
    ),
    /not available for responses/,
  )

  const mutations = await db.query(`
    select
      (select count(*)::int from public.match_day_player_availability) match_responses,
      (select count(*)::int from public.training_availability_responses) training_responses,
      (select count(*)::int from public.audit_logs) audit_rows
  `)
  assert.deepEqual(mutations.rows[0], {
    audit_rows: 0,
    match_responses: 0,
    training_responses: 0,
  })

  await db.close()
})

test('authorised staff can mark a match player unavailable without changing squad selection', async () => {
  const db = await createDatabase()
  await setActor(db, IDS.manager)

  const first = await db.query(
    `select public.mark_event_player_unavailable_on_behalf('match', $1, $2, null) result`,
    [IDS.match, IDS.player],
  )
  const repeat = await db.query(
    `select public.mark_event_player_unavailable_on_behalf('match', $1, $2, null) result`,
    [IDS.match, IDS.player],
  )

  assert.equal(first.rows[0].result.changed, true)
  assert.equal(first.rows[0].result.responseStatus, 'unavailable')
  assert.equal(repeat.rows[0].result.changed, false)

  const evidence = await db.query(`
    select
      (select status from public.match_day_player_availability limit 1) response_status,
      (select count(*)::int from public.match_day_player_availability_history) history_count,
      (select action from public.audit_logs limit 1) audit_action,
      (select status from public.match_day_player_squad_decisions limit 1) squad_status
  `)

  assert.deepEqual(evidence.rows[0], {
    audit_action: 'event_player_availability_marked_unavailable_on_behalf',
    history_count: 1,
    response_status: 'unavailable',
    squad_status: 'selected',
  })

  await db.close()
})

test('authorised staff can mark a training player unavailable idempotently', async () => {
  const db = await createDatabase()
  await setActor(db, IDS.manager)

  const first = await db.query(
    `select public.mark_event_player_unavailable_on_behalf('training', $1, $2, '2099-01-01') result`,
    [IDS.trainingEvent, IDS.player],
  )
  const repeat = await db.query(
    `select public.mark_event_player_unavailable_on_behalf('training', $1, $2, '2099-01-01') result`,
    [IDS.trainingEvent, IDS.player],
  )

  assert.equal(first.rows[0].result.changed, true)
  assert.equal(first.rows[0].result.responseStatus, 'unavailable')
  assert.equal(repeat.rows[0].result.changed, false)

  const evidence = await db.query(`
    select
      (select status from public.training_availability_responses limit 1) response_status,
      (select status from public.training_availability_request_players limit 1) request_player_status,
      (select action from public.audit_logs limit 1) audit_action
  `)

  assert.deepEqual(evidence.rows[0], {
    audit_action: 'event_player_availability_marked_unavailable_on_behalf',
    request_player_status: 'responded',
    response_status: 'unavailable',
  })

  await db.close()
})
