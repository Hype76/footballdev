import assert from 'node:assert/strict'
import test from 'node:test'
import { readFile } from 'node:fs/promises'
import { PGlite } from '@electric-sql/pglite'

const migration = await readFile(new URL('../supabase/migrations/20260903162403_guest_scorer_events_and_branding.sql', import.meta.url), 'utf8')
const guestSource = await readFile(new URL('../supabase/migrations/20260902151551_guest_match_day_scorer.sql', import.meta.url), 'utf8')
const fixture = '60000000-0000-4000-8000-000000000001'
const foreignFixture = '60000000-0000-4000-8000-000000000002'
const club = '10000000-0000-4000-8000-000000000001'
const team = '20000000-0000-4000-8000-000000000001'
const parent = '30000000-0000-4000-8000-000000000001'
const coach = '30000000-0000-4000-8000-000000000002'
const link = '50000000-0000-4000-8000-000000000001'

test('scorer event database enforces guest/parent scope, roster, replay, lifecycle and audit attribution', async () => {
  const db = new PGlite()
  try {
    const baseline = await readFile(new URL('./matchday-parent-scorer-hardening-db.test.mjs', import.meta.url), 'utf8')
    await db.exec(baseline.match(/const schemaSql = `([\s\S]*?)`;/)[1])
    await db.exec(`
      create schema private;
      alter table public.users add column name text default '', add column email text default '', add column role_rank integer default 30;
      alter table public.players add column player_name text, add column shirt_number text, add column archived_at timestamptz;
      alter table public.clubs add column name text, add column logo_url text, add column theme_accent text, add column timezone_name text default 'Europe/London';
      alter table public.teams add column name text;
      alter table public.match_days add column opponent text, add column match_date date default current_date, add column current_match_phase text default 'first_half', add column match_conclusion_rule text default 'normal_time', add column extra_time_half_minutes integer default 5, add column extra_time_period_count integer default 2, add column home_shootout_score integer default 0, add column away_shootout_score integer default 0, add column notification_revision integer default 1;
      alter table public.match_day_events add column is_penalty_goal boolean default false, add column is_own_goal boolean default false, add column match_phase text, add column phase_order integer, add column request_id uuid, add column stoppage_minute integer, add column event_sequence bigint;
      create unique index event_request on public.match_day_events(match_day_id,request_id);
      create table public.team_staff(team_id uuid,user_id uuid);
      alter table public.match_day_role_assignments add column updated_at timestamptz default now();
      create table public.match_day_player_squad_decisions(match_day_id uuid,club_id uuid,team_id uuid,player_id uuid,status text);
      create function public.match_day_phase_order(text) returns integer language sql as $$ select 10 $$;
      create function public.match_day_local_date_is_today(uuid) returns boolean language sql as $$ select match_date=current_date from public.match_days where id=$1 $$;
      create function private.is_guest_match_scorer(uuid) returns boolean language sql as $$ select coalesce(current_setting('test.guest_match',true)=$1::text,false) $$;
      create function private.guest_match_scorer_name(uuid) returns text language sql as $$ select 'FP TEST guest' $$;
      create function public.current_user_is_match_day_scorer(uuid) returns boolean language sql as $$ select exists(select 1 from public.match_day_role_assignments a join public.match_days m on m.id=a.match_day_id where m.id=$1 and a.auth_user_id=auth.uid() and m.match_date=current_date and m.concluded_at is null) $$;
      insert into public.clubs(id,name,logo_url,theme_accent) values('${club}','FP TEST Club','https://example.test/crest.png','#123456');
      insert into public.teams values('${team}','${club}','FP TEST Team');
      insert into public.users(id,club_id,role,name) values('${parent}','${club}','parent_portal','Parent'),('${coach}','${club}','coach','Coach');
      insert into public.match_days(id,club_id,team_id,status,timer_status,match_duration_minutes) values('${fixture}','${club}','${team}','live','running',10),('${foreignFixture}','${club}','${team}','live','running',10);
      insert into public.players(id,club_id,team_id,player_name,shirt_number) values('40000000-0000-4000-8000-000000000001','${club}','${team}','Clyde Bates','4'),('40000000-0000-4000-8000-000000000002','${club}','${team}','Alex','9'),('40000000-0000-4000-8000-000000000003','${club}','${team}','Unselected','8');
      insert into public.match_day_player_squad_decisions select '${fixture}','${club}','${team}',id,'selected' from public.players where player_name<>'Unselected';
      insert into public.parent_player_links(id,club_id,team_id,player_id,auth_user_id) values('${link}','${club}','${team}','40000000-0000-4000-8000-000000000001','${parent}');
      insert into public.match_day_role_assignments(match_day_id,club_id,team_id,role,parent_link_id,auth_user_id) values('${fixture}','${club}','${team}','scorer','${link}','${parent}');
      insert into public.match_day_scorer_assignments(match_day_id,club_id,team_id,parent_link_id,auth_user_id) values('${fixture}','${club}','${team}','${link}','${parent}');
    `)
    await db.exec(guestSource.match(/CREATE OR REPLACE FUNCTION public.resolve_match_day_mutation_actor[\s\S]*?\$function\$\s*;/)[0])
    await db.exec(migration.slice(0, migration.indexOf('create or replace function public.guest_match_day_scoring')))
    const pushSource = await readFile(new URL('../supabase/migrations/20260731110000_fp_v1_gameday_scorer_authority_02a.sql', import.meta.url), 'utf8')
    await db.exec(pushSource.match(/create or replace function public.authorize_match_day_push\([\s\S]*?\$\$;/)[0])
    await db.exec(migration.slice(migration.indexOf('-- Keep staff delivery unchanged.')))
    let command = 1
    const save = (changes = {}) => {
      const values = { match: fixture, type: 'yellow_card', side: 'club', minute: 5, name: 'Clyde Bates', shirt: '4', onName: '', onShirt: '', request: `70000000-0000-4000-8000-${String(command++).padStart(12, '0')}`, link: null, added: 2, ...changes }
      return db.query('select public.record_match_day_scorer_event_v1($1,$2,$3,$4,$5,$6,$7,$8,\'\',$9,$10,$11) as event', [values.match,values.type,values.side,values.minute,values.name,values.shirt,values.onName,values.onShirt,values.request,values.link,values.added])
    }
    await assert.rejects(save(), /Login is required/)
    await db.query("select set_config('test.guest_match',$1,false)", [fixture])
    const request = '70000000-0000-4000-8000-000000000099'
    const yellow = (await save({ request })).rows[0].event
    assert.equal(yellow.created_by, null)
    assert.equal(yellow.created_by_name, 'FP TEST guest')
    assert.equal(yellow.stoppage_minute, 2)
    assert.equal((await save({ request })).rows[0].event.id, yellow.id)
    await assert.rejects(save({ request, type: 'red_card' }), /different change/)
    await assert.rejects(save({ match: foreignFixture }), /Login is required/)
    await assert.rejects(save({ name: 'Unselected', shirt: '8' }), /selected Match squad/)
    await assert.rejects(save({ type: 'substitution', onName: 'Clyde Bates', onShirt: '4' }), /different Player On/)
    const sub = (await save({ type: 'substitution', onName: 'Alex', onShirt: '9' })).rows[0].event
    assert.equal(sub.assist_name, 'Alex')
    await assert.rejects(save({ type: 'delete_club' }), /supported Match Day event/)
    await assert.rejects(save({ added: 31 }), /Added time/)
    const snapshot = (await db.query('select private.guest_match_snapshot($1) as match', [fixture])).rows[0].match
    assert.equal(snapshot.clubLogoUrl, 'https://example.test/crest.png')
    assert.equal(snapshot.themeAccent, '#123456')
    assert.equal(snapshot.matchDurationMinutes, 10)
    assert.equal(snapshot.events.length, 2)
    assert.equal(snapshot.events.some((event) => event.eventType === 'substitution'), true)
    assert.equal(snapshot.players.length, 2)
    assert.doesNotMatch(JSON.stringify(snapshot), /auth_user|parentLink|email/)
    await db.exec("select set_config('test.guest_match','',false)")
    await db.query("select set_config('request.jwt.claim.sub',$1,false)", [parent])
    await assert.rejects(save(), /selected scorer/)
    await assert.rejects(save({ link, match: foreignFixture }), /selected scorer/)
    const red = (await save({ link, type: 'red_card' })).rows[0].event
    assert.equal(red.created_by, parent)
    assert.equal(red.created_by_parent_link_id, link)
    const push = (actor, parentLink, eventId, type = 'red_card', matchId = fixture) => db.query('select public.authorize_match_day_scorer_event_push($1,$2,$3,$4,$5) as result', [actor,matchId,parentLink,type,eventId])
    assert.equal((await push(parent,link,red.id)).rows[0].result.allowed,true)
    assert.equal((await push(coach,link,red.id)).rows[0].result.allowed,false)
    assert.equal((await push(parent,link,yellow.id,'yellow_card')).rows[0].result.allowed,false)
    assert.equal((await push(parent,link,red.id,'red_card',foreignFixture)).rows[0].result.allowed,false)
    assert.equal((await push(parent,link,red.id,'substitution')).rows[0].result.allowed,false)
    assert.equal((await db.query("select actor_role from public.match_day_event_log where metadata->>'matchEventId'=$1", [red.id])).rows[0].actor_role, 'scorer_parent')
    await db.query("select set_config('request.jwt.claim.sub',$1,false)", [coach])
    assert.equal((await save()).rows[0].event.created_by, coach)
    await db.query("update public.match_days set timer_status='full_time',status='full_time' where id=$1", [fixture])
    await assert.rejects(save(), /Start or resume/)
    await db.exec('set role anon')
    await assert.rejects(save(), /permission denied/)
  } finally { await db.close() }
})

test('guest event gateway keeps hashed capability and match scope, and exposes no fixture edit action', () => {
  assert.match(migration, /when 'event' then g:=public.record_match_day_scorer_event_v1\(m.id/)
  assert.match(migration, /when 'remove_event'[\s\S]*and match_day_id=m.id/)
  assert.match(migration, /prior.action<>action or prior.input<>details/)
  assert.doesNotMatch(migration, /set_config\('request.jwt|when 'update_fixture'/)
})
