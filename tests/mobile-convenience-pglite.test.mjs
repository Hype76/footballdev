import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'
import { PGlite } from '@electric-sql/pglite'

const migration = await readFile(new URL('../supabase/migrations/20260909140024_squad_templates_and_pinned_event_notes.sql', import.meta.url), 'utf8')
const authoritySource = await readFile(new URL('../supabase/migrations/20260720173941_p2_privileged_function_authority_hardening.sql', import.meta.url), 'utf8')
const authority = authoritySource.slice(authoritySource.indexOf('create or replace function app_private.actor_can_manage_team_resource'), authoritySource.indexOf('create or replace function app_private.seed_default_club_roles_impl'))
const notes = await readFile(new URL('../supabase/migrations/20260827094500_parent_calendar_event_notes_read_model.sql', import.meta.url), 'utf8')
const id = value => `20000000-0000-4000-8000-${String(value).padStart(12, '0')}`

async function database() {
  const db = new PGlite()
  await db.exec(`
    create schema auth; create schema app_private;
    create role anon; create role authenticated; create role service_role;
    create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid $$;
    create table public.clubs(id uuid primary key,status text default 'active');
    create table public.users(id uuid primary key,club_id uuid,role text,role_rank integer,status text default 'active');
    create table public.user_club_memberships(auth_user_id uuid,club_id uuid,role text,role_rank integer);
    create table public.teams(id uuid primary key,club_id uuid,archived_at timestamptz,status text default 'active');
    create table public.team_staff(team_id uuid,user_id uuid);
    create table public.players(id uuid primary key,club_id uuid,team_id uuid,archived_at timestamptz,status text default 'active');
    create table public.parent_player_links(id uuid primary key,auth_user_id uuid,club_id uuid,team_id uuid,player_id uuid,status text default 'active');
    create table public.calendar_events(id uuid primary key,club_id uuid,team_id uuid,notes text,parent_visible boolean,parent_audience text,cancelled_at timestamptz);
    create table public.calendar_event_invites(calendar_event_id uuid,club_id uuid,team_id uuid,player_id uuid,invite_status text,cancelled_at timestamptz);
    create table public.coach_mobile_notification_events(id bigint primary key,auth_user_id uuid,club_id uuid,team_id uuid,title text,body text,data jsonb,created_at timestamptz default now());
    insert into clubs(id) values('${id(1)}'),('${id(2)}');
    insert into teams(id,club_id) values('${id(3)}','${id(1)}'),('${id(4)}','${id(2)}');
    insert into users(id,club_id,role,role_rank) values('${id(5)}','${id(1)}','coach',20),('${id(6)}','${id(1)}','coach',20),('${id(7)}','${id(1)}','parent_portal',0);
    insert into user_club_memberships select id,club_id,role,role_rank from users;
    insert into team_staff values('${id(3)}','${id(5)}'),('${id(3)}','${id(6)}');
    insert into players(id,club_id,team_id) values('${id(8)}','${id(1)}','${id(3)}'),('${id(9)}','${id(2)}','${id(4)}');
    insert into parent_player_links(id,auth_user_id,club_id,team_id,player_id) values('${id(10)}','${id(7)}','${id(1)}','${id(3)}','${id(8)}');
    insert into calendar_events values('${id(11)}','${id(1)}','${id(3)}','Bring water',true,'all_team_parents',null),('${id(12)}','${id(1)}','${id(3)}','Private note',false,'none',null);
    insert into coach_mobile_notification_events(id,auth_user_id,club_id,team_id,title,body,data) values
      (1,'${id(5)}','${id(1)}','${id(3)}','Availability','A response arrived','{}'),
      (2,'${id(6)}','${id(1)}','${id(3)}','Other Coach','Private','{}'),
      (3,'${id(5)}','${id(2)}','${id(4)}','Other club','Private','{}');
  `)
  await db.exec(authority); await db.exec(notes); await db.exec(migration)
  return db
}
async function actor(db, value) { await db.query("select set_config('request.jwt.claim.sub',$1,false)", [value ? id(value) : '']); await db.exec('set role authenticated') }
async function templates(db, action='list', name='', ids=[]) { return (await db.query('select public.own_coach_squad_templates($1,$2,$3,$4::uuid[]) as items',[id(3),action,name,ids.map(id)])).rows[0].items }

test('templates persist by Coach and team with authorised roster validation, replacement and deletion', async () => {
  const db = await database()
  try {
    await actor(db,5)
    assert.deepEqual(await templates(db),[])
    assert.equal((await templates(db,'save','Regular squad',[8,8]))[0].playerIds.length,1)
    assert.equal((await templates(db,'save','Regular squad',[8])).length,1)
    await assert.rejects(templates(db,'save','Wrong team',[9]),/current players/)
    await assert.rejects(templates(db,'save','Empty',[]),/current players/)
    await assert.rejects(templates(db,'save','x'.repeat(61),[8]),/template name/)
    await assert.rejects(db.query('select * from app_private.coach_squad_templates'),/permission denied/)
    await actor(db,6); assert.deepEqual(await templates(db),[])
    await actor(db,7); await assert.rejects(templates(db),/Coach access/)
    await actor(db,5); assert.equal((await templates(db))[0].name,'Regular squad')
    assert.deepEqual(await templates(db,'delete','Regular squad'),[])
    await db.exec('reset role'); await db.query('delete from team_staff where user_id=$1',[id(5)])
    await actor(db,5); await assert.rejects(templates(db),/Coach access/)
    await db.exec('set role anon'); await assert.rejects(templates(db),/permission denied/)
  } finally { await db.close() }
})

test('pinned notes preserve parent visibility and active link restrictions', async () => {
  const db = await database()
  try {
    await db.exec('update calendar_events set notes_pinned=true')
    await actor(db,7)
    const query = () => db.query('select * from public.get_parent_portal_calendar_event_details_v2($1)',[id(10)])
    assert.deepEqual((await query()).rows,[{id:id(11),notes:'Bring water',notes_pinned:true}])
    await actor(db,5); assert.deepEqual((await query()).rows,[])
    await db.exec('reset role'); await db.exec("update parent_player_links set status='revoked'")
    await actor(db,7); assert.deepEqual((await query()).rows,[])
    await db.exec('set role anon'); await assert.rejects(query(),/permission denied/)
  } finally { await db.close() }
})

test('Coach notification history is own-account and current-context scoped after access revocation', async () => {
  const db=await database()
  try {
    const query=()=>db.query('select * from public.get_own_coach_notification_history($1,$2)',[id(1),id(3)])
    await actor(db,5); assert.deepEqual((await query()).rows.map(row=>row.id),[1])
    await actor(db,6); assert.deepEqual((await query()).rows.map(row=>row.id),[2])
    await actor(db,7); await assert.rejects(query(),/Active Coach/)
    await db.exec('reset role'); await db.query("update users set status='suspended' where id=$1",[id(5)])
    await actor(db,5); await assert.rejects(query(),/Active Coach/)
  } finally { await db.close() }
})
