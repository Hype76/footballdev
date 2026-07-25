import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'
import { PGlite } from '@electric-sql/pglite'

const migration = await readFile(
  new URL('../supabase/migrations/20260725174533_platform_club_access_management.sql', import.meta.url),
  'utf8',
)
const migrationForTest = migration.replace('create extension if not exists pgcrypto;', '')

const ID = Object.freeze({
  actor: '10000000-0000-4000-8000-000000000001',
  clubA: '20000000-0000-4000-8000-000000000001',
  clubB: '20000000-0000-4000-8000-000000000002',
  adminA: '30000000-0000-4000-8000-000000000001',
  adminB: '30000000-0000-4000-8000-000000000002',
  teamAdmin: '30000000-0000-4000-8000-000000000003',
  existingAuth: '30000000-0000-4000-8000-000000000004',
  teamA: '40000000-0000-4000-8000-000000000001',
  teamA2: '40000000-0000-4000-8000-000000000003',
  teamB: '40000000-0000-4000-8000-000000000002',
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
      email text
    );

    create table public.clubs (
      id uuid primary key,
      name text not null,
      status text not null default 'active',
      plan_key text not null default 'small_club'
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
      suspended_at timestamptz
    );

    create table public.platform_admins (
      id uuid primary key references auth.users(id),
      status text not null default 'active'
    );

    create table public.teams (
      id uuid primary key,
      club_id uuid not null references public.clubs(id),
      name text not null,
      status text not null default 'active'
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
      user_id uuid not null references auth.users(id),
      created_at timestamptz not null default timezone('utc', now()),
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
      event_category text not null default 'operational',
      severity text not null default 'info',
      outcome text not null default 'success',
      correlation_id uuid not null default gen_random_uuid(),
      source text not null default 'application'
        check (source in ('application', 'database', 'netlify_function', 'scheduled_monitor')),
      created_at timestamptz not null default timezone('utc', now())
    );

    create table public.club_owner_invites (
      id uuid primary key default gen_random_uuid(),
      club_id uuid not null references public.clubs(id),
      invited_email text not null,
      accepted_email text,
      billing_mode text not null default 'unpaid',
      plan_key text not null default 'small_club',
      status text not null default 'pending'
        check (status in ('pending', 'accepted', 'cancelled', 'revoked', 'replaced')),
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
      replaced_by_invite_id uuid
    );

    create unique index club_owner_invites_one_active_identity_key
      on public.club_owner_invites (club_id, lower(invited_email))
      where status = 'pending' and accepted_at is null and revoked_at is null and replaced_at is null;

    create table public.club_user_invites (
      id uuid primary key default gen_random_uuid(),
      club_id uuid not null references public.clubs(id),
      email text not null,
      role_key text not null,
      role_label text not null,
      role_rank integer not null,
      created_by uuid,
      created_at timestamptz not null default timezone('utc', now()),
      accepted_at timestamptz,
      invite_token uuid not null default gen_random_uuid(),
      team_id uuid references public.teams(id),
      expires_at timestamptz,
      invite_sent_at timestamptz
    );

    create unique index club_user_invites_club_id_email_key
      on public.club_user_invites (club_id, email);

    alter table public.club_owner_invites
      add constraint club_owner_invites_replaced_by_fkey
      foreign key (replaced_by_invite_id) references public.club_owner_invites(id);
  `)

  await db.exec(migrationForTest)
  await db.exec(`
    insert into public.clubs(id, name) values
      ('${ID.clubA}', 'FP TEST Access A'),
      ('${ID.clubB}', 'FP TEST Access B');

    insert into public.teams(id, club_id, name) values
      ('${ID.teamA}', '${ID.clubA}', 'A Team'),
      ('${ID.teamA2}', '${ID.clubA}', 'A Second Team'),
      ('${ID.teamB}', '${ID.clubB}', 'B Team');

    insert into auth.users(id, email) values
      ('${ID.actor}', 'platform@example.test'),
      ('${ID.adminA}', 'admin.a@example.test'),
      ('${ID.adminB}', 'admin.b@example.test'),
      ('${ID.teamAdmin}', 'team.admin@example.test'),
      ('${ID.existingAuth}', 'existing.auth@example.test');

    insert into public.users(id, email, username, name, display_name, role, role_label, role_rank, club_id) values
      ('${ID.actor}', 'platform@example.test', 'Platform', 'Platform', 'Platform', 'super_admin', 'Super Admin', 100, null),
      ('${ID.adminA}', 'admin.a@example.test', 'Admin A', 'Admin A', 'Admin A', 'admin', 'Club Admin', 90, '${ID.clubA}'),
      ('${ID.adminB}', 'admin.b@example.test', 'Admin B', 'Admin B', 'Admin B', 'admin', 'Club Admin', 90, '${ID.clubA}'),
      ('${ID.teamAdmin}', 'team.admin@example.test', 'Team Admin', 'Team Admin', 'Team Admin', 'head_manager', 'Team Admin', 70, '${ID.clubA}');

    insert into public.platform_admins(id) values ('${ID.actor}');

    insert into public.user_club_memberships(auth_user_id, email, username, name, role, role_label, role_rank, club_id) values
      ('${ID.adminA}', 'admin.a@example.test', 'Admin A', 'Admin A', 'admin', 'Club Admin', 90, '${ID.clubA}'),
      ('${ID.adminB}', 'admin.b@example.test', 'Admin B', 'Admin B', 'admin', 'Club Admin', 90, '${ID.clubA}'),
      ('${ID.teamAdmin}', 'team.admin@example.test', 'Team Admin', 'Team Admin', 'head_manager', 'Team Admin', 70, '${ID.clubA}');

    insert into public.team_staff(team_id, user_id) values ('${ID.teamA}', '${ID.teamAdmin}');
  `)
  return db
}

test('migration compiles and owner reissue atomically supersedes one invitation', async () => {
  const db = await createDatabase()
  const first = await db.query(`
    select public.platform_create_access_invite_v1(
      '${ID.actor}', '${ID.clubA}', 'new.admin@example.test', 'admin', '{}',
      repeat('a', 64), '', null, timezone('utc', now()) + interval '14 days',
      '50000000-0000-4000-8000-000000000001'
    ) as result
  `)
  assert.equal(first.rows[0].result.allowed, true)

  const sourceId = first.rows[0].result.inviteId
  const replaced = await db.query(`
    select public.platform_create_access_invite_v1(
      '${ID.actor}', '${ID.clubA}', 'new.admin@example.test', 'admin', '{}',
      repeat('b', 64), '', '${sourceId}', timezone('utc', now()) + interval '14 days',
      '50000000-0000-4000-8000-000000000002'
    ) as result
  `)
  assert.equal(replaced.rows[0].result.allowed, true)

  const state = await db.query(`
    select
      count(*) filter (where status = 'pending')::integer as pending_count,
      count(*) filter (where status = 'replaced')::integer as replaced_count,
      count(*) filter (where replaced_by_invite_id is not null)::integer as linked_count
    from public.club_owner_invites
    where club_id = '${ID.clubA}' and invited_email = 'new.admin@example.test'
  `)
  assert.deepEqual(state.rows[0], { pending_count: 1, replaced_count: 1, linked_count: 1 })

  const audits = await db.query(`
    select action, source, metadata->>'feature' as feature, metadata->>'operation' as operation
    from public.audit_logs
    where correlation_id in (
      '50000000-0000-4000-8000-000000000001',
      '50000000-0000-4000-8000-000000000002'
    )
    order by created_at
  `)
  assert.equal(audits.rows.length, 2)
  for (const audit of audits.rows) {
    assert.equal(audit.source, 'netlify_function')
    assert.equal(audit.feature, 'platform_club_access')
    assert.equal(audit.operation, audit.action)
  }
  await db.close()
})

test('duplicate and cross-club Team Admin attempts are denied and audited', async () => {
  const db = await createDatabase()
  const crossClub = await db.query(`
    select public.platform_create_access_invite_v1(
      '${ID.actor}', '${ID.clubA}', 'new.team@example.test', 'head_manager',
      array['${ID.teamB}']::uuid[], '', '60000000-0000-4000-8000-000000000001',
      null, timezone('utc', now()) + interval '14 days',
      '50000000-0000-4000-8000-000000000003'
    ) as result
  `)
  assert.deepEqual(crossClub.rows[0].result, { allowed: false, code: 'cross_club_team' })

  const audit = await db.query(`
    select action, outcome, metadata->>'denialCode' as denial_code
    from public.audit_logs
    where correlation_id = '50000000-0000-4000-8000-000000000003'
  `)
  assert.deepEqual(audit.rows[0], {
    action: 'platform_access_cross_club_team_denied',
    outcome: 'denied',
    denial_code: 'cross_club_team',
  })
  await db.close()
})

test('delivery claim records one provider acceptance and blocks replacement while processing', async () => {
  const db = await createDatabase()
  const created = await db.query(`
    select public.platform_create_access_invite_v1(
      '${ID.actor}', '${ID.clubA}', 'delivery@example.test', 'admin', '{}',
      repeat('d', 64), '', null, timezone('utc', now()) + interval '14 days',
      '50000000-0000-4000-8000-000000000008'
    ) as result
  `)
  const inviteId = created.rows[0].result.inviteId
  const claimed = await db.query(`
    select public.platform_claim_access_invite_delivery_v1(
      '${ID.actor}', '${inviteId}', 'admin', '50000000-0000-4000-8000-000000000008'
    ) as result
  `)
  assert.equal(claimed.rows[0].result.deliveryStatus, 'processing')

  const blocked = await db.query(`
    select public.platform_create_access_invite_v1(
      '${ID.actor}', '${ID.clubA}', 'delivery@example.test', 'admin', '{}',
      repeat('e', 64), '', '${inviteId}', timezone('utc', now()) + interval '14 days',
      '50000000-0000-4000-8000-000000000009'
    ) as result
  `)
  assert.deepEqual(blocked.rows[0].result, { allowed: false, code: 'source_not_replaceable' })

  const recorded = await db.query(`
    select public.platform_record_access_invite_delivery_v1(
      '${ID.actor}', '${inviteId}', 'admin', 'provider-fixture-1',
      'provider_accepted', '', '50000000-0000-4000-8000-000000000008'
    ) as result
  `)
  assert.equal(recorded.rows[0].result.deliveryStatus, 'provider_accepted')

  const state = await db.query(`
    select delivery_status, provider_message_id, invite_sent_at is not null as was_sent
    from public.club_owner_invites where id = '${inviteId}'
  `)
  assert.deepEqual(state.rows[0], {
    delivery_status: 'provider_accepted',
    provider_message_id: 'provider-fixture-1',
    was_sent: true,
  })
  await db.close()
})

test('concurrent replacement attempts leave exactly one fresh pending invitation', async () => {
  const db = await createDatabase()
  const created = await db.query(`
    select public.platform_create_access_invite_v1(
      '${ID.actor}', '${ID.clubA}', 'concurrent@example.test', 'admin', '{}',
      repeat('1', 64), '', null, timezone('utc', now()) + interval '14 days',
      '50000000-0000-4000-8000-000000000010'
    ) as result
  `)
  const sourceId = created.rows[0].result.inviteId
  const attempts = await Promise.all([
    db.query(`
      select public.platform_create_access_invite_v1(
        '${ID.actor}', '${ID.clubA}', 'concurrent@example.test', 'admin', '{}',
        repeat('2', 64), '', '${sourceId}', timezone('utc', now()) + interval '14 days',
        '50000000-0000-4000-8000-000000000011'
      ) as result
    `),
    db.query(`
      select public.platform_create_access_invite_v1(
        '${ID.actor}', '${ID.clubA}', 'concurrent@example.test', 'admin', '{}',
        repeat('3', 64), '', '${sourceId}', timezone('utc', now()) + interval '14 days',
        '50000000-0000-4000-8000-000000000012'
      ) as result
    `),
  ])
  assert.deepEqual(attempts.map((attempt) => attempt.rows[0].result.allowed).sort(), [false, true])

  const state = await db.query(`
    select count(*) filter (where status = 'pending')::integer as pending_count
    from public.club_owner_invites
    where club_id = '${ID.clubA}' and invited_email = 'concurrent@example.test'
  `)
  assert.equal(state.rows[0].pending_count, 1)
  await db.close()
})

test('existing Auth users receive explicit Club Admin and multi-team assignments without duplicate accounts', async () => {
  const db = await createDatabase()
  const clubAdmin = await db.query(`
    select public.platform_assign_existing_access_v1(
      '${ID.actor}', '${ID.clubA}', '${ID.existingAuth}', 'existing.auth@example.test',
      'admin', '{}', '50000000-0000-4000-8000-000000000013'
    ) as result
  `)
  assert.equal(clubAdmin.rows[0].result.allowed, true)

  const multiTeam = await db.query(`
    select public.platform_assign_existing_access_v1(
      '${ID.actor}', '${ID.clubA}', '${ID.teamAdmin}', 'team.admin@example.test',
      'head_manager', array['${ID.teamA}', '${ID.teamA2}']::uuid[],
      '50000000-0000-4000-8000-000000000014'
    ) as result
  `)
  assert.equal(multiTeam.rows[0].result.allowed, true)

  const duplicate = await db.query(`
    select public.platform_assign_existing_access_v1(
      '${ID.actor}', '${ID.clubA}', '${ID.teamAdmin}', 'team.admin@example.test',
      'head_manager', array['${ID.teamA}', '${ID.teamA2}']::uuid[],
      '50000000-0000-4000-8000-000000000015'
    ) as result
  `)
  assert.deepEqual(duplicate.rows[0].result, { allowed: false, code: 'assignment_exists' })

  const state = await db.query(`
    select
      (select count(*)::integer from auth.users where id = '${ID.existingAuth}') as auth_count,
      (select count(*)::integer from public.user_club_memberships where auth_user_id = '${ID.existingAuth}' and club_id = '${ID.clubA}') as club_admin_count,
      (select count(*)::integer from public.team_staff where user_id = '${ID.teamAdmin}') as team_count
  `)
  assert.deepEqual(state.rows[0], { auth_count: 1, club_admin_count: 1, team_count: 2 })
  await db.close()
})

test('Team Admin assignment removal and restoration preserve the account', async () => {
  const db = await createDatabase()
  const removed = await db.query(`
    select public.platform_change_access_assignment_v1(
      '${ID.actor}', '${ID.clubA}', '${ID.teamAdmin}', 'team_admin', '${ID.teamA}',
      'remove', null, '50000000-0000-4000-8000-000000000004'
    ) as result
  `)
  assert.equal(removed.rows[0].result.allowed, true)
  const historyId = removed.rows[0].result.historyId

  const restored = await db.query(`
    select public.platform_change_access_assignment_v1(
      '${ID.actor}', '${ID.clubA}', '${ID.teamAdmin}', 'team_admin', '${ID.teamA}',
      'restore', '${historyId}', '50000000-0000-4000-8000-000000000005'
    ) as result
  `)
  assert.equal(restored.rows[0].result.allowed, true)

  const state = await db.query(`
    select
      (select count(*)::integer from auth.users where id = '${ID.teamAdmin}') as auth_count,
      (select count(*)::integer from public.team_staff where user_id = '${ID.teamAdmin}' and team_id = '${ID.teamA}') as assignment_count,
      (select state from public.platform_access_assignment_history where id = '${historyId}') as history_state
  `)
  assert.deepEqual(state.rows[0], { auth_count: 1, assignment_count: 1, history_state: 'restored' })
  await db.close()
})

test('final administrator removal is denied with a structured audit', async () => {
  const db = await createDatabase()
  await db.exec(`delete from public.user_club_memberships where auth_user_id = '${ID.adminB}'`)
  const denied = await db.query(`
    select public.platform_change_access_assignment_v1(
      '${ID.actor}', '${ID.clubA}', '${ID.adminA}', 'club_admin', null,
      'remove', null, '50000000-0000-4000-8000-000000000006'
    ) as result
  `)
  assert.deepEqual(denied.rows[0].result, { allowed: false, code: 'final_administrator' })

  const state = await db.query(`
    select
      (select count(*)::integer from public.user_club_memberships where auth_user_id = '${ID.adminA}') as membership_count,
      (select metadata->>'denialCode' from public.audit_logs where correlation_id = '50000000-0000-4000-8000-000000000006') as denial_code
  `)
  assert.deepEqual(state.rows[0], { membership_count: 1, denial_code: 'final_administrator' })
  await db.close()
})

test('Club Admin removal and restoration keep Auth and attribution rows intact', async () => {
  const db = await createDatabase()
  await db.exec(`
    create table public.historical_attribution (
      id uuid primary key default gen_random_uuid(),
      actor_id uuid not null,
      created_at timestamptz not null default timezone('utc', now())
    );
    insert into public.historical_attribution(actor_id) values ('${ID.adminB}');
  `)
  const removed = await db.query(`
    select public.platform_change_access_assignment_v1(
      '${ID.actor}', '${ID.clubA}', '${ID.adminB}', 'club_admin', null,
      'remove', null, '50000000-0000-4000-8000-000000000016'
    ) as result
  `)
  assert.equal(removed.rows[0].result.allowed, true)
  const historyId = removed.rows[0].result.historyId

  const restored = await db.query(`
    select public.platform_change_access_assignment_v1(
      '${ID.actor}', '${ID.clubA}', '${ID.adminB}', 'club_admin', null,
      'restore', '${historyId}', '50000000-0000-4000-8000-000000000017'
    ) as result
  `)
  assert.equal(restored.rows[0].result.allowed, true)

  const state = await db.query(`
    select
      (select count(*)::integer from auth.users where id = '${ID.adminB}') as auth_count,
      (select count(*)::integer from public.user_club_memberships where auth_user_id = '${ID.adminB}' and club_id = '${ID.clubA}') as membership_count,
      (select count(*)::integer from public.historical_attribution where actor_id = '${ID.adminB}') as attribution_count
  `)
  assert.deepEqual(state.rows[0], { auth_count: 1, membership_count: 1, attribution_count: 1 })
  await db.close()
})

test('accepted invitations cannot be replaced and pending invitations can be cancelled once', async () => {
  const db = await createDatabase()
  const created = await db.query(`
    select public.platform_create_access_invite_v1(
      '${ID.actor}', '${ID.clubA}', 'accepted@example.test', 'admin', '{}',
      repeat('4', 64), '', null, timezone('utc', now()) + interval '14 days',
      '50000000-0000-4000-8000-000000000018'
    ) as result
  `)
  const acceptedInviteId = created.rows[0].result.inviteId
  await db.exec(`
    update public.club_owner_invites
    set status = 'accepted', accepted_at = timezone('utc', now())
    where id = '${acceptedInviteId}'
  `)

  const replacement = await db.query(`
    select public.platform_create_access_invite_v1(
      '${ID.actor}', '${ID.clubA}', 'accepted@example.test', 'admin', '{}',
      repeat('5', 64), '', '${acceptedInviteId}', timezone('utc', now()) + interval '14 days',
      '50000000-0000-4000-8000-000000000019'
    ) as result
  `)
  assert.deepEqual(replacement.rows[0].result, { allowed: false, code: 'source_not_replaceable' })

  const cancellable = await db.query(`
    select public.platform_create_access_invite_v1(
      '${ID.actor}', '${ID.clubA}', 'cancel@example.test', 'admin', '{}',
      repeat('6', 64), '', null, timezone('utc', now()) + interval '14 days',
      '50000000-0000-4000-8000-000000000020'
    ) as result
  `)
  const cancellableInviteId = cancellable.rows[0].result.inviteId
  const cancelled = await db.query(`
    select public.platform_cancel_access_invite_v1(
      '${ID.actor}', '${cancellableInviteId}', 'admin',
      '50000000-0000-4000-8000-000000000021'
    ) as result
  `)
  assert.equal(cancelled.rows[0].result.allowed, true)

  const duplicateCancel = await db.query(`
    select public.platform_cancel_access_invite_v1(
      '${ID.actor}', '${cancellableInviteId}', 'admin',
      '50000000-0000-4000-8000-000000000022'
    ) as result
  `)
  assert.deepEqual(duplicateCancel.rows[0].result, { allowed: false, code: 'invitation_not_cancellable' })

  const state = await db.query(`
    select status, delivery_status
    from public.club_owner_invites
    where id = '${cancellableInviteId}'
  `)
  assert.deepEqual(state.rows[0], { status: 'cancelled', delivery_status: 'cancelled' })
  await db.close()
})

test('audit failure rolls back the invitation mutation', async () => {
  const db = await createDatabase()
  await db.exec(`
    create function public.fail_platform_access_audit()
    returns trigger language plpgsql as $$
    begin
      if new.metadata->>'feature' = 'platform_club_access' then
        raise exception 'synthetic_audit_failure';
      end if;
      return new;
    end;
    $$;

    create trigger fail_platform_access_audit
    before insert on public.audit_logs
    for each row execute function public.fail_platform_access_audit();
  `)

  await assert.rejects(
    db.query(`
      select public.platform_create_access_invite_v1(
        '${ID.actor}', '${ID.clubA}', 'audit.fail@example.test', 'admin', '{}',
        repeat('c', 64), '', null, timezone('utc', now()) + interval '14 days',
        '50000000-0000-4000-8000-000000000007'
      )
    `),
    /synthetic_audit_failure/,
  )

  const count = await db.query(`select count(*)::integer as count from public.club_owner_invites where invited_email = 'audit.fail@example.test'`)
  assert.equal(count.rows[0].count, 0)
  await db.close()
})
