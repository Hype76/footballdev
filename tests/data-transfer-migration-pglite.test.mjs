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
import { buildPitcheroPlan, PITCHERO_TEMPLATE, readPitcheroMembers } from '../netlify/functions/lib/_pitchero-import.js'
import { buildImportPlan, sha256Json, toWorkbookExportData } from '../netlify/functions/lib/_data-transfer-plan.js'

const migrationUrl = new URL('../supabase/migrations/20260717102324_data_transfer_v1.sql', import.meta.url)
const storageMimeMigrationUrl = new URL('../supabase/migrations/20260723121825_data_transfer_storage_mime_allowlist_portable_season_recovery_08.sql', import.meta.url)

async function createDatabase() {
  const db = new PGlite()
  await db.exec(`
    create role anon;
    create role authenticated;
    create role service_role bypassrls;
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

test('manager portable self-reimport uses confirmed season as membership context without changing null-season anchors', async () => {
  const db = await createDatabase()
  try {
    const seeded = await db.query(`
      with club as (
        insert into public.clubs(name, transfer_reference, season)
        values ('Portable Self Reimport FC', null, null)
        returning id, name, transfer_reference, season, updated_at
      ), team as (
        insert into public.teams(club_id, name, transfer_reference, season, status)
        select club.id, 'Portable Self Team', null, null, 'active'
        from club
        returning id, club_id, name, transfer_reference, season, status, updated_at
      ), auth_user as (
        insert into auth.users default values
        returning id
      ), app_user as (
        insert into public.users(id, email, name, role, role_label, role_rank, club_id)
        select auth_user.id, 'portable-self-reimport@example.invalid', 'Portable Manager', 'manager', 'Manager', 50, club.id
        from auth_user, club
        returning id, club_id
      )
      select app_user.id as actor_id,
        club.id as club_id, club.name as club_name, club.transfer_reference as club_transfer_reference,
        club.season as club_season, club.updated_at as club_updated_at,
        team.id as team_id, team.name as team_name, team.transfer_reference as team_transfer_reference,
        team.season as team_season, team.status as team_status, team.updated_at as team_updated_at
      from app_user, club, team
    `)
    const fixture = seeded.rows[0]
    const actorScope = {
      authorizedTeamIds: [fixture.team_id],
      canManageAllTeams: false,
      canManageClub: false,
      canManageTeams: false,
      clubId: fixture.club_id,
      isClubWideScope: false,
    }
    const existing = {
      club: {
        id: fixture.club_id,
        name: fixture.club_name,
        season: fixture.club_season,
        transfer_reference: fixture.club_transfer_reference,
        updated_at: fixture.club_updated_at,
      },
      teams: [{
        id: fixture.team_id,
        club_id: fixture.club_id,
        name: fixture.team_name,
        season: fixture.team_season,
        status: fixture.team_status,
        transfer_reference: fixture.team_transfer_reference,
        updated_at: fixture.team_updated_at,
      }],
      players: [],
      guardians: [],
      links: [],
    }
    const exportData = toWorkbookExportData(existing, actorScope)
    const teamReference = exportData.Teams[0].transfer_reference
    exportData.Players = [{
        transfer_reference: 'PLAYER-PORTABLE-SELF',
        team_reference: teamReference,
        first_name: 'Alex',
        last_name: 'Portable',
        date_of_birth: '2014-01-20',
        section: 'Squad',
        positions: ['Defender'],
        status: 'active',
      }]
    exportData.Guardians = [{
        transfer_reference: 'GUARDIAN-PORTABLE-SELF',
        first_name: 'Pat',
        last_name: 'Portable',
        email: 'portable-guardian@example.invalid',
        status: 'active',
      }]
    exportData['Player-Guardian Links'] = [{
        player_reference: 'PLAYER-PORTABLE-SELF',
        guardian_reference: 'GUARDIAN-PORTABLE-SELF',
        relationship: 'Parent',
        primary_contact: true,
        receives_communications: false,
        emergency_contact: true,
      }]
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
      actorScope,
      existing,
      importOptions: {
        allowTeamCreation: false,
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
    assert.equal(preview.plan.context.selected_season, '2026/27')
    assert.equal(preview.plan.club.action, 'unchanged')
    assert.equal(preview.plan.club.values.season, '')
    assert.equal(preview.plan.teams[0].action, 'unchanged')
    assert.equal(preview.plan.teams[0].entity_id, fixture.team_id)
    assert.equal(preview.plan.teams[0].values.season, '')
    assert.equal(preview.counts.create, 2)
    assert.equal(preview.counts.update, 0)
    assert.equal(preview.counts.link, 1)
    assert.equal(preview.counts.unchanged, 2)
    assert.ok(!preview.errors.some((error) => [
      'IMPORT_SEASON_REQUIRED',
      'CLUB_CHANGE_NOT_AUTHORIZED',
      'TEAM_CHANGE_NOT_AUTHORIZED',
    ].includes(error.code)))

    const beforeConfirmation = await db.query(`
      select
        (select count(*) from public.players where club_id = $1) as players,
        (select count(*) from public.guardians where club_id = $1) as guardians,
        (select count(*) from public.parent_player_links where club_id = $1) as links
    `, [fixture.club_id])
    assert.deepEqual(beforeConfirmation.rows[0], { guardians: 0, links: 0, players: 0 })

    const inserted = await db.query(`
      insert into public.data_transfer_batches(
        actor_id, actor_role, club_id, authorized_team_ids, transfer_type, state, template_version,
        workbook_name, workbook_sha256, workbook_size_bytes, raw_expires_at, options, plan, plan_sha256
      ) values (
        $1, 'manager', $2, array[$3]::uuid[], 'import', 'awaiting_confirmation', 'FP-V1-ONBOARDING-1',
        $4, 'portable-self-reimport-workbook', $5, timezone('utc', now()) + interval '7 days',
        $6::jsonb, $7::jsonb, $8
      )
      returning id
    `, [
      fixture.actor_id,
      fixture.club_id,
      fixture.team_id,
      DATA_TRANSFER_FILENAME,
      exportedBytes.length,
      JSON.stringify({ planningMode: 'portable', season: '2026/27', source: { format: 'xlsx', portable: true } }),
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
      teams: 0,
    })
    const imported = await db.query(`
      select
        (select count(*) from public.clubs where id = $1 and season is null and transfer_reference is null) as retained_club_anchor,
        (select count(*) from public.teams where id = $2 and season is null and transfer_reference is null) as retained_team_anchor,
        (select count(*) from public.players where club_id = $1 and team_id = $2 and transfer_reference = 'PLAYER-PORTABLE-SELF') as players,
        (select count(*) from public.guardians where club_id = $1) as guardians,
        (select count(*) from public.parent_player_links link
          join public.players player on player.id = link.player_id
          join public.guardians guardian on guardian.id = link.guardian_id
          where link.club_id = $1 and link.team_id = $2 and link.status = 'uninvited'
            and link.auth_user_id is null and player.transfer_reference = 'PLAYER-PORTABLE-SELF'
            and guardian.transfer_reference = 'GUARDIAN-PORTABLE-SELF') as resolved_links
    `, [fixture.club_id, fixture.team_id])
    assert.deepEqual(imported.rows[0], {
      guardians: 1,
      players: 1,
      resolved_links: 1,
      retained_club_anchor: 1,
      retained_team_anchor: 1,
    })
    const rollback = await db.query('select public.rollback_data_transfer_import($1) as result', [batchId])
    assert.equal(rollback.rows[0].result.state, 'rolled_back')
    const remaining = await db.query(`
      select
        (select count(*) from public.clubs where id = $1 and season is null and transfer_reference is null) as retained_club,
        (select count(*) from public.teams where id = $2 and season is null and transfer_reference is null) as retained_team,
        (select count(*) from public.players where club_id = $1) as players,
        (select count(*) from public.guardians where club_id = $1) as guardians,
        (select count(*) from public.parent_player_links where club_id = $1) as links
    `, [fixture.club_id, fixture.team_id])
    assert.deepEqual(remaining.rows[0], {
      guardians: 0,
      links: 0,
      players: 0,
      retained_club: 1,
      retained_team: 1,
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

test('Pitchero missing fields, duplicate identities and unresolved relationships stay in the checklist', async () => {
  const source = await readPitcheroMembers(Buffer.from([
    'First name,Last name,Registered,Children,Parents,Email',
    'Sam,Example,Yes,"Jo Example,Ash Example",,sam@example.test',
    'Pat,Example,Yes,Jo Example,,pat@example.test',
    'Ari,Example,Yes,,,',
  ].join('\n')), { fileName: 'pitchero.csv' })
  const scope = { clubId: 'club' }
  const existing = { teams: [], players: [], guardians: [], links: [] }
  const base = { source, existing, scope, season: '2026/27' }
  const noTeams = buildPitcheroPlan({ ...base, decisions: {} })
  assert.equal(noTeams.plan.players.length, 0)
  assert.ok(noTeams.warnings.some((issue) => issue.message.includes('Team Unknown')))
  assert.ok(noTeams.warnings.some((issue) => issue.message.includes('Player role Unknown')))

  const decisions = Object.fromEntries(source.players.map((player) => [player.id, { team: 'U14' }]))
  const unconfirmed = buildPitcheroPlan({ ...base, decisions })
  assert.deepEqual(unconfirmed.plan.players.map((player) => player.values.first_name), ['Ash'])
  assert.ok(unconfirmed.warnings.some((issue) => issue.code === 'PITCHERO_RELATIONSHIP_REVIEW'))
  const player = source.players.find((entry) => entry.name === 'Jo Example')
  decisions[player.id].confirmRelationships = true
  const confirmed = buildPitcheroPlan({ ...base, decisions })
  assert.equal(confirmed.plan.links.length, 3)
  assert.equal(confirmed.plan.guardians.length, 2)

  existing.teams.push({ id: 'team', name: 'U14', status: 'active' })
  existing.players.push({ id: 'existing-player', player_name: 'Jo Example', team_id: 'team', status: 'active', contact_type: 'parent' })
  const duplicate = buildPitcheroPlan({ ...base, decisions })
  assert.ok(duplicate.warnings.some((issue) => issue.code === 'PITCHERO_DUPLICATE_PLAYER'))
  assert.ok(duplicate.plan.players.every((entry) => entry.values.first_name !== 'Jo'))
  decisions[player.id].confirmExisting = true
  assert.equal(buildPitcheroPlan({ ...base, decisions }).plan.players.find((entry) => entry.entity_id === 'existing-player').pitchero_update, true)

  await assert.rejects(readPitcheroMembers(Buffer.from('First name,Last name,Registered\nA,B,Yes,Unexpected'), { fileName: 'pitchero.csv' }), { code: 'CSV_EXTRA_VALUES' })
})

test('Pitchero confirmation imports team rosters, one parent for two children and adult self contact atomically', async (t) => {
  const db = await createDatabase()
  t.after(() => db.close())
  const { actorId, clubId } = await seedBatch(db, 'PITCHERO')
  await db.exec(`
    alter table auth.users add column deleted_at timestamptz, add column banned_until timestamptz;
    alter table public.clubs add column archived_at timestamptz, add column status text default 'active',
      add column plan_key text default 'small_club', add column plan_status text default 'active',
      add column is_plan_comped boolean default false, add column tester_access_expires_at timestamptz,
      add column subscription_team_capacity integer;
    alter table public.teams add column archived_at timestamptz;
    alter table public.players add column archived_at timestamptz, add column contact_type text not null default 'parent',
      add column parent_contacts jsonb not null default '[]';
    create table public.club_team_limit_overrides(club_id uuid primary key, team_limit_override integer);
    create table public.user_club_memberships(auth_user_id uuid, club_id uuid, role text, role_rank integer);
    insert into public.user_club_memberships select id, club_id, role, role_rank from public.users;
    create table public.player_team_memberships(id uuid primary key default gen_random_uuid(),
      club_id uuid references public.clubs(id), team_id uuid references public.teams(id),
      player_id uuid references public.players(id), status text default 'active');
    create function public.synthetic_membership() returns trigger language plpgsql as $$
    begin
      insert into public.player_team_memberships(club_id, team_id, player_id) values (new.club_id, new.team_id, new.id);
      return new;
    end; $$;
    create trigger synthetic_membership after insert on public.players for each row execute function public.synthetic_membership();
    create schema app_private;
    grant usage on schema app_private to service_role;
    grant select on public.players, public.parent_player_links, public.player_team_memberships to service_role;
  `)
  const migration = await readFile(new URL('../supabase/migrations/20261113145726_club_admin_pitchero_and_league.sql', import.meta.url), 'utf8')
  await db.exec(migration.slice(0, migration.indexOf('create function app_private.can_edit_team_league')))

  const csv = Buffer.from([
    'First name,Last name,Registered,Children,Parents,Email,Roles,Team,Date of birth',
    'Jo,Family,Yes,"Casey Family,Morgan Family",,jo@example.test,Parent,,',
    'Casey,Family,No,,Jo Family,,Player,U12,04/05/2015',
    'Morgan,Family,No,,Jo Family,,Player,U14,10/03/2013',
    'Avery,Senior,Yes,,,avery@example.test,Player,First Team,09/02/1999',
  ].join('\n'))
  const source = await readPitcheroMembers(csv, { fileName: 'pitchero.csv' })
  const { plan, warnings } = buildPitcheroPlan({
    source, existing: { teams: [], players: [], guardians: [], links: [] },
    scope: { clubId }, decisions: {}, season: '2026/27',
  })
  const planHash = sha256Json(plan)
  async function newBatch(targetPlan = plan) {
    const hash = sha256Json(targetPlan)
    const { rows } = await db.query(`
      insert into public.data_transfer_batches (actor_id, actor_role, club_id, transfer_type, state,
        template_version, workbook_name, workbook_sha256, workbook_size_bytes, raw_expires_at, plan, plan_sha256, options, warnings)
      values ($1,'admin',$2,'import','awaiting_confirmation',$3,'pitchero.csv','synthetic',1,now(),$4::jsonb,$5,
        '{"planKey":"small_club","teamLimit":5}', $6::jsonb) returning id
    `, [actorId, clubId, PITCHERO_TEMPLATE, JSON.stringify(targetPlan), hash, JSON.stringify(warnings)])
    return rows[0].id
  }
  const batchId = await newBatch()
  assert.equal((await db.query("select has_function_privilege('authenticated', 'public.execute_pitchero_import(uuid,text)', 'execute') as allowed")).rows[0].allowed, false)
  await db.exec('set role service_role')
  const apply = (id, hash = planHash) => db.query('select public.execute_pitchero_import($1, $2) as result', [id, hash]).then(({ rows }) => rows[0].result)
  const imported = await apply(batchId)
  if (imported.state === 'failed') {
    const { rows } = await db.query('select error_summary from public.data_transfer_batches where id = $1', [batchId])
    assert.fail(JSON.stringify(rows[0].error_summary))
  }
  assert.deepEqual(imported.counts, { clubs: 0, teams: 3, players: 3, guardians: 1, links: 2 })
  assert.equal((await apply(batchId)).idempotent, true)
  const adult = (await db.query("select contact_type,parent_contacts,date_of_birth::text from public.players where player_name='Avery Senior'")).rows[0]
  assert.deepEqual(adult, { contact_type: 'self', parent_contacts: [{ type: 'self', name: 'Avery Senior', email: 'avery@example.test' }], date_of_birth: '1999-02-09' })
  const family = (await db.query('select count(distinct guardian_id)::int as guardians, count(distinct player_id)::int as players, count(distinct team_id)::int as teams, array_agg(distinct status) as statuses from public.parent_player_links')).rows[0]
  assert.deepEqual(family, { guardians: 1, players: 2, teams: 2, statuses: ['uninvited'] })
  assert.equal((await db.query("select count(*)::int as n from public.players where contact_type='parent' and parent_email='jo@example.test'")).rows[0].n, 2)
  assert.equal((await db.query('select count(*)::int as n from public.player_team_memberships')).rows[0].n, 3)
  await db.exec('reset role')
  const staleId = await newBatch()
  assert.equal((await apply(staleId)).state, 'failed')
  assert.equal((await db.query('select count(*)::int as n from public.players')).rows[0].n, 3)
  assert.equal((await db.query('select public.rollback_data_transfer_import($1) as result', [batchId])).rows[0].result.state, 'rolled_back')
  assert.equal((await db.query('select count(*)::int as n from public.players')).rows[0].n, 0)
  assert.equal((await db.query('select count(*)::int as n from public.player_team_memberships')).rows[0].n, 0)
  const deniedId = await newBatch()
  await db.query("update public.users set role_rank=50 where id=$1", [actorId])
  assert.equal((await apply(deniedId)).state, 'failed')
  assert.equal((await db.query('select count(*)::int as n from public.teams')).rows[0].n, 0)
})
