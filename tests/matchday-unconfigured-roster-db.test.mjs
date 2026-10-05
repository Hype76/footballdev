import test from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { PGlite } from '@electric-sql/pglite'
import { mergeMatchDayCommandSnapshot } from '../apps/mobile-core/src/matchDayOutboxCore.js'

const uuid = (kind, n = 1) => `${kind}0000000-0000-4000-8000-${String(n).padStart(12, '0')}`
const club = uuid(1), team = uuid(2), actor = uuid(3), staff = uuid(3, 2), link = uuid(5), fixture = uuid(6)
const p1 = uuid(4), p2 = uuid(4, 2)
async function database() {
  const db = new PGlite()
  const base = await readFile(new URL('./matchday-parent-scorer-hardening-db.test.mjs', import.meta.url), 'utf8')
  await db.exec(base.match(/const schemaSql = `([\s\S]*?)`;/)[1])
  await db.exec(`
    create schema private; create schema app_private;
    create table auth.users(id uuid primary key);
    insert into auth.users values('${actor}'),('${staff}');
    alter table players add player_name text, add shirt_number text default '', add section text default 'Squad', add archived_at timestamptz;
    alter table teams add name text;
    alter table match_days add match_date date default current_date, add motm_poll_id uuid,
      add previous_hidden_at timestamptz,
      add current_match_phase text default 'first_half', add match_conclusion_rule text default 'normal_time',
      add extra_time_half_minutes integer default 5, add extra_time_period_count integer default 2,
      add normal_time_home_score integer, add normal_time_away_score integer, add extra_time_home_score integer,
      add extra_time_away_score integer, add home_shootout_score integer default 0, add away_shootout_score integer default 0, add shootout_winner text;
    alter table match_day_events add is_penalty_goal boolean default false, add match_phase text, add phase_order integer,
      add request_id uuid, add stoppage_minute integer, add event_sequence bigint, add voided_at timestamptz,
      add voided_by uuid, add voided_by_parent_link_id uuid, add voided_by_name text;
    create unique index event_request on match_day_events(match_day_id,request_id);
    create sequence match_day_event_sequence_seq;
    create table match_day_player_squad_decisions(match_day_id uuid,club_id uuid,team_id uuid,player_id uuid,status text);
    create table event_player_removal_commands(match_day_id uuid);
    create table team_staff(team_id uuid,user_id uuid);
    create table polls(id uuid,status text,closes_at timestamptz);
    create table poll_votes(id uuid,poll_id uuid,option_id text);
    create table private.match_day_scorer_handovers(match_day_id uuid);
    create function current_user_role_rank() returns integer language sql as $$ select 90 $$;
    create function can_use_plan_feature(uuid,text) returns boolean language sql as $$ select
      case when $2='trialPlayers' then coalesce(current_setting('test.trials',true),'yes') <> 'no'
      else coalesce(current_setting('test.plan',true),'yes') <> 'no' end $$;
    create function match_day_local_date_is_today(uuid) returns boolean language sql as $$ select exists(select 1 from match_days where id=$1 and match_date=current_date) $$;
    create function private.is_guest_match_scorer(uuid) returns boolean language sql as $$ select false $$;
    create function current_user_is_match_day_scorer(uuid) returns boolean language sql as $$
      select exists(select 1 from match_day_role_assignments a join parent_player_links l on l.id=a.parent_link_id
        where a.match_day_id=$1 and a.auth_user_id=auth.uid() and l.auth_user_id=auth.uid() and l.status='active')
        and not exists(select 1 from private.match_day_scorer_handovers h where h.match_day_id=$1) $$;
    create function resolve_match_day_mutation_actor(uuid,uuid) returns table(actor_user_id uuid,actor_parent_link_id uuid,actor_name text,actor_role text)
      language sql as $$ select auth.uid(),$2,'FP TEST',case when $2 is null then 'coach' else 'scorer_parent' end
      where current_user_is_match_day_scorer($1) or (can_manage_match_day('${team}') and current_user_club_id()='${club}') $$;
    create function match_day_phase_order(text) returns integer language sql as $$ select 10 $$;
    alter function current_user_is_match_day_scorer(uuid) set search_path=public;
    create function current_user_has_match_day_scorer_assignment(uuid) returns boolean language sql set search_path=public as $$ select current_user_is_match_day_scorer($1) $$;
    alter function resolve_match_day_mutation_actor(uuid,uuid) set search_path=public;
    alter function match_day_local_date_is_today(uuid) set search_path=public;
    create function get_parent_portal_match_days(uuid) returns table(id uuid) language sql as $$ select id from match_days $$;
    create table match_day_shootout_kicks(id uuid,match_day_id uuid,team_side text,outcome text,kick_number integer,player_name text,notes text,event_status text,voided_at timestamptz,voided_by_name text,void_reason text,home_shootout_score integer,away_shootout_score integer,created_at timestamptz);
    insert into clubs values('${club}'); insert into teams values('${team}','${club}','FP TEST');
    insert into users(id,club_id,role) values('${actor}','${club}','parent_portal'),('${staff}','${club}','admin');
    insert into team_staff values('${team}','${staff}');
    insert into parent_player_links(id,club_id,team_id,player_id,auth_user_id) values('${link}','${club}','${team}','${p1}','${actor}');
    insert into match_day_role_assignments(match_day_id,club_id,team_id,role,parent_link_id,auth_user_id) values('${fixture}','${club}','${team}','scorer','${link}','${actor}');
    insert into match_days(id,club_id,team_id,status,timer_status) values('${fixture}','${club}','${team}','live','running');
    insert into players(id,club_id,team_id,player_name,section) values('${p1}','${club}','${team}','Same Name','Squad'),('${p2}','${club}','${team}','Same Name','Trial');
    select set_config('request.jwt.claim.sub','${actor}',false);
  `)
  await db.exec(await readFile(new URL('../supabase/migrations/20260902144139_parent_scorer_resume_added_time_own_goals.sql', import.meta.url), 'utf8'))
  const eventGuard = await readFile(new URL('../supabase/migrations/20260928124108_mobile_match_calendar.sql', import.meta.url), 'utf8')
  await db.exec(eventGuard.slice(0,eventGuard.indexOf('create or replace function public.correct_coach_match_day_goal_v1(')))
  await db.exec('create trigger enforce_event_write before insert or update or delete on match_day_events for each row execute function enforce_match_day_event_write()')
  const voidSql = await readFile(new URL('../supabase/migrations/20260926165000_authorised_full_time_event_corrections.sql', import.meta.url), 'utf8')
  await db.exec(voidSql.slice(voidSql.indexOf('create or replace function public.void_parent_match_day_goal(')))
  const journal = await readFile(new URL('../supabase/migrations/20260926114556_parent_scorer_offline_commands.sql', import.meta.url), 'utf8')
  await db.exec(journal.slice(0,journal.indexOf('create or replace function')))
  const coachJournal = await readFile(new URL('../supabase/migrations/20260907112202_coach_match_day_offline_commands.sql', import.meta.url), 'utf8')
  await db.exec(coachJournal.slice(0,coachJournal.indexOf('create or replace function')))
  await db.exec(await readFile(new URL('../supabase/migrations/20261004153000_matchday_unconfigured_participant_roster.sql', import.meta.url), 'utf8'))
  return db
}
const read = db => db.query(`select get_match_day_event_participants('${fixture}','${link}') as roster`).then(r => r.rows[0].roster.players)
const goal = (db, scorer = p1, assist = p2, request = uuid(7)) => db.query(`select record_match_day_goal_v4('${fixture}','${link}','club','Untrusted name','','Untrusted assist','',12,'',false,$1,false,null,$2,$3) as event`, [request, scorer, assist]).then(r => r.rows[0].event)

test('unconfigured fallback is exact-team active Squad/Trial, never availability or invitations', async () => {
  const db = await database()
  try {
    await db.exec(`insert into players(id,club_id,team_id,player_name,section,status,archived_at) values
      ('${uuid(4,3)}','${club}','${uuid(2,2)}','Other Team','Squad','active',null),
      ('${uuid(4,4)}','${uuid(1,2)}','${team}','Other Club','Squad','active',null),
      ('${uuid(4,5)}','${club}','${team}','Inactive','Squad','inactive',null),
      ('${uuid(4,6)}','${club}','${team}','Archived','Squad','active',now()),
      ('${uuid(4,7)}','${club}','${team}','Archived status','Trial','archived',null),
      ('${uuid(4,8)}','${club}','${team}','Other section','Other','active',null);`)
    assert.deepEqual((await read(db)).map(p => p.id), [p1,p2])
    await db.exec("select set_config('test.trials','no',false)")
    assert.deepEqual((await read(db)).map(p => p.id), [p1])
    assert.equal((await db.query('select count(*)::int as n from match_day_player_squad_decisions')).rows[0].n,0)
  } finally { await db.close() }
})

test('every decision row disables fallback; explicit selection stays authoritative and history prevents reset bypass', async () => {
  const db = await database()
  try {
    for (const status of ['undecided','waiting','not_selected','selected']) {
      await db.exec(`delete from match_day_player_squad_decisions; insert into match_day_player_squad_decisions values('${fixture}','${club}','${team}','${p1}','${status}')`)
      assert.deepEqual((await read(db)).map(p => p.id), status==='selected' ? [p1] : [])
    }
    await db.exec(`delete from match_day_player_squad_decisions; insert into match_day_event_log(club_id,team_id,match_day_id,event_type) values('${club}','${team}','${fixture}','player_squad_decision_changed')`)
    assert.deepEqual(await read(db),[])
    await db.exec(`delete from match_day_event_log; insert into event_player_removal_commands values('${fixture}')`)
    assert.deepEqual(await read(db),[])
  } finally { await db.close() }
})

test('roster fails closed for ordinary Parent/Fan/Player, wrong link/team/club, revoked scorer, handover, dates and conclusion', async () => {
  const db = await database()
  try {
    assert.equal((await read(db)).length,2)
    await db.exec("select set_config('test.plan','no',false)")
    await assert.rejects(read(db),/Current Match Day access/)
    await db.exec("select set_config('test.plan','yes',false)")
    await db.exec(`select set_config('request.jwt.claim.sub','${uuid(3,3)}',false)`)
    await assert.rejects(read(db),/scorer access/)
    await db.exec(`select set_config('request.jwt.claim.sub','${actor}',false)`)
    await assert.rejects(db.query(`select get_match_day_event_participants('${fixture}','${uuid(5,2)}')`),/scorer access/)
    for (const change of ["update parent_player_links set status='revoked'",`update parent_player_links set team_id='${uuid(2,2)}'`,`update parent_player_links set club_id='${uuid(1,2)}'`]) {
      await db.exec(change); await assert.rejects(read(db),/scorer access/)
      await db.exec(`update parent_player_links set status='active',team_id='${team}',club_id='${club}'`)
    }
    await db.exec(`insert into private.match_day_scorer_handovers values('${fixture}')`)
    await assert.rejects(read(db),/scorer access/)
    await db.exec('delete from private.match_day_scorer_handovers')
    for(const change of ["match_date=current_date-1","concluded_at=now()","status='cancelled'","deleted_at=now()"]){
      await db.exec(`update match_days set ${change}`); await assert.rejects(read(db),/Current Match Day access/)
      await db.exec("update match_days set match_date=current_date,concluded_at=null,status='live',deleted_at=null")
    }
    await db.exec('set role anon')
    await assert.rejects(db.query(`select get_match_day_event_participants('${fixture}','${link}')`),/permission denied/)
  } finally { await db.close() }
})

test('IDs disambiguate goals/assists and season stats; replay cannot switch identity; archival invalidates queued IDs', async () => {
  const db = await database()
  try {
    const event = await goal(db)
    assert.equal(event.scorer_player_id,p1); assert.equal(event.assist_player_id,p2)
    assert.equal(event.scorer_name,'Same Name')
    assert.equal((await goal(db)).id,event.id)
    await assert.rejects(goal(db,p2,p1),/different player identities/)
    await db.exec(`select set_config('request.jwt.claim.sub','${staff}',false)`)
    assert.deepEqual((await db.query(`select player_id,goals,assists from get_end_season_stats('${team}') order by player_id`)).rows,
      [{player_id:p1,goals:1,assists:0},{player_id:p2,goals:0,assists:1}])
    assert.deepEqual((await db.query(`select player_id,goals,assists from app_private.end_season_stats_range('${team}',current_date,current_date) order by player_id`)).rows,
      [{player_id:p1,goals:1,assists:0},{player_id:p2,goals:0,assists:1}])
    await db.exec(`update players set player_name='Renamed' where id='${p1}'`)
    assert.equal((await db.query(`select goals from get_end_season_stats('${team}') where player_id='${p1}'`)).rows[0].goals,1)
    await db.exec(`select set_config('request.jwt.claim.sub','${actor}',false); update players set archived_at=now() where id='${p1}'`)
    await assert.rejects(goal(db,p1,p2,uuid(7,2)),/no longer eligible/)
    assert.equal((await db.query('select home_score from match_days')).rows[0].home_score,1)
  } finally { await db.close() }
})

test('cards/substitutions use the same roster and IDs, excluding explicit decisions and transferred players', async () => {
  const db = await database()
  try {
    const event = (type, on = null, req = uuid(7)) => db.query(`select record_match_day_scorer_event_v2('${fixture}',$1,'club',12,'Same Name','','Same Name','','',$2,'${link}',null,'${p1}',$3) as event`,[type,req,on]).then(r=>r.rows[0].event)
    const saved=await event('substitution',p2)
    assert.equal(saved.scorer_player_id,p1); assert.equal(saved.assist_player_id,p2)
    assert.equal((await event('substitution',p2)).id,saved.id)
    await assert.rejects(event('substitution',p1,uuid(7,2)),/different Player On/)
    await db.exec(`update players set team_id='${uuid(2,2)}' where id='${p1}'`)
    await assert.rejects(event('yellow_card',null,uuid(7,3)),/selected Match squad Player/)
    await db.exec(`update players set team_id='${team}' where id='${p1}'; insert into match_day_player_squad_decisions values('${fixture}','${club}','${team}','${p1}','not_selected')`)
    await assert.rejects(event('red_card',null,uuid(7,4)),/selected Match squad Player/)
  } finally { await db.close() }
})

test('Parent offline command API stores IDs and reconnect replay applies score only once; stale exclusion fails without writes', async () => {
  const db = await database()
  try {
    const payload={participantRosterVersion:1,teamSide:'club',minute:4,scorerName:'Same Name',scorerShirtNumber:'',assistName:'Same Name',assistShirtNumber:'',scorerPlayerId:p1,assistPlayerId:p2}
    const stamp=(await db.query('select now()::text as stamp,updated_at::text as revision from match_days')).rows[0]
    const apply=(id=uuid(7),data=payload)=>db.query(`select apply_parent_match_day_command_v2($1,'${fixture}','${link}','goal',$2::jsonb,$3,$4,null) as result`,[id,JSON.stringify(data),stamp.stamp,stamp.revision]).then(r=>r.rows[0].result)
    await apply(); await apply()
    assert.equal((await db.query('select home_score from match_days')).rows[0].home_score,1)
    assert.equal((await db.query('select count(*)::int as n from private.parent_scorer_match_day_commands')).rows[0].n,1)
    assert.equal((await db.query('select payload from private.parent_scorer_match_day_commands')).rows[0].payload.scorerPlayerId,p1)
    await assert.rejects(apply(uuid(7),{...payload,scorerPlayerId:p2}),/identifier is already in use/)
    stamp.revision=(await db.query('select updated_at::text as revision from match_days')).rows[0].revision
    await db.exec(`insert into match_day_player_squad_decisions values('${fixture}','${club}','${team}','${p1}','not_selected')`)
    await assert.rejects(apply(uuid(7,2)),/no longer eligible/)
    assert.equal((await db.query('select home_score from match_days')).rows[0].home_score,1)
    assert.equal((await db.query('select count(*)::int as n from private.parent_scorer_match_day_commands')).rows[0].n,1)
    await db.exec(`select set_config('request.jwt.claim.sub','${uuid(3,3)}',false)`)
    await assert.rejects(apply(),/identifier is already in use/)
  } finally { await db.close() }
})

test('Coach offline API links fallback player IDs for goals and substitutions and replays only once', async () => {
  const db=await database()
  try {
    await db.exec(`select set_config('request.jwt.claim.sub','${staff}',false); update users set role='coach' where id='${staff}'`)
    const payload={participantRosterVersion:1,eventType:'goal',teamSide:'club',minute:4,scorerName:'Same Name',scorerShirtNumber:'',assistName:'Same Name',assistShirtNumber:'',scorerPlayerId:p1,assistPlayerId:p2}
    const stamp=(await db.query('select now()::text as stamp,updated_at::text as revision from match_days')).rows[0]
    const apply=(id,data,previous=null)=>db.query(`select apply_coach_match_day_command_v2($1,'${fixture}','event',$2::jsonb,$3,$4,$5) as result`,[id,JSON.stringify(data),stamp.stamp,stamp.revision,previous]).then(r=>r.rows[0].result)
    const first=await apply(uuid(7),payload)
    assert.equal(first.savedEvent.scorer_player_id,p1); assert.equal(first.savedEvent.assist_player_id,p2)
    assert.equal((await apply(uuid(7),payload)).savedEvent.id,first.savedEvent.id)
    const sub={participantRosterVersion:1,eventType:'substitution',teamSide:'club',minute:5,playerName:'Same Name',playerShirtNumber:'',playerOnName:'Same Name',playerOnShirtNumber:'',playerPlayerId:p1,playerOnPlayerId:p2}
    const second=await apply(uuid(7,2),sub,uuid(7))
    assert.equal(second.savedEvent.scorer_player_id,p1); assert.equal(second.savedEvent.assist_player_id,p2)
    assert.equal((await apply(uuid(7,2),sub,uuid(7))).savedEvent.id,second.savedEvent.id)
    assert.equal((await db.query('select home_score from match_days')).rows[0].home_score,1)
    assert.equal((await db.query('select count(*)::int as n from private.coach_match_day_commands')).rows[0].n,2)
    await db.exec(`select set_config('request.jwt.claim.sub','${actor}',false)`)
    await assert.rejects(apply(uuid(7),payload),/Coach or manager access/)
  } finally {await db.close()}
})

const correct = (db, id, scorer=p1, assist=p2, name='Same Name', assistName='Same Name', side='club', own=false) =>
  db.query(`select correct_match_day_goal_v3('${fixture}',$1,'${link}',$2,$3,'',$4,'',12,'','Identity correction',$5,null,$6,$7) as result`,[id,side,name,assistName,own,scorer,assist])
async function stats(db) {
  const saved=(await db.query('select auth.uid()::text as actor')).rows[0].actor
  await db.query("select set_config('request.jwt.claim.sub',$1,false)",[staff])
  try {
    const all=(await db.query(`select player_id,goals,assists from get_end_season_stats('${team}') order by player_id`)).rows
    const ranged=(await db.query(`select player_id,goals,assists from app_private.end_season_stats_range('${team}',current_date,current_date) order by player_id`)).rows
    assert.deepEqual(ranged,all)
    return all
  } finally {await db.query("select set_config('request.jwt.claim.sub',$1,false)",[saved])}
}

test('correction rejects stale names/IDs, reselects renamed and duplicate players, and reverses both stats APIs',async()=>{
  const db=await database()
  try {
    const event=await goal(db)
    await assert.rejects(correct(db,event.id,p1,p2,'Wrong name'),/name and player identity differ/)
    assert.equal((await db.query('select event_status from match_day_events')).rows[0].event_status,'active')
    await db.exec(`update players set player_name='Renamed' where id='${p1}'`)
    await assert.rejects(correct(db,event.id),/name and player identity differ/)
    await correct(db,event.id,p1,p2,'Renamed')
    assert.deepEqual(await stats(db),[{player_id:p1,goals:1,assists:0},{player_id:p2,goals:0,assists:1}])
    await correct(db,event.id,p2,p1,'Same Name','Renamed')
    await correct(db,event.id,p2,p1,'Same Name','Renamed') // lost-response retry: score remains one
    assert.deepEqual(await stats(db),[{player_id:p1,goals:0,assists:1},{player_id:p2,goals:1,assists:0}])
    assert.equal((await db.query('select home_score from match_days')).rows[0].home_score,1)
    await correct(db,event.id,null,null,'Renamed','Same Name')
    assert.deepEqual(await stats(db),[{player_id:p1,goals:0,assists:0},{player_id:p2,goals:0,assists:0}])
    assert.equal((await db.query('select participant_identity_version from match_day_events')).rows[0].participant_identity_version,1)
    await correct(db,event.id,p1,p2,'Renamed')
    await db.query(`select void_parent_match_day_goal('${fixture}',$1,'${link}','Added by mistake')`,[event.id])
    assert.deepEqual(await stats(db),[{player_id:p1,goals:0,assists:0},{player_id:p2,goals:0,assists:0}])
    assert.equal((await db.query('select home_score from match_days')).rows[0].home_score,0)
    await assert.rejects(correct(db,event.id,p1,p2,'Renamed'),/could not be corrected/)
    await assert.rejects(db.query(`select void_parent_match_day_goal('${fixture}',$1,'${link}','Retry')`,[event.id]),/already been removed/)
    try { assert.equal((await goal(db)).event_status,'voided') }
    catch (error) {assert.match(error.message,/identical request|different|already|removed|voided/i)}
    assert.equal((await db.query('select home_score from match_days')).rows[0].home_score,0)
    assert.ok((await db.query("select count(*)::int n from match_day_event_log where metadata->>'source'='match_day_identity_correction_rpc'")).rows[0].n>=4)
  } finally {await db.close()}
})

test('legacy name-only events require explicit re-selection; old correction and deletion never leak attribution',async()=>{
  const db=await database()
  try {
    const event=(await db.query(`select record_match_day_goal_v3('${fixture}','${link}','club','Same Name','','','',12,'',false,'${uuid(7)}',false,null) as event`)).rows[0].event
    // Historical ambiguous matching is unchanged until deliberately corrected.
    assert.deepEqual((await stats(db)).map(row=>row.goals),[1,1])
    await correct(db,event.id,p2,null,'Same Name','')
    assert.deepEqual((await stats(db)).map(row=>row.goals),[0,1])
    await db.query(`select correct_match_day_goal_v2('${fixture}',$1,'${link}','club','Edited manually','','','',12,'','Old client correction',false,null)`,[event.id])
    assert.equal((await db.query('select scorer_player_id from match_day_events')).rows[0].scorer_player_id,null)
    assert.deepEqual((await stats(db)).map(row=>row.goals),[0,0])
    await correct(db,event.id,p1,null,'Same Name','')
    await db.exec(`delete from players where id='${p1}'`)
    assert.equal((await db.query('select scorer_player_id from match_day_events')).rows[0].scorer_player_id,null)
    assert.deepEqual(await stats(db),[{player_id:p2,goals:0,assists:0}])
  } finally {await db.close()}
})

test('Coach full-time correction retains IDs and penalty audit; own-goal reversal and scoped access stay intact',async()=>{
  const db=await database()
  try {
    const event=await goal(db)
    await db.exec(`select set_config('request.jwt.claim.sub','${staff}',false); update users set role='coach' where id='${staff}'; update match_days set status='full_time',timer_status='full_time'`)
    const call=(side='club',own=false,scorer=p2,assist=p1)=>db.query(`select correct_coach_match_day_goal_v2('${fixture}',$1,$2,'Same Name','','Same Name','',12,'','Coach correction',$3,true,null,$4,$5)`,[event.id,side,own,scorer,assist])
    await call(); await call()
    let row=(await db.query('select * from match_day_events')).rows[0]
    assert.equal(row.scorer_player_id,p2); assert.equal(row.assist_player_id,p1); assert.equal(row.is_penalty_goal,true)
    assert.deepEqual((await stats(db)).map(row=>[row.goals,row.assists]),[[0,1],[1,0]])
    await call('opponent',true,p2,null)
    assert.deepEqual((await stats(db)).map(row=>[row.goals,row.assists]),[[0,0],[0,0]])
    row=(await db.query('select * from match_day_events')).rows[0]
    assert.equal(row.assist_player_id,null); assert.equal(row.is_penalty_goal,false)
    await call()
    assert.deepEqual((await stats(db)).map(row=>[row.goals,row.assists]),[[0,1],[1,0]])
    await db.exec(`update match_days set concluded_at=now()`)
    await assert.rejects(call(),/closed or unavailable/)
    await db.exec(`update match_days set concluded_at=null; update users set club_id='${uuid(1,2)}' where id='${staff}'`)
    await assert.rejects(call(),/Coach or manager access/)
    await db.exec(`select set_config('request.jwt.claim.sub','${actor}',false); update parent_player_links set status='revoked'`)
    await assert.rejects(correct(db,event.id),/Current Match Day|selected Parent scorer/)
    const grants=(await db.query(`select has_function_privilege('anon','public.correct_match_day_goal_v3(uuid,uuid,uuid,text,text,text,text,text,integer,text,text,boolean,integer,uuid,uuid)','execute') as anon,
      has_function_privilege('authenticated','private.match_day_event_participants(uuid)','execute') as private,
      has_function_privilege('anon','public.correct_coach_match_day_goal_v2(uuid,uuid,text,text,text,text,text,integer,text,text,boolean,boolean,integer,uuid,uuid)','execute') as coach`)).rows[0]
    assert.deepEqual(grants,{anon:false,private:false,coach:false})
  } finally {await db.close()}
})

test('Coach historical corrections retain authorised existing links without enabling an old-date fallback',async()=>{
  const db=await database()
  try {
    const event=await goal(db)
    await db.exec(`select set_config('request.jwt.claim.sub','${staff}',false); update users set role='coach' where id='${staff}';
      update match_days set match_date=current_date-1,status='full_time',timer_status='full_time'`)
    const call=(scorer=p1,assist=p2,name='Same Name',side='club')=>db.query(`select correct_coach_match_day_goal_v2('${fixture}',$1,$2,$3,'','Same Name','',13,'','Historical correction',false,false,null,$4,$5) as result`,[event.id,side,name,scorer,assist])
    await call()
    assert.equal((await db.query('select minute from match_day_events')).rows[0].minute,13)
    await assert.rejects(db.query(`select get_match_day_event_participants('${fixture}',null)`),/Current Match Day access/)
    await assert.rejects(call(p2,p1),/no longer eligible/)
    await db.exec(`insert into match_day_player_squad_decisions values('${fixture}','${club}','${team}','${p1}','selected'),('${fixture}','${club}','${team}','${p2}','selected')`)
    await call(p2,p1)
    await db.exec(`update users set role='super_admin',club_id='${uuid(1,2)}' where id='${staff}'`)
    await call(p2,p1)
    await db.exec(`update users set role='coach' where id='${staff}'`)
    await assert.rejects(call(p2,p1),/Coach or manager access/)
    await db.exec(`update users set club_id='${club}' where id='${staff}'; update players set archived_at=now() where id='${p2}'`)
    await assert.rejects(call(p2,p1),/no longer eligible/)
    await call(null,null,'Manual scorer')
    await db.exec(`update match_days set concluded_at=now()`)
    await assert.rejects(call(null,null,'Manual scorer'),/closed or unavailable/)
  } finally {await db.close()}
})

test('unnamed opponent goals retain optional names through Parent and Coach corrections',async()=>{
  const db=await database()
  try {
    const event=(await db.query(`select record_match_day_goal_v3('${fixture}','${link}','opponent','','','','',12,'',false,'${uuid(7)}',false,null) as event`)).rows[0].event
    await correct(db,event.id,null,null,'','','opponent')
    assert.equal((await db.query('select scorer_name from match_day_events')).rows[0].scorer_name,'')
    await db.exec(`select set_config('request.jwt.claim.sub','${staff}',false); update users set role='coach' where id='${staff}'`)
    await db.query(`select correct_coach_match_day_goal_v2('${fixture}',$1,'opponent','','','','',14,'','Minute corrected',false,false,null,null,null)`,[event.id])
    const row=(await db.query('select scorer_name,minute,scorer_player_id from match_day_events')).rows[0]
    assert.deepEqual(row,{scorer_name:'',minute:14,scorer_player_id:null})
    assert.deepEqual((await db.query('select home_score,away_score from match_days')).rows[0],{home_score:0,away_score:1})
    await assert.rejects(db.query(`select correct_coach_match_day_goal_v2('${fixture}',$1,'club','','','','',14,'','Invalid club participant',false,false,null,null,null)`,[event.id]),/Choose the corrected scorer/)
  } finally {await db.close()}
})

test('legacy card/substitution participant edits clear stale IDs and nullable authority fails closed',async()=>{
  const db=await database()
  try {
    await db.query(`select record_match_day_scorer_event_v2('${fixture}','substitution','club',12,'Same Name','','Same Name','','','${uuid(7)}','${link}',null,'${p1}','${p2}')`)
    await db.exec(`update match_day_events set scorer_name='Edited off',assist_shirt_number='99'`)
    assert.deepEqual((await db.query('select scorer_player_id,assist_player_id,participant_identity_version from match_day_events')).rows[0],{scorer_player_id:null,assist_player_id:null,participant_identity_version:1})
    await db.exec(`insert into parent_player_links(id,club_id,team_id,player_id,auth_user_id) values('${uuid(5,2)}','${club}','${team}','${p2}','${actor}');
      insert into match_day_role_assignments(match_day_id,club_id,team_id,role,parent_link_id,auth_user_id) values('${fixture}','${club}','${team}','scorer','${uuid(5,2)}','${uuid(3,3)}')`)
    await assert.rejects(db.query(`select get_match_day_event_participants('${fixture}','${uuid(5,2)}')`),/selected Parent scorer access/)
    await db.exec('create or replace function can_use_plan_feature(uuid,text) returns boolean language sql as $$ select null::boolean $$')
    await assert.rejects(read(db),/Current Match Day access/)
    await db.exec('create or replace function can_use_plan_feature(uuid,text) returns boolean language sql as $$ select true $$; create or replace function current_user_is_match_day_scorer(uuid) returns boolean language sql as $$ select null::boolean $$')
    await assert.rejects(read(db),/selected Parent scorer access/)
    await db.exec(`select set_config('request.jwt.claim.sub','${staff}',false); create or replace function can_manage_match_day(target_team_id uuid) returns boolean language sql as $$ select null::boolean $$`)
    await assert.rejects(db.query(`select get_match_day_event_participants('${fixture}',null)`),/team staff access/)
  } finally {await db.close()}
})

test('actual Parent queued correction adapter routes IDs to v2 journal, returns the flat corrected event, and replays exactly once',async()=>{
  const db=await database()
  try {
    const event=await goal(db)
    const source=await readFile(new URL('../apps/parent-mobile/src/parentPortalData.js',import.meta.url),'utf8')
    const code=source.slice(source.indexOf('export async function applyParentScorerCommand('),source.indexOf('export async function sendParentScorerMatchDayPush(')).replace('export ','')
    const rpcNames=[]
    const rpc=async(name,args)=>{
      rpcNames.push(name)
      assert.equal(name,'apply_parent_match_day_command_v2')
      return (await db.query('select apply_parent_match_day_command_v2($1,$2,$3,$4,$5::jsonb,$6,$7,$8) as result',[
        args.command_id_value,args.match_day_id_value,args.parent_link_id_value,args.kind_value,JSON.stringify(args.payload_value),
        args.captured_at_value,args.expected_updated_at_value,args.previous_command_id_value])).rows[0].result
    }
    const apply=new Function('requireSelectedLink','scorerRpc','getMobileRuntimeConfig','getAccessToken','fetchJsonWithTimeout','joinApiPath','mergeMatchDayCommandSnapshot','normalizeParentMatchDay',code+';return applyParentScorerCommand')(
      ()=>({id:link,clubId:club,teamId:team}),rpc,()=>({apiBaseUrl:''}),async()=>'',()=>{throw new Error('No network allowed')},()=>'',mergeMatchDayCommandSnapshot,value=>({...value,clubId:value.club_id??value.clubId,teamId:value.team_id??value.teamId}))
    const revision=async()=> (await db.query('select now()::text captured,updated_at::text revision from match_days')).rows[0]
    let stamp=await revision()
    let command={id:uuid(7,2),matchId:fixture,kind:'correct-goal',capturedAt:stamp.captured,expectedUpdatedAt:stamp.revision,
      payload:{participantRosterVersion:1,eventId:event.id,reason:'Duplicate identity corrected',goal:{teamSide:'club',scorerName:'Same Name',scorerShirtNumber:'',assistName:'Same Name',assistShirtNumber:'',minute:12,notes:'',isOwnGoal:false,stoppageMinute:'',scorerPlayerId:p2,assistPlayerId:p1}}}
    const base={id:fixture,clubId:club,teamId:team,isScorer:true,events:[event]}
    const result=await apply({},command,base)
    assert.equal(result.match.events.length,1)
    assert.equal(result.match.events[0].id,event.id)
    assert.equal(result.match.events[0].scorer_player_id,p2); assert.equal(result.match.events[0].assist_player_id,p1)
    assert.deepEqual((await stats(db)).map(row=>[row.goals,row.assists]),[[0,1],[1,0]])
    const logCount=(await db.query('select count(*)::int n from match_day_event_log')).rows[0].n
    await apply({},command,base)
    assert.equal((await db.query('select count(*)::int n from match_day_event_log')).rows[0].n,logCount)
    assert.equal((await db.query('select home_score from match_days')).rows[0].home_score,1)
    await assert.rejects(apply({}, {...command,payload:{...command.payload,goal:{...command.payload.goal,scorerPlayerId:p1}}},base),/identifier is already in use/)
    stamp=await revision()
    command={...command,id:uuid(7,3),capturedAt:stamp.captured,expectedUpdatedAt:stamp.revision,payload:{...command.payload,goal:{...command.payload.goal,scorerPlayerId:'',assistPlayerId:''}}}
    const unlinked=await apply({},command,result.match)
    assert.equal(unlinked.match.events[0].scorer_player_id,null); assert.equal(unlinked.match.events[0].assist_player_id,null)
    assert.deepEqual((await stats(db)).map(row=>[row.goals,row.assists]),[[0,0],[0,0]])
    assert.ok(rpcNames.length>=4)
  } finally {await db.close()}
})
