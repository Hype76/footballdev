import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'
import { PGlite } from '@electric-sql/pglite'

const migration = readFileSync(
  new URL('../supabase/migrations/20260728170000_staff_role_assignment_control.sql', import.meta.url),
  'utf8',
)

const ID = {
  clubA: '10000000-0000-4000-8000-000000000001',
  clubB: '10000000-0000-4000-8000-000000000002',
  clubC: '10000000-0000-4000-8000-000000000003',
  teamA: '20000000-0000-4000-8000-000000000001',
  teamA2: '20000000-0000-4000-8000-000000000002',
  teamB: '20000000-0000-4000-8000-000000000003',
  teamC: '20000000-0000-4000-8000-000000000004',
  platform: '30000000-0000-4000-8000-000000000001',
  clubAdminA: '30000000-0000-4000-8000-000000000002',
  clubAdminB: '30000000-0000-4000-8000-000000000003',
  teamAdminA: '30000000-0000-4000-8000-000000000004',
  secondTeamAdminA: '30000000-0000-4000-8000-000000000005',
  coachA: '30000000-0000-4000-8000-000000000006',
  managerA: '30000000-0000-4000-8000-000000000007',
  teamAdminB: '30000000-0000-4000-8000-000000000008',
  coachC: '30000000-0000-4000-8000-000000000009',
}

async function setActor(db, actorId) {
  await db.query("select set_config('request.jwt.claim.sub', $1, false)", [actorId])
}

async function createDatabase() {
  const db = new PGlite()
  await db.exec(`
    create role anon;
    create role authenticated;
    create role service_role;
    create schema auth;
    create schema app_private;

    create or replace function auth.uid()
    returns uuid
    language sql
    stable
    as $$
      select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid;
    $$;

    create table public.clubs (
      id uuid primary key,
      name text not null,
      status text not null default 'active'
    );

    create table public.users (
      id uuid primary key,
      email text,
      username text,
      name text,
      role text not null,
      role_label text,
      role_rank integer not null,
      club_id uuid references public.clubs(id),
      status text not null default 'active'
    );

    create table public.platform_admins (
      id uuid primary key references public.users(id),
      status text not null default 'active'
    );

    create table public.club_roles (
      id uuid primary key default gen_random_uuid(),
      club_id uuid not null references public.clubs(id),
      role_key text not null,
      role_label text not null,
      role_rank integer not null,
      is_system boolean not null default true,
      unique(club_id, role_key),
      unique(club_id, role_label)
    );

    create table public.user_club_memberships (
      id uuid primary key default gen_random_uuid(),
      auth_user_id uuid not null references public.users(id),
      email text,
      role text not null,
      role_label text,
      role_rank integer not null,
      club_id uuid not null references public.clubs(id),
      updated_at timestamptz not null default timezone('utc', now()),
      unique(auth_user_id, club_id)
    );

    create table public.teams (
      id uuid primary key,
      club_id uuid not null references public.clubs(id),
      name text not null,
      status text not null default 'active'
    );

    create table public.team_staff (
      id uuid primary key default gen_random_uuid(),
      team_id uuid not null references public.teams(id),
      user_id uuid not null references public.users(id),
      created_at timestamptz not null default timezone('utc', now()),
      unique(team_id, user_id)
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
      event_category text not null default 'operational',
      severity text not null default 'info',
      outcome text not null default 'success',
      source text not null default 'application',
      created_at timestamptz not null default timezone('utc', now())
    );

    create or replace function public.current_user_role()
    returns text
    language sql
    stable
    as $$
      select role from public.users where id = auth.uid();
    $$;

    create or replace function public.current_user_can_access_team(target_club_id uuid, target_team_id uuid)
    returns boolean
    language sql
    stable
    as $$
      select exists (
        select 1
        from public.users app_user
        where app_user.id = auth.uid()
          and (
            app_user.role in ('admin', 'super_admin')
            or exists (
              select 1
              from public.team_staff assignment
              where assignment.team_id = target_team_id
                and assignment.user_id = app_user.id
            )
          )
      );
    $$;

    insert into public.clubs(id, name) values
      ('${ID.clubA}', 'FP TEST A'),
      ('${ID.clubB}', 'FP TEST B'),
      ('${ID.clubC}', 'FP TEST C');

    insert into public.users(id, email, name, role, role_label, role_rank, club_id) values
      ('${ID.platform}', 'platform@example.test', 'Platform', 'super_admin', 'Platform Admin', 100, null),
      ('${ID.clubAdminA}', 'admin-a@example.test', 'Admin A', 'admin', 'Club Admin', 90, '${ID.clubA}'),
      ('${ID.clubAdminB}', 'admin-b@example.test', 'Admin B', 'admin', 'Club Admin', 90, '${ID.clubB}'),
      ('${ID.teamAdminA}', 'team-admin-a@example.test', 'Team Admin A', 'head_manager', 'Team Admin', 70, '${ID.clubA}'),
      ('${ID.secondTeamAdminA}', 'team-admin-a2@example.test', 'Team Admin A2', 'head_manager', 'Team Admin', 70, '${ID.clubA}'),
      ('${ID.coachA}', 'coach-a@example.test', 'Coach A', 'coach', 'Coach', 30, '${ID.clubA}'),
      ('${ID.managerA}', 'manager-a@example.test', 'Manager A', 'manager', 'Manager', 50, '${ID.clubA}'),
      ('${ID.teamAdminB}', 'team-admin-b@example.test', 'Team Admin B', 'head_manager', 'Team Admin', 70, '${ID.clubB}'),
      ('${ID.coachC}', 'coach-c@example.test', 'Coach C', 'coach', 'Coach', 30, '${ID.clubC}');

    insert into public.platform_admins(id) values ('${ID.platform}');

    insert into public.user_club_memberships(auth_user_id, email, role, role_label, role_rank, club_id)
    select id, email, role, role_label, role_rank, club_id
    from public.users
    where club_id is not null;

    insert into public.club_roles(club_id, role_key, role_label, role_rank)
    select club.id, role.role_key, role.role_label, role.role_rank
    from public.clubs club
    cross join (
      values
        ('admin', 'Club Admin', 90),
        ('head_manager', 'Team Admin', 70),
        ('manager', 'Manager', 50),
        ('coach', 'Coach', 30),
        ('assistant_coach', 'Assistant Coach', 20)
    ) as role(role_key, role_label, role_rank)
    where club.id in ('${ID.clubA}', '${ID.clubB}');

    insert into public.teams(id, club_id, name) values
      ('${ID.teamA}', '${ID.clubA}', 'Team A'),
      ('${ID.teamA2}', '${ID.clubA}', 'Team A2'),
      ('${ID.teamB}', '${ID.clubB}', 'Team B'),
      ('${ID.teamC}', '${ID.clubC}', 'Team C');

    insert into public.team_staff(team_id, user_id) values
      ('${ID.teamA}', '${ID.teamAdminA}'),
      ('${ID.teamA}', '${ID.coachA}'),
      ('${ID.teamA}', '${ID.managerA}'),
      ('${ID.teamA2}', '${ID.secondTeamAdminA}'),
      ('${ID.teamA2}', '${ID.coachA}'),
      ('${ID.teamA}', '${ID.clubAdminA}'),
      ('${ID.teamB}', '${ID.teamAdminB}'),
      ('${ID.teamC}', '${ID.coachC}');
  `)
  await db.exec(migration)
  return db
}

async function assignmentId(db, teamId, userId) {
  const result = await db.query(
    'select id from public.team_staff where team_id = $1 and user_id = $2',
    [teamId, userId],
  )
  return result.rows[0].id
}

async function membershipId(db, userId, clubId) {
  const result = await db.query(
    'select id from public.user_club_memberships where auth_user_id = $1 and club_id = $2',
    [userId, clubId],
  )
  return result.rows[0].id
}

async function changeRole(db, assignment, roleKey, source = 'test') {
  const result = await db.query(
    'select public.change_staff_role_assignment($1, $2, $3) as result',
    [assignment, roleKey, source],
  )
  return result.rows[0].result
}

test('missing canonical team roles are seeded before existing assignments are backfilled', async () => {
  const db = await createDatabase()
  try {
    const roles = await db.query(
      `select role_key, role_label, role_rank, is_system
       from public.club_roles
       where club_id = $1
       order by role_rank desc`,
      [ID.clubC],
    )
    assert.deepEqual(
      roles.rows.map((row) => [row.role_key, row.role_label, row.role_rank, row.is_system]),
      [
        ['head_manager', 'Team Admin', 70, true],
        ['manager', 'Manager', 50, true],
        ['coach', 'Coach', 30, true],
        ['assistant_coach', 'Assistant Coach', 20, true],
      ],
    )

    const assignment = await db.query(
      `select role_key, role_label, role_rank
       from public.team_staff
       where team_id = $1 and user_id = $2`,
      [ID.teamC, ID.coachC],
    )
    assert.deepEqual(assignment.rows[0], {
      role_key: 'coach',
      role_label: 'Coach',
      role_rank: 30,
    })
  } finally {
    await db.close()
  }
})

test('Platform Admin changes supported club roles and final Club Admin stays protected', async () => {
  const db = await createDatabase()
  try {
    await setActor(db, ID.platform)
    const coachMembership = await membershipId(db, ID.coachA, ID.clubA)
    const changed = await changeRole(db, coachMembership, 'manager', 'platform_admin_test')
    assert.equal(changed.success, true)
    assert.equal(changed.scopeType, 'club')

    const roleState = await db.query(
      `select u.role as user_role, m.role as membership_role
       from public.users u
       join public.user_club_memberships m on m.auth_user_id = u.id and m.club_id = u.club_id
       where u.id = $1`,
      [ID.coachA],
    )
    assert.deepEqual(roleState.rows[0], { user_role: 'manager', membership_role: 'manager' })

    const adminMembership = await membershipId(db, ID.clubAdminA, ID.clubA)
    const blocked = await changeRole(db, adminMembership, 'coach', 'platform_admin_test')
    assert.equal(blocked.success, false)
    assert.equal(blocked.category, 'final_club_admin')

    const audits = await db.query(
      `select action, outcome, metadata ->> 'previousRole' as previous_role,
              metadata ->> 'newRole' as new_role,
              metadata ->> 'requestSource' as request_source
       from public.audit_logs
       where entity_id in ($1, $2)
       order by created_at`,
      [coachMembership, adminMembership],
    )
    assert.deepEqual(
      audits.rows.map((row) => [row.action, row.outcome, row.previous_role, row.new_role, row.request_source]),
      [
        ['staff_role_changed', 'success', 'coach', 'manager', 'platform_admin_test'],
        ['staff_role_change_denied', 'denied', 'admin', 'coach', 'platform_admin_test'],
      ],
    )
  } finally {
    await db.close()
  }
})

test('the final active Platform Admin is protected at the database boundary', async () => {
  const db = await createDatabase()
  try {
    await assert.rejects(
      db.query('delete from public.platform_admins where id = $1', [ID.platform]),
      /final_platform_admin/,
    )
    await assert.rejects(
      db.query("update public.platform_admins set status = 'inactive' where id = $1", [ID.platform]),
      /final_platform_admin/,
    )
  } finally {
    await db.close()
  }
})

test('Team Admin manages only their team and cannot grant platform or club authority', async () => {
  const db = await createDatabase()
  try {
    await setActor(db, ID.teamAdminA)
    const coachAssignment = await assignmentId(db, ID.teamA, ID.coachA)

    for (const roleKey of ['manager', 'assistant_coach', 'coach', 'head_manager']) {
      const changed = await changeRole(db, coachAssignment, roleKey, 'team_admin_test')
      assert.equal(changed.success, true)
      assert.equal(changed.assignment.role_key, roleKey)
    }

    for (const roleKey of ['admin', 'super_admin']) {
      const blocked = await changeRole(db, coachAssignment, roleKey, 'team_admin_test')
      assert.equal(blocked.success, false)
      assert.equal(blocked.category, 'role_not_supported')
    }

    const otherTeamAssignment = await assignmentId(db, ID.teamA2, ID.coachA)
    const crossTeam = await changeRole(db, otherTeamAssignment, 'manager', 'team_admin_test')
    assert.equal(crossTeam.success, false)
    assert.equal(crossTeam.category, 'team_scope_forbidden')

    const otherClubAssignment = await assignmentId(db, ID.teamB, ID.teamAdminB)
    const crossClub = await changeRole(db, otherClubAssignment, 'coach', 'team_admin_test')
    assert.equal(crossClub.success, false)
    assert.equal(crossClub.category, 'team_scope_forbidden')

    const protectedAssignment = await assignmentId(db, ID.teamA, ID.clubAdminA)
    const protectedResult = await changeRole(db, protectedAssignment, 'coach', 'team_admin_test')
    assert.equal(protectedResult.success, false)
    assert.equal(protectedResult.category, 'protected_assignment')
  } finally {
    await db.close()
  }
})

test('final Team Admin protection and contextual permission refresh are immediate', async () => {
  const db = await createDatabase()
  try {
    await setActor(db, ID.teamAdminA)
    const actorAssignment = await assignmentId(db, ID.teamA, ID.teamAdminA)
    const coachAssignment = await assignmentId(db, ID.teamA, ID.coachA)

    const finalAdminBlocked = await changeRole(db, actorAssignment, 'coach', 'self_demotion_test')
    assert.equal(finalAdminBlocked.success, false)
    assert.equal(finalAdminBlocked.category, 'final_team_admin')

    const promoted = await changeRole(db, coachAssignment, 'head_manager', 'promotion_test')
    assert.equal(promoted.success, true)

    const selfDemoted = await changeRole(db, actorAssignment, 'assistant_coach', 'self_demotion_test')
    assert.equal(selfDemoted.success, true)

    const permissions = await db.query(
      `select
         public.current_user_team_role_rank($1) as contextual_rank,
         app_private.actor_can_manage_team_resource($2, $3, $1, 50) as can_manage_team_a,
         app_private.actor_can_manage_team_resource($2, $3, $4, 50) as can_manage_team_a2`,
      [ID.teamA, ID.teamAdminA, ID.clubA, ID.teamA2],
    )
    assert.deepEqual(permissions.rows[0], {
      contextual_rank: 20,
      can_manage_team_a: false,
      can_manage_team_a2: false,
    })

    const deniedAfterDemotion = await changeRole(db, coachAssignment, 'manager', 'stale_session_test')
    assert.equal(deniedAfterDemotion.success, false)
    assert.equal(deniedAfterDemotion.category, 'team_scope_forbidden')
  } finally {
    await db.close()
  }
})

test('team assignment helper keeps the club profile role unchanged', async () => {
  const db = await createDatabase()
  try {
    await setActor(db, ID.clubAdminA)
    const result = await db.query(
      'select public.assign_team_staff_role($1, $2, $3, $4) as result',
      [ID.managerA, ID.teamA2, 'assistant_coach', 'staff_invitation_test'],
    )
    assert.equal(result.rows[0].result.success, true)

    const state = await db.query(
      `select u.role as club_role, a.role_key as team_role
       from public.users u
       join public.team_staff a on a.user_id = u.id and a.team_id = $2
       where u.id = $1`,
      [ID.managerA, ID.teamA2],
    )
    assert.deepEqual(state.rows[0], { club_role: 'manager', team_role: 'assistant_coach' })
  } finally {
    await db.close()
  }
})

test('team assignment helper reuses protected transitions for existing assignments', async () => {
  const db = await createDatabase()
  try {
    await setActor(db, ID.teamAdminA)

    const selfDemotion = await db.query(
      'select public.assign_team_staff_role($1, $2, $3, $4) as result',
      [ID.teamAdminA, ID.teamA, 'coach', 'existing_assignment_test'],
    )
    assert.equal(selfDemotion.rows[0].result.success, false)
    assert.equal(selfDemotion.rows[0].result.category, 'final_team_admin')

    await setActor(db, ID.managerA)
    const managerEscalation = await db.query(
      'select public.assign_team_staff_role($1, $2, $3, $4) as result',
      [ID.coachA, ID.teamA, 'manager', 'manager_escalation_test'],
    )
    assert.equal(managerEscalation.rows[0].result.success, false)
    assert.equal(managerEscalation.rows[0].result.category, 'team_scope_forbidden')
  } finally {
    await db.close()
  }
})
