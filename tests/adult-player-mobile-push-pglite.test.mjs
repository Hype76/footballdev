import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'
import { PGlite } from '@electric-sql/pglite'

const uuid = value => `00000000-0000-4000-8000-${String(value).padStart(12, '0')}`
const id = { user: uuid(1), denied: uuid(2), staff: uuid(3), club: uuid(10), otherClub: uuid(11), team: uuid(20), otherTeam: uuid(21), player: uuid(30), child: uuid(31), match: uuid(40) }
const migration = await readFile(new URL('../supabase/migrations/20261120112557_adult_player_shared_chat.sql', import.meta.url), 'utf8')
const leagueMigration = await readFile(new URL('../supabase/migrations/20261121055818_adult_player_current_league_link.sql', import.meta.url), 'utf8')
const foundation = (await readFile(new URL('../supabase/migrations/20260730110000_adult_player_account_foundation.sql', import.meta.url), 'utf8')).split('create or replace function public.get_own_adult_player_invitation_state()')[0]

async function setup() {
  const db = new PGlite()
  await db.exec(`
    create role anon; create role authenticated; create role service_role;
    create schema auth; create schema app_private;
    create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;
    create table auth.users(id uuid primary key, email text default 'adult@example.test', email_confirmed_at timestamptz default now(), deleted_at timestamptz, banned_until timestamptz);
    create table clubs(id uuid primary key, name text, logo_url text, contact_email text, theme_accent text, theme_button_style text, status text default 'active', archived_at timestamptz);
    create table teams(id uuid primary key, club_id uuid, name text, theme_mode text, theme_accent text, theme_button_style text, status text default 'active', archived_at timestamptz);
    create table players(id uuid primary key, club_id uuid, team_id uuid, player_name text, team text, status text default 'active', archived_at timestamptz, date_of_birth date, contact_type text, section text, parent_contacts jsonb default '[{"type":"self","email":"adult@example.test"}]');
    create table users(id uuid primary key, role text, club_id uuid, status text default 'active', role_rank int);
    create table team_staff(user_id uuid, team_id uuid);
    create table parent_player_links(id uuid primary key, player_id uuid, auth_user_id uuid, status text, club_id uuid, team_id uuid, email text);
    create table club_player_types(club_id uuid, name text, chat_group text, unique(club_id, name));
    create table match_days(id uuid primary key, club_id uuid, team_id uuid, opponent text, match_date date, kickoff_time time, kickoff_time_tbc boolean, arrival_time time, venue_name text, status text, deleted_at timestamptz, previous_hidden_at timestamptz, motm_poll_id uuid);
    create table match_day_player_squad_decisions(match_day_id uuid, club_id uuid, team_id uuid, player_id uuid, status text);
    create table polls(id uuid primary key, club_id uuid, team_id uuid, title text, description text, audience text, poll_type text, options jsonb, status text, closes_at timestamptz, allow_multiple boolean default false, max_choices int default 1, allow_own_child_votes boolean default false, allow_vote_changes boolean default true, hide_votes boolean default false, allow_comments boolean default false, created_at timestamptz default now());
    create table poll_votes(id uuid primary key default gen_random_uuid(), poll_id uuid, club_id uuid, team_id uuid, auth_user_id uuid, voter_email text, voter_name text, option_id text, parent_link_id uuid, updated_at timestamptz default now(), unique(poll_id,voter_email,option_id));
    create table audit_logs(club_id uuid, actor_id uuid, action text, entity_type text, entity_id uuid, metadata jsonb);
    create function can_use_plan_feature(uuid, text) returns boolean language sql stable as $$ select coalesce(nullif(current_setting('test.plan_allowed', true), '')::boolean, true) $$;
    insert into auth.users(id) values('${id.user}'),('${id.denied}'),('${id.staff}');
    insert into clubs(id, name) values('${id.club}', 'Club'),('${id.otherClub}', 'Other');
    insert into teams(id, club_id, name) values('${id.team}', '${id.club}', 'Team'),('${id.otherTeam}', '${id.otherClub}', 'Other');
    insert into players(id, club_id, team_id, player_name, date_of_birth, contact_type, section)
      values('${id.player}', '${id.club}', '${id.team}', 'Adult', current_date - interval '24 years', 'self', 'Senior'),
      ('${id.child}', '${id.club}', '${id.team}', 'Child', current_date - interval '12 years', 'parent', 'Senior');
    insert into club_player_types values('${id.club}', 'Senior', 'training');
    insert into match_days(id, club_id, team_id, status) values('${id.match}', '${id.club}', '${id.team}', 'scheduled');
    insert into match_day_player_squad_decisions values('${id.match}', '${id.club}', '${id.team}', '${id.player}', 'selected');
  `)
  await db.exec(foundation)
  await db.exec(`insert into adult_player_account_links(user_id, player_id, created_by, created_at)
    values('${id.user}', '${id.player}', '${id.user}', date_trunc('day', now()) - interval '1 day');`)
  // Use real shared room/message definitions, constraints and indexes.
  const shared = await readFile(new URL('../supabase/migrations/20260714120000_parent_portal_chat_v1.sql', import.meta.url), 'utf8')
  await db.exec(shared.slice(0, shared.indexOf('create or replace function public.parent_chat_staff_can_access_team')))
  await db.exec(shared.slice(shared.indexOf('create or replace function public.parent_chat_staff_can_access_team'), shared.indexOf('create or replace function public.parent_chat_parent_can_access_room')))
  const communities = await readFile(new URL('../supabase/migrations/20261109155100_player_participation_and_chat_communities.sql', import.meta.url), 'utf8')
  await db.exec(communities.slice(communities.indexOf('CREATE OR REPLACE FUNCTION public.parent_chat_parent_can_access_room'), communities.indexOf('CREATE OR REPLACE FUNCTION public.parent_chat_room_matches_parent_link')))
  await db.exec(shared.slice(shared.indexOf('create or replace function public.parent_chat_user_can_access_room'), shared.indexOf('create or replace function public.parent_chat_user_can_post_room')))
  const notifications = await readFile(new URL('../supabase/migrations/20260810112645_chat_mobile_notification_intents_36d.sql', import.meta.url), 'utf8')
  await db.exec(notifications.slice(notifications.indexOf('create table public.parent_chat_mobile_notification_intents'), notifications.indexOf('create index parent_chat_mobile_notification_intents_due_idx')))
  await db.exec(`create table parent_mobile_push_installations(installation_id uuid,auth_user_id uuid,parent_link_id uuid,status text,enabled boolean,detail_level text,expo_push_token text);
    create table coach_mobile_push_installations(installation_id uuid,auth_user_id uuid,user_profile_id uuid);
    create function app_private.parent_chat_parent_link_can_receive_notification(uuid,uuid,uuid) returns boolean language sql as $$select false$$;
    create function app_private.coach_mobile_installation_has_current_context(uuid) returns boolean language sql as $$select true$$;`)
  const fanout = await readFile(new URL('../supabase/migrations/20260824065755_mobile_notification_account_fanout_85.sql', import.meta.url), 'utf8')
  await db.exec(fanout.slice(fanout.indexOf('create or replace function app_private.enqueue_parent_chat_mobile_notification_intents()'), fanout.indexOf('create or replace function app_private.enqueue_staff_chat_mobile_notification_intents()')))
  await db.exec('create trigger adult_chat_test_fanout after insert on parent_chat_messages for each row execute function app_private.enqueue_parent_chat_mobile_notification_intents()')
  await db.exec(`alter table parent_chat_rooms drop constraint parent_chat_rooms_type_check;
    alter table parent_chat_rooms add constraint parent_chat_rooms_type_check check(room_type in ('parent_staff','team','team_training','team_match','match_squad'));
    alter table parent_chat_rooms drop constraint parent_chat_rooms_scope_check;
    alter table parent_chat_rooms add constraint parent_chat_rooms_scope_check check(
      (room_type='parent_staff' and player_id is not null and match_day_id is null)
      or(room_type in ('team','team_training','team_match') and player_id is null and match_day_id is null)
      or(room_type='match_squad' and player_id is null and match_day_id is not null));
    create unique index parent_chat_rooms_new_community_key on parent_chat_rooms(club_id,team_id,room_type) where room_type in ('team_training','team_match');
    alter table parent_chat_messages add column client_request_id uuid;
    create unique index parent_chat_messages_sender_request_key on parent_chat_messages(sender_id, client_request_id) where client_request_id is not null;`)
  await db.exec(migration)
  await claims(db, id.user)
  await db.exec('select prepare_own_adult_player_chat()')
  await db.exec(`
    alter table parent_mobile_push_installations add column club_id uuid, add column team_id uuid, add column updated_at timestamptz;
    create table calendar_events(id uuid primary key,club_id uuid,team_id uuid,event_type text,title text,starts_at timestamptz,ends_at timestamptz,location text,cancelled_at timestamptz);
    create table calendar_event_invites(id uuid primary key,club_id uuid,team_id uuid,calendar_event_id uuid,player_id uuid,recipient_type text,invite_status text default 'active',notify_requested boolean default true,responded_at timestamptz);
    create table training_availability_requests(id uuid primary key,club_id uuid,team_id uuid,calendar_event_id uuid,occurrence_starts_at timestamptz,occurrence_ends_at timestamptz,status text);
    create table training_availability_request_players(id uuid primary key,request_id uuid,club_id uuid,team_id uuid,player_id uuid,parent_link_id uuid,recipient_type text,status text);
    create table training_availability_responses(request_player_id uuid,status text,responded_at timestamptz);
    create table match_day_availability_requests(id uuid primary key,club_id uuid,team_id uuid,player_id uuid,parent_link_id uuid,recipient_type text,match_day_id uuid,status text,expires_at timestamptz,responded_at timestamptz);
    create table match_day_player_availability(match_day_id uuid,player_id uuid,status text,selected_at timestamptz);
    alter table match_days add column venue_address text, add column concluded_at timestamptz;
  `)
  const foundationFull = await readFile(new URL('../supabase/migrations/20260730110000_adult_player_account_foundation.sql', import.meta.url), 'utf8')
  await db.exec(foundationFull.slice(foundationFull.indexOf('create or replace function public.get_own_adult_player_invitation_state()'), foundationFull.indexOf('create or replace function public.record_adult_player_response_audit_internal(')))
  await db.exec(`create table user_club_memberships(auth_user_id uuid);
    alter table calendar_event_invites add column cancelled_at timestamptz, add column adult_response_status text, add column adult_responded_at timestamptz, add column player_contact_email text default 'adult@example.test';
    alter table training_availability_request_players add column token_revoked_at timestamptz, add column response_deadline_at timestamptz;
    alter table match_day_availability_requests add column token_revoked_at timestamptz;`)
  const currentInvitations = await readFile(new URL('../supabase/migrations/20261118101012_adult_player_calendar_rsvp_and_token_identity.sql', import.meta.url), 'utf8')
  await db.exec(currentInvitations.slice(currentInvitations.indexOf('create or replace function app_private.adult_player_contact_is_current('),currentInvitations.indexOf('-- Parent token branches')))
  await db.exec(currentInvitations.slice(currentInvitations.indexOf('create or replace function public.get_own_adult_player_invitation_state()'),currentInvitations.indexOf('create function public.respond_own_adult_player_calendar_invitation(')))
  await db.exec(await readFile(new URL('../supabase/migrations/20261120172920_adult_player_mobile_push.sql', import.meta.url), 'utf8'))
  return db
}

async function claims(db, user) { await db.query("select set_config('request.jwt.claim.sub', $1, false)", [user || '']) }
async function rooms(db) { return (await db.query('select * from get_own_adult_player_chat_rooms()')).rows }
async function room(db, type) { return (await rooms(db)).find(item => item.room_type === type) }

test('Adult Player league exposes only the enabled URL for a current verified link', async () => {
  const db = await setup()
  try {
    await db.exec("alter table teams add column league_url text; alter table teams add column league_link_enabled boolean not null default false")
    await db.exec(leagueMigration)
    await db.query('update teams set league_url=$1,league_link_enabled=true where id=$2', ['https://league.example/adult-team', id.team])
    await claims(db,id.user)
    const link = (await db.query('select link_id from get_own_adult_player_account_state()')).rows[0].link_id
    const read = async (target = link) => (await db.query('select * from get_own_adult_player_team_league_url($1)', [target])).rows
    await db.exec('set role authenticated')
    assert.deepEqual(await read(), [{ team_id:id.team, team_name:'Team', league_url:'https://league.example/adult-team', league_link_enabled:true }])
    assert.deepEqual(await read(uuid(999)), [])
    await claims(db,id.denied)
    assert.deepEqual(await read(), [])
    await db.exec('reset role; update teams set league_link_enabled=false')
    await claims(db,id.user)
    await db.exec('set role authenticated')
    assert.equal((await read())[0].league_url, null)
    await db.exec("reset role; update adult_player_account_links set status='revoked',revoked_at=now(); set role authenticated")
    assert.deepEqual(await read(), [])
    await db.exec('reset role')
    for (const role of ['anon','service_role']) {
      const {rows} = await db.query('select has_function_privilege($1,$2,$3) as allowed',[role,'public.get_own_adult_player_team_league_url(uuid)','EXECUTE'])
      assert.equal(rows[0].allowed,false)
    }
  } finally { await db.close() }
})


const deviceId = uuid(70)
async function register(db, device=deviceId, token='ExpoPushToken[adult_test]') {
  const link = (await db.query('select link_id from get_own_adult_player_account_state()')).rows[0].link_id
  return (await db.query(`select own_adult_player_push_installation('register',$1,$2,$3,'ios') state`,[device,link,token])).rows[0].state
}
async function claimPush(db) {
  await db.exec('set role service_role')
  try { return (await db.query('select * from claim_adult_player_mobile_push_intents()')).rows }
  finally { await db.exec('reset role') }
}
async function sendChat(db, roomType='player_staff') {
  const target = await room(db,roomType)
  await db.query(`insert into parent_chat_messages(room_id,club_id,sender_id,sender_kind,sender_name,sender_role,body) values($1,$2,$3,'staff','Coach','Coach','Private text must not enter push')`, [target.id,id.club,id.staff])
  return target
}

test('Player push registration is authenticated, owned and isolated; revoked access can still unbind', async () => {
 const db=await setup()
 try {
  await db.exec('set role authenticated')
  assert.equal((await register(db)).enabled,true)
  await assert.rejects(db.query('select * from adult_player_mobile_push_installations'), /permission denied/)
  await assert.rejects(db.query('select * from claim_adult_player_mobile_push_intents()'), /permission denied/)
  await db.exec('reset role')
  await claims(db,id.denied)
  await assert.rejects(db.query("select own_adult_player_push_installation('register',$1,$2,'ExpoPushToken[adult_test]','ios')",[deviceId,uuid(999)]), /INSTALLATION_OWNED|Verified adult/)
  await claims(db,id.user)
  await db.exec("update adult_player_account_links set status='revoked',revoked_at=now()")
  const result=await db.query("select own_adult_player_push_installation('delete',$1) state",[deviceId])
  assert.equal(result.rows[0].state.enabled,false)
  assert.equal((await db.query('select count(*)::int n from adult_player_mobile_push_installations')).rows[0].n,0)
 } finally {await db.close()}
})

test('Chat push rechecks own room, mute, read, plan and current access without leaking content or claims', async () => {
 const db=await setup()
 try {
  await register(db)
  const direct=await sendChat(db)
  await db.query("select set_config('request.jwt.claims',$1,false)",[JSON.stringify({sub:id.user,role:'authenticated',marker:'original'})])
  const before=(await db.query("select current_setting('request.jwt.claim.sub') value")).rows[0].value
  const originalClaims=(await db.query("select current_setting('request.jwt.claims') value")).rows[0].value
  const first=await claimPush(db)
  assert.equal(first.length,1)
  assert.equal(first[0].payload.data.app,'player')
  assert.equal(first[0].payload.data.roomId,direct.id)
  assert.equal(JSON.stringify(first).includes('Private text'),false)
  assert.equal((await db.query("select current_setting('request.jwt.claim.sub') value")).rows[0].value,before)
  assert.equal((await db.query("select current_setting('request.jwt.claims') value")).rows[0].value,originalClaims)
  assert.equal((await claimPush(db)).length,0)
  await db.query('select set_own_adult_player_chat_notification_preference($1,true)',[direct.id])
  await sendChat(db)
  assert.equal((await claimPush(db)).length,0)
  await db.query('select set_own_adult_player_chat_notification_preference($1,false)',[direct.id])
  await sendChat(db)
  await db.exec("update adult_player_account_links set status='revoked',revoked_at=now()")
  assert.equal((await claimPush(db)).length,0)
 } finally {await db.close()}
})

test('calendar, training and match invitations target only the own Player and deduplicate bookkeeping', async () => {
 const db=await setup()
 try {
  await register(db)
  await db.exec(`insert into calendar_events values('${uuid(80)}','${id.club}','${id.team}','general','Club event',now()+interval '1 day',null,'Ground',null);
   insert into calendar_event_invites(id,club_id,team_id,calendar_event_id,player_id,recipient_type) values('${uuid(81)}','${id.club}','${id.team}','${uuid(80)}','${id.player}','player'),('${uuid(82)}','${id.club}','${id.team}','${uuid(80)}','${id.child}','player');
   insert into training_availability_requests values('${uuid(83)}','${id.club}','${id.team}','${uuid(80)}',now()+interval '1 day',null,'sent');
   insert into training_availability_request_players(id,request_id,club_id,team_id,player_id,parent_link_id,recipient_type,status) values('${uuid(84)}','${uuid(83)}','${id.club}','${id.team}','${id.player}',null,'player','sent');
   update match_days set match_date=current_date+1;
   insert into match_day_availability_requests(id,club_id,team_id,player_id,parent_link_id,recipient_type,match_day_id,status,expires_at,responded_at) values('${uuid(85)}','${id.club}','${id.team}','${id.player}',null,'player','${id.match}','pending',now()+interval '1 day',null);
   update calendar_event_invites set responded_at=now();`)
  const pushed=await claimPush(db)
  assert.equal(pushed.length,3)
  assert.deepEqual(pushed.map(row=>row.payload.data.invitationId).sort(),[`calendar:${uuid(81)}`,`match:${uuid(85)}`,`training:${uuid(84)}`].sort())
  assert.equal((await claimPush(db)).length,0)
 } finally {await db.close()}
})

test('shared native token transfers exclusively between Parent and Player, including queued work', async () => {
 const db=await setup()
 try {
  await db.query(`insert into parent_mobile_push_installations(installation_id,auth_user_id,parent_link_id,status,enabled,expo_push_token) values($1,$2,$3,'active',true,'ExpoPushToken[adult_test]')`,[uuid(400),id.denied,uuid(401)])
  await register(db)
  let parent=(await db.query('select * from parent_mobile_push_installations')).rows[0]
  assert.equal(parent.enabled,false);assert.equal(parent.expo_push_token,null);assert.equal(parent.auth_user_id,null)
  await sendChat(db)
  await db.query(`update parent_mobile_push_installations set auth_user_id=$1,parent_link_id=$2,status='active',enabled=true,expo_push_token='ExpoPushToken[adult_test]' where installation_id=$3`,[id.denied,uuid(401),uuid(400)])
  assert.equal((await db.query('select count(*)::int n from adult_player_mobile_push_installations')).rows[0].n,0)
  assert.equal((await claimPush(db)).length,0)
  assert.equal((await db.query('select count(*)::int n from adult_player_mobile_push_intents')).rows[0].n,0)
 } finally {await db.close()}
})

test('claimed Chat alerts deny revoked, foreign, muted, read, deleted and newly ineligible scope', async () => {
 const db=await setup()
 try {
  await register(db)
  const direct=await sendChat(db)
  const link=(await db.query('select link_id from get_own_adult_player_account_state()')).rows[0].link_id
  const cases=[
   `update players set date_of_birth=current_date-interval '12 years' where id='${id.player}'`,
   `update players set team_id='${id.otherTeam}' where id='${id.player}'`,
   `update players set parent_contacts='[{"type":"self","email":"changed@example.test"}]' where id='${id.player}'`,
   `update teams set status='archived' where id='${id.team}'`,
   `update clubs set archived_at=now() where id='${id.club}'`,
   `update auth.users set banned_until=now()+interval '1 day' where id='${id.user}'`,
   `update adult_player_account_links set status='revoked',revoked_at=now()`,
   `update adult_player_mobile_push_installations set enabled=false`,
   `update parent_chat_messages set deleted_at=now()`,
   `insert into adult_player_chat_preferences(adult_link_id,room_id,notifications_muted) values('${link}','${direct.id}',true)`,
   `insert into adult_player_chat_preferences(adult_link_id,room_id,last_read_at) values('${link}','${direct.id}',now()+interval '1 minute')`,
   `select set_config('test.plan_allowed','false',true)`,
  ]
  await db.exec('begin')
  for(const mutation of cases){
   await db.exec('savepoint eligibility_case')
   await db.exec(mutation)
   assert.equal((await claimPush(db)).length,0,mutation)
   await db.exec('rollback to savepoint eligibility_case')
  }
  await db.exec('commit')
  assert.equal((await claimPush(db)).length,1)
 } finally {await db.close()}
})

test('invitation delivery rechecks cancellation, token revocation and exact target identity', async () => {
 const db=await setup()
 try {
  await register(db)
  await db.exec(`insert into calendar_events values('${uuid(90)}','${id.club}','${id.team}','general','Club event',now()+interval '1 day',null,'Ground',null);
   insert into calendar_event_invites(id,club_id,team_id,calendar_event_id,player_id,recipient_type) values('${uuid(91)}','${id.club}','${id.team}','${uuid(90)}','${id.player}','player');
   insert into training_availability_requests values('${uuid(92)}','${id.club}','${id.team}','${uuid(90)}',now()+interval '1 day',null,'sent');
   insert into training_availability_request_players(id,request_id,club_id,team_id,player_id,parent_link_id,recipient_type,status) values('${uuid(93)}','${uuid(92)}','${id.club}','${id.team}','${id.player}',null,'player','sent');
   update calendar_events set cancelled_at=now();
   update training_availability_request_players set token_revoked_at=now();`)
  assert.equal((await claimPush(db)).length,0)
 } finally {await db.close()}
})

test('another verified adult with the same token takes ownership without inheriting the prior account queue', async () => {
 const db=await setup()
 try {
  await register(db)
  await sendChat(db)
  await db.exec(`update auth.users set email='other@example.test' where id='${id.denied}';
    insert into players(id,club_id,team_id,player_name,date_of_birth,contact_type,section,parent_contacts)
      values('${uuid(500)}','${id.club}','${id.team}','Other adult',current_date-interval '24 years','self','Senior','[{"type":"self","email":"other@example.test"}]');
    insert into adult_player_account_links(user_id,player_id,created_by) values('${id.denied}','${uuid(500)}','${id.denied}');`)
  await claims(db,id.denied)
  await register(db,uuid(501))
  const devices=(await db.query('select installation_id,user_id from adult_player_mobile_push_installations')).rows
  assert.deepEqual(devices,[{installation_id:uuid(501),user_id:id.denied}])
  assert.equal((await claimPush(db)).length,0)
  assert.equal((await db.query('select count(*)::int n from adult_player_mobile_push_intents')).rows[0].n,0)
 } finally {await db.close()}
})

test('staff notify choice is respected and enabling it later queues one invitation only', async () => {
 const db=await setup()
 try {
  await register(db)
  await db.exec(`insert into calendar_events values('${uuid(510)}','${id.club}','${id.team}','general','Club event',now()+interval '1 day',null,'Ground',null);
    insert into calendar_event_invites(id,club_id,team_id,calendar_event_id,player_id,recipient_type,notify_requested)
      values('${uuid(511)}','${id.club}','${id.team}','${uuid(510)}','${id.player}','player',false);`)
  assert.equal((await claimPush(db)).length,0)
  await db.exec('update calendar_event_invites set notify_requested=true')
  assert.equal((await claimPush(db)).length,1)
  await db.exec('update calendar_event_invites set responded_at=now()')
  assert.equal((await claimPush(db)).length,0)
 } finally {await db.close()}
})

test('Player worker entry and private helpers are not callable by app or anonymous roles', async () => {
 const db=await setup()
 try {
  const privileges=(await db.query(`select
   has_function_privilege('anon','public.own_adult_player_push_installation(text,uuid,uuid,text,text,text,boolean)','execute') anonymous_register,
   has_function_privilege('authenticated','public.claim_adult_player_mobile_push_intents(integer)','execute') app_claim,
   has_function_privilege('authenticated','app_private.adult_player_push_payload(public.adult_player_mobile_push_installations,text,text)','execute') app_payload,
   has_function_privilege('service_role','public.claim_adult_player_mobile_push_intents(integer)','execute') worker_claim,
   has_function_privilege('authenticated','app_private.fence_shared_parent_player_push_token()','execute') app_fence`)).rows[0]
  assert.deepEqual(privileges,{anonymous_register:false,app_claim:false,app_payload:false,worker_claim:true,app_fence:false})
  await register(db)
  await assert.rejects(db.query("select own_adult_player_push_installation('get',$1,$2)",[deviceId,uuid(999)]),/Verified adult/)
 } finally {await db.close()}
})

test('Player Chat fanout excludes Parent private rooms, removed match selection and disabled community', async () => {
 const db=await setup()
 try {
  await register(db)
  await sendChat(db,'match_squad')
  await db.exec("update match_day_player_squad_decisions set status='not_selected'")
  assert.equal((await claimPush(db)).length,0)
  await sendChat(db,'team_training')
  await db.exec("update club_player_types set chat_group='none'")
  assert.equal((await claimPush(db)).length,0)
  await db.query(`insert into parent_chat_rooms(id,club_id,team_id,player_id,room_type,title) values($1,$2,$3,$4,'parent_staff','Private Parent discussion')`,[uuid(600),id.club,id.team,id.player])
  await db.query(`insert into parent_chat_messages(room_id,club_id,sender_id,sender_kind,sender_name,sender_role,body) values($1,$2,$3,'staff','Coach','Coach','Parent private')`,[uuid(600),id.club,id.staff])
  assert.equal((await claimPush(db)).length,0)
 } finally {await db.close()}
})

test('same authenticated person retains both valid Parent and Player registrations on the shared token', async () => {
 const db=await setup()
 try {
  await db.query(`insert into parent_mobile_push_installations(installation_id,auth_user_id,parent_link_id,status,enabled,expo_push_token) values($1,$2,$3,'active',true,'ExpoPushToken[adult_test]')`,[uuid(700),id.user,uuid(701)])
  await register(db)
  let parent=(await db.query('select * from parent_mobile_push_installations')).rows[0]
  assert.equal(parent.enabled,true);assert.equal(parent.auth_user_id,id.user);assert.equal(parent.expo_push_token,'ExpoPushToken[adult_test]')
  await sendChat(db)
  await db.query(`update parent_mobile_push_installations set expo_push_token='ExpoPushToken[adult_test]' where installation_id=$1`,[uuid(700)])
  assert.equal((await db.query('select count(*)::int n from adult_player_mobile_push_installations where enabled')).rows[0].n,1)
  assert.equal((await claimPush(db)).length,1)
  // Each role's own authenticated sign-out operation removes its registration.
  await db.query(`update parent_mobile_push_installations set enabled=false,expo_push_token=null,status='revoked' where installation_id=$1 and auth_user_id=$2`,[uuid(700),id.user])
  await db.query("select own_adult_player_push_installation('delete',$1)",[deviceId])
  assert.equal((await db.query('select count(*)::int n from adult_player_mobile_push_installations')).rows[0].n,0)
  assert.equal((await db.query('select count(*)::int n from parent_mobile_push_installations where enabled')).rows[0].n,0)
 } finally {await db.close()}
})

test('worker delivery uses explicit installation identity even when request auth cannot be read', async () => {
 const db=await setup()
 try {
  await register(db)
  await sendChat(db)
  await db.exec(`insert into calendar_events values('${uuid(800)}','${id.club}','${id.team}','general','Club event',now()+interval '1 day',null,'Ground',null);
    insert into calendar_event_invites(id,club_id,team_id,calendar_event_id,player_id,recipient_type,notify_requested)
      values('${uuid(801)}','${id.club}','${id.team}','${uuid(800)}','${id.player}','player',true);`)
  // Hosted postgres cannot SET request JWT claims. Remove request identity
  // entirely and make any accidental dependency on auth.uid() fail loudly.
  await claims(db,'')
  await db.exec(`create or replace function auth.uid() returns uuid language plpgsql stable as $$
    begin raise exception 'Worker must not read or impersonate request identity'; end $$;`)
  const pushed=await claimPush(db)
  assert.equal(pushed.length,2)
  assert.ok(pushed.every(row=>row.payload.data.userId===id.user))
  assert.deepEqual(pushed.map(row=>row.payload.data.route).sort(),['chat','invites'])
  await assert.rejects(db.query('select * from get_own_adult_player_account_state()'),/must not read or impersonate/)
  await assert.rejects(db.query('select * from get_own_adult_player_invitation_state()'),/must not read or impersonate/)
  const settings=(await db.query(`select proconfig from pg_proc where proname in ('adult_player_push_payload','claim_adult_player_mobile_push_intents')`)).rows
  assert.ok(settings.every(row=>(row.proconfig||[]).every(setting=>!setting.startsWith('request.jwt.'))))
  const sql=await readFile(new URL('../supabase/migrations/20261120172920_adult_player_mobile_push.sql',import.meta.url),'utf8')
  assert.doesNotMatch(sql,/set_config|set\s+request\.jwt|alter\s+role|grant\s+set/iu)
 } finally {await db.close()}
})

test('own-user wrappers retain authenticated identity while private shared helpers have no application grants',async()=>{
 const db=await setup()
 try {
  const names=[
   ['public.get_own_adult_player_account_state()','app_private.adult_player_account_state_for_user($1)'],
   ['app_private.own_adult_player_portal_context()','app_private.adult_player_portal_context_for_user($1)'],
   ['app_private.own_adult_player_chat_context()','app_private.adult_player_chat_context_for_user($1)'],
   ['public.get_own_adult_player_invitation_state()','app_private.adult_player_invitation_state_for_user($1)'],
  ]
  for(const [own,explicit] of names){
   assert.deepEqual((await db.query(`select * from ${own}`)).rows,(await db.query(`select * from ${explicit}`,[id.user])).rows,own)
  }
  const direct=await room(db,'player_staff')
  assert.equal((await db.query('select app_private.own_adult_player_chat_can_access($1) allowed',[direct.id])).rows[0].allowed,
    (await db.query('select app_private.adult_player_chat_can_access_for_user($1,$2) allowed',[id.user,direct.id])).rows[0].allowed)
  await claims(db,id.denied)
  assert.equal((await db.query('select * from get_own_adult_player_account_state()')).rows.length,0)
  assert.equal((await db.query('select * from app_private.own_adult_player_portal_context()')).rows.length,0)
  assert.equal((await db.query('select * from get_own_adult_player_chat_rooms()')).rows.length,0)
  assert.equal((await db.query('select * from get_own_adult_player_invitation_state()')).rows.length,0)
  assert.equal((await db.query('select * from app_private.adult_player_portal_context_for_user($1)',[id.user])).rows.length,1)
  for(const helper of ['adult_player_account_state_for_user(uuid)','adult_player_portal_context_for_user(uuid)','adult_player_chat_context_for_user(uuid)','adult_player_chat_can_access_for_user(uuid,uuid,boolean)','adult_player_invitation_state_for_user(uuid)']){
   for(const role of ['anon','authenticated','service_role']) assert.equal((await db.query('select has_function_privilege($1,$2,\'execute\') allowed',[role,`app_private.${helper}`])).rows[0].allowed,false,`${role}: ${helper}`)
  }
 }finally{await db.close()}
})

test('shared explicit-user helpers preserve the canonical permission predicates byte-for-byte',async()=>{
 const changed=await readFile(new URL('../supabase/migrations/20261120172920_adult_player_mobile_push.sql',import.meta.url),'utf8')
 const sources=[
  ['20260730110000_adult_player_account_foundation.sql','public.get_own_adult_player_account_state','app_private.adult_player_account_state_for_user'],
  ['20261120112557_adult_player_shared_chat.sql','app_private.own_adult_player_portal_context','app_private.adult_player_portal_context_for_user'],
  ['20261120112557_adult_player_shared_chat.sql','app_private.own_adult_player_chat_context','app_private.adult_player_chat_context_for_user'],
  ['20261120112557_adult_player_shared_chat.sql','app_private.own_adult_player_chat_can_access','app_private.adult_player_chat_can_access_for_user'],
  ['20261118101012_adult_player_calendar_rsvp_and_token_identity.sql','public.get_own_adult_player_invitation_state','app_private.adult_player_invitation_state_for_user'],
 ]
 const body=(text,name)=>text.slice(text.indexOf(`function ${name}(`)).match(/\bas\s+\$\$([\s\S]*?)\$\$/iu)[1]
 for(const [file,own,helper] of sources){
  let expected=body(await readFile(new URL(`../supabase/migrations/${file}`,import.meta.url),'utf8'),own)
  expected=expected.replaceAll('public.get_own_adult_player_account_state()','app_private.adult_player_account_state_for_user(target_user_id)')
    .replaceAll('app_private.own_adult_player_portal_context()','app_private.adult_player_portal_context_for_user(target_user_id)')
    .replaceAll('app_private.own_adult_player_chat_context()','app_private.adult_player_chat_context_for_user(target_user_id)')
    .replaceAll('auth.uid()','target_user_id')
  assert.equal(body(changed,helper),expected,helper)
 }
})
