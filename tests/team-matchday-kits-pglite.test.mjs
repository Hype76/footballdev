import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'
import { PGlite } from '@electric-sql/pglite'

const migrationUrl = new URL('../supabase/migrations/20260921144803_team_matchday_kit_colours.sql', import.meta.url)
const CLUB_A = '00000000-0000-4000-8000-000000000001'
const CLUB_B = '00000000-0000-4000-8000-000000000002'
const TEAM_A = '00000000-0000-4000-8000-000000000011'
const TEAM_B = '00000000-0000-4000-8000-000000000012'

async function setup() {
  const db = new PGlite()
  await db.exec(`
    create schema auth;
    create schema app_private;
    create role anon;
    create role authenticated;
    create role service_role;
    create table public.clubs (id uuid primary key, plan_key text);
    insert into public.clubs values ('${CLUB_A}', 'team'), ('${CLUB_B}', 'club');
    create table public.teams (
      id uuid primary key,
      club_id uuid not null,
      name text not null
    );
    insert into public.teams values
      ('${TEAM_A}', '${CLUB_A}', 'A'),
      ('${TEAM_B}', '${CLUB_B}', 'B');
    create function auth.uid() returns uuid language sql stable as
      $$ select nullif(current_setting('app.test_uid', true), '')::uuid $$;
    create function auth.role() returns text language sql stable as
      $$ select nullif(current_setting('app.test_auth_role', true), '') $$;
    create function public.current_user_can_access_team(target_club_id uuid, target_team_id uuid)
    returns boolean language sql stable as
      $$ select target_club_id::text = current_setting('app.test_club', true)
           and target_team_id::text = current_setting('app.test_team', true) $$;
    create function public.current_user_role() returns text language sql stable as
      $$ select nullif(current_setting('app.test_role', true), '') $$;
    create function public.current_user_team_role_rank(target_team_id uuid) returns integer language sql stable as
      $$ select case when target_team_id::text = current_setting('app.test_team', true)
           then nullif(current_setting('app.test_rank', true), '')::integer else 0 end $$;
    create function public.can_use_plan_feature(target_club_id uuid, feature_name text) returns boolean language sql stable as
      $$ select target_club_id::text = current_setting('app.test_club', true)
           and feature_name = 'matchDay'
           and coalesce(nullif(current_setting('app.test_matchday', true), ''), 'false')::boolean $$;
    grant usage on schema public to authenticated;
    grant select, insert, update on public.teams to authenticated;
  `)
  await db.exec(await readFile(migrationUrl, 'utf8'))
  const scopes = await readFile(new URL('../supabase/migrations/20260918104253_matchday_tier_entitlement_security.sql', import.meta.url), 'utf8')
  for (const name of ['normalize_subscription_plan_key', 'workspace_scope_for_plan_key']) {
    const start = scopes.indexOf('create or replace function public.' + name)
    await db.exec(scopes.slice(start, scopes.indexOf('$;', start) + 3))
  }
  await db.exec(await readFile(new URL('../supabase/migrations/20261002115841_club_managed_team_kits.sql', import.meta.url), 'utf8'))
  return db
}

async function actor(db, { club = CLUB_A, team = TEAM_A, rank = 50, role = 'manager', matchday = true } = {}) {
  await db.query(`select set_config('app.test_uid', '00000000-0000-4000-8000-000000000099', false)`)
  await db.query(`select set_config('app.test_auth_role', 'authenticated', false)`)
  await db.query(`select set_config('app.test_club', $1, false)`, [club])
  await db.query(`select set_config('app.test_team', $1, false)`, [team])
  await db.query(`select set_config('app.test_rank', $1, false)`, [String(rank)])
  await db.query(`select set_config('app.test_role', $1, false)`, [role])
  await db.query(`select set_config('app.test_matchday', $1, false)`, [String(matchday)])
}

test('manager can save exact-team colours when Matchday is enabled', async () => {
  const db = await setup()
  await actor(db)
  await db.query(`update public.teams set home_kit_colour = '#2563eb', away_kit_colour = '#ffffff' where id = $1`, [TEAM_A])
  const result = await db.query(`select home_kit_colour, away_kit_colour from public.teams where id = $1`, [TEAM_A])
  assert.deepEqual(result.rows[0], { home_kit_colour: '#2563eb', away_kit_colour: '#ffffff' })
  await db.query(`update public.teams set away_kit_colour = null where id = $1`, [TEAM_A])
  assert.deepEqual((await db.query(`select home_kit_colour, away_kit_colour from public.teams where id = $1`, [TEAM_A])).rows[0], { home_kit_colour: '#2563eb', away_kit_colour: null })
  await db.query(`update public.teams set home_kit_colour = null where id = $1`, [TEAM_A])
  assert.deepEqual((await db.query(`select home_kit_colour, away_kit_colour from public.teams where id = $1`, [TEAM_A])).rows[0], { home_kit_colour: null, away_kit_colour: null })
  await db.close()
})

test('kit writes deny lower rank, cross-team scope, disabled entitlement, null checks, and invalid hex', async () => {
  const cases = [
    [{ rank: 20 }, 'team_kit_update_not_authorized'],
    [{ club: CLUB_A, team: TEAM_B }, 'team_kit_update_not_authorized'],
    [{ matchday: false }, 'plan_capability_not_available'],
    [{ role: '', rank: 0 }, 'team_kit_update_not_authorized'],
  ]
  for (const [context, message] of cases) {
    const db = await setup()
    await actor(db)
    await db.query(`update public.teams set home_kit_colour = '#dc2626', away_kit_colour = '#ffffff' where id = $1`, [TEAM_A])
    await actor(db, context)
    await assert.rejects(db.query(`update public.teams set home_kit_colour = '#2563eb' where id = $1`, [TEAM_A]), new RegExp(message))
    await assert.rejects(db.query(`update public.teams set home_kit_colour = null, away_kit_colour = null where id = $1`, [TEAM_A]), new RegExp(message))
    await db.close()
  }
  const db = await setup()
  await actor(db)
  await assert.rejects(db.query(`update public.teams set home_kit_colour = '#nothex' where id = $1`, [TEAM_A]), /teams_home_kit_colour_hex/)
  await db.close()
})

test('initial team creation cannot seed colours without Matchday entitlement', async () => {
  const db = await setup()
  const newTeam = '00000000-0000-4000-8000-000000000013'
  await actor(db, { matchday: false, team: newTeam })
  await assert.rejects(db.query(`insert into public.teams (id, club_id, name, home_kit_colour) values ($1, $2, 'C', '#2563eb')`, [newTeam, CLUB_A]), /plan_capability_not_available/)
  await db.query(`insert into public.teams (id, club_id, name) values ('00000000-0000-4000-8000-000000000014', $1, 'D')`, [CLUB_A])
  await db.close()
})


test('club scopes block manager and admin override writes, clears and seeds; saved data survives upgrade and transfer', async () => {
  const db=await setup()
  await actor(db)
  await db.query("update public.teams set home_kit_colour='#dc2626', away_kit_colour='#ffffff' where id=$1", [TEAM_A])
  for (const plan of ['club','small_club','development_club','large_club','pilot']) {
    await db.query('update public.clubs set plan_key=$1 where id=$2', [plan, CLUB_A])
    for (const role of ['manager','admin','super_admin']) {
      await actor(db,{role})
      for (const value of ['#2563eb',null]) {
        await assert.rejects(db.query('update public.teams set home_kit_colour=$1 where id=$2',[value,TEAM_A]), /team_kits_managed_by_club_admin/)
      }
    }
    await db.query('update public.teams set home_kit_colour=home_kit_colour, name=name where id=$1',[TEAM_A])
    const seeded='00000000-0000-4000-8000-000000000088'
    await actor(db,{team:seeded})
    await assert.rejects(db.query("insert into public.teams(id,club_id,name,home_kit_colour) values($1,$2,'seed','#2563eb')",[seeded,CLUB_A]), /team_kits_managed_by_club_admin/)
  }
  assert.deepEqual((await db.query('select home_kit_colour,away_kit_colour from public.teams where id=$1',[TEAM_A])).rows[0], {home_kit_colour:'#dc2626',away_kit_colour:'#ffffff'})
  await db.query('update public.teams set club_id=$1 where id=$2',[CLUB_B,TEAM_A])
  await actor(db,{club:CLUB_B})
  await assert.rejects(db.query("update public.teams set home_kit_colour='#2563eb' where id=$1",[TEAM_A]), /team_kits_managed_by_club_admin/)
  for (const plan of ['matchday','team','single_team','individual','legacy_unknown']) {
    await db.query('update public.clubs set plan_key=$1 where id=$2',[plan,CLUB_B])
    await db.query("update public.teams set home_kit_colour='#2563eb' where id=$1",[TEAM_A])
    await db.query("update public.teams set home_kit_colour='#dc2626' where id=$1",[TEAM_A])
  }
  await db.close()
})
