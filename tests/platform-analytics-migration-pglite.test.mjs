import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'
import { PGlite } from '@electric-sql/pglite'

const migration = await readFile(
  new URL('../supabase/migrations/20260728050210_platform_analytics_foundation.sql', import.meta.url),
  'utf8',
)
const eventFoundationMigration = await readFile(
  new URL('../supabase/migrations/20260731224352_analytics_event_foundation_14a.sql', import.meta.url),
  'utf8',
)
const clubAdminRoleAlignmentMigration = await readFile(
  new URL('../supabase/migrations/20260731230057_analytics_club_admin_role_alignment_14a.sql', import.meta.url),
  'utf8',
)
const quarantineConflictAlignmentMigration = await readFile(
  new URL('../supabase/migrations/20260731231726_analytics_quarantine_conflict_alignment_14a.sql', import.meta.url),
  'utf8',
)
const atomicProcessorCompletionMigration = await readFile(
  new URL('../supabase/migrations/20260731233958_analytics_processor_atomic_completion_14a.sql', import.meta.url),
  'utf8',
)
const identityAdoptionMigration = await readFile(
  new URL('../supabase/migrations/20260801010209_analytics_identity_adoption_14b.sql', import.meta.url),
  'utf8',
)
const dashboardHeatmapsMigration = await readFile(
  new URL('../supabase/migrations/20260801012822_analytics_dashboard_heatmaps_14c.sql', import.meta.url),
  'utf8',
)
const canonicalTrustMigration = await readFile(
  new URL('../supabase/migrations/20260808113130_platform_analytics_canonical_trust_v4.sql', import.meta.url),
  'utf8',
)
const metricAuthorityIntegrityMigration = await readFile(
  new URL('../supabase/migrations/20260824095919_platform_metric_authority_integrity.sql', import.meta.url),
  'utf8',
)

const IDS = Object.freeze({
  club: '10000000-0000-4000-8000-000000000001',
  team: '20000000-0000-4000-8000-000000000001',
  staff: '30000000-0000-4000-8000-000000000001',
  parent: '30000000-0000-4000-8000-000000000002',
  directStaff: '30000000-0000-4000-8000-000000000003',
  staleProfileParent: '30000000-0000-4000-8000-000000000004',
  suspendedParent: '30000000-0000-4000-8000-000000000005',
  teamTwo: '20000000-0000-4000-8000-000000000002',
  player: '40000000-0000-4000-8000-000000000001',
  playerTwo: '40000000-0000-4000-8000-000000000002',
  playerThree: '40000000-0000-4000-8000-000000000003',
  playerFour: '40000000-0000-4000-8000-000000000004',
  emptyClub: '10000000-0000-4000-8000-000000000002',
})

async function createDatabase() {
  const db = new PGlite()
  await db.exec(`
    create role anon;
    create role authenticated;
    create role service_role bypassrls;

    create table public.clubs (
      id uuid primary key,
      name text not null,
      plan_key text not null default 'small_club',
      created_at timestamptz not null default now(),
      status text not null default 'active',
      archived_at timestamptz
    );

    create table public.teams (
      id uuid primary key,
      club_id uuid not null references public.clubs(id),
      name text not null,
      created_at timestamptz not null default now(),
      status text not null default 'active',
      archived_at timestamptz
    );

    create table public.users (
      id uuid primary key,
      club_id uuid references public.clubs(id),
      role text not null,
      status text not null default 'active',
      email text,
      name text,
      username text,
      display_name text
    );

    create table public.players (
      id uuid primary key,
      club_id uuid not null references public.clubs(id),
      team_id uuid not null references public.teams(id),
      status text not null default 'active',
      created_at timestamptz not null default now(),
      archived_at timestamptz
    );

    create table public.parent_player_links (
      id uuid primary key default gen_random_uuid(),
      club_id uuid not null,
      team_id uuid not null,
      player_id uuid not null,
      parent_link_id uuid,
      guardian_id uuid,
      auth_user_id uuid,
      status text not null,
      accepted_at timestamptz,
      invite_sent_at timestamptz
    );

    create table public.team_staff (
      id uuid primary key default gen_random_uuid(),
      team_id uuid not null,
      user_id uuid not null,
      role_key text,
      created_at timestamptz not null default now()
    );

    create table public.club_user_invites (
      id uuid primary key default gen_random_uuid(),
      club_id uuid not null,
      invite_sent_at timestamptz
    );

    create table public.evaluations (
      id uuid primary key default gen_random_uuid(),
      club_id uuid not null references public.clubs(id),
      team_id uuid references public.teams(id),
      status text not null default 'Submitted',
      created_at timestamptz not null default now()
    );

    create function public.workspace_scope_for_plan_key(plan_key_value text)
    returns text
    language sql
    immutable
    as $$
      select case
        when plan_key_value = 'individual' then 'individual'
        when plan_key_value = 'single_team' then 'team'
        when plan_key_value in ('small_club', 'development_club', 'large_club', 'pilot') then 'club'
        else 'unknown'
      end;
    $$;

    insert into public.clubs (id, name) values ('${IDS.club}', 'Analytics Test Club');
    insert into public.teams (id, club_id, name) values ('${IDS.team}', '${IDS.club}', 'Analytics Test Team');
    insert into public.teams (id, club_id, name) values ('${IDS.teamTwo}', '${IDS.club}', 'Analytics Test Team Two');
    insert into public.users (id, club_id, role) values
      ('${IDS.staff}', '${IDS.club}', 'coach'),
      ('${IDS.parent}', '${IDS.club}', 'parent_portal');
  `)
  await db.exec(migration)
  await db.exec(eventFoundationMigration)
  await db.exec(clubAdminRoleAlignmentMigration)
  await db.exec(quarantineConflictAlignmentMigration)
  await db.exec(atomicProcessorCompletionMigration)
  await db.exec(identityAdoptionMigration)
  await db.exec(dashboardHeatmapsMigration)
  await db.exec(canonicalTrustMigration)
  // The canonical v4 migration now contains the Parent-link rollup fix. The
  // historical follow-up migration is already applied in production and does
  // not need to be replayed against the corrected source in this fresh schema.
  await db.exec(metricAuthorityIntegrityMigration)
  return db
}

async function insertFixtureEvents(db) {
  await db.exec(`
    set role service_role;

    insert into public.analytics_events (
      occurred_at,
      event_name,
      user_id,
      role,
      club_id,
      session_id,
      platform,
      canonical_route,
      feature_key,
      environment,
      metadata,
      client_event_id,
      source_kind,
      is_meaningful,
      is_parent_activation,
      is_club_activation,
      is_excluded
    ) values
      (
        '2026-03-29T00:30:00Z',
        'auth.login_succeeded',
        '${IDS.staff}',
        'coach',
        '${IDS.club}',
        'session:staff',
        'web',
        '/login',
        'authentication',
        'production',
        '{}',
        'event:login',
        'direct',
        false,
        false,
        false,
        false
      ),
      (
        '2026-03-29T01:45:00Z',
        'page.viewed',
        '${IDS.staff}',
        'coach',
        '${IDS.club}',
        'session:staff',
        'web',
        '/players',
        'navigation',
        'production',
        '{}',
        'event:page-1',
        'audit',
        false,
        false,
        false,
        false
      ),
      (
        '2026-03-29T01:50:00Z',
        'player.viewed',
        '${IDS.staff}',
        'coach',
        '${IDS.club}',
        'session:staff',
        'web',
        '/player/:playerId',
        'players',
        'production',
        '{}',
        'event:player-1',
        'audit',
        true,
        false,
        true,
        false
      ),
      (
        '2026-03-29T01:55:00Z',
        'parent_portal.viewed',
        '${IDS.parent}',
        'parent_portal',
        '${IDS.club}',
        'session:parent',
        'parent_app',
        '/parent-portal',
        'parent_portal',
        'production',
        '{}',
        'event:parent-1',
        'audit',
        true,
        true,
        true,
        false
      );

    select public.refresh_platform_analytics_aggregates('2026-03-29', '2026-03-29');
    reset role;
  `)
}

test('migration creates private server-only analytics tables and bounded functions', async () => {
  const db = await createDatabase()

  try {
    const privileges = await db.query(`
      select
        has_table_privilege('anon', 'public.analytics_events', 'select') as anon_select,
        has_table_privilege('authenticated', 'public.analytics_events', 'select') as authenticated_select,
        has_table_privilege('service_role', 'public.analytics_events', 'select') as service_select,
        has_function_privilege('authenticated', 'public.refresh_platform_analytics_aggregates(date,date)', 'execute') as authenticated_execute,
        has_function_privilege('service_role', 'public.refresh_platform_analytics_aggregates(date,date)', 'execute') as service_execute
    `)
    assert.deepEqual(privileges.rows[0], {
      anon_select: false,
      authenticated_select: false,
      service_select: true,
      authenticated_execute: false,
      service_execute: true,
    })

    const rls = await db.query(`
      select relrowsecurity
      from pg_class
      where oid = 'public.analytics_events'::regclass
    `)
    assert.equal(rls.rows[0].relrowsecurity, true)

    await assert.rejects(
      db.exec(`
        set role authenticated;
        select * from public.analytics_events;
      `),
      /permission denied/i,
    )
    await db.exec('reset role;')
  } finally {
    await db.close()
  }
})

test('aggregation is idempotent, keeps login separate, and uses UK daylight-saving buckets', async () => {
  const db = await createDatabase()

  try {
    await insertFixtureEvents(db)
    const first = await db.query(`
      select
        (select count(*)::integer from public.analytics_daily_user_activity) as daily_rows,
        (select sum(login_count)::integer from public.analytics_daily_user_activity) as logins,
        (select sum(meaningful_action_count)::integer from public.analytics_daily_user_activity) as meaningful,
        (select sum(unique_active_users)::integer from public.analytics_hourly_platform_activity) as active_users,
        (select hour_bucket::integer from public.analytics_hourly_page_activity where canonical_route = '/players') as uk_hour
    `)
    assert.deepEqual(first.rows[0], {
      daily_rows: 2,
      logins: 1,
      meaningful: 2,
      active_users: 2,
      uk_hour: 2,
    })

    await db.exec(`
      set role service_role;
      select public.refresh_platform_analytics_aggregates('2026-03-29', '2026-03-29');
      reset role;
    `)
    const second = await db.query(`
      select
        (select count(*)::integer from public.analytics_daily_user_activity) as daily_rows,
        (select count(*)::integer from public.analytics_hourly_platform_activity) as hourly_rows,
        (select count(*)::integer from public.analytics_daily_club_activity) as club_rows
    `)
    assert.deepEqual(second.rows[0], {
      daily_rows: 2,
      hourly_rows: 3,
      club_rows: 1,
    })

    const lifetime = await db.query(`
      select first_login_at, first_meaningful_at, first_parent_action_at
      from public.analytics_user_lifetime
      order by user_id
    `)
    assert.equal(lifetime.rows.length, 2)
    assert.ok(lifetime.rows.some((row) => row.first_parent_action_at))
  } finally {
    await db.close()
  }
})

test('identity adoption reconciles parent links, multi-team staff, dual roles, explicit login, and finite dormancy', async () => {
  const db = await createDatabase()

  try {
    await insertFixtureEvents(db)
    await db.exec(`
      insert into public.players (id, club_id, team_id, status, created_at) values
        ('${IDS.player}', '${IDS.club}', '${IDS.team}', 'active', '2026-03-01T00:00:00Z'),
        ('${IDS.playerTwo}', '${IDS.club}', '${IDS.team}', 'active', '2026-03-02T00:00:00Z');

      insert into public.parent_player_links (
        club_id, team_id, player_id, parent_link_id, auth_user_id, status, accepted_at, invite_sent_at
      ) values
        ('${IDS.club}', '${IDS.team}', '${IDS.player}', '50000000-0000-4000-8000-000000000001', '${IDS.parent}', 'active', '2026-03-10T00:00:00Z', '2026-03-09T00:00:00Z'),
        ('${IDS.club}', '${IDS.team}', '${IDS.playerTwo}', '50000000-0000-4000-8000-000000000001', '${IDS.parent}', 'active', '2026-03-10T00:00:00Z', '2026-03-09T00:00:00Z'),
        ('${IDS.club}', '${IDS.team}', '${IDS.player}', '50000000-0000-4000-8000-000000000002', null, 'pending', null, '2026-03-11T00:00:00Z'),
        ('${IDS.club}', '${IDS.team}', '${IDS.player}', '50000000-0000-4000-8000-000000000003', '${IDS.parent}', 'revoked', '2026-03-08T00:00:00Z', '2026-03-07T00:00:00Z');

      insert into public.team_staff (team_id, user_id, role_key, created_at) values
        ('${IDS.team}', '${IDS.staff}', 'coach', '2026-03-01T00:00:00Z'),
        ('${IDS.teamTwo}', '${IDS.staff}', 'coach', '2026-03-02T00:00:00Z'),
        ('${IDS.team}', '${IDS.parent}', 'assistant_coach', '2026-03-03T00:00:00Z');

      insert into public.club_user_invites (club_id, invite_sent_at)
      values ('${IDS.club}', '2026-02-28T00:00:00Z');

      update public.analytics_events
      set
        actor_auth_user_id = user_id,
        actor_profile_id = user_id,
        actor_role_at_event = role,
        actor_role_family = case when role = 'parent_portal' then 'parent' else 'staff' end,
        production_state = 'production',
        internal_state = false,
        fp_test_state = false,
        schema_version = 2;
    `)

    const result = await db.query(`
      select public.get_platform_analytics_identity_adoption(
        '2026-03-01', '2026-07-27', null, null, false, null, null
      ) as metrics
    `)
    const metrics = result.rows[0].metrics

    assert.equal(metrics.parentAdoption.authenticatedParentAccounts, 1)
    assert.equal(metrics.parentAdoption.contacts, 2)
    assert.equal(metrics.parentAdoption.activeChildLinks, 2)
    assert.equal(metrics.parentAdoption.parentOnlyAccounts, 0)
    assert.equal(metrics.parentAdoption.dualRoleParentAccounts, 1)
    assert.equal(metrics.parentAdoption.successfulParentLogins, 0)
    assert.equal(metrics.parentAdoption.stages.find((stage) => stage.key === 'first_login').label, 'Parent Portal login telemetry captured')
    assert.equal(metrics.parentAdoption.parentsWithFirstMeaningfulAction, 1)
    assert.equal(metrics.staff.authenticatedStaffAccounts, 2)
    assert.equal(metrics.staff.assignmentCount, 3)
    assert.equal(metrics.staff.multiTeamAccounts, 1)
    assert.equal(metrics.reconciliation.dualRoleCount, 1)
    assert.equal(metrics.reconciliation.revokedRelationshipCount, 1)
    assert.equal(metrics.reconciliation.unresolvedIdentityCount, 0)
    assert.equal(metrics.clubActivation.stages.find((stage) => stage.key === 'staff_login').count, 1)
    assert.equal(metrics.dormancy.measuredClubs, 1)
    assert.equal(Number.isFinite(metrics.dormancy.clubStates[0].daysSinceActivity), true)
    assert.ok(metrics.dormancy.clubStates[0].daysSinceActivity >= 0)

    const privileges = await db.query(`
      select
        has_function_privilege('authenticated', 'public.get_platform_analytics_identity_adoption(date,date,uuid,text,boolean,text,text)', 'execute') as authenticated_execute,
        has_function_privilege('service_role', 'public.get_platform_analytics_identity_adoption(date,date,uuid,text,boolean,text,text)', 'execute') as service_execute
    `)
    assert.deepEqual(privileges.rows[0], { authenticated_execute: false, service_execute: true })
  } finally {
    await db.close()
  }
})

test('dashboard read model reconciles estate, event-time roles, friendly page families, and Monday-first heatmap cells', async () => {
  const db = await createDatabase()

  try {
    await insertFixtureEvents(db)
    await db.exec(`
      insert into public.players (id, club_id, team_id, status, created_at)
      values ('${IDS.player}', '${IDS.club}', '${IDS.team}', 'active', '2026-03-01T00:00:00Z');
      insert into public.parent_player_links (club_id, team_id, player_id, auth_user_id, status, accepted_at)
      values ('${IDS.club}', '${IDS.team}', '${IDS.player}', '${IDS.parent}', 'active', '2026-03-10T00:00:00Z');
      insert into public.team_staff (team_id, user_id, role_key)
      values ('${IDS.team}', '${IDS.staff}', 'coach');
      insert into public.evaluations (club_id, created_at)
      values ('${IDS.club}', '2026-03-15T00:00:00Z');
      update public.analytics_events
      set
        actor_auth_user_id = user_id,
        actor_profile_id = user_id,
        actor_role_at_event = role,
        actor_role_family = case when role = 'parent_portal' then 'parent' else 'staff' end,
        production_state = 'production',
        internal_state = false,
        fp_test_state = false,
        schema_version = 2;
    `)

    const result = await db.query(`
      select public.get_platform_analytics_dashboard_14c(
        '2026-03-01', '2026-07-27', null, null, null, null, null,
        'production', null, false, false
      ) as dashboard
    `)
    const dashboard = result.rows[0].dashboard
    assert.equal(dashboard.accountEstate.clubs, 1)
    assert.equal(dashboard.accountEstate.teams, 2)
    assert.equal(dashboard.accountEstate.activePlayers, 1)
    assert.equal(dashboard.accountEstate.authenticatedStaffAccounts, 1)
    assert.equal(dashboard.accountEstate.authenticatedParentAccounts, 1)
    assert.equal(dashboard.accountEstate.developmentRecords, 1)
    assert.equal(dashboard.reconciliation.topPagesTotal, dashboard.reconciliation.sourcePageViewsTotal)
    assert.equal(dashboard.reconciliation.heatmapMeaningfulTotal, dashboard.reconciliation.sourceMeaningfulTotal)
    assert.equal(dashboard.heatmap.days[0], 'Monday')
    assert.equal(dashboard.heatmap.days[6], 'Sunday')
    assert.equal(dashboard.heatmap.cells.every((cell) => cell.dayIndex >= 0 && cell.dayIndex <= 6), true)
    assert.equal(JSON.stringify(dashboard).includes('@'), false)

    const privileges = await db.query(`
      select
        has_function_privilege('authenticated', 'public.get_platform_analytics_dashboard_14c(date,date,uuid,text,text,text,text,text,text,boolean,boolean)', 'execute') as authenticated_execute,
        has_function_privilege('service_role', 'public.get_platform_analytics_dashboard_14c(date,date,uuid,text,text,text,text,text,text,boolean,boolean)', 'execute') as service_execute
    `)
    assert.deepEqual(privileges.rows[0], { authenticated_execute: false, service_execute: true })
  } finally {
    await db.close()
  }
})

test('canonical v4 report aligns headlines with human breakdowns and keeps identifiers out of normal drilldowns', async () => {
  const db = await createDatabase()

  try {
    await insertFixtureEvents(db)
    await db.exec(`
      insert into public.clubs (id, name)
      values ('${IDS.emptyClub}', 'Empty Analytics Club');
      insert into public.users (id, club_id, role, status) values
        ('${IDS.directStaff}', '${IDS.club}', 'coach', 'active'),
        ('${IDS.suspendedParent}', '${IDS.club}', 'parent_portal', 'suspended');
      insert into public.players (id, club_id, team_id, status, created_at) values
        ('${IDS.player}', '${IDS.club}', '${IDS.team}', 'active', '2026-03-01T00:00:00Z'),
        ('${IDS.playerThree}', '${IDS.club}', '${IDS.team}', 'active', '2026-03-02T00:00:00Z'),
        ('${IDS.playerFour}', '${IDS.club}', '${IDS.team}', 'active', '2026-03-03T00:00:00Z');
      insert into public.parent_player_links (club_id, team_id, player_id, auth_user_id, status, accepted_at) values
        ('${IDS.club}', '${IDS.team}', '${IDS.player}', '${IDS.parent}', 'active', '2026-03-10T00:00:00Z'),
        ('${IDS.club}', '${IDS.team}', '${IDS.playerThree}', '${IDS.staleProfileParent}', 'active', '2026-03-11T00:00:00Z'),
        ('${IDS.club}', '${IDS.team}', '${IDS.playerFour}', '${IDS.suspendedParent}', 'active', '2026-03-12T00:00:00Z');
      insert into public.team_staff (team_id, user_id, role_key)
      values ('${IDS.team}', '${IDS.staff}', 'coach');
      insert into public.evaluations (club_id, team_id, status, created_at)
      values ('${IDS.club}', '${IDS.team}', 'Submitted', '2026-03-15T00:00:00Z');
      insert into public.analytics_events (
        occurred_at, event_name, user_id, role, club_id, session_id, platform,
        canonical_route, feature_key, environment, metadata, client_event_id,
        source_kind, is_meaningful, is_parent_activation, is_club_activation, is_excluded
      ) values (
        '2026-03-29T02:05:00Z', 'player.viewed', '${IDS.directStaff}', 'coach', '${IDS.club}',
        'session:direct-staff', 'web', '/player/:playerId', 'players', 'production', '{}',
        'event:direct-staff', 'direct', true, false, true, false
      );
      update public.analytics_events
      set
        actor_auth_user_id = user_id,
        actor_profile_id = user_id,
        actor_role_at_event = role,
        actor_role_family = case when role = 'parent_portal' then 'parent' else 'staff' end,
        event_category = case when event_name like 'auth.%' then 'authentication' when event_name like 'page.%' then 'navigation' else 'meaningful_action' end,
        page_view = event_name = 'page.viewed',
        production_state = 'production',
        internal_state = false,
        fp_test_state = false,
        schema_version = 2;
    `)

    const result = await db.query(`
      select public.get_platform_analytics_canonical_v4(
        '2026-03-01', '2026-07-27', null, null, null, null, null,
        'production', null, false, false
      ) as report
    `)
    const report = result.rows[0].report
    const sumCounts = (rows) => rows.reduce((sum, row) => sum + Number(row.count || 0), 0)

    assert.equal(report.definitionVersion, 4)
    assert.equal(report.accountEstate.customerClubs, 2)
    assert.equal(report.accountEstate.customerWorkspaces, 2)
    assert.equal(report.accountEstate.teams, 2)
    assert.equal(report.accountEstate.activePlayers, 3)
    assert.equal(report.accountEstate.staffAccounts, 2)
    assert.equal(report.accountEstate.staffAssignments, 1)
    assert.equal(report.accountEstate.usersWithParentAccess, 2)
    assert.equal(report.accountEstate.activeParentChildLinks, 2)
    assert.equal(report.accountEstate.developmentRecords, 1)
    assert.equal(report.accountEstate.parentOnlyAccounts, 2)
    assert.equal(report.productActivity.activeStaff, 2)
    assert.equal(report.staffRoleAdoption.find((row) => row.role === 'Coach').totalAccounts, 2)
    assert.equal(report.staffRoleAdoption.find((row) => row.role === 'Coach').activeAccounts, 2)
    assert.equal(report.identityAdoption.parentAdoption.authenticatedParentAccounts, 2)
    assert.equal(report.identityAdoption.parentAdoption.invitationsAccepted, 2)
    assert.match(report.generatedAt, /(Z|[+-]\d{2}:\d{2})$/)
    assert.equal(sumCounts(report.accountEstate.drilldown.customerClubs), report.accountEstate.customerClubs)
    assert.equal(sumCounts(report.accountEstate.drilldown.teams), report.accountEstate.teams)
    assert.equal(sumCounts(report.accountEstate.drilldown.activePlayers), report.accountEstate.activePlayers)
    assert.equal(sumCounts(report.accountEstate.drilldown.staffAccounts), report.accountEstate.staffAccounts)
    assert.equal(sumCounts(report.accountEstate.drilldown.staffAssignments), report.accountEstate.staffAssignments)
    assert.equal(sumCounts(report.accountEstate.drilldown.parentAccess), report.accountEstate.usersWithParentAccess)
    assert.equal(sumCounts(report.accountEstate.drilldown.activeParentChildLinks), report.accountEstate.activeParentChildLinks)
    assert.equal(sumCounts(report.accountEstate.drilldown.developmentRecords), report.accountEstate.developmentRecords)
    assert.equal(/[0-9a-f]{8}-[0-9a-f-]{27}/i.test(JSON.stringify(report.accountEstate.drilldown)), false)
    assert.equal(report.trend.reduce((sum, row) => sum + row.pageViews, 0), report.productActivity.pageViews)
    assert.equal(report.trend.reduce((sum, row) => sum + row.meaningfulActions, 0), report.productActivity.meaningfulActions)
    assert.equal(report.trend.reduce((sum, row) => sum + row.successfulLogins, 0), report.authentication.successfulLoginsSelected)
    assert.equal(Object.hasOwn(report.authentication, 'drilldown'), false)
    assert.equal(Object.hasOwn(report.productActivity, 'drilldown'), false)

    const privileges = await db.query(`
      select
        has_function_privilege('authenticated', 'public.get_platform_analytics_canonical_v4(date,date,uuid,text,text,text,text,text,text,boolean,boolean)', 'execute') as authenticated_execute,
        has_function_privilege('service_role', 'public.get_platform_analytics_canonical_v4(date,date,uuid,text,text,text,text,text,text,boolean,boolean)', 'execute') as service_execute
    `)
    assert.deepEqual(privileges.rows[0], { authenticated_execute: false, service_execute: true })
  } finally {
    await db.close()
  }
})

test('dashboard read model stays bounded at larger synthetic volume', async () => {
  const db = await createDatabase()

  try {
    await db.exec(`
      set role service_role;
      insert into public.analytics_events (
        occurred_at, event_name, user_id, role, club_id, session_id, platform,
        canonical_route, feature_key, environment, metadata, client_event_id,
        source_kind, is_meaningful, is_parent_activation, is_club_activation, is_excluded
      )
      select
        '2026-07-27T09:00:00Z'::timestamptz + (value || ' seconds')::interval,
        case when value % 2 = 0 then 'page.viewed' else 'development.record_submitted' end,
        '${IDS.staff}', 'coach', '${IDS.club}', 'session:bulk', 'web',
        case when value % 2 = 0 then '/player/:playerId' else '/create-evaluation' end,
        case when value % 2 = 0 then 'player' else 'development' end,
        'production', '{}', 'event:bulk:' || value, 'direct', value % 2 = 1,
        false, value % 2 = 1, false
      from generate_series(1, 10000) value;
      reset role;
    `)

    const startedAt = performance.now()
    const result = await db.query(`
      select public.get_platform_analytics_dashboard_14c(
        '2026-07-01', '2026-07-31', null, null, null, null, null,
        'production', null, false, false
      ) as dashboard
    `)
    const elapsedMs = performance.now() - startedAt
    const dashboard = result.rows[0].dashboard
    assert.equal(dashboard.productActivity.pageViews, 5000)
    assert.equal(dashboard.productActivity.meaningfulActions, 5000)
    assert.equal(dashboard.reconciliation.heatmapPageViewsTotal, 5000)
    assert.ok(dashboard.heatmap.cells.length <= 168)
    assert.ok(dashboard.productActivity.drilldown.length <= 500)
    assert.ok(JSON.stringify(dashboard).length < 1_000_000)
    assert.ok(elapsedMs < 10000, `bounded dashboard query took ${elapsedMs}ms`)
  } finally {
    await db.close()
  }
})

test('raw metadata allowlist rejects unapproved free text at the database boundary', async () => {
  const db = await createDatabase()

  try {
    await assert.rejects(
      db.exec(`
        set role service_role;
        insert into public.analytics_events (
          event_name,
          user_id,
          role,
          platform,
          metadata,
          client_event_id
        ) values (
          'page.viewed',
          '${IDS.staff}',
          'coach',
          'web',
          '{"notes":"private"}',
          'event:private'
        );
      `),
      /analytics_events_metadata_allowlist_check/i,
    )
  } finally {
    await db.close()
  }
})

test('canonical event migration adds private processing evidence and deterministic idempotency', async () => {
  const db = await createDatabase()

  try {
    await db.exec(`
      set role service_role;
      insert into public.analytics_events (
        occurred_at, event_name, user_id, role, club_id, team_id, session_id, platform,
        canonical_route, feature_key, environment, metadata, client_event_id,
        source_kind, is_meaningful, is_parent_activation, is_club_activation, is_excluded
      ) values (
        '2026-07-31T12:00:00Z', 'page.view', '${IDS.staff}', 'coach', '${IDS.club}', '${IDS.team}',
        'session:canonical', 'web', '/calendar', 'navigation', 'production',
        '{"deviceCategory":"mobile"}', 'event:canonical', 'direct', false, false, false, false
      );
      insert into public.analytics_events (
        occurred_at, event_name, user_id, role, club_id, session_id, platform,
        canonical_route, feature_key, environment, metadata, client_event_id,
        source_kind, is_meaningful, is_parent_activation, is_club_activation, is_excluded
      ) values (
        '2026-07-31T12:01:00Z', 'auth.login_succeeded', '${IDS.staff}', 'admin', '${IDS.club}',
        'session:club-admin', 'web', '/coach', 'authentication', 'production',
        '{}', 'event:club-admin', 'direct', false, false, false, false
      );
      reset role;
    `)

    const canonical = await db.query(`
      select event_category, action_family, route_key, actor_profile_id,
        actor_role_at_event, actor_role_family, page_view, idempotency_key,
        schema_version, metadata
      from public.analytics_events
      where client_event_id = 'event:canonical'
    `)
    assert.deepEqual(canonical.rows[0], {
      event_category: 'navigation',
      action_family: 'navigation',
      route_key: '/calendar',
      actor_profile_id: IDS.staff,
      actor_role_at_event: 'coach',
      actor_role_family: 'staff',
      page_view: true,
      idempotency_key: 'event:canonical',
      schema_version: 2,
      metadata: { deviceCategory: 'mobile' },
    })
    const clubAdmin = await db.query(`
      select actor_role_at_event, actor_role_family
      from public.analytics_events
      where client_event_id = 'event:club-admin'
    `)
    assert.deepEqual(clubAdmin.rows[0], {
      actor_role_at_event: 'admin',
      actor_role_family: 'club_admin',
    })

    await db.exec(`
      set role service_role;
      select public.refresh_platform_analytics_aggregates('2026-07-31', '2026-07-31');
      reset role;
    `)
    const aggregate = await db.query(`
      select
        (select sum(page_view_count)::integer from public.analytics_daily_user_activity) as daily_views,
        (select sum(page_views)::integer from public.analytics_daily_page_user_activity) as page_views,
        (select sum(page_views)::integer from public.analytics_hourly_platform_activity) as hourly_views
    `)
    assert.deepEqual(aggregate.rows[0], {
      daily_views: 1,
      page_views: 1,
      hourly_views: 1,
    })

    await assert.rejects(
      db.exec(`
        set role service_role;
        insert into public.analytics_events (
          event_name, user_id, role, club_id, session_id, platform,
          canonical_route, feature_key, environment, metadata, client_event_id,
          source_kind, is_meaningful, is_parent_activation, is_club_activation, is_excluded
        ) values (
          'page.view', '${IDS.staff}', 'coach', '${IDS.club}',
          'session:canonical', 'web', '/calendar', 'navigation', 'production',
          '{}', 'event:canonical', 'direct', false, false, false, false
        );
      `),
      /duplicate|unique/i,
    )
    await db.exec('reset role;')

    const privacy = await db.query(`
      select
        has_table_privilege('anon', 'public.analytics_processor_runs', 'select') as anon_runs,
        has_table_privilege('authenticated', 'public.analytics_event_quarantine', 'select') as authenticated_quarantine,
        has_table_privilege('service_role', 'public.analytics_processor_runs', 'insert') as service_runs,
        has_function_privilege(
          'anon',
          'public.complete_platform_analytics_processor_run(uuid,uuid[],timestamptz,integer,integer,integer,integer,integer,timestamptz,timestamptz)',
          'execute'
        ) as anon_complete,
        has_function_privilege(
          'service_role',
          'public.complete_platform_analytics_processor_run(uuid,uuid[],timestamptz,integer,integer,integer,integer,integer,timestamptz,timestamptz)',
          'execute'
        ) as service_complete
    `)
    assert.deepEqual(privacy.rows[0], {
      anon_runs: false,
      authenticated_quarantine: false,
      service_runs: true,
      anon_complete: false,
      service_complete: true,
    })

    await db.exec(`
      set role service_role;
      insert into public.analytics_event_quarantine (
        source_kind, source_record_id, safe_reason, safe_event_name
      ) values (
        'audit', '40000000-0000-4000-8000-000000000001', 'route_unclassifiable', 'page.view'
      ) on conflict (source_kind, source_record_id, safe_reason) do nothing;
      insert into public.analytics_event_quarantine (
        source_kind, source_record_id, safe_reason, safe_event_name
      ) values (
        'audit', '40000000-0000-4000-8000-000000000001', 'route_unclassifiable', 'page.view'
      ) on conflict (source_kind, source_record_id, safe_reason) do nothing;
      reset role;
    `)
    const quarantineDedupe = await db.query(`
      select count(*)::integer as row_count
      from public.analytics_event_quarantine
      where source_record_id = '40000000-0000-4000-8000-000000000001'
    `)
    assert.equal(quarantineDedupe.rows[0].row_count, 1)
  } finally {
    await db.close()
  }
})

test('diagnostic RPC reconciles raw canonical counts and reports processor state', async () => {
  const db = await createDatabase()

  try {
    await db.exec(`
      set role service_role;
      insert into public.analytics_events (
        occurred_at, event_name, user_id, role, club_id, session_id, platform,
        canonical_route, feature_key, environment, metadata, client_event_id,
        source_kind, is_meaningful, is_parent_activation, is_club_activation, is_excluded,
        fp_test_state
      ) values
      (
        '2026-07-31T12:00:00Z', 'page.view', '${IDS.staff}', 'coach', '${IDS.club}',
        'session:diagnostic', 'web', '/calendar', 'navigation', 'production',
        '{}', 'event:diagnostic-page', 'direct', false, false, false, false, false
      ),
      (
        '2026-07-31T12:01:00Z', 'poll.responded', '${IDS.parent}', 'parent_portal', '${IDS.club}',
        'session:diagnostic', 'parent_app', '/parent-polls', 'polls', 'production',
        '{}', 'event:diagnostic-action', 'direct', true, true, true, true, true
      );
      reset role;
    `)
    await db.exec('set role service_role;')
    const result = await db.query(`
      select public.get_platform_analytics_diagnostics(
        '2026-07-31T00:00:00Z',
        '2026-08-01T00:00:00Z'
      ) as diagnostic
    `)
    await db.exec('reset role;')
    assert.deepEqual(result.rows[0].diagnostic, {
      rawEvents: 2,
      canonicallyClassifiedEvents: 2,
      pageViews: 1,
      meaningfulActions: 1,
      successfulLogins: 0,
      distinctUsers: 2,
      attributedRoles: 2,
      attributedClubs: 2,
      unattributedUsers: 0,
      unattributedRoles: 0,
      unattributedClubs: 0,
      internalEvents: 0,
      fpTestEvents: 1,
      processorWatermark: null,
      lastSuccessfulProcessorRun: null,
      lastFailedProcessorRun: null,
      rowsAwaitingProcessing: 2,
      rowsQuarantined: 0,
    })
  } finally {
    await db.close()
  }
})
