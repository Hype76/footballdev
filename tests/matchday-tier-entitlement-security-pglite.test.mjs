import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'
import { PGlite } from '@electric-sql/pglite'
import { MATCHDAY_DEFAULT_FLAGS } from '../src/lib/matchday-policy.js'

const migration = await readFile(
  new URL('../supabase/migrations/20260918104253_matchday_tier_entitlement_security.sql', import.meta.url),
  'utf8',
)
const clubDisplayControlsMigration = await readFile(
  new URL('../supabase/migrations/20260727111343_club_display_controls.sql', import.meta.url),
  'utf8',
)

const IDS = Object.freeze({
  matchdayClub: '10000000-0000-4000-8000-000000000001',
  teamClub: '10000000-0000-4000-8000-000000000002',
  clubClub: '10000000-0000-4000-8000-000000000003',
  legacySingleClub: '11000000-0000-4000-8000-000000000001',
  legacySmallClub: '11000000-0000-4000-8000-000000000002',
  legacyLargeClub: '11000000-0000-4000-8000-000000000003',
  legacyPilotClub: '11000000-0000-4000-8000-000000000004',
  admin: '20000000-0000-4000-8000-000000000001',
  staff: '20000000-0000-4000-8000-000000000002',
})

async function setActor(db, actorId = '') {
  await db.query("select set_config('request.jwt.claim.sub', $1, false)", [actorId])
}

async function createDatabase() {
  const db = new PGlite()
  await db.exec(`
    create role anon;
    create role authenticated;
    create role service_role;
    create schema auth;
    create schema app_private;

    create function auth.uid() returns uuid language sql stable set search_path = '' as $$
      select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid
    $$;
    create function auth.role() returns text language sql stable set search_path = '' as $$
      select case when auth.uid() is null then 'service_role' else 'authenticated' end
    $$;

    create table public.users (
      id uuid primary key,
      role text not null,
      status text not null default 'active',
      club_id uuid
    );
    create table public.platform_admins (
      id uuid primary key references public.users (id),
      status text not null default 'active'
    );
    create table public.clubs (
      id uuid primary key,
      name text,
      plan_key text not null,
      plan_status text not null default 'active',
      is_plan_comped boolean not null default false,
      billing_arrangement text,
      billing_start_at timestamptz,
      archived_at timestamptz,
      logo_url text,
      require_approval boolean not null default false,
      theme_accent text not null default 'yellow',
      theme_button_style text,
      constraint clubs_plan_key_check check (
        plan_key in ('individual', 'single_team', 'small_club', 'development_club', 'large_club', 'pilot')
      )
    );
    create table public.club_team_limit_overrides (
      club_id uuid primary key references public.clubs (id),
      team_limit_override integer not null check (team_limit_override between 1 and 500)
    );
    create table public.teams (
      id uuid primary key,
      club_id uuid not null references public.clubs (id),
      name text
    );
    create table public.stripe_checkout_records (
      id uuid primary key,
      plan_key text not null
    );
    create table public.players (
      id uuid primary key,
      club_id uuid not null references public.clubs (id),
      team_id uuid references public.teams (id),
      player_name text not null,
      section text not null default 'Squad'
    );
    create table public.evaluations (
      id uuid primary key,
      club_id uuid not null references public.clubs (id)
    );
    create table public.match_days (
      id uuid primary key,
      club_id uuid not null references public.clubs (id)
    );
    create table public.calendar_events (
      id uuid primary key,
      club_id uuid not null references public.clubs (id),
      team_id uuid references public.teams (id),
      event_type text not null,
      recurrence_frequency text not null default 'none'
    );
    create table public.parent_player_links (
      id uuid primary key,
      auth_user_id uuid,
      club_id uuid not null references public.clubs (id),
      team_id uuid references public.teams (id),
      player_id uuid not null references public.players (id),
      status text not null default 'active'
    );
    create table public.fan_connections (
      id uuid primary key,
      parent_link_id uuid not null references public.parent_player_links (id),
      player_id uuid not null references public.players (id),
      club_id uuid not null references public.clubs (id),
      invited_by uuid not null,
      auth_user_id uuid,
      name text not null,
      email text not null,
      relationship_type text not null default 'fan',
      permissions jsonb not null default '{}'::jsonb,
      status text not null default 'active',
      invite_token uuid,
      expires_at timestamptz,
      created_at timestamptz not null default now(),
      accepted_at timestamptz,
      updated_at timestamptz not null default now(),
      notifications_enabled boolean not null default true,
      owner_deleted_at timestamptz
    );

    create function app_private.fan_scope_active(uuid, uuid, uuid, uuid)
    returns boolean language sql stable security definer set search_path = '' as $$ select true $$;
    create function public.list_fan_connections()
    returns jsonb language sql stable security definer set search_path = '' as $$ select '[]'::jsonb $$;

    grant select, insert, update, delete on public.players, public.evaluations,
      public.match_days, public.calendar_events to authenticated;
    alter table public.players enable row level security;
    alter table public.evaluations enable row level security;
    alter table public.match_days enable row level security;
    alter table public.calendar_events enable row level security;
    create policy base_select on public.players for select to authenticated using (true);
    create policy base_select on public.evaluations for select to authenticated using (true);
    create policy base_select on public.match_days for select to authenticated using (true);
    create policy base_select on public.calendar_events for select to authenticated using (true);

    create function public.platform_access_is_admin_v1(p_actor_id uuid)
    returns boolean language sql stable security definer set search_path = '' as $$
      select exists (
        select 1
        from public.users actor
        join public.platform_admins platform_admin on platform_admin.id = actor.id
        where actor.id = p_actor_id
          and actor.role = 'super_admin'
          and actor.status = 'active'
          and platform_admin.status = 'active'
      )
    $$;

    create function public.is_club_plan_access_active(target_club_id uuid)
    returns boolean language sql stable security definer set search_path = '' as $$
      select coalesce(club.is_plan_comped, false)
        or club.plan_status in ('active', 'trialing')
      from public.clubs club
      where club.id = target_club_id
    $$;

    create function public.current_user_role()
    returns text language sql stable security definer set search_path = '' as $$
      select actor.role from public.users actor where actor.id = auth.uid()
    $$;

    create function public.current_user_club_id()
    returns uuid language sql stable security definer set search_path = '' as $$
      select actor.club_id from public.users actor where actor.id = auth.uid()
    $$;

    insert into public.users (id, role) values
      ('${IDS.admin}', 'super_admin'),
      ('${IDS.staff}', 'admin');
    insert into public.platform_admins (id) values ('${IDS.admin}');
    insert into public.clubs (id, plan_key) values
      ('${IDS.matchdayClub}', 'individual'),
      ('${IDS.teamClub}', 'single_team'),
      ('${IDS.clubClub}', 'development_club');
    insert into public.clubs (id, plan_key, is_plan_comped) values
      ('${IDS.legacySingleClub}', 'single_team', true),
      ('${IDS.legacySmallClub}', 'small_club', true),
      ('${IDS.legacyLargeClub}', 'large_club', true),
      ('${IDS.legacyPilotClub}', 'pilot', true);
    insert into public.club_team_limit_overrides (club_id, team_limit_override) values
      ('${IDS.legacyLargeClub}', 50),
      ('${IDS.legacyPilotClub}', 5);
  `)

  await db.exec(migration)
  await db.exec(clubDisplayControlsMigration)
  await db.exec(`
    create trigger enforce_club_plan_update_features
    before update on public.clubs
    for each row execute function public.enforce_club_plan_update_features()
  `)
  await db.exec(`
    update public.clubs set plan_key = 'matchday' where id = '${IDS.matchdayClub}';
    update public.clubs set plan_key = 'team' where id = '${IDS.teamClub}';
    update public.clubs set plan_key = 'club' where id = '${IDS.clubClub}';
  `)
  return db
}

test('canonical plans preserve legacy billing keys and enforce package team capacity', async () => {
  const db = await createDatabase()
  try {
    const normalized = await db.query(`
      select
        public.normalize_subscription_plan_key('individual') as individual,
        public.normalize_subscription_plan_key('single_team') as single_team,
        public.normalize_subscription_plan_key('development_club') as development_club,
        public.normalize_subscription_plan_key('pilot') as pilot,
        public.canonical_subscription_plan_key('individual') as canonical_individual,
        public.canonical_subscription_plan_key('single_team') as canonical_single_team,
        public.canonical_subscription_plan_key('development_club') as canonical_development_club,
        public.workspace_scope_for_plan_key('individual') as individual_scope,
        public.workspace_scope_for_plan_key('matchday') as matchday_scope
    `)
    assert.deepEqual(normalized.rows[0], {
      individual: 'individual',
      single_team: 'single_team',
      development_club: 'development_club',
      pilot: 'pilot',
      canonical_individual: 'matchday',
      canonical_single_team: 'team',
      canonical_development_club: 'club',
      individual_scope: 'individual',
      matchday_scope: 'team',
    })

    await db.exec(`
      insert into public.club_team_limit_overrides (club_id, team_limit_override)
      values ('${IDS.teamClub}', 20), ('${IDS.clubClub}', 20);
      insert into public.teams (id, club_id)
      values ('30000000-0000-4000-8000-000000000001', '${IDS.teamClub}');
    `)
    const teamLimited = await db.query(`select public.can_insert_team_for_plan('${IDS.teamClub}') as allowed`)
    assert.equal(teamLimited.rows[0].allowed, false)

    await db.exec(`
      insert into public.teams (id, club_id)
      select ('40000000-0000-4000-8000-' || lpad(value::text, 12, '0'))::uuid, '${IDS.clubClub}'
      from generate_series(1, 10) value;
    `)
    await db.exec(`update public.club_team_limit_overrides set team_limit_override = 11 where club_id = '${IDS.clubClub}'`)
    const clubAtTen = await db.query(`select public.can_insert_team_for_plan('${IDS.clubClub}') as allowed`)
    assert.equal(clubAtTen.rows[0].allowed, true)

    await db.exec(`update public.clubs set subscription_team_capacity = 10 where id = '${IDS.clubClub}'`)
    const trustedCapacityWins = await db.query(`select public.can_insert_team_for_plan('${IDS.clubClub}') as allowed`)
    assert.equal(trustedCapacityWins.rows[0].allowed, false)
  } finally {
    await db.close()
  }
})

test('Matchday config is safe to read and only an active platform admin can save exact valid flags', async () => {
  const db = await createDatabase()
  try {
    await db.exec('set role anon')
    const publicConfig = await db.query('select public.get_matchday_plan_config() as config')
    assert.equal(publicConfig.rows[0].config.revision, 1)
    assert.deepEqual(publicConfig.rows[0].config.flags, MATCHDAY_DEFAULT_FLAGS)
    assert.equal(publicConfig.rows[0].config.flags.players, true)
    assert.equal(publicConfig.rows[0].config.flags.development, undefined)
    assert.equal(publicConfig.rows[0].config.flags.basicDevelopmentRecords, false)
    await db.exec('reset role')

    const flags = publicConfig.rows[0].config.flags
    await setActor(db, IDS.staff)
    await assert.rejects(
      db.query('select public.save_matchday_plan_config($1::jsonb, 1)', [JSON.stringify(flags)]),
      /matchday_plan_config_not_permitted/,
    )

    await setActor(db, IDS.admin)
    const missingKey = { ...flags }
    delete missingKey.players
    await assert.rejects(
      db.query('select public.save_matchday_plan_config($1::jsonb, 1)', [JSON.stringify(missingKey)]),
      /matchday_plan_config_invalid/,
    )

    const badDependency = { ...flags, teamCalendar: false }
    await assert.rejects(
      db.query('select public.save_matchday_plan_config($1::jsonb, 1)', [JSON.stringify(badDependency)]),
      /matchday_plan_config_dependency_invalid/,
    )

    const enabledTraining = { ...flags, trainingEvents: true }
    const saved = await db.query(
      'select public.save_matchday_plan_config($1::jsonb, 1) as config',
      [JSON.stringify(enabledTraining)],
    )
    assert.equal(saved.rows[0].config.revision, 2)
    assert.equal(saved.rows[0].config.flags.trainingEvents, true)

    await assert.rejects(
      db.query('select public.save_matchday_plan_config($1::jsonb, 1)', [JSON.stringify(enabledTraining)]),
      /matchday_plan_config_revision_conflict/,
    )

    const revisions = await db.query('select revision, changed_by from public.matchday_plan_config_revisions order by revision')
    assert.deepEqual(revisions.rows, [
      { revision: 1, changed_by: null },
      { revision: 2, changed_by: IDS.admin },
    ])
  } finally {
    await db.close()
  }
})

test('Fan connection RPC returns the selected player Club plan without changing stored links', async () => {
  const db = await createDatabase()
  try {
    await setActor(db, IDS.admin)
    await db.exec(`
      insert into public.teams (id, club_id, name)
      values ('32000000-0000-4000-8000-000000000001', '${IDS.matchdayClub}', 'Selected team');
      insert into public.players (id, club_id, player_name)
      values ('52000000-0000-4000-8000-000000000001', '${IDS.matchdayClub}', 'Selected player');
      update public.players
      set team_id = '32000000-0000-4000-8000-000000000001'
      where id = '52000000-0000-4000-8000-000000000001';
      insert into public.parent_player_links (id, auth_user_id, club_id, team_id, player_id)
      values (
        '42000000-0000-4000-8000-000000000001',
        '${IDS.admin}',
        '${IDS.matchdayClub}',
        '32000000-0000-4000-8000-000000000001',
        '52000000-0000-4000-8000-000000000001'
      );
      insert into public.fan_connections (
        id, parent_link_id, player_id, club_id, invited_by, auth_user_id,
        name, email, invite_token, expires_at
      ) values (
        '62000000-0000-4000-8000-000000000001',
        '42000000-0000-4000-8000-000000000001',
        '52000000-0000-4000-8000-000000000001',
        '${IDS.matchdayClub}',
        '${IDS.admin}',
        '${IDS.admin}',
        'Parent viewer',
        'parent@example.test',
        '72000000-0000-4000-8000-000000000001',
        now() + interval '1 day'
      );
    `)

    const result = await db.query('select public.list_fan_connections() as connections')
    assert.equal(result.rows[0].connections.length, 1)
    assert.equal(result.rows[0].connections[0].plan_key, 'matchday')
    assert.equal(result.rows[0].connections[0].plan_status, 'active')

    await db.exec(`update public.clubs set plan_status = 'inactive' where id = '${IDS.matchdayClub}'`)
    const retained = await db.query('select count(*)::integer as count from public.fan_connections')
    assert.equal(retained.rows[0].count, 1)
  } finally {
    await db.close()
  }
})

test('existing comped legacy plans retain feature tiers, scopes and team allowances', async () => {
  const db = await createDatabase()
  try {
    const capabilities = await db.query(`
      select
        public.workspace_scope_for_plan_key('single_team') as single_scope,
        public.workspace_scope_for_plan_key('small_club') as small_scope,
        public.workspace_scope_for_plan_key('large_club') as large_scope,
        public.workspace_scope_for_plan_key('pilot') as pilot_scope,
        public.can_use_plan_feature('${IDS.legacySingleClub}', 'parentPortal') as single_parent,
        public.can_use_plan_feature('${IDS.legacySingleClub}', 'resourceLibrary') as single_resources,
        public.can_use_plan_feature('${IDS.legacySingleClub}', 'advancedDevelopmentAnalytics') as single_advanced,
        public.can_use_plan_feature('${IDS.legacySmallClub}', 'clubAdministration') as small_admin,
        public.can_use_plan_feature('${IDS.legacySmallClub}', 'advancedDevelopmentAnalytics') as small_advanced,
        public.can_use_plan_feature('${IDS.legacyLargeClub}', 'negotiatedLimits') as large_negotiated,
        public.can_use_plan_feature('${IDS.legacyLargeClub}', 'integrations') as large_integrations,
        public.can_use_plan_feature('${IDS.legacyLargeClub}', 'nativeAppEntitlement') as large_native,
        public.can_use_plan_feature('${IDS.legacyPilotClub}', 'negotiatedLimits') as pilot_negotiated
    `)
    assert.deepEqual(capabilities.rows[0], {
      single_scope: 'team', small_scope: 'club', large_scope: 'club', pilot_scope: 'club',
      single_parent: true, single_resources: true, single_advanced: false,
      small_admin: true, small_advanced: false,
      large_negotiated: true, large_integrations: false, large_native: false,
      pilot_negotiated: true,
    })

    await db.exec(`
      insert into public.teams (id, club_id)
      select ('81000000-0000-4000-8000-' || lpad(value::text, 12, '0'))::uuid, '${IDS.legacySingleClub}'
      from generate_series(1, 2) value;
      insert into public.teams (id, club_id)
      select ('82000000-0000-4000-8000-' || lpad(value::text, 12, '0'))::uuid, '${IDS.legacySmallClub}'
      from generate_series(1, 6) value;
      insert into public.teams (id, club_id)
      select ('83000000-0000-4000-8000-' || lpad(value::text, 12, '0'))::uuid, '${IDS.legacyLargeClub}'
      from generate_series(1, 51) value;
      insert into public.teams (id, club_id)
      select ('84000000-0000-4000-8000-' || lpad(value::text, 12, '0'))::uuid, '${IDS.legacyPilotClub}'
      from generate_series(1, 4) value;
    `)

    const allowances = await db.query(`
      select
        public.can_insert_team_for_plan('${IDS.legacySingleClub}') as single_allowed,
        public.can_insert_team_for_plan('${IDS.legacySmallClub}') as small_allowed,
        public.can_insert_team_for_plan('${IDS.legacyLargeClub}') as large_allowed,
        public.can_insert_team_for_plan('${IDS.legacyPilotClub}') as pilot_allowed
    `)
    assert.deepEqual(allowances.rows[0], {
      single_allowed: true,
      small_allowed: true,
      large_allowed: true,
      pilot_allowed: true,
    })

    await db.exec(`
      insert into public.teams (id, club_id)
      values ('84000000-0000-4000-8000-000000000005', '${IDS.legacyPilotClub}')
    `)
    const pilotAtOverride = await db.query(`select public.can_insert_team_for_plan('${IDS.legacyPilotClub}') as allowed`)
    assert.equal(pilotAtOverride.rows[0].allowed, false)
  } finally {
    await db.close()
  }
})

test('database mutation gates add commercial restrictions without replacing role policies', async () => {
  const db = await createDatabase()
  try {
    await setActor(db, IDS.staff)

    await db.exec(`
      insert into public.players (id, club_id, player_name)
      values ('50000000-0000-4000-8000-000000000001', '${IDS.matchdayClub}', 'Player One');
      insert into public.match_days (id, club_id)
      values ('60000000-0000-4000-8000-000000000001', '${IDS.matchdayClub}');
    `)

    await assert.rejects(
      db.exec(`insert into public.evaluations (id, club_id) values ('70000000-0000-4000-8000-000000000001', '${IDS.matchdayClub}')`),
      /plan_capability_not_available/,
    )
    await assert.rejects(
      db.exec(`
        insert into public.calendar_events (id, club_id, event_type)
        values ('80000000-0000-4000-8000-000000000001', '${IDS.matchdayClub}', 'training')
      `),
      /plan_capability_not_available/,
    )

    const clubDevelopment = await db.query(
      `select public.can_use_plan_feature('${IDS.clubClub}', 'basicDevelopmentRecords') as allowed`,
    )
    assert.equal(clubDevelopment.rows[0].allowed, true)

    const triggerDefinition = await db.query(`
      select pg_get_triggerdef(oid) as definition
      from pg_trigger
      where tgrelid = 'public.evaluations'::regclass
        and tgname = 'enforce_plan_capability_mutation'
    `)
    assert.match(triggerDefinition.rows[0].definition, /BEFORE INSERT OR DELETE OR UPDATE/)
  } finally {
    await db.close()
  }
})

test('restrictive read policies hide disabled development, trial and calendar data after downgrade', async () => {
  const db = await createDatabase()
  try {
    await db.exec(`
      insert into public.players (id, club_id, player_name, section) values
        ('51000000-0000-4000-8000-000000000001', '${IDS.matchdayClub}', 'Squad Player', 'Squad'),
        ('51000000-0000-4000-8000-000000000002', '${IDS.matchdayClub}', 'Trial Player', 'Trial');
      insert into public.evaluations (id, club_id)
      values ('71000000-0000-4000-8000-000000000001', '${IDS.matchdayClub}');
      insert into public.match_days (id, club_id)
      values ('61000000-0000-4000-8000-000000000001', '${IDS.matchdayClub}');
      insert into public.teams (id, club_id)
      values ('31000000-0000-4000-8000-000000000001', '${IDS.matchdayClub}');
      insert into public.calendar_events (id, club_id, team_id, event_type) values
        ('81000000-0000-4000-8000-000000000001', '${IDS.matchdayClub}', '31000000-0000-4000-8000-000000000001', 'training'),
        ('81000000-0000-4000-8000-000000000002', '${IDS.matchdayClub}', '31000000-0000-4000-8000-000000000001', 'match');
    `)

    await setActor(db, IDS.staff)
    await db.exec('set role authenticated')
    const players = await db.query('select player_name from public.players order by player_name')
    assert.deepEqual(players.rows, [{ player_name: 'Squad Player' }])
    const evaluations = await db.query('select id from public.evaluations')
    assert.equal(evaluations.rows.length, 0)
    const fixtures = await db.query('select id from public.match_days')
    assert.equal(fixtures.rows.length, 1)
    const calendar = await db.query('select id from public.calendar_events')
    assert.deepEqual(calendar.rows, [{ id: '81000000-0000-4000-8000-000000000002' }])
  } finally {
    await db.close()
  }
})

test('ordinary authenticated actors cannot alter commercial club fields', async () => {
  const db = await createDatabase()
  try {
    await setActor(db, IDS.staff)
    await assert.rejects(
      db.exec(`update public.clubs set subscription_team_capacity = 20 where id = '${IDS.clubClub}'`),
      /club_commercial_fields_not_permitted/,
    )

    await setActor(db, IDS.admin)
    await db.exec(`update public.clubs set subscription_team_capacity = 20 where id = '${IDS.clubClub}'`)
    const saved = await db.query(`select subscription_team_capacity from public.clubs where id = '${IDS.clubClub}'`)
    assert.equal(saved.rows[0].subscription_team_capacity, 20)
  } finally {
    await db.close()
  }
})

test('existing Club branding trigger enforces the canonical plan capabilities', async () => {
  const db = await createDatabase()
  try {
    await setActor(db, IDS.staff)
    await db.exec(`update public.users set club_id = '${IDS.matchdayClub}' where id = '${IDS.staff}'`)
    await assert.rejects(
      db.exec(`update public.clubs set logo_url = 'https://example.com/matchday.png' where id = '${IDS.matchdayClub}'`),
      /Logo branding is not included in this plan/,
    )
    await assert.rejects(
      db.exec(`update public.clubs set theme_accent = 'blue' where id = '${IDS.matchdayClub}'`),
      /Custom colours and club branding are not included in this plan/,
    )

    await setActor(db, '')
    await db.exec(`update public.users set club_id = '${IDS.teamClub}' where id = '${IDS.staff}'`)
    await setActor(db, IDS.staff)
    await db.exec(`update public.clubs set logo_url = 'https://example.com/team.png' where id = '${IDS.teamClub}'`)
    await assert.rejects(
      db.exec(`update public.clubs set theme_accent = 'blue' where id = '${IDS.teamClub}'`),
      /Custom colours and club branding are not included in this plan/,
    )

    await setActor(db, '')
    await db.exec(`update public.users set club_id = '${IDS.clubClub}' where id = '${IDS.staff}'`)
    await setActor(db, IDS.staff)
    await db.exec(`
      update public.clubs
      set logo_url = 'https://example.com/club.png', theme_accent = 'blue'
      where id = '${IDS.clubClub}'
    `)

    const branding = await db.query(`
      select logo_url, theme_accent
      from public.clubs
      where id = '${IDS.clubClub}'
    `)
    assert.deepEqual(branding.rows[0], {
      logo_url: 'https://example.com/club.png',
      theme_accent: 'blue',
    })
  } finally {
    await db.close()
  }
})
