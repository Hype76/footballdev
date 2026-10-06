import assert from 'node:assert/strict'
import test from 'node:test'
import {readFile} from 'node:fs/promises'
import {createRequire} from 'node:module'
const require=createRequire(import.meta.url)
const {PGlite}=require('@electric-sql/pglite')
import { commandSql as sql } from './attendance-migration-contract.mjs'
const id=n=>`00000000-0000-4000-8000-${String(n).padStart(12,'0')}`
// Actual PostgreSQL engine and actual draft SQL. Minimal synthetic schema and
// existing authority/mutation RPC seams; not full migration-chain/auth integration.
const schema=`
create role anon;create role authenticated;create schema auth;
create function auth.uid() returns uuid language sql stable as $$select nullif(current_setting('test.actor',true),'')::uuid$$;
create table public.users(id uuid primary key,status text,role text,role_rank int,club_id uuid);
create table public.parent_player_links(id uuid primary key,auth_user_id uuid,status text,player_id uuid,team_id uuid,club_id uuid);
create table public.players(id uuid primary key,club_id uuid,team_id uuid,status text);
create table public.match_days(id uuid primary key,club_id uuid,team_id uuid,parent_visible boolean,parent_audience text);
create table public.calendar_events(id uuid primary key,club_id uuid,team_id uuid,event_type text);
create table public.match_day_availability_requests(id uuid primary key,match_day_id uuid,player_id uuid,club_id uuid,team_id uuid);
create table public.training_availability_requests(id uuid primary key,calendar_event_id uuid,club_id uuid,team_id uuid,occurrence_date date,status text,occurrence_starts_at timestamptz,created_at timestamptz default now());
create table public.training_availability_request_players(id uuid primary key,request_id uuid,player_id uuid,club_id uuid,team_id uuid);
create table public.team_staff(user_id uuid,team_id uuid,role_rank int);
create table public.match_day_player_availability(id uuid primary key default gen_random_uuid(),match_day_id uuid,player_id uuid,status text,selected_at timestamptz,selected_by_name text,unique(match_day_id,player_id));
create table public.training_availability_responses(id uuid primary key default gen_random_uuid(),request_id uuid,player_id uuid,status text,responded_at timestamptz,note text,unique(request_id,player_id));
create table public.training_coach_attendance(id uuid primary key,coach_user_id uuid,request_id uuid,calendar_event_id uuid,occurrence_date date,club_id uuid,team_id uuid,status text,responded_at timestamptz,notification_status text);
create table public.synthetic_side_effects(route text);
create function public.current_user_can_access_parent_link(uuid,uuid) returns boolean language sql stable as $$select coalesce(nullif(current_setting('test.authority',true),'')::boolean,true)$$;
create function public.can_manage_match_day(uuid) returns boolean language sql stable as $$select coalesce(nullif(current_setting('test.authority',true),'')::boolean,true)$$;
create function public.current_user_can_access_team(uuid,uuid) returns boolean language sql stable as $$select coalesce(nullif(current_setting('test.authority',true),'')::boolean,true)$$;
create function public.synthetic_write(kind text,scope uuid,player uuid,response text) returns jsonb language plpgsql as $$begin
 if current_setting('test.fail',true)='true' then raise exception 'synthetic authoritative mutation denied';end if;
 if kind='match' then insert into public.match_day_player_availability(match_day_id,player_id,status,selected_at) values(scope,player,response,now()) on conflict(match_day_id,player_id) do update set status=excluded.status,selected_at=excluded.selected_at;
 elsif kind='training' then insert into public.training_availability_responses(request_id,player_id,status,responded_at) values(scope,player,response,now()) on conflict(request_id,player_id) do update set status=excluded.status,responded_at=excluded.responded_at;
 else update public.training_coach_attendance set status=response,responded_at=now() where id=scope;end if;
 insert into public.synthetic_side_effects values(kind);
 if current_setting('test.fail_after',true)='true' then raise exception 'synthetic notification failure';end if;
 return jsonb_build_object('responseState',response,'respondedAt',now(),'changed',true);end$$;
create function public.respond_parent_portal_match_day_invitation(uuid,uuid,text,text,text) returns jsonb language plpgsql as $$declare r record;begin select * into r from public.match_day_availability_requests where id=$2;return public.synthetic_write('match',r.match_day_id,r.player_id,$5);end$$;
create function public.respond_parent_portal_training_invitation(uuid,uuid,text) returns jsonb language plpgsql as $$declare r record;begin select * into r from public.training_availability_request_players where id=$2;return public.synthetic_write('training',r.request_id,r.player_id,$3);end$$;
create function public.accept_event_player_availability_on_behalf(text,uuid,uuid,date) returns jsonb language plpgsql as $$declare requestid uuid;begin if $1='match' then return public.synthetic_write('match',$2,$3,'available');end if;select id into requestid from public.training_availability_requests where calendar_event_id=$2 and occurrence_date=$4 order by created_at desc limit 1;return public.synthetic_write('training',requestid,$3,'available');end$$;
create function public.mark_event_player_unavailable_on_behalf(text,uuid,uuid,date) returns jsonb language plpgsql as $$declare requestid uuid;begin if $1='match' then return public.synthetic_write('match',$2,$3,'unavailable');end if;select id into requestid from public.training_availability_requests where calendar_event_id=$2 and occurrence_date=$4 order by created_at desc limit 1;return public.synthetic_write('training',requestid,$3,'unavailable');end$$;
create function public.submit_own_training_coach_attendance(uuid,text) returns jsonb language sql as $$select public.synthetic_write('self',$1,null,$2)$$;
`
const targets={parent_match:{parentLinkId:id(2),requestId:id(8)},parent_training:{parentLinkId:id(2),requestPlayerId:id(9)},coach_player_match:{eventId:id(6),playerId:id(5)},coach_player_training:{eventId:id(7),playerId:id(5),occurrenceDate:'2099-10-10'},coach_self_training:{attendanceId:id(11)}}
async function setup(t){
 const db=new PGlite();t.after(()=>db.close());await db.exec(schema);await db.exec(sql);
 await db.exec(`select set_config('test.actor','${id(1)}',false);
 insert into public.users values('${id(1)}','active','coach',50,'${id(3)}');
 insert into public.parent_player_links values('${id(2)}','${id(1)}','active','${id(5)}','${id(4)}','${id(3)}');
 insert into public.players values('${id(5)}','${id(3)}','${id(4)}','active');
 insert into public.match_days values('${id(6)}','${id(3)}','${id(4)}',true,'all');
 insert into public.calendar_events values('${id(7)}','${id(3)}','${id(4)}','training');
 insert into public.match_day_availability_requests values('${id(8)}','${id(6)}','${id(5)}','${id(3)}','${id(4)}');
 insert into public.training_availability_requests values('${id(10)}','${id(7)}','${id(3)}','${id(4)}','2099-10-10','pending','2099-10-10');
 insert into public.training_availability_request_players values('${id(9)}','${id(10)}','${id(5)}','${id(3)}','${id(4)}');
 insert into public.team_staff values('${id(1)}','${id(4)}',50);
 insert into public.training_coach_attendance values('${id(11)}','${id(1)}','${id(10)}','${id(7)}','2099-10-10','${id(3)}','${id(4)}','pending',null,'pending');`)
 const prepare=async route=>(await db.query('select public.prepare_mobile_attendance_command($1,$2::jsonb) value',[route,JSON.stringify(targets[route])])).rows[0].value;
 const apply=async(p,key=id(20),response='available')=>(await db.query('select public.apply_mobile_attendance_command($1,$2,$3::jsonb,$4::jsonb,$5) value',[key,p.route,JSON.stringify(p.target),JSON.stringify(p.baseline),response])).rows[0].value;
 const count=async table=>(await db.query(`select count(*)::int count from public.${table}`)).rows[0].count;
 return{db,prepare,apply,count};
}
for(const route of Object.keys(targets))test(`actual SQL ${route}: exact command saves once, replay has no repeated effects`,async t=>{
 const e=await setup(t),p=await e.prepare(route),before=await e.count('mobile_attendance_answer_revisions');
 assert.equal(await e.count('mobile_attendance_commands'),0);assert.ok(p.baseline.revision);
 // Preparation itself is read-only, including empty answers.
 await e.prepare(route);assert.equal(await e.count('mobile_attendance_answer_revisions'),before);
 const saved=await e.apply(p);assert.equal(saved.outcome,'saved');assert.equal(saved.current.status,'available');
 assert.equal((await e.apply(p)).duplicate,true);assert.equal(await e.count('synthetic_side_effects'),1);
 assert.equal(await e.count('mobile_attendance_commands'),1);
})
test('different guardians share one answer revision; stale command returns conflict without mutation',async t=>{
 const e=await setup(t),p=await e.prepare('parent_match');
 await e.db.exec(`insert into public.parent_player_links values('${id(12)}','${id(1)}','active','${id(5)}','${id(4)}','${id(3)}');`);
 await e.apply(p);const stale=structuredClone(p);stale.target.parentLinkId=id(12);
 assert.equal((await e.apply(stale,id(21),'unavailable')).outcome,'conflict');assert.equal(await e.count('synthetic_side_effects'),1);
})
for(const route of ['parent_match','parent_training','coach_self_training'])test(`legacy ${route} changes and ABA invalidate old revision even if status and timestamp restored`,async t=>{
 const e=await setup(t);await e.apply(await e.prepare(route));const p=await e.prepare(route);
 const table=route==='parent_match'?'match_day_player_availability':route==='parent_training'?'training_availability_responses':'training_coach_attendance';
 await e.db.exec(`update public.${table} set status='unavailable';update public.${table} set status='available';`);
 const answer=await e.apply(p,id(21),'unavailable');assert.equal(answer.outcome,'conflict');assert.equal(answer.current.status,'available');
 assert.equal(await e.count('synthetic_side_effects'),1);
})
test('delete and reinsert identical answer cannot reset its revision',async t=>{
 const e=await setup(t);await e.apply(await e.prepare('parent_match'));const p=await e.prepare('parent_match');
 await e.db.exec('create temp table copied as select * from public.match_day_player_availability;delete from public.match_day_player_availability;insert into public.match_day_player_availability select * from copied;');
 assert.equal((await e.apply(p,id(21),'unavailable')).outcome,'conflict');
})
test('late completed-key replay reports current newer legacy answer without rewriting it',async t=>{
 const e=await setup(t),p=await e.prepare('parent_match');await e.apply(p);
 await e.db.exec("update public.match_day_player_availability set status='unavailable'");
 const replay=await e.apply(p);assert.equal(replay.duplicate,true);assert.equal(replay.current.status,'unavailable');assert.equal(replay.result.responseState,'available');assert.equal(await e.count('synthetic_side_effects'),1);
})
test('authoritative denial and failure after answer write roll back answer, revision, ledger and effects',async t=>{
 for(const setting of ['test.fail','test.fail_after']){
  const e=await setup(t),p=await e.prepare('parent_match');await e.db.query('select set_config($1,$2,false)',[setting,'true']);
  await assert.rejects(e.apply(p),/synthetic/);assert.equal(await e.count('mobile_attendance_commands'),0);assert.equal(await e.count('match_day_player_availability'),0);assert.equal(await e.count('synthetic_side_effects'),0);assert.equal(await e.count('mobile_attendance_answer_revisions'),1); // only seeded self-attendance
  await e.db.query('select set_config($1,$2,false)',[setting,'false']);assert.equal((await e.apply(p)).outcome,'saved');
 }
})
test('wrong actor, changed command response and revoked authority cannot replay or mutate',async t=>{
 const e=await setup(t),p=await e.prepare('parent_match');await e.apply(p);
 await assert.rejects(e.apply(p,id(20),'unavailable'),/another action/);
 await e.db.exec("select set_config('test.actor','00000000-0000-4000-8000-000000000099',false)");await assert.rejects(e.apply(p),/authority/);
 await e.db.exec(`select set_config('test.actor','${id(1)}',false);update public.parent_player_links set status='revoked'`);await assert.rejects(e.apply(p),/authority/);
 assert.equal(await e.count('synthetic_side_effects'),1);
})
test('notification bookkeeping does not invalidate Coach self response baseline',async t=>{
 const e=await setup(t),p=await e.prepare('coach_self_training');await e.db.exec("update public.training_coach_attendance set notification_status='sent'");assert.equal((await e.apply(p)).outcome,'saved');
})
test('ordered preparation batch preserves denied entries and remains read-only',async t=>{
 const e=await setup(t),before=await e.count('mobile_attendance_answer_revisions');
 const choices=[{route:'parent_match',target:targets.parent_match},{route:'parent_match',target:{parentLinkId:id(99),requestId:id(8)}},{route:'coach_self_training',target:targets.coach_self_training}];
 const result=(await e.db.query('select public.prepare_mobile_attendance_choices($1::jsonb) value',[JSON.stringify(choices)])).rows[0].value;
 assert.equal(result.length,3);assert.equal(result[0].route,'parent_match');assert.equal(result[1],null);assert.equal(result[2].route,'coach_self_training');assert.equal(await e.count('mobile_attendance_answer_revisions'),before);
 await assert.rejects(e.db.query('select public.prepare_mobile_attendance_choices($1::jsonb)',[JSON.stringify(Array(201).fill(choices[0]))]),/200/);
})
test('new recurring request cannot silently replace prepared exact training request',async t=>{
 const e=await setup(t),p=await e.prepare('coach_player_training');
 await e.db.exec(`insert into public.training_availability_requests select '${id(13)}',calendar_event_id,club_id,team_id,occurrence_date,status,occurrence_starts_at,created_at+interval '1 second' from public.training_availability_requests;`);
 assert.equal((await e.apply(p)).outcome,'conflict');assert.equal(await e.count('synthetic_side_effects'),0);
})
test('completed Coach training command remains replayable after its original occurrence closes',async t=>{
 const e=await setup(t),p=await e.prepare('coach_player_training');await e.apply(p);
 await e.db.exec("update public.training_availability_requests set occurrence_starts_at='2000-01-01'");
 const replay=await e.apply(p);assert.equal(replay.outcome,'saved');assert.equal(replay.duplicate,true);assert.equal(await e.count('synthetic_side_effects'),1);
})
test('PUBLIC and anon cannot execute; private tables are not granted to authenticated',async t=>{
 const e=await setup(t);
 const r=(await e.db.query("select has_function_privilege('anon','public.apply_mobile_attendance_command(uuid,text,jsonb,jsonb,text)','execute') allowed,has_table_privilege('authenticated','public.mobile_attendance_commands','select') readable,has_function_privilege('authenticated','public.mobile_attendance_target_internal(text,jsonb)','execute') internal")).rows[0];assert.deepEqual(r,{allowed:false,readable:false,internal:false});
})
test('same-key overlap has one mutation; stale different-key overlap cannot overwrite it',async t=>{
 const e=await setup(t),p=await e.prepare('parent_match');
 const same=await Promise.all([e.apply(p),e.apply(p)]);assert.deepEqual(same.map(r=>r.duplicate).sort(),[false,true]);
 const different=await Promise.all([e.apply(p,id(21),'unavailable'),e.apply(p,id(22),'maybe')]);
 assert.ok(different.every(r=>r.outcome==='conflict'));assert.equal(await e.count('synthetic_side_effects'),1);
 // PGlite is a single connection; this is not cross-session lock/deadlock evidence.
})
test('source-pointer changes and incomplete canonical target cannot redirect a prepared command',async t=>{
 const e=await setup(t),p=await e.prepare('parent_match');
 await e.db.exec(`insert into public.match_days values('${id(14)}','${id(3)}','${id(4)}',true,'all');update public.match_day_availability_requests set match_day_id='${id(14)}';`);
 await assert.rejects(e.apply(p),/exact prepared/);assert.equal(await e.count('synthetic_side_effects'),0);
 const training=await e.prepare('coach_player_training');delete training.target.requestId;
 await assert.rejects(e.apply(training),/exact prepared/);assert.equal(await e.count('synthetic_side_effects'),0);
})
