import assert from 'node:assert/strict'
import test from 'node:test'
import {readFile} from 'node:fs/promises'
import {createRequire} from 'node:module'
const {PGlite}=createRequire(import.meta.url)('@electric-sql/pglite')
const read=name=>readFile(new URL(name,import.meta.url),'utf8')
const baseTest=await read('./mobile-attendance-command.test.mjs')
const schema=baseTest.match(/const schema=`([\s\S]*?)`\n/)[1]
const extension=await read('./fixtures/v1-attendance/mobile-attendance-original-schema.fixture.sql')
const original=await read('./fixtures/v1-attendance/mobile-attendance-original-rpcs.fixture.sql')
import { intentSql as intent, commandSql as command, transactionSql } from './attendance-migration-contract.mjs'
const id=n=>`00000000-0000-4000-8000-${String(n).padStart(12,'0')}`
const token='a'.repeat(64),trainingToken='b'.repeat(64)
const routes={parent_match:{parentLinkId:id(2),requestId:id(8)},parent_training:{parentLinkId:id(2),requestPlayerId:id(9)},coach_player_match:{eventId:id(6),playerId:id(5)},coach_player_training:{eventId:id(7),playerId:id(5),occurrenceDate:'2099-10-10'},coach_self_training:{attendanceId:id(11)}}
// Original seven public RPC bodies execute unchanged except candidate entry lock
// and success stamp. Original authorization helpers/token currentness and the
// older renamed match writer below are explicit controlled seams, not full RLS.
const lowerMatchSeam=`
create function public.submit_match_day_availability_response_26a_legacy(text,text,text,text,text,boolean,boolean,integer)
returns table(request_id uuid,player_name text,response_status text,responded_at timestamptz,volunteer_scorer_response text,volunteer_linesman_response text,volunteer_referee_response text,volunteer_responded_at timestamptz,transport_needs_lift boolean,transport_can_offer_lift boolean,transport_seats_offered integer,transport_responded_at timestamptz)
language plpgsql as $$declare r public.match_day_availability_requests%rowtype;begin
 select * into r from public.match_day_availability_requests where token_hash=$1;
 if $2 in ('available','unavailable','maybe') then
  insert into public.match_day_player_availability(match_day_id,player_id,club_id,team_id,status,selected_at) values(r.match_day_id,r.player_id,r.club_id,r.team_id,$2,now())
  on conflict(match_day_id,player_id) do update set status=excluded.status,selected_at=excluded.selected_at;
 end if;
 update public.match_day_availability_requests set volunteer_scorer_response=coalesce($3,r.volunteer_scorer_response),transport_needs_lift=coalesce($6,r.transport_needs_lift) where id=r.id;
 return query select r.id,r.player_name,a.status,a.selected_at,coalesce($3,r.volunteer_scorer_response),r.volunteer_linesman_response,r.volunteer_referee_response,r.volunteer_responded_at,coalesce($6,r.transport_needs_lift),r.transport_can_offer_lift,r.transport_seats_offered,r.transport_responded_at from public.match_day_player_availability a where a.match_day_id=r.match_day_id and a.player_id=r.player_id;
end$$;`
async function setup(t,{instrument=true,status='available',combined=false}={}){
 const db=new PGlite();t.after(()=>db.close());await db.exec(schema);await db.exec(extension)
 // SQL/PLpgSQL function replacement signatures, defaults and existing grants are
 // checked against original definitions, not replaced by synthetic RPC seams.
 await db.exec('set check_function_bodies=false');await db.exec(original);await db.exec(lowerMatchSeam);if(!combined)await db.exec(command)
 await db.exec(`
 create or replace function public.current_user_can_access_parent_link(linkid uuid,playerid uuid) returns boolean language sql stable as $$select coalesce(nullif(current_setting('test.authority',true),'')::boolean,true) and exists(select 1 from public.parent_player_links where id=linkid and player_id=playerid and auth_user_id=auth.uid() and status='active')$$;
 insert into auth.users values('${id(1)}','{"display_name":"Synthetic actor"}');insert into public.clubs values('${id(3)}','active');
 select set_config('test.actor','${id(1)}',false);
 insert into public.users(id,status,role,role_rank,club_id,name) values('${id(1)}','active','coach',50,'${id(3)}','Synthetic coach');
 insert into public.parent_player_links(id,auth_user_id,status,player_id,team_id,club_id,email) values('${id(2)}','${id(1)}','active','${id(5)}','${id(4)}','${id(3)}','synthetic@example.invalid');
 insert into public.players(id,club_id,team_id,status,player_name) values('${id(5)}','${id(3)}','${id(4)}','active','Synthetic player');
 insert into public.match_days(id,club_id,team_id,parent_visible,parent_audience,match_date) values('${id(6)}','${id(3)}','${id(4)}',true,'all','2099-10-10');
 insert into public.calendar_events(id,club_id,team_id,event_type) values('${id(7)}','${id(3)}','${id(4)}','training');
 insert into public.match_day_availability_requests(id,match_day_id,player_id,club_id,team_id,parent_link_id,recipient_email,token_hash,status,expires_at,sent_at,player_name)
 values('${id(8)}','${id(6)}','${id(5)}','${id(3)}','${id(4)}','${id(2)}','synthetic@example.invalid','${token}','responded','2099-10-10',now(),'Synthetic player');
 insert into public.training_availability_requests(id,calendar_event_id,club_id,team_id,occurrence_date,status,occurrence_starts_at) values('${id(10)}','${id(7)}','${id(3)}','${id(4)}','2099-10-10','pending','2099-10-10');
 insert into public.training_availability_request_players(id,request_id,player_id,club_id,team_id,calendar_event_id,parent_link_id,status,token_hash,player_name) values('${id(9)}','${id(10)}','${id(5)}','${id(3)}','${id(4)}','${id(7)}','${id(2)}','responded','${trainingToken}','Synthetic player');
 insert into public.team_staff values('${id(1)}','${id(4)}',50);
 insert into public.training_coach_attendance(id,coach_user_id,request_id,calendar_event_id,occurrence_date,club_id,team_id,status,responded_at,occurrence_starts_at) values('${id(11)}','${id(1)}','${id(10)}','${id(7)}','2099-10-10','${id(3)}','${id(4)}','${status}','2026-10-05','2099-10-10');
 insert into public.match_day_player_availability(match_day_id,player_id,club_id,team_id,status,selected_at) values('${id(6)}','${id(5)}','${id(3)}','${id(4)}','${status}','2026-10-05');
 insert into public.training_availability_responses(request_id,player_id,club_id,team_id,calendar_event_id,request_player_id,parent_link_id,status,responded_at,note) values('${id(10)}','${id(5)}','${id(3)}','${id(4)}','${id(7)}','${id(9)}','${id(2)}','${status}','2026-10-05','');
 `)
 // Simulate existing published API grants; replacements must retain their ACL.
 await db.exec(`revoke all on function public.submit_own_training_coach_attendance(uuid,text) from public,anon;grant execute on function public.submit_own_training_coach_attendance(uuid,text) to authenticated;
 revoke all on function public.submit_match_day_availability_response(text,text,text,text,text,boolean,boolean,integer) from public;grant execute on function public.submit_match_day_availability_response(text,text,text,text,text,boolean,boolean,integer) to anon,authenticated,service_role;`)
 const metadataQuery=`select proname,proargnames,pronargdefaults,prosecdef,proconfig,proacl from pg_catalog.pg_proc where pronamespace='public'::regnamespace and proname in ('respond_parent_portal_match_day_invitation','respond_parent_portal_training_invitation','accept_event_player_availability_on_behalf','mark_event_player_unavailable_on_behalf','submit_own_training_coach_attendance','submit_match_day_availability_response','submit_training_availability_response') order by proname`
 const originalMetadata=(await db.query(metadataQuery)).rows
 if(combined)await db.exec(transactionSql)
 else if(instrument)await db.exec(intent)
 return {db,metadataQuery,originalMetadata,prepare:async route=>(await db.query('select public.prepare_mobile_attendance_command($1,$2::jsonb) v',[route,JSON.stringify(routes[route])])).rows[0].v,
 apply:async(p,key=id(20),response=status==='available'?'unavailable':'available')=>(await db.query('select public.apply_mobile_attendance_command($1,$2,$3::jsonb,$4::jsonb,$5) v',[key,p.route,JSON.stringify(p.target),JSON.stringify(p.baseline),response])).rows[0].v}
}
const choices=[
 ['Parent match','parent_match',s=>`select public.respond_parent_portal_match_day_invitation('${id(2)}','${id(8)}','attendance',null,'${s}') v`],
 ['Parent training','parent_training',s=>`select public.respond_parent_portal_training_invitation('${id(2)}','${id(9)}','${s}') v`],
 ['Coach match attending','coach_player_match',()=>`select public.accept_event_player_availability_on_behalf('match','${id(6)}','${id(5)}') v`],
 ['Coach match unavailable','coach_player_match',()=>`select public.mark_event_player_unavailable_on_behalf('match','${id(6)}','${id(5)}') v`,'unavailable'],
 ['Coach training attending','coach_player_training',()=>`select public.accept_event_player_availability_on_behalf('training','${id(7)}','${id(5)}','2099-10-10') v`],
 ['Coach training unavailable','coach_player_training',()=>`select public.mark_event_player_unavailable_on_behalf('training','${id(7)}','${id(5)}','2099-10-10') v`,'unavailable'],
 ['Own Coach','coach_self_training',s=>`select public.submit_own_training_coach_attendance('${id(11)}','${s}') v`],
 ['Bearer match','parent_match',s=>`select * from public.submit_match_day_availability_response('${token}','${s}')`],
 ['Bearer training','parent_training',s=>`select * from public.submit_training_availability_response('${trainingToken}','${s}')`],
]
for(const[name,route,legacy,status='available']of choices)test(`actual original ${name}: same-answer intent invalidates older queued different answer`,async t=>{
 const e=await setup(t,{status}),before=await e.prepare(route),answerBefore=before.baseline
 const result=(await e.db.query(legacy(status))).rows
 const after=await e.prepare(route)
 assert.ok(Number(after.baseline.revision)>Number(answerBefore.revision));assert.equal(after.baseline.status,status);assert.equal(after.baseline.respondedAt,answerBefore.respondedAt)
 assert.equal((await e.apply(before)).outcome,'conflict');assert.equal((await e.apply(before)).duplicate,true)
 assert.equal((await e.prepare(route)).baseline.status,status)
 if(result[0]?.v?.changed!==undefined)assert.equal(result[0].v.changed,false)
 assert.equal((await e.db.query('select count(*)::int n from public.audit_logs')).rows[0].n,0)
 assert.equal((await e.db.query('select count(*)::int n from public.match_day_player_availability_history')).rows[0].n,0)
})
test('generated combined migration commits ordered contracts and preserves the original public RPC metadata',async t=>{
 const e=await setup(t,{combined:true})
 assert.deepEqual((await e.db.query(e.metadataQuery)).rows,e.originalMetadata)
 const prepared=await e.prepare('coach_self_training')
 const result=await e.apply(prepared,id(22),'unavailable')
 assert.equal(result.outcome,'saved')
 assert.equal(result.current.status,'unavailable')
 assert.equal((await e.apply(prepared,id(22),'unavailable')).duplicate,true)
})

test('original legacy defect reproduces before instrumentation and repairs in same engine',async t=>{
 const e=await setup(t,{instrument:false}),p=await e.prepare('coach_self_training')
 await e.db.query(choices[6][2]('available'));assert.equal((await e.prepare('coach_self_training')).baseline.revision,p.baseline.revision)
 assert.equal((await e.apply(p)).outcome,'saved') // baseline bug: older contrary intent succeeds.
 await e.db.exec(intent);const newer=await e.prepare('coach_self_training');await e.db.query(choices[6][2]('unavailable'))
 assert.equal((await e.apply(newer,id(21),'available')).outcome,'conflict')
})
for(const[name,route,legacy,status='available']of choices.filter(x=>!x[0].startsWith('Bearer')))test(`actual original ${name}: changed command saves once and preserves replay revision`,async t=>{
 const opposite=status==='available'?'unavailable':'available',e=await setup(t,{status:opposite}),p=await e.prepare(route)
 const result=await e.apply(p,id(20),status);assert.equal(result.outcome,'saved');assert.equal(result.current.status,status)
 const revision=result.current.revision;const duplicate=await e.apply(p,id(20),status);assert.equal(duplicate.duplicate,true);assert.equal(duplicate.current.revision,revision)
})
test('authority, closed window and invalid bearer token never stamp successful intent',async t=>{
 const e=await setup(t),before=await e.prepare('parent_training')
 await e.db.exec(`select set_config('test.actor','${id(99)}',false)`);await assert.rejects(e.db.query(choices[1][2]('available')),/not available/)
 await e.db.exec(`select set_config('test.actor','${id(1)}',false);update public.training_availability_request_players set response_deadline_at=now()-interval '1 day'`)
 await assert.rejects(e.db.query(choices[1][2]('available')),/closed/)
 const invalid=await e.db.query(`select * from public.submit_training_availability_response('invalid','available')`);assert.equal(invalid.rows.length,0)
 assert.equal((await e.prepare('parent_training')).baseline.revision,before.baseline.revision)
})
test('role-only and transport-only Match confirmation do not invalidate attendance',async t=>{
 const e=await setup(t),before=await e.prepare('parent_match')
 await e.db.query(`select * from public.submit_match_day_availability_response('${token}','',null,null,null,true)`)
 await e.db.exec(`update public.match_days set request_scorer=true`)
 await e.db.query(`select public.respond_parent_portal_match_day_invitation('${id(2)}','${id(8)}','role','scorer','yes')`)
 assert.equal((await e.prepare('parent_match')).baseline.revision,before.baseline.revision)
})
test('private intent helpers remain unavailable to authenticated and anon; original ACL/defaults survive',async t=>{
 const e=await setup(t)
 assert.deepEqual((await e.db.query(e.metadataQuery)).rows,e.originalMetadata)
 const grants=await e.db.query(`select has_function_privilege('anon','public.mobile_attendance_record_intent_internal(text,jsonb,text,text)','EXECUTE') a,has_function_privilege('authenticated','public.mobile_attendance_lock_intent_internal(text,jsonb)','EXECUTE') b,has_function_privilege('anon','public.submit_match_day_availability_response(text,text,text,text,text,boolean,boolean,integer)','EXECUTE') c,has_function_privilege('anon','public.submit_own_training_coach_attendance(uuid,text)','EXECUTE') d`)
 assert.deepEqual(grants.rows[0],{a:false,b:false,c:true,d:false})
 const defaults=await e.db.query(`select pronargdefaults n from pg_proc where pronamespace='public'::regnamespace and proname='submit_match_day_availability_response'`);assert.equal(defaults.rows[0].n,6)
})

test('release dependency refuses changed original RPC definitions before installing intent helpers',async t=>{
 const e=await setup(t,{instrument:false})
 await e.db.exec(`create or replace function public.submit_own_training_coach_attendance(attendance_id_value uuid,status_value text) returns jsonb language plpgsql security definer set search_path='' as $$begin return jsonb_build_object('changed',false);end$$`)
 await assert.rejects(e.db.exec(intent),/Original attendance RPC changed/)
 const found=await e.db.query(`select count(*)::int n from pg_catalog.pg_proc where pronamespace='public'::regnamespace and proname like 'mobile_attendance_%intent_internal'`)
 assert.equal(found.rows[0].n,0)
})
test('successful answer and intent stamp roll back together when final exact key validation fails',async t=>{
 const e=await setup(t),p=await e.prepare('coach_self_training')
 await e.db.exec(`create or replace function public.mobile_attendance_record_intent_internal(route_value text,target_value jsonb,expected_key text,actual_key text) returns void language plpgsql as $$begin raise exception 'synthetic final target changed';end$$`)
 await assert.rejects(e.apply(p),/synthetic final target changed/)
 const after=await e.prepare('coach_self_training');assert.deepEqual(after.baseline,p.baseline)
 assert.equal((await e.db.query('select count(*)::int n from public.mobile_attendance_commands')).rows[0].n,0)
 assert.equal((await e.db.query('select count(*)::int n from public.audit_logs')).rows[0].n,0)
})

test('cross-club recurring request cannot retarget a same-answer staff confirmation',async t=>{
 const e=await setup(t),p=await e.prepare('coach_player_training')
 await e.db.exec(`insert into public.training_availability_requests(id,calendar_event_id,club_id,team_id,occurrence_date,status,occurrence_starts_at,created_at) values('${id(30)}','${id(7)}','${id(99)}','${id(98)}','2099-10-10','pending','2099-10-10',now()+interval '1 minute')`)
 await e.db.query(choices[4][2]('available'))
 const after=await e.prepare('coach_player_training');assert.equal(after.target.requestId,id(10))
 assert.ok(Number(after.baseline.revision)>Number(p.baseline.revision));assert.equal((await e.apply(p)).outcome,'conflict')
})

test('actual-key mismatch and rolled-back identical intent cannot publish a revision',async t=>{
 const e=await setup(t),p=await e.prepare('coach_self_training'),target=JSON.stringify({attendanceId:id(11)})
 await assert.rejects(e.db.query('select public.mobile_attendance_record_intent_internal($1,$2::jsonb,$3,$4)',['coach_self_training',target,'coach:'+id(11),'coach:'+id(99)]),/target changed/)
 await e.db.exec('begin');await e.db.query(choices[6][2]('available'));await e.db.exec('rollback')
 assert.deepEqual((await e.prepare('coach_self_training')).baseline,p.baseline)
})

test('authenticated command executes through original authority while private ledgers and helpers remain inaccessible',async t=>{
 const e=await setup(t),p=await e.prepare('parent_training')
 await e.db.exec('grant usage on schema public,auth to anon,authenticated;set role authenticated')
 assert.equal((await e.apply(p)).outcome,'saved')
 for(const table of ['mobile_attendance_answer_revisions','mobile_attendance_commands']) {
  await assert.rejects(e.db.query(`select * from public.${table}`),/permission denied/)
 }
 await assert.rejects(e.db.query(`select public.mobile_attendance_lock_intent_internal('parent_training','{"requestPlayerId":"${id(9)}"}'::jsonb)`),/permission denied/)
 await e.db.exec(`select set_config('test.actor','${id(99)}',false)`)
 await assert.rejects(e.apply(p,id(21)),/authority/)
 await e.db.exec('reset role;set role anon');await assert.rejects(e.apply(p,id(21)),/permission denied/)
 await e.db.exec('reset role');assert.equal((await e.db.query('select count(*)::int n from public.mobile_attendance_commands')).rows[0].n,1)
})
