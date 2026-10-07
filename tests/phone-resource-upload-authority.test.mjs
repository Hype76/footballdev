import assert from 'node:assert/strict'
import test from 'node:test'
import { readFile } from 'node:fs/promises'
import { PGlite } from '@electric-sql/pglite'

const prior = await readFile('supabase/migrations/20261007071022_coach_team_administration_reminders.sql', 'utf8')
const helper = prior.match(/create function app_private\.team_admin_can_manage[\s\S]*?revoke all on function app_private\.team_admin_can_manage[^;]*;/)[0]
const section = (await readFile('supabase/migrations/20261007114801_phone_team_coach_roster_removal.sql', 'utf8'))
  .split('-- BEGIN PHONE RESOURCE UPLOAD AUTHORITY')[1].split('-- END PHONE RESOURCE UPLOAD AUTHORITY')[0]
const normalizeOwner = 'alter function app_private.team_admin_can_manage(uuid,uuid) owner to postgres;'
const id = n => `30000000-0000-4000-8000-${String(n).padStart(12, '0')}`

test('real resource RPC survives earlier helper ownership drift without granting direct helper access', async t => {
  const db = new PGlite(); t.after(() => db.close())
  await db.exec(`create role anon;create role authenticated;create role service_role bypassrls;create role rehearsal_admin;create role rehearsal_caller;
    create schema auth;create schema app_private;
    create table auth.users(id uuid primary key,email_confirmed_at timestamptz default now(),banned_until timestamptz);
    create table clubs(id uuid primary key,status text default 'active',archived_at timestamptz);
    create table teams(id uuid primary key,club_id uuid,status text default 'active',archived_at timestamptz);
    create table users(id uuid primary key,club_id uuid,status text default 'active',role text,role_rank integer,role_label text);
    create table user_club_memberships(auth_user_id uuid,club_id uuid,role text,role_rank integer);
    create table team_staff(id uuid primary key,team_id uuid,user_id uuid,role_key text,role_rank integer,role_label text);
    create function auth.uid() returns uuid language sql as $$select '${id(1)}'::uuid$$;
    create function public.current_user_club_id() returns uuid language sql as $$select '${id(10)}'::uuid$$;
    create function public.current_user_role() returns text language sql as $$select 'coach'::text$$;
    create function public.current_user_role_rank() returns integer language sql as $$select 30$$;
    create function public.resource_library_user_can_access_team(uuid,uuid,uuid) returns boolean language sql as $$select true$$;
    create function public.is_club_plan_access_active(uuid) returns boolean language sql as $$select true$$;
    create function public.can_use_plan_feature(uuid,text) returns boolean language sql as $$select true$$;
    insert into auth.users(id) values('${id(1)}');insert into clubs(id) values('${id(10)}');
    insert into teams(id,club_id) values('${id(20)}','${id(10)}');
    insert into users(id,club_id,role,role_rank) values('${id(1)}','${id(10)}','coach',30);
    insert into user_club_memberships select id,club_id,role,role_rank from users;
    insert into team_staff values('${id(30)}','${id(20)}','${id(1)}','head_manager',70,'Team admin');`)
  await db.exec(helper)
  await db.exec('alter function app_private.team_admin_can_manage(uuid,uuid) owner to rehearsal_admin; grant usage on schema auth,app_private to rehearsal_caller; grant select on all tables in schema public,auth to rehearsal_caller;')
  // PGlite cannot demote postgres. A non-superuser owner alias reproduces the
  // hosted privilege shape with unchanged SQL bodies. Native tests use actual owners.
  assert.ok(section.includes(normalizeOwner))
  assert.ok(section.includes('alter function public.current_user_can_manage_resource_library(uuid,uuid) owner to postgres;'))
  await db.exec(section.replace(normalizeOwner, '').replaceAll('owner to postgres', 'owner to rehearsal_caller'))
  const call = () => db.query(`select public.current_user_can_manage_resource_library('${id(10)}','${id(20)}') allowed`)
  await assert.rejects(call(), /permission denied for function team_admin_can_manage/)
  await db.exec(normalizeOwner.replace('owner to postgres', 'owner to rehearsal_caller'))
  assert.equal((await call()).rows[0].allowed, true)
  assert.equal((await db.query(`select public.get_phone_resource_upload_scope('${id(10)}','${id(20)}') scope`)).rows[0].scope.roleRank, 70)
  for (const role of ['anon', 'authenticated', 'service_role']) {
    assert.equal((await db.query(`select has_function_privilege($1,'app_private.team_admin_can_manage(uuid,uuid)','EXECUTE') allowed`, [role])).rows[0].allowed, false)
  }
  await db.exec('set role authenticated')
  assert.equal((await call()).rows[0].allowed, true)
  await db.exec('reset role')
})
