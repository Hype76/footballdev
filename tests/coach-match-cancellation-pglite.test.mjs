import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'
import { PGlite } from '@electric-sql/pglite'

const actor = '10000000-0000-4000-8000-000000000001'
const club = '20000000-0000-4000-8000-000000000001'
const team = '30000000-0000-4000-8000-000000000001'
const fixture = '40000000-0000-4000-8000-000000000001'
const migration = new URL('../supabase/migrations/20260929085237_coach_match_fixture_cancellation.sql', import.meta.url)

test('authorised pre-match cancellation keeps the fixture record and writes one audit entry', async () => {
  const db = new PGlite()
  try {
    await db.exec(`
      create role anon;
      create role authenticated;
      create role service_role;
      create schema auth;
      create schema app_private;
      create function auth.uid() returns uuid language sql stable as $$ select '${actor}'::uuid $$;
      create table public.clubs (id uuid primary key, status text not null default 'active');
      create table public.teams (id uuid primary key, club_id uuid not null, status text not null default 'active');
      create table public.match_days (
        id uuid primary key, club_id uuid not null, team_id uuid not null,
        status text not null default 'scheduled', deleted_at timestamptz,
        concluded_at timestamptz, updated_at timestamptz
      );
      create table public.audit_logs (
        id bigint generated always as identity primary key, club_id uuid,
        actor_id uuid, action text, entity_type text, entity_id uuid, metadata jsonb
      );
      create function app_private.actor_can_manage_team_resource(
        actor_id_value uuid, club_id_value uuid, team_id_value uuid, minimum_role_level integer
      ) returns boolean language sql stable as $$
        select actor_id_value = '${actor}'::uuid
          and club_id_value = '${club}'::uuid
          and team_id_value = '${team}'::uuid
          and minimum_role_level = 20
      $$;
      insert into public.clubs values ('${club}', 'active');
      insert into public.teams values ('${team}', '${club}', 'active');
      insert into public.match_days(id, club_id, team_id) values ('${fixture}', '${club}', '${team}');
    `)
    await db.exec(await readFile(migration, 'utf8'))
    const cancel = (teamId = team) => db.query(
      'select public.cancel_match_day_fixture_for_team($1, $2) as fixture',
      [fixture, teamId],
    )
    await assert.rejects(cancel('30000000-0000-4000-8000-000000000099'), /match_day_fixture_not_permitted/)
    assert.equal((await cancel()).rows[0].fixture.status, 'cancelled')
    assert.equal((await db.query('select count(*)::integer as total from public.audit_logs')).rows[0].total, 1)
    await assert.rejects(cancel(), /match_day_fixture_already_started/)
    assert.equal((await db.query('select count(*)::integer as total from public.audit_logs')).rows[0].total, 1)
    for (const status of ['live', 'full_time']) {
      await db.query('update public.match_days set status = $1 where id = $2', [status, fixture])
      await assert.rejects(cancel(), /match_day_fixture_already_started/)
    }
    await db.query("update public.match_days set status = 'scheduled', concluded_at = now() where id = $1", [fixture])
    await assert.rejects(cancel(), /match_day_fixture_already_started/)
    const privileges = await db.query(
      "select has_function_privilege('anon', 'public.cancel_match_day_fixture_for_team(uuid,uuid)', 'execute') as anon, has_function_privilege('authenticated', 'public.cancel_match_day_fixture_for_team(uuid,uuid)', 'execute') as authenticated",
    )
    assert.deepEqual(privileges.rows, [{ anon: false, authenticated: true }])
  } finally {
    await db.close()
  }
})
