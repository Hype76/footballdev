import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { after, before, test } from 'node:test'

import { PGlite } from '@electric-sql/pglite'

const migrationUrl = new URL('../supabase/migrations/20260802130700_formation_board_foundation_25a.sql', import.meta.url)
const auditSourceRepairUrl = new URL('../supabase/migrations/20260802132311_formation_board_audit_source_25a.sql', import.meta.url)
const indexesMigrationUrl = new URL('../supabase/migrations/20260802133210_formation_board_indexes_25a.sql', import.meta.url)
const compositeIndexesMigrationUrl = new URL('../supabase/migrations/20260802133419_formation_board_composite_indexes_25a.sql', import.meta.url)
const editorSaveMigrationUrl = new URL('../supabase/migrations/20260802155000_formation_board_editor_save_25b.sql', import.meta.url)

const IDS = Object.freeze({
  assistant: '20000000-0000-4000-8000-000000000004',
  clubA: '10000000-0000-4000-8000-000000000001',
  clubAdmin: '20000000-0000-4000-8000-000000000005',
  clubB: '10000000-0000-4000-8000-000000000002',
  coach: '20000000-0000-4000-8000-000000000003',
  coachB: '20000000-0000-4000-8000-000000000008',
  manager: '20000000-0000-4000-8000-000000000002',
  parent: '20000000-0000-4000-8000-000000000006',
  playerA1: '30000000-0000-4000-8000-000000000001',
  playerA2: '30000000-0000-4000-8000-000000000002',
  playerB1: '30000000-0000-4000-8000-000000000003',
  playerUser: '20000000-0000-4000-8000-000000000007',
  revokedCoach: '20000000-0000-4000-8000-000000000009',
  teamA: '40000000-0000-4000-8000-000000000001',
  teamA2: '40000000-0000-4000-8000-000000000002',
  teamAdmin: '20000000-0000-4000-8000-000000000001',
  teamB: '40000000-0000-4000-8000-000000000003',
})

let db
let sharedBoard

async function setActor(actorId) {
  await db.exec('reset role')
  await db.query("select set_config('request.jwt.claim.sub', $1, false)", [actorId])
  await db.exec('set role authenticated')
}

async function resetActor() {
  await db.exec('reset role')
  await db.query("select set_config('request.jwt.claim.sub', '', false)")
}

async function rpc(functionCall, parameters = []) {
  return db.query(`select ${functionCall} as result`, parameters)
}

function placement(playerId, x, y, number = '') {
  return {
    displayOrder: 0,
    displayedShirtNumber: number,
    playerId,
    positionGroup: 'outfield',
    slotId: '',
    x,
    y,
  }
}

before(async () => {
  db = new PGlite()
  await db.exec(`
    create role anon;
    create role authenticated;
    create role service_role bypassrls;
    create schema auth;
    create schema app_private;

    create function auth.uid()
    returns uuid
    language sql
    stable
    as $$
      select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid
    $$;

    create table public.clubs (
      id uuid primary key,
      name text not null
    );

    create table public.teams (
      id uuid primary key,
      club_id uuid not null references public.clubs(id),
      name text not null,
      status text not null default 'active'
    );

    create table public.users (
      id uuid primary key,
      club_id uuid references public.clubs(id),
      email text not null,
      name text,
      role text not null,
      role_label text,
      role_rank integer not null default 0,
      status text not null default 'active'
    );

    create table public.user_club_memberships (
      id uuid primary key default gen_random_uuid(),
      auth_user_id uuid not null references public.users(id),
      club_id uuid not null references public.clubs(id),
      email text not null,
      role text not null,
      role_label text,
      role_rank integer not null
    );

    create table public.team_staff (
      team_id uuid not null references public.teams(id) on delete cascade,
      user_id uuid not null references public.users(id),
      role_key text not null,
      role_label text not null,
      role_rank integer not null,
      primary key (team_id, user_id)
    );

    create table public.players (
      id uuid primary key,
      club_id uuid not null references public.clubs(id),
      team_id uuid not null references public.teams(id) on delete cascade,
      player_name text,
      preferred_name text,
      first_name text,
      last_name text,
      shirt_number text,
      status text not null default 'active'
    );

    create table public.resource_library_items (
      id uuid primary key default gen_random_uuid(),
      club_id uuid not null references public.clubs(id),
      team_id uuid not null references public.teams(id) on delete cascade,
      title text not null,
      description text not null default '',
      category text not null default 'general',
      storage_bucket text not null default 'resource-library',
      storage_path text not null,
      original_filename text not null,
      mime_type text not null,
      file_size_bytes integer not null,
      uploaded_by_profile_id uuid not null references public.users(id),
      uploaded_by_name text not null default '',
      uploaded_by_email text not null default '',
      archived_at timestamptz,
      archived_by_profile_id uuid references public.users(id),
      archived_by_name text not null default '',
      archived_by_email text not null default '',
      created_at timestamptz not null default timezone('utc', now()),
      updated_at timestamptz not null default timezone('utc', now()),
      unique (id, club_id),
      unique (storage_bucket, storage_path)
    );

    create table public.resource_library_external_links (
      resource_id uuid primary key,
      club_id uuid not null,
      team_id uuid not null references public.teams(id) on delete cascade,
      external_url text not null,
      created_by_profile_id uuid references public.users(id),
      created_at timestamptz not null default timezone('utc', now()),
      updated_at timestamptz not null default timezone('utc', now()),
      foreign key (resource_id, club_id) references public.resource_library_items(id, club_id) on delete cascade
    );

    create table public.audit_logs (
      id uuid primary key default gen_random_uuid(),
      club_id uuid references public.clubs(id),
      actor_id uuid references public.users(id),
      action text not null,
      entity_type text not null,
      entity_id uuid,
      metadata jsonb not null default '{}'::jsonb,
      actor_name text,
      actor_email text,
      actor_role_label text,
      actor_role_rank integer,
      event_category text not null default 'operational',
      severity text not null default 'info',
      outcome text not null default 'success',
      source text not null default 'application' check (source in ('application', 'database', 'netlify_function', 'scheduled_monitor')),
      created_at timestamptz not null default timezone('utc', now())
    );

    grant usage on schema public to anon, authenticated, service_role;
  `)

  const migration = await readFile(migrationUrl, 'utf8')
  await db.exec(migration)
  const auditSourceRepair = await readFile(auditSourceRepairUrl, 'utf8')
  await db.exec(auditSourceRepair)
  const indexesMigration = await readFile(indexesMigrationUrl, 'utf8')
  await db.exec(indexesMigration)
  const compositeIndexesMigration = await readFile(compositeIndexesMigrationUrl, 'utf8')
  await db.exec(compositeIndexesMigration)
  const editorSaveMigration = await readFile(editorSaveMigrationUrl, 'utf8')
  await db.exec(editorSaveMigration)

  await db.exec(`
    insert into public.clubs (id, name) values
      ('${IDS.clubA}', 'Club A'),
      ('${IDS.clubB}', 'Club B');

    insert into public.teams (id, club_id, name) values
      ('${IDS.teamA}', '${IDS.clubA}', 'Team A'),
      ('${IDS.teamA2}', '${IDS.clubA}', 'Team A2'),
      ('${IDS.teamB}', '${IDS.clubB}', 'Team B');

    insert into public.users (id, club_id, email, name, role, role_label, role_rank, status) values
      ('${IDS.teamAdmin}', '${IDS.clubA}', 'team-admin@example.test', 'Team Admin', 'head_manager', 'Team Admin', 70, 'active'),
      ('${IDS.manager}', '${IDS.clubA}', 'manager@example.test', 'Manager', 'manager', 'Manager', 50, 'active'),
      ('${IDS.coach}', '${IDS.clubA}', 'coach@example.test', 'Coach', 'coach', 'Coach', 30, 'active'),
      ('${IDS.assistant}', '${IDS.clubA}', 'assistant@example.test', 'Assistant Coach', 'assistant_coach', 'Assistant Coach', 20, 'active'),
      ('${IDS.clubAdmin}', '${IDS.clubA}', 'club-admin@example.test', 'Club Admin', 'admin', 'Club Admin', 90, 'active'),
      ('${IDS.parent}', '${IDS.clubA}', 'parent@example.test', 'Parent', 'parent_portal', 'Parent', 10, 'active'),
      ('${IDS.playerUser}', '${IDS.clubA}', 'player@example.test', 'Player', 'player', 'Player', 5, 'active'),
      ('${IDS.coachB}', '${IDS.clubB}', 'coach-b@example.test', 'Coach B', 'coach', 'Coach', 30, 'active'),
      ('${IDS.revokedCoach}', '${IDS.clubA}', 'revoked@example.test', 'Revoked Coach', 'coach', 'Coach', 30, 'inactive');

    insert into public.user_club_memberships (auth_user_id, club_id, email, role, role_label, role_rank)
    values ('${IDS.clubAdmin}', '${IDS.clubA}', 'club-admin@example.test', 'admin', 'Club Admin', 90);

    insert into public.team_staff (team_id, user_id, role_key, role_label, role_rank) values
      ('${IDS.teamA}', '${IDS.teamAdmin}', 'head_manager', 'Team Admin', 70),
      ('${IDS.teamA}', '${IDS.manager}', 'manager', 'Manager', 50),
      ('${IDS.teamA}', '${IDS.coach}', 'coach', 'Coach', 30),
      ('${IDS.teamA}', '${IDS.assistant}', 'assistant_coach', 'Assistant Coach', 20),
      ('${IDS.teamA}', '${IDS.coachB}', 'coach', 'Coach', 30),
      ('${IDS.teamB}', '${IDS.coachB}', 'coach', 'Coach', 30),
      ('${IDS.teamA}', '${IDS.revokedCoach}', 'coach', 'Coach', 30);

    insert into public.players (id, club_id, team_id, player_name, preferred_name, first_name, last_name, shirt_number) values
      ('${IDS.playerA1}', '${IDS.clubA}', '${IDS.teamA}', 'Alex One', 'Alex', 'Alex', 'One', '7'),
      ('${IDS.playerA2}', '${IDS.clubA}', '${IDS.teamA}', 'Bailey Two', '', 'Bailey', 'Two', '9'),
      ('${IDS.playerB1}', '${IDS.clubB}', '${IDS.teamB}', 'Casey Three', 'Casey', 'Casey', 'Three', '11');
  `)
})

after(async () => {
  await db?.close()
})

test('preset registry contains every required game format and named shape', async () => {
  const rows = await db.query(`
    select game_format, count(*)::integer as preset_count
    from public.formation_board_presets
    group by game_format
    order by game_format
  `)

  assert.deepEqual(rows.rows, [
    { game_format: '11v11', preset_count: 10 },
    { game_format: '5v5', preset_count: 3 },
    { game_format: '7v7', preset_count: 4 },
    { game_format: '9v9', preset_count: 4 },
  ])
})

test('Manager, Coach, and Team Admin can create Team-scoped boards', async () => {
  for (const actorId of [IDS.manager, IDS.coach, IDS.teamAdmin]) {
    await setActor(actorId)
    const result = await rpc(
      'public.create_formation_board($1, $2, $3, $4, $5, $6, $7::jsonb, $8::jsonb, $9, $10, $11)',
      [IDS.teamA, `Board ${actorId.slice(-1)}`, '', '5v5', '5v5-1-2-1', 'portrait', JSON.stringify([]), JSON.stringify([]), '', 'shared', 1],
    )
    assert.equal(result.rows[0].result.board.team_id, IDS.teamA)
    assert.equal(result.rows[0].result.currentVersion.version_number, 1)
    if (actorId === IDS.manager) sharedBoard = result.rows[0].result
  }
})

test('Assistant Coach, Parent, Player, revoked staff, and unrelated staff cannot create', async () => {
  for (const actorId of [IDS.assistant, IDS.parent, IDS.playerUser, IDS.coachB]) {
    await setActor(actorId)
    await assert.rejects(
      rpc(
        'public.create_formation_board($1, $2, $3, $4, $5, $6, $7::jsonb, $8::jsonb, $9, $10, $11)',
        [IDS.teamA, 'Denied', '', '5v5', '5v5-custom', 'portrait', '[]', '[]', '', 'shared', 1],
      ),
      /formation_board_create_forbidden/,
    )
  }

  await setActor(IDS.revokedCoach)
  await assert.rejects(
    rpc(
      'public.create_formation_board($1, $2, $3, $4, $5, $6, $7::jsonb, $8::jsonb, $9, $10, $11)',
      [IDS.teamA, 'Denied', '', '5v5', '5v5-custom', 'portrait', '[]', '[]', '', 'shared', 1],
    ),
    /formation_board_auth_required/,
  )
})

test('Assistant Coach and Club Admin can view a shared board but cannot edit it', async () => {
  for (const actorId of [IDS.assistant, IDS.clubAdmin]) {
    await setActor(actorId)
    const readResult = await rpc('public.get_formation_board($1)', [sharedBoard.board.id])
    assert.equal(readResult.rows[0].result.board.id, sharedBoard.board.id)
    await assert.rejects(
      rpc(
        'public.save_formation_board_version($1, $2, $3, $4, $5, $6::jsonb, $7::jsonb, $8, $9, $10, $11)',
        [sharedBoard.board.id, 1, '5v5', '5v5-custom', 'portrait', '[]', '[]', '', 'shared', 'denied edit', 1],
      ),
      /formation_board_edit_forbidden/,
    )
  }
})

test('Parent, Player, cross-team, and cross-club reads fail closed', async () => {
  for (const actorId of [IDS.parent, IDS.playerUser, IDS.coachB]) {
    await setActor(actorId)
    await assert.rejects(rpc('public.get_formation_board($1)', [sharedBoard.board.id]), /formation_board_forbidden/)
  }

  await setActor(IDS.coach)
  await assert.rejects(
    rpc(
      'public.create_formation_board($1, $2, $3, $4, $5, $6, $7::jsonb, $8::jsonb, $9, $10, $11)',
      [IDS.teamA2, 'Other Team', '', '5v5', '5v5-custom', 'portrait', '[]', '[]', '', 'shared', 1],
    ),
    /formation_board_create_forbidden/,
  )
})

test('snapshot validation rejects duplicate Players, bad coordinates, bad presets, and another Team Player', async () => {
  await setActor(IDS.manager)
  const base = [IDS.teamA, 'Validation', '', '5v5', '5v5-custom', 'portrait']

  await assert.rejects(
    rpc(
      'public.create_formation_board($1, $2, $3, $4, $5, $6, $7::jsonb, $8::jsonb, $9, $10, $11)',
      [...base, JSON.stringify([placement(IDS.playerA1, 0.2, 0.2), placement(IDS.playerA1, 0.4, 0.4)]), '[]', '', 'draft', 1],
    ),
    /formation_board_player_duplicate/,
  )

  await assert.rejects(
    rpc(
      'public.create_formation_board($1, $2, $3, $4, $5, $6, $7::jsonb, $8::jsonb, $9, $10, $11)',
      [...base, JSON.stringify([placement(IDS.playerA1, -0.1, 0.2)]), '[]', '', 'draft', 1],
    ),
    /formation_board_placement_invalid/,
  )

  await assert.rejects(
    rpc(
      'public.create_formation_board($1, $2, $3, $4, $5, $6, $7::jsonb, $8::jsonb, $9, $10, $11)',
      [IDS.teamA, 'Invalid preset', '', '5v5', '11v11-4-4-2', 'portrait', '[]', '[]', '', 'draft', 1],
    ),
    /formation_board_preset_invalid/,
  )

  await assert.rejects(
    rpc(
      'public.create_formation_board($1, $2, $3, $4, $5, $6, $7::jsonb, $8::jsonb, $9, $10, $11)',
      [...base, JSON.stringify([placement(IDS.playerB1, 0.2, 0.2)]), '[]', '', 'draft', 1],
    ),
    /formation_board_player_out_of_scope/,
  )
})

test('save creates immutable versions and optimistic conflicts fail visibly', async () => {
  await setActor(IDS.manager)
  const saved = await rpc(
    'public.save_formation_board_version($1, $2, $3, $4, $5, $6::jsonb, $7::jsonb, $8, $9, $10, $11)',
    [sharedBoard.board.id, 1, '5v5', '5v5-custom', 'landscape', JSON.stringify([placement(IDS.playerA1, 0.2, 0.3, '17')]), JSON.stringify([placement(IDS.playerA2, 0, 0, '19')]), 'Press high', 'shared', 'shape change', 1],
  )
  assert.equal(saved.rows[0].result.board.current_version_number, 2)
  assert.equal(saved.rows[0].result.currentVersion.placements[0].shirtNumber, '17')
  assert.equal(saved.rows[0].result.currentVersion.placements[0].displayName, 'Alex')

  await assert.rejects(
    rpc(
      'public.save_formation_board_version($1, $2, $3, $4, $5, $6::jsonb, $7::jsonb, $8, $9, $10, $11)',
      [sharedBoard.board.id, 1, '5v5', '5v5-custom', 'portrait', '[]', '[]', '', 'shared', 'stale', 1],
    ),
    /formation_board_version_conflict/,
  )

  await resetActor()
  await assert.rejects(
    db.query('update public.formation_board_versions set notes = $1 where board_id = $2', ['rewrite', sharedBoard.board.id]),
    /formation_board_snapshot_immutable/,
  )
})

test('editor save commits metadata and one immutable version atomically', async () => {
  await setActor(IDS.manager)
  const created = await rpc(
    'public.create_formation_board($1, $2, $3, $4, $5, $6, $7::jsonb, $8::jsonb, $9, $10, $11)',
    [IDS.teamA, 'Atomic starting title', '', '5v5', '5v5-custom', 'portrait', '[]', '[]', '', 'shared', 1],
  )
  const atomicBoardId = created.rows[0].result.board.id
  const beforeVersion = created.rows[0].result.board.current_version_number
  const saved = await rpc(
    'public.save_formation_board_editor($1, $2, $3, $4, $5, $6, $7, $8::jsonb, $9::jsonb, $10, $11, $12, $13)',
    [
      atomicBoardId,
      beforeVersion,
      'Atomic editor title',
      'Atomic editor description',
      '5v5',
      '5v5-custom',
      'portrait',
      JSON.stringify([placement(IDS.playerA1, 0.4, 0.4, '7')]),
      JSON.stringify([placement(IDS.playerA2, 0, 0, '9')]),
      'Atomic notes',
      'shared',
      'editor save',
      1,
    ],
  )

  assert.equal(saved.rows[0].result.board.title, 'Atomic editor title')
  assert.equal(saved.rows[0].result.board.description, 'Atomic editor description')
  assert.equal(saved.rows[0].result.board.current_version_number, beforeVersion + 1)
  assert.equal(saved.rows[0].result.currentVersion.notes, 'Atomic notes')

  await assert.rejects(
    rpc(
      'public.save_formation_board_editor($1, $2, $3, $4, $5, $6, $7, $8::jsonb, $9::jsonb, $10, $11, $12, $13)',
      [atomicBoardId, beforeVersion, 'Stale title', '', '5v5', '5v5-custom', 'portrait', '[]', '[]', '', 'shared', 'stale editor save', 1],
    ),
    /formation_board_version_conflict/,
  )

  const afterConflict = await db.query(
    'select title, current_version_number from public.formation_boards where id = $1',
    [atomicBoardId],
  )
  assert.deepEqual(afterConflict.rows[0], {
    current_version_number: beforeVersion + 1,
    title: 'Atomic editor title',
  })

  await assert.rejects(
    rpc(
      'public.save_formation_board_editor($1, $2, $3, $4, $5, $6, $7, $8::jsonb, $9::jsonb, $10, $11, $12, $13)',
      [atomicBoardId, beforeVersion + 1, '', '', '5v5', '5v5-custom', 'portrait', '[]', '[]', '', 'shared', 'invalid title rollback', 1],
    ),
    /formation_board_title_invalid/,
  )

  const afterInvalidTitle = await db.query(
    'select title, current_version_number from public.formation_boards where id = $1',
    [atomicBoardId],
  )
  assert.deepEqual(afterInvalidTitle.rows[0], afterConflict.rows[0])

  await rpc('public.delete_formation_board($1, $2)', [atomicBoardId, 'Atomic editor title'])
})

test('duplicate, archive, restore, and restore version preserve immutable history', async () => {
  await setActor(IDS.coach)
  const duplicate = await rpc('public.duplicate_formation_board($1, $2)', [sharedBoard.board.id, 'Coach copy'])
  const duplicateId = duplicate.rows[0].result.board.id
  assert.equal(duplicate.rows[0].result.board.current_version_number, 1)

  const archived = await rpc('public.archive_formation_board($1)', [duplicateId])
  assert.ok(archived.rows[0].result.board.archived_at)
  const restored = await rpc('public.restore_formation_board($1)', [duplicateId])
  assert.equal(restored.rows[0].result.board.archived_at, null)

  await setActor(IDS.manager)
  const versionOne = await db.query('select id from public.formation_board_versions where board_id = $1 and version_number = 1', [sharedBoard.board.id])
  const versionRestored = await rpc('public.restore_formation_board_version($1, $2, $3)', [sharedBoard.board.id, versionOne.rows[0].id, 2])
  assert.equal(versionRestored.rows[0].result.board.current_version_number, 3)
  assert.equal(versionRestored.rows[0].result.currentVersion.source_version_id, versionOne.rows[0].id)
})

test('publication uses fixed categories, immutable versions, linked Resource history, and no communication side effects', async () => {
  await setActor(IDS.manager)
  const board = (await rpc('public.get_formation_board($1)', [sharedBoard.board.id])).rows[0].result
  const firstVersion = await db.query('select id from public.formation_board_versions where board_id = $1 and version_number = 1', [sharedBoard.board.id])
  const firstPublish = await rpc('public.publish_formation_board_version($1, $2, $3, $4, $5)', [sharedBoard.board.id, firstVersion.rows[0].id, 'training', 'new_resource', null])
  const resourceId = firstPublish.rows[0].result.resource.id
  assert.equal(firstPublish.rows[0].result.publication.board_version_id, firstVersion.rows[0].id)
  assert.match(firstPublish.rows[0].result.protectedUrl, /^https:\/\/footballplayer\.online\/formation-boards\//)

  await assert.rejects(
    rpc('public.publish_formation_board_version($1, $2, $3, $4, $5)', [sharedBoard.board.id, firstVersion.rows[0].id, 'training', 'new_resource', null]),
    /formation_board_duplicate_publication/,
  )
  await assert.rejects(
    rpc('public.publish_formation_board_version($1, $2, $3, $4, $5)', [sharedBoard.board.id, board.currentVersion.id, 'another_team', 'new_resource', null]),
    /formation_board_resource_category_invalid/,
  )

  const secondPublish = await rpc('public.publish_formation_board_version($1, $2, $3, $4, $5)', [sharedBoard.board.id, board.currentVersion.id, 'match_day', 'update_resource', resourceId])
  assert.equal(secondPublish.rows[0].result.publication.resource_id, resourceId)
  assert.equal(secondPublish.rows[0].result.publication.previous_publication_id, firstPublish.rows[0].result.publication.id)

  const history = await db.query('select board_version_id, publication_number from public.formation_board_publications where board_id = $1 order by publication_number', [sharedBoard.board.id])
  assert.deepEqual(history.rows, [
    { board_version_id: firstVersion.rows[0].id, publication_number: 1 },
    { board_version_id: board.currentVersion.id, publication_number: 2 },
  ])

  await resetActor()
  await assert.rejects(
    db.query("update public.formation_board_publications set resource_category = 'general' where id = $1", [firstPublish.rows[0].result.publication.id]),
    /formation_board_snapshot_immutable/,
  )
  const audit = await db.query("select metadata from public.audit_logs where action = 'formation_board_published' order by created_at desc limit 1")
  assert.equal(audit.rows[0].metadata.notificationSent, false)
  assert.equal(audit.rows[0].metadata.emailSent, false)
  assert.equal(audit.rows[0].metadata.parentVisible, false)
})

test('published boards cannot be deleted while unshared boards require exact confirmation', async () => {
  await setActor(IDS.manager)
  await assert.rejects(
    rpc('public.delete_formation_board($1, $2)', [sharedBoard.board.id, sharedBoard.board.title]),
    /formation_board_published_delete_forbidden/,
  )

  const created = await rpc(
    'public.create_formation_board($1, $2, $3, $4, $5, $6, $7::jsonb, $8::jsonb, $9, $10, $11)',
    [IDS.teamA, 'Delete me', '', '5v5', '5v5-custom', 'portrait', '[]', '[]', '', 'draft', 1],
  )
  const boardId = created.rows[0].result.board.id
  await assert.rejects(rpc('public.delete_formation_board($1, $2)', [boardId, 'wrong']), /formation_board_delete_confirmation_failed/)
  const deleted = await rpc('public.delete_formation_board($1, $2)', [boardId, 'Delete me'])
  assert.equal(deleted.rows[0].result.deleted, true)
})

test('export request evidence is Team scoped and Assistant Coach is denied', async () => {
  await setActor(IDS.manager)
  const current = (await rpc('public.get_formation_board($1)', [sharedBoard.board.id])).rows[0].result
  const request = await rpc('public.request_formation_board_export($1, $2, $3)', [sharedBoard.board.id, current.currentVersion.id, 'pdf'])
  assert.equal(request.rows[0].result.request.export_state, 'pending')
  assert.equal(request.rows[0].result.snapshot.id, current.currentVersion.id)

  await setActor(IDS.assistant)
  await assert.rejects(
    rpc('public.request_formation_board_export($1, $2, $3)', [sharedBoard.board.id, current.currentVersion.id, 'png']),
    /formation_board_export_forbidden/,
  )
})

test('RLS and grants expose only authorised rows and deny direct mutation', async () => {
  await setActor(IDS.parent)
  const parentRows = await db.query('select id from public.formation_boards')
  assert.equal(parentRows.rows.length, 0)

  await setActor(IDS.assistant)
  const assistantRows = await db.query('select id from public.formation_boards where id = $1', [sharedBoard.board.id])
  assert.equal(assistantRows.rows.length, 1)
  await assert.rejects(
    db.query("update public.formation_boards set title = 'Bypass' where id = $1", [sharedBoard.board.id]),
    /permission denied/,
  )

  await setActor(IDS.coachB)
  const crossClubRows = await db.query('select id from public.formation_boards where id = $1', [sharedBoard.board.id])
  assert.equal(crossClubRows.rows.length, 0)
})

test('foreign keys have covering indexes and export RLS caches the actor lookup', async () => {
  await resetActor()
  const indexes = await db.query(`
    select indexname
    from pg_indexes
    where schemaname = 'public'
      and indexname in (
        'formation_board_exports_requester_idx',
        'formation_board_exports_version_idx',
        'formation_board_publications_previous_idx',
        'formation_board_publications_publisher_idx',
        'formation_board_publications_version_idx',
        'formation_board_versions_board_scope_idx',
        'formation_board_versions_creator_idx',
        'formation_board_versions_preset_idx',
        'formation_board_versions_source_idx',
        'formation_boards_archived_by_idx',
        'formation_boards_club_idx',
        'formation_boards_current_publication_idx',
        'formation_boards_current_version_idx',
        'formation_boards_deleted_by_idx',
        'formation_boards_preset_idx'
      )
  `)
  assert.equal(indexes.rows.length, 15)

  const compositeIndexes = await db.query(`
    select indexname, indexdef
    from pg_indexes
    where schemaname = 'public'
      and indexname in (
        'formation_board_exports_version_idx',
        'formation_board_publications_version_idx',
        'formation_boards_current_version_idx'
      )
    order by indexname
  `)
  assert.equal(compositeIndexes.rows.length, 3)
  for (const index of compositeIndexes.rows) {
    assert.match(index.indexdef, /club_id, team_id\)/)
  }

  const policy = await db.query(`
    select qual
    from pg_policies
    where schemaname = 'public'
      and tablename = 'formation_board_export_requests'
      and policyname = 'formation_board_export_requests_select_authorised'
  `)
  assert.match(policy.rows[0].qual, /SELECT auth\.uid\(\)/i)
})

test('audit history records every successful action class', async () => {
  await resetActor()
  const rows = await db.query(`
    select distinct action
    from public.audit_logs
    where entity_type = 'formation_board'
  `)
  const actions = new Set(rows.rows.map((row) => row.action))

  for (const action of [
    'formation_board_archived',
    'formation_board_created',
    'formation_board_duplicated',
    'formation_board_export_requested',
    'formation_board_published',
    'formation_board_read',
    'formation_board_restored',
    'formation_board_version_restored',
    'formation_board_version_saved',
  ]) {
    assert.equal(actions.has(action), true, `${action} must be audited`)
  }

  const sources = await db.query(`
    select distinct source
    from public.audit_logs
    where entity_type = 'formation_board'
  `)
  assert.deepEqual(sources.rows, [{ source: 'application' }])
})

test('Team deletion can cascade a published Formation Board graph without weakening direct immutability', async () => {
  const teamId = '40000000-0000-4000-8000-000000000099'
  const playerId = '30000000-0000-4000-8000-000000000099'

  await resetActor()
  await db.exec(`
    insert into public.teams (id, club_id, name) values ('${teamId}', '${IDS.clubA}', 'Delete lifecycle Team');
    insert into public.team_staff (team_id, user_id, role_key, role_label, role_rank)
    values ('${teamId}', '${IDS.manager}', 'manager', 'Manager', 50);
    insert into public.players (id, club_id, team_id, player_name, preferred_name, first_name, last_name, shirt_number)
    values ('${playerId}', '${IDS.clubA}', '${teamId}', 'Lifecycle Player', 'Lifecycle', 'Lifecycle', 'Player', '10');
  `)

  await setActor(IDS.manager)
  const created = await rpc(
    'public.create_formation_board($1, $2, $3, $4, $5, $6, $7::jsonb, $8::jsonb, $9, $10, $11)',
    [teamId, 'Lifecycle board', '', '5v5', '5v5-custom', 'portrait', JSON.stringify([placement(playerId, 0.5, 0.5)]), '[]', '', 'shared', 1],
  )
  const boardId = created.rows[0].result.board.id
  const versionId = created.rows[0].result.currentVersion.id
  const published = await rpc(
    'public.publish_formation_board_version($1, $2, $3, $4, $5)',
    [boardId, versionId, 'general', 'new_resource', null],
  )
  const resourceId = published.rows[0].result.resource.id

  await resetActor()
  await db.query('delete from public.teams where id = $1', [teamId])

  for (const [tableName, id] of [
    ['formation_boards', boardId],
    ['formation_board_versions', versionId],
    ['formation_board_publications', published.rows[0].result.publication.id],
    ['resource_library_items', resourceId],
  ]) {
    const remaining = await db.query(`select count(*)::integer as count from public.${tableName} where id = $1`, [id])
    assert.equal(remaining.rows[0].count, 0, `${tableName} must not block Team deletion`)
  }
})
