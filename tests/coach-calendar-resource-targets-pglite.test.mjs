import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { after, before, test } from 'node:test'
import { PGlite } from '@electric-sql/pglite'
const read = name => readFile(new URL('../supabase/migrations/'+name,import.meta.url),'utf8')
const migration='20260915130544_coach_calendar_match_session_resource_links.sql'
const ids={club:'10000000-0000-4000-8000-000000000001',team:'20000000-0000-4000-8000-000000000001',other:'20000000-0000-4000-8000-000000000002',coach:'30000000-0000-4000-8000-000000000001',resource:'40000000-0000-4000-8000-000000000001',archived:'40000000-0000-4000-8000-000000000002',foreign:'40000000-0000-4000-8000-000000000003',match:'50000000-0000-4000-8000-000000000001',session:'60000000-0000-4000-8000-000000000001',calendar:'70000000-0000-4000-8000-000000000001'}
let db,sequence=0
before(async()=>{
 db=new PGlite()
 await db.exec(`
 create role authenticated; create role anon; create role service_role; create schema auth; create schema app_private;
 create function auth.uid() returns uuid language sql stable as $$select nullif(current_setting('test.uid',true),'')::uuid$$;
 create function public.current_user_can_manage_resource_library(c uuid,t uuid) returns boolean language sql stable as $$select auth.uid() is not null and current_setting('test.manage',true)='yes' and c='${ids.club}'::uuid and t='${ids.team}'::uuid$$;
 create function public.current_user_can_view_resource_library(c uuid,t uuid) returns boolean language sql stable as $$select auth.uid() is not null and current_setting('test.view',true)='yes' and c='${ids.club}'::uuid and t='${ids.team}'::uuid$$;
 create function public.resource_library_player_in_scope(uuid,uuid,uuid) returns boolean language sql stable as $$select false$$;
 create table public.teams(id uuid primary key,club_id uuid);
 create table public.match_days(id uuid primary key,club_id uuid,team_id uuid,status text,deleted_at timestamptz);
 create table public.assessment_sessions(id uuid primary key,club_id uuid,team_id uuid,status text);
 create table public.calendar_events(id uuid primary key,club_id uuid,team_id uuid,starts_at timestamptz,recurrence_frequency text,recurrence_until date,cancelled_at timestamptz);
 create table public.resource_library_items(id uuid primary key,club_id uuid,team_id uuid,archived_at timestamptz);
 create table public.resource_library_links(id uuid primary key,resource_id uuid,club_id uuid,team_id uuid,linked_type text,linked_id uuid,assigned_by_profile_id uuid,removed_at timestamptz,removed_by_profile_id uuid);
 alter table public.resource_library_links enable row level security;
 grant usage on schema public,auth to authenticated,anon;
 grant select,insert,update on public.resource_library_links to authenticated;
 insert into public.teams values('${ids.team}','${ids.club}');
 insert into public.match_days values('${ids.match}','${ids.club}','${ids.team}','scheduled',null);
 insert into public.assessment_sessions values('${ids.session}','${ids.club}','${ids.team}','open');
 insert into public.calendar_events values('${ids.calendar}','${ids.club}','${ids.team}','2026-09-15T12:00Z','weekly','2026-10-01',null);
 insert into public.resource_library_items values('${ids.resource}','${ids.club}','${ids.team}',null),('${ids.archived}','${ids.club}','${ids.team}',now()),('${ids.foreign}','${ids.club}','${ids.other}',null);
 `)
 await db.exec(await read('20260702085846_calendar_event_resource_links.sql'))
 await db.exec((await read('20260721161858_m2_database_function_and_club_logo_hardening.sql')).split('-- FP-SPR-016:')[0])
 await db.exec(await read('20260826155348_calendar_resource_occurrence_scope.sql'))
 await db.exec(await read(migration))
})
after(async()=>db?.close())
async function asActor(options,action){await db.exec(`select set_config('test.uid','${options.anonymous?'':ids.coach}',false),set_config('test.manage','${options.readOnly||options.parent?'no':'yes'}',false),set_config('test.view','${options.parent?'no':'yes'}',false); set role authenticated;`);try{return await action()}finally{await db.exec('reset role')}}
function attach(type,target,{resource=ids.resource,team=ids.team,club=ids.club,date=null,actor=ids.coach}={}){const id='80000000-0000-4000-8000-'+String(++sequence).padStart(12,'0');return db.query('insert into public.resource_library_links(id,resource_id,club_id,team_id,linked_type,linked_id,assigned_by_profile_id,calendar_occurrence_date) values($1,$2,$3,$4,$5,$6,$7,$8) returning id',[id,resource,club,team,type,target,actor,date])}
test('same-team manager attaches match and assessment resources; existing uniqueness rejects duplicates',async()=>{
 for(const [type,target] of [['match_day',ids.match],['assessment_session',ids.session]])await asActor({},async()=>{
  await attach(type,target)
  await assert.rejects(()=>attach(type,target),/duplicate key/)
 })
})
test('read-only, parent, anonymous-session and impersonated actor writes are rejected',async()=>{
 for(const options of [{readOnly:true},{parent:true},{anonymous:true}])await asActor(options,()=>assert.rejects(()=>attach('match_day',ids.match),/row-level security/))
 await asActor({},()=>assert.rejects(()=>attach('match_day',ids.match,{actor:ids.other}),/row-level security/))
})
test('cross-team, cross-club, missing targets and archived/foreign resources fail closed',async()=>{
 for(const [type,target] of [['match_day',ids.match],['assessment_session',ids.session]])await asActor({},async()=>{
  for(const options of [{team:ids.other},{club:ids.other},{resource:ids.archived},{resource:ids.foreign}])await assert.rejects(()=>attach(type,target,options),/row-level security/)
  await assert.rejects(()=>attach(type,ids.other),/row-level security/)
 })
})
test('cancelled targets cannot gain attachments while completed events remain attachable',async()=>{
 for(const [table,type,target] of [['match_days','match_day',ids.match],['assessment_sessions','assessment_session',ids.session]]){
  await db.exec(`update public.${table} set status='cancelled' where id='${target}'`)
  await asActor({},()=>assert.rejects(()=>attach(type,target),/row-level security/))
  await db.exec(`update public.${table} set status='${type==='match_day'?'full_time':'completed'}' where id='${target}'`)
  const result=await asActor({},()=>db.query('select public.resource_library_link_target_allowed($1,$2,$3,$4) as allowed',[type,target,ids.club,ids.team]))
  assert.equal(result.rows[0].allowed,true)
 }
})
test('calendar recurrence remains dated and new targets reject occurrence dates',async()=>{
 await asActor({},async()=>{
  await attach('calendar_event',ids.calendar,{date:'2026-09-15'})
  await attach('calendar_event',ids.calendar,{date:'2026-09-22'})
  await assert.rejects(()=>attach('calendar_event',ids.calendar,{date:'2026-09-23'}),/calendar_resource_occurrence_invalid/)
  await assert.rejects(()=>attach('match_day',ids.match,{date:'2026-09-15'}),/calendar_resource_occurrence_not_allowed/)
  await assert.rejects(()=>attach('assessment_session',ids.session,{date:'2026-09-15'}),/calendar_resource_occurrence_not_allowed/)
 })
})
test('soft-deleted scheduled matches cannot gain attachments',async()=>{
 await db.exec(`update public.match_days set status='scheduled',deleted_at=now() where id='${ids.match}'`)
 try {
  await asActor({},()=>assert.rejects(()=>attach('match_day',ids.match),/row-level security/))
  const result=await asActor({},()=>db.query('select public.resource_library_link_target_allowed($1,$2,$3,$4) as allowed',['match_day',ids.match,ids.club,ids.team]))
  assert.equal(result.rows[0].allowed,false)
 } finally {await db.exec(`update public.match_days set deleted_at=null where id='${ids.match}'`)}
})
test('staff read scope and Parent direct-table denial remain unchanged; removed links disappear',async()=>{
 const staff=await asActor({readOnly:true},()=>db.query('select id from public.resource_library_links'))
 assert.equal(staff.rows.length,4)
 const parent=await asActor({parent:true},()=>db.query('select id from public.resource_library_links'))
 assert.equal(parent.rows.length,0)
 // The existing secured removal RPC performs the soft delete with definer
 // privileges. Simulate that result here to verify unchanged read filtering.
 await db.query('update public.resource_library_links set removed_at=now(),removed_by_profile_id=$1 where linked_type=$2',[ids.coach,'match_day'])
 const afterRemove=await asActor({readOnly:true},()=>db.query('select id from public.resource_library_links'))
 assert.equal(afterRemove.rows.length,3)
})
test('target helper has fixed search path and no anonymous execution',async()=>{
 const row=(await db.query(`select has_function_privilege('anon','public.resource_library_link_target_allowed(text,uuid,uuid,uuid)','EXECUTE') as anon,has_function_privilege('authenticated','public.resource_library_link_target_allowed(text,uuid,uuid,uuid)','EXECUTE') as staff,proconfig from pg_proc where oid='public.resource_library_link_target_allowed(text,uuid,uuid,uuid)'::regprocedure`)).rows[0]
 assert.equal(row.anon,false);assert.equal(row.staff,true);assert.ok(row.proconfig.includes('search_path=""'))
})
