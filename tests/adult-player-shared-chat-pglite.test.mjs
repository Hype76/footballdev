import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'
import { PGlite } from '@electric-sql/pglite'

const uuid = value => `00000000-0000-4000-8000-${String(value).padStart(12, '0')}`
const id = { user: uuid(1), denied: uuid(2), staff: uuid(3), club: uuid(10), otherClub: uuid(11), team: uuid(20), otherTeam: uuid(21), player: uuid(30), child: uuid(31), match: uuid(40) }
const migration = await readFile(new URL('../supabase/migrations/20261120112557_adult_player_shared_chat.sql', import.meta.url), 'utf8')
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
  return db
}

async function claims(db, user) { await db.query("select set_config('request.jwt.claim.sub', $1, false)", [user || '']) }
async function rooms(db) { return (await db.query('select * from get_own_adult_player_chat_rooms()')).rows }
async function room(db, type) { return (await rooms(db)).find(item => item.room_type === type) }

test('adult uses own direct, configured community and selected match, without Parent membership or read mutations', async () => {
  const db = await setup()
  try {
    await db.exec(`insert into parent_chat_rooms(club_id,team_id,player_id,room_type,title) values('${id.club}','${id.team}','${id.child}','parent_staff','Child private');
      insert into parent_chat_rooms(club_id,team_id,room_type,title) values('${id.club}','${id.team}','team_match','Other community'),('${id.club}','${id.team}','team','Whole team'),('${id.otherClub}','${id.otherTeam}','team_training','Other club');`)
    assert.deepEqual((await rooms(db)).map(item => item.room_type).sort(), ['match_squad', 'player_staff', 'team_training'])
    await db.exec('set role authenticated')
    assert.equal((await rooms(db)).length, 3)
    await assert.rejects(db.query('select * from adult_player_chat_preferences'), /permission denied/)
    await db.exec('reset role')
    const granted = (await db.query(`select has_function_privilege('anon','public.get_own_adult_player_chat_rooms()','execute') anon, has_function_privilege('authenticated','app_private.own_adult_player_chat_context()','execute') helper`)).rows[0]
    assert.deepEqual(granted, { anon: false, helper: false })
    assert.equal((await db.query('select count(*)::int n from parent_player_links')).rows[0].n, 0)
    assert.equal((await db.query('select count(*)::int n from parent_chat_memberships')).rows[0].n, 0)
    assert.equal((await db.query('select count(*)::int n from adult_player_chat_preferences')).rows[0].n, 0)
    const ownDirect = await room(db, 'player_staff')
    await db.exec(`insert into users(id,club_id,role,role_rank) values('${id.staff}','${id.club}','coach',20);
      insert into team_staff values('${id.staff}','${id.team}');
      insert into parent_player_links(id,player_id,auth_user_id,status,club_id,team_id) values('${uuid(99)}','${id.player}','${id.denied}','active','${id.club}','${id.team}');`)
    assert.equal((await db.query('select parent_chat_user_can_access_room($1,$2) allowed', [ownDirect.id,id.staff])).rows[0].allowed, true)
    assert.equal((await db.query('select parent_chat_user_can_access_room($1,$2) allowed', [ownDirect.id,id.denied])).rows[0].allowed, false)
    assert.equal((await db.query('select parent_chat_user_can_access_room($1,$2) allowed', [ownDirect.id,id.user])).rows[0].allowed, false)
    await db.exec('delete from parent_player_links')
    const inaccessible = (await db.query(`select id from parent_chat_rooms where player_id=$1`, [id.child])).rows[0].id
    await assert.rejects(db.query('select * from get_own_adult_player_chat_messages($1)', [inaccessible]), /not available/)
    await db.exec(`update match_day_player_squad_decisions set status='not_selected'`)
    assert.equal((await rooms(db)).some(item => item.room_type === 'match_squad'), false)
    await db.exec(`update club_player_types set chat_group='none'`)
    assert.deepEqual((await rooms(db)).map(item => item.room_type), ['player_staff'])
  } finally { await db.close() }
})

test('adult messages are typed, idempotent, own-delete only, history-bound, with isolated read/mute state', async () => {
  const db = await setup()
  try {
    const direct = await room(db, 'player_staff')
    await db.query(`insert into parent_chat_rooms(club_id,team_id,player_id,room_type,title)
      values($1,$2,$3,'parent_staff','Historic guardian discussion')`, [id.club,id.team,id.player])
    const guardian = (await db.query(`select id from parent_chat_rooms where player_id=$1 and room_type='parent_staff'`, [id.player])).rows[0].id
    await db.query(`insert into parent_chat_messages(room_id,club_id,sender_id,sender_kind,sender_name,sender_role,body)
      values($1,$2,$3,'staff','Coach','Coach','Private guardian message even after adult joins')`, [guardian,id.club,id.staff])
    assert.equal((await rooms(db)).some(item => item.id === guardian), false)
    await assert.rejects(db.query('select * from get_own_adult_player_chat_messages($1)', [guardian]), /not available/)
    await db.query(`insert into parent_chat_messages(room_id,club_id,sender_id,sender_kind,sender_name,sender_role,body,created_at)
      values($1,$2,$3,'staff','Coach','Coach','Old private history', now()-interval '3 days'),
      ($1,$2,$3,'staff','Coach','Coach','Current message',now())`, [direct.id,id.club,id.staff])
    assert.equal((await room(db, 'player_staff')).unread_count, 1)
    const messages = (await db.query('select * from get_own_adult_player_chat_messages($1)', [direct.id])).rows
    assert.deepEqual(messages.map(item => item.body), ['Current message'])
    await assert.rejects(db.query('select delete_own_adult_player_chat_message($1)', [messages[0].id]), /Only your own/)
    const request = uuid(90)
    const send = body => db.query('select send_own_adult_player_chat_message($1,$2,$3) id', [direct.id,body,request])
    const sent = (await send(' Hello ')).rows[0].id
    assert.equal((await send('Hello')).rows[0].id, sent)
    await assert.rejects(send('Different'), /already been used/)
    const saved = (await db.query('select sender_kind,sender_role,sender_name from parent_chat_messages where id=$1', [sent])).rows[0]
    assert.deepEqual(saved, { sender_kind: 'player', sender_role: 'Player', sender_name: 'Adult' })
    assert.equal((await room(db, 'player_staff')).unread_count, 0)
    await db.query('select set_own_adult_player_chat_notification_preference($1,true)', [direct.id])
    assert.equal((await room(db, 'player_staff')).notifications_muted, true)
    await db.query('select delete_own_adult_player_chat_message($1)', [sent])
    assert.equal((await db.query('select body from get_own_adult_player_chat_messages($1) where id=$2', [direct.id,sent])).rows[0].body, '')
    assert.equal((await db.query('select count(*)::int n from parent_chat_memberships')).rows[0].n, 0)
  } finally { await db.close() }
})

test('closed and completed match rooms are read-only and hidden/deleted matches disappear', async () => {
  const db = await setup()
  try {
    const match = await room(db, 'match_squad')
    await db.exec(`update match_days set status='completed'`)
    assert.equal((await room(db,'match_squad')).can_post, false)
    await assert.rejects(db.query('select send_own_adult_player_chat_message($1,\'No\')', [match.id]), /not available/)
    await db.exec(`update parent_chat_rooms set status='closed'`)
    assert.equal((await rooms(db)).every(item => !item.can_post), true)
    await db.exec(`update match_days set previous_hidden_at=now()`)
    assert.equal((await rooms(db)).some(item => item.room_type === 'match_squad'), false)
    await db.exec(`update match_days set previous_hidden_at=null, deleted_at=now()`)
    assert.equal((await rooms(db)).some(item => item.room_type === 'match_squad'), false)
  } finally { await db.close() }
})

test('every adult entry point denies a revoked, under-age, foreign or absent actor and disabled plan', async () => {
  const db = await setup()
  try {
    const direct = await room(db,'player_staff')
    const denied = async () => {
      assert.deepEqual(await rooms(db), [])
      for (const [sql,args] of [
        ['select prepare_own_adult_player_chat()', []],
        ['select * from get_own_adult_player_chat_messages($1)', [direct.id]],
        ['select send_own_adult_player_chat_message($1,\'No\')', [direct.id]],
        ['select mark_own_adult_player_chat_room_read($1)', [direct.id]],
        ['select set_own_adult_player_chat_notification_preference($1,true)', [direct.id]],
        ['select delete_own_adult_player_chat_message($1)', [uuid(999)]],
      ]) await assert.rejects(db.query(sql,args), /required|not available/)
    }
    await claims(db,id.denied); await denied()
    await claims(db,null); await denied()
    await claims(db,id.user)
    await db.exec(`select set_config('test.plan_allowed','false',false)`); await denied()
    await db.exec(`select set_config('test.plan_allowed','true',false)`)
    for (const [deny, restore] of [
      [`update auth.users set email_confirmed_at=null where id='${id.user}'`, `update auth.users set email_confirmed_at=now() where id='${id.user}'`],
      [`update auth.users set banned_until=now()+interval '1 day' where id='${id.user}'`, `update auth.users set banned_until=null where id='${id.user}'`],
      [`update auth.users set deleted_at=now() where id='${id.user}'`, `update auth.users set deleted_at=null where id='${id.user}'`],
      [`update players set parent_contacts='[]' where id='${id.player}'`, `update players set parent_contacts='[{"type":"self","email":"adult@example.test"}]' where id='${id.player}'`],
      [`update players set parent_contacts='[{"type":"self","email":"wrong@example.test"}]' where id='${id.player}'`, `update players set parent_contacts='[{"type":"self","email":"adult@example.test"}]' where id='${id.player}'`],
      [`update players set parent_contacts='[{"type":"self","email":"adult@example.test"},{"type":"self","email":"other@example.test"}]' where id='${id.player}'`, `update players set parent_contacts='[{"type":"self","email":"adult@example.test"}]' where id='${id.player}'`],
      [`update clubs set status='suspended'`, `update clubs set status='active'`],
      [`update teams set archived_at=now()`, `update teams set archived_at=null`],
      [`insert into users(id,role,club_id,status) values('${id.user}','parent_portal','${id.club}','suspended')`, `delete from users where id='${id.user}'`],
    ]) { await db.exec(deny); await denied(); await db.exec(restore) }
    await db.exec(`update players set date_of_birth=current_date-interval '17 years' where id='${id.player}'`); await denied()
    await db.exec(`update players set date_of_birth=current_date-interval '24 years' where id='${id.player}'`)
    await db.exec(`update adult_player_account_links set status='revoked'`); await denied()
  } finally { await db.close() }
})

test('adult polls scope audience, team and history, enforce own/watch/closed rules and tally verified votes', async () => {
  const db = await setup()
  const ordinary = uuid(100), award = uuid(101), foreign = uuid(102), staff = uuid(103), old = uuid(104), closed = uuid(105)
  try {
    for (const [pollId, audience, teamId, title, type, status, created] of [
      [ordinary,'parents',id.team,'Travel','text','open','now()'],
      [award,'parents',id.team,'Player of the Match','awards','open','now()'],
      [foreign,'parents',id.otherTeam,'Other team','text','open','now()'],
      [staff,'staff',id.team,'Staff only','text','open','now()'],
      [old,'parents',id.team,'Old discussion','text','open',"now()-interval '3 days'"],
      [closed,'parents',id.team,'Closed','text','closed','now()'],
    ]) await db.query(`insert into polls(id,club_id,team_id,title,audience,poll_type,status,options,created_at)
      values($1,$2,$3,$4,$5,$6,$7,$8,${created})`, [pollId,id.club,teamId,title,audience,type,status,JSON.stringify([{ id:'yes',label:'Yes' },{id:'other',label:'Other'}, { id:'self', playerId:id.player }])])
    const pollRows = () => db.query('select * from get_own_adult_player_polls()')
    assert.deepEqual((await pollRows()).rows.map(poll => poll.id).sort(), [ordinary,award,closed].sort())
    const vote = (poll, option='yes', watched=false) => db.query('select submit_own_adult_player_poll_vote($1,$2,$3) id', [poll,option,watched])
    for (const unavailable of [foreign,staff,old,closed]) await assert.rejects(vote(unavailable), /unavailable|closed/)
    await assert.rejects(vote(ordinary,'self'), /yourself/)
    await assert.rejects(vote(award), /watched/)
    await assert.rejects(vote(ordinary,'missing'), /valid poll answer/)
    const voted = (await vote(ordinary)).rows[0].id
    assert.equal((await vote(ordinary)).rows[0].id, voted)
    await vote(award,'yes',true)
    const readback = (await pollRows()).rows.find(poll => poll.id === ordinary)
    assert.deepEqual(readback.current_option_ids, ['yes'])
    assert.deepEqual(readback.votes, [{ optionId:'yes', count:1 }])
    assert.deepEqual((await db.query('select parent_link_id,auth_user_id,voter_email from poll_votes where id=$1',[voted])).rows[0], { parent_link_id: null, auth_user_id: null, voter_email: null })
    assert.equal((await db.query(`select count(*)::int n from audit_logs where metadata->>'actorAuthUserId'=$1`,[id.user])).rows[0].n, 2)
    await db.exec(`update polls set allow_vote_changes=false where id='${ordinary}'`)
    await assert.rejects(vote(ordinary,'other'), /locked/)
    await db.exec(`update polls set allow_vote_changes=true, allow_multiple=true,max_choices=1 where id='${ordinary}'`)
    await assert.rejects(vote(ordinary,'other'), /maximum/)
    await claims(db,id.denied)
    assert.deepEqual((await pollRows()).rows, [])
    await assert.rejects(vote(ordinary), /unavailable/)
    await claims(db,id.user)
    await db.exec(`select set_config('test.plan_allowed','false',false)`)
    assert.deepEqual((await pollRows()).rows, [])
    await assert.rejects(vote(ordinary), /unavailable/)
  } finally { await db.close() }
})

test('adult direct send passes real notification outbox shape for authorized Coach installations', async () => {
  const db = await setup()
  try {
    const direct = await room(db,'player_staff')
    await db.exec(`insert into users(id,club_id,role,role_rank) values('${id.staff}','${id.club}','coach',20);
      insert into team_staff values('${id.staff}','${id.team}');
      insert into coach_mobile_push_installations values('${uuid(200)}','${id.staff}','${id.staff}');`)
    const sent = (await db.query(`select send_own_adult_player_chat_message($1,'Player message') id`,[direct.id])).rows[0].id
    const intents = (await db.query('select recipient_app,auth_user_id,room_type from parent_chat_mobile_notification_intents where message_id=$1',[sent])).rows
    assert.deepEqual(intents,[{recipient_app:'coach',auth_user_id:id.staff,room_type:'player_staff'}])
  } finally { await db.close() }
})

test('Player and Parent poll choices for the same account stay independent and both count', async () => {
  const db = await setup()
  const poll = uuid(300), parentLink = uuid(301)
  try {
    await db.query(`insert into polls(id,club_id,team_id,title,audience,poll_type,status,options)
      values($1,$2,$3,'Travel','parents','text','open','[{"id":"yes"},{"id":"no"}]')`, [poll, id.club, id.team])
    await db.query(`insert into parent_player_links(id,player_id,auth_user_id,email,status,club_id,team_id)
      values($1,$2,$3,'adult@example.test','active',$4,$5)`, [parentLink, id.child, id.user, id.club, id.team])
    await db.query(`insert into poll_votes(poll_id,club_id,team_id,auth_user_id,voter_email,voter_name,option_id,parent_link_id)
      values($1,$2,$3,$4,'adult@example.test','Guardian','yes',$5)`, [poll, id.club, id.team, id.user, parentLink])

    const fetchState = async () => (await db.query('select * from get_own_adult_player_polls()')).rows[0]
    assert.deepEqual((await fetchState()).current_option_ids, [])
    await db.query(`select submit_own_adult_player_poll_vote($1,'yes')`, [poll])
    assert.deepEqual((await fetchState()).votes, [{ optionId: 'yes', count: 2 }])
    await db.query(`select submit_own_adult_player_poll_vote($1,'no')`, [poll])

    // The existing Parent account/email predicates and conflict target cannot
    // read, replace or collide with the Player receipt.
    const legacyRows = await db.query(`select option_id from poll_votes where poll_id=$1
      and (auth_user_id=$2 or voter_email='adult@example.test')`, [poll, id.user])
    assert.deepEqual(legacyRows.rows, [{ option_id: 'yes' }])
    await db.query('delete from poll_votes where poll_id=$1 and auth_user_id=$2', [poll, id.user])
    await db.query(`insert into poll_votes(poll_id,club_id,team_id,auth_user_id,voter_email,voter_name,option_id,parent_link_id)
      values($1,$2,$3,$4,'adult@example.test','Guardian','no',$5)
      on conflict(poll_id,voter_email,option_id) do update set auth_user_id=excluded.auth_user_id`,
    [poll, id.club, id.team, id.user, parentLink])
    assert.deepEqual((await fetchState()).current_option_ids, ['no'])
    assert.deepEqual((await fetchState()).votes, [{ optionId: 'no', count: 2 }])
  } finally { await db.close() }
})
