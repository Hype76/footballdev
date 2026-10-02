import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'
import { PGlite } from '@electric-sql/pglite'
import { DEFAULT_COACH_REMINDER_POLICY } from '../src/lib/coach-reminder-policy.js'
import { normalizeCoachReminderContext } from '../netlify/functions/lib/_coach-reminder-repository.js'
import {createCoachReminderRepository} from '../netlify/functions/lib/_coach-reminder-repository.js'
import {runCoachReminderProcessor} from '../netlify/functions/lib/_coach-reminder-processor.js'
import {processCoachReminderJob} from '../netlify/functions/lib/_coach-reminder-worker.js'
import {createCoachReminderTransport} from '../netlify/functions/lib/_coach-reminder-transport.js'
import {reminderPostgrest} from './helpers/reminder-postgrest.mjs'

const id = n => `00000000-0000-4000-8000-${String(n).padStart(12,'0')}`
const club = id(1), team = id(2), otherTeam = id(3), coach = id(4), secondCoach = id(5), parent = id(6)
const options = { ...DEFAULT_COACH_REMINDER_POLICY, reminderEnabled: true, reminderAfterHours: 12 }
const migration = await readFile('supabase/migrations/20261002100424_team_coach_reminder_integration.sql','utf8')
const [sql,integrationSql] = migration.split('-- REMINDER_SOURCE_INTEGRATION')

async function setup(t) {
  const db = new PGlite(); t.after(() => db.close())
  await db.exec(`
    create schema auth; create schema app_private;
    create role anon; create role authenticated; create role service_role bypassrls;
    alter default privileges in schema public grant all on tables to anon,authenticated,service_role;
    alter default privileges in schema app_private grant all on tables to service_role;
    create table users(id uuid primary key,club_id uuid,role text,role_rank integer,status text,email text);
    create table clubs(id uuid primary key,status text);
    create table teams(id uuid primary key,club_id uuid,archived_at timestamptz);
    create table user_club_memberships(auth_user_id uuid,club_id uuid,role text,role_rank integer);
    create table team_staff(user_id uuid,team_id uuid,role_rank integer);
    create function auth.uid() returns uuid language sql stable as $$select nullif(current_setting('test.uid',true),'')::uuid$$;
    grant usage on schema auth to authenticated,anon;
    create function current_user_can_access_team(c uuid,t uuid) returns boolean language sql stable security definer as $$
      select exists(select 1 from team_staff where user_id=auth.uid() and team_id=t)
        and exists(select 1 from teams where id=t and club_id=c and archived_at is null)$$;
    create function current_user_team_role_rank(t uuid) returns integer language sql stable security definer as $$
      select role_rank from team_staff where user_id=auth.uid() and team_id=t$$;
    insert into clubs values('${club}','active');
    insert into teams values('${team}','${club}',null),('${otherTeam}','${club}',null);
    insert into users values('${coach}','${club}','coach',20,'active','coach@example.test'),('${secondCoach}','${club}','coach',20,'active','second@example.test'),('${parent}','${club}','parent_portal',0,'active','parent@example.test');
    insert into user_club_memberships select id,club_id,role,role_rank from users;
    insert into team_staff values('${coach}','${team}',20),('${secondCoach}','${team}',20),('${parent}','${team}',0);
  `)
  await db.exec(sql)
  const actor = async user => { await db.exec('reset role'); await db.query("select set_config('test.uid',$1,false)",[user]); await db.exec('set role authenticated') }
  const save = async (request, expected = 0, opts = options, optedIn = true, target = team) => (await db.query(
    'select save_team_coach_reminder_policy_v1($1,$2,$3,$4,$5,$6) result',[club,target,expected,request,JSON.stringify(opts),optedIn])).rows[0].result
  return { db, actor, save }
}

test('broad installed table defaults are replaced with append-only ledger and gate privileges', async t => {
  const { db } = await setup(t)
  for (const table of ['public.team_coach_reminder_enrolments','public.team_coach_reminder_retirements','public.team_coach_reminder_enrolment_sources','app_private.coach_reminder_authority_gate']) {
    const allowed = table.startsWith('app_private.') ? ['SELECT','UPDATE'] : ['SELECT','INSERT']
    for (const role of ['service_role','anon','authenticated']) {
      for (const privilege of ['SELECT','INSERT','UPDATE','DELETE','TRUNCATE','REFERENCES','TRIGGER','MAINTAIN']) {
        const { rows } = await db.query('select has_table_privilege($1,$2,$3) permitted',[role,table,privilege])
        assert.equal(rows[0].permitted,role === 'service_role' && allowed.includes(privilege),`${role} ${privilege} ${table}`)
      }
    }
  }
  await db.exec('set role service_role')
  for (const table of ['team_coach_reminder_enrolments','team_coach_reminder_retirements','team_coach_reminder_enrolment_sources']) {
    await assert.rejects(db.exec(`delete from public.${table}`), /permission denied/)
    await assert.rejects(db.exec(`truncate public.${table}`), /permission denied/)
    const column = table === 'team_coach_reminder_enrolments' ? 'id' : 'enrolment_id'
    await assert.rejects(db.exec(`update public.${table} set ${column}=${column}`), /permission denied/)
  }
  await db.exec('select app_private.lock_coach_reminder_authority_v1()')
  assert.equal((await db.query('select revision from app_private.coach_reminder_authority_gate')).rows[0].revision,1)
})

test('migration is inert; shared team policy requires explicit complete timing and opt-in', async t => {
  const { db, actor, save } = await setup(t)
  assert.equal((await db.query('select count(*)::int n from team_coach_reminder_policies')).rows[0].n,0)
  await actor(coach)
  await assert.rejects(save(id(100),0,{ ...options, reminderAfterHours: null }), /configuration_invalid/)
  await assert.rejects(save(id(100),0,DEFAULT_COACH_REMINDER_POLICY,true), /choose_an_option/)
  const disabled = await save(id(100),0,DEFAULT_COACH_REMINDER_POLICY,false)
  assert.equal(disabled.policy.opted_in,false); assert.equal(disabled.policy.effective_from,null)
  assert.equal(disabled.policy.options.reminderAfterHours,null)
  const enabled = await save(id(101),1)
  assert.equal(enabled.policy.revision,2); assert.equal(enabled.policy.opted_in,true)
  assert.ok(Date.parse(enabled.policy.effective_from)); assert.equal(enabled.policy.effective_from,enabled.policy.configured_at)
  await actor(secondCoach)
  assert.equal((await db.query('select revision from team_coach_reminder_policies')).rows[0].revision,2)
  const updated = await save(id(102),2,{ ...options, reminderAfterHours:24 })
  assert.equal(updated.policy.team_id,team); assert.equal(updated.policy.revision,3)
  assert.equal((await db.query('select count(*)::int n from team_coach_reminder_policies')).rows[0].n,1)
})

test('stale simultaneous edits conflict; repeated/retried saves do not bump version or activation', async t => {
  const { actor, save } = await setup(t)
  await actor(coach)
  const first = await save(id(100))
  const replay = await save(id(100))
  assert.equal(replay.duplicate,true); assert.equal(replay.policy.revision,1)
  assert.equal(replay.policy.effective_from,first.policy.effective_from)
  await assert.rejects(save(id(100),0,{ ...options, reminderAfterHours:24 }),/request_key_conflict/)
  await actor(secondCoach)
  await assert.rejects(save(id(101)),/policy_changed/)
  const second = await save(id(101),1,{ ...options, reminderAfterHours:24 })
  await actor(coach)
  const afterOtherCoach = await save(id(100))
  assert.equal(afterOtherCoach.duplicate,true); assert.equal(afterOtherCoach.savedRevision,1)
  assert.equal(afterOtherCoach.policy.revision,2); assert.equal(afterOtherCoach.policy.options.reminderAfterHours,24)
  assert.equal(afterOtherCoach.policy.effective_from,second.policy.effective_from)
  await assert.rejects(save(id(101),1,{ ...options, reminderAfterHours:24 }),/request_key_conflict/)
})

test('RLS and RPCs deny Parent, cross-team, inactive and removed membership; direct writes and command reads are blocked', async t => {
  const { db, actor, save } = await setup(t)
  await actor(coach); await save(id(100))
  await assert.rejects(db.query('update team_coach_reminder_policies set opted_in=false'),/permission denied/)
  await assert.rejects(db.query('select * from team_coach_reminder_policy_commands'),/permission denied/)
  await assert.rejects(save(id(101),0,options,true,otherTeam),/not_authorized/)
  await actor(parent)
  assert.equal((await db.query('select * from team_coach_reminder_policies')).rows.length,0)
  await assert.rejects(save(id(102)),/not_authorized/)
  await actor(coach); await db.exec('reset role'); await db.query('delete from user_club_memberships where auth_user_id=$1',[coach]); await db.exec('set role authenticated')
  assert.equal((await db.query('select * from team_coach_reminder_policies')).rows.length,0)
  await assert.rejects(save(id(100)),/not_authorized/,'Old successful request cannot bypass removed access')
  await db.exec('reset role'); await db.exec('set role anon')
  await assert.rejects(db.query('select * from team_coach_reminder_policies'),/permission denied/)
  await assert.rejects(save(id(103)),/permission denied/)
})

test('database independently validates all modes, timings, option keys, opt-out and archived teams', async t => {
  const { db, actor, save } = await setup(t)
  await actor(coach)
  for (const opts of [{ ...options, reminderAfterHours:12.5 },{ ...options, reminderEnabled:'true' },
    { ...options, injected:true }, { ...options, deadlineMode:'unknown' },
    { ...options, squadReminderEnabled:true, squadDaysBefore:null },
    { ...options, deadlineMode:'automatic_not_attending',deadlineAfterHours:12 }]) {
    await assert.rejects(save(id(100),0,opts),/configuration_invalid/)
  }
  const first = await save(id(100),0,{ ...options, deadlineMode:'automatic_not_attending',deadlineAfterHours:48 })
  const disabled = await save(id(101),first.policy.revision,first.policy.options,false)
  assert.equal(disabled.policy.opted_in,false); assert.equal(disabled.policy.effective_from,null)
  await db.exec('reset role'); await db.query('update teams set archived_at=now() where id=$1',[team]); await db.exec('set role authenticated')
  await assert.rejects(save(id(102),2),/not_authorized/)
})

test('actual context RPC and atomic commit reject changed replies; release gate, replay and interrupted delivery fail closed', async t => {
  const { db,actor,save }=await setup(t)
  await actor(coach); await save(id(100))
  await db.exec('reset role')
  const event=id(30),player=id(31),invite=id(32),enrolment=id(33)
  await db.exec(`
    create table match_days(id uuid,club_id uuid,team_id uuid,status text,deleted_at timestamptz,match_date date,kickoff_time time,kickoff_time_tbc boolean,created_at timestamptz,parent_visible boolean,parent_audience text);
    create table calendar_event_invites(id uuid,club_id uuid,team_id uuid,player_id uuid,match_day_id uuid,calendar_event_id uuid,invited_at timestamptz,invite_status text,cancelled_at timestamptz);
    create table players(id uuid,club_id uuid,status text);
    create table player_team_memberships(player_id uuid,club_id uuid,team_id uuid,status text,ended_at timestamptz);
    create table match_day_player_availability(id uuid,match_day_id uuid,club_id uuid,player_id uuid,status text,selected_at timestamptz,updated_at timestamptz,selected_by_parent_link_id uuid);
    create table match_day_availability_requests(id uuid,match_day_id uuid,player_id uuid,club_id uuid,team_id uuid,recipient_email text,sent_at timestamptz,created_at timestamptz,token_revoked_at timestamptz,status text);
    create table match_day_player_squad_decisions(match_day_id uuid,club_id uuid,team_id uuid,status text);
    create table mobile_notification_preferences(auth_user_id uuid,app text,invites boolean);
    create function event_player_eligible_recipients(club_id_value uuid,team_id_value uuid,player_ids_value uuid[])
      returns table(recipient_type text,parent_link_id uuid) language sql as $$select 'parent'::text,'${id(36)}'::uuid$$;
    update team_coach_reminder_policies set effective_from='2026-10-01',configured_at='2026-10-01';
    insert into match_days values('${event}','${club}','${team}','scheduled',null,'2026-10-10','13:00',false,'2026-10-01T01:00Z',true,'involved_players');
    insert into calendar_event_invites values('${invite}','${club}','${team}','${player}','${event}',null,'2026-10-01T01:00Z','invited',null);
    insert into players values('${player}','${club}','active');
    insert into player_team_memberships values('${player}','${club}','${team}','active',null);
    insert into match_day_player_availability values('${id(34)}','${event}','${club}','${player}','pending',null,'2026-10-01T01:00Z',null);
    insert into match_day_availability_requests values('${id(35)}','${event}','${player}','${club}','${team}','parent@example.test','2026-10-01T02:00Z','2026-10-01T01:00Z',null,'pending');
    insert into team_coach_reminder_enrolments(id,club_id,team_id,policy_id,policy_revision,kind,event_id,player_id,invitation_id,request_id,source_created_at,first_delivered_at)
      select '${enrolment}',club_id,team_id,id,revision,'MATCH','${event}','${player}','${invite}','${id(35)}','2026-10-01T01:00Z','2026-10-01T02:00Z' from team_coach_reminder_policies;
    insert into team_coach_reminder_enrolment_sources values('${enrolment}','${id(35)}');
  `)
  const job={ key:'job',kind:'MATCH',eventId:event,enrolmentId:enrolment,clubId:club,teamId:team,action:'availability_reminder',playerId:player }
  const context=async()=>(await db.query('select team_coach_reminder_context_v1($1) value',[JSON.stringify(job)])).rows[0].value
  const off=await context()
  assert.equal(off.authorityActive,false)
  await db.query('insert into team_coach_reminder_jobs(job_key,club_id,team_id,payload) values($1,$2,$3,$4)',[job.key,club,team,JSON.stringify(job)])
  const notification={ jobKey:job.key,idempotencyKey:'delivery',recipientId:parent }
  const commit=async snapshot=>(await db.query('select commit_team_coach_reminder_job_v1($1,$2,null,$3,$4,$5) value',[job.key,JSON.stringify(snapshot),JSON.stringify([notification]),'completed','unanswered'])).rows[0].value
  assert.equal((await commit(off)).reason,'release_disabled')
  assert.equal((await db.query("select claim_team_coach_reminder_notification_v1('delivery') value")).rows[0].value,null)
  await db.exec("update team_coach_reminder_release_control set enabled=true,activated_at='2026-10-01'")
  const before=await context(),normalized=normalizeCoachReminderContext(before,job)
  assert.equal(normalized.event.startsAt,'2026-10-10T12:00:00.000Z')
  assert.equal(normalized.invitation.memberActive,true)
  assert.equal(normalized.invitation.responseStatus,'pending')
  assert.equal(before.coaches.length,2)
  await db.exec("update match_day_player_availability set status='available',updated_at='2026-10-02'")
  assert.equal((await commit(before)).reason,'context_changed')
  assert.equal((await db.query('select count(*)::int n from team_coach_reminder_outbox')).rows[0].n,0)
  // A fresh worker decision would skip this answer; commit only tests CAS here.
  await db.exec("update match_day_player_availability set status='pending'")
  const fresh=await context()
  assert.equal((await commit(fresh)).committed,true)
  assert.equal((await commit(fresh)).duplicate,true)
  assert.equal((await db.query('select count(*)::int n from team_coach_reminder_outbox')).rows[0].n,1)
  const claim=async()=>(await db.query("select claim_team_coach_reminder_notification_v1('delivery') value")).rows[0].value
  assert.ok((await claim()).lease_token)
  assert.equal(await claim(),null)
  await db.exec("update team_coach_reminder_outbox set lease_until=clock_timestamp()-interval '1 second'")
  assert.equal(await claim(),null)
  assert.equal((await db.query('select state,reason from team_coach_reminder_outbox')).rows[0].state,'held')
  await db.exec("insert into match_day_player_squad_decisions values('"+event+"','"+club+"','"+team+"','selected')")
  assert.equal((await context()).squadSelected,true)
  await db.exec('delete from player_team_memberships')
  assert.equal(normalizeCoachReminderContext(await context(),job).invitation.memberActive,false)
  await actor(parent)
  await assert.rejects(context(),/permission denied/)
})

test('integrated delivery capture, discovery, worker, channel transport, provenance and server planning guards',async t=>{
  const {db,actor,save}=await setup(t)
  await actor(coach);await save(id(200),0,{...options,reminderAfterHours:1,deadlineMode:'automatic_not_attending',deadlineAfterHours:2,squadReminderEnabled:true,squadDaysBefore:1})
  await db.exec('reset role')
  const event=id(30),player=id(31),invite=id(32),request=id(33),link=id(34),training=id(40),trainingRequest=id(41)
  await db.exec(`
    create table match_days(id uuid primary key,club_id uuid,team_id uuid,status text,deleted_at timestamptz,match_date date,kickoff_time time,kickoff_time_tbc boolean,created_at timestamptz,parent_visible boolean default true,parent_audience text default 'involved_players');
    create table calendar_events(id uuid primary key,club_id uuid,team_id uuid,event_type text,cancelled_at timestamptz,starts_at timestamptz,ends_at timestamptz,recurrence_frequency text,recurrence_until date,deleted_occurrence_dates jsonb,created_at timestamptz,parent_visible boolean default true,parent_audience text default 'involved_players');
    create table calendar_event_invites(id uuid,club_id uuid,team_id uuid,player_id uuid,match_day_id uuid,calendar_event_id uuid,invited_at timestamptz,invite_status text,cancelled_at timestamptz);
    create table players(id uuid primary key,club_id uuid,status text);
    create table player_team_memberships(player_id uuid,club_id uuid,team_id uuid,status text,ended_at timestamptz);
    create table match_day_player_availability(id uuid,match_day_id uuid,club_id uuid,player_id uuid,status text,selected_at timestamptz,updated_at timestamptz,selected_by_parent_link_id uuid);
    create table match_day_availability_requests(id uuid,match_day_id uuid,player_id uuid,club_id uuid,team_id uuid,recipient_email text,sent_at timestamptz,created_at timestamptz,token_revoked_at timestamptz,status text);
    create table training_availability_requests(id uuid,club_id uuid,team_id uuid,calendar_event_id uuid,occurrence_date date,occurrence_starts_at timestamptz,status text);
    create table training_availability_request_players(id uuid,request_id uuid,club_id uuid,team_id uuid,player_id uuid,recipient_email text,email_sent_at timestamptz,created_at timestamptz,token_revoked_at timestamptz,status text);
    create table training_availability_responses(id uuid,request_id uuid,club_id uuid,player_id uuid,status text,responded_at timestamptz,updated_at timestamptz,response_source text);
    create table event_player_occurrence_exclusions(calendar_event_id uuid,player_id uuid,scope text,effective_from_date date);
    create table match_day_player_squad_decisions(match_day_id uuid,club_id uuid,team_id uuid,player_id uuid,status text);
    create table mobile_notification_preferences(auth_user_id uuid,app text,invites boolean);
    create table parent_player_links(id uuid primary key,auth_user_id uuid,player_id uuid,club_id uuid,status text);
    create table parent_communication_preferences(auth_user_id uuid,communication_channel text);
    create table coach_mobile_notification_events(id bigint generated always as identity,auth_user_id uuid,user_profile_id uuid,club_id uuid,team_id uuid,intent_type text,title text,body text,data jsonb,status text,sent_at timestamptz);
    create table parent_mobile_push_installations(auth_user_id uuid,expo_push_token text,status text,enabled boolean,detail_level text);
    create table coach_mobile_push_installations(auth_user_id uuid,club_id uuid,expo_push_token text,status text,enabled boolean,detail_level text);
    create table formation_boards(id uuid primary key,club_id uuid,team_id uuid,linked_match_day_id uuid,current_version_id uuid);
    create table formation_board_versions(id uuid primary key,board_id uuid,club_id uuid,team_id uuid,placements jsonb,bench jsonb);
    create table formation_board_match_publications(id uuid primary key,board_id uuid,board_version_id uuid,club_id uuid,team_id uuid,match_day_id uuid);
    create table adult_fixture_links(user_id uuid,player_id uuid,club_id uuid,team_id uuid,active boolean);
    create function get_own_adult_player_account_state() returns table(player_id uuid,club_id uuid,team_id uuid,access_granted boolean) language sql as $$select player_id,club_id,team_id,active from adult_fixture_links where user_id=auth.uid()$$;
    create function get_own_adult_player_invitation_state() returns table(event_id uuid,invitation_type text,event_start timestamptz) language sql as $$select i.match_day_id,'match_attendance',null::timestamptz from calendar_event_invites i join adult_fixture_links l on l.player_id=i.player_id and l.user_id=auth.uid() and l.active where i.match_day_id is not null$$;
    create function current_user_can_access_parent_link(l uuid,p uuid) returns boolean language sql as $$select exists(select 1 from parent_player_links where id=l and player_id=p and auth_user_id=auth.uid() and status='active')$$;
    create function get_parent_portal_invitation_summary(l uuid) returns table(event_id uuid,child_id uuid,source_event_type text,invitation_type text,event_start timestamptz) language sql as $$
      select coalesce(i.match_day_id,i.calendar_event_id),i.player_id,case when i.match_day_id is not null then 'match_day' else 'calendar_event' end,
        case when i.match_day_id is not null then 'match_attendance' else 'training_attendance' end,request.occurrence_starts_at
      from calendar_event_invites i join parent_player_links link on link.id=l and link.player_id=i.player_id and link.auth_user_id=auth.uid()
      left join training_availability_requests request on request.calendar_event_id=i.calendar_event_id
      where i.cancelled_at is null and i.invite_status<>'cancelled'$$;
    create function event_player_eligible_recipients(club_id_value uuid,player_ids_value uuid[],team_id_value uuid) returns table(player_id uuid,parent_link_id uuid,recipient_email text,recipient_type text) language sql as $$
      select player_id,id,'parent@example.test','parent_guardian'
      from parent_player_links where club_id=club_id_value and player_id=any(player_ids_value) and status='active'$$;
    insert into players values('${player}','${club}','active');
    insert into player_team_memberships values('${player}','${club}','${team}','active',null);
    insert into parent_player_links values('${link}','${parent}','${player}','${club}','active');
    insert into parent_communication_preferences values('${parent}','both');
    insert into mobile_notification_preferences values('${parent}','parent',true),('${coach}','coach',true),('${secondCoach}','coach',true);
    insert into match_days values('${event}','${club}','${team}','scheduled',null,(clock_timestamp()+interval '3 days')::date,'13:00',false,clock_timestamp(),true,'involved_players');
    insert into calendar_event_invites values('${invite}','${club}','${team}','${player}','${event}',null,clock_timestamp(),'invited',null);
    insert into match_day_player_availability values('${id(35)}','${event}','${club}','${player}','pending',null,clock_timestamp(),null);
  `)
  await db.exec(`alter table players add column archived_at timestamptz,add column contact_type text,add column parent_email text,add column parent_contacts jsonb;
    alter table parent_player_links add column team_id uuid default '${team}',add column email text default 'parent@example.test';
    create table adult_player_account_links(user_id uuid,status text,verified_at timestamptz,revoked_at timestamptz,club_id uuid,team_id uuid,player_id uuid);
    create table auth.users(id uuid,email text,email_confirmed_at timestamptz,banned_until timestamptz,deleted_at timestamptz);`)
  await db.exec(integrationSql)
  assert.equal((await db.query('select next_team_coach_reminder_processor_phase_v1() value')).rows[0].value,0)
  assert.equal((await db.query('select processor_phase from team_coach_reminder_scan_cursor')).rows[0].processor_phase,0)
  // An already-existing delivery is never backfilled by migration/activation.
  await db.exec(`insert into match_day_availability_requests values('${request}','${event}','${player}','${club}','${team}','parent@example.test',clock_timestamp(),clock_timestamp()-interval '1 day',null,'pending')`)
  assert.equal((await db.query('select count(*)::int n from team_coach_reminder_enrolments')).rows[0].n,0)
  await db.exec("update team_coach_reminder_policies set configured_at=clock_timestamp()-interval '5 hours',effective_from=clock_timestamp()-interval '5 hours'; update team_coach_reminder_release_control set enabled=true,activated_at=clock_timestamp()-interval '5 hours'")
  await db.exec('grant select on all tables in schema public to service_role; set role service_role')
  const phases=await Promise.all(Array.from({length:4},()=>db.query('select next_team_coach_reminder_processor_phase_v1() value')))
  assert.deepEqual(phases.map(result=>result.rows[0].value),[0,1,2,0])
  await db.exec('reset role; update team_coach_reminder_scan_cursor set processor_phase=0')
  await actor(parent)
  await assert.rejects(db.query('select next_team_coach_reminder_processor_phase_v1()'),/permission denied/)
  await db.exec('reset role')
  await db.exec(`update match_day_availability_requests set sent_at=clock_timestamp() where id='${request}'`)
  assert.equal((await db.query('select count(*)::int n from team_coach_reminder_enrolments')).rows[0].n,0)
  await db.exec(`insert into match_day_availability_requests values('${id(36)}','${event}','${player}','${club}','${team}','parent@example.test',clock_timestamp()-interval '3 hours',clock_timestamp()-interval '4 hours',null,'pending')`)
  const enrolment=(await db.query('select * from team_coach_reminder_enrolments')).rows[0]
  await db.exec(`update match_day_availability_requests set sent_at=clock_timestamp() where id='${id(36)}'`)
  assert.equal((await db.query('select first_delivered_at from team_coach_reminder_enrolments')).rows[0].first_delivered_at.toISOString(),enrolment.first_delivered_at.toISOString())
  const client=reminderPostgrest(db),repository=createCoachReminderRepository(client),sends=[]
  const transport=createCoachReminderTransport({client,assertPlan:async()=>{},email:async(payload,opts)=>{sends.push({payload,opts});return {data:{id:'fixture-provider'}}},
    inbox:async args=>{sends.push({inbox:args});return {available:1,inserted:1}},push:async()=>{throw Error('Fixture has no devices; no push call is allowed')}})
  await db.exec('set role service_role')
  const result=await runCoachReminderProcessor({repository,transport})
  await db.exec('reset role')
  assert.equal(result.held,0);assert.equal(result.delivered,1)
  assert.equal(sends.length,2);assert.match(sends[0].inbox.body,/automatically marked/)
  assert.equal(sends[1].payload.emailAppRole,'parent');assert.match(sends[1].opts.idempotencyKey,/coach-reminder:/)
  const rerun=await runCoachReminderProcessor({repository,transport})
  assert.equal(rerun.delivered,0);assert.equal(sends.length,2)
  assert.equal((await db.query('select status from match_day_player_availability')).rows[0].status,'pending')
  const projected=(await db.query('select app_private.coach_reminder_projection_v1($1) value',[enrolment.id])).rows[0].value
  assert.equal(projected.automatic,true);assert.equal(projected.provenance,'coach_deadline_automation')
  await db.exec("update match_days set kickoff_time='14:00'")
  const rescheduled=(await db.query('select app_private.coach_reminder_projection_v1($1) value',[enrolment.id])).rows[0].value
  assert.equal(rescheduled.automatic,false);assert.equal(rescheduled.planningExcluded,true)
  await runCoachReminderProcessor({repository,transport});await runCoachReminderProcessor({repository,transport})
  assert.equal(sends.length,2,'Rescheduling cannot send the accepted logical deadline notification twice')
  await assert.rejects(db.exec(`insert into match_day_player_squad_decisions values('${event}','${club}','${team}','${player}','selected')`),/Attending response/)
  await db.exec(`insert into formation_boards values('${id(60)}','${club}','${team}','${event}',null)`)
  await assert.rejects(db.query('insert into formation_board_versions values($1,$2,$3,$4,$5,$6)',[id(61),id(60),club,team,JSON.stringify([{playerId:player}]),'[]']),/Attending response/)
  // A generic saved version created earlier cannot bypass the guard by publication.
  await db.exec(`insert into formation_boards values('${id(62)}','${club}','${team}',null,null)`)
  await db.query('insert into formation_board_versions values($1,$2,$3,$4,$5,$6)',[id(63),id(62),club,team,JSON.stringify([{playerId:player}]),'[]'])
  await assert.rejects(db.query('insert into formation_board_match_publications values($1,$2,$3,$4,$5,$6)',[id(64),id(62),id(63),club,team,event]),/Attending response/)
  await actor(parent)
  const parentView=(await db.query('select get_team_coach_reminder_projections_v1($1,$2,$3) value',['MATCH',[event],link])).rows[0].value
  assert.equal(parentView.length,1);assert.equal(parentView[0].automatic,true);assert.equal(parentView[0].sourceContext,undefined)
  await db.exec('reset role')
  await db.exec(`insert into adult_fixture_links values('${id(80)}','${player}','${club}','${team}',true)`)
  await actor(id(80))
  assert.equal((await db.query('select get_team_coach_reminder_projections_v1($1,$2) value',['MATCH',[event]])).rows[0].value.length,1)
  assert.deepEqual((await db.query('select get_team_coach_reminder_projections_v1($1,$2,$3) value',['MATCH',[event],link])).rows[0].value,[])
  await db.exec('reset role');await db.exec('update adult_fixture_links set active=false')
  await db.exec("update match_day_player_availability set status='maybe',updated_at=clock_timestamp()")
  const maybe=(await db.query('select app_private.coach_reminder_projection_v1($1) value',[enrolment.id])).rows[0].value
  assert.equal(maybe.status,'maybe');assert.equal(maybe.automatic,false);assert.equal(maybe.planningExcluded,true)
  await db.exec("update match_day_player_availability set status='available',updated_at=clock_timestamp()")
  assert.equal((await db.query('select app_private.coach_reminder_projection_v1($1) value',[enrolment.id])).rows[0].value,null)
  await db.exec(`insert into match_day_player_squad_decisions values('${event}','${club}','${team}','${player}','selected')`)
  await db.query('insert into formation_board_versions values($1,$2,$3,$4,$5,$6)',[id(61),id(60),club,team,JSON.stringify([{playerId:player}]),'[]'])
  await db.query('insert into formation_board_match_publications values($1,$2,$3,$4,$5,$6)',[id(64),id(62),id(63),club,team,event])
  // Each currently authorised team Coach gets one durable squad reminder.
  await db.exec(`insert into match_days values('${id(70)}','${club}','${team}','scheduled',null,((clock_timestamp() at time zone 'Europe/London')+interval '1 day')::date,date_trunc('minute',(clock_timestamp() at time zone 'Europe/London')-interval '1 hour')::time,false,clock_timestamp(),true,'involved_players')`)
  await runCoachReminderProcessor({repository,transport});await runCoachReminderProcessor({repository,transport});await runCoachReminderProcessor({repository,transport})
  assert.equal((await db.query('select count(*)::int n from coach_mobile_notification_events')).rows[0].n,2)
  // New training occurrence delivery enrols independently of the match.
  await db.exec(`insert into calendar_events values('${training}','${club}','${team}','training',null,clock_timestamp()+interval '3 days',clock_timestamp()+interval '3 days 1 hour','none',null,'[]',clock_timestamp(),true,'involved_players');
    insert into calendar_event_invites values('${id(42)}','${club}','${team}','${player}',null,'${training}',clock_timestamp(),'invited',null);
    insert into training_availability_requests values('${trainingRequest}','${club}','${team}','${training}',(clock_timestamp()+interval '3 days')::date,clock_timestamp()+interval '3 days','sent');
    insert into training_availability_request_players values('${id(43)}','${trainingRequest}','${club}','${team}','${player}','parent@example.test',clock_timestamp()-interval '3 hours',clock_timestamp()-interval '4 hours',null,'sent')`)
  const trainingEnrolment=(await db.query("select * from team_coach_reminder_enrolments where kind='TRAINING'")).rows[0]
  assert.ok(trainingEnrolment)
  await runCoachReminderProcessor({repository,transport});await runCoachReminderProcessor({repository,transport})
  assert.equal((await db.query("select count(*)::int n from team_coach_reminder_effects where payload->>'eventId'=$1",[training])).rows[0].n,1)
  await t.test('Parent training projection uses canonical calendar_event source and the authorised occurrence',async()=>{
    await actor(parent)
    const read=async()=>(await db.query('select get_team_coach_reminder_projections_v1($1,$2,$3) value',['TRAINING',[training],link])).rows[0].value
    assert.equal((await read()).length,1);assert.equal((await read())[0].automatic,true)
    await db.exec('reset role')
    await db.query("update training_availability_requests set occurrence_starts_at=occurrence_starts_at+interval '1 day' where id=$1",[trainingRequest])
    await actor(parent);assert.deepEqual(await read(),[],'An invitation for a different occurrence cannot authorise this projection')
    await db.exec('reset role')
    await db.query("update training_availability_requests set occurrence_starts_at=occurrence_starts_at-interval '1 day' where id=$1",[trainingRequest])
  })
  await db.exec(`update training_availability_requests set status='cancelled' where id='${trainingRequest}'`)
  assert.equal((await db.query('select app_private.coach_reminder_projection_v1($1) value',[trainingEnrolment.id])).rows[0].value,null)
  // Existing training generation rolls a 31 January monthly event to 3 March.
  // Database planning and worker projections must agree on that occurrence.
  await db.exec(`insert into calendar_events values('${id(90)}','${club}','${team}','training',null,'2099-01-31T13:00:00Z','2099-01-31T14:00:00Z','monthly','2099-05-03','[]',clock_timestamp(),true,'involved_players');
    insert into calendar_event_invites values('${id(91)}','${club}','${team}','${player}',null,'${id(90)}',clock_timestamp(),'invited',null);
    insert into training_availability_requests values('${id(92)}','${club}','${team}','${id(90)}','2099-03-03','2099-03-03T13:00:00Z','sent');
    insert into training_availability_request_players values('${id(93)}','${id(92)}','${club}','${team}','${player}','parent@example.test',clock_timestamp()-interval '3 hours',clock_timestamp()-interval '4 hours',null,'sent')`)
  const monthly=(await db.query('select * from team_coach_reminder_enrolments where event_id=$1',[id(90)])).rows[0]
  assert.equal((await db.query('select app_private.coach_reminder_planning_excluded_v1($1) value',[monthly.id])).rows[0].value,true)
  await runCoachReminderProcessor({repository,transport});await runCoachReminderProcessor({repository,transport});await runCoachReminderProcessor({repository,transport})
  assert.equal((await db.query('select app_private.coach_reminder_projection_v1($1) value',[monthly.id])).rows[0].value.automatic,true)
  await t.test('revoking every delivered training source suppresses planning, effects and queued delivery',async()=>{
    const candidate={kind:'TRAINING',clubId:club,teamId:team,playerId:player,eventId:id(90),enrolmentId:monthly.id,occurrenceDate:'2099-03-03'}
    const queued=(await db.query("select outbox.payload from team_coach_reminder_outbox outbox join team_coach_reminder_jobs job on job.job_key=outbox.job_key where job.payload->>'enrolmentId'=$1 limit 1",[monthly.id])).rows[0].payload
    for(const change of ["token_revoked_at=clock_timestamp()","status='cancelled'","status='expired'",`team_id='${otherTeam}'`,`club_id='${id(99)}'`]){
      await db.exec(`update training_availability_request_players set ${change} where id='${id(93)}'`)
      const context=(await db.query('select team_coach_reminder_context_v1($1) value',[JSON.stringify(candidate)])).rows[0].value
      assert.equal(context.memberActive,false,change)
      assert.equal((await db.query('select app_private.coach_reminder_planning_excluded_v1($1) value',[monthly.id])).rows[0].value,false)
      assert.equal((await db.query('select app_private.coach_reminder_projection_v1($1) value',[monthly.id])).rows[0].value,null)
      assert.deepEqual(await repository.planCandidate(candidate,new Date().toISOString()),[])
      assert.equal((await repository.validateNotification({notification:queued},new Date().toISOString())).valid,false)
      await db.exec(`update training_availability_request_players set token_revoked_at=null,status='sent',team_id='${team}',club_id='${club}' where id='${id(93)}'`)
    }
    await db.exec(`delete from training_availability_request_players where id='${id(93)}'`)
    assert.equal((await repository.loadContext(candidate)).invitation.memberActive,false)
    assert.equal((await db.query('select app_private.coach_reminder_projection_v1($1) value',[monthly.id])).rows[0].value,null)
    await db.exec(`insert into training_availability_request_players values('${id(93)}','${id(92)}','${club}','${team}','${player}','parent@example.test',clock_timestamp()-interval '3 hours',clock_timestamp()-interval '4 hours',null,'sent')`)
    // One remaining authorised delivered source keeps this shared invitation valid.
    await db.exec(`
      create or replace function event_player_eligible_recipients(club_id_value uuid,player_ids_value uuid[],team_id_value uuid) returns table(player_id uuid,parent_link_id uuid,recipient_email text,recipient_type text) language sql as $$
        select player_id,id,email,'parent_guardian'
        from parent_player_links where club_id=club_id_value and player_id=any(player_ids_value) and status='active'
        union all select player_id,null::uuid,'adult@example.test','player'
        from adult_fixture_links where club_id=club_id_value and team_id=team_id_value and player_id=any(player_ids_value) and active$$;
      insert into parent_player_links(id,auth_user_id,player_id,club_id,status,email) values('${id(97)}','${id(98)}','${player}','${club}','active','second-parent@example.test');
      insert into training_availability_request_players values('${id(94)}','${id(92)}','${club}','${team}','${player}','second-parent@example.test',clock_timestamp()-interval '3 hours',clock_timestamp()-interval '4 hours',null,'sent');
      update training_availability_request_players set token_revoked_at=clock_timestamp() where id='${id(93)}'`)
    const remainingParent=await repository.loadContext(candidate)
    assert.equal(remainingParent.invitation.memberActive,true)
    assert.deepEqual(remainingParent.recipients.map(recipient=>recipient.parentLinkId),[id(97)])
    assert.equal((await db.query('select app_private.coach_reminder_projection_v1($1) value',[monthly.id])).rows[0].value.automatic,true)
    await db.exec(`update training_availability_request_players set status='cancelled' where id='${id(94)}'`)
    assert.equal((await repository.loadContext(candidate)).invitation.memberActive,false)
    await db.exec(`delete from training_availability_request_players where id='${id(94)}'; update training_availability_request_players set token_revoked_at=null where id='${id(93)}'`)
    // Revocation after jobs are stored must stop effects and messages at commit.
    await db.exec(`insert into training_availability_requests values('${id(95)}','${club}','${team}','${id(90)}','2099-04-03','2099-04-03T13:00:00Z','sent');
      insert into training_availability_request_players values('${id(96)}','${id(95)}','${club}','${team}','${player}','parent@example.test',clock_timestamp()-interval '3 hours',clock_timestamp()-interval '4 hours',null,'sent')`)
    const pending=(await db.query('select * from team_coach_reminder_enrolments where request_id=$1',[id(95)])).rows[0]
    const pendingCandidate={kind:'TRAINING',clubId:club,teamId:team,playerId:player,eventId:id(90),enrolmentId:pending.id,occurrenceDate:'2099-04-03'}
    const jobs=await repository.planCandidate(pendingCandidate,new Date().toISOString())
    assert.equal(jobs.length,2);await repository.storeJobs(jobs)
    const beforeRevocation=(await db.query('select team_coach_reminder_context_v1($1) value',[JSON.stringify(jobs[0])])).rows[0].value
    await db.exec(`update training_availability_request_players set token_revoked_at=clock_timestamp() where id='${id(96)}'`)
    const racedCommit=(await db.query("select commit_team_coach_reminder_job_v1($1,$2,null,'[]'::jsonb,'completed','unanswered') value",[jobs[0].key,JSON.stringify(beforeRevocation)])).rows[0].value
    assert.equal(racedCommit.committed,false);assert.equal(racedCommit.reason,'context_changed')
    for(const job of jobs)assert.equal((await processCoachReminderJob({repository,jobKey:job.key,now:new Date().toISOString()})).state,'skipped')
    const keys=jobs.map(job=>job.key)
    assert.equal((await db.query('select count(*)::int n from team_coach_reminder_effects where job_key=any($1::text[])',[keys])).rows[0].n,0)
    assert.equal((await db.query('select count(*)::int n from team_coach_reminder_outbox where job_key=any($1::text[])',[keys])).rows[0].n,0)
    assert.equal((await db.query('select app_private.coach_reminder_planning_excluded_v1($1) value',[pending.id])).rows[0].value,false)
  })
  await t.test('last linked Parent disables TRAINING history and queued MATCH deadlines without changing manual answers',async()=>{
    const project=async enrol=>(await db.query('select app_private.coach_reminder_projection_v1($1) value',[enrol])).rows[0].value
    const planning=async enrol=>(await db.query('select app_private.coach_reminder_planning_excluded_v1($1) value',[enrol])).rows[0].value
    assert.equal((await project(monthly.id)).automatic,true)
    await db.exec(`update parent_player_links set status='revoked' where id='${link}'`)
    assert.equal((await project(monthly.id)).automatic,true,'A second eligible linked Parent preserves automatic provenance')
    await db.exec(`update parent_communication_preferences set communication_channel='email_only';
      insert into mobile_notification_preferences values('${id(98)}','parent',false)`)
    assert.equal((await project(monthly.id)).automatic,true,'Channel/category opt-out does not revoke Parent authority')
    const newMatch=id(110),newRequest=id(111)
    await db.exec(`insert into match_days values('${newMatch}','${club}','${team}','scheduled',null,((clock_timestamp() at time zone 'Europe/London')+interval '3 days')::date,'13:00',false,clock_timestamp(),true,'involved_players');
      insert into calendar_event_invites values('${id(112)}','${club}','${team}','${player}','${newMatch}',null,clock_timestamp(),'invited',null);
      insert into match_day_availability_requests values('${newRequest}','${newMatch}','${player}','${club}','${team}','second-parent@example.test',clock_timestamp()-interval '3 hours',clock_timestamp()-interval '4 hours',null,'pending')`)
    const enrol=(await db.query('select * from team_coach_reminder_enrolments where event_id=$1',[newMatch])).rows[0]
    const candidate={kind:'MATCH',clubId:club,teamId:team,eventId:newMatch,playerId:player,enrolmentId:enrol.id}
    const jobs=await repository.planCandidate(candidate,new Date().toISOString());await repository.storeJobs(jobs)
    const deadline=jobs.find(job=>job.action==='availability_deadline')
    const before=(await db.query('select team_coach_reminder_context_v1($1) value',[JSON.stringify(deadline)])).rows[0].value
    await db.exec(`update parent_player_links set status='revoked'`)
    const cas=(await db.query("select commit_team_coach_reminder_job_v1($1,$2,null,'[]'::jsonb,'completed','unanswered') value",[deadline.key,JSON.stringify(before)])).rows[0].value
    assert.equal(cas.committed,false);assert.equal(cas.reason,'context_changed')
    assert.equal((await processCoachReminderJob({repository,jobKey:deadline.key,now:new Date().toISOString()})).reason,'deadline_retired')
    assert.equal((await db.query('select count(*)::int n from team_coach_reminder_effects where job_key=$1',[deadline.key])).rows[0].n,0)
    assert.equal(await project(monthly.id),null);assert.equal(await planning(monthly.id),false)
    assert.equal(await project(enrol.id),null);assert.equal(await planning(enrol.id),false)
    await db.exec(`update adult_fixture_links set active=true where user_id='${id(80)}'`)
    const adultContext=await repository.loadContext(candidate)
    assert.equal(adultContext.invitation.parentResponderActive,false)
    assert.equal(adultContext.invitation.adultResponderActive,true,'Verified adult authority is distinct from an absent Parent')
    assert.equal(await project(monthly.id),null,'New adult eligibility cannot revive a previously retired window')
    await db.exec('update adult_fixture_links set active=false')
    assert.equal(await project(monthly.id),null)
    const oldSends=sends.length
    await runCoachReminderProcessor({repository,transport});await runCoachReminderProcessor({repository,transport});await runCoachReminderProcessor({repository,transport})
    assert.equal(sends.length,oldSends,'Previously queued effects cannot send after all links are revoked')
    await db.exec(`insert into match_day_player_availability values('${id(113)}','${newMatch}','${club}','${player}','available',clock_timestamp(),clock_timestamp(),null);
      insert into match_day_player_squad_decisions values('${newMatch}','${club}','${team}','${player}','selected')`)
    assert.equal((await db.query('select status from match_day_player_availability where match_day_id=$1',[newMatch])).rows[0].status,'available')
    assert.equal(await planning(enrol.id),false,'A manual Coach answer and squad selection remain valid')
  })
  await db.exec('delete from parent_player_links')
  await actor(parent)
  assert.deepEqual((await db.query('select get_team_coach_reminder_projections_v1($1,$2,$3) value',['MATCH',[event],link])).rows[0].value,[])
  await db.exec('reset role')
  await t.test('durable retirement survives relink, old-source resends and policy changes; fresh delivered requests open independent windows',async()=>{
    await db.exec(`insert into parent_player_links(id,auth_user_id,player_id,club_id,status,email) values('${link}','${parent}','${player}','${club}','active','parent@example.test')`)
    const before=(await db.query('select * from team_coach_reminder_retirements order by enrolment_id')).rows
    assert.ok(before.some(row=>row.enrolment_id===monthly.id))
    assert.equal((await db.query('select app_private.coach_reminder_projection_v1($1) value',[monthly.id])).rows[0].value,null)
    const count=(await db.query('select count(*)::int n from team_coach_reminder_enrolments')).rows[0].n
    await db.exec(`update match_day_availability_requests set created_at=clock_timestamp(),sent_at=clock_timestamp() where id='${id(111)}';
      update training_availability_request_players set email_sent_at=clock_timestamp() where request_id='${id(92)}'`)
    assert.equal((await db.query('select count(*)::int n from team_coach_reminder_enrolments')).rows[0].n,count,'Old request identities cannot reopen retired windows')
    const freshRequest=id(92),freshSource=id(121)
    const originalWindows=(await db.query('select count(*)::int n from team_coach_reminder_enrolments where request_id=$1',[freshRequest])).rows[0].n
    await db.exec(`insert into parent_player_links(id,auth_user_id,player_id,club_id,status,email) values('${id(125)}','${id(126)}','${player}','${club}','active','new-parent@example.test');
      insert into training_availability_request_players values('${freshSource}','${freshRequest}','${club}','${team}','${player}','new-parent@example.test',null,clock_timestamp(),null,'sent')`)
    assert.equal((await db.query('select count(*)::int n from team_coach_reminder_enrolments where request_id=$1',[freshRequest])).rows[0].n,originalWindows,'Queued invitation is not a confirmed response window')
    await db.exec(`update training_availability_request_players set email_sent_at=clock_timestamp() where id='${freshSource}'`)
    const fresh=(await db.query('select * from team_coach_reminder_enrolments where request_id=$1 order by response_window desc limit 1',[freshRequest])).rows[0]
    const candidate={kind:'TRAINING',eventId:id(90),enrolmentId:fresh.id,clubId:club,teamId:team,playerId:player,occurrenceDate:'2099-03-03'}
    const jobs=await repository.planCandidate(candidate,new Date().toISOString())
    const deadline=jobs.find(job=>job.action==='availability_deadline');assert.ok(deadline)
    assert.equal(Date.parse(deadline.dueAt)-fresh.first_delivered_at.getTime(),2*3600000)
    await db.exec(`insert into parent_player_links(id,auth_user_id,player_id,club_id,status,email) values('${id(127)}','${id(128)}','${player}','${club}','active','second-new-parent@example.test');
      insert into training_availability_request_players values('${id(122)}','${freshRequest}','${club}','${team}','${player}','second-new-parent@example.test',clock_timestamp(),clock_timestamp(),null,'sent')`)
    assert.equal((await db.query('select count(*)::int n from team_coach_reminder_enrolments where request_id=$1',[freshRequest])).rows[0].n,originalWindows+1,'Multiple Parents share one immutable first-delivery response window')
    await db.exec(`update training_availability_request_players set created_at=clock_timestamp(),email_sent_at=clock_timestamp() where id='${id(93)}'`)
    assert.equal((await db.query('select count(*)::int n from team_coach_reminder_enrolment_sources where enrolment_id=$1 and source_id=$2',[fresh.id,id(93)])).rows[0].n,0,'Old source identity cannot join a fresh window after its timestamps change')
    const history=async()=>(await db.query("select jsonb_build_object('effects',(select jsonb_agg(to_jsonb(e) order by job_key) from team_coach_reminder_effects e),'jobs',(select jsonb_agg(to_jsonb(j) order by job_key) from team_coach_reminder_jobs j),'outbox',(select jsonb_agg(to_jsonb(o) order by delivery_key) from team_coach_reminder_outbox o)) value")).rows[0].value
    const beforeHistory=await history()
    await db.exec(`begin;update parent_player_links set status='revoked';update parent_player_links set status='active';commit`)
    assert.deepEqual(await history(),beforeHistory,'Retirement does not rewrite jobs, audit effects or held/accepted outbox history')
    assert.equal((await repository.loadContext(candidate)).invitation.deadlineRetired,true,'Unlink and relink between worker runs retire the window in the source transaction')
    assert.equal((await repository.planCandidate(candidate,new Date().toISOString())).some(job=>job.action==='availability_deadline'),false)
    assert.deepEqual((await db.query('select * from team_coach_reminder_retirements where enrolment_id<>$1 order by enrolment_id',[fresh.id])).rows,before,'Prior audit history remains immutable')
    assert.equal((await db.query('select status from match_day_player_availability where match_day_id=$1',[id(110)])).rows[0].status,'available','Explicit Coach answer remains canonical')
    assert.equal((await db.query('select status from match_day_player_squad_decisions where match_day_id=$1',[id(110)])).rows[0].status,'selected','Saved squad is preserved')
  })
  await t.test('emergency stop clears both release fields and removes database projections and planning guards',async()=>{
    const previousFlag=process.env.ENABLE_COACH_REMINDER_AUTOMATION
    try{
      delete process.env.ENABLE_COACH_REMINDER_AUTOMATION
      assert.equal((await db.query('select app_private.coach_reminder_planning_excluded_v1($1) value',[monthly.id])).rows[0].value,false,'Relinking cannot restore a retired SQL planning guard')
      await assert.rejects(db.exec('update team_coach_reminder_release_control set enabled=false'),/check constraint/)
      await db.exec('update team_coach_reminder_release_control set enabled=false,activated_at=null')
      assert.equal((await db.query('select app_private.coach_reminder_planning_excluded_v1($1) value',[monthly.id])).rows[0].value,false)
      assert.equal((await db.query('select app_private.coach_reminder_projection_v1($1) value',[monthly.id])).rows[0].value,null)
      const before=(await db.query('select processor_phase from team_coach_reminder_scan_cursor')).rows[0].processor_phase
      assert.equal(await repository.nextPhase(),0)
      assert.equal((await db.query('select processor_phase from team_coach_reminder_scan_cursor')).rows[0].processor_phase,before)
      assert.equal((await db.query('select status from match_day_player_availability')).rows[0].status,'available')
    }finally{if(previousFlag===undefined)delete process.env.ENABLE_COACH_REMINDER_AUTOMATION;else process.env.ENABLE_COACH_REMINDER_AUTOMATION=previousFlag}
  })
})
