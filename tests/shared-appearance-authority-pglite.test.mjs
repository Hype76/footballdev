import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'
import { PGlite } from '@electric-sql/pglite'

const club = '00000000-0000-4000-8000-000000000001', team = '00000000-0000-4000-8000-000000000011'
const actor = '00000000-0000-4000-8000-000000000099'
const migration = await readFile(new URL('../supabase/migrations/20261007071022_coach_team_administration_reminders.sql', import.meta.url), 'utf8')
const appearance = migration.slice(migration.indexOf('-- BEGIN SHARED APPEARANCE ADMIN BOUNDARIES'), migration.indexOf('-- END SHARED APPEARANCE ADMIN BOUNDARIES'))

test('actual appearance SQL enforces Club and Team admins and preserves Matchday kit authority and offer actors', async () => {
  const db = new PGlite()
  try {
    await db.exec(`
      create schema auth; create schema app_private; create role anon; create role authenticated; create role service_role;
      create table public.clubs(id uuid primary key,plan_key text,status text default 'active',archived_at timestamptz);
      create table public.teams(id uuid primary key,club_id uuid,status text default 'active',archived_at timestamptz,
        home_kit_colour text,away_kit_colour text,theme_mode text,theme_accent text,theme_button_style text);
      create table public.users(id uuid primary key,club_id uuid,role text,role_rank integer,status text default 'active');
      create table auth.users(id uuid primary key,email text,email_confirmed_at timestamptz,banned_until timestamptz);
      create table public.user_club_memberships(auth_user_id uuid,club_id uuid,role text,role_rank integer);
      create table public.team_staff(user_id uuid,team_id uuid,role_key text,role_rank integer);
      insert into public.clubs(id,plan_key) values('${club}','team');
      insert into public.teams(id,club_id) values('${team}','${club}');
      insert into public.users(id,club_id,role,role_rank) values('${actor}','${club}','head_manager',70);
      insert into auth.users values('${actor}','admin@example.test',now(),null);
      insert into public.user_club_memberships values('${actor}','${club}','head_manager',70);
      insert into public.team_staff values('${actor}','${team}','head_manager',70);
      create function auth.uid() returns uuid language sql stable as $$select '${actor}'::uuid$$;
      create function public.current_user_role() returns text language sql stable as $$select role from public.users where id=auth.uid() and status='active'$$;
      create function public.current_user_role_rank() returns integer language sql stable as $$select role_rank from public.users where id=auth.uid() and status='active'$$;
      create function public.current_user_club_id() returns uuid language sql stable as $$select club_id from public.users where id=auth.uid() and status='active'$$;
      create function public.current_user_can_access_team(c uuid,t uuid) returns boolean language sql stable as $$select c=public.current_user_club_id() and t='${team}'::uuid$$;
      create function public.current_user_team_role_rank(t uuid) returns integer language sql stable as $$select role_rank from public.team_staff where user_id=auth.uid() and team_id=t$$;
      create function public.can_use_plan_feature(c uuid,f text) returns boolean language sql stable as $$select c=public.current_user_club_id() and f='matchDay'$$;
      create function public.platform_access_is_admin_v1(a uuid) returns boolean language sql stable as $$select false$$;
      create function public.canonical_subscription_plan_key(k text) returns text language sql immutable as $$select k$$;
      create function public.workspace_scope_for_plan_key(k text) returns text language sql immutable as $$select case when k='club' then 'club' else 'team' end$$;
    `)
    await db.exec(appearance)
    await db.exec('create trigger kit_boundary before update of home_kit_colour,away_kit_colour on public.teams for each row execute function app_private.enforce_team_matchday_kit_update()')
    const brandingAllowed = async () => (await db.query('select app_private.branding_actor_can_manage($1,$2,$3) allowed', [actor, club, team])).rows[0].allowed
    await db.exec("update public.teams set home_kit_colour='#123456',theme_accent='#123456'")
    assert.equal(await brandingAllowed(), true)
    await db.exec("update public.users set role='manager',role_rank=50;update public.team_staff set role_key='manager',role_rank=50;update public.user_club_memberships set role='manager',role_rank=50")
    await assert.rejects(db.exec("update public.teams set home_kit_colour='#abcdef'"), /team_kit_update_requires_team_admin/)
    await assert.rejects(db.exec("update public.teams set theme_accent='#abcdef'"), /team_appearance_requires_team_admin/)
    assert.equal(await brandingAllowed(), false)
    await db.exec("update public.clubs set plan_key='matchday'")
    await db.exec("update public.teams set home_kit_colour='#abcdef'")
    await db.exec("update public.users set role='head_manager',role_rank=70;update public.team_staff set role_key='head_manager',role_rank=70;update public.user_club_memberships set role='head_manager',role_rank=70")
    assert.equal(await brandingAllowed(), true)
    await db.exec("update public.clubs set plan_key='club'")
    await assert.rejects(db.exec("update public.teams set home_kit_colour='#ffffff'"), /club_kit_update_requires_club_admin/)
    await assert.rejects(db.exec("update public.teams set theme_accent='#ffffff'"), /club_appearance_requires_club_admin/)
    assert.equal(await brandingAllowed(), false)
    await db.exec("update public.users set role='admin',role_rank=90;update public.user_club_memberships set role='admin',role_rank=90")
    await db.exec("update public.teams set home_kit_colour='#ffffff',theme_accent='#ffffff'")
    assert.equal(await brandingAllowed(), true)
    await db.exec("update public.users set status='suspended'")
    await assert.rejects(db.exec("update public.teams set theme_accent='#123456'"), /team_appearance_not_authorized/)
    assert.equal(await brandingAllowed(), false)
    assert.equal((await db.query('select theme_accent from public.teams')).rows[0].theme_accent, '#ffffff')
  } finally { await db.close() }
})
