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
      plan_key text not null,
      plan_status text not null default 'active',
      is_plan_comped boolean not null default false,
      billing_arrangement text,
      billing_start_at timestamptz,
      archived_at timestamptz,
      logo_url text,
      require_approval boolean not null default false,
      theme_accent text not null default 'yellow',
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
      club_id uuid not null references public.clubs (id)
    );
    create table public.stripe_checkout_records (
      id uuid primary key,
      plan_key text not null
    );
    create table public.players (
      id uuid primary key,
      club_id uuid not null references public.clubs (id),
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
        public.normalize_subscription_plan_key('pilot') as pilot
    `)
    assert.deepEqual(normalized.rows[0], {
      individual: 'matchday',
      single_team: 'team',
      development_club: 'club',
      pilot: 'club',
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
