import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'

import { PGlite } from '@electric-sql/pglite'

const migration = await readFile(
  new URL('../supabase/migrations/20260807125343_fp_v1_workspace_scope_onboarding_master_03.sql', import.meta.url),
  'utf8',
)

const ID = Object.freeze({
  platform: '10000000-0000-4000-8000-000000000001',
  sourceClub: '20000000-0000-4000-8000-000000000001',
  destinationClub: '20000000-0000-4000-8000-000000000002',
  teamAdmin: '30000000-0000-4000-8000-000000000001',
  clubAdmin: '30000000-0000-4000-8000-000000000002',
  invitedTeamOwner: '30000000-0000-4000-8000-000000000003',
  invitedClubOwner: '30000000-0000-4000-8000-000000000004',
  sourceTeam: '40000000-0000-4000-8000-000000000001',
  player: '50000000-0000-4000-8000-000000000001',
  evaluation: '60000000-0000-4000-8000-000000000001',
})

async function createDatabase() {
  const db = new PGlite()
  await db.exec(`
    create role anon;
    create role authenticated;
    create role service_role bypassrls;
    create schema auth;
    create schema storage;

    create table auth.users (
      id uuid primary key,
      email text,
      raw_user_meta_data jsonb not null default '{}'::jsonb,
      deleted_at timestamptz,
      banned_until timestamptz
    );

    create table public.clubs (
      id uuid primary key,
      name text not null,
      status text not null default 'active' check (status in ('active', 'suspended')),
      suspended_at timestamptz,
      plan_key text not null,
      plan_status text not null default 'active',
      is_plan_comped boolean not null default false,
      stripe_subscription_id text,
      plan_updated_at timestamptz
    );

    create table public.users (
      id uuid primary key references auth.users(id),
      email text not null,
      username text,
      name text,
      display_name text,
      role text not null,
      role_label text,
      role_rank integer not null default 30,
      club_id uuid references public.clubs(id),
      status text not null default 'active',
      force_password_change boolean not null default false
    );

    create table public.platform_admins (
      id uuid primary key references auth.users(id),
      status text not null default 'active'
    );

    create table public.teams (
      id uuid primary key default gen_random_uuid(),
      club_id uuid not null references public.clubs(id),
      name text not null,
      status text not null default 'active',
      created_at timestamptz not null default timezone('utc', now()),
      updated_at timestamptz not null default timezone('utc', now()),
      updated_by uuid,
      updated_by_email text,
      updated_by_name text
    );

    create table public.user_club_memberships (
      id uuid primary key default gen_random_uuid(),
      auth_user_id uuid not null references auth.users(id),
      email text not null,
      username text,
      name text,
      role text not null,
      role_label text not null,
      role_rank integer not null,
      club_id uuid not null references public.clubs(id),
      updated_at timestamptz not null default timezone('utc', now()),
      unique (auth_user_id, club_id)
    );

    create table public.team_staff (
      id uuid primary key default gen_random_uuid(),
      team_id uuid not null references public.teams(id),
      user_id uuid not null references public.users(id),
      role_key text not null,
      role_label text not null default 'Team Admin',
      role_rank integer not null default 70,
      updated_by uuid,
      unique (team_id, user_id)
    );

    create table public.audit_logs (
      id uuid primary key default gen_random_uuid(),
      club_id uuid references public.clubs(id),
      actor_id uuid references public.users(id),
      actor_name text,
      actor_email text,
      actor_role_label text,
      actor_role_rank integer not null default 0,
      action text not null,
      entity_type text not null,
      entity_id uuid,
      metadata jsonb not null default '{}'::jsonb,
      created_at timestamptz not null default timezone('utc', now())
    );

    create table public.club_owner_invites (
      id uuid primary key default gen_random_uuid(),
      club_id uuid not null references public.clubs(id),
      invited_email text not null,
      accepted_email text,
      billing_mode text not null default 'unpaid',
      plan_key text not null,
      status text not null default 'pending',
      expires_at timestamptz not null default timezone('utc', now()) + interval '14 days',
      accepted_at timestamptz,
      invite_sent_at timestamptz,
      created_by uuid,
      created_at timestamptz not null default timezone('utc', now()),
      updated_at timestamptz not null default timezone('utc', now()),
      token_digest text not null unique,
      accepted_user_id uuid references auth.users(id),
      revoked_at timestamptz,
      replaced_at timestamptz,
      replaced_by_invite_id uuid references public.club_owner_invites(id)
    );

    create unique index club_owner_invites_one_active_identity_key
      on public.club_owner_invites (club_id, lower(invited_email))
      where status = 'pending' and accepted_at is null and revoked_at is null and replaced_at is null;

    create table public.players (
      id uuid primary key,
      club_id uuid not null references public.clubs(id),
      team_id uuid references public.teams(id)
    );
    create table public.evaluations (
      id uuid primary key,
      club_id uuid not null references public.clubs(id),
      team_id uuid references public.teams(id),
      player_id uuid references public.players(id)
    );
    create table public.assessment_sessions (
      id uuid primary key default gen_random_uuid(),
      club_id uuid not null references public.clubs(id),
      team_id uuid references public.teams(id)
    );
    create table public.assessment_session_games (
      id uuid primary key default gen_random_uuid(),
      session_id uuid references public.assessment_sessions(id),
      club_id uuid not null references public.clubs(id)
    );
    create table public.development_parent_reports (
      evaluation_id uuid primary key references public.evaluations(id),
      club_id uuid not null references public.clubs(id)
    );
    create table public.communication_logs (
      id uuid primary key default gen_random_uuid(),
      club_id uuid not null references public.clubs(id),
      player_id uuid references public.players(id),
      evaluation_id uuid references public.evaluations(id)
    );
    create table public.player_staff_notes (
      id uuid primary key default gen_random_uuid(),
      club_id uuid not null references public.clubs(id),
      player_id uuid references public.players(id),
      audio_path text not null default ''
    );
    create table public.parent_chat_rooms (
      id uuid primary key default gen_random_uuid(),
      club_id uuid not null references public.clubs(id),
      team_id uuid references public.teams(id)
    );
    create table public.parent_chat_memberships (
      id uuid primary key default gen_random_uuid(),
      room_id uuid references public.parent_chat_rooms(id),
      club_id uuid not null references public.clubs(id)
    );
    create table public.parent_chat_membership_audit (
      id uuid primary key default gen_random_uuid(),
      room_id uuid references public.parent_chat_rooms(id),
      club_id uuid not null references public.clubs(id)
    );
    create table public.parent_chat_messages (
      id uuid primary key default gen_random_uuid(),
      room_id uuid references public.parent_chat_rooms(id),
      club_id uuid not null references public.clubs(id)
    );
    create table public.staff_chat_conversations (
      id uuid primary key default gen_random_uuid(),
      club_id uuid not null references public.clubs(id),
      team_id uuid references public.teams(id)
    );
    create table public.staff_chat_members (
      id uuid primary key default gen_random_uuid(),
      conversation_id uuid references public.staff_chat_conversations(id),
      club_id uuid not null references public.clubs(id)
    );
    create table public.staff_chat_messages (
      id uuid primary key default gen_random_uuid(),
      conversation_id uuid references public.staff_chat_conversations(id),
      club_id uuid not null references public.clubs(id)
    );
    create table public.guardians (
      id uuid primary key default gen_random_uuid(),
      club_id uuid not null references public.clubs(id)
    );
    create table public.match_locations (
      id uuid primary key default gen_random_uuid(),
      club_id uuid not null references public.clubs(id)
    );
    create table public.transfer_direct_fixture (
      id uuid primary key default gen_random_uuid(),
      club_id uuid not null references public.clubs(id),
      team_id uuid not null references public.teams(id),
      payload text,
      updated_at timestamptz not null default '2026-01-01T00:00:00Z'
    );

    create function public.reject_transfer_fixture_update()
    returns trigger language plpgsql as $$
    begin
      raise exception using errcode = '55000', message = 'fixture_snapshot_immutable';
    end;
    $$;
    create trigger transfer_direct_fixture_immutable
      before update on public.transfer_direct_fixture
      for each row execute function public.reject_transfer_fixture_update();

    create table storage.objects (
      id uuid primary key default gen_random_uuid(),
      bucket_id text not null,
      name text not null,
      owner uuid
    );

    create or replace function public.normalize_subscription_plan_key(raw_plan_key text)
    returns text language sql immutable as $$
      select case
        when raw_plan_key is null or btrim(raw_plan_key) = '' then 'individual'
        when lower(regexp_replace(btrim(raw_plan_key), '[^a-zA-Z0-9]+', '_', 'g')) in ('individual', 'individual_coach', 'individual_coach_free', 'individual_free', 'free') then 'individual'
        when lower(regexp_replace(btrim(raw_plan_key), '[^a-zA-Z0-9]+', '_', 'g')) in ('single', 'single_team', 'team') then 'single_team'
        when lower(regexp_replace(btrim(raw_plan_key), '[^a-zA-Z0-9]+', '_', 'g')) = 'small_club' then 'small_club'
        when lower(regexp_replace(btrim(raw_plan_key), '[^a-zA-Z0-9]+', '_', 'g')) in ('development', 'development_club', 'dev_club') then 'development_club'
        when lower(regexp_replace(btrim(raw_plan_key), '[^a-zA-Z0-9]+', '_', 'g')) in ('large_club', 'contact', 'contact_sales', 'enterprise', 'negotiated') then 'large_club'
        when lower(regexp_replace(btrim(raw_plan_key), '[^a-zA-Z0-9]+', '_', 'g')) = 'pilot' then 'pilot'
        else ''
      end
    $$;
    create or replace function public.can_insert_team_for_plan(target_club_id uuid)
    returns boolean language sql stable as $$ select true $$;
    create or replace function public.current_user_role_rank()
    returns integer language sql stable as $$ select 100 $$;
    create or replace function public.current_user_club_id()
    returns uuid language sql stable as $$ select null::uuid $$;
  `)

  await db.exec(migration)
  return db
}

async function seedAuthority(db) {
  await db.exec(`
    insert into public.clubs(id, name, plan_key, plan_status) values
      ('${ID.sourceClub}', 'FP TEST Team', 'single_team', 'active'),
      ('${ID.destinationClub}', 'FP TEST Club', 'small_club', 'active');

    insert into auth.users(id, email, raw_user_meta_data) values
      ('${ID.platform}', 'platform@example.test', '{"name":"Platform Admin"}'),
      ('${ID.teamAdmin}', 'team.admin@example.test', '{"name":"Team Admin"}'),
      ('${ID.clubAdmin}', 'club.admin@example.test', '{"name":"Club Admin"}'),
      ('${ID.invitedTeamOwner}', 'invited.team@example.test', '{"name":"Invited Team"}'),
      ('${ID.invitedClubOwner}', 'invited.club@example.test', '{"name":"Invited Club"}');

    insert into public.users(id, email, username, name, display_name, role, role_label, role_rank, club_id) values
      ('${ID.platform}', 'platform@example.test', 'Platform Admin', 'Platform Admin', 'Platform Admin', 'super_admin', 'Platform Admin', 100, null),
      ('${ID.teamAdmin}', 'team.admin@example.test', 'Team Admin', 'Team Admin', 'Team Admin', 'head_manager', 'Team Admin', 70, '${ID.sourceClub}'),
      ('${ID.clubAdmin}', 'club.admin@example.test', 'Club Admin', 'Club Admin', 'Club Admin', 'admin', 'Club Admin', 90, '${ID.destinationClub}');

    insert into public.platform_admins(id) values ('${ID.platform}');
    insert into public.teams(id, club_id, name) values ('${ID.sourceTeam}', '${ID.sourceClub}', 'FP TEST Team');
    insert into public.team_staff(team_id, user_id, role_key) values ('${ID.sourceTeam}', '${ID.teamAdmin}', 'head_manager');
    insert into public.user_club_memberships(auth_user_id, email, username, name, role, role_label, role_rank, club_id) values
      ('${ID.teamAdmin}', 'team.admin@example.test', 'Team Admin', 'Team Admin', 'head_manager', 'Team Admin', 70, '${ID.sourceClub}'),
      ('${ID.clubAdmin}', 'club.admin@example.test', 'Club Admin', 'Club Admin', 'admin', 'Club Admin', 90, '${ID.destinationClub}');
  `)
}

test('migration resolves scope and accepts Team and Club owner invites with distinct authority', async () => {
  const db = await createDatabase()
  await seedAuthority(db)

  const scopes = await db.query(`
    select
      public.workspace_scope_for_plan_key('individual') as individual,
      public.workspace_scope_for_plan_key('single_team') as team,
      public.workspace_scope_for_plan_key('development_club') as club,
      public.workspace_scope_for_plan_key('future_plan') as unknown
  `)
  assert.deepEqual(scopes.rows[0], { individual: 'individual', team: 'team', club: 'club', unknown: 'unknown' })

  const teamInvite = await db.query(`
    select public.create_workspace_owner_invite_v3(
      '${ID.sourceClub}', '${ID.sourceTeam}', 'invited.team@example.test', 'unpaid',
      '${'a'.repeat(64)}', '${ID.platform}', timezone('utc', now()) + interval '1 day'
    ) as result
  `)
  assert.equal(teamInvite.rows[0].result.scope, 'team')
  assert.equal(teamInvite.rows[0].result.roleLabel, 'Team Admin')
  assert.equal(teamInvite.rows[0].result.teamId, ID.sourceTeam)

  const acceptedTeam = await db.query(`
    select public.accept_workspace_owner_invite_v3('${'a'.repeat(64)}', '${ID.invitedTeamOwner}') as result
  `)
  assert.equal(acceptedTeam.rows[0].result.scope, 'team')
  assert.equal(acceptedTeam.rows[0].result.roleLabel, 'Team Admin')

  const teamOwner = await db.query(`
    select app_user.role, app_user.role_label, app_user.role_rank, club.workspace_owner_user_id,
      exists(select 1 from public.team_staff assignment where assignment.team_id = '${ID.sourceTeam}' and assignment.user_id = app_user.id) as has_team_assignment
    from public.users app_user
    join public.clubs club on club.id = app_user.club_id
    where app_user.id = '${ID.invitedTeamOwner}'
  `)
  assert.deepEqual(teamOwner.rows[0], {
    role: 'head_manager',
    role_label: 'Team Admin',
    role_rank: 70,
    workspace_owner_user_id: ID.invitedTeamOwner,
    has_team_assignment: true,
  })

  const clubInvite = await db.query(`
    select public.create_workspace_owner_invite_v3(
      '${ID.destinationClub}', null, 'invited.club@example.test', 'unpaid',
      '${'b'.repeat(64)}', '${ID.platform}', timezone('utc', now()) + interval '1 day'
    ) as result
  `)
  assert.equal(clubInvite.rows[0].result.scope, 'club')
  assert.equal(clubInvite.rows[0].result.roleLabel, 'Club Admin')
  assert.equal(clubInvite.rows[0].result.teamId, null)

  await db.query(`select public.accept_workspace_owner_invite_v3('${'b'.repeat(64)}', '${ID.invitedClubOwner}')`)
  const clubOwner = await db.query(`select role, role_label, role_rank from public.users where id = '${ID.invitedClubOwner}'`)
  assert.deepEqual(clubOwner.rows[0], { role: 'admin', role_label: 'Club Admin', role_rank: 90 })

  await db.close()
})

test('invite scope, plan, team and recipient tampering fail closed', async () => {
  const db = await createDatabase()
  await seedAuthority(db)

  await assert.rejects(
    () => db.query(`select public.create_workspace_owner_invite_v3('${ID.sourceClub}', '${ID.sourceClub}', 'bad@example.test', 'unpaid', '${'c'.repeat(64)}', '${ID.platform}')`),
    /workspace_owner_invitation_not_permitted/,
  )

  await db.query(`
    select public.create_workspace_owner_invite_v3(
      '${ID.sourceClub}', '${ID.sourceTeam}', 'invited.team@example.test', 'unpaid',
      '${'d'.repeat(64)}', '${ID.platform}', timezone('utc', now()) + interval '1 day'
    )
  `)
  await db.query(`update public.club_owner_invites set plan_key = 'small_club' where token_digest = '${'d'.repeat(64)}'`)
  await assert.rejects(
    () => db.query(`select public.accept_workspace_owner_invite_v3('${'d'.repeat(64)}', '${ID.invitedTeamOwner}')`),
    /workspace_owner_invitation_not_permitted/,
  )
  await assert.rejects(
    () => db.query(`select public.accept_workspace_owner_invite_v3('${'e'.repeat(64)}', '${ID.invitedTeamOwner}')`),
    /workspace_owner_invitation_not_permitted/,
  )

  await db.close()
})

test('controlled transfer requires both authorities and preserves Team identity and related counts', async () => {
  const db = await createDatabase()
  await seedAuthority(db)
  await db.exec(`
    insert into public.players(id, club_id, team_id) values ('${ID.player}', '${ID.sourceClub}', '${ID.sourceTeam}');
    insert into public.evaluations(id, club_id, team_id, player_id) values ('${ID.evaluation}', '${ID.sourceClub}', '${ID.sourceTeam}', '${ID.player}');
    insert into public.development_parent_reports(evaluation_id, club_id) values ('${ID.evaluation}', '${ID.sourceClub}');
    insert into public.communication_logs(club_id, player_id, evaluation_id) values ('${ID.sourceClub}', '${ID.player}', '${ID.evaluation}');
    insert into public.player_staff_notes(club_id, player_id, audio_path) values ('${ID.sourceClub}', '${ID.player}', '${ID.sourceClub}/voice-note.webm');
    insert into public.guardians(club_id) values ('${ID.sourceClub}');
    insert into public.match_locations(club_id) values ('${ID.sourceClub}');
    insert into public.transfer_direct_fixture(club_id, team_id, payload) values ('${ID.sourceClub}', '${ID.sourceTeam}', 'preserve');
  `)

  const created = await db.query(`
    select public.manage_workspace_team_transfer('create', '${ID.platform}', null, '${ID.sourceTeam}', '${ID.destinationClub}') as result
  `)
  const requestId = created.rows[0].result.id
  assert.equal(created.rows[0].result.status, 'pending')

  await assert.rejects(
    () => db.query(`select public.manage_workspace_team_transfer('complete', '${ID.platform}', '${requestId}')`),
    /workspace_team_transfer_not_permitted/,
  )
  await assert.rejects(
    () => db.query(`select public.manage_workspace_team_transfer('approve', '${ID.platform}', '${requestId}')`),
    /workspace_team_transfer_not_permitted/,
  )

  const sourceApproval = await db.query(`
    select public.manage_workspace_team_transfer('approve', '${ID.teamAdmin}', '${requestId}') as result
  `)
  assert.equal(sourceApproval.rows[0].result.sourceApproved, true)
  assert.equal(sourceApproval.rows[0].result.destinationApproved, false)

  const destinationApproval = await db.query(`
    select public.manage_workspace_team_transfer('approve', '${ID.clubAdmin}', '${requestId}') as result
  `)
  assert.equal(destinationApproval.rows[0].result.status, 'ready')

  const completed = await db.query(`
    select public.manage_workspace_team_transfer('complete', '${ID.platform}', '${requestId}') as result
  `)
  assert.equal(completed.rows[0].result.status, 'completed')
  assert.deepEqual(completed.rows[0].result.preservationBefore.directCounts, completed.rows[0].result.preservationAfter.directCounts)
  assert.deepEqual(completed.rows[0].result.preservationBefore.indirectCounts, completed.rows[0].result.preservationAfter.indirectCounts)

  const team = await db.query(`select id, club_id from public.teams where id = '${ID.sourceTeam}'`)
  assert.deepEqual(team.rows[0], { id: ID.sourceTeam, club_id: ID.destinationClub })

  const preservation = await db.query(`
    select
      (select count(*) from public.players where id = '${ID.player}' and club_id = '${ID.destinationClub}' and team_id = '${ID.sourceTeam}') as players,
      (select count(*) from public.evaluations where id = '${ID.evaluation}' and club_id = '${ID.destinationClub}' and team_id = '${ID.sourceTeam}') as evaluations,
      (select count(*) from public.development_parent_reports where evaluation_id = '${ID.evaluation}' and club_id = '${ID.destinationClub}') as reports,
      (select count(*) from public.transfer_direct_fixture where club_id = '${ID.destinationClub}' and team_id = '${ID.sourceTeam}') as direct_rows,
      (select updated_at::text from public.transfer_direct_fixture where team_id = '${ID.sourceTeam}') as direct_updated_at,
      (select status from public.clubs where id = '${ID.sourceClub}') as source_status
  `)
  assert.deepEqual(preservation.rows[0], {
    players: 1,
    evaluations: 1,
    reports: 1,
    direct_rows: 1,
    direct_updated_at: '2026-01-01 00:00:00+00',
    source_status: 'suspended',
  })

  await assert.rejects(
    () => db.query(`update public.transfer_direct_fixture set payload = 'changed' where team_id = '${ID.sourceTeam}'`),
    /fixture_snapshot_immutable/,
  )

  await db.close()
})
