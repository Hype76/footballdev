import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { pathToFileURL } from 'node:url'
import test from 'node:test'
import { PGlite } from '@electric-sql/pglite'
import { loadAuthoritativeCalendarNotificationContext } from '../netlify/functions/lib/_calendar-notification-email.js'

const file = pathToFileURL(`${process.cwd().replaceAll('\\','/')}/tests/adult-player-responses-pglite.test.mjs`)
const fixtureSource = await readFile(file, 'utf8')
const prefix = fixtureSource.slice(fixtureSource.indexOf('const ids ='), fixtureSource.indexOf("test('adult player sees"))
  .replaceAll('import.meta.url', JSON.stringify(file.href))
const { ids, setClaims, createDatabase } = new Function('readFile','PGlite','migrationUrl','auditMigrationUrl', `${prefix};return {ids,setClaims,createDatabase}`)(
  readFile,PGlite,new URL('../supabase/migrations/20260730110000_adult_player_account_foundation.sql',file),
  new URL('../supabase/migrations/20260730123000_adult_player_auth_only_audit_actor.sql',file),
)
const read = name => readFile(`supabase/migrations/${name}`, 'utf8')
const section = (source,start,end) => source.slice(source.indexOf(start),source.indexOf(end,source.indexOf(start)))

test('real Calendar command dispatches selected verified adult and revocation blocks delivery', async()=>{
 const db=await createDatabase()
 try{
  const actor='31000000-0000-4000-8000-000000000099', token='31000000-0000-4000-8000-000000000098'
  await db.exec(`
   alter table public.users add column role text, add column role_rank int, add column display_name text, add column name text;
   alter table public.players add column section text;
   alter table public.parent_player_links add column created_at timestamptz default now();
   alter table public.calendar_events add column notes text,add column parent_audience text default 'involved_players',add column parent_visible boolean default true,add column notification_revision bigint default 1;
   alter table public.calendar_event_invites alter column id set default gen_random_uuid();
   alter table public.calendar_event_invites add column assessment_session_id uuid,add column match_day_id uuid,add column parent_link_id uuid,add column player_status_at_invite text,add column parent_contact_name text,add column parent_contact_email text,add column recipient_contacts jsonb,add column notify_requested boolean,add column response_requirement text,add column created_by uuid,add column created_by_name text,add column created_by_email text,add column updated_by uuid,add column updated_by_name text,add column updated_by_email text;
   create unique index invite_scope on public.calendar_event_invites(club_id,player_id,calendar_event_id,assessment_session_id,match_day_id) nulls not distinct;
   create table public.team_staff(team_id uuid,user_id uuid);
   create table public.calendar_event_notification_commands(id uuid primary key default gen_random_uuid(),club_id uuid,team_id uuid,calendar_event_id uuid,match_day_id uuid,event_revision bigint,notification_type text,request_token uuid,player_ids uuid[],requested_by uuid,result jsonb,completed_at timestamptz);
   create unique index command_scope on public.calendar_event_notification_commands(requested_by,request_token,calendar_event_id,match_day_id) nulls not distinct;
   create table public.calendar_event_notification_events(id uuid primary key default gen_random_uuid(),club_id uuid,team_id uuid,calendar_event_id uuid,match_day_id uuid,notification_command_id uuid,event_revision bigint,notification_type text,event_action_type text,parent_link_id uuid,player_id uuid,recipient_email text,idempotency_key text,portal_state text,response_requirement text,status text,requested_by uuid,email_queue_id uuid,last_error text,updated_at timestamptz);
   create unique index event_recipient on public.calendar_event_notification_events(notification_command_id,lower(recipient_email)) where notification_command_id is not null;
   create table public.scheduled_email_queue(id uuid primary key default gen_random_uuid(),club_id uuid,team_id uuid,created_by uuid,created_by_email text,to_email text,subject text,status text,scheduled_at timestamptz,payload jsonb);
   create function public.can_use_plan_feature(uuid,text) returns boolean language sql as $$select true$$;
   create function public.calendar_event_notification_escape_html(text) returns text language sql as $$select $1$$;
   create function public.prepare_calendar_trial_event_invitations_internal(uuid) returns jsonb language sql as $$select '{}'::jsonb$$;
   create function public.notify_clubwide_calendar_event_parents_internal(uuid,text,uuid) returns jsonb language sql as $$select '{}'::jsonb$$;
   insert into public.users(id,club_id,role,role_rank,status,email) values('${actor}','${ids.club}','coach',30,'active','coach@example.test');
   insert into public.team_staff values('${ids.team}','${actor}');
   update public.calendar_events set event_type='general', parent_audience='all_team_parents' where id='${ids.event}';
  `)
  const base=await read('20260715131232_calendar_event_notify_command_hotfix.sql')
  let baseFunction=section(base,'create function public.notify_calendar_event_parents(','\nrevoke all on function public.notify_calendar_event_parents(')
  baseFunction=baseFunction.replace('create function public.notify_calendar_event_parents(','create function public.notify_calendar_event_parents_authoritative_scope_internal(')
  await db.exec(baseFunction)
  const actionable=await read('20260717081923_calendar_actionable_invites_hotfix.sql')
  await db.exec(section(actionable,'create or replace function public.notify_calendar_event_parents(','\nrevoke all on function public.notify_calendar_event_parents('))
  const trials=await read('20260728103000_calendar_invites_trials_v1.sql')
  await db.exec(section(trials,'alter function public.notify_calendar_event_parents(uuid, text, uuid, uuid, uuid[])','\nrevoke all on function public.notify_calendar_event_parents(uuid, text, uuid, uuid, uuid[])\n'))
  await db.exec(await read('20261118101357_adult_player_calendar_dispatch.sql'))
  await setClaims(db,actor)
  const result=(await db.query('select public.notify_calendar_event_parents($1,$2,null,$3,$4) as value',[ids.event,'creation',token,[]])).rows[0].value
  assert.equal(result.adultQueuedCount,1)
  const saved=(await db.query('select recipient_type,player_contact_email from public.calendar_event_invites where player_id=$1',[ids.player])).rows[0]
  assert.deepEqual(saved,{recipient_type:'player',player_contact_email:'adult@example.test'})
  const job=(await db.query("select * from public.scheduled_email_queue where to_email='adult@example.test'")).rows[0]
  assert.equal(job.payload.communicationLog.metadata.source,'calendar_adult_event_notification')
  const client={from(table){const filters=[]; const q={select(){return q},eq(key,value){filters.push([key,value]);return q},async maybeSingle(){const where=filters.map(([key],index)=>`"${key}"=$${index+1}`).join(' and ');const result=await db.query(`select * from public."${table}" where ${where}`,filters.map(([,v])=>v));return {data:result.rows[0]||null,error:null}}};return q},async rpc(name,args){if(name==='read_parent_invite_branding')return {data:null}; const result=await db.query('select public.is_adult_calendar_notification_current($1,$2,$3,$4) as value',[args.player_value,args.club_value,args.team_value,args.email_value]);return {data:result.rows[0].value}}}
  assert.equal((await loadAuthoritativeCalendarNotificationContext(client,job)).sendable,true)
  await db.exec(`update public.adult_player_account_links set status='revoked' where player_id='${ids.player}'`)
  assert.equal((await db.query('select public.is_adult_calendar_notification_current($1,$2,$3,$4) as value',[ids.player,ids.club,ids.team,'adult@example.test'])).rows[0].value,false)
  assert.equal((await loadAuthoritativeCalendarNotificationContext(client,job)).sendable,false)
 }finally{await db.close()}
})
