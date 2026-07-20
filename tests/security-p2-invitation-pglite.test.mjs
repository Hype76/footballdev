import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'
import { PGlite } from '@electric-sql/pglite'

const migrationPath = new URL('../supabase/migrations/20260720150008_p2_club_owner_invitation_processor_authority.sql', import.meta.url)

const clubOne = '11111111-1111-4111-8111-111111111111'
const clubTwo = '22222222-2222-4222-8222-222222222222'
const creatorId = '33333333-3333-4333-8333-333333333333'
const invitedUserId = '44444444-4444-4444-8444-444444444444'
const wrongUserId = '55555555-5555-4555-8555-555555555555'
const legacyInvitationId = '66666666-6666-4666-8666-666666666666'
const legacyValue = 'synthetic-legacy-invitation-value'

async function createDatabase() {
  const db = new PGlite()

  await db.exec(`
    create role anon;
    create role authenticated;
    create role service_role;
    create schema auth;

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
      status text not null default 'active'
    );

    create table public.users (
      id uuid primary key references auth.users(id),
      email text not null,
      username text,
      name text,
      display_name text,
      role text not null,
      role_label text,
      role_rank integer,
      club_id uuid references public.clubs(id),
      force_password_change boolean not null default false,
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
      created_at timestamptz not null default timezone('utc', now()),
      updated_at timestamptz not null default timezone('utc', now()),
      unique(auth_user_id, club_id)
    );

    create table public.audit_logs (
      id uuid primary key default gen_random_uuid(),
      club_id uuid references public.clubs(id),
      actor_id uuid references public.users(id),
      actor_name text,
      actor_email text,
      actor_role_label text,
      actor_role_rank integer,
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
      billing_mode text not null,
      plan_key text not null,
      invite_token text not null unique,
      status text not null default 'pending',
      expires_at timestamptz not null default timezone('utc', now()) + interval '14 days',
      accepted_at timestamptz,
      invite_sent_at timestamptz,
      created_by uuid,
      created_at timestamptz not null default timezone('utc', now()),
      updated_at timestamptz not null default timezone('utc', now()),
      constraint club_owner_invites_status_check check (status in ('pending', 'accepted', 'cancelled'))
    );

    create function public.current_user_role()
    returns text language sql stable as $$ select 'coach'::text $$;

    create function public.current_user_club_id()
    returns uuid language sql stable as $$ select null::uuid $$;

    create function public.current_user_role_rank()
    returns integer language sql stable as $$ select 0 $$;
  `)

  await db.query(
    `insert into public.clubs(id, name) values ($1, 'One FC'), ($2, 'Two FC')`,
    [clubOne, clubTwo],
  )
  await db.query(
    `insert into auth.users(id, email, raw_user_meta_data) values
      ($1, 'owner@example.test', '{"name":"Owner"}'),
      ($2, 'other@example.test', '{"name":"Other"}')`,
    [invitedUserId, wrongUserId],
  )
  await db.query(
    `insert into public.club_owner_invites(
      id, club_id, invited_email, billing_mode, plan_key, invite_token, created_by
    ) values ($1, $2, 'owner@example.test', 'paid', 'small_club', $3, $4)`,
    [legacyInvitationId, clubOne, legacyValue, creatorId],
  )

  const migration = (await readFile(migrationPath, 'utf8'))
    .replace('create extension if not exists pgcrypto;', '')
    .replace(
      "encode(digest(invite_token, 'sha256'), 'hex')",
      "md5(invite_token) || md5(invite_token || ':pglite')",
    )

  await db.exec(migration)
  return db
}

test('club-owner migration preserves a pending invitation as a digest and removes plaintext', async () => {
  const db = await createDatabase()

  try {
    const columns = await db.query(`
      select column_name
      from information_schema.columns
      where table_schema = 'public' and table_name = 'club_owner_invites'
      order by column_name
    `)
    const row = await db.query(`
      select token_digest,
        token_digest = md5($1) || md5($1 || ':pglite') as digest_matches,
        status,
        accepted_at
      from public.club_owner_invites
      where id = $2
    `, [legacyValue, legacyInvitationId])

    assert.equal(columns.rows.some(({ column_name: name }) => name === 'invite_token'), false)
    assert.equal(columns.rows.some(({ column_name: name }) => name === 'token_digest'), true)
    assert.equal(row.rows[0].digest_matches, true)
    assert.equal(row.rows[0].status, 'pending')
    assert.equal(row.rows[0].accepted_at, null)
  } finally {
    await db.close()
  }
})

test('club-owner acceptance is identity-bound, transactional, single-use and idempotent', async () => {
  const db = await createDatabase()

  try {
    const digest = (await db.query(
      `select md5($1) || md5($1 || ':pglite') as value`,
      [legacyValue],
    )).rows[0].value
    const first = await db.query(
      `select public.accept_club_owner_invite_v2($1, $2) as result`,
      [digest, invitedUserId],
    )
    const retry = await db.query(
      `select public.accept_club_owner_invite_v2($1, $2) as result`,
      [digest, invitedUserId],
    )
    const counts = await db.query(`
      select
        (select count(*)::integer from public.users where id = $1) as profile_count,
        (select count(*)::integer from public.user_club_memberships where auth_user_id = $1 and club_id = $2) as membership_count,
        (select count(*)::integer from public.audit_logs where entity_id = $3) as audit_count
    `, [invitedUserId, clubOne, legacyInvitationId])
    const audit = await db.query(
      `select metadata::text as metadata from public.audit_logs where entity_id = $1`,
      [legacyInvitationId],
    )

    assert.equal(first.rows[0].result.completed, true)
    assert.equal(first.rows[0].result.idempotent, false)
    assert.equal(retry.rows[0].result.completed, true)
    assert.equal(retry.rows[0].result.idempotent, true)
    assert.deepEqual(counts.rows[0], { profile_count: 1, membership_count: 1, audit_count: 1 })
    assert.doesNotMatch(audit.rows[0].metadata, new RegExp(legacyValue))

    await assert.rejects(
      db.query(`select public.accept_club_owner_invite_v2($1, $2)`, [digest, wrongUserId]),
      /club_owner_invitation_not_permitted/,
    )
  } finally {
    await db.close()
  }
})

test('club-owner replacement invalidates the earlier active invitation', async () => {
  const db = await createDatabase()

  try {
    const firstDigest = 'a'.repeat(64)
    const secondDigest = 'b'.repeat(64)
    const first = await db.query(`
      select public.create_club_owner_invite_v2(
        $1, 'replacement@example.test', 'paid', 'small_club', $2, $3, timezone('utc', now()) + interval '14 days'
      ) as result
    `, [clubOne, firstDigest, creatorId])
    const second = await db.query(`
      select public.create_club_owner_invite_v2(
        $1, 'replacement@example.test', 'paid', 'small_club', $2, $3, timezone('utc', now()) + interval '14 days'
      ) as result
    `, [clubOne, secondDigest, creatorId])
    const rows = await db.query(`
      select id, token_digest, status, replaced_at, replaced_by_invite_id
      from public.club_owner_invites
      where lower(invited_email) = 'replacement@example.test'
      order by created_at, id
    `)

    assert.equal(rows.rows.length, 2)
    assert.equal(rows.rows.find((row) => row.token_digest === firstDigest).status, 'replaced')
    assert.equal(rows.rows.find((row) => row.token_digest === firstDigest).replaced_by_invite_id, second.rows[0].result.id)
    assert.equal(rows.rows.find((row) => row.token_digest === secondDigest).status, 'pending')
    assert.notEqual(first.rows[0].result.id, second.rows[0].result.id)
  } finally {
    await db.close()
  }
})

test('club-owner acceptance rollback leaves invitation unconsumed when membership transaction fails', async () => {
  const db = await createDatabase()

  try {
    const digest = (await db.query(
      `select md5($1) || md5($1 || ':pglite') as value`,
      [legacyValue],
    )).rows[0].value

    await db.exec(`
      create function public.reject_owner_membership_fixture()
      returns trigger language plpgsql as $$
      begin
        raise exception 'synthetic_membership_failure';
      end;
      $$;

      create trigger reject_owner_membership_fixture
      before insert on public.user_club_memberships
      for each row execute function public.reject_owner_membership_fixture();
    `)

    await assert.rejects(
      db.query(`select public.accept_club_owner_invite_v2($1, $2)`, [digest, invitedUserId]),
      /synthetic_membership_failure/,
    )

    const state = await db.query(`
      select
        (select status from public.club_owner_invites where id = $1) as invitation_status,
        (select accepted_at from public.club_owner_invites where id = $1) as accepted_at,
        (select count(*)::integer from public.users where id = $2) as profile_count,
        (select count(*)::integer from public.user_club_memberships where auth_user_id = $2) as membership_count,
        (select count(*)::integer from public.audit_logs where entity_id = $1) as audit_count
    `, [legacyInvitationId, invitedUserId])

    assert.deepEqual(state.rows[0], {
      invitation_status: 'pending',
      accepted_at: null,
      profile_count: 0,
      membership_count: 0,
      audit_count: 0,
    })
  } finally {
    await db.close()
  }
})
