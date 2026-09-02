import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'
import { PGlite } from '@electric-sql/pglite'

const migrationUrl = new URL(
  '../supabase/migrations/20260728161800_match_available_auto_selection.sql',
  import.meta.url,
)
const privilegeMigrationUrl = new URL(
  '../supabase/migrations/20260728164000_lock_auto_selection_trigger_function.sql',
  import.meta.url,
)
const activePlayerMigrationUrl = new URL(
  '../supabase/migrations/20260902140157_match_available_active_player_selection.sql',
  import.meta.url,
)

const IDS = {
  club: '10000000-0000-0000-0000-000000000001',
  team: '20000000-0000-0000-0000-000000000001',
  staff: '30000000-0000-0000-0000-000000000001',
  parent: '30000000-0000-0000-0000-000000000002',
  parentLink: '35000000-0000-0000-0000-000000000001',
  parentPlayer: '40000000-0000-0000-0000-000000000001',
  adultPlayer: '40000000-0000-0000-0000-000000000002',
  staffPlayer: '40000000-0000-0000-0000-000000000003',
  trialPlayer: '40000000-0000-0000-0000-000000000004',
  constrainedPlayer: '40000000-0000-0000-0000-000000000005',
  enabledMatch: '50000000-0000-0000-0000-000000000001',
  disabledMatch: '50000000-0000-0000-0000-000000000002',
  preexistingMatch: '50000000-0000-0000-0000-000000000003',
  adultRequest: '60000000-0000-0000-0000-000000000001',
}

async function setActor(db, actorId = '') {
  await db.query(
    `select set_config('request.jwt.claims', $1, false)`,
    [actorId ? JSON.stringify({ sub: actorId }) : ''],
  )
}

async function createDatabase() {
  const db = new PGlite()
  const migration = await readFile(migrationUrl, 'utf8')
  const privilegeMigration = await readFile(privilegeMigrationUrl, 'utf8')

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
      role text,
      role_label text
    );

    create table public.match_days (
      id uuid primary key,
      club_id uuid not null,
      team_id uuid not null,
      status text not null default 'scheduled',
      previous_hidden_at timestamptz,
      deleted_at timestamptz
    );

    create table public.players (
      id uuid primary key,
      club_id uuid not null,
      team_id uuid not null,
      player_name text not null,
      section text not null,
      status text not null default 'active'
    );

    create table public.parent_player_links (
      id uuid primary key,
      auth_user_id uuid,
      player_id uuid not null,
      status text not null
    );

    create table public.match_day_availability_requests (
      id uuid primary key,
      match_day_id uuid not null,
      club_id uuid not null,
      team_id uuid,
      player_id uuid not null,
      recipient_type text not null,
      status text not null
    );

    create table public.calendar_event_invites (
      id uuid primary key default gen_random_uuid(),
      match_day_id uuid,
      club_id uuid not null,
      team_id uuid not null,
      player_id uuid not null,
      invite_status text not null,
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
      updated_at timestamptz default timezone('utc', now()),
      unique (match_day_id, player_id)
    );

    create table public.match_day_player_squad_decisions (
      id uuid primary key default gen_random_uuid(),
      match_day_id uuid not null,
      club_id uuid not null,
      team_id uuid not null,
      player_id uuid not null,
      status text not null,
      decided_by uuid,
      decided_by_name text not null,
      decided_at timestamptz not null,
      created_at timestamptz not null default timezone('utc', now()),
      updated_at timestamptz not null default timezone('utc', now()),
      constraint match_day_player_squad_decisions_match_player_key unique (match_day_id, player_id)
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

    insert into public.users (id, role, role_label)
    values
      ('${IDS.staff}', 'manager', 'Manager'),
      ('${IDS.parent}', 'parent_portal', 'Parent');

    insert into public.players (id, club_id, team_id, player_name, section)
    values
      ('${IDS.parentPlayer}', '${IDS.club}', '${IDS.team}', 'Parent Player', 'Squad'),
      ('${IDS.adultPlayer}', '${IDS.club}', '${IDS.team}', 'Adult Player', 'Squad'),
      ('${IDS.staffPlayer}', '${IDS.club}', '${IDS.team}', 'Staff Player', 'Squad'),
      ('${IDS.trialPlayer}', '${IDS.club}', '${IDS.team}', 'Trial Player', 'Trial'),
      ('${IDS.constrainedPlayer}', '${IDS.club}', '${IDS.team}', 'Constraint Player', 'Squad');

    insert into public.parent_player_links (id, auth_user_id, player_id, status)
    values ('${IDS.parentLink}', '${IDS.parent}', '${IDS.parentPlayer}', 'active');

    insert into public.match_days (id, club_id, team_id)
    values
      ('${IDS.disabledMatch}', '${IDS.club}', '${IDS.team}'),
      ('${IDS.preexistingMatch}', '${IDS.club}', '${IDS.team}');

    insert into public.match_day_player_availability (
      match_day_id, club_id, team_id, player_id, player_name, status, selected_by_name
    )
    values (
      '${IDS.preexistingMatch}', '${IDS.club}', '${IDS.team}', '${IDS.staffPlayer}',
      'Staff Player', 'available', 'Existing responder'
    );
  `)

  await db.exec(migration)
  await db.exec(privilegeMigration)
  await db.exec(await readFile(activePlayerMigrationUrl, 'utf8'))

  await db.exec(`
    insert into public.match_days (id, club_id, team_id)
    values ('${IDS.enabledMatch}', '${IDS.club}', '${IDS.team}');

    insert into public.calendar_event_invites (
      match_day_id, club_id, team_id, player_id, invite_status
    )
    values
      ('${IDS.enabledMatch}', '${IDS.club}', '${IDS.team}', '${IDS.parentPlayer}', 'active'),
      ('${IDS.enabledMatch}', '${IDS.club}', '${IDS.team}', '${IDS.staffPlayer}', 'active'),
      ('${IDS.enabledMatch}', '${IDS.club}', '${IDS.team}', '${IDS.trialPlayer}', 'active'),
      ('${IDS.enabledMatch}', '${IDS.club}', '${IDS.team}', '${IDS.constrainedPlayer}', 'active'),
      ('${IDS.disabledMatch}', '${IDS.club}', '${IDS.team}', '${IDS.staffPlayer}', 'active');

    insert into public.match_day_availability_requests (
      id, match_day_id, club_id, team_id, player_id, recipient_type, status
    )
    values (
      '${IDS.adultRequest}', '${IDS.enabledMatch}', '${IDS.club}', '${IDS.team}',
      '${IDS.adultPlayer}', 'player', 'pending'
    );
  `)

  return db
}

async function addAvailableResponse(db, {
  matchId = IDS.enabledMatch,
  name,
  parentLinkId = null,
  playerId,
  requestId = null,
}) {
  await db.query(`
    insert into public.match_day_player_availability (
      match_day_id, club_id, team_id, player_id, player_name, status,
      selected_by_parent_link_id, selected_by_request_id, selected_by_name, selected_at
    )
    values ($1, $2, $3, $4, $5, 'available', $6, $7, $8, timezone('utc', now()))
  `, [matchId, IDS.club, IDS.team, playerId, name, parentLinkId, requestId, `${name} responder`])
}

test('migration retains existing fixtures and responses without retroactive selection', async () => {
  const db = await createDatabase()
  const evidence = await db.query(`
    select
      (select auto_select_available_players from public.match_days where id = $1) as existing_enabled,
      (select auto_select_available_players from public.match_days where id = $2) as new_enabled,
      (select count(*)::int from public.match_day_player_squad_decisions) as selection_count,
      (select count(*)::int from public.match_day_event_log) as event_count
  `, [IDS.preexistingMatch, IDS.enabledMatch])

  assert.deepEqual(evidence.rows[0], {
    event_count: 0,
    existing_enabled: false,
    new_enabled: true,
    selection_count: 0,
  })
  await db.close()
})

test('parent, adult direct, and staff on-behalf Available responses select once with source audit', async () => {
  const db = await createDatabase()

  await setActor(db, IDS.parent)
  await addAvailableResponse(db, {
    name: 'Parent Player',
    parentLinkId: IDS.parentLink,
    playerId: IDS.parentPlayer,
  })

  await setActor(db)
  await addAvailableResponse(db, {
    name: 'Adult Player',
    playerId: IDS.adultPlayer,
    requestId: IDS.adultRequest,
  })

  await setActor(db, IDS.staff)
  await addAvailableResponse(db, {
    name: 'Staff Player',
    playerId: IDS.staffPlayer,
  })

  const evidence = await db.query(`
    select
      (select count(*)::int from public.match_day_player_squad_decisions where status = 'selected') as selected_count,
      (select count(*)::int from public.match_day_event_log where metadata->>'responseSource' = 'parent_managed') as parent_events,
      (select count(*)::int from public.match_day_event_log where metadata->>'responseSource' = 'adult_direct') as adult_events,
      (select count(*)::int from public.match_day_event_log where metadata->>'responseSource' = 'staff_on_behalf') as staff_events,
      (select count(*)::int from public.audit_logs where metadata->>'automaticSelectionSucceeded' = 'true') as successful_audits
  `)

  assert.deepEqual(evidence.rows[0], {
    adult_events: 1,
    parent_events: 1,
    selected_count: 3,
    staff_events: 1,
    successful_audits: 3,
  })

  const countsBeforeRetry = await db.query(`
    select
      (select count(*)::int from public.match_day_player_squad_decisions) as selections,
      (select count(*)::int from public.match_day_event_log) as events,
      (select count(*)::int from public.audit_logs) as audits
  `)

  await db.query(`
    update public.match_day_player_availability
    set selected_at = timezone('utc', now())
    where match_day_id = $1 and player_id = $2
  `, [IDS.enabledMatch, IDS.parentPlayer])

  const countsAfterRetry = await db.query(`
    select
      (select count(*)::int from public.match_day_player_squad_decisions) as selections,
      (select count(*)::int from public.match_day_event_log) as events,
      (select count(*)::int from public.audit_logs) as audits
  `)
  assert.deepEqual(countsAfterRetry.rows[0], countsBeforeRetry.rows[0])
  await db.close()
})

test('disabled setting changes only availability and later Unavailable never deselects', async () => {
  const db = await createDatabase()
  await setActor(db, IDS.staff)

  await addAvailableResponse(db, {
    matchId: IDS.disabledMatch,
    name: 'Staff Player',
    playerId: IDS.staffPlayer,
  })
  await addAvailableResponse(db, {
    name: 'Parent Player',
    parentLinkId: IDS.parentLink,
    playerId: IDS.parentPlayer,
  })
  await db.query(`
    update public.match_day_player_availability
    set status = 'unavailable'
    where match_day_id = $1 and player_id = $2
  `, [IDS.enabledMatch, IDS.parentPlayer])

  const evidence = await db.query(`
    select
      (select count(*)::int from public.match_day_player_squad_decisions where match_day_id = $1) as disabled_selections,
      (select status from public.match_day_player_availability where match_day_id = $1) as disabled_availability,
      (select metadata->>'failureCategory' from public.match_day_event_log where match_day_id = $1) as disabled_reason,
      (select status from public.match_day_player_squad_decisions where match_day_id = $2 and player_id = $3) as retained_selection,
      (select status from public.match_day_player_availability where match_day_id = $2 and player_id = $3) as later_availability
  `, [IDS.disabledMatch, IDS.enabledMatch, IDS.parentPlayer])

  assert.deepEqual(evidence.rows[0], {
    disabled_availability: 'available',
    disabled_reason: 'disabled',
    disabled_selections: 0,
    later_availability: 'unavailable',
    retained_selection: 'selected',
  })
  await db.close()
})

test('eligibility and selection constraints preserve Available with safe staff-visible failure metadata', async () => {
  const db = await createDatabase()
  await setActor(db, IDS.staff)

  await db.query(`update public.players set status = 'archived' where id = $1`, [IDS.trialPlayer])

  await addAvailableResponse(db, {
    name: 'Trial Player',
    playerId: IDS.trialPlayer,
  })

  await db.exec(`
    alter table public.match_day_player_squad_decisions
      add constraint qa_capacity_constraint
      check (player_id <> '${IDS.constrainedPlayer}');
  `)
  await addAvailableResponse(db, {
    name: 'Constraint Player',
    playerId: IDS.constrainedPlayer,
  })

  const evidence = await db.query(`
    select
      (select count(*)::int from public.match_day_player_availability
        where player_id in ($1, $2) and status = 'available') as available_count,
      (select count(*)::int from public.match_day_player_squad_decisions
        where player_id in ($1, $2)) as selection_count,
      (select metadata->>'failureCategory' from public.match_day_event_log
        where player_id = $1 order by created_at desc limit 1) as eligibility_failure,
      (select metadata->>'failureCategory' from public.match_day_event_log
        where player_id = $2 order by created_at desc limit 1) as constraint_failure,
      (select metadata->>'automaticSelectionSucceeded' from public.match_day_event_log
        where player_id = $2 order by created_at desc limit 1) as constraint_succeeded
  `, [IDS.trialPlayer, IDS.constrainedPlayer])

  assert.deepEqual(evidence.rows[0], {
    available_count: 2,
    constraint_failure: 'selection_constraint',
    constraint_succeeded: 'false',
    eligibility_failure: 'ineligible_player',
    selection_count: 0,
  })
  await db.close()
})

test('invited active Trial players are selected without promotion and repeated Available is idempotent', async () => {
  const db = await createDatabase()
  await db.query(`update public.parent_player_links set player_id = $1 where id = $2`, [IDS.trialPlayer, IDS.parentLink])
  await setActor(db, IDS.parent)
  await addAvailableResponse(db, { name: 'Trial Player', playerId: IDS.trialPlayer, parentLinkId: IDS.parentLink })
  await db.query(`update public.match_day_player_availability set status = 'available' where player_id = $1`, [IDS.trialPlayer])
  const result = await db.query(`
    select p.section, p.status as player_status, a.status as availability, d.status as decision,
      (select count(*)::int from public.match_day_event_log where metadata->>'automaticSelectionSucceeded' = 'true') as success_events,
      (select count(*)::int from public.audit_logs where metadata->>'responseSource' = 'parent_managed') as parent_audits
    from public.players p
    join public.match_day_player_availability a on a.player_id = p.id
    left join public.match_day_player_squad_decisions d on d.player_id = p.id
    where p.id = $1
  `, [IDS.trialPlayer])
  assert.deepEqual(result.rows[0], {
    section: 'Trial', player_status: 'active', availability: 'available', decision: 'selected',
    success_events: 1, parent_audits: 1,
  })
  await db.close()
})

test('Trial selection retains invitation, team, club and fixture lifecycle boundaries', async () => {
  const cases = [
    ["delete from public.calendar_event_invites", 'not_invited'],
    ["update public.calendar_event_invites set invite_status = 'cancelled', cancelled_at = now()", 'not_invited'],
    ["update public.players set team_id = '20000000-0000-0000-0000-000000000099'", 'ineligible_player'],
    ["update public.players set club_id = '10000000-0000-0000-0000-000000000099'", 'ineligible_player'],
    ["update public.match_days set status = 'live'", 'lifecycle_locked'],
    ["update public.match_days set deleted_at = now()", 'archived_fixture'],
  ]
  for (const [change, expectedFailure] of cases) {
    const db = await createDatabase()
    try {
      await db.exec(change)
      await addAvailableResponse(db, { name: 'Trial Player', playerId: IDS.trialPlayer })
      const result = await db.query(`
        select (select count(*)::int from public.match_day_player_squad_decisions) as selections,
          (select status from public.match_day_player_availability where player_id = $1) as availability,
          (select metadata->>'failureCategory' from public.match_day_event_log where player_id = $1) as failure
      `, [IDS.trialPlayer])
      assert.deepEqual(result.rows[0], { selections: 0, availability: 'available', failure: expectedFailure }, change)
    } finally {
      await db.close()
    }
  }
})

test('training attendance remains independent from match selection', async () => {
  const db = await createDatabase()
  await db.exec(`
    create table public.training_availability_responses (
      id uuid primary key default gen_random_uuid(),
      player_id uuid not null,
      status text not null
    );
    insert into public.training_availability_responses (player_id, status)
    values ('${IDS.parentPlayer}', 'available');
  `)

  const evidence = await db.query(`
    select
      (select status from public.training_availability_responses limit 1) as training_status,
      (select count(*)::int from public.match_day_player_squad_decisions) as selection_count,
      (select count(*)::int from public.match_day_event_log) as event_count
  `)
  assert.deepEqual(evidence.rows[0], {
    event_count: 0,
    selection_count: 0,
    training_status: 'available',
  })
  await db.close()
})
