import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'
import { PGlite } from '@electric-sql/pglite'

const club = '00000000-0000-4000-8000-000000000001'
const foreign = '00000000-0000-4000-8000-000000000002'
const team = '00000000-0000-4000-8000-000000000011'
const actorId = '00000000-0000-4000-8000-000000000099'
const sql = name => readFile(new URL('../supabase/migrations/' + name, import.meta.url), 'utf8')

async function setup() {
  const db = new PGlite()
  await db.exec(`
    create schema auth; create schema app_private;
    create role anon; create role authenticated; create role service_role;
    create table public.clubs (id uuid primary key, plan_key text, status text);
    create table public.users (id uuid primary key, club_id uuid, role text, role_rank integer, status text);
    create table public.user_club_memberships (auth_user_id uuid, club_id uuid, role text, role_rank integer);
    create table public.platform_admins (id uuid, status text);
    create table public.teams (id uuid primary key, club_id uuid, name text);
    insert into public.clubs values ('${club}', 'club', 'active'), ('${foreign}', 'club', 'active');
    insert into public.teams values ('${team}', '${club}', 'Original');
    create function auth.uid() returns uuid language sql stable as
      $$ select nullif(current_setting('app.test_uid', true), '')::uuid $$;
  `)
  const authority = await sql('20260719071505_p0_shared_authority_profile_containment.sql')
  for (const name of ['current_user_role', 'current_user_club_id']) {
    const start = authority.indexOf('create or replace function public.' + name + '()')
    await db.exec(authority.slice(start, authority.indexOf('$$;', start) + 3))
  }
  await db.exec(`
    create function public.current_user_can_access_team(c uuid, t uuid) returns boolean language sql stable as
      $$ select c = public.current_user_club_id() and t = '${team}'::uuid $$;
    create function public.current_user_team_role_rank(t uuid) returns integer language sql stable as
      $$ select coalesce((select role_rank from public.users where id = auth.uid() and status = 'active' and t = '${team}'::uuid), 0) $$;
    create function public.can_use_plan_feature(c uuid, feature text) returns boolean language sql stable as
      $$ select c = public.current_user_club_id() and feature = 'matchDay'
        and coalesce(nullif(current_setting('app.test_entitled', true), ''), 'true')::boolean $$;
    grant usage on schema public to authenticated;
    grant select, insert, update on public.teams to authenticated;
  `)
  const plans = await sql('20260918104253_matchday_tier_entitlement_security.sql')
  for (const name of ['normalize_subscription_plan_key', 'canonical_subscription_plan_key', 'workspace_scope_for_plan_key']) {
    const start = plans.indexOf('create or replace function public.' + name + '(')
    await db.exec(plans.slice(start, plans.indexOf('$$;', start) + 3))
  }
  await db.exec(await sql('20260921144803_team_matchday_kit_colours.sql'))
  await db.exec(await sql('20261006120000_club_team_kit_admin_boundary.sql'))
  return db
}
async function actor(db, { role = 'manager', rank = 50, membership = true, actorClub = club, status = 'active' } = {}) {
  await db.exec('reset role')
  await db.query('delete from public.user_club_memberships')
  await db.query('delete from public.users')
  await db.query('insert into public.users values ($1, $2, $3, $4, $5)', [actorId, actorClub, role, rank, status])
  if (membership) await db.query('insert into public.user_club_memberships values ($1, $2, $3, $4)', [actorId, actorClub, role, rank])
  await db.query("select set_config('app.test_uid', $1, false)", [actorId])
  await db.exec('set role authenticated')
}
const change = db => db.query('update public.teams set home_kit_colour = $1 where id = $2', ['#2563eb', team])

test('actual kit trigger denies Club Team Admin direct writes for all Club tiers', async () => {
  const db = await setup()
  try {
    for (const plan of ['club', 'small_club', 'development_club', 'large_club', 'pilot']) {
      await db.exec('reset role')
      await db.query('update public.clubs set plan_key = $1 where id = $2', [plan, club])
      await actor(db)
      await assert.rejects(change(db), /club_kit_update_requires_club_admin/)
      const saved = await db.query('select home_kit_colour from public.teams where id = $1', [team])
      assert.equal(saved.rows[0].home_kit_colour, null)
    }
    await db.query("update public.teams set name = 'Renamed' where id = $1", [team])
    assert.equal((await db.query('select name from public.teams where id = $1', [team])).rows[0].name, 'Renamed')
  } finally { await db.close() }
})
test('active same-club Club Admin allowed; foreign, revoked and suspended authority denied', async () => {
  const db = await setup()
  try {
    await actor(db, { role: 'admin', rank: 100 })
    await change(db)
    for (const context of [{ role: 'admin', rank: 100, actorClub: foreign }, { role: 'admin', rank: 100, membership: false }, { role: 'admin', rank: 100, status: 'suspended' }]) {
      await actor(db, context)
      await assert.rejects(db.query("update public.teams set home_kit_colour = '#ffffff' where id = $1", [team]), /team_kit_update_not_authorized|club_kit_update_requires_club_admin/)
    }
  } finally { await db.close() }
})
test('standalone Team Admin retains colours; entitlement and hex constraints still deny', async () => {
  const db = await setup()
  try {
    for (const plan of ['team', 'single_team', 'matchday']) {
      await db.exec('reset role')
      await db.query('update public.clubs set plan_key = $1 where id = $2', [plan, club])
      await actor(db)
      await db.query('update public.teams set home_kit_colour = $1 where id = $2', [null, team])
      await change(db)
      await assert.rejects(db.query("update public.teams set home_kit_colour = '#bad' where id = $1", [team]), /teams_home_kit_colour_hex/)
    }
    await db.exec("select set_config('app.test_entitled', 'false', false)")
    await assert.rejects(db.query("update public.teams set home_kit_colour = '#ffffff' where id = $1", [team]), /plan_capability_not_available/)
  } finally { await db.close() }
})
