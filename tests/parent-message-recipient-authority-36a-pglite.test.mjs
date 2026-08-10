import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'
import { PGlite } from '@electric-sql/pglite'

const migrationUrl = new URL(
  '../supabase/migrations/20260810103818_parent_message_recipient_authority_containment_36a.sql',
  import.meta.url,
)

const ids = {
  club: '10000000-0000-4000-8000-000000000001',
  parentA: '20000000-0000-4000-8000-000000000001',
  parentB: '20000000-0000-4000-8000-000000000002',
  playerA: '30000000-0000-4000-8000-000000000001',
  playerSibling: '30000000-0000-4000-8000-000000000002',
  playerArchived: '30000000-0000-4000-8000-000000000003',
  linkA: '40000000-0000-4000-8000-000000000001',
  linkB: '40000000-0000-4000-8000-000000000002',
  linkSibling: '40000000-0000-4000-8000-000000000003',
  linkArchived: '40000000-0000-4000-8000-000000000004',
  messageA: '50000000-0000-4000-8000-000000000001',
  messageB: '50000000-0000-4000-8000-000000000002',
  messageBoth: '50000000-0000-4000-8000-000000000003',
  messageAByLink: '50000000-0000-4000-8000-000000000004',
  messageBByLink: '50000000-0000-4000-8000-000000000005',
  messageUnprovable: '50000000-0000-4000-8000-000000000006',
  messageSibling: '50000000-0000-4000-8000-000000000007',
  messageArchived: '50000000-0000-4000-8000-000000000008',
}

async function setActor(db, userId) {
  await db.query(`select set_config('request.jwt.claims', $1, false)`, [
    JSON.stringify({ sub: userId }),
  ])
}

async function createDatabase() {
  const db = new PGlite()
  const migration = await readFile(migrationUrl, 'utf8')

  await db.exec(`
    create role anon;
    create role authenticated;
    create role service_role;
    create schema auth;

    create function auth.uid()
    returns uuid
    language sql
    stable
    as $$
      select (nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'sub')::uuid
    $$;

    create table public.users (
      id uuid primary key,
      status text not null default 'active'
    );

    create table public.players (
      id uuid primary key,
      club_id uuid not null,
      status text not null default 'active'
    );

    create table public.parent_player_links (
      id uuid primary key,
      club_id uuid not null,
      player_id uuid not null,
      auth_user_id uuid,
      email text,
      status text not null default 'pending'
    );

    create table public.communication_logs (
      id uuid primary key,
      club_id uuid not null,
      player_id uuid,
      evaluation_id uuid,
      user_name text,
      user_email text,
      channel text not null,
      action text not null,
      recipient_email text,
      metadata jsonb not null default '{}'::jsonb,
      created_at timestamptz not null default statement_timestamp()
    );

    create table public.parent_portal_message_reads (
      id uuid primary key default gen_random_uuid(),
      parent_link_id uuid not null,
      communication_log_id uuid not null,
      auth_user_id uuid not null,
      read_at timestamptz not null default statement_timestamp(),
      created_at timestamptz not null default statement_timestamp()
    );

    create unique index parent_portal_message_reads_unique
    on public.parent_portal_message_reads(parent_link_id, communication_log_id, auth_user_id);

    create function public.current_user_can_access_parent_link(
      target_parent_link_id uuid,
      target_player_id uuid
    )
    returns boolean
    language sql
    stable
    security definer
    set search_path = pg_catalog, public
    as $$
      select (select auth.uid()) is not null
        and not exists (
          select 1
          from public.users actor
          where actor.id = (select auth.uid())
            and actor.status = 'suspended'
        )
        and exists (
          select 1
          from public.parent_player_links link
          join public.players player
            on player.id = link.player_id
           and player.club_id = link.club_id
          where link.id = target_parent_link_id
            and link.auth_user_id = (select auth.uid())
            and link.status = 'active'
            and link.player_id = target_player_id
            and coalesce(player.status, 'active') <> 'archived'
        )
    $$;
  `)

  await db.query(`
    insert into public.users(id, status)
    values ($1, 'active'), ($2, 'active')
  `, [ids.parentA, ids.parentB])

  await db.query(`
    insert into public.players(id, club_id, status)
    values
      ($1, $4, 'active'),
      ($2, $4, 'active'),
      ($3, $4, 'archived')
  `, [ids.playerA, ids.playerSibling, ids.playerArchived, ids.club])

  await db.query(`
    insert into public.parent_player_links(
      id, club_id, player_id, auth_user_id, email, status
    )
    values
      ($1, $8, $5, $9, 'parent-a@example.invalid', 'active'),
      ($2, $8, $5, $10, 'parent-b@example.invalid', 'active'),
      ($3, $8, $6, $9, 'parent-a@example.invalid', 'active'),
      ($4, $8, $7, $9, 'parent-a@example.invalid', 'active')
  `, [
    ids.linkA,
    ids.linkB,
    ids.linkSibling,
    ids.linkArchived,
    ids.playerA,
    ids.playerSibling,
    ids.playerArchived,
    ids.club,
    ids.parentA,
    ids.parentB,
  ])

  await db.query(`
    insert into public.communication_logs(
      id, club_id, player_id, channel, action, recipient_email, metadata, created_at
    )
    values
      ($1, $9, $10, 'email', 'parent_email_sent', 'parent-a@example.invalid', '{}', '2026-08-10T01:00:00Z'),
      ($2, $9, $10, 'email', 'parent_email_sent', 'parent-b@example.invalid', '{}', '2026-08-10T02:00:00Z'),
      ($3, $9, $10, 'email', 'parent_email_sent', 'parent-b@example.invalid, parent-a@example.invalid', '{}', '2026-08-10T03:00:00Z'),
      ($4, $9, $10, 'email', 'parent_email_sent', 'stale-address@example.invalid', jsonb_build_object('recipientLinkId', $11::text), '2026-08-10T04:00:00Z'),
      ($5, $9, $10, 'email', 'parent_email_sent', 'parent-a@example.invalid', jsonb_build_object('recipientLinkId', $12::text), '2026-08-10T05:00:00Z'),
      ($6, $9, $10, 'email', 'parent_email_sent', '', '{}', '2026-08-10T06:00:00Z'),
      ($7, $9, $13, 'email', 'parent_email_sent', 'parent-a@example.invalid', '{}', '2026-08-10T07:00:00Z'),
      ($8, $9, $14, 'email', 'parent_email_sent', 'parent-a@example.invalid', '{}', '2026-08-10T08:00:00Z')
  `, [
    ids.messageA,
    ids.messageB,
    ids.messageBoth,
    ids.messageAByLink,
    ids.messageBByLink,
    ids.messageUnprovable,
    ids.messageSibling,
    ids.messageArchived,
    ids.club,
    ids.playerA,
    ids.linkA,
    ids.linkB,
    ids.playerSibling,
    ids.playerArchived,
  ])

  await db.exec(migration)
  return db
}

test('Parent communication history is scoped to exact recipients and selected child', async () => {
  const db = await createDatabase()

  await setActor(db, ids.parentA)
  const parentA = await db.query(
    `select id from public.get_parent_portal_email_messages($1) order by created_at`,
    [ids.linkA],
  )
  assert.deepEqual(parentA.rows.map((row) => row.id), [
    ids.messageA,
    ids.messageBoth,
    ids.messageAByLink,
  ])

  const sibling = await db.query(
    `select id from public.get_parent_portal_email_messages($1)`,
    [ids.linkSibling],
  )
  assert.deepEqual(sibling.rows.map((row) => row.id), [ids.messageSibling])

  const archived = await db.query(
    `select id from public.get_parent_portal_email_messages($1)`,
    [ids.linkArchived],
  )
  assert.deepEqual(archived.rows, [])

  await setActor(db, ids.parentB)
  const parentB = await db.query(
    `select id from public.get_parent_portal_email_messages($1) order by created_at`,
    [ids.linkB],
  )
  assert.deepEqual(parentB.rows.map((row) => row.id), [
    ids.messageB,
    ids.messageBoth,
    ids.messageBByLink,
  ])

  await db.close()
})

test('read markers reject another Parent and revoked links', async () => {
  const db = await createDatabase()

  await setActor(db, ids.parentA)
  await db.query(
    `select public.mark_parent_portal_message_read($1, $2)`,
    [ids.linkA, ids.messageA],
  )
  await assert.rejects(
    db.query(
      `select public.mark_parent_portal_message_read($1, $2)`,
      [ids.linkA, ids.messageB],
    ),
    /This message could not be opened/,
  )

  await db.query(
    `update public.parent_player_links set status = 'revoked' where id = $1`,
    [ids.linkA],
  )
  const afterRevoke = await db.query(
    `select id from public.get_parent_portal_email_messages($1)`,
    [ids.linkA],
  )
  assert.deepEqual(afterRevoke.rows, [])
  await assert.rejects(
    db.query(
      `select public.mark_parent_portal_message_read($1, $2)`,
      [ids.linkA, ids.messageA],
    ),
    /This message could not be opened/,
  )

  await db.close()
})
