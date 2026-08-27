import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'
import { PGlite } from '@electric-sql/pglite'

const migrationUrl = new URL(
  '../supabase/migrations/20260827095500_parent_club_announcements_staff_only.sql',
  import.meta.url,
)

const id = {
  club: '10000000-0000-4000-8000-000000000001',
  parent: '20000000-0000-4000-8000-000000000001',
  player: '30000000-0000-4000-8000-000000000001',
  link: '40000000-0000-4000-8000-000000000001',
  activeStaff: '50000000-0000-4000-8000-000000000001',
  inactiveStaff: '50000000-0000-4000-8000-000000000002',
  lowRankUser: '50000000-0000-4000-8000-000000000003',
  valid: '60000000-0000-4000-8000-000000000001',
  automated: '60000000-0000-4000-8000-000000000002',
  inactive: '60000000-0000-4000-8000-000000000003',
  lowRank: '60000000-0000-4000-8000-000000000004',
  missingProvenance: '60000000-0000-4000-8000-000000000005',
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
      club_id uuid,
      role_rank integer not null default 0,
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
      user_id uuid,
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
      select exists (
        select 1
        from public.parent_player_links link
        join public.players player
          on player.id = link.player_id
         and player.club_id = link.club_id
        where link.id = target_parent_link_id
          and link.player_id = target_player_id
          and link.auth_user_id = (select auth.uid())
          and link.status = 'active'
          and player.status = 'active'
      )
    $$;
  `)

  await db.query(`
    insert into public.users(id, club_id, role_rank, status)
    values
      ($1, $5, 0, 'active'),
      ($2, $5, 30, 'active'),
      ($3, $5, 30, 'suspended'),
      ($4, $5, 10, 'active')
  `, [id.parent, id.activeStaff, id.inactiveStaff, id.lowRankUser, id.club])

  await db.query(
    `insert into public.players(id, club_id, status) values ($1, $2, 'active')`,
    [id.player, id.club],
  )
  await db.query(`
    insert into public.parent_player_links(id, club_id, player_id, auth_user_id, email, status)
    values ($1, $2, $3, $4, 'parent@example.invalid', 'active')
  `, [id.link, id.club, id.player, id.parent])

  await db.query(`
    insert into public.communication_logs(
      id, club_id, player_id, user_id, user_name, channel, action, recipient_email, metadata, created_at
    )
    values
      ($1, $6, $7, $8, 'Active Coach', 'email', 'parent_email_sent', 'parent@example.invalid', '{"source":"club_announcement","authorType":"club_staff","body":"Valid update"}', '2026-08-27T09:00:00Z'),
      ($2, $6, $7, $8, 'Active Coach', 'email', 'parent_email_sent', 'parent@example.invalid', '{"source":"calendar_event_notification","body":"Automated event"}', '2026-08-27T09:01:00Z'),
      ($3, $6, $7, $9, 'Suspended Coach', 'email', 'parent_email_sent', 'parent@example.invalid', '{"source":"club_announcement","authorType":"club_staff","body":"Inactive author"}', '2026-08-27T09:02:00Z'),
      ($4, $6, $7, $10, 'Parent', 'email', 'parent_email_sent', 'parent@example.invalid', '{"source":"club_announcement","authorType":"club_staff","body":"Low rank author"}', '2026-08-27T09:03:00Z'),
      ($5, $6, $7, $8, 'Active Coach', 'email', 'parent_email_sent', 'parent@example.invalid', '{"body":"No explicit provenance"}', '2026-08-27T09:04:00Z')
  `, [
    id.valid,
    id.automated,
    id.inactive,
    id.lowRank,
    id.missingProvenance,
    id.club,
    id.player,
    id.activeStaff,
    id.inactiveStaff,
    id.lowRankUser,
  ])

  await db.exec(migration)
  await db.query(`select set_config('request.jwt.claims', $1, false)`, [JSON.stringify({ sub: id.parent })])
  return db
}

test('Parent announcement RPC exposes only active staff-authored publications without deleting history', async () => {
  const db = await createDatabase()

  const before = await db.query('select count(*)::int as total from public.communication_logs')
  const visible = await db.query(
    'select id from public.get_parent_portal_email_messages($1) order by created_at',
    [id.link],
  )
  const after = await db.query('select count(*)::int as total from public.communication_logs')

  assert.deepEqual(visible.rows.map((row) => row.id), [id.valid])
  assert.equal(before.rows[0].total, 5)
  assert.equal(after.rows[0].total, 5)

  await db.query('select public.mark_parent_portal_message_read($1, $2)', [id.link, id.valid])
  await assert.rejects(
    db.query('select public.mark_parent_portal_message_read($1, $2)', [id.link, id.automated]),
    /This message could not be opened/,
  )

  await db.close()
})
