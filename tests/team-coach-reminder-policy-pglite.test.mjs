import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'
import { PGlite } from '@electric-sql/pglite'
import { DEFAULT_COACH_REMINDER_POLICY } from '../src/lib/coach-reminder-policy.js'
import { normalizeCoachReminderContext } from '../netlify/functions/lib/_coach-reminder-repository.js'

const id = n => `00000000-0000-4000-8000-${String(n).padStart(12,'0')}`
const club = id(1), team = id(2), otherTeam = id(3), coach = id(4), secondCoach = id(5), parent = id(6)
const options = { ...DEFAULT_COACH_REMINDER_POLICY, reminderEnabled: true, reminderAfterHours: 12 }
const sql = await readFile('supabase/migrations/20261002084522_team_coach_reminder_policy.sql','utf8')

async function setup(t) {
  const db = new PGlite(); t.after(() => db.close())
  await db.exec(`
    create schema auth; create schema app_private;
    create role anon; create role authenticated; create role service_role bypassrls;
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
    create table match_days(id uuid,club_id uuid,team_id uuid,status text,deleted_at timestamptz,match_date date,kickoff_time time,kickoff_time_tbc boolean,created_at timestamptz);
    create table calendar_event_invites(id uuid,club_id uuid,team_id uuid,player_id uuid,match_day_id uuid,calendar_event_id uuid,invited_at timestamptz,invite_status text,cancelled_at timestamptz);
    create table players(id uuid,club_id uuid,status text);
    create table player_team_memberships(player_id uuid,club_id uuid,team_id uuid,status text,ended_at timestamptz);
    create table match_day_player_availability(id uuid,match_day_id uuid,club_id uuid,player_id uuid,status text,selected_at timestamptz,updated_at timestamptz,selected_by_parent_link_id uuid);
    create table match_day_availability_requests(id uuid,match_day_id uuid,player_id uuid,club_id uuid,team_id uuid,recipient_email text,sent_at timestamptz,created_at timestamptz,token_revoked_at timestamptz,status text);
    create table match_day_player_squad_decisions(match_day_id uuid,club_id uuid,team_id uuid,status text);
    create table mobile_notification_preferences(auth_user_id uuid,app text,invites boolean);
    update team_coach_reminder_policies set effective_from='2026-10-01',configured_at='2026-10-01';
    insert into match_days values('${event}','${club}','${team}','scheduled',null,'2026-10-10','13:00',false,'2026-10-01T01:00Z');
    insert into calendar_event_invites values('${invite}','${club}','${team}','${player}','${event}',null,'2026-10-01T01:00Z','invited',null);
    insert into players values('${player}','${club}','active');
    insert into player_team_memberships values('${player}','${club}','${team}','active',null);
    insert into match_day_player_availability values('${id(34)}','${event}','${club}','${player}','pending',null,'2026-10-01T01:00Z',null);
    insert into match_day_availability_requests values('${id(35)}','${event}','${player}','${club}','${team}','parent@example.test','2026-10-01T02:00Z','2026-10-01T01:00Z',null,'pending');
    insert into team_coach_reminder_enrolments(id,club_id,team_id,policy_id,policy_revision,kind,event_id,player_id,invitation_id,request_id,source_created_at,first_delivered_at)
      select '${enrolment}',club_id,team_id,id,revision,'MATCH','${event}','${player}','${invite}','${id(35)}','2026-10-01T01:00Z','2026-10-01T02:00Z' from team_coach_reminder_policies;
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
