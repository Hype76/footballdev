import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'
import { PGlite } from '@electric-sql/pglite'

const migrationUrl = new URL('../supabase/migrations/20260727172754_parent_portal_navigation_view_state.sql', import.meta.url)

const ids = {
  club: '20000000-0000-4000-8000-000000000001',
  team: '30000000-0000-4000-8000-000000000001',
  parent: '10000000-0000-4000-8000-000000000001',
  otherParent: '10000000-0000-4000-8000-000000000002',
  playerA: '40000000-0000-4000-8000-000000000001',
  playerB: '40000000-0000-4000-8000-000000000002',
  otherPlayer: '40000000-0000-4000-8000-000000000003',
  linkA: '50000000-0000-4000-8000-000000000001',
  linkB: '50000000-0000-4000-8000-000000000002',
  otherLink: '50000000-0000-4000-8000-000000000003',
  resourceLinkA: '60000000-0000-4000-8000-000000000001',
  resourceLinkB: '60000000-0000-4000-8000-000000000002',
  chatRoom: '70000000-0000-4000-8000-000000000001',
}

async function setClaims(db, userId) {
  await db.query(`select set_config('request.jwt.claims', $1, false)`, [
    JSON.stringify({ sub: userId, email: 'parent@example.invalid' }),
  ])
}

async function createDatabase() {
  const db = new PGlite()

  await db.exec(`
    create role anon;
    create role authenticated;
    create role service_role;
    create schema auth;

    create table auth.users (
      id uuid primary key
    );

    create function auth.uid()
    returns uuid
    language sql
    stable
    as $$
      select (nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'sub')::uuid
    $$;

    create table public.players (
      id uuid primary key,
      club_id uuid not null,
      team_id uuid,
      status text not null default 'active',
      archived_at timestamptz
    );

    create table public.parent_player_links (
      id uuid primary key,
      club_id uuid not null,
      team_id uuid,
      player_id uuid not null,
      auth_user_id uuid,
      status text not null default 'pending'
    );

    create table public.test_parent_resources (
      link_id uuid primary key,
      parent_link_id uuid not null,
      assigned_at timestamptz not null
    );

    create table public.resource_library_parent_notifications (
      id uuid primary key default gen_random_uuid(),
      link_id uuid not null,
      parent_link_id uuid not null,
      created_at timestamptz not null
    );

    create table public.test_match_days (
      id uuid primary key,
      parent_link_id uuid not null,
      status text not null,
      match_date date,
      created_at timestamptz not null,
      updated_at timestamptz not null
    );

    create table public.polls (
      id uuid primary key,
      parent_link_id uuid not null,
      created_at timestamptz not null
    );

    create table public.calendar_events (
      id uuid primary key,
      club_id uuid not null,
      team_id uuid,
      starts_at timestamptz not null,
      cancelled_at timestamptz,
      created_at timestamptz not null,
      updated_at timestamptz not null,
      parent_visible boolean not null default false,
      parent_audience text not null default 'all_team_parents'
    );

    create table public.calendar_event_invites (
      id uuid primary key,
      club_id uuid not null,
      team_id uuid,
      player_id uuid not null,
      invite_status text not null default 'active',
      cancelled_at timestamptz,
      created_at timestamptz not null,
      updated_at timestamptz not null
    );

    create table public.parent_chat_memberships (
      id uuid primary key default gen_random_uuid(),
      room_id uuid not null,
      auth_user_id uuid not null,
      member_kind text not null,
      active boolean not null default true,
      last_read_at timestamptz
    );

    create table public.parent_chat_messages (
      id uuid primary key default gen_random_uuid(),
      room_id uuid not null,
      sender_id uuid not null,
      deleted_at timestamptz,
      created_at timestamptz not null
    );

    create function public.parent_chat_ensure_rooms_for_current_user()
    returns void
    language sql
    as $$
      select null::void
    $$;

    create function public.get_parent_portal_match_days(parent_link_id_value uuid)
    returns table (
      id uuid,
      status text,
      match_date date,
      created_at timestamptz,
      updated_at timestamptz
    )
    language sql
    stable
    as $$
      select match_day.id, match_day.status, match_day.match_date, match_day.created_at, match_day.updated_at
      from public.test_match_days match_day
      where match_day.parent_link_id = parent_link_id_value
    $$;

    create function public.get_parent_portal_player_resources(parent_link_id_value uuid)
    returns table (
      link_id uuid,
      assigned_at timestamptz
    )
    language sql
    stable
    as $$
      select resource.link_id, resource.assigned_at
      from public.test_parent_resources resource
      where resource.parent_link_id = parent_link_id_value
    $$;

    create function public.get_parent_portal_polls(parent_link_id_value uuid)
    returns table (
      id uuid,
      created_at timestamptz
    )
    language sql
    stable
    as $$
      select poll.id, poll.created_at
      from public.polls poll
      where poll.parent_link_id = parent_link_id_value
    $$;
  `)

  await db.query(`
    insert into auth.users(id)
    values ($1), ($2)
  `, [ids.parent, ids.otherParent])
  await db.query(`
    insert into public.players(id, club_id, team_id)
    values
      ($1, $4, $5),
      ($2, $4, $5),
      ($3, $4, $5)
  `, [ids.playerA, ids.playerB, ids.otherPlayer, ids.club, ids.team])
  await db.query(`
    insert into public.parent_player_links(id, club_id, team_id, player_id, auth_user_id, status)
    values
      ($1, $6, $7, $4, $8, 'active'),
      ($2, $6, $7, $5, $8, 'active'),
      ($3, $6, $7, $9, $10, 'active')
  `, [
    ids.linkA,
    ids.linkB,
    ids.otherLink,
    ids.playerA,
    ids.playerB,
    ids.club,
    ids.team,
    ids.parent,
    ids.otherPlayer,
    ids.otherParent,
  ])
  await db.query(`
    insert into public.test_parent_resources(link_id, parent_link_id, assigned_at)
    values
      ($1, $3, statement_timestamp() - interval '2 days'),
      ($2, $4, statement_timestamp() - interval '2 days')
  `, [ids.resourceLinkA, ids.resourceLinkB, ids.linkA, ids.linkB])
  await db.query(`
    insert into public.parent_chat_memberships(room_id, auth_user_id, member_kind, active, last_read_at)
    values ($1, $2, 'parent', true, null)
  `, [ids.chatRoom, ids.parent])
  await db.query(`
    insert into public.parent_chat_messages(room_id, sender_id, created_at)
    values ($1, $2, statement_timestamp() - interval '1 day')
  `, [ids.chatRoom, ids.otherParent])

  await db.exec(await readFile(migrationUrl, 'utf8'))
  return db
}

function stateByCategory(rows, categoryKey) {
  return rows.find((row) => row.category_key === categoryKey)
}

test('server view state is child-isolated, synchronised and cursor bounded', async () => {
  const db = await createDatabase()
  await setClaims(db, ids.parent)

  const initialA = await db.query(
    `select * from public.get_parent_portal_activity_state($1)`,
    [ids.linkA],
  )
  const initialB = await db.query(
    `select * from public.get_parent_portal_activity_state($1)`,
    [ids.linkB],
  )

  assert.equal(stateByCategory(initialA.rows, 'resources').is_new, false)
  assert.equal(stateByCategory(initialB.rows, 'resources').is_new, false)
  assert.equal(stateByCategory(initialA.rows, 'chat').is_new, true)

  const chatCursor = stateByCategory(initialA.rows, 'chat').latest_activity_at
  await db.query(
    `select * from public.mark_parent_portal_category_viewed($1, 'chat', $2)`,
    [ids.linkA, chatCursor],
  )
  const chatThroughSibling = await db.query(
    `select * from public.get_parent_portal_activity_state($1)`,
    [ids.linkB],
  )
  assert.equal(stateByCategory(chatThroughSibling.rows, 'chat').is_new, false)

  await db.query(`
    insert into public.test_parent_resources(link_id, parent_link_id, assigned_at)
    values ('60000000-0000-4000-8000-000000000003', $1, statement_timestamp() + interval '1 minute')
  `, [ids.linkA])
  const afterResourceA = await db.query(
    `select * from public.get_parent_portal_activity_state($1)`,
    [ids.linkA],
  )
  const afterResourceB = await db.query(
    `select * from public.get_parent_portal_activity_state($1)`,
    [ids.linkB],
  )
  const firstResourceCursor = stateByCategory(afterResourceA.rows, 'resources').latest_activity_at

  assert.equal(stateByCategory(afterResourceA.rows, 'resources').is_new, true)
  assert.equal(stateByCategory(afterResourceB.rows, 'resources').is_new, false)

  await db.query(`
    insert into public.test_parent_resources(link_id, parent_link_id, assigned_at)
    values ('60000000-0000-4000-8000-000000000004', $1, statement_timestamp() + interval '2 minutes')
  `, [ids.linkA])
  const boundedWrite = await db.query(
    `select * from public.mark_parent_portal_category_viewed($1, 'resources', $2)`,
    [ids.linkA, firstResourceCursor],
  )
  assert.equal(boundedWrite.rows[0].is_new, true)

  const currentA = await db.query(
    `select * from public.get_parent_portal_activity_state($1)`,
    [ids.linkA],
  )
  const latestResourceCursor = stateByCategory(currentA.rows, 'resources').latest_activity_at
  const cleared = await db.query(
    `select * from public.mark_parent_portal_category_viewed($1, 'resources', $2)`,
    [ids.linkA, latestResourceCursor],
  )
  assert.equal(cleared.rows[0].is_new, false)

  const persisted = await db.query(
    `select * from public.get_parent_portal_activity_state($1)`,
    [ids.linkA],
  )
  assert.equal(stateByCategory(persisted.rows, 'resources').is_new, false)

  await assert.rejects(
    db.query(`select * from public.get_parent_portal_activity_state($1)`, [ids.otherLink]),
    /Parent access is not available for this child/,
  )

  await db.query(`update public.parent_player_links set status = 'revoked' where id = $1`, [ids.linkA])
  await assert.rejects(
    db.query(`select * from public.get_parent_portal_activity_state($1)`, [ids.linkA]),
    /Parent access is not available for this child/,
  )

  await db.query(`update public.players set status = 'archived', archived_at = statement_timestamp() where id = $1`, [ids.playerB])
  await assert.rejects(
    db.query(`select * from public.get_parent_portal_activity_state($1)`, [ids.linkB]),
    /Parent access is not available for this child/,
  )

  await db.close()
})
