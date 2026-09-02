import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { test } from 'node:test'

import { PGlite } from '@electric-sql/pglite'

const migrationUrl = new URL('../supabase/migrations/20260731110000_fp_v1_gameday_scorer_authority_02a.sql', import.meta.url)
const domainUrl = new URL('../src/lib/domain/match-day.js', import.meta.url)
const matchDayPageUrl = new URL('../src/pages/MatchDayPage.jsx', import.meta.url)
const volunteerFunctionUrl = new URL('../netlify/functions/select-match-day-volunteer.js', import.meta.url)
const pushFunctionUrl = new URL('../netlify/functions/send-match-day-push.js', import.meta.url)
const hardeningDbTestUrl = new URL('./matchday-parent-scorer-hardening-db.test.mjs', import.meta.url)

const ids = {
  club: '10000000-0000-4000-8000-000000000001',
  team: '20000000-0000-4000-8000-000000000001',
  staff: '30000000-0000-4000-8000-000000000001',
  scorer: '30000000-0000-4000-8000-000000000002',
  replacementScorer: '30000000-0000-4000-8000-000000000003',
  player: '40000000-0000-4000-8000-000000000001',
  replacementPlayer: '40000000-0000-4000-8000-000000000002',
  scorerLink: '50000000-0000-4000-8000-000000000001',
  replacementLink: '50000000-0000-4000-8000-000000000002',
  match: '60000000-0000-4000-8000-000000000001',
  request: '70000000-0000-4000-8000-000000000001',
  secondRequest: '70000000-0000-4000-8000-000000000002',
}

async function setActor(db, actorId) {
  await db.query("select set_config('request.jwt.claim.sub', $1, false)", [actorId])
  await db.query("select set_config('request.jwt.claim.name', 'FP TEST Actor', false)")
  await db.query("select set_config('request.jwt.claim.email', 'fp-test@example.test', false)")
}

test('02A makes scorer authority dual-assignment, server-date, and lifecycle qualified', async () => {
  const migration = await readFile(migrationUrl, 'utf8')
  const authorityStart = migration.indexOf('create or replace function public.current_user_is_match_day_scorer')
  const authorityEnd = migration.indexOf('create or replace function public.get_parent_scorer_game_mode_match_ids', authorityStart)
  const authority = migration.slice(authorityStart, authorityEnd)

  assert.notEqual(authorityStart, -1)
  assert.notEqual(authorityEnd, -1)
  assert.match(migration, /add column if not exists timezone_name text not null default 'Europe\/London'/)
  assert.match(migration, /match_day\.match_date = timezone\([\s\S]*statement_timestamp\(\)[\s\S]*\)::date/)
  assert.match(authority, /current_user_has_match_day_scorer_assignment/)
  assert.match(authority, /match_day_local_date_is_today/)
  assert.match(authority, /match_day\.concluded_at is null/)
  assert.match(authority, /match_day\.status not in \('cancelled', 'postponed'\)/)
  assert.doesNotMatch(authority, /current_date|localStorage|Date\.now/)
})

test('02A rejects direct gameplay writes and pre-start or completed mutation', async () => {
  const migration = await readFile(migrationUrl, 'utf8')

  assert.match(migration, /create trigger match_days_enforce_gameplay_write/)
  assert.match(migration, /current_user in \('anon', 'authenticated'\)/)
  assert.match(migration, /Start the match before changing the score\./)
  assert.match(migration, /A concluded match is read only\./)
  assert.match(migration, /create trigger match_day_events_enforce_write/)
  assert.match(migration, /Start the match before recording or changing an event\./)
  assert.match(migration, /revoke insert, update, delete on public\.match_day_events from anon, authenticated/)
  assert.match(migration, /status in \('full_time', 'cancelled', 'postponed'\)/)
})

test('02A goal, score, and staff event writes are locked, transactional, and idempotent', async () => {
  const migration = await readFile(migrationUrl, 'utf8')

  assert.match(migration, /create unique index if not exists match_day_events_match_request_key/)

  for (const functionName of [
    'record_match_day_goal_v2',
    'record_match_day_score_correction_v2',
    'record_match_day_staff_event_v2',
  ]) {
    const start = migration.indexOf(`create or replace function public.${functionName}`)
    const end = migration.indexOf('revoke all on function', start)
    const section = migration.slice(start, end)

    assert.notEqual(start, -1, `${functionName} should exist`)
    assert.notEqual(end, -1, `${functionName} should have a grant boundary`)
    assert.match(section, /for update/)
    assert.match(section, /request_id_value is null/)
    assert.match(section, /where match_day_id = match_day_id_value[\s\S]*and request_id = request_id_value/)
    assert.match(section, /return to_jsonb\(event_row\)/)
    assert.ok(
      section.indexOf('for update;') < section.indexOf('and request_id = request_id_value;'),
      `${functionName} should lock the match before resolving an idempotent replay`,
    )
  }

  const goalStart = migration.indexOf('create or replace function public.record_match_day_goal_v2')
  const goalEnd = migration.indexOf('revoke all on function public.record_match_day_goal_v2', goalStart)
  const goal = migration.slice(goalStart, goalEnd)
  assert.match(goal, /update public\.match_days[\s\S]*insert into public\.match_day_events/)
  assert.match(goal, /public\.resolve_match_day_mutation_actor/)
})

test('02A scorer selection updates canonical and legacy assignment in one server transaction', async () => {
  const [migration, selectionFunction] = await Promise.all([
    readFile(migrationUrl, 'utf8'),
    readFile(volunteerFunctionUrl, 'utf8'),
  ])
  const syncStart = migration.indexOf('create or replace function public.sync_match_day_scorer_assignment')
  const syncEnd = migration.indexOf('revoke all on function public.sync_match_day_scorer_assignment', syncStart)
  const sync = migration.slice(syncStart, syncEnd)

  assert.match(migration, /create unique index if not exists match_day_scorer_assignments_match_key/)
  assert.match(sync, /insert into public\.match_day_role_assignments/)
  assert.match(sync, /on conflict \(match_day_id, role\)/)
  assert.match(sync, /insert into public\.match_day_scorer_assignments/)
  assert.match(sync, /on conflict \(match_day_id\)/)
  assert.match(sync, /delete from public\.match_day_role_assignments[\s\S]*delete from public\.match_day_scorer_assignments/)
  assert.match(selectionFunction, /adminSupabase\.rpc\('sync_match_day_scorer_assignment'/)
  assert.doesNotMatch(selectionFunction, /function syncLegacyScorerAssignment/)
})

test('02A push delivery is server-authorized, server-targeted, and idempotent', async () => {
  const [migration, pushFunction] = await Promise.all([
    readFile(migrationUrl, 'utf8'),
    readFile(pushFunctionUrl, 'utf8'),
  ])
  const authorizeStart = migration.indexOf('create or replace function public.authorize_match_day_push')
  const authorizeEnd = migration.indexOf('revoke all on function public.authorize_match_day_push', authorizeStart)
  const authorize = migration.slice(authorizeStart, authorizeEnd)

  assert.match(authorize, /normalized_type not in/)
  assert.match(authorize, /public\.team_staff/)
  assert.match(authorize, /match_day_role_assignments[\s\S]*match_day_scorer_assignments/)
  assert.match(authorize, /match_row\.match_date = timezone/)
  assert.match(authorize, /event_type = normalized_type/)
  assert.match(authorize, /array_agg\(distinct parent_link\.id\)/)
  assert.match(migration, /create unique index if not exists match_day_push_operations_operation_key_key/)
  assert.match(migration, /create or replace function public.claim_match_day_push_operation/)
  assert.match(migration, /create or replace function public.complete_match_day_push_operation/)
  assert.match(pushFunction, /supabaseAdmin\.rpc\('authorize_match_day_push'/)
  assert.match(pushFunction, /supabaseAdmin\.rpc\('claim_match_day_push_operation'/)
  assert.match(pushFunction, /supabaseAdmin\.rpc\('complete_match_day_push_operation'/)
  assert.match(pushFunction, /if \(targetParentLinkIds\.length === 0\) \{[\s\S]*return \[\]/)
  assert.doesNotMatch(pushFunction, /body\.targetParentLinkIds/)
})

test('02A clients use transactional RPCs and live staff polling refreshes active detail without role fan-out', async () => {
  const [domain, page] = await Promise.all([
    readFile(domainUrl, 'utf8'),
    readFile(matchDayPageUrl, 'utf8'),
  ])

  assert.match(domain, /supabase\.rpc\('record_match_day_goal_v2'/)
  assert.match(domain, /supabase\.rpc\('record_match_day_score_correction_v2'/)
  assert.match(domain, /supabase\.rpc\('record_match_day_staff_event_v2'/)
  assert.match(domain, /supabase\.rpc\('get_parent_scorer_game_mode_match_ids'/)
  assert.doesNotMatch(domain, /\.from\('match_day_events'\)[\s\S]{0,180}\.insert\(/)
  assert.match(page, /MATCH_DAY_LIVE_DETAIL_STATUSES/)
  const liveStatusesStart = page.indexOf('const MATCH_DAY_LIVE_DETAIL_STATUSES')
  const liveStatusesEnd = page.indexOf('function mergeMatchDaySummaries', liveStatusesStart)
  const liveStatusesSource = page.slice(liveStatusesStart, liveStatusesEnd)
  const liveRefreshStart = page.indexOf('async function refreshLiveMatches()')
  const liveRefreshEnd = page.indexOf('const intervalId = window.setInterval', liveRefreshStart)
  const liveRefreshSource = page.slice(liveRefreshStart, liveRefreshEnd)

  assert.doesNotMatch(liveStatusesSource, /'full_time'/)
  assert.match(liveRefreshSource, /Promise\.allSettled\([\s\S]*getMatchDay\(\{ user, matchDayId: match\.id \}\)/)
  assert.doesNotMatch(liveRefreshSource, /includeScorerEligibility|select-match-day-volunteer/)
  assert.match(page, /refreshedDetailsById/)
})

test('02A migration applies transactionally and enforces date, idempotency, assignment, and push contracts', async () => {
  const [migration, hardeningDbTest] = await Promise.all([
    readFile(migrationUrl, 'utf8'),
    readFile(hardeningDbTestUrl, 'utf8'),
  ])
  const schemaMatch = hardeningDbTest.match(/const schemaSql = `([\s\S]*?)`;\r?\n\r?\nasync function setActor/)
  assert.ok(schemaMatch, 'Expected reusable Match Day disposable schema')

  const candidate = await readFile(new URL('../supabase/migrations/20260902101356_parent_invites_scorer_repair.sql', import.meta.url), 'utf8')
  const parentAuthority = await readFile(new URL('../supabase/migrations/20260825133414_cross_club_parent_link_authority_100.sql', import.meta.url), 'utf8')
  const scorerHelper = candidate.match(/create or replace function public\.current_user_has_match_day_scorer_assignment[\s\S]*?\$\$;/)?.[0]
  const parentHelper = parentAuthority.match(/create or replace function public\.current_user_can_access_parent_link\([\s\S]*?\$\$;/)?.[0]
  assert.ok(scorerHelper && parentHelper)
  const db = new PGlite()
  try {
    await db.exec(schemaMatch[1])
    await db.exec(`
      create table auth.users (id uuid primary key);
      alter table public.clubs add column status text default 'active';
      alter table public.users
        add column name text,
        add column email text,
        add column role_rank integer not null default 0;
      create table public.team_staff (
        id uuid primary key default gen_random_uuid(),
        team_id uuid not null,
        user_id uuid not null
      );
      alter table public.match_days
        add column match_date date,
        add column request_scorer boolean not null default false,
        add column current_match_phase text not null default 'pre_match',
        add column normal_time_home_score integer,
        add column normal_time_away_score integer,
        add column extra_time_home_score integer,
        add column extra_time_away_score integer,
        add column home_shootout_score integer not null default 0,
        add column away_shootout_score integer not null default 0,
        add column shootout_winner text,
        add column notification_revision bigint not null default 1;
      alter table public.match_day_role_assignments
        add column assigned_by uuid,
        add column assigned_by_name text,
        add column created_at timestamptz not null default now(),
        add column updated_at timestamptz not null default now();
      create unique index match_day_role_assignments_match_role_key
        on public.match_day_role_assignments (match_day_id, role);
      alter table public.match_day_scorer_assignments
        add column assigned_by uuid,
        add column assigned_by_name text,
        add column created_at timestamptz not null default now();
      alter table public.match_day_events
        add column is_penalty_goal boolean not null default false,
        add column match_phase text not null default 'pre_match',
        add column phase_order integer not null default 0,
        add column stoppage_minute integer,
        add column event_sequence bigint not null default 1;
      create function public.current_user_has_match_day_scorer_assignment(target_match_day_id uuid)
      returns boolean language sql stable security definer set search_path = pg_catalog, public as $$
        select exists (
          select 1
          from public.match_days match_day
          join public.match_day_role_assignments role_assignment
            on role_assignment.match_day_id = match_day.id
           and role_assignment.role = 'scorer'
          join public.match_day_scorer_assignments legacy_assignment
            on legacy_assignment.match_day_id = role_assignment.match_day_id
           and legacy_assignment.parent_link_id = role_assignment.parent_link_id
           and legacy_assignment.auth_user_id = role_assignment.auth_user_id
          join public.parent_player_links parent_link
            on parent_link.id = role_assignment.parent_link_id
           and parent_link.auth_user_id = role_assignment.auth_user_id
           and parent_link.status = 'active'
          join public.players player
            on player.id = parent_link.player_id
           and player.status <> 'archived'
          where match_day.id = target_match_day_id
            and match_day.deleted_at is null
            and role_assignment.auth_user_id = auth.uid()
        );
      $$;
      create function public.match_day_phase_order(value text)
      returns integer language sql immutable as $$
        select case value when 'first_half' then 10 when 'second_half' then 30 else 0 end;
      $$;
      grant select, update on public.match_days to authenticated;
    `)

    await db.exec('begin')
    await db.exec(migration)
    const inTransaction = await db.query(
      "select to_regprocedure('public.record_match_day_goal_v2(uuid,uuid,text,text,text,text,text,integer,text,boolean,uuid)') is not null as present",
    )
    assert.equal(inTransaction.rows[0].present, true)
    await db.exec('rollback')
    const afterRollback = await db.query(
      "select to_regprocedure('public.record_match_day_goal_v2(uuid,uuid,text,text,text,text,text,integer,text,boolean,uuid)') is not null as present",
    )
    assert.equal(afterRollback.rows[0].present, false)
    await db.exec(migration)
    await db.exec(parentHelper)
    await db.exec(scorerHelper)
    const followup = await readFile(new URL('../supabase/migrations/20260902104350_parent_save_notifications_followup.sql', import.meta.url), 'utf8')
    await db.exec('alter table public.match_day_events add constraint match_day_events_minute_check check (minute is null or (minute >= 0 and minute <= 130))')
    await db.exec(followup.slice(0, followup.indexOf('CREATE OR REPLACE FUNCTION')))
    await db.exec(followup.match(/CREATE OR REPLACE FUNCTION public\.record_match_day_goal_v2[\s\S]*?\$function\$;/)[0])

    await db.query('insert into auth.users(id) values ($1), ($2), ($3)', [ids.staff, ids.scorer, ids.replacementScorer])
    await db.query("insert into public.clubs(id, timezone_name) values ($1, 'Europe/London')", [ids.club])
    await db.query('insert into public.teams(id, club_id) values ($1, $2)', [ids.team, ids.club])
    await db.query(
      `insert into public.users(id, club_id, role, status, name, email, role_rank) values
        ($1, $2, 'coach', 'active', 'FP TEST Coach', 'coach@example.test', 30),
        ($3, $2, 'parent_portal', 'active', 'FP TEST Scorer', 'scorer@example.test', 0),
        ($4, $2, 'parent_portal', 'active', 'FP TEST Replacement', 'replacement@example.test', 0)`,
      [ids.staff, ids.club, ids.scorer, ids.replacementScorer],
    )
    await db.query('insert into public.team_staff(team_id, user_id) values ($1, $2)', [ids.team, ids.staff])
    await db.query(
      `insert into public.players(id, club_id, team_id, status) values
        ($1, $2, $3, 'active'), ($4, $2, $3, 'active')`,
      [ids.player, ids.club, ids.team, ids.replacementPlayer],
    )
    await db.query(
      `insert into public.parent_player_links(id, club_id, team_id, player_id, auth_user_id, email, status) values
        ($1, $2, $3, $4, $5, 'scorer@example.test', 'active'),
        ($6, $2, $3, $7, $8, 'replacement@example.test', 'active')`,
      [ids.scorerLink, ids.club, ids.team, ids.player, ids.scorer, ids.replacementLink, ids.replacementPlayer, ids.replacementScorer],
    )
    await db.query(
      `insert into public.match_days(
        id, club_id, team_id, match_date, status, timer_status, current_match_phase, request_scorer
      ) values (
        $1, $2, $3, timezone('Europe/London', statement_timestamp())::date,
        'scheduled', 'not_started', 'pre_match', true
      )`,
      [ids.match, ids.club, ids.team],
    )
    await db.query(
      `insert into public.match_day_role_assignments(match_day_id, club_id, team_id, role, parent_link_id, auth_user_id)
       values ($1, $2, $3, 'scorer', $4, $5)`,
      [ids.match, ids.club, ids.team, ids.scorerLink, ids.scorer],
    )
    await db.query(
      `insert into public.match_day_scorer_assignments(match_day_id, club_id, team_id, parent_link_id, auth_user_id)
       values ($1, $2, $3, $4, $5)`,
      [ids.match, ids.club, ids.team, ids.scorerLink, ids.scorer],
    )

    // Parent accounts use active child links and need no staff profile.
    await db.query('delete from public.users where id = $1', [ids.scorer])
    await setActor(db, ids.scorer)
    let authority = await db.query('select public.current_user_is_match_day_scorer($1) as allowed', [ids.match])
    assert.equal(authority.rows[0].allowed, true)
    await db.query("insert into public.users(id, club_id, role, status) values ($1, $2, 'parent_portal', 'suspended')", [ids.scorer, ids.club])
    assert.equal((await db.query('select public.current_user_is_match_day_scorer($1) as allowed', [ids.match])).rows[0].allowed, false)
    await db.query('delete from public.users where id = $1', [ids.scorer])
    await db.query("update public.match_days set match_date = match_date + 1 where id = $1", [ids.match])
    authority = await db.query('select public.current_user_is_match_day_scorer($1) as allowed', [ids.match])
    assert.equal(authority.rows[0].allowed, false)
    await db.query("update public.match_days set match_date = timezone('Europe/London', statement_timestamp())::date where id = $1", [ids.match])

    await assert.rejects(
      db.query(
        "select public.record_match_day_goal_v2($1, $2, 'club', 'FP TEST Player', '9', '', '', 1, '', false, $3)",
        [ids.match, ids.scorerLink, ids.request],
      ),
      /Start or resume the match before recording a goal/,
    )
    await assert.rejects(
      db.query(
        "select public.record_match_day_score_correction_v2($1, $2, 1, 0, 'Pre-start attempt', $3)",
        [ids.match, ids.scorerLink, ids.secondRequest],
      ),
      /Start or resume the match before correcting the score/,
    )

    await setActor(db, ids.staff)
    await assert.rejects(
      db.query(
        "select public.record_match_day_goal_v2($1, null, 'club', 'FP TEST Player', '9', '', '', 1, '', false, $2)",
        [ids.match, ids.secondRequest],
      ),
      /Start or resume the match before recording a goal/,
    )

    await db.query(
      "update public.match_days set status = 'live', timer_status = 'running', current_match_phase = 'first_half' where id = $1",
      [ids.match],
    )
    await db.exec('set role authenticated')
    await assert.rejects(
      db.query('update public.match_days set home_score = 99 where id = $1', [ids.match]),
      /Use an authorised Match Day action for live score, phase, or clock changes/,
    )
    await assert.rejects(
      db.query(
        `insert into public.match_day_events(
          match_day_id, club_id, team_id, event_type, team_side, home_score, away_score
        ) values ($1, $2, $3, 'goal', 'club', 99, 0)`,
        [ids.match, ids.club, ids.team],
      ),
      /permission denied|Use an authorised Match Day action/,
    )
    await db.exec('reset role')
    await setActor(db, ids.scorer)
    const firstGoal = await db.query(
      "select public.record_match_day_goal_v2($1, $2, 'club', 'FP TEST Player', '9', '', '', 174, '', false, $3) as result",
      [ids.match, ids.scorerLink, ids.request],
    )
    const replayGoal = await db.query(
      "select public.record_match_day_goal_v2($1, $2, 'club', 'FP TEST Player', '9', '', '', 174, '', false, $3) as result",
      [ids.match, ids.scorerLink, ids.request],
    )
    assert.equal(firstGoal.rows[0].result.id, replayGoal.rows[0].result.id)
    assert.equal(firstGoal.rows[0].result.minute, 174)
    await assert.rejects(db.query("select public.record_match_day_goal_v2($1, $2, 'club', '', '', '', '', -1, '', false, $3)", [ids.match, ids.scorerLink, ids.secondRequest]), /Minute must be zero or greater/)
    const replayState = await db.query(
      'select home_score, (select count(*)::integer from public.match_day_events where match_day_id = $1) as event_count from public.match_days where id = $1',
      [ids.match],
    )
    assert.deepEqual(replayState.rows[0], { home_score: 1, event_count: 1 })

    await db.exec(`
      create function public.reject_test_scorer_projection()
      returns trigger language plpgsql as $$
      begin
        if new.parent_link_id = '${ids.replacementLink}'::uuid then
          raise exception 'FP TEST projection failure';
        end if;
        return new;
      end;
      $$;
      create trigger reject_test_scorer_projection_trigger
      before insert or update on public.match_day_scorer_assignments
      for each row execute function public.reject_test_scorer_projection();
    `)
    await assert.rejects(
      db.query(
        'select public.sync_match_day_scorer_assignment($1, $2, $3, $4, true)',
        [ids.match, ids.replacementLink, ids.staff, 'FP TEST Coach'],
      ),
      /FP TEST projection failure/,
    )
    const rolledBackAssignment = await db.query(
      `select
        (select parent_link_id from public.match_day_role_assignments where match_day_id = $1 and role = 'scorer') as role_parent,
        (select parent_link_id from public.match_day_scorer_assignments where match_day_id = $1) as legacy_parent`,
      [ids.match],
    )
    assert.deepEqual(rolledBackAssignment.rows[0], {
      role_parent: ids.scorerLink,
      legacy_parent: ids.scorerLink,
    })
    await db.exec(`
      drop trigger reject_test_scorer_projection_trigger on public.match_day_scorer_assignments;
      drop function public.reject_test_scorer_projection();
    `)

    await db.query(
      'select public.sync_match_day_scorer_assignment($1, $2, $3, $4, true)',
      [ids.match, ids.replacementLink, ids.staff, 'FP TEST Coach'],
    )
    const assignmentState = await db.query(
      `select
        (select count(*)::integer from public.match_day_role_assignments where match_day_id = $1 and role = 'scorer') as role_count,
        (select count(*)::integer from public.match_day_scorer_assignments where match_day_id = $1) as legacy_count,
        (select parent_link_id from public.match_day_role_assignments where match_day_id = $1 and role = 'scorer') as role_parent,
        (select parent_link_id from public.match_day_scorer_assignments where match_day_id = $1) as legacy_parent`,
      [ids.match],
    )
    assert.deepEqual(assignmentState.rows[0], {
      role_count: 1,
      legacy_count: 1,
      role_parent: ids.replacementLink,
      legacy_parent: ids.replacementLink,
    })

    await setActor(db, ids.scorer)
    authority = await db.query('select public.current_user_is_match_day_scorer($1) as allowed', [ids.match])
    assert.equal(authority.rows[0].allowed, false)
    await assert.rejects(
      db.query(
        "select public.record_match_day_goal_v2($1, $2, 'club', 'FP TEST Player', '9', '', '', 2, '', false, $3)",
        [ids.match, ids.scorerLink, ids.secondRequest],
      ),
      /You cannot record goals for this match/,
    )
    const removedScorerPush = await db.query(
      "select public.authorize_match_day_push($1, $2, $3, 'goal', $4) as result",
      [ids.scorer, ids.match, ids.scorerLink, firstGoal.rows[0].result.id],
    )
    assert.equal(removedScorerPush.rows[0].result.allowed, false)

    await setActor(db, ids.replacementScorer)
    authority = await db.query('select public.current_user_is_match_day_scorer($1) as allowed', [ids.match])
    assert.equal(authority.rows[0].allowed, true)

    const pushAuthorization = await db.query(
      "select public.authorize_match_day_push($1, $2, null, 'goal', $3) as result",
      [ids.staff, ids.match, firstGoal.rows[0].result.id],
    )
    assert.equal(pushAuthorization.rows[0].result.allowed, true)
    assert.deepEqual(pushAuthorization.rows[0].result.targetParentLinkIds.sort(), [ids.replacementLink, ids.scorerLink].sort())
    const unsupportedPush = await db.query(
      "select public.authorize_match_day_push($1, $2, null, 'arbitrary_type', null) as result",
      [ids.staff, ids.match],
    )
    assert.equal(unsupportedPush.rows[0].result.allowed, false)
    const operationKey = pushAuthorization.rows[0].result.operationKey
    const firstClaim = await db.query(
      "select public.claim_match_day_push_operation($1, $2, 'goal', $3, $4) as claimed",
      [ids.match, operationKey, firstGoal.rows[0].result.id, ids.staff],
    )
    const replayClaim = await db.query(
      "select public.claim_match_day_push_operation($1, $2, 'goal', $3, $4) as claimed",
      [ids.match, operationKey, firstGoal.rows[0].result.id, ids.staff],
    )
    assert.equal(firstClaim.rows[0].claimed, true)
    assert.equal(replayClaim.rows[0].claimed, false)
    await db.query(
      "select public.complete_match_day_push_operation($1, false, 'Temporary delivery failure')",
      [operationKey],
    )
    const retryClaim = await db.query(
      "select public.claim_match_day_push_operation($1, $2, 'goal', $3, $4) as claimed",
      [ids.match, operationKey, firstGoal.rows[0].result.id, ids.staff],
    )
    assert.equal(retryClaim.rows[0].claimed, true)
    await db.query(
      "select public.complete_match_day_push_operation($1, true, '')",
      [operationKey],
    )
    const completedClaim = await db.query(
      "select public.claim_match_day_push_operation($1, $2, 'goal', $3, $4) as claimed",
      [ids.match, operationKey, firstGoal.rows[0].result.id, ids.staff],
    )
    assert.equal(completedClaim.rows[0].claimed, false)

    for (const closedStatus of ['cancelled', 'postponed']) {
      await db.query('update public.match_days set status = $2 where id = $1', [ids.match, closedStatus])
      await assert.rejects(
        db.query(
          "select public.record_match_day_goal_v2($1, $2, 'club', 'FP TEST Player', '9', '', '', 2, '', false, $3)",
          [ids.match, ids.replacementLink, ids.secondRequest],
        ),
        /Start or resume the match before recording a goal/,
      )
    }

    await db.query("update public.match_days set status = 'live', deleted_at = now() where id = $1", [ids.match])
    await assert.rejects(
      db.query(
        "select public.record_match_day_goal_v2($1, $2, 'club', 'FP TEST Player', '9', '', '', 2, '', false, $3)",
        [ids.match, ids.replacementLink, ids.secondRequest],
      ),
      /This match day could not be found/,
    )

    await db.query(
      "update public.match_days set deleted_at = null, status = 'full_time', timer_status = 'full_time', concluded_at = now() where id = $1",
      [ids.match],
    )
    await assert.rejects(
      db.query(
        "select public.record_match_day_goal_v2($1, $2, 'club', 'FP TEST Player', '9', '', '', 2, '', false, $3)",
        [ids.match, ids.replacementLink, ids.secondRequest],
      ),
      /Start or resume the match before recording a goal/,
    )
    await setActor(db, ids.staff)
    await assert.rejects(
      db.query(
        "select public.record_match_day_score_correction_v2($1, null, 5, 5, 'Completed attempt', $2)",
        [ids.match, ids.secondRequest],
      ),
      /Start or resume the match before correcting the score/,
    )
    const concludedPush = await db.query(
      "select public.authorize_match_day_push($1, $2, $3, 'goal', $4) as result",
      [ids.replacementScorer, ids.match, ids.replacementLink, firstGoal.rows[0].result.id],
    )
    assert.equal(concludedPush.rows[0].result.allowed, false)
  } finally {
    await db.close()
  }
})
