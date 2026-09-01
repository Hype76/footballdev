import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'
import { PGlite } from '@electric-sql/pglite'

const migrationUrl = new URL('../supabase/migrations/20260901151224_shared_fixture_defaults.sql', import.meta.url)
const migrationSql = await readFile(migrationUrl, 'utf8')

const CLUB_ID = '20000000-0000-4000-8000-000000000001'
const TEAM_ID = '20000000-0000-4000-8000-000000000002'
const OTHER_TEAM_ID = '20000000-0000-4000-8000-000000000003'
const COACH_ID = '20000000-0000-4000-8000-000000000004'
const SECOND_COACH_ID = '20000000-0000-4000-8000-000000000005'
const OUTSIDER_ID = '20000000-0000-4000-8000-000000000006'

async function createDatabase() {
  const db = new PGlite()
  await db.exec(`
    create schema if not exists auth;
    create schema if not exists app_private;
    create role anon;
    create role authenticated;
    create role service_role;

    create function auth.uid()
    returns uuid
    language sql
    stable
    as $$ select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;

    create table public.users (id uuid primary key);
    create table public.clubs (id uuid primary key);
    create table public.teams (
      id uuid primary key,
      archived_at timestamptz,
      club_id uuid not null references public.clubs(id)
    );
    create table public.audit_logs (
      id bigint generated always as identity primary key,
      action text not null,
      actor_id uuid,
      club_id uuid not null,
      entity_id uuid,
      entity_type text,
      metadata jsonb not null default '{}'::jsonb
    );

    create function app_private.actor_can_manage_team_resource(
      p_actor_id uuid,
      p_club_id uuid,
      p_team_id uuid,
      p_minimum_rank integer
    )
    returns boolean
    language sql
    stable
    as $$
      select p_actor_id in ('${COACH_ID}'::uuid, '${SECOND_COACH_ID}'::uuid)
        and p_club_id = '${CLUB_ID}'::uuid
        and p_team_id = '${TEAM_ID}'::uuid
        and p_minimum_rank <= 20
    $$;

    insert into public.users (id) values
      ('${COACH_ID}'),
      ('${SECOND_COACH_ID}'),
      ('${OUTSIDER_ID}');
    insert into public.clubs (id) values ('${CLUB_ID}');
    insert into public.teams (id, club_id) values
      ('${TEAM_ID}', '${CLUB_ID}'),
      ('${OTHER_TEAM_ID}', '${CLUB_ID}');
  `)
  await db.exec(migrationSql)
  return db
}

async function setActor(db, actorId) {
  await db.exec(`select set_config('request.jwt.claim.sub', '${actorId}', false);`)
}

test('signed-in Coach defaults are durable, partial updates preserve prior values, and reads are per user', async () => {
  const db = await createDatabase()
  await setActor(db, COACH_ID)

  const missing = await db.query(
    'select public.get_own_team_fixture_preferences($1) as preferences',
    [TEAM_ID],
  )
  assert.deepEqual(missing.rows[0].preferences, { found: false })

  const saved = await db.query(
    `select public.set_own_team_fixture_preferences($1, true, '45', null, true, 80) as preferences`,
    [TEAM_ID],
  )
  assert.equal(saved.rows[0].preferences.arrivalPreset, '45')
  assert.equal(saved.rows[0].preferences.duration, 80)

  const durationOnly = await db.query(
    `select public.set_own_team_fixture_preferences($1, false, '30', null, true, 70) as preferences`,
    [TEAM_ID],
  )
  assert.equal(durationOnly.rows[0].preferences.arrivalPreset, '45')
  assert.equal(durationOnly.rows[0].preferences.duration, 70)

  const customArrival = await db.query(
    `select public.set_own_team_fixture_preferences($1, true, 'custom', '08:25', false, 90) as preferences`,
    [TEAM_ID],
  )
  assert.equal(customArrival.rows[0].preferences.arrivalPreset, 'custom')
  assert.equal(customArrival.rows[0].preferences.arrivalTime, '08:25')
  assert.equal(customArrival.rows[0].preferences.duration, 70)

  await setActor(db, SECOND_COACH_ID)
  const separate = await db.query(
    'select public.get_own_team_fixture_preferences($1) as preferences',
    [TEAM_ID],
  )
  assert.deepEqual(separate.rows[0].preferences, { found: false })
})

test('unauthorised scope and invalid defaults are rejected without changing stored values', async () => {
  const db = await createDatabase()
  await setActor(db, COACH_ID)
  await db.query(
    `select public.set_own_team_fixture_preferences($1, true, '30', null, true, 90)`,
    [TEAM_ID],
  )

  await assert.rejects(
    db.query(`select public.set_own_team_fixture_preferences($1, false, '30', null, true, 81)`, [TEAM_ID]),
    /even number from 20 to 140/i,
  )
  await assert.rejects(
    db.query(`select public.set_own_team_fixture_preferences($1, true, 'custom', null, false, 90)`, [TEAM_ID]),
    /custom arrival time/i,
  )
  await assert.rejects(
    db.query(`select public.set_own_team_fixture_preferences($1, false, '30', null, false, 90)`, [TEAM_ID]),
    /at least one fixture default/i,
  )

  await setActor(db, OUTSIDER_ID)
  await assert.rejects(
    db.query('select public.get_own_team_fixture_preferences($1)', [TEAM_ID]),
    /Coach or manager access is required/i,
  )
  await setActor(db, COACH_ID)
  await assert.rejects(
    db.query('select public.get_own_team_fixture_preferences($1)', [OTHER_TEAM_ID]),
    /Coach or manager access is required/i,
  )

  const stored = await db.query(
    'select arrival_preset, duration_minutes from app_private.user_team_fixture_preferences where user_id = $1 and team_id = $2',
    [COACH_ID, TEAM_ID],
  )
  assert.deepEqual(stored.rows, [{ arrival_preset: '30', duration_minutes: 90 }])
})
