import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { test } from 'node:test'

import { PGlite } from '@electric-sql/pglite'

const accentMigrationUrl = new URL('../supabase/migrations/20260727073332_club_accent_colour_authority.sql', import.meta.url)
const displayMigrationUrl = new URL('../supabase/migrations/20260727111343_club_display_controls.sql', import.meta.url)

const IDS = Object.freeze({
  clubA: '10000000-0000-4000-8000-000000000001',
  clubB: '10000000-0000-4000-8000-000000000002',
  clubNoFeature: '10000000-0000-4000-8000-000000000003',
  clubEmpty: '10000000-0000-4000-8000-000000000004',
  manager: '20000000-0000-4000-8000-000000000001',
  teamAdmin: '20000000-0000-4000-8000-000000000002',
  clubAdmin: '20000000-0000-4000-8000-000000000003',
  otherClubAdmin: '20000000-0000-4000-8000-000000000004',
  noFeatureAdmin: '20000000-0000-4000-8000-000000000005',
})

async function createDatabase() {
  const db = new PGlite()

  await db.exec(`
    create role authenticated;
    create role service_role bypassrls;
    create schema auth;

    create function auth.uid()
    returns uuid
    language sql
    stable
    as $$
      select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid
    $$;

    create function auth.role()
    returns text
    language sql
    stable
    as $$
      select nullif(current_setting('request.jwt.claim.role', true), '')
    $$;

    create table public.clubs (
      id uuid primary key,
      name text not null,
      logo_url text,
      contact_phone text,
      require_approval boolean not null default true,
      custom_branding_enabled boolean not null default true
    );

    create table public.teams (
      id uuid primary key default gen_random_uuid(),
      club_id uuid not null references public.clubs(id),
      name text not null,
      theme_accent text,
      theme_button_style text
    );

    create table public.users (
      id uuid primary key,
      club_id uuid references public.clubs(id),
      role text not null,
      role_rank integer not null
    );

    create function public.current_user_role()
    returns text
    language sql
    stable
    security definer
    set search_path = pg_catalog, public
    as $$
      select actor.role
      from public.users as actor
      where actor.id = (select auth.uid())
    $$;

    create function public.current_user_role_rank()
    returns integer
    language sql
    stable
    security definer
    set search_path = pg_catalog, public
    as $$
      select actor.role_rank
      from public.users as actor
      where actor.id = (select auth.uid())
    $$;

    create function public.current_user_club_id()
    returns uuid
    language sql
    stable
    security definer
    set search_path = pg_catalog, public
    as $$
      select actor.club_id
      from public.users as actor
      where actor.id = (select auth.uid())
    $$;

    create function public.can_use_plan_feature(target_club_id uuid, feature_name text)
    returns boolean
    language sql
    stable
    security definer
    set search_path = pg_catalog, public
    as $$
      select case
        when feature_name in ('customColoursBranding', 'themes')
          then coalesce(club.custom_branding_enabled, false)
        else true
      end
      from public.clubs as club
      where club.id = target_club_id
    $$;

    create function public.enforce_club_plan_update_features()
    returns trigger
    language plpgsql
    as $$
    begin
      return new;
    end
    $$;

    create trigger enforce_club_plan_update_features
    before update on public.clubs
    for each row
    execute function public.enforce_club_plan_update_features();

    insert into public.clubs(id, name, custom_branding_enabled) values
      ('${IDS.clubA}', 'Club A', true),
      ('${IDS.clubB}', 'Club B', true),
      ('${IDS.clubNoFeature}', 'Club No Feature', false),
      ('${IDS.clubEmpty}', 'Club Empty', true);

    insert into public.teams(club_id, name, theme_accent, theme_button_style) values
      ('${IDS.clubA}', 'A One', 'blue', 'gradient'),
      ('${IDS.clubA}', 'A Two', 'blue', 'gradient'),
      ('${IDS.clubA}', 'A Three', 'red', 'solid'),
      ('${IDS.clubB}', 'B One', 'purple', 'gradient');

    insert into public.users(id, club_id, role, role_rank) values
      ('${IDS.manager}', '${IDS.clubA}', 'manager', 50),
      ('${IDS.teamAdmin}', '${IDS.clubA}', 'head_manager', 70),
      ('${IDS.clubAdmin}', '${IDS.clubA}', 'admin', 90),
      ('${IDS.otherClubAdmin}', '${IDS.clubB}', 'admin', 90),
      ('${IDS.noFeatureAdmin}', '${IDS.clubNoFeature}', 'admin', 90);

    grant usage on schema public, auth to authenticated, service_role;
    grant select, update on public.clubs to authenticated, service_role;
    grant select on public.users, public.teams to authenticated, service_role;

    alter table public.clubs enable row level security;

    create policy clubs_select_scoped
    on public.clubs
    for select
    to authenticated
    using (id = public.current_user_club_id());

    create policy clubs_update_manager
    on public.clubs
    for update
    to authenticated
    using (
      id = public.current_user_club_id()
      and public.current_user_role_rank() >= 50
    )
    with check (
      id = public.current_user_club_id()
      and public.current_user_role_rank() >= 50
    );
  `)

  await db.exec(await readFile(accentMigrationUrl, 'utf8'))
  await db.exec(await readFile(displayMigrationUrl, 'utf8'))
  return db
}

async function setActor(db, actorId, role = 'authenticated') {
  await db.exec('reset role')
  await db.query("select set_config('request.jwt.claim.sub', $1, false)", [actorId || ''])
  await db.query("select set_config('request.jwt.claim.role', $1, false)", [role])
  await db.exec(`set role ${role}`)
}

async function asOwner(db) {
  await db.exec('reset role')
}

test('migration backfills deterministic club display values and protects both fields', async () => {
  const db = await createDatabase()

  try {
    const backfilled = await db.query(`
      select id, theme_accent, theme_button_style
      from public.clubs
      order by id
    `)
    assert.deepEqual(backfilled.rows, [
      { id: IDS.clubA, theme_accent: 'blue', theme_button_style: 'solid' },
      { id: IDS.clubB, theme_accent: 'purple', theme_button_style: 'solid' },
      { id: IDS.clubNoFeature, theme_accent: 'green', theme_button_style: 'solid' },
      { id: IDS.clubEmpty, theme_accent: 'green', theme_button_style: 'solid' },
    ])

    await setActor(db, IDS.manager)
    await db.exec(`update public.clubs set contact_phone = '123' where id = '${IDS.clubA}'`)
    await assert.rejects(
      db.exec(`update public.clubs set theme_accent = 'red' where id = '${IDS.clubA}'`),
      /Only the Club Admin can change the club accent colour/i,
    )
    await assert.rejects(
      db.exec(`update public.clubs set theme_button_style = 'gradient' where id = '${IDS.clubA}'`),
      /Only the Club Admin can change the club button style/i,
    )

    await setActor(db, IDS.teamAdmin)
    await assert.rejects(
      db.exec(`update public.clubs set theme_accent = 'red' where id = '${IDS.clubA}'`),
      /Only the Club Admin can change the club accent colour/i,
    )
    await assert.rejects(
      db.exec(`update public.clubs set theme_button_style = 'gradient' where id = '${IDS.clubA}'`),
      /Only the Club Admin can change the club button style/i,
    )

    await setActor(db, IDS.clubAdmin)
    await db.exec(`
      update public.clubs
      set theme_accent = '#2b6cb0',
          theme_button_style = 'gradient'
      where id = '${IDS.clubA}'
    `)
    const saved = await db.query(`
      select theme_accent, theme_button_style
      from public.clubs
      where id = '${IDS.clubA}'
    `)
    assert.deepEqual(saved.rows[0], {
      theme_accent: '#2b6cb0',
      theme_button_style: 'gradient',
    })
    await assert.rejects(
      db.exec(`update public.clubs set theme_accent = 'orange' where id = '${IDS.clubA}'`),
      /clubs_theme_accent_check/i,
    )
    await assert.rejects(
      db.exec(`update public.clubs set theme_accent = '#2B6CB0' where id = '${IDS.clubA}'`),
      /clubs_theme_accent_check/i,
    )
    await assert.rejects(
      db.exec(`update public.clubs set theme_accent = '#2b6cb080' where id = '${IDS.clubA}'`),
      /clubs_theme_accent_check/i,
    )
    await assert.rejects(
      db.exec(`update public.clubs set theme_button_style = 'outline' where id = '${IDS.clubA}'`),
      /clubs_theme_button_style_check/i,
    )
    const crossClub = await db.query(
      `update public.clubs set theme_accent = 'yellow' where id = '${IDS.clubB}' returning id`,
    )
    assert.equal(crossClub.rows.length, 0)

    await setActor(db, IDS.noFeatureAdmin)
    await assert.rejects(
      db.exec(`update public.clubs set theme_accent = 'yellow' where id = '${IDS.clubNoFeature}'`),
      /Custom colours and club branding are not included in this plan/i,
    )
    await assert.rejects(
      db.exec(`update public.clubs set theme_button_style = 'gradient' where id = '${IDS.clubNoFeature}'`),
      /Custom colours and club branding are not included in this plan/i,
    )
  } finally {
    await asOwner(db)
    await db.close()
  }
})
