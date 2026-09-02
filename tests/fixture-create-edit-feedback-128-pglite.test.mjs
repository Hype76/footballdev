import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'

import { PGlite } from '@electric-sql/pglite'

const migrationUrl = new URL('../supabase/migrations/20260901073002_fixture_edit_defaults_and_saved_locations.sql', import.meta.url)
const IDS = {
  actor: '10000000-0000-4000-8000-000000000001',
  club: '20000000-0000-4000-8000-000000000001',
  match: '30000000-0000-4000-8000-000000000001',
  team: '40000000-0000-4000-8000-000000000001',
}

const schemaSql = `
create role anon;
create role authenticated;
create role service_role;
create schema auth;
create schema app_private;

create table auth.users (id uuid primary key);

create function auth.uid()
returns uuid
language sql stable
as $$ select '${IDS.actor}'::uuid $$;

create table public.clubs (
  id uuid primary key,
  status text not null default 'active'
);

create table public.teams (
  id uuid primary key,
  club_id uuid not null references public.clubs(id),
  status text not null default 'active'
);

create function app_private.actor_can_manage_team_resource(
  actor_id_value uuid,
  club_id_value uuid,
  team_id_value uuid,
  minimum_role_level integer
)
returns boolean
language sql stable
as $$
  select coalesce(actor_id_value = '${IDS.actor}'::uuid
    and club_id_value = '${IDS.club}'::uuid
    and team_id_value = '${IDS.team}'::uuid
    and minimum_role_level = 20, false)
$$;

create table public.match_days (
  id uuid primary key,
  club_id uuid not null references public.clubs(id),
  team_id uuid not null references public.teams(id),
  location_id uuid,
  opponent text not null default 'Opponent',
  fixture_type text,
  match_date date,
  kickoff_time time,
  kickoff_time_tbc boolean not null default false,
  arrival_time time,
  home_away text not null default 'home',
  shirt_choice text not null default 'home',
  match_duration_minutes integer not null default 90,
  match_conclusion_rule text not null default 'normal_time',
  extra_time_half_minutes integer not null default 15,
  extra_time_period_count integer not null default 2,
  venue_name text not null default '',
  venue_address text not null default '',
  notes text not null default '',
  status text not null default 'scheduled',
  deleted_at timestamptz,
  updated_at timestamptz not null default timezone('utc', now()),
  constraint match_days_shirt_choice_check check (shirt_choice in ('home', 'away'))
);

create table public.match_locations (
  id uuid primary key default gen_random_uuid(),
  club_id uuid not null references public.clubs(id),
  name text not null,
  address text not null default '',
  notes text not null default '',
  created_by uuid references auth.users(id),
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now())
);

create unique index match_locations_club_name_address_key
  on public.match_locations (club_id, lower(name), lower(address));

create table public.audit_logs (
  id bigint generated always as identity primary key,
  club_id uuid,
  actor_id uuid,
  action text not null,
  entity_type text not null,
  entity_id uuid,
  metadata jsonb not null default '{}'::jsonb
);

insert into auth.users(id) values ('${IDS.actor}');
insert into public.clubs(id) values ('${IDS.club}');
insert into public.teams(id, club_id) values ('${IDS.team}', '${IDS.club}');
insert into public.match_days(id, club_id, team_id) values ('${IDS.match}', '${IDS.club}', '${IDS.team}');
`

test('short fixture durations save through constraints and authorised RPCs with the same permission checks', async () => {
  const db = new PGlite()
  try {
    await db.exec(schemaSql)
    await db.exec(await readFile(migrationUrl, 'utf8'))
    await db.exec(`
      create table public.users (id uuid primary key);
      insert into public.users values ('${IDS.actor}');
      alter table public.teams add column archived_at timestamptz;
      alter table public.match_days add constraint match_days_match_duration_minutes_check
        check (match_duration_minutes between 20 and 140 and mod(match_duration_minutes, 2) = 0);
    `)
    await db.exec(await readFile(new URL('../supabase/migrations/20260901151224_shared_fixture_defaults.sql', import.meta.url), 'utf8'))
    await db.exec(await readFile(new URL('../supabase/migrations/20260902133512_match_duration_minimum_two_minutes.sql', import.meta.url), 'utf8'))
    const payload = {
      opponent: 'FP TEST Visitors', fixtureType: 'friendly', homeAway: 'away', shirtChoice: 'home',
      matchDate: '2099-09-06', kickoffTimeTbc: true, conclusionRule: 'normal_time',
      extraTimeHalfMinutes: 10, extraTimePeriodCount: 2,
    }
    for (const duration of [2, 10, 18, 140]) {
      const updated = await db.query('select public.update_match_day_fixture_for_team($1, $2, $3) as fixture',
        [IDS.match, IDS.team, { ...payload, matchDurationMinutes: duration }])
      assert.equal(updated.rows[0].fixture.match_duration_minutes, duration)
      const saved = await db.query("select public.set_own_team_fixture_preferences($1, false, '30', null, true, $2) as preferences", [IDS.team, duration])
      assert.equal(saved.rows[0].preferences.duration, duration)
    }
    for (const duration of [0, 1, 3, 141, 142]) {
      await assert.rejects(db.query('update public.match_days set match_duration_minutes=$1 where id=$2', [duration, IDS.match]), /match_days_match_duration_minutes_check/)
      await assert.rejects(db.query('select public.update_match_day_fixture_for_team($1, $2, $3)', [IDS.match, IDS.team, { ...payload, matchDurationMinutes: duration }]), /match_day_fixture_invalid/)
      await assert.rejects(db.query("select public.set_own_team_fixture_preferences($1, false, '30', null, true, $2)", [IDS.team, duration]), /even number from 2 to 140/)
    }
    await db.exec('create or replace function auth.uid() returns uuid language sql stable as $$ select null::uuid $$;')
    await assert.rejects(db.query('select public.update_match_day_fixture_for_team($1, $2, $3)', [IDS.match, IDS.team, { ...payload, matchDurationMinutes: 2 }]), /match_day_fixture_not_permitted/)
    await assert.rejects(db.query("select public.set_own_team_fixture_preferences($1, false, '30', null, true, 2)", [IDS.team]), /Authentication is required/)
    const privileges = await db.query("select has_function_privilege('anon', 'public.set_own_team_fixture_preferences(uuid,boolean,text,time,boolean,integer)', 'execute') as anon, has_function_privilege('authenticated', 'public.set_own_team_fixture_preferences(uuid,boolean,text,time,boolean,integer)', 'execute') as authenticated")
    assert.deepEqual(privileges.rows, [{ anon: false, authenticated: true }])
  } finally {
    await db.close()
  }
})

test('fixture feedback migration stores the notification snapshot, TBC Kits, and archived locations', async () => {
  const db = new PGlite()

  try {
    await db.exec(schemaSql)
    await db.exec(await readFile(migrationUrl, 'utf8'))

    await db.query(
      "update public.match_days set notification_team_name = 'U14 JPL', shirt_choice = 'tbc' where id = $1",
      [IDS.match],
    )
    const match = await db.query(
      'select notification_team_name, shirt_choice from public.match_days where id = $1',
      [IDS.match],
    )
    assert.deepEqual(match.rows, [{ notification_team_name: 'U14 JPL', shirt_choice: 'tbc' }])

    await assert.rejects(
      db.query('update public.match_days set notification_team_name = $1 where id = $2', ['x'.repeat(41), IDS.match]),
      /match_days_notification_team_name_length_check/,
    )

    const created = await db.query(
      'select public.upsert_match_location_for_team($1, $2, $3, $4) as id',
      [IDS.team, 'Home Ground', '1 Football Road', 'Main entrance'],
    )
    const locationId = created.rows[0].id

    await db.query(
      'select public.archive_match_location_for_team($1, $2, $3, $4)',
      [IDS.team, locationId, '', ''],
    )
    const archived = await db.query(
      'select archived_at is not null as archived, archived_by from public.match_locations where id = $1',
      [locationId],
    )
    assert.deepEqual(archived.rows, [{ archived: true, archived_by: IDS.actor }])

    const restored = await db.query(
      'select public.upsert_match_location_for_team($1, $2, $3, $4) as id',
      [IDS.team, 'Home Ground', '1 Football Road', 'Updated entrance'],
    )
    assert.equal(restored.rows[0].id, locationId)
    const active = await db.query(
      'select archived_at, archived_by, notes from public.match_locations where id = $1',
      [locationId],
    )
    assert.deepEqual(active.rows, [{ archived_at: null, archived_by: null, notes: 'Updated entrance' }])

    const updated = await db.query(
      `select public.update_match_day_fixture_for_team($1, $2, $3::jsonb) as fixture`,
      [IDS.match, IDS.team, JSON.stringify({
        arrivalTime: '10:15',
        conclusionRule: 'extra_time_then_penalties',
        extraTimeHalfMinutes: 10,
        extraTimePeriodCount: 2,
        fixtureType: 'cup',
        homeAway: 'away',
        kickoffTime: '11:00',
        kickoffTimeTbc: false,
        locationId,
        matchDate: '2099-08-17',
        matchDurationMinutes: 80,
        notes: 'Bring both kits.',
        notificationTeamName: 'U14 JPL',
        opponent: 'Visitors FC',
        shirtChoice: 'tbc',
        venueAddress: '1 Football Road',
        venueName: 'Home Ground',
      })],
    )
    assert.equal(updated.rows[0].fixture.opponent, 'Visitors FC')
    assert.equal(updated.rows[0].fixture.shirt_choice, 'tbc')
    assert.equal(updated.rows[0].fixture.match_duration_minutes, 80)
    assert.equal(updated.rows[0].fixture.match_conclusion_rule, 'extra_time_then_penalties')

    const audit = await db.query(
      "select action from public.audit_logs where entity_id = $1 and action = 'match_day_fixture_updated'",
      [IDS.match],
    )
    assert.deepEqual(audit.rows, [{ action: 'match_day_fixture_updated' }])
  } finally {
    await db.close()
  }
})
