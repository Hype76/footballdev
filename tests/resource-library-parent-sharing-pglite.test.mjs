import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'
import { PGlite } from '@electric-sql/pglite'

const migrationUrl = new URL('../supabase/migrations/20260727125320_team_resource_parent_sharing_integrity.sql', import.meta.url)
const shortRpcMigrationUrl = new URL('../supabase/migrations/20260727125718_shorten_resource_parent_sharing_rpc.sql', import.meta.url)
const sharedSaveFixMigrationUrl = new URL('../supabase/migrations/20260727143919_fix_resource_library_notification_returning_ids.sql', import.meta.url)

const ids = {
  actor: '10000000-0000-4000-8000-000000000001',
  parent: '10000000-0000-4000-8000-000000000002',
  otherParent: '10000000-0000-4000-8000-000000000003',
  club: '20000000-0000-4000-8000-000000000001',
  team: '30000000-0000-4000-8000-000000000001',
  otherTeam: '30000000-0000-4000-8000-000000000002',
  player: '40000000-0000-4000-8000-000000000001',
  otherPlayer: '40000000-0000-4000-8000-000000000002',
  resource: '50000000-0000-4000-8000-000000000001',
  parentLink: '60000000-0000-4000-8000-000000000001',
  otherParentLink: '60000000-0000-4000-8000-000000000002',
}

async function setClaims(db, userId, manager = false) {
  await db.query(`select set_config('request.jwt.claims', $1, false)`, [
    JSON.stringify({ sub: userId, email: 'fp-test@example.invalid', manager }),
  ])
}

async function createDatabase() {
  const db = new PGlite()
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

    create function auth.jwt()
    returns jsonb
    language sql
    stable
    as $$
      select coalesce(nullif(current_setting('request.jwt.claims', true), '')::jsonb, '{}'::jsonb)
    $$;

    create table public.players (
      id uuid primary key,
      club_id uuid not null,
      team_id uuid,
      player_name text not null,
      status text not null default 'active',
      archived_at timestamptz
    );

    create table public.parent_player_links (
      id uuid primary key,
      club_id uuid not null,
      team_id uuid,
      player_id uuid not null,
      auth_user_id uuid,
      email text,
      status text not null default 'pending',
      created_at timestamptz not null default timezone('utc', now())
    );

    create table public.resource_library_items (
      id uuid primary key,
      club_id uuid not null,
      team_id uuid not null,
      title text not null,
      description text not null default '',
      category text not null default 'general',
      storage_bucket text not null default 'resource-library',
      storage_path text not null,
      original_filename text not null,
      mime_type text not null,
      file_size_bytes integer not null,
      uploaded_by_profile_id uuid not null,
      uploaded_by_name text not null default '',
      uploaded_by_email text not null default '',
      archived_at timestamptz,
      archived_by_profile_id uuid,
      archived_by_name text not null default '',
      archived_by_email text not null default '',
      created_at timestamptz not null default timezone('utc', now()),
      updated_at timestamptz not null default timezone('utc', now())
    );

    create table public.resource_library_links (
      id uuid primary key default gen_random_uuid(),
      resource_id uuid not null,
      club_id uuid not null,
      team_id uuid not null,
      linked_type text not null,
      linked_id uuid not null,
      assigned_by_profile_id uuid not null,
      assigned_by_name text not null default '',
      assigned_by_email text not null default '',
      assigned_at timestamptz not null default timezone('utc', now()),
      removed_at timestamptz,
      removed_by_profile_id uuid,
      removed_by_name text not null default '',
      removed_by_email text not null default '',
      parent_visible boolean not null default false,
      share_description text
    );

    create table public.resource_library_external_links (
      resource_id uuid primary key,
      club_id uuid not null,
      team_id uuid not null,
      external_url text not null
    );

    create table public.resource_library_parent_notifications (
      id uuid primary key default gen_random_uuid(),
      link_id uuid not null,
      resource_id uuid not null,
      club_id uuid not null,
      team_id uuid not null,
      player_id uuid not null,
      parent_link_id uuid not null,
      recipient_email text not null,
      email_queue_id uuid,
      created_at timestamptz not null default timezone('utc', now()),
      unique (link_id, parent_link_id)
    );

    create table public.scheduled_email_queue (
      id uuid primary key default gen_random_uuid(),
      club_id uuid not null,
      team_id uuid,
      created_by uuid,
      created_by_email text not null default '',
      to_email text not null,
      subject text not null,
      status text not null,
      scheduled_at timestamptz not null,
      payload jsonb not null
    );

    create function public.current_user_can_manage_resource_library(target_club_id uuid, target_team_id uuid)
    returns boolean
    language sql
    stable
    as $$
      select coalesce((auth.jwt() ->> 'manager')::boolean, false)
    $$;

    create function public.resource_library_link_target_allowed(
      target_linked_type text,
      target_linked_id uuid,
      target_club_id uuid,
      target_team_id uuid
    )
    returns boolean
    language sql
    stable
    as $$
      select target_linked_type = 'player'
        and exists (
          select 1
          from public.players player
          where player.id = target_linked_id
            and player.club_id = target_club_id
            and player.team_id = target_team_id
            and coalesce(player.status, 'active') <> 'archived'
            and player.archived_at is null
        )
    $$;

  `)
  await db.exec(await readFile(sharedSaveFixMigrationUrl, 'utf8'))
  await db.exec(await readFile(migrationUrl, 'utf8'))
  await db.exec(await readFile(shortRpcMigrationUrl, 'utf8'))
  await db.query(`
    insert into public.players(id, club_id, team_id, player_name)
    values
      ($1, $3, $4, 'FP TEST Player One'),
      ($2, $3, $4, 'FP TEST Player Two')
  `, [ids.player, ids.otherPlayer, ids.club, ids.team])
  await db.query(`
    insert into public.parent_player_links(id, club_id, team_id, player_id, auth_user_id, email, status)
    values
      ($1, $3, $4, $5, $6, 'fp-test-parent-one@example.invalid', 'active'),
      ($2, $3, $4, $7, $8, 'fp-test-parent-two@example.invalid', 'active')
  `, [ids.parentLink, ids.otherParentLink, ids.club, ids.team, ids.player, ids.parent, ids.otherPlayer, ids.otherParent])
  await db.query(`
    insert into public.resource_library_items(
      id, club_id, team_id, title, storage_path, original_filename, mime_type,
      file_size_bytes, uploaded_by_profile_id
    )
    values ($1, $2, $3, 'FP TEST Resource', $4, 'resource.pdf', 'application/pdf', 100, $5)
  `, [ids.resource, ids.club, ids.team, `${ids.club}/${ids.team}/${ids.resource}/resource.pdf`, ids.actor])

  return db
}

test('Parent resource listing is explicit, active, child-scoped, and archive-safe', async () => {
  const db = await createDatabase()

  try {
    await setClaims(db, ids.parent)
    await db.query(`
      insert into public.resource_library_links(
        resource_id, club_id, team_id, linked_type, linked_id,
        assigned_by_profile_id, parent_visible, share_description
      )
      values ($1, $2, $3, 'player', $4, $5, true, 'For this child')
    `, [ids.resource, ids.club, ids.team, ids.player, ids.actor])

    const visible = await db.query('select * from public.get_parent_portal_player_resources($1)', [ids.parentLink])
    assert.equal(visible.rows.length, 1)
    assert.equal(visible.rows[0].player_id, ids.player)
    assert.equal(visible.rows[0].external_url, '')
    assert.equal(visible.rows[0].storage_path, '')

    const wrongParent = await db.query('select * from public.get_parent_portal_player_resources($1)', [ids.otherParentLink])
    assert.equal(wrongParent.rows.length, 0)

    await db.query('update public.players set status = $1, archived_at = now() where id = $2', ['archived', ids.player])
    const archived = await db.query('select * from public.get_parent_portal_player_resources($1)', [ids.parentLink])
    assert.equal(archived.rows.length, 0)

    await db.query('update public.players set status = $1, archived_at = null where id = $2', ['active', ids.player])
    await db.query('update public.resource_library_links set parent_visible = false where linked_id = $1', [ids.player])
    const staffOnly = await db.query('select * from public.get_parent_portal_player_resources($1)', [ids.parentLink])
    assert.equal(staffOnly.rows.length, 0)

    await db.query('update public.resource_library_links set parent_visible = true, removed_at = now() where linked_id = $1', [ids.player])
    const removed = await db.query('select * from public.get_parent_portal_player_resources($1)', [ids.parentLink])
    assert.equal(removed.rows.length, 0)
  } finally {
    await db.close()
  }
})

test('Player assignment sync handles share, unshare, add, remove, clear, and duplicate inputs atomically', async () => {
  const db = await createDatabase()

  try {
    await setClaims(db, ids.actor, true)
    const sharedTargets = JSON.stringify([
      { linkedType: 'player', linkedId: ids.player, parentVisible: true },
      { linkedType: 'player', linkedId: ids.player, parentVisible: true },
      { linkedType: 'player', linkedId: ids.otherPlayer, parentVisible: true },
    ])
    const first = await db.query(`
      select public.sync_resource_library_player_assignments($1, $2, $3, $4::jsonb, $5) as result
    `, [ids.resource, ids.club, ids.team, sharedTargets, 'Shared'])

    assert.equal(first.rows[0].result.selectedPlayerCount, 2)
    assert.equal(first.rows[0].result.removedCount, 0)
    assert.equal(first.rows[0].result.assignments.length, 2)
    assert.equal(first.rows[0].result.assignments[0].notifications_queued, 1)
    assert.equal(first.rows[0].result.assignments[1].notifications_queued, 1)

    const sharedCount = await db.query(`
      select count(*)::integer as count
      from public.resource_library_links
      where resource_id = $1 and removed_at is null and parent_visible
    `, [ids.resource])
    assert.equal(sharedCount.rows[0].count, 2)

    const queued = await db.query(`
      select
        (select count(*)::integer from public.resource_library_parent_notifications) as notification_count,
        (select count(*)::integer from public.scheduled_email_queue) as queue_count
    `)
    assert.deepEqual(queued.rows, [{ notification_count: 2, queue_count: 2 }])

    const staffOnlyOneTarget = JSON.stringify([
      { linkedType: 'player', linkedId: ids.player, parentVisible: false },
    ])
    const second = await db.query(`
      select public.sync_resource_library_player_assignments($1, $2, $3, $4::jsonb, '') as result
    `, [ids.resource, ids.club, ids.team, staffOnlyOneTarget])

    assert.equal(second.rows[0].result.selectedPlayerCount, 1)
    assert.equal(second.rows[0].result.removedCount, 1)

    const active = await db.query(`
      select linked_id, parent_visible
      from public.resource_library_links
      where resource_id = $1 and removed_at is null
    `, [ids.resource])
    assert.deepEqual(active.rows, [{ linked_id: ids.player, parent_visible: false }])

    const cleared = await db.query(`
      select public.sync_resource_library_player_assignments($1, $2, $3, '[]'::jsonb, '') as result
    `, [ids.resource, ids.club, ids.team])
    assert.equal(cleared.rows[0].result.removedCount, 1)

    const remaining = await db.query(`
      select count(*)::integer as count
      from public.resource_library_links
      where resource_id = $1 and removed_at is null
    `, [ids.resource])
    assert.equal(remaining.rows[0].count, 0)
  } finally {
    await db.close()
  }
})

test('Player assignment sync rejects unauthorised managers and cross-team Players', async () => {
  const db = await createDatabase()

  try {
    const target = JSON.stringify([{ linkedType: 'player', linkedId: ids.player, parentVisible: true }])
    await setClaims(db, ids.actor, false)
    await assert.rejects(
      db.query(`
        select public.sync_resource_library_player_assignments($1, $2, $3, $4::jsonb, '')
      `, [ids.resource, ids.club, ids.team, target]),
      /manager access required/i,
    )

    await setClaims(db, ids.actor, true)
    await db.query('update public.players set team_id = $1 where id = $2', [ids.otherTeam, ids.player])
    await assert.rejects(
      db.query(`
        select public.sync_resource_library_player_assignments($1, $2, $3, $4::jsonb, '')
      `, [ids.resource, ids.club, ids.team, target]),
      /outside the permitted team scope/i,
    )
  } finally {
    await db.close()
  }
})
