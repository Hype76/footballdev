import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { test } from 'node:test'

import { PGlite } from '@electric-sql/pglite'

const migrationUrl = new URL('../supabase/migrations/20260719071505_p0_shared_authority_profile_containment.sql', import.meta.url)

const IDS = Object.freeze({
  clubA: '10000000-0000-0000-0000-000000000001',
  clubB: '10000000-0000-0000-0000-000000000002',
  teamA: '20000000-0000-0000-0000-000000000001',
  parent: '30000000-0000-0000-0000-000000000001',
  coach: '30000000-0000-0000-0000-000000000002',
  manager: '30000000-0000-0000-0000-000000000003',
  admin: '30000000-0000-0000-0000-000000000004',
  otherClubAdmin: '30000000-0000-0000-0000-000000000005',
  platformAdmin: '30000000-0000-0000-0000-000000000006',
  invited: '30000000-0000-0000-0000-000000000007',
  teamAdmin: '30000000-0000-0000-0000-000000000008',
  teamB: '20000000-0000-0000-0000-000000000002',
})

async function createDatabase() {
  const db = new PGlite()

  await db.exec(`
    create role anon;
    create role authenticated;
    create role service_role bypassrls;
    create schema auth;

    create table auth.users (
      id uuid primary key,
      email text,
      raw_user_meta_data jsonb not null default '{}'::jsonb
    );

    create function auth.uid() returns uuid language sql stable as $$
      select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid
    $$;

    create table public.clubs (
      id uuid primary key,
      name text not null,
      status text not null default 'active',
      plan_key text not null default 'free'
    );

    create table public.users (
      id uuid primary key references auth.users(id),
      email text not null,
      name text,
      role text not null default 'coach',
      club_id uuid references public.clubs(id),
      created_at timestamptz not null default timezone('utc', now()),
      role_label text,
      role_rank integer not null default 30,
      username text,
      force_password_change boolean not null default false,
      theme_mode text,
      theme_accent text,
      display_name text,
      team_name text,
      club_name text,
      reply_to_email text,
      onboarding_enabled boolean not null default true,
      onboarding_completed_steps jsonb not null default '[]'::jsonb,
      onboarding_dismissed_at timestamptz,
      status text not null default 'active',
      suspended_at timestamptz,
      onboarding_reset_at timestamptz
    );

    create table public.user_club_memberships (
      id uuid primary key default gen_random_uuid(),
      auth_user_id uuid not null references auth.users(id),
      email text not null,
      username text,
      name text,
      role text not null,
      role_label text,
      role_rank integer not null,
      club_id uuid not null references public.clubs(id),
      created_at timestamptz not null default timezone('utc', now()),
      updated_at timestamptz not null default timezone('utc', now()),
      unique (auth_user_id, club_id)
    );

    create table public.platform_admins (
      id uuid primary key references auth.users(id),
      email text not null,
      status text not null default 'active'
    );

    create table public.club_roles (
      id uuid primary key default gen_random_uuid(),
      club_id uuid not null references public.clubs(id),
      role_key text not null,
      role_label text not null,
      role_rank integer not null,
      unique (club_id, role_key)
    );

    create table public.teams (
      id uuid primary key,
      club_id uuid not null references public.clubs(id),
      name text not null
    );

    create table public.team_staff (
      team_id uuid not null references public.teams(id),
      user_id uuid not null references public.users(id),
      primary key (team_id, user_id)
    );

    create table public.club_user_invites (
      id uuid primary key default gen_random_uuid(),
      club_id uuid not null references public.clubs(id),
      email text not null,
      role_key text not null,
      role_label text not null,
      role_rank integer not null,
      team_id uuid references public.teams(id),
      expires_at timestamptz,
      accepted_at timestamptz,
      created_at timestamptz not null default timezone('utc', now())
    );

    create table public.audit_logs (
      id uuid primary key default gen_random_uuid(),
      club_id uuid,
      actor_id uuid,
      action text not null,
      entity_type text not null,
      entity_id uuid,
      metadata jsonb not null default '{}'::jsonb,
      created_at timestamptz not null default timezone('utc', now())
    );

    insert into public.clubs(id, name) values
      ('${IDS.clubA}', 'Club A'),
      ('${IDS.clubB}', 'Club B');
    insert into public.teams(id, club_id, name) values
      ('${IDS.teamA}', '${IDS.clubA}', 'Team A'),
      ('${IDS.teamB}', '${IDS.clubB}', 'Team B');

    insert into auth.users(id, email, raw_user_meta_data) values
      ('${IDS.parent}', 'parent@example.test', '{"name":"Parent"}'),
      ('${IDS.coach}', 'coach@example.test', '{"name":"Coach"}'),
      ('${IDS.manager}', 'manager@example.test', '{"name":"Manager"}'),
      ('${IDS.admin}', 'admin@example.test', '{"name":"Admin"}'),
      ('${IDS.otherClubAdmin}', 'other@example.test', '{"name":"Other"}'),
      ('${IDS.platformAdmin}', 'platform@example.test', '{"name":"Platform"}'),
      ('${IDS.invited}', 'invited@example.test', '{"name":"Invited"}'),
      ('${IDS.teamAdmin}', 'team-admin@example.test', '{"name":"Team Admin"}');

    insert into public.users(id, email, username, name, display_name, role, role_label, role_rank, club_id) values
      ('${IDS.parent}', 'parent@example.test', 'Parent', 'Parent', 'Parent', 'parent_portal', 'Parent', 10, '${IDS.clubA}'),
      ('${IDS.coach}', 'coach@example.test', 'Coach', 'Coach', 'Coach', 'coach', 'Coach', 30, '${IDS.clubA}'),
      ('${IDS.manager}', 'manager@example.test', 'Manager', 'Manager', 'Manager', 'manager', 'Manager', 50, '${IDS.clubA}'),
      ('${IDS.admin}', 'admin@example.test', 'Admin', 'Admin', 'Admin', 'admin', 'Club Admin', 90, '${IDS.clubA}'),
      ('${IDS.otherClubAdmin}', 'other@example.test', 'Other', 'Other', 'Other', 'admin', 'Club Admin', 90, '${IDS.clubB}'),
      ('${IDS.teamAdmin}', 'team-admin@example.test', 'Team Admin', 'Team Admin', 'Team Admin', 'head_manager', 'Team Admin', 70, '${IDS.clubA}'),
      ('${IDS.platformAdmin}', 'platform@example.test', 'Platform', 'Platform', 'Platform', 'super_admin', 'Platform Admin', 100, null);

    insert into public.user_club_memberships(auth_user_id, email, username, name, role, role_label, role_rank, club_id)
    select id, email, username, name, role, role_label, role_rank, club_id
    from public.users
    where club_id is not null;

    insert into public.platform_admins(id, email) values ('${IDS.platformAdmin}', 'platform@example.test');

    insert into public.club_roles(club_id, role_key, role_label, role_rank) values
      ('${IDS.clubA}', 'parent_portal', 'Parent', 10),
      ('${IDS.clubA}', 'coach', 'Coach', 30),
      ('${IDS.clubA}', 'manager', 'Manager', 50),
      ('${IDS.clubA}', 'head_manager', 'Team Admin', 70),
      ('${IDS.clubA}', 'admin', 'Club Admin', 90),
      ('${IDS.clubB}', 'coach', 'Coach', 30),
      ('${IDS.clubB}', 'admin', 'Club Admin', 90);

    grant usage on schema public, auth to anon, authenticated, service_role;
    grant select, insert, update, delete on all tables in schema public to anon, authenticated, service_role;
    grant select on auth.users to service_role;

    alter table public.users enable row level security;
    alter table public.user_club_memberships enable row level security;
    alter table public.platform_admins enable row level security;

    create policy users_insert_self on public.users for insert to authenticated with check (id = auth.uid());
    create policy users_update_self_or_manager on public.users for update to authenticated using (id = auth.uid()) with check (id = auth.uid());
    create policy user_club_memberships_insert_scoped on public.user_club_memberships for insert to authenticated with check (auth_user_id = auth.uid());
    create policy user_club_memberships_update_scoped on public.user_club_memberships for update to authenticated using (auth_user_id = auth.uid()) with check (auth_user_id = auth.uid());
  `)

  await db.exec(await readFile(migrationUrl, 'utf8'))
  return db
}

async function setActor(db, actorId, role = 'authenticated') {
  await db.exec('reset role')
  await db.query("select set_config('request.jwt.claim.sub', $1, false)", [actorId || ''])
  await db.exec(`set role ${role}`)
}

async function asOwner(db) {
  await db.exec('reset role')
}

test('migration executes and direct insert, update and upsert are denied', async () => {
  const db = await createDatabase()
  try {
    await setActor(db, IDS.parent)

    await assert.rejects(
      db.exec(`update public.users set role = 'admin' where id = '${IDS.parent}'`),
      /permission denied/i,
    )
    await assert.rejects(
      db.exec(`insert into public.users(id, email, role, role_rank) values (gen_random_uuid(), 'blocked@example.test', 'admin', 90)`),
      /permission denied/i,
    )
    await assert.rejects(
      db.exec(`insert into public.users(id, email, role, role_rank) values ('${IDS.parent}', 'parent@example.test', 'admin', 90) on conflict (id) do update set role = excluded.role`),
      /permission denied/i,
    )
    await assert.rejects(
      db.exec(`update public.user_club_memberships set role_rank = 90 where auth_user_id = '${IDS.parent}'`),
      /permission denied/i,
    )

    await setActor(db, '', 'anon')
    await assert.rejects(
      db.exec("select public.update_own_theme_settings('dark')"),
      /permission denied/i,
    )
  } finally {
    await asOwner(db)
    await db.close()
  }
})

test('mixed safe and protected writes fail atomically even if broad update is accidentally restored', async () => {
  const db = await createDatabase()
  try {
    await asOwner(db)
    await db.exec('alter table public.users disable row level security; grant update on public.users to authenticated;')
    await setActor(db, IDS.parent)

    await assert.rejects(
      db.exec(`update public.users set display_name = 'Should not save', role = 'admin' where id = '${IDS.parent}'`),
      /server.managed|authority/i,
    )

    await asOwner(db)
    const row = await db.query('select display_name, role, role_rank, club_id, status from public.users where id = $1', [IDS.parent])
    assert.deepEqual(row.rows[0], {
      display_name: 'Parent',
      role: 'parent_portal',
      role_rank: 10,
      club_id: IDS.clubA,
      status: 'active',
    })
  } finally {
    await asOwner(db)
    await db.close()
  }
})

test('every discovered protected profile field is denied for direct same, changed and null submissions', async () => {
  const db = await createDatabase()
  const changedExpressions = {
    id: "'30000000-0000-0000-0000-000000000099'::uuid",
    email: "'changed@example.test'",
    role: "'admin'",
    club_id: `'${IDS.clubB}'::uuid`,
    role_label: "'Club Admin'",
    role_rank: '90',
    force_password_change: 'true',
    status: "'suspended'",
    suspended_at: "timezone('utc', now())",
    created_at: "timezone('utc', now()) + interval '1 day'",
  }

  try {
    await setActor(db, IDS.parent)

    for (const [field, expression] of Object.entries(changedExpressions)) {
      await assert.rejects(
        db.exec(`update public.users set ${field} = ${expression} where id = '${IDS.parent}'`),
        /permission denied/i,
      )
      await assert.rejects(
        db.exec(`update public.users set ${field} = ${field} where id = '${IDS.parent}'`),
        /permission denied/i,
      )
      await assert.rejects(
        db.exec(`update public.users set ${field} = null where id = '${IDS.parent}'`),
        /permission denied/i,
      )
    }

    await assert.rejects(
      db.exec(`update public.users set display_name = 'Direct safe field' where id = '${IDS.parent}'`),
      /permission denied/i,
    )
  } finally {
    await asOwner(db)
    await db.close()
  }
})

test('safe RPC allowlists support intended values and reject invalid or unknown inputs', async () => {
  const db = await createDatabase()
  try {
    await setActor(db, IDS.manager)
    const profile = await db.query(`
      select public.update_own_user_profile(
        'Manager Updated',
        'Manager Display',
        'Team Presentation',
        null,
        'manager-replies@example.test'
      ) as profile
    `)
    assert.equal(profile.rows[0].profile.username, 'Manager Updated')
    assert.equal(profile.rows[0].profile.team_name, 'Team Presentation')
    assert.equal(profile.rows[0].profile.reply_to_email, 'manager-replies@example.test')
    assert.equal(profile.rows[0].profile.role, 'manager')

    const cleared = await db.query(`
      select public.update_own_user_profile('Manager Updated', 'Manager Display', '', null, '') as profile
    `)
    assert.equal(cleared.rows[0].profile.team_name, '')
    assert.equal(cleared.rows[0].profile.reply_to_email, null)

    const themed = await db.query("select public.update_own_theme_settings('dark') as profile")
    assert.equal(themed.rows[0].profile.theme_mode, 'dark')

    await assert.rejects(
      db.exec(`select public.update_own_user_profile(repeat('x', 121), 'Display')`),
      /invalid_profile_name/i,
    )
    await assert.rejects(
      db.exec(`select public.update_own_user_profile('Manager Updated', 'Display', null, null, 'invalid')`),
      /invalid_reply_email/i,
    )
    await assert.rejects(
      db.exec(`select public.update_own_user_profile(profile_username => 'Manager', profile_display_name => 'Display', profile_role => 'admin')`),
      /does not exist|function/i,
    )
  } finally {
    await asOwner(db)
    await db.close()
  }
})

test('safe profile RPC works while disabled, mismatched and removed authority fail closed', async () => {
  const db = await createDatabase()
  try {
    await setActor(db, IDS.parent)
    const saved = await db.query("select public.update_own_user_profile('Parent Updated', 'Parent Display') as profile")
    assert.equal(saved.rows[0].profile.username, 'Parent Updated')
    assert.equal(saved.rows[0].profile.display_name, 'Parent Display')
    assert.equal(saved.rows[0].profile.role, 'parent_portal')
    assert.equal(saved.rows[0].profile.role_rank, 10)
    assert.equal(saved.rows[0].profile.club_id, IDS.clubA)

    await asOwner(db)
    await db.exec(`update public.users set status = 'suspended' where id = '${IDS.parent}'`)
    await setActor(db, IDS.parent)
    await assert.rejects(db.exec("select public.update_own_theme_settings('dark')"), /not[_ ]permitted/i)

    await asOwner(db)
    await db.exec(`update public.users set status = 'active' where id = '${IDS.parent}'; update public.user_club_memberships set role_rank = 30 where auth_user_id = '${IDS.parent}'`)
    await setActor(db, IDS.parent)
    await assert.rejects(db.exec("select public.update_own_theme_settings('dark')"), /not[_ ]permitted/i)

    await asOwner(db)
    await db.exec(`update public.user_club_memberships set role_rank = 10 where auth_user_id = '${IDS.parent}'; delete from public.user_club_memberships where auth_user_id = '${IDS.parent}'`)
    await setActor(db, IDS.parent)
    await assert.rejects(db.exec("select public.update_own_theme_settings('dark')"), /not[_ ]permitted/i)
    await assert.rejects(db.exec(`select public.activate_own_club_membership('${IDS.clubA}')`), /not[_ ]permitted/i)
  } finally {
    await asOwner(db)
    await db.close()
  }
})

test('role, tenant, invitation and platform operations enforce current server authority', async () => {
  const db = await createDatabase()
  try {
    await setActor(db, IDS.coach)
    await assert.rejects(
      db.exec(`select public.set_club_user_role('${IDS.parent}', 'coach', null)`),
      /not[_ ]permitted/i,
    )

    await setActor(db, IDS.manager)
    const managed = await db.query(`select public.set_club_user_role('${IDS.coach}', 'manager', '${IDS.teamA}') as profile`)
    assert.equal(managed.rows[0].profile.role, 'manager')
    assert.equal(managed.rows[0].profile.role_rank, 50)
    await assert.rejects(
      db.exec(`select public.set_club_user_role('${IDS.otherClubAdmin}', 'coach', null)`),
      /not[_ ]permitted/i,
    )
    await assert.rejects(
      db.exec(`select public.set_club_user_role('${IDS.manager}', 'admin', null)`),
      /self.authority/i,
    )

    await setActor(db, IDS.teamAdmin)
    const teamAdminManaged = await db.query(`select public.set_club_user_role('${IDS.coach}', 'head_manager', '${IDS.teamA}') as profile`)
    assert.equal(teamAdminManaged.rows[0].profile.role, 'head_manager')
    await assert.rejects(
      db.exec(`select public.set_club_user_role('${IDS.coach}', 'admin', null)`),
      /not[_ ]permitted/i,
    )

    await setActor(db, IDS.admin)
    const clubAdminManaged = await db.query(`select public.set_club_user_role('${IDS.coach}', 'manager', '${IDS.teamA}') as profile`)
    assert.equal(clubAdminManaged.rows[0].profile.role, 'manager')
    await assert.rejects(
      db.exec(`select public.set_club_user_role('${IDS.coach}', 'manager', '${IDS.teamB}')`),
      /team_scope_invalid/i,
    )
    await assert.rejects(
      db.exec(`select public.set_club_user_role('${IDS.admin}', 'head_manager', null)`),
      /self_authority/i,
    )

    await asOwner(db)
    await db.exec(`
      insert into public.club_user_invites(club_id, email, role_key, role_label, role_rank, team_id, expires_at)
      values ('${IDS.clubA}', 'invited@example.test', 'coach', 'Coach', 30, '${IDS.teamA}', timezone('utc', now()) + interval '1 day');
    `)
    await setActor(db, IDS.invited)
    const accepted = await db.query('select public.accept_own_club_user_invites() as memberships')
    assert.equal(accepted.rows[0].memberships.length, 1)

    await asOwner(db)
    const invitedProfile = await db.query('select role, role_rank, club_id, status from public.users where id = $1', [IDS.invited])
    assert.deepEqual(invitedProfile.rows[0], { role: 'coach', role_rank: 30, club_id: IDS.clubA, status: 'active' })

    await setActor(db, IDS.platformAdmin)
    const suspended = await db.query(`select public.set_platform_user_status('${IDS.parent}', 'suspended') as profile`)
    assert.equal(suspended.rows[0].profile.status, 'suspended')

    await asOwner(db)
    await db.exec(`update public.platform_admins set status = 'suspended' where id = '${IDS.platformAdmin}'`)
    await setActor(db, IDS.platformAdmin)
    await assert.rejects(
      db.exec(`select public.set_platform_user_status('${IDS.parent}', 'active')`),
      /not[_ ]permitted/i,
    )

    await asOwner(db)
    await db.query("select set_config('request.jwt.claim.sub', $1, false)", [IDS.admin])
    await db.exec('set role service_role')
    await db.exec(`update public.users set role_label = 'Club Owner' where id = '${IDS.admin}'`)
    await asOwner(db)
    assert.equal((await db.query('select role_label from public.users where id = $1', [IDS.admin])).rows[0].role_label, 'Club Owner')
  } finally {
    await asOwner(db)
    await db.close()
  }
})
