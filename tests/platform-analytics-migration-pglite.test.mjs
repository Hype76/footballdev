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

const IDS = Object.freeze({
  club: '10000000-0000-4000-8000-000000000001',
  team: '20000000-0000-4000-8000-000000000001',
  staff: '30000000-0000-4000-8000-000000000001',
  parent: '30000000-0000-4000-8000-000000000002',
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
      plan_key text not null default 'small_club'
    );

    create table public.teams (
      id uuid primary key,
      club_id uuid not null references public.clubs(id),
      name text not null
    );

    create table public.users (
      id uuid primary key,
      club_id uuid references public.clubs(id),
      role text not null,
      status text not null default 'active'
    );

    insert into public.clubs (id, name) values ('${IDS.club}', 'Analytics Test Club');
    insert into public.teams (id, club_id, name) values ('${IDS.team}', '${IDS.club}', 'Analytics Test Team');
    insert into public.users (id, club_id, role) values
      ('${IDS.staff}', '${IDS.club}', 'coach'),
      ('${IDS.parent}', '${IDS.club}', 'parent_portal');
  `)
  await db.exec(migration)
  await db.exec(eventFoundationMigration)
  await db.exec(clubAdminRoleAlignmentMigration)
  await db.exec(quarantineConflictAlignmentMigration)
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
        has_table_privilege('service_role', 'public.analytics_processor_runs', 'insert') as service_runs
    `)
    assert.deepEqual(privacy.rows[0], {
      anon_runs: false,
      authenticated_quarantine: false,
      service_runs: true,
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
