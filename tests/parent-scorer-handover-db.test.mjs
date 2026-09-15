import assert from 'node:assert/strict'
import test from 'node:test'
import { readFile } from 'node:fs/promises'
import { PGlite } from '@electric-sql/pglite'
import { getParentScorerMatches } from '../apps/parent-mobile/src/parentScorerCore.js'

const source = (file) => readFile(new URL(`../${file}`, import.meta.url), 'utf8')
const migration = await source('supabase/migrations/20260915174901_parent_scorer_review_handover.sql')
const fixture = '60000000-0000-4000-8000-000000000001'
const club = '10000000-0000-4000-8000-000000000001'
const team = '20000000-0000-4000-8000-000000000001'
const parent = '30000000-0000-4000-8000-000000000001'
const coach = '30000000-0000-4000-8000-000000000002'
const other = '30000000-0000-4000-8000-000000000003'
const player = '40000000-0000-4000-8000-000000000001'
const link = '50000000-0000-4000-8000-000000000001'
const definition = (sql, name) => sql.match(new RegExp(`create or replace function public\\.${name}\\([\\s\\S]*?(?:\\$function\\$|\\$\\$)\\s*;`, 'i'))[0]

async function database() {
  const db = new PGlite()
  try {
  const baseline = await source('tests/matchday-parent-scorer-hardening-db.test.mjs')
  await db.exec(baseline.match(/const schemaSql = `([\s\S]*?)`;/)[1])
  await db.exec(`
    create schema private;
    alter table public.users add column name text default '', add column email text default '', add column role_rank integer default 30;
    alter table public.clubs add column timezone_name text default 'Europe/London', add column status text default 'active';
    alter table public.match_days add column match_date date default current_date, add column current_match_phase text default 'first_half', add column match_conclusion_rule text default 'normal_time', add column extra_time_half_minutes integer default 5, add column extra_time_period_count integer default 2, add column normal_time_home_score integer, add column normal_time_away_score integer, add column extra_time_home_score integer, add column extra_time_away_score integer, add column home_shootout_score integer default 0, add column away_shootout_score integer default 0, add column shootout_winner text;
    alter table public.match_day_events add column is_penalty_goal boolean default false, add column is_own_goal boolean default false, add column match_phase text, add column phase_order integer, add column request_id uuid, add column stoppage_minute integer;
    create table public.match_day_shootout_kicks(id uuid,match_day_id uuid,team_side text,outcome text,kick_number integer,player_name text,notes text,event_status text,voided_at timestamptz,voided_by_name text,void_reason text,home_shootout_score integer,away_shootout_score integer,created_at timestamptz);
    create table public.team_staff(team_id uuid,user_id uuid);
    alter table public.match_day_role_assignments add column updated_at timestamptz default now();
    alter table public.match_days add column request_scorer boolean default false, add column notification_revision integer default 1;
    create function public.get_match_day_parent_notification_link_ids(uuid) returns uuid[] language sql as $$ select array[]::uuid[] $$;
    create function public.match_day_phase_order(text) returns integer language sql as $$ select 10 $$;
    create function private.is_guest_match_scorer(uuid) returns boolean language sql as $$ select false $$;
    create function private.guest_match_scorer_name(uuid) returns text language sql as $$ select '' $$;
    insert into public.clubs(id) values('${club}');
    insert into public.teams values('${team}','${club}');
    insert into public.users(id,club_id,role) values('${parent}','${club}','parent_portal'),('${coach}','${club}','coach'),('${other}','${club}','parent_portal');
    insert into public.players(id,club_id,team_id) values('${player}','${club}','${team}');
    insert into public.parent_player_links(id,club_id,team_id,player_id,auth_user_id) values('${link}','${club}','${team}','${player}','${parent}');
    insert into public.match_days(id,club_id,team_id,status,timer_status,current_match_phase) values('${fixture}','${club}','${team}','live','running','first_half');
    insert into public.match_day_role_assignments(match_day_id,club_id,team_id,role,parent_link_id,auth_user_id) values('${fixture}','${club}','${team}','scorer','${link}','${parent}');
    insert into public.match_day_scorer_assignments(match_day_id,club_id,team_id,parent_link_id,auth_user_id) values('${fixture}','${club}','${team}','${link}','${parent}');
    grant usage on schema auth to authenticated;
    grant select,update on public.match_days to authenticated;
    grant select,insert,update,delete on public.match_day_events to authenticated;
  `)
  const guest = await source('supabase/migrations/20260902151551_guest_match_day_scorer.sql')
  const original = await source('supabase/migrations/20260722084618_fp_v1_gameday_prematch_parity_harden_03.sql')
  const authority = await source('supabase/migrations/20260731110000_fp_v1_gameday_scorer_authority_02a.sql')
  await db.exec(definition(await source('supabase/migrations/20260825133414_cross_club_parent_link_authority_100.sql'), 'current_user_can_access_parent_link'))
  await db.exec(definition(await source('supabase/migrations/20260902101356_parent_invites_scorer_repair.sql'), 'current_user_has_match_day_scorer_assignment'))
  await db.exec(definition(authority, 'match_day_local_date_is_today'))
  await db.exec(definition(authority, 'authorize_match_day_push').replace('public.authorize_match_day_push(', 'public.authorize_match_day_push_before_recipient_fanout_94('))
  await db.exec(migration)
  await db.exec(definition(original, 'apply_match_day_timer_action'))
  for (const name of ['resolve_match_day_mutation_actor', 'set_match_day_timer_state', 'record_match_day_goal_v3', 'record_match_day_score_correction_v2', 'correct_match_day_goal_v2', 'set_match_day_extended_state', 'record_match_day_shootout_kick', 'start_match_day']) await db.exec(definition(guest, name))
  await db.exec(definition(await source('supabase/migrations/20260722195910_fp_v1_gameday_extended_ops_12a.sql'), 'void_match_day_shootout_kick'))
  await db.exec(definition(original, 'void_match_day_goal'))
  await db.exec(definition(authority, 'enforce_match_day_gameplay_write'))
  await db.exec(definition(authority, 'enforce_match_day_event_write'))
  await db.exec(`create trigger gameplay before update on public.match_days for each row execute function public.enforce_match_day_gameplay_write(); create trigger event_write before insert or update or delete on public.match_day_events for each row execute function public.enforce_match_day_event_write();`)
  return db
  } catch (error) { await db.close(); throw error }
}

test('handover is persistent, idempotent, scoped and denies stale Parent RPC/direct writes while preserving Coach completion', async () => {
  const db = await database()
  const actor = (id) => db.query("select set_config('request.jwt.claim.sub',$1,false)",[id])
  const handover = () => db.query('select public.request_parent_match_day_review($1,$2) as result',[fixture,link])
  const timer = (action) => db.query('select public.set_match_day_timer_state($1,$2) as result',[fixture,action])
  const read = () => db.query('select * from public.get_parent_match_day_review_requests($1)',[link])
  try {
    await assert.rejects(handover(), /Login is required/)
    await actor(other)
    await assert.rejects(handover(), /selected Parent scorer/)
    assert.equal((await read()).rows.length,0)
    await actor(parent)
    await assert.rejects(handover(), /Finish the match/)
    await timer('full_time')
    const push = (type, actorId = parent, parentLink = link) => db.query('select public.authorize_match_day_push($1,$2,$3,$4,null) as result',[actorId,fixture,parentLink,type])
    const oldPush = (await push('full_time')).rows[0].result
    const result = (await handover()).rows[0].result
    assert.ok(result.scorerReviewRequestedAt)
    await db.query("update public.users set role='coach',club_id='10000000-0000-4000-8000-000000000099' where id=$1",[parent])
    const reviewPush = (await push('full_time')).rows[0].result
    assert.equal(reviewPush.allowed,true)
    assert.notEqual(reviewPush.operationKey,oldPush.operationKey)
    assert.equal((await push('full_time')).rows[0].result.operationKey,reviewPush.operationKey)
    assert.equal((await push('full_time',other)).rows[0].result.allowed,false)
    assert.equal((await push('full_time',parent,null)).rows[0].result.allowed,false)
    await db.query("update public.users set role='parent_portal',club_id=$2 where id=$1",[parent,club])
    assert.deepEqual((await handover()).rows[0].result,result)
    assert.equal((await read()).rows.length,1)
    assert.equal((await db.query('select * from public.get_parent_scorer_game_mode_match_ids($1)',[link])).rows.length,0)
    assert.equal((await db.query('select count(*)::int as count from public.match_day_event_log where metadata->>\'source\'=\'parent_scorer_handover\'')).rows[0].count,1)
    for (const action of ['resume','pause','half_time','full_time','conclude']) await assert.rejects(timer(action), /selected scorer access/)
    await actor(coach)
    assert.equal((await timer('resume')).rows[0].result.status,'live')
    await actor(parent)
    await db.query("update public.users set role='coach',club_id='10000000-0000-4000-8000-000000000099' where id=$1",[parent])
    assert.equal((await push('live')).rows[0].result.allowed,false)
    await db.query("update public.users set role='parent_portal',club_id=$2 where id=$1",[parent,club])
    assert.equal((await push('live',coach,null)).rows[0].result.allowed,false) // Coach needs explicit notification team scope.
    assert.equal((await db.query('select public.current_user_is_match_day_scorer($1) as allowed',[fixture])).rows[0].allowed,false)
    assert.equal((await db.query('select * from public.resolve_match_day_mutation_actor($1,$2)',[fixture,link])).rows.length,0)
    await assert.rejects(timer('resume'), /selected scorer access/)
    await assert.rejects(db.query('select public.start_match_day($1)',[fixture]),/selected scorer|cannot/i)
    await assert.rejects(db.query("select public.record_match_day_score_correction_v2($1,$2,1,0,'FP TEST',gen_random_uuid())",[fixture,link]),/cannot update/)
    await assert.rejects(db.query("select public.record_match_day_goal_v3($1,$2,'club','FP TEST','','','',2,'',false,gen_random_uuid(),false,null)",[fixture,link]),/cannot record/)
    await db.exec('set role authenticated')
    await assert.rejects(db.query('update public.match_days set home_score=9 where id=$1',[fixture]),/authorised Match Day/)
    await assert.rejects(db.query("insert into public.match_day_events(match_day_id,club_id,team_id,event_type,team_side) values($1,$2,$3,'goal','club')",[fixture,club,team]),/authorised Match Day/)
    await assert.rejects(db.query('delete from private.match_day_scorer_handovers'),/permission denied/)
    await db.exec('reset role')
    await actor(other)
    assert.equal((await read()).rows.length,0)
    await actor(parent)
    assert.equal((await read()).rows.length,1)
    await actor(coach)
    const corrected = await db.query("select public.record_match_day_score_correction_v2($1,null,1,0,'FP TEST',gen_random_uuid()) as event",[fixture])
    assert.equal(corrected.rows[0].event.home_score,1)
    await timer('full_time')
    assert.ok((await timer('conclude')).rows[0].result.concludedAt)
    await db.exec('set role anon')
    await assert.rejects(handover(), /permission denied/)
  } finally { await db.close() }
})

test('persisted handover overrides stale scorer visibility', () => {
  assert.equal(getParentScorerMatches([{id:fixture,isScorer:true,status:'full_time',scorerReviewRequestedAt:'2026-09-15T12:00:00Z'}]).length,0)
})
