import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'
import { PGlite } from '@electric-sql/pglite'
const migration=await readFile('supabase/migrations/20261118101357_adult_player_calendar_dispatch.sql','utf8')
const ids={actor:'00000000-0000-4000-8000-000000000001',club:'00000000-0000-4000-8000-000000000002',team:'00000000-0000-4000-8000-000000000003',player:'00000000-0000-4000-8000-000000000004',event:'00000000-0000-4000-8000-000000000005',command:'00000000-0000-4000-8000-000000000006',account:'00000000-0000-4000-8000-000000000007',invite:'00000000-0000-4000-8000-000000000008',link:'00000000-0000-4000-8000-000000000009',token:'00000000-0000-4000-8000-000000000010'}
test('authorized Calendar command queues eligible adult once and excludes revoked adult',async()=>{
 const db=new PGlite()
 try{
 await db.exec(`create schema auth; create schema app_private; create role anon; create role authenticated; create role service_role;
 create function auth.uid() returns uuid language sql as $$select '${ids.actor}'::uuid$$;
 create table public.calendar_event_notification_commands(id uuid primary key,club_id uuid,team_id uuid,requested_by uuid,event_revision bigint,notification_type text,player_ids uuid[],result jsonb);
 create table public.calendar_events(id uuid primary key,club_id uuid,team_id uuid,event_type text,cancelled_at timestamptz);
 create table public.calendar_event_invites(id uuid primary key,calendar_event_id uuid,club_id uuid,team_id uuid,player_id uuid,invite_status text,cancelled_at timestamptz,parent_link_id uuid,recipient_type text,player_contact_email text);
 create table public.adult_player_account_links(id uuid primary key,player_id uuid,club_id uuid,team_id uuid,user_id uuid,verified_at timestamptz);
 create table auth.users(id uuid primary key,email text,email_confirmed_at timestamptz default now(),banned_until timestamptz,deleted_at timestamptz); create table public.parent_player_links(id uuid,auth_user_id uuid,player_id uuid,club_id uuid,team_id uuid,status text,email text); create table public.users(id uuid,status text);
 create table public.calendar_event_notification_events(id uuid default gen_random_uuid(),club_id uuid,team_id uuid,calendar_event_id uuid,notification_command_id uuid,event_revision bigint,notification_type text,event_action_type text,parent_link_id uuid,player_id uuid,recipient_email text,idempotency_key text,portal_state text,response_requirement text,status text,requested_by uuid,email_queue_id uuid,updated_at timestamptz,last_error text);
 create unique index notification_unique on public.calendar_event_notification_events(notification_command_id,lower(recipient_email)) where notification_command_id is not null;
 create table public.scheduled_email_queue(id uuid default gen_random_uuid(),club_id uuid,team_id uuid,created_by uuid,to_email text,subject text,status text,scheduled_at timestamptz,payload jsonb);
 create function app_private.adult_player_contact_is_current(uuid,uuid,uuid,text) returns boolean language sql as $$select $4='adult@example.test'$$;
 create function public.notify_calendar_event_parents(uuid,text,uuid,uuid,uuid[]) returns jsonb language sql as $$select jsonb_build_object('notificationCommandId','${ids.command}','queuedCount',0,'finalState','portal_ready_no_eligible_email')$$;
 insert into public.calendar_event_notification_commands values('${ids.command}','${ids.club}','${ids.team}','${ids.actor}',1,'creation',array['${ids.player}'::uuid],null);
 insert into public.calendar_events values('${ids.event}','${ids.club}','${ids.team}','general',null);
 insert into public.calendar_event_invites values('${ids.invite}','${ids.event}','${ids.club}','${ids.team}','${ids.player}','active',null,null,'parent_guardian','');
 insert into auth.users(id,email) values('${ids.account}','adult@example.test');
 insert into public.adult_player_account_links values('${ids.link}','${ids.player}','${ids.club}','${ids.team}','${ids.account}',now());`)
 await db.exec(migration)
 const call=async()=>(await db.query('select public.notify_calendar_event_parents($1,$2,null,$3,$4) as result',[ids.event,'creation',ids.token,[]])).rows[0].result
 assert.equal((await call()).adultQueuedCount,1); assert.equal((await call()).adultQueuedCount,1)
 assert.equal((await db.query('select count(*)::int as n from public.scheduled_email_queue')).rows[0].n,1)
 const invitation=(await db.query('select recipient_type,player_contact_email from public.calendar_event_invites')).rows[0]
 assert.deepEqual(invitation,{recipient_type:'player',player_contact_email:'adult@example.test'})
 await db.exec(`delete from public.scheduled_email_queue; delete from public.calendar_event_notification_events; update public.calendar_event_notification_commands set result=null;
 insert into public.parent_player_links values('${ids.link}','${ids.account}','${ids.player}','${ids.club}','${ids.team}','active','adult@example.test');
 update public.calendar_event_invites set parent_link_id='${ids.link}';
 insert into public.calendar_event_notification_events(notification_command_id,recipient_email,parent_link_id) values('${ids.command}','adult@example.test','${ids.link}');`)
 assert.equal((await call()).adultDuplicateCount,1)
 assert.equal((await db.query('select recipient_type from public.calendar_event_invites')).rows[0].recipient_type,'parent_and_player')
 assert.equal((await db.query('select count(*)::int as n from public.scheduled_email_queue')).rows[0].n,0)
 await db.exec("delete from public.scheduled_email_queue; delete from public.calendar_event_notification_events; update public.calendar_event_notification_commands set result=null; update auth.users set email='revoked@example.test'")
 assert.equal((await call()).adultQueuedCount,0)
 }finally{await db.close()}
})
