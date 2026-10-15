import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'
import { PGlite } from '@electric-sql/pglite'

const migration = await readFile(new URL('../supabase/migrations/20261015114613_shared_match_auto_selection_preference.sql', import.meta.url), 'utf8')
const CLUB = '20000000-0000-4000-8000-000000000001'
const TEAM = '20000000-0000-4000-8000-000000000002'
const OTHER_TEAM = '20000000-0000-4000-8000-000000000003'
const COACH = '20000000-0000-4000-8000-000000000004'
const SECOND = '20000000-0000-4000-8000-000000000005'
const ADMIN = '20000000-0000-4000-8000-000000000006'
const OUTSIDER = '20000000-0000-4000-8000-000000000007'

async function database(t) {
  const db = new PGlite()
  t.after(() => db.close())
  await db.exec(`
    create schema auth; create schema app_private;
    create role anon; create role authenticated; create role service_role;
    create function auth.uid() returns uuid language sql stable as $$
      select nullif(current_setting('request.jwt.claim.sub', true),'')::uuid
    $$;
    create table public.users(id uuid primary key);
    create table public.clubs(id uuid primary key);
    create table public.teams(id uuid primary key,club_id uuid references public.clubs(id),archived_at timestamptz,status text default 'active');
    create table public.match_days(id uuid primary key default gen_random_uuid(),club_id uuid references public.clubs(id),team_id uuid references public.teams(id),auto_select_available_players boolean not null default false,notes text);
    create function app_private.actor_can_manage_team_resource(actor uuid,club uuid,team uuid,minimum_rank integer)
      returns boolean language sql stable as $$
      select club='${CLUB}'::uuid and minimum_rank=20 and (
        actor='${ADMIN}'::uuid or (actor in ('${COACH}'::uuid,'${SECOND}'::uuid) and team='${TEAM}'::uuid))
    $$;
    insert into public.users values('${COACH}'),('${SECOND}'),('${ADMIN}'),('${OUTSIDER}');
    insert into public.clubs values('${CLUB}');
    insert into public.teams(id,club_id) values('${TEAM}','${CLUB}'),('${OTHER_TEAM}','${CLUB}');
  `)
  await db.exec(migration)
  return db
}
const actor = (db, id) => db.query("select set_config('request.jwt.claim.sub',$1,false)", [id || ''])
async function read(db, team = TEAM) {
  return (await db.query('select public.get_own_match_selection_preference($1,$2) as value', [CLUB, team])).rows[0].value
}
async function fixture(db, selected, team = TEAM) {
  return (await db.query('insert into public.match_days(club_id,team_id,auto_select_available_players) values($1,$2,$3) returning id', [CLUB, team, selected])).rows[0].id
}

test('successful fixture saves persist both choices and repeated saves update one shared row', async t => {
  const db = await database(t)
  await actor(db, COACH)
  assert.deepEqual(await read(db), { found: false, autoSelectAvailablePlayers: false, updatedAt: null })
  const first = await fixture(db, true)
  assert.equal((await read(db)).autoSelectAvailablePlayers, true)
  await fixture(db, false)
  assert.equal((await read(db)).autoSelectAvailablePlayers, false)
  await db.query('update public.match_days set notes=$1 where id=$2', ['Unrelated edit', first])
  assert.equal((await read(db)).autoSelectAvailablePlayers, false, 'Unrelated writes do not replace the preference')
  await db.query('update public.match_days set auto_select_available_players=true where id=$1', [first])
  assert.equal((await read(db)).autoSelectAvailablePlayers, true, 'Explicitly saved unchanged checkbox is still the latest choice')
  assert.equal((await db.query('select count(*)::integer as count from app_private.user_match_selection_preferences')).rows[0].count, 1)
})

test('failed transaction rolls back the fixture and its preference together', async t => {
  const db = await database(t)
  await actor(db, COACH)
  const matchId = await fixture(db, true)
  await db.exec('begin')
  await db.query('update public.match_days set auto_select_available_players=false where id=$1', [matchId])
  assert.equal((await read(db)).autoSelectAvailablePlayers, false)
  await assert.rejects(db.query('select 1/0'), /division by zero/)
  await db.exec('rollback')
  assert.equal((await read(db)).autoSelectAvailablePlayers, true)
  assert.equal((await db.query('select auto_select_available_players as selected from public.match_days where id=$1', [matchId])).rows[0].selected, true)
})

test('staff choices are isolated and club-wide defaults are independent of team defaults', async t => {
  const db = await database(t)
  await actor(db, COACH)
  await fixture(db, true)
  await actor(db, SECOND)
  assert.equal((await read(db)).found, false)
  await fixture(db, false)
  await actor(db, COACH)
  assert.equal((await read(db)).autoSelectAvailablePlayers, true)
  await actor(db, ADMIN)
  await fixture(db, true, null)
  assert.equal((await read(db, null)).autoSelectAvailablePlayers, true)
  await fixture(db, false, TEAM)
  assert.equal((await read(db, null)).autoSelectAvailablePlayers, true)
  assert.equal((await read(db, TEAM)).autoSelectAvailablePlayers, false)
})

test('anonymous, parent, foreign-team and archived-team access is denied; no direct table or trigger grants', async t => {
  const db = await database(t)
  for (const id of [null, OUTSIDER]) {
    await actor(db, id)
    await assert.rejects(read(db), /Coach or manager access/)
    await fixture(db, true)
  }
  assert.equal((await db.query('select count(*)::integer as count from app_private.user_match_selection_preferences')).rows[0].count, 0)
  await actor(db, COACH)
  await assert.rejects(read(db, OTHER_TEAM), /Coach or manager access/)
  await assert.rejects(read(db, null), /Coach or manager access/)
  await actor(db, ADMIN)
  await assert.rejects(db.query('select public.get_own_match_selection_preference($1,$2)', ['30000000-0000-4000-8000-000000000001', TEAM]), /Coach or manager access/)
  await db.query('update public.teams set archived_at=now() where id=$1', [TEAM])
  await assert.rejects(read(db), /Coach or manager access/)
  const grants = (await db.query(`select
    has_function_privilege('anon','public.get_own_match_selection_preference(uuid,uuid)','EXECUTE') as anon_read,
    has_function_privilege('authenticated','public.get_own_match_selection_preference(uuid,uuid)','EXECUTE') as staff_read,
    has_function_privilege('authenticated','app_private.remember_match_selection_preference()','EXECUTE') as direct_write,
    has_table_privilege('authenticated','app_private.user_match_selection_preferences','SELECT') as table_read,
    has_table_privilege('authenticated','app_private.user_match_selection_preferences','INSERT') as table_write`)).rows[0]
  assert.deepEqual(grants, { anon_read: false, staff_read: true, direct_write: false, table_read: false, table_write: false })
})
