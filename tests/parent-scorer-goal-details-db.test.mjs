import assert from 'node:assert/strict'
import test from 'node:test'
import { readFile } from 'node:fs/promises'
import { PGlite } from '@electric-sql/pglite'
const migrationUrl = new URL('../supabase/migrations/20260902144139_parent_scorer_resume_added_time_own_goals.sql', import.meta.url)
const player = '30000000-0000-4000-8000-000000000001'
const fixture = '60000000-0000-4000-8000-000000000001'
const club = '10000000-0000-4000-8000-000000000001'

async function database() {
  const db = new PGlite()
  const baseline = await readFile(new URL('./matchday-parent-scorer-hardening-db.test.mjs', import.meta.url), 'utf8')
  await db.exec(baseline.match(/const schemaSql = `([\s\S]*?)`;/)[1])
  await db.exec(`
    alter table public.players add column player_name text, add column shirt_number text, add column section text default 'Squad', add column archived_at timestamptz;
    alter table public.teams add column name text;
    alter table public.match_days add column motm_poll_id uuid, add column match_date date;
    create table public.team_staff(team_id uuid,user_id uuid);
    create table public.poll_votes(id uuid,poll_id uuid,option_id text);
    create function public.current_user_role_rank() returns integer language sql as $$ select 90 $$;
    alter table public.match_days add column current_match_phase text default 'first_half', add column match_conclusion_rule text default 'normal_time', add column extra_time_half_minutes integer default 5, add column extra_time_period_count integer default 2, add column normal_time_home_score integer, add column normal_time_away_score integer, add column extra_time_home_score integer, add column extra_time_away_score integer, add column home_shootout_score integer default 0, add column away_shootout_score integer default 0, add column shootout_winner text;
    alter table public.match_day_events add column is_penalty_goal boolean default false, add column match_phase text, add column phase_order integer, add column request_id uuid, add column stoppage_minute integer, add column event_sequence bigint, add column voided_at timestamptz;
    create unique index goal_request on public.match_day_events(match_day_id,request_id);
    create sequence public.match_day_event_sequence_seq;
    create table public.match_day_shootout_kicks(id uuid,match_day_id uuid,team_side text,outcome text,kick_number integer,player_name text,notes text,event_status text,voided_at timestamptz,voided_by_name text,void_reason text,home_shootout_score integer,away_shootout_score integer,created_at timestamptz);
    create function public.get_parent_portal_match_days(uuid) returns table(id uuid) language sql as $$ select id from public.match_days $$;
    create function public.match_day_phase_order(text) returns integer language sql as $$ select case when $1='first_half' then 10 else 30 end $$;
    create function public.current_user_is_match_day_scorer(uuid) returns boolean language sql as $$ select auth.uid()='${player}'::uuid $$;
    create function public.resolve_match_day_mutation_actor(uuid,uuid) returns table(actor_user_id uuid,actor_parent_link_id uuid,actor_name text,actor_role text) language sql as $$ select auth.uid(),$2,'FP TEST','scorer_parent' where auth.uid()='${player}'::uuid $$;
    insert into public.match_days(id,club_id,team_id,status,timer_status,match_duration_minutes) values('${fixture}','${club}','20000000-0000-4000-8000-000000000001','live','running',20);
    insert into public.parent_player_links(id,club_id,team_id,player_id,auth_user_id) values('50000000-0000-4000-8000-000000000001','${club}','20000000-0000-4000-8000-000000000001','40000000-0000-4000-8000-000000000001','${player}');
    insert into public.match_day_role_assignments(match_day_id,club_id,team_id,role,parent_link_id,auth_user_id) values('${fixture}','${club}','20000000-0000-4000-8000-000000000001','scorer','50000000-0000-4000-8000-000000000001','${player}');
    select set_config('request.jwt.claim.sub','${player}',false);
  `)
  await db.exec(await readFile(migrationUrl, 'utf8'))
  await db.exec(`create trigger context before insert on public.match_day_events for each row execute function public.set_match_day_event_extended_context(); create trigger half_floor before update on public.match_days for each row execute function public.enforce_match_day_second_half_floor();`)
  return db
}

test('own goals persist added time, credit the chosen side, clear assists and remain idempotent', async () => {
  const db = await database()
  try {
    const sql = `select public.record_match_day_goal_v3('${fixture}',null,'opponent','Alex','4','Wrong assist','5',15,'',false,'70000000-0000-4000-8000-000000000001',true,null) as event`
    const first = (await db.query(sql)).rows[0].event
    assert.equal(first.is_own_goal, true)
    assert.equal(first.minute, 10)
    assert.equal(first.stoppage_minute, 5)
    assert.equal(first.assist_name, '')
    assert.equal(first.away_score, 1)
    assert.equal((await db.query(sql)).rows[0].event.id, first.id)
    assert.deepEqual((await db.query('select home_score,away_score from public.match_days')).rows[0], { home_score: 0, away_score: 1 })
    await db.query(`select public.correct_match_day_goal_v2('${fixture}',$1,'50000000-0000-4000-8000-000000000001','opponent','Corrected name','4','','',10,'','Wrong player',true,3)`, [first.id])
    const corrected = (await db.query('select is_own_goal,stoppage_minute,scorer_name,correction_reason from public.match_day_events')).rows[0]
    assert.deepEqual(corrected, { is_own_goal: true, stoppage_minute: 3, scorer_name: 'Corrected name', correction_reason: 'Wrong player' })
    await assert.rejects(db.query(sql.replace('false,', 'true,')), /own goal cannot also be a penalty/)
    await db.exec("select set_config('request.jwt.claim.sub','',false)")
    await assert.rejects(db.query(sql), /Login is required/)
  } finally { await db.close() }
})

test('second half excludes first-half added time while continuous clocks keep it', async () => {
  const db = await database()
  try {
    await db.exec(`update public.match_days set status='half_time',timer_status='half_time',timer_elapsed_seconds=900; update public.match_days set status='second_half',timer_status='running';`)
    assert.equal((await db.query('select timer_elapsed_seconds from public.match_days')).rows[0].timer_elapsed_seconds,600)
    await db.exec(`update public.match_days set status='half_time',timer_status='half_time',timer_elapsed_seconds=900,match_clock_mode='continuous'; update public.match_days set status='second_half',timer_status='running';`)
    assert.equal((await db.query('select timer_elapsed_seconds from public.match_days')).rows[0].timer_elapsed_seconds,900)
  } finally { await db.close() }
})

test('season totals exclude own goals, removed events and deleted fixtures while tracking corrected names', async () => {
  const db = await database()
  try {
    await db.exec(`
      insert into public.users(id,club_id,role) values('${player}','${club}','admin');
      insert into public.teams(id,club_id,name) values('20000000-0000-4000-8000-000000000001','${club}','FP TEST');
      insert into public.players(id,club_id,team_id,player_name) values('40000000-0000-4000-8000-000000000001','${club}','20000000-0000-4000-8000-000000000001','Alex');
      update public.match_days set match_date=current_date;
      insert into public.match_day_events(match_day_id,club_id,team_id,event_type,team_side,scorer_name,assist_name,is_own_goal,event_status)
      select '${fixture}','${club}','20000000-0000-4000-8000-000000000001','goal','club','Other: Alex','Other: Alex',own_goal,event_state
      from (values (false,'active'),(false,'voided'),(true,'active')) as inputs(own_goal,event_state);
    `)
    const stats = (await db.query('select goals,assists from public.get_end_season_stats(null)')).rows
    assert.deepEqual(stats,[{goals:1,assists:1}])
    await db.exec(`update public.match_day_events set scorer_name='Different player' where event_status='active' and not is_own_goal;`)
    assert.equal((await db.query('select goals from public.get_end_season_stats(null)')).rows[0].goals,0)
    await db.exec(`update public.match_days set deleted_at=now();`)
    assert.deepEqual((await db.query('select goals,assists from public.get_end_season_stats(null)')).rows,[{goals:0,assists:0}])
    await db.exec("select set_config('request.jwt.claim.sub','',false)")
    assert.equal((await db.query('select * from public.get_end_season_stats(null)')).rows.length,0)
  } finally { await db.close() }
})
