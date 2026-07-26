import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { test } from 'node:test'

import { PGlite } from '@electric-sql/pglite'

const migrationUrl = new URL(
  '../supabase/migrations/20260726052528_development_save_persistence_recovery_27.sql',
  import.meta.url,
)

const IDS = Object.freeze({
  admin: '10000000-0000-4000-8000-000000000001',
  clubA: '20000000-0000-4000-8000-000000000001',
  clubB: '20000000-0000-4000-8000-000000000002',
  coach: '10000000-0000-4000-8000-000000000002',
  manager: '10000000-0000-4000-8000-000000000003',
  otherAdmin: '10000000-0000-4000-8000-000000000004',
  parent: '10000000-0000-4000-8000-000000000005',
  playerA: '40000000-0000-4000-8000-000000000001',
  teamA: '30000000-0000-4000-8000-000000000001',
  teamB: '30000000-0000-4000-8000-000000000002',
  teamOther: '30000000-0000-4000-8000-000000000003',
  teamAdmin: '10000000-0000-4000-8000-000000000006',
})

async function createDatabase() {
  const db = new PGlite()

  await db.exec(`
    create role anon;
    create role authenticated;
    create role service_role bypassrls;
    create schema auth;

    create function auth.uid()
    returns uuid
    language sql
    stable
    as $$
      select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid
    $$;

    create table public.users (
      id uuid primary key,
      club_id uuid,
      role text not null,
      role_rank integer not null,
      status text not null default 'active'
    );

    create table public.teams (
      id uuid primary key,
      club_id uuid not null,
      status text not null default 'active'
    );

    create table public.team_staff (
      team_id uuid not null,
      user_id uuid not null,
      primary key (team_id, user_id)
    );

    create table public.match_day_scorer_assignments (
      team_id uuid not null,
      user_id uuid not null,
      status text not null
    );

    create table public.players (
      id uuid primary key,
      club_id uuid not null,
      team_id uuid
    );

    create table public.evaluations (
      id uuid primary key default gen_random_uuid(),
      club_id uuid not null,
      team_id uuid,
      coach_id uuid,
      summary text not null default ''
    );

    create table public.evaluation_drafts (
      id uuid primary key default gen_random_uuid(),
      club_id uuid not null,
      team_id uuid,
      player_id uuid,
      created_by_user_id uuid not null,
      status text not null default 'draft',
      draft_data jsonb not null default '{}'::jsonb
    );

    insert into public.users (id, club_id, role, role_rank) values
      ('${IDS.admin}', '${IDS.clubA}', 'admin', 90),
      ('${IDS.coach}', '${IDS.clubA}', 'coach', 30),
      ('${IDS.manager}', '${IDS.clubA}', 'manager', 50),
      ('${IDS.otherAdmin}', '${IDS.clubB}', 'admin', 90),
      ('${IDS.parent}', '${IDS.clubA}', 'parent_portal', 0),
      ('${IDS.teamAdmin}', '${IDS.clubA}', 'head_manager', 70);

    insert into public.teams (id, club_id) values
      ('${IDS.teamA}', '${IDS.clubA}'),
      ('${IDS.teamB}', '${IDS.clubA}'),
      ('${IDS.teamOther}', '${IDS.clubB}');

    insert into public.team_staff (team_id, user_id) values
      ('${IDS.teamA}', '${IDS.coach}'),
      ('${IDS.teamA}', '${IDS.manager}'),
      ('${IDS.teamA}', '${IDS.teamAdmin}');

    insert into public.match_day_scorer_assignments (team_id, user_id, status) values
      ('${IDS.teamA}', '${IDS.parent}', 'accepted');

    insert into public.players (id, club_id, team_id) values
      ('${IDS.playerA}', '${IDS.clubA}', '${IDS.teamA}');

    create function public.current_user_role()
    returns text
    language sql
    stable
    security definer
    set search_path = pg_catalog, public
    as $$
      select coalesce((select actor.role from public.users actor where actor.id = auth.uid()), '')
    $$;

    create function public.current_user_role_rank()
    returns integer
    language sql
    stable
    security definer
    set search_path = pg_catalog, public
    as $$
      select coalesce((select actor.role_rank from public.users actor where actor.id = auth.uid()), 0)
    $$;

    create function public.current_user_club_id()
    returns uuid
    language sql
    stable
    security definer
    set search_path = pg_catalog, public
    as $$
      select actor.club_id from public.users actor where actor.id = auth.uid()
    $$;

    create function public.current_user_can_access_team(target_club_id uuid, target_team_id uuid)
    returns boolean
    language sql
    stable
    security definer
    set search_path = pg_catalog, public
    as $$
      select exists (
        select 1
        from public.users actor
        where actor.id = auth.uid()
          and actor.status = 'active'
          and (
            actor.role = 'super_admin'
            or (
              actor.club_id = target_club_id
              and actor.role = 'admin'
            )
            or (
              actor.club_id = target_club_id
              and actor.role not in ('admin', 'parent_portal', 'super_admin')
              and actor.role_rank >= 20
              and target_team_id is not null
              and exists (
                select 1
                from public.teams team
                join public.team_staff assignment
                  on assignment.team_id = team.id
                 and assignment.user_id = actor.id
                where team.id = target_team_id
                  and team.club_id = target_club_id
                  and team.status = 'active'
              )
            )
          )
      )
    $$;

    create function public.can_insert_evaluation_for_plan(target_club_id uuid)
    returns boolean
    language sql
    stable
    as $$
      select target_club_id is not null
    $$;

    grant usage on schema public, auth to anon, authenticated, service_role;
    grant all on public.evaluations to anon, authenticated, service_role;
    grant all on public.evaluation_drafts to authenticated, service_role;
    grant select on public.users, public.teams, public.team_staff, public.players
      to authenticated, service_role;
    grant execute on all functions in schema public to authenticated, service_role;
    grant execute on function auth.uid() to authenticated, service_role;

    alter table public.evaluations enable row level security;
    alter table public.evaluation_drafts enable row level security;

    create policy evaluations_select_test_scope
    on public.evaluations
    for select
    to authenticated
    using (true);
  `)

  await db.exec(await readFile(migrationUrl, 'utf8'))
  return db
}

async function setActor(db, actorId) {
  await db.exec('reset role')
  await db.query("select set_config('request.jwt.claim.sub', $1, false)", [actorId])
  await db.exec('set role authenticated')
}

async function asOwner(db) {
  await db.exec('reset role')
}

async function insertEvaluation(db, { actorId, clubId = IDS.clubA, teamId = IDS.teamA } = {}) {
  return db.query(
    `insert into public.evaluations (club_id, team_id, coach_id, summary)
     values ($1, $2, $3, 'created')
     returning id`,
    [clubId, teamId, actorId],
  )
}

async function insertDraft(db, actorId, teamId = IDS.teamA) {
  return db.query(
    `insert into public.evaluation_drafts (
       club_id,
       team_id,
       player_id,
       created_by_user_id,
       status,
       draft_data
     )
     values ($1, $2, $3, $4, 'draft', '{"answer":"saved"}')
     returning id`,
    [IDS.clubA, teamId, IDS.playerA, actorId],
  )
}

test('migration is policy-only and explicitly scopes evaluation and draft writes', async () => {
  const migration = await readFile(migrationUrl, 'utf8')

  assert.match(migration, /public\.current_user_role\(\) <> 'parent_portal'/)
  assert.match(
    migration,
    /public\.current_user_can_access_team\(\s*evaluations\.club_id,\s*evaluations\.team_id\s*\)/,
  )
  assert.match(
    migration,
    /public\.current_user_can_access_team\(\s*evaluation_drafts\.club_id,\s*evaluation_drafts\.team_id\s*\)/,
  )
  assert.match(migration, /drop policy if exists evaluation_drafts_close_own_active/)
  assert.match(migration, /revoke all on public\.evaluations from anon/)
  assert.match(
    migration,
    /revoke truncate, references, trigger on public\.evaluations from authenticated/,
  )
  const migrationWithoutPrivilegeRevokes = migration
    .replace(
      /revoke truncate, references, trigger on public\.evaluations from authenticated;/i,
      '',
    )
    .replace(
      /revoke delete, truncate, references, trigger on public\.evaluation_drafts from authenticated;/i,
      '',
    )
  assert.doesNotMatch(
    migrationWithoutPrivilegeRevokes,
    /\b(drop table|drop column|truncate|delete from|update public\.)\b/i,
  )
})

test('Manager, Team Admin, Coach and Club Admin retain authorized Development writes', async () => {
  const db = await createDatabase()

  try {
    for (const actorId of [IDS.manager, IDS.teamAdmin, IDS.coach, IDS.admin]) {
      await setActor(db, actorId)
      const evaluation = await insertEvaluation(db, { actorId })
      const draft = await insertDraft(db, actorId)

      assert.equal(evaluation.rows.length, 1)
      assert.equal(draft.rows.length, 1)
    }
  } finally {
    await asOwner(db)
    await db.close()
  }
})

test('same-club unassigned and cross-club Development writes are denied', async () => {
  const db = await createDatabase()

  try {
    for (const actorId of [IDS.coach, IDS.manager, IDS.teamAdmin]) {
      await setActor(db, actorId)
      await assert.rejects(
        insertEvaluation(db, { actorId, teamId: IDS.teamB }),
        /row-level security policy/i,
      )
      await assert.rejects(
        insertDraft(db, actorId, IDS.teamB),
        /row-level security policy/i,
      )
    }

    await setActor(db, IDS.admin)
    await assert.rejects(
      insertEvaluation(db, {
        actorId: IDS.admin,
        clubId: IDS.clubB,
        teamId: IDS.teamOther,
      }),
      /row-level security policy/i,
    )
  } finally {
    await asOwner(db)
    await db.close()
  }
})

test('parent_portal including an accepted scorer cannot write evaluations or drafts', async () => {
  const db = await createDatabase()

  try {
    await asOwner(db)
    const existing = await db.query(
      `insert into public.evaluations (club_id, team_id, coach_id, summary)
       values ($1, $2, $3, 'protected')
       returning id`,
      [IDS.clubA, IDS.teamA, IDS.parent],
    )
    const evaluationId = existing.rows[0].id

    await setActor(db, IDS.parent)
    await assert.rejects(
      insertEvaluation(db, { actorId: IDS.parent }),
      /row-level security policy/i,
    )
    await assert.rejects(
      insertDraft(db, IDS.parent),
      /row-level security policy/i,
    )

    const updated = await db.query(
      `update public.evaluations
       set summary = 'parent changed'
       where id = $1
       returning id`,
      [evaluationId],
    )
    const deleted = await db.query(
      'delete from public.evaluations where id = $1 returning id',
      [evaluationId],
    )

    assert.equal(updated.rows.length, 0)
    assert.equal(deleted.rows.length, 0)
    await assert.rejects(
      db.exec('truncate table public.evaluations'),
      /permission denied/i,
    )

    await asOwner(db)
    const protectedRow = await db.query(
      'select summary from public.evaluations where id = $1',
      [evaluationId],
    )
    assert.equal(protectedRow.rows[0].summary, 'protected')
  } finally {
    await asOwner(db)
    await db.close()
  }
})

test('authorized updates and manager deletes remain team-scoped', async () => {
  const db = await createDatabase()

  try {
    await asOwner(db)
    const assigned = await db.query(
      `insert into public.evaluations (club_id, team_id, coach_id, summary)
       values ($1, $2, $3, 'assigned')
       returning id`,
      [IDS.clubA, IDS.teamA, IDS.coach],
    )
    const unassigned = await db.query(
      `insert into public.evaluations (club_id, team_id, coach_id, summary)
       values ($1, $2, $3, 'unassigned')
       returning id`,
      [IDS.clubA, IDS.teamB, IDS.coach],
    )

    await setActor(db, IDS.manager)
    const updated = await db.query(
      `update public.evaluations
       set summary = 'manager updated'
       where id = $1
       returning id`,
      [assigned.rows[0].id],
    )
    const blockedUpdate = await db.query(
      `update public.evaluations
       set summary = 'manager crossed team'
       where id = $1
       returning id`,
      [unassigned.rows[0].id],
    )
    const deleted = await db.query(
      'delete from public.evaluations where id = $1 returning id',
      [assigned.rows[0].id],
    )
    const blockedDelete = await db.query(
      'delete from public.evaluations where id = $1 returning id',
      [unassigned.rows[0].id],
    )

    assert.equal(updated.rows.length, 1)
    assert.equal(blockedUpdate.rows.length, 0)
    assert.equal(deleted.rows.length, 1)
    assert.equal(blockedDelete.rows.length, 0)
  } finally {
    await asOwner(db)
    await db.close()
  }
})
