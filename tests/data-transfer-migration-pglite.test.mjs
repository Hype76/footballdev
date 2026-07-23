import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'
import { PGlite } from '@electric-sql/pglite'
import {
  buildTransferWorkbook,
  DATA_TRANSFER_FILENAME,
  inspectTransferWorkbookMode,
  parseTransferWorkbook,
} from '../netlify/functions/lib/_data-transfer-workbook.js'
import { buildImportPlan } from '../netlify/functions/lib/_data-transfer-plan.js'

const migrationUrl = new URL('../supabase/migrations/20260717102324_data_transfer_v1.sql', import.meta.url)
const storageMimeMigrationUrl = new URL('../supabase/migrations/20260723110207_data_transfer_storage_mime_allowlist_portable_detection_recovery_07.sql', import.meta.url)

async function createDatabase() {
  const db = new PGlite()
  await db.exec(`
    create role anon;
    create role authenticated;
    create role service_role;
    create schema auth;
    create schema storage;
    create table auth.users (id uuid primary key default gen_random_uuid());
    create table public.clubs (
      id uuid primary key default gen_random_uuid(), name text not null,
      created_at timestamptz not null default timezone('utc', now())
    );
    create table public.users (
      id uuid primary key references auth.users(id), email text not null, name text,
      username text, role text not null, role_label text, role_rank integer not null default 0,
      club_id uuid references public.clubs(id), status text not null default 'active'
    );
    create table public.teams (
      id uuid primary key default gen_random_uuid(), club_id uuid not null references public.clubs(id),
      name text not null, created_at timestamptz not null default timezone('utc', now())
    );
    create unique index teams_club_id_name_key on public.teams(club_id, name);
    create table public.players (
      id uuid primary key default gen_random_uuid(), club_id uuid not null references public.clubs(id),
      team_id uuid references public.teams(id), team text not null default '', player_name text not null,
      section text not null default 'Trial', parent_name text, parent_email text, notes text,
      status text not null default 'active', positions text[] not null default '{}', shirt_number integer,
      created_at timestamptz not null default timezone('utc', now()), updated_at timestamptz not null default timezone('utc', now())
    );
    create table public.parent_player_links (
      id uuid primary key default gen_random_uuid(), club_id uuid not null references public.clubs(id),
      team_id uuid references public.teams(id), player_id uuid not null references public.players(id),
      parent_link_id uuid references public.parent_player_links(id), link_type text not null default 'parent',
      email text, auth_user_id uuid references auth.users(id), invite_token uuid not null default gen_random_uuid(),
      status text not null default 'pending', invited_by uuid references public.users(id), invited_by_name text,
      accepted_at timestamptz, expires_at timestamptz, created_at timestamptz not null default timezone('utc', now()),
      updated_at timestamptz not null default timezone('utc', now()),
      constraint parent_player_links_status_check check (status in ('pending','active','revoked'))
    );
    create table public.evaluations (
      id uuid primary key default gen_random_uuid(), player_id uuid references public.players(id),
      club_id uuid references public.clubs(id)
    );
    create table storage.buckets (
      id text primary key, name text not null, public boolean not null default false,
      file_size_limit bigint, allowed_mime_types text[]
    );
  `)
  await db.exec(await readFile(migrationUrl, 'utf8'))
  await db.exec(await readFile(storageMimeMigrationUrl, 'utf8'))
  return db
}

function importPlan(suffix = 'A') {
  return {
    club: null,
    teams: [{ action: 'create', entity_id: '', values: { transfer_reference: `TEAM-${suffix}`, name: `QA Team ${suffix}`, status: 'active' } }],
    players: [{ action: 'create', entity_id: '', values: { transfer_reference: `PLAYER-${suffix}`, team_reference: `TEAM-${suffix}`, first_name: 'Alex', last_name: `Example ${suffix}`, section: 'Squad', positions: ['Midfielder'], status: 'active' } }],
    guardians: [{ action: 'create', entity_id: '', values: { transfer_reference: `GUARDIAN-${suffix}`, first_name: 'Pat', last_name: `Example ${suffix}`, email: `qa-${suffix.toLowerCase()}@example.test`, status: 'active' } }],
    links: [{ action: 'link', entity_id: '', values: { player_reference: `PLAYER-${suffix}`, guardian_reference: `GUARDIAN-${suffix}`, relationship: 'Parent', primary_contact: true, receives_communications: false, emergency_contact: true } }],
  }
}

async function seedBatch(db, suffix = 'A') {
  const seeded = await db.query(`
    with club as (
      insert into public.clubs(name) values ('Jeluma QA FC') returning id
    ), auth_user as (
      insert into auth.users default values returning id
    ), app_user as (
      insert into public.users(id, email, name, role, role_label, role_rank, club_id)
      select auth_user.id, 'support@jelumalabs.com', 'Simon', 'admin', 'Club Admin', 90, club.id
      from auth_user, club returning id, club_id
    )
    select id as actor_id, club_id from app_user
  `)
  const { actor_id: actorId, club_id: clubId } = seeded.rows[0]
  const plan = importPlan(suffix)
  const planHash = `plan-${suffix}`
  const inserted = await db.query(`
    insert into public.data_transfer_batches(
      actor_id, actor_role, club_id, authorized_team_ids, transfer_type, state, template_version,
      workbook_name, workbook_sha256, workbook_size_bytes, raw_expires_at, plan, plan_sha256
    ) values ($1, 'admin', $2, '{}', 'import', 'awaiting_confirmation', 'FP-V1-ONBOARDING-1',
      'qa.xlsx', $3, 1024, timezone('utc', now()) + interval '7 days', $4::jsonb, $5)
    returning id
  `, [actorId, clubId, `workbook-${suffix}`, JSON.stringify(plan), planHash])
  return { actorId, batchId: inserted.rows[0].id, clubId, planHash }
}

async function seedNullSeasonOrdinaryBatch(db, format) {
  const key = format.toUpperCase()
  const seeded = await db.query(`
    with club as (
      insert into public.clubs(name, transfer_reference, season)
      values ($1, $2, null)
      returning id, updated_at
    ), team as (
      insert into public.teams(club_id, name, transfer_reference, season, status)
      select club.id, $3, $4, null, 'active'
      from club
      returning id, club_id, updated_at
    ), auth_user as (
      insert into auth.users default values
      returning id
    ), app_user as (
      insert into public.users(id, email, name, role, role_label, role_rank, club_id)
      select auth_user.id, $5, 'FP TEST Staff', 'admin', 'Club Admin', 90, club.id
      from auth_user, club
      returning id, club_id
    )
    select app_user.id as actor_id, club.id as club_id, club.updated_at as club_updated_at,
      team.id as team_id, team.updated_at as team_updated_at
    from app_user, club, team
  `, [
    `FP TEST Null Season ${key}`,
    null,
    `FP TEST U99 ${key}`,
    null,
    `fp-test-${format}@example.invalid`,
  ])
  const {
    actor_id: actorId,
    club_id: clubId,
    club_updated_at: clubUpdatedAt,
    team_id: teamId,
    team_updated_at: teamUpdatedAt,
  } = seeded.rows[0]
  const playerReference = `PLAYER-NULL-${key}`
  const guardianReference = `GUARDIAN-NULL-${key}`
  const plan = {
    context: {
      planning_mode: 'ordinary',
      selected_season: '2026/27',
    },
    club: {
      action: 'unchanged',
      entity_id: clubId,
      expected_updated_at: clubUpdatedAt,
      values: {
        transfer_reference: '',
        name: `FP TEST Null Season ${key}`,
        season: '',
      },
    },
    teams: [{
      action: 'unchanged',
      entity_id: teamId,
      expected_updated_at: teamUpdatedAt,
      planning_handle: `PLAN-TEAM-${key}`,
      values: {
        transfer_reference: '',
        name: `FP TEST U99 ${key}`,
        season: '',
        status: 'active',
      },
    }],
    players: [{
      action: 'create',
      entity_id: '',
      team_entity_id: teamId,
      values: {
        transfer_reference: playerReference,
        team_reference: '',
        first_name: 'Alex',
        last_name: `Null Season ${key}`,
        preferred_name: '',
        date_of_birth: '2014-01-20',
        gender: '',
        section: 'Squad',
        shirt_number: '',
        positions: ['Midfielder'],
        status: 'active',
      },
    }],
    guardians: [{
      action: 'create',
      entity_id: '',
      values: {
        transfer_reference: guardianReference,
        first_name: 'Pat',
        last_name: `Null Season ${key}`,
        email: `fp-test-null-${format}@example.invalid`,
        phone: '',
        status: 'active',
      },
    }],
    links: [{
      action: 'link',
      entity_id: '',
      guardian_entity_id: '',
      player_entity_id: '',
      values: {
        player_reference: playerReference,
        guardian_reference: guardianReference,
        relationship: 'Parent',
        primary_contact: true,
        receives_communications: false,
        emergency_contact: true,
      },
    }],
  }
  const planHash = `null-season-plan-${format}`
  const inserted = await db.query(`
    insert into public.data_transfer_batches(
      actor_id, actor_role, club_id, authorized_team_ids, transfer_type, state, template_version,
      workbook_name, workbook_sha256, workbook_size_bytes, raw_expires_at, options, plan, plan_sha256
    ) values (
      $1, 'admin', $2, array[$3]::uuid[], 'import', 'awaiting_confirmation', 'FP-V1-SIMPLE-1',
      $4, $5, 1024, timezone('utc', now()) + interval '7 days',
      $6::jsonb, $7::jsonb, $8
    )
    returning id
  `, [
    actorId,
    clubId,
    teamId,
    `null-season.${format}`,
    `null-season-workbook-${format}`,
    JSON.stringify({
      planningMode: 'ordinary',
      season: '2026/27',
      source: { format },
      teamIds: [teamId],
    }),
    JSON.stringify(plan),
    planHash,
  ])
  return {
    batchId: inserted.rows[0].id,
    clubId,
    planHash,
    teamId,
  }
}

test('forward migration parses and the import RPC is atomic, idempotent, and communication-free', async () => {
  const db = await createDatabase()
  try {
    const bucket = await db.query("select public, file_size_limit, allowed_mime_types from storage.buckets where id = 'data-transfer-private'")
    assert.deepEqual(bucket.rows, [{
      allowed_mime_types: [
        'text/csv',
        'text/tab-separated-values',
        'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
        'application/vnd.oasis.opendocument.spreadsheet',
      ],
      file_size_limit: 4194304,
      public: false,
    }])
    const seeded = await seedBatch(db, 'A')
    const first = await db.query('select public.execute_data_transfer_import($1, $2) as result', [seeded.batchId, seeded.planHash])
    assert.equal(first.rows[0].result.state, 'completed')
    assert.equal(first.rows[0].result.idempotent, false)
    const second = await db.query('select public.execute_data_transfer_import($1, $2) as result', [seeded.batchId, seeded.planHash])
    assert.equal(second.rows[0].result.idempotent, true)
    const links = await db.query('select status, receives_communications, auth_user_id, accepted_at from public.parent_player_links')
    assert.deepEqual(links.rows, [{ status: 'uninvited', receives_communications: false, auth_user_id: null, accepted_at: null }])
    const rollback = await db.query('select public.rollback_data_transfer_import($1) as result', [seeded.batchId])
    assert.equal(rollback.rows[0].result.state, 'rolled_back')
    const remaining = await db.query('select (select count(*) from public.teams) as teams, (select count(*) from public.players) as players, (select count(*) from public.guardians) as guardians, (select count(*) from public.parent_player_links) as links')
    assert.deepEqual(remaining.rows[0], { teams: 0, players: 0, guardians: 0, links: 0 })
  } finally {
    await db.close()
  }
})

test('application-generated portable export bytes preview, confirm, roll back, and clean up in isolation', async () => {
  const db = await createDatabase()
  try {
    const seeded = await db.query(`
      with club as (
        insert into public.clubs(name, transfer_reference, season)
        values ('Portable Self Reimport FC', 'CLUB-PORTABLE-SELF', '2026/27')
        returning id, name, transfer_reference, season, updated_at
      ), auth_user as (
        insert into auth.users default values
        returning id
      ), app_user as (
        insert into public.users(id, email, name, role, role_label, role_rank, club_id)
        select auth_user.id, 'portable-self-reimport@example.invalid', 'Portable QA', 'admin', 'Club Admin', 90, club.id
        from auth_user, club
        returning id, club_id
      )
      select app_user.id as actor_id, club.id as club_id, club.name, club.transfer_reference, club.season, club.updated_at
      from app_user, club
    `)
    const fixture = seeded.rows[0]
    const exportData = {
      'Club Details': [{
        transfer_reference: fixture.transfer_reference,
        name: fixture.name,
        season: '2026/27',
      }],
      Teams: [{
        transfer_reference: 'TEAM-PORTABLE-SELF',
        name: 'Portable Self Team',
        season: '2026/27',
        status: 'active',
      }],
      Players: [{
        transfer_reference: 'PLAYER-PORTABLE-SELF',
        team_reference: 'TEAM-PORTABLE-SELF',
        first_name: 'Alex',
        last_name: 'Portable',
        date_of_birth: '2014-01-20',
        section: 'Squad',
        positions: ['Defender'],
        status: 'active',
      }],
      Guardians: [{
        transfer_reference: 'GUARDIAN-PORTABLE-SELF',
        first_name: 'Pat',
        last_name: 'Portable',
        email: 'portable-guardian@example.invalid',
        status: 'active',
      }],
      'Player-Guardian Links': [{
        player_reference: 'PLAYER-PORTABLE-SELF',
        guardian_reference: 'GUARDIAN-PORTABLE-SELF',
        relationship: 'Parent',
        primary_contact: true,
        receives_communications: false,
        emergency_contact: true,
      }],
    }
    const exportedBytes = await buildTransferWorkbook({
      data: exportData,
      mode: 'export',
      scopeLabel: 'Portable Self Reimport FC',
    })
    const detected = await inspectTransferWorkbookMode(exportedBytes)
    assert.equal(detected.importMode, 'portable')
    assert.equal(detected.modeDetection.signature.versionMatches, true)
    const parsed = await parseTransferWorkbook(exportedBytes)
    assert.deepEqual(parsed.errors, [])
    const preview = buildImportPlan({
      actorScope: {
        authorizedTeamIds: [],
        canManageAllTeams: true,
        canManageClub: true,
        canManageTeams: true,
        clubId: fixture.club_id,
        isClubWideScope: true,
      },
      existing: {
        club: {
          id: fixture.club_id,
          name: fixture.name,
          season: fixture.season,
          transfer_reference: fixture.transfer_reference,
          updated_at: fixture.updated_at,
        },
        teams: [],
        players: [],
        guardians: [],
        links: [],
      },
      importOptions: {
        allowTeamCreation: true,
        createPossibleDuplicates: false,
        fillBlankFields: false,
        importMode: 'additive',
        planningMode: 'portable',
        season: '2026/27',
        updateConflicts: false,
      },
      rowsBySheet: parsed.rowsBySheet,
    })
    assert.deepEqual(preview.errors, [])
    assert.ok(preview.plan)
    assert.equal(preview.plan.context.planning_mode, 'portable')
    assert.equal(preview.counts.create, 3)
    assert.equal(preview.counts.link, 1)

    const inserted = await db.query(`
      insert into public.data_transfer_batches(
        actor_id, actor_role, club_id, authorized_team_ids, transfer_type, state, template_version,
        workbook_name, workbook_sha256, workbook_size_bytes, raw_expires_at, options, plan, plan_sha256
      ) values (
        $1, 'admin', $2, '{}', 'import', 'awaiting_confirmation', 'FP-V1-ONBOARDING-1',
        $3, 'portable-self-reimport-workbook', $4, timezone('utc', now()) + interval '7 days',
        $5::jsonb, $6::jsonb, $7
      )
      returning id
    `, [
      fixture.actor_id,
      fixture.club_id,
      DATA_TRANSFER_FILENAME,
      exportedBytes.length,
      JSON.stringify({ planningMode: 'portable', source: { format: 'xlsx', portable: true } }),
      JSON.stringify(preview.plan),
      preview.planSha256,
    ])
    const batchId = inserted.rows[0].id
    const confirmed = await db.query(
      'select public.execute_data_transfer_import($1, $2) as result',
      [batchId, preview.planSha256],
    )
    assert.equal(confirmed.rows[0].result.state, 'completed')
    assert.deepEqual(confirmed.rows[0].result.counts, {
      clubs: 0,
      guardians: 1,
      links: 1,
      players: 1,
      teams: 1,
    })
    const imported = await db.query(`
      select
        (select count(*) from public.teams where club_id = $1) as teams,
        (select count(*) from public.players where club_id = $1) as players,
        (select count(*) from public.guardians where club_id = $1) as guardians,
        (select count(*) from public.parent_player_links where club_id = $1 and status = 'uninvited' and auth_user_id is null) as uninvited_links
    `, [fixture.club_id])
    assert.deepEqual(imported.rows[0], {
      guardians: 1,
      players: 1,
      teams: 1,
      uninvited_links: 1,
    })
    const rollback = await db.query('select public.rollback_data_transfer_import($1) as result', [batchId])
    assert.equal(rollback.rows[0].result.state, 'rolled_back')
    const remaining = await db.query(`
      select
        (select count(*) from public.clubs where id = $1) as retained_club,
        (select count(*) from public.teams where club_id = $1) as teams,
        (select count(*) from public.players where club_id = $1) as players,
        (select count(*) from public.guardians where club_id = $1) as guardians,
        (select count(*) from public.parent_player_links where club_id = $1) as links
    `, [fixture.club_id])
    assert.deepEqual(remaining.rows[0], {
      guardians: 0,
      links: 0,
      players: 0,
      retained_club: 1,
      teams: 0,
    })
  } finally {
    await db.close()
  }
})

test('CSV, TSV, XLSX, and ODS null-season ordinary plans confirm and roll back without changing scope anchors', async () => {
  const db = await createDatabase()
  try {
    for (const format of ['csv', 'tsv', 'xlsx', 'ods']) {
      const seeded = await seedNullSeasonOrdinaryBatch(db, format)
      const before = await db.query(`
        select c.season as club_season, c.transfer_reference as club_transfer_reference,
          t.season as team_season, t.transfer_reference as team_transfer_reference
        from public.clubs c
        join public.teams t on t.club_id = c.id
        where c.id = $1 and t.id = $2
      `, [seeded.clubId, seeded.teamId])
      assert.deepEqual(before.rows, [{
        club_season: null,
        club_transfer_reference: null,
        team_season: null,
        team_transfer_reference: null,
      }])

      const confirmed = await db.query(
        'select public.execute_data_transfer_import($1, $2) as result',
        [seeded.batchId, seeded.planHash],
      )
      assert.equal(confirmed.rows[0].result.state, 'completed')
      assert.deepEqual(confirmed.rows[0].result.counts, {
        clubs: 0,
        guardians: 1,
        links: 1,
        players: 1,
        teams: 0,
      })

      const created = await db.query(`
        select
          (select count(*) from public.players where club_id = $1 and team_id = $2) as players,
          (select count(*) from public.guardians where club_id = $1) as guardians,
          (select count(*) from public.parent_player_links where club_id = $1 and team_id = $2) as links
      `, [seeded.clubId, seeded.teamId])
      assert.deepEqual(created.rows[0], { players: 1, guardians: 1, links: 1 })

      const scopeAfterConfirm = await db.query(`
        select c.season as club_season, c.transfer_reference as club_transfer_reference,
          t.season as team_season, t.transfer_reference as team_transfer_reference
        from public.clubs c
        join public.teams t on t.club_id = c.id
        where c.id = $1 and t.id = $2
      `, [seeded.clubId, seeded.teamId])
      assert.deepEqual(scopeAfterConfirm.rows, [{
        club_season: null,
        club_transfer_reference: null,
        team_season: null,
        team_transfer_reference: null,
      }])

      const batchContext = await db.query(`
        select options ->> 'season' as selected_season,
          plan #>> '{context,selected_season}' as plan_selected_season,
          options #>> '{source,format}' as source_format
        from public.data_transfer_batches
        where id = $1
      `, [seeded.batchId])
      assert.deepEqual(batchContext.rows, [{
        plan_selected_season: '2026/27',
        selected_season: '2026/27',
        source_format: format,
      }])

      const rollback = await db.query(
        'select public.rollback_data_transfer_import($1) as result',
        [seeded.batchId],
      )
      assert.equal(rollback.rows[0].result.state, 'rolled_back')
      const remaining = await db.query(`
        select
          (select count(*) from public.players where club_id = $1) as players,
          (select count(*) from public.guardians where club_id = $1) as guardians,
          (select count(*) from public.parent_player_links where club_id = $1) as links,
          (select count(*) from public.teams where club_id = $1 and id = $2 and season is null) as retained_null_team,
          (select count(*) from public.clubs where id = $1 and season is null) as retained_null_club
      `, [seeded.clubId, seeded.teamId])
      assert.deepEqual(remaining.rows[0], {
        guardians: 0,
        links: 0,
        players: 0,
        retained_null_club: 1,
        retained_null_team: 1,
      })
    }
  } finally {
    await db.close()
  }
})

test('rollback refuses a later dependency and retains the imported records and audit state', async () => {
  const db = await createDatabase()
  try {
    const seeded = await seedBatch(db, 'B')
    await db.query('select public.execute_data_transfer_import($1, $2)', [seeded.batchId, seeded.planHash])
    const player = await db.query("select id from public.players where transfer_reference = 'PLAYER-B'")
    await db.query('insert into public.evaluations(player_id, club_id) values ($1, $2)', [player.rows[0].id, seeded.clubId])
    const rollback = await db.query('select public.rollback_data_transfer_import($1) as result', [seeded.batchId])
    assert.equal(rollback.rows[0].result.state, 'rollback_blocked')
    const batch = await db.query('select state, rollback_blocked_reason from public.data_transfer_batches where id = $1', [seeded.batchId])
    assert.equal(batch.rows[0].state, 'rollback_blocked')
    assert.match(batch.rows[0].rollback_blocked_reason, /dependent records/i)
    assert.equal((await db.query('select count(*) as count from public.players')).rows[0].count, 1)
  } finally {
    await db.close()
  }
})

test('a material source change after preview fails the whole confirmed update plan', async () => {
  const db = await createDatabase()
  try {
    const seeded = await seedBatch(db, 'C')
    await db.query('select public.execute_data_transfer_import($1, $2)', [seeded.batchId, seeded.planHash])
    const player = (await db.query("select * from public.players where transfer_reference = 'PLAYER-C'")).rows[0]
    const updatePlan = {
      club: null,
      teams: [],
      players: [{
        action: 'update',
        entity_id: player.id,
        expected_updated_at: player.updated_at,
        team_entity_id: player.team_id,
        values: {
          transfer_reference: player.transfer_reference,
          team_reference: 'TEAM-C',
          first_name: 'Previewed',
          last_name: 'Example C',
          preferred_name: '',
          date_of_birth: '',
          gender: '',
          section: player.section,
          shirt_number: '',
          positions: player.positions,
          status: player.status,
        },
      }],
      guardians: [],
      links: [],
    }
    const updateBatch = await db.query(`
      insert into public.data_transfer_batches(
        actor_id, actor_role, club_id, authorized_team_ids, transfer_type, state, template_version,
        workbook_name, workbook_sha256, workbook_size_bytes, raw_expires_at, plan, plan_sha256
      ) values ($1, 'admin', $2, '{}', 'import', 'awaiting_confirmation', 'FP-V1-ONBOARDING-1',
        'update.xlsx', 'workbook-update', 1024, timezone('utc', now()) + interval '7 days', $3::jsonb, 'plan-update')
      returning id
    `, [seeded.actorId, seeded.clubId, JSON.stringify(updatePlan)])
    await db.query("update public.players set first_name = 'Later edit', updated_at = updated_at + interval '1 second' where id = $1", [player.id])
    const result = await db.query("select public.execute_data_transfer_import($1, 'plan-update') as result", [updateBatch.rows[0].id])
    assert.equal(result.rows[0].result.state, 'failed')
    assert.equal((await db.query('select first_name from public.players where id = $1', [player.id])).rows[0].first_name, 'Later edit')
    assert.equal((await db.query('select state from public.data_transfer_batches where id = $1', [updateBatch.rows[0].id])).rows[0].state, 'failed')
  } finally {
    await db.close()
  }
})
