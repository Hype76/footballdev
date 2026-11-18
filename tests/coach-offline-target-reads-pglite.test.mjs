import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'
import { PGlite } from '@electric-sql/pglite'

const migration = await readFile(new URL('../supabase/migrations/20261118125500_coach_account_offline_scoped_reads.sql', import.meta.url), 'utf8')
const id = value => `10000000-0000-4000-8000-${String(value).padStart(12, '0')}`
const actor=id(1), other=id(2), home=id(10), away=id(11), homeTeam=id(20), awayTeam=id(21), unassigned=id(22)

async function createDatabase() {
  const db = new PGlite()
  await db.exec(`
    create role anon; create role authenticated; create role service_role;
    create schema auth; create schema app_private;
    create function auth.uid() returns uuid language sql stable as $$select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid$$;
    create table auth.users(id uuid primary key,email_confirmed_at timestamptz default now(),banned_until timestamptz,deleted_at timestamptz);
    create table public.users(id uuid primary key,club_id uuid,role text,status text default 'active',role_rank integer default 30);
    create table public.clubs(id uuid primary key,name text,plan_key text default 'club',plan_status text default 'active',status text default 'active',archived_at timestamptz,logo_url text,theme_accent text,theme_button_style text);
    create table public.teams(id uuid primary key,club_id uuid,name text,status text default 'active',archived_at timestamptz);
    create table public.user_club_memberships(auth_user_id uuid,club_id uuid,role text,role_rank integer);
    create table public.team_staff(user_id uuid,team_id uuid,role_key text default 'coach',role_rank integer default 30);
    create table public.players(id uuid primary key,club_id uuid,team_id uuid,player_name text,status text default 'active',section text default 'Squad',parent_email text,notes text,token_hash text,internal_secret text);
    create table public.player_team_memberships(player_id uuid,club_id uuid,team_id uuid,status text default 'active');
    create table public.club_player_types(id uuid,club_id uuid,name text);
    create table public.parent_player_links(id uuid,club_id uuid,team_id uuid,player_id uuid,status text,email text,invite_token text);
    create table public.staff_chat_conversations(id uuid,club_id uuid,team_id uuid,player_id uuid,type text);
    create table public.staff_chat_members(id uuid,conversation_id uuid,club_id uuid,user_id uuid,archived_at timestamptz);
    create table public.staff_chat_messages(id uuid,club_id uuid,conversation_id uuid,body text,deleted_at timestamptz);
    alter table public.players add column shirt_number text;
    create table public.match_days(id uuid,club_id uuid,team_id uuid,match_date date,motm_poll_id uuid);
    create table public.match_day_events(id uuid,match_day_id uuid,event_type text,team_side text,scorer_name text,assist_name text);
    create table public.poll_votes(id uuid,poll_id uuid,option_id text);
    create table public.disabled_features(club_id uuid,feature text);
    create function auth.role() returns text language sql stable as $$select nullif(current_setting('request.jwt.claim.role',true),'')$$;
    alter table public.match_days add column deleted_at timestamptz,add column status text;
    create table public.evaluations(id uuid,club_id uuid,team_id uuid,player_id uuid,date date,comments jsonb);
    create table public.evaluation_drafts(id uuid,club_id uuid,team_id uuid,created_by_user_id uuid,status text,draft_data jsonb);
    create table public.feedback_forms(id uuid,club_id uuid,team_id uuid,created_by uuid,access_scope text,archived_at timestamptz,name text);
    create table public.form_fields(id uuid,club_id uuid,team_id uuid,is_enabled boolean);
    create table public.feedback_form_starter_templates(id uuid,is_current boolean);
    create table public.feedback_form_starter_preferences(id uuid,club_id uuid,team_id uuid);
    create table public.assessment_sessions(id uuid,club_id uuid,team_id uuid,created_by uuid);
    create table public.assessment_session_players(id uuid,session_id uuid,player_id uuid);
    create table public.calendar_events(id uuid,club_id uuid,team_id uuid,event_type text,recurrence_frequency text);
    create table public.match_locations(id uuid,club_id uuid,archived_at timestamptz);
    create table public.match_day_shootout_kicks(id uuid,match_day_id uuid);
    create table public.match_day_player_availability(id uuid,match_day_id uuid);
    create table public.match_day_player_squad_decisions(id uuid,match_day_id uuid);
    create table public.match_day_availability_requests(id uuid,match_day_id uuid,token_hash text);
    create table public.match_day_role_assignments(id uuid,match_day_id uuid);
    create table public.match_day_scorer_interest(id uuid,match_day_id uuid);
    create table public.match_day_scorer_assignments(id uuid,match_day_id uuid);
    create table public.match_day_final_reports(id uuid,match_day_id uuid);
    create table public.match_day_starting_squads(id uuid,club_id uuid,team_id uuid,match_day_id uuid,player_ids jsonb);
    create table public.resource_library_items(id uuid,club_id uuid,team_id uuid,archived_at timestamptz,expires_at timestamptz,storage_bucket text,storage_path text,resource_type text,mime_type text,file_size_bytes integer,updated_at timestamptz);
    create table public.resource_library_links(id uuid,resource_id uuid,removed_at timestamptz);
    create table public.resource_library_external_links(id uuid,resource_id uuid,external_url text);
    create table public.parent_chat_rooms(id uuid,club_id uuid,team_id uuid,status text,room_type text);
    create table public.parent_chat_messages(id uuid,room_id uuid,body text,deleted_at timestamptz);
    create table public.parent_chat_memberships(id uuid,room_id uuid,auth_user_id uuid);
    create table public.communication_logs(id uuid,club_id uuid,player_id uuid,user_id uuid,metadata jsonb);
    create table public.polls(id uuid,club_id uuid,team_id uuid,hide_votes boolean);
    alter table public.poll_votes add club_id uuid,add team_id uuid,add auth_user_id uuid,add voter_name text,add voter_email text;
    create table public.calendar_event_invites(id uuid,club_id uuid,team_id uuid);
    create table public.training_availability_requests(id uuid,club_id uuid,team_id uuid);
    create table public.training_availability_request_players(id uuid,club_id uuid,team_id uuid,email_queue_id uuid);
    create table public.scheduled_email_queue(id uuid,delivery_state text);
    create table public.training_availability_responses(id uuid,club_id uuid,team_id uuid);
    create table public.training_coach_attendance(id uuid,club_id uuid,team_id uuid,is_visible boolean default true);
    create table public.formation_boards(id uuid,club_id uuid,team_id uuid,deleted_at timestamptz,archived_at timestamptz,visibility_state text,created_by_profile_id uuid,current_version_id uuid,current_publication_id uuid);
    create table public.formation_board_versions(id uuid,board_id uuid,shirt_kit jsonb);
    create table public.formation_board_publications(id uuid);
    create table public.formation_board_presets(registry_version integer,preset_key text,readiness_state text);
    create table public.formation_board_match_publications(id uuid,club_id uuid,team_id uuid,board_id uuid,board_version_id uuid);
    create function public.can_use_plan_feature(club uuid,feature text) returns boolean language sql stable as $$select not exists(select 1 from public.disabled_features d where d.club_id=$1 and d.feature=$2)$$;
    create function public.workspace_scope_for_plan_key(plan text) returns text language sql immutable as $$select plan$$;
    create function public.current_user_can_access_team(club uuid,team uuid) returns boolean language sql stable as $$select exists(select 1 from public.users u where u.id=auth.uid() and u.club_id=club and u.status='active')$$;
    create function public.current_user_can_access_parent_team(team uuid) returns boolean language sql stable as $$select false$$;
    create function public.list_fan_connections() returns jsonb language sql stable as $$select '[]'::jsonb$$;
    create function public.get_own_adult_player_account_state() returns table(team_id uuid,club_id uuid,access_granted boolean) language sql stable as $$select null::uuid,null::uuid,false$$;
    create function app_private.paid_team_colour_entitled(club uuid) returns boolean language sql stable as $$select false$$;
    create table app_private.first_250_branding_entries(team_id uuid,club_id uuid,state text,started_at timestamptz,deadline_at timestamptz,cohort text);
    create table app_private.first_250_team_branding(team_id uuid,club_id uuid,logo_url text,theme_accent text,theme_button_style text);
    create table app_private.first_250_branding_offer(release_enabled boolean);
    insert into auth.users(id) values ('${actor}'),('${other}');
    insert into public.users(id,club_id,role) values ('${actor}','${home}','coach'),('${other}','${away}','coach');
    insert into public.clubs(id,name,logo_url) values ('${home}','Home','https://example.test/home.png'),('${away}','Away','https://example.test/away.png');
    insert into public.teams(id,club_id,name) values ('${homeTeam}','${home}','Home'),('${awayTeam}','${away}','Away'),('${unassigned}','${away}','Unassigned');
    insert into public.user_club_memberships values ('${actor}','${home}','coach',30),('${actor}','${away}','coach',30),('${other}','${away}','coach',30);
    insert into public.team_staff(user_id,team_id) values ('${actor}','${homeTeam}'),('${actor}','${awayTeam}');
    alter table public.players enable row level security;
    grant select on public.players to authenticated;
    create policy selected_only on public.players for select to authenticated using(club_id=(select u.club_id from public.users u where u.id=auth.uid()));
    grant select on public.users to authenticated;
    grant usage on schema auth to authenticated;
  `)
  const formations=await readFile(new URL('../supabase/migrations/20260802130700_formation_board_foundation_25a.sql',import.meta.url),'utf8')
  for(const name of ['formation_board_team_role_rank','formation_board_is_club_admin','formation_board_can_view','formation_board_payload']) {
    const start=formations.indexOf('create or replace function app_private.'+name+'(')
    await db.exec(formations.slice(start,formations.indexOf('$$;',start)+3))
  }
  await db.exec(migration)
  await db.exec(`set request.jwt.claim.sub='${actor}'`)
  return db
}

test('secondary context reads and branding use own current membership without changing selected club or ordinary RLS', async () => {
  const db=await createDatabase()
  try {
    await db.exec(`insert into public.players(id,club_id,team_id,player_name,status,section,parent_email,notes,token_hash,internal_secret) values ('${id(100)}','${away}','${awayTeam}','Away Player','active','Squad','parent@example.test','Player notes','TOKEN','SECRET'); insert into public.player_team_memberships values ('${id(100)}','${away}','${awayTeam}','active')`)
    const page=(await db.query('select public.get_own_coach_offline_resource($1,$2,$3) as value',[away,awayTeam,'players'])).rows[0].value
    assert.equal(page.complete,true)
    assert.equal(page.totalCount,1)
    assert.equal(page.items[0].data.player_name,'Away Player')
    assert.doesNotMatch(JSON.stringify(page),/TOKEN|SECRET|token_hash|internal_secret/)
    const branding=(await db.query('select public.get_team_branding_display($1,$2) as value',[awayTeam,away])).rows[0].value
    assert.equal(branding.logoUrl,'https://example.test/away.png')
    assert.equal((await db.query('select club_id from public.users where id=$1',[actor])).rows[0].club_id,home)
    await db.exec('set role authenticated')
    assert.deepEqual((await db.query('select * from public.players')).rows,[])
    await db.exec('reset role')
    for(const [club,team] of [[away,unassigned],[home,awayTeam]]) await assert.rejects(db.query('select public.get_own_coach_offline_resource($1,$2,$3)',[club,team,'players']),/coach_offline_context_denied/)
    await assert.rejects(db.query('select public.get_own_coach_offline_resource($1,$2,$3)',[away,awayTeam,'auth.users']),/resource_unknown/)
    for(const update of [`update public.users set status='suspended' where id='${actor}'`,`delete from public.user_club_memberships where auth_user_id='${actor}' and club_id='${away}'`,`delete from public.team_staff where user_id='${actor}' and team_id='${awayTeam}'`,`update auth.users set email_confirmed_at=null where id='${actor}'`,`update auth.users set banned_until=now()+interval '1 day' where id='${actor}'`,`update auth.users set deleted_at=now() where id='${actor}'`,`update public.teams set archived_at=now() where id='${awayTeam}'`,`update public.clubs set status='inactive' where id='${away}'`]) {
      await db.exec('begin'); await db.exec(update)
      await assert.rejects(db.query('select public.get_own_coach_offline_resource($1,$2,$3)',[away,awayTeam,'players']),/coach_offline_context_denied/)
      await db.exec('rollback')
    }
    const grants=(await db.query("select has_function_privilege('anon','public.get_own_coach_offline_resource(uuid,uuid,text,text)','execute') as anon,has_function_privilege('authenticated','app_private.coach_offline_read_context(uuid,uuid,uuid)','execute') as helper")).rows[0]
    assert.deepEqual(grants,{anon:false,helper:false})
  } finally { await db.close() }
})

test('pagination has no silent cap, binds context and detects data changes between pages', async () => {
  const db=await createDatabase()
  try {
    await db.exec(`insert into public.players(id,club_id,team_id,player_name) select ('20000000-0000-4000-8000-'||lpad(n::text,12,'0'))::uuid,'${away}','${awayTeam}','Player '||n from generate_series(1,405) n;
      insert into public.player_team_memberships select id,club_id,team_id,'active' from public.players;`)
    const load=async cursor=>(await db.query('select public.get_own_coach_offline_resource($1,$2,$3,$4) as value',[away,awayTeam,'players',cursor])).rows[0].value
    const first=await load(null),second=await load(first.nextCursor),third=await load(second.nextCursor)
    assert.deepEqual([first.items.length,second.items.length,third.items.length],[200,200,5])
    assert.deepEqual([first.complete,second.complete,third.complete],[false,false,true])
    assert.equal(third.totalCount,405)
    assert.equal(third.nextCursor,null)
    assert.equal(new Set([...first.items,...second.items,...third.items].map(row=>row.id)).size,405)
    await assert.rejects(db.query('select public.get_own_coach_offline_resource($1,$2,$3,$4)',[home,homeTeam,'players',first.nextCursor]),/cursor_invalid/)
    await db.exec("update public.players set player_name='Changed' where player_name='Player 405'")
    await assert.rejects(load(first.nextCursor),/snapshot_changed/)
    await db.exec(`insert into public.disabled_features values ('${away}','players')`)
    const denied=await load(null)
    assert.equal(denied.items.length,0)
    assert.equal(denied.complete,true)
  } finally { await db.close() }
})

test('branding extension preserves the existing entitlement and expiry calculations verbatim',async()=>{
  const original=await readFile(new URL('../supabase/migrations/20261102162446_single_team_branding_colour.sql',import.meta.url),'utf8')
  const start=original.indexOf('create or replace function public.get_team_branding_display(')
  const expected=original.slice(start,original.indexOf('create or replace function public.save_first_250_team_branding('))
    .replace('if not (coalesce(public.current_user_can_access_team','if not (app_private.coach_offline_read_context(auth.uid(),club_value,team_value) is not null\n    or coalesce(public.current_user_can_access_team')
  assert.equal(migration.slice(migration.indexOf('create or replace function public.get_team_branding_display(')),expected)
})

test('every family executes and target-scoped private templates, own drafts and actual room membership remain enforced',async()=>{
  const db=await createDatabase()
  try {
    await db.exec(`
      insert into public.feedback_forms(id,club_id,team_id,created_by,access_scope,name) values
        ('${id(101)}','${away}','${awayTeam}','${actor}','creator','Own'),
        ('${id(102)}','${away}','${awayTeam}','${other}','creator','Other private'),
        ('${id(103)}','${away}','${awayTeam}','${other}','team','Shared'),
        ('${id(104)}','${home}','${homeTeam}','${actor}','team','Other club');
      insert into public.evaluation_drafts values ('${id(110)}','${away}','${awayTeam}','${actor}','draft','{"notes":"Own notes"}'),('${id(111)}','${away}','${awayTeam}','${other}','draft','{"notes":"SECRET"}');
      insert into public.staff_chat_conversations values ('${id(120)}','${away}','${awayTeam}',null,'team_staff'),('${id(121)}','${away}','${awayTeam}',null,'team_staff');
      insert into public.staff_chat_members(id,conversation_id,club_id,user_id) values ('${id(130)}','${id(120)}','${away}','${actor}'),('${id(131)}','${id(121)}','${away}','${other}');
      insert into public.staff_chat_messages(id,club_id,conversation_id,body) values ('${id(140)}','${away}','${id(120)}','Own room history'),('${id(141)}','${away}','${id(121)}','SECRET');
      insert into public.staff_chat_messages values ('${id(142)}','${away}','${id(120)}','DELETED_SECRET',now());
    `)
    const load=async key=>(await db.query('select public.get_own_coach_offline_resource($1,$2,$3) as value',[away,awayTeam,key])).rows[0].value
    for(const key of ['players','development','sessions','calendar','matches','resources','chat','messages','polls','invites','formations','notifications']) {
      const result=await load(key)
      assert.equal(result.complete,true,key)
      assert.doesNotMatch(JSON.stringify(result),/SECRET|Other private|Other club/)
    }
    const development=await load('development')
    assert.deepEqual(development.items.filter(row=>row.kind==='forms').map(row=>row.data.name),['Own','Shared'])
    assert.equal(development.items.filter(row=>row.kind==='drafts').length,1)
    const chat=await load('chat')
    assert.equal(chat.items.filter(row=>row.kind==='staffRooms').length,1)
    assert.equal(chat.items.filter(row=>row.kind==='staffMessages')[0].data.body,'Own room history')
    await db.exec(`update public.staff_chat_members set archived_at=now() where user_id='${actor}'`)
    assert.equal((await load('chat')).items.length,0)
    await db.exec(`insert into public.disabled_features values ('${away}','customDevelopmentFields')`)
    assert.equal((await load('development')).items.filter(row=>row.kind==='forms').length,0)
  } finally {await db.close()}
})

test('anonymous votes, Parent room assignment, hidden attendance and clubwide feature limits preserve their actual privacy rules',async()=>{
  const db=await createDatabase()
  try {
    const load=async key=>(await db.query('select public.get_own_coach_offline_resource($1,$2,$3) as value',[away,awayTeam,key])).rows[0].value
    await db.exec(`
      insert into public.polls values ('${id(201)}','${away}','${awayTeam}',true);
      insert into public.poll_votes values ('${id(202)}','${id(201)}','one','${away}','${awayTeam}','${actor}','Own name','own@example.test'),('${id(203)}','${id(201)}','two','${away}','${awayTeam}','${other}','Private voter','private@example.test');
      insert into public.parent_chat_rooms values ('${id(210)}','${away}','${awayTeam}','active','team'),('${id(211)}','${away}','${unassigned}','active','team');
      insert into public.parent_chat_messages(id,room_id,body) values ('${id(212)}','${id(210)}','Authorised Parent room'),('${id(213)}','${id(211)}','SECRET');
      insert into public.parent_chat_messages values ('${id(214)}','${id(210)}','DELETED_SECRET',now());
      insert into public.training_coach_attendance values ('${id(220)}','${away}','${awayTeam}',true),('${id(221)}','${away}','${awayTeam}',false);
      insert into public.calendar_events values ('${id(230)}','${away}',null,'general','none'),('${id(231)}','${away}','${awayTeam}','training','none');
    `)
    const votes=(await load('polls')).items.filter(row=>row.kind==='votes').map(row=>row.data)
    assert.equal(votes[0].auth_user_id,actor)
    assert.equal(votes[1].auth_user_id,undefined)
    assert.doesNotMatch(JSON.stringify(votes),/voter_name|voter_email|Private voter|private@example/)
    const chat=await load('chat')
    assert.equal(chat.items.filter(row=>row.kind==='parentMessages').length,2)
    assert.equal(chat.items.find(row=>row.id===id(214)).data.body,'')
    assert.doesNotMatch(JSON.stringify(chat),/SECRET/)
    assert.equal((await load('invites')).items.filter(row=>row.kind==='coachAttendance').length,1)
    await db.exec(`insert into public.disabled_features values ('${away}','clubWideEvents')`)
    assert.deepEqual((await load('calendar')).items.filter(row=>row.kind==='calendarEvents').map(row=>row.id),[id(231)])
    await db.exec(`update public.user_club_memberships set role='admin',role_rank=90 where auth_user_id='${actor}' and club_id='${away}'; delete from public.team_staff where user_id='${actor}' and team_id='${awayTeam}'`)
    assert.equal((await load('chat')).items.filter(row=>row.kind==='parentRooms').length,0,'club admin without explicit Team assignment cannot enumerate Parent rooms')
  }finally{await db.close()}
})

test('actual service-only file source revalidates target authority, expiry, archived state and exact authoritative object scope',async()=>{
  const db=await createDatabase()
  try {
    await db.exec(`insert into public.resource_library_items(id,club_id,team_id,storage_bucket,storage_path,mime_type,file_size_bytes) values ('${id(300)}','${away}','${awayTeam}','resource-library','${away}/${awayTeam}/file.pdf','application/pdf',100);
      set request.jwt.claim.role='service_role';`)
    const load=()=>db.query('select public.get_coach_offline_file_source($1,$2,$3,$4) as value',[actor,away,awayTeam,id(300)])
    assert.equal((await load()).rows[0].value.storage_path,`${away}/${awayTeam}/file.pdf`)
    for(const change of [`update public.resource_library_items set archived_at=now()`,`update public.resource_library_items set expires_at=now()-interval '1 day'`,`update public.resource_library_items set storage_path='${home}/${homeTeam}/foreign.pdf'`,
      `insert into public.resource_library_external_links values ('${id(301)}','${id(300)}','https://external.test')`,`delete from public.team_staff where user_id='${actor}' and team_id='${awayTeam}'`]) {
      await db.exec('begin');await db.exec(change)
      await assert.rejects(load(),/file_denied/)
      await db.exec('rollback')
    }
    await db.exec("set request.jwt.claim.role='authenticated'")
    await assert.rejects(load(),/file_denied/)
    assert.equal((await db.query("select has_function_privilege('authenticated','public.get_coach_offline_file_source(uuid,uuid,uuid,uuid)','execute') as allowed")).rows[0].allowed,false)
  }finally{await db.close()}
})

test('kit source authorizes the actual immutable saved version and rejects private, foreign or archived boards and client path guesses',async()=>{
  const db=await createDatabase()
  try {
    const board=id(400),version=id(401),path=`${away}/home/kit.png`
    await db.exec(`insert into public.formation_boards(id,club_id,team_id,visibility_state,created_by_profile_id,current_version_id) values ('${board}','${away}','${awayTeam}','shared','${other}','${version}');
      insert into public.formation_board_versions values ('${version}','${board}','{"type":"home","imagePath":"${path}"}');set request.jwt.claim.role='service_role'`)
    const load=()=>db.query('select public.get_coach_offline_kit_source($1,$2,$3,$4) as value',[actor,away,awayTeam,version])
    assert.equal((await load()).rows[0].value.storage_path,path)
    for(const change of [`update public.formation_boards set visibility_state='draft'`,`update public.formation_boards set archived_at=now()`,
      `update public.formation_board_versions set shirt_kit='{"type":"home","imagePath":"${home}/home/kit.png"}'`,
      `update public.formation_board_versions set shirt_kit='{"type":"home","imagePath":"${away}/home/../kit.png"}'`,
      `delete from public.user_club_memberships where auth_user_id='${actor}' and club_id='${away}'`]) {
      await db.exec('begin');await db.exec(change);await assert.rejects(load(),/kit_denied/);await db.exec('rollback')
    }
    assert.equal((await db.query("select has_function_privilege('authenticated','public.get_coach_offline_kit_source(uuid,uuid,uuid,uuid)','execute') as allowed")).rows[0].allowed,false)
  }finally{await db.close()}
})
