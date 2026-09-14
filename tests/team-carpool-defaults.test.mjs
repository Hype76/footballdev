import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { test } from 'node:test'
import { PGlite } from '@electric-sql/pglite'

test('Car pool defaults persist per team and new matches inherit both off and on', async () => {
  const db = new PGlite()
  try {
    const fixture = await readFile('tests/carpool-calendar-participants-124-pglite.test.mjs', 'utf8')
    const bootstrap = fixture.split('await db.exec(`')[1].split('`)')[0]
    await db.exec(bootstrap)
    await db.exec(await readFile('supabase/migrations/20260829160252_parent_carpool_and_active_team_selection_124.sql', 'utf8'))
    await db.exec(`create schema app_private;
      create table public.teams(id uuid primary key, club_id uuid, archived_at timestamptz);
      create or replace function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('test.actor', true),'')::uuid $$;
      create function app_private.actor_can_manage_team_resource(uuid,uuid,uuid,integer) returns boolean language sql stable as $$ select $1='10000000-0000-4000-8000-000000000001'::uuid $$;
      create function public.update_match_day_fixture_for_team(p_match_day_id uuid,p_team_id uuid,p_fixture jsonb) returns void language plpgsql as $$
      declare arrival_time_value time; begin
        update public.match_days match_day set arrival_time = arrival_time_value, team_id=p_team_id where id=p_match_day_id;
      end; $$;
      alter table public.match_days add column arrival_time time;
      insert into public.teams values('10000000-0000-4000-8000-000000000002','10000000-0000-4000-8000-000000000003',null);
      insert into public.teams values('10000000-0000-4000-8000-000000000004','10000000-0000-4000-8000-000000000003',null);
    `)
    await db.exec((await readFile('supabase/migrations/20260914154000_team_carpool_defaults.sql', 'utf8')).split('-- Player account conversion')[0])
    const team = '10000000-0000-4000-8000-000000000002'
    await assert.rejects(db.query('select public.set_team_carpool_default($1,false)', [team]), /Coach access/)
    await db.exec("select set_config('test.actor','10000000-0000-4000-8000-000000000001',false)")
    for (const enabled of [false, true, false]) {
      await db.query('select public.set_team_carpool_default($1,$2)', [team, enabled])
      assert.equal((await db.query('select public.get_team_carpool_default($1) as value', [team])).rows[0].value, enabled)
      assert.equal((await db.query('insert into public.match_days(id,team_id) values(gen_random_uuid(),$1) returning carpool_enabled', [team])).rows[0].carpool_enabled, enabled)
    }
    assert.equal((await db.query("select public.get_team_carpool_default('10000000-0000-4000-8000-000000000004') as value")).rows[0].value, true)
    assert.deepEqual((await db.query('select carpool_enabled from public.match_days order by ctid')).rows.map(row => row.carpool_enabled), [false,true,false])
    const definition = (await db.query("select pg_get_functiondef('public.set_parent_portal_match_transport(uuid,uuid,text,integer)'::regprocedure) as value")).rows[0].value
    assert.match(definition, /or not fixture_row.carpool_enabled/)
  } finally { await db.close() }
})
