import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { test } from 'node:test'
import { PGlite } from '@electric-sql/pglite'

const migration = await readFile(
  new URL('../supabase/migrations/20260822205242_calendar_parent_scope_rpc_contract_repair.sql', import.meta.url),
  'utf8',
)

const ACTOR_ID = '10000000-0000-4000-8000-000000000001'
const CLUB_ID = '20000000-0000-4000-8000-000000000001'
const TEAM_ID = '30000000-0000-4000-8000-000000000001'
const OTHER_TEAM_ID = '30000000-0000-4000-8000-000000000002'
const WHOLE_TEAM_MATCH_ID = '40000000-0000-4000-8000-000000000001'
const INVOLVED_MATCH_ID = '40000000-0000-4000-8000-000000000002'

async function createFixtureDatabase() {
  const db = new PGlite()

  await db.exec(`
    create role anon;
    create role authenticated;
    create role service_role;
    create schema auth;
    create function auth.uid() returns uuid language sql stable
      as $$ select '${ACTOR_ID}'::uuid $$;

    create table public.users (
      id uuid primary key,
      club_id uuid,
      role text,
      status text,
      role_rank integer,
      display_name text,
      name text,
      email text
    );
    create table public.calendar_events (
      id uuid primary key,
      club_id uuid,
      team_id uuid,
      parent_audience text,
      parent_visible boolean
    );
    create table public.match_days (
      id uuid primary key,
      club_id uuid,
      team_id uuid,
      parent_audience text,
      parent_visible boolean
    );
    create table public.team_staff (team_id uuid, user_id uuid);
    create table public.players (
      id uuid primary key,
      club_id uuid,
      team_id uuid,
      status text,
      section text
    );
    create table public.parent_player_links (
      id uuid primary key,
      club_id uuid,
      team_id uuid,
      player_id uuid,
      status text,
      created_at timestamptz,
      auth_user_id uuid,
      email text
    );
    create table public.calendar_event_invites (
      club_id uuid,
      team_id uuid,
      calendar_event_id uuid,
      assessment_session_id uuid,
      match_day_id uuid,
      player_id uuid,
      parent_link_id uuid,
      player_status_at_invite text,
      recipient_type text,
      parent_contact_name text,
      parent_contact_email text,
      player_contact_email text,
      recipient_contacts jsonb,
      invite_status text,
      notify_requested boolean,
      response_requirement text,
      cancelled_at timestamptz,
      created_by uuid,
      created_by_name text,
      created_by_email text,
      updated_by uuid,
      updated_by_name text,
      updated_by_email text,
      responded_at timestamptz,
      unique nulls not distinct (
        club_id,
        player_id,
        calendar_event_id,
        assessment_session_id,
        match_day_id
      )
    );
    create table public.audit_logs (
      club_id uuid,
      actor_id uuid,
      action text,
      entity_type text,
      entity_id uuid,
      metadata jsonb
    );
  `)

  await db.exec(migration)
  await db.exec(`
    insert into public.users (
      id, club_id, role, status, role_rank, display_name, name, email
    ) values (
      '${ACTOR_ID}', '${CLUB_ID}', 'coach', 'active', 20, 'Review Coach', 'Review Coach', 'review@example.test'
    );
    insert into public.team_staff values ('${TEAM_ID}', '${ACTOR_ID}');
    insert into public.match_days values
      ('${WHOLE_TEAM_MATCH_ID}', '${CLUB_ID}', '${TEAM_ID}', 'all_team_parents', true),
      ('${INVOLVED_MATCH_ID}', '${CLUB_ID}', '${TEAM_ID}', 'involved_players', true);
    insert into public.players values
      ('50000000-0000-4000-8000-000000000001', '${CLUB_ID}', '${TEAM_ID}', 'active', 'Squad'),
      ('50000000-0000-4000-8000-000000000002', '${CLUB_ID}', '${TEAM_ID}', 'active', 'squad'),
      ('50000000-0000-4000-8000-000000000003', '${CLUB_ID}', '${TEAM_ID}', 'active', 'Trial'),
      ('50000000-0000-4000-8000-000000000004', '${CLUB_ID}', '${TEAM_ID}', 'archived', 'Squad'),
      ('50000000-0000-4000-8000-000000000005', '${CLUB_ID}', '${OTHER_TEAM_ID}', 'active', 'Squad');
  `)

  return db
}

test('whole squad scope materializes Squad players and optional Trial players without the legacy conflict', async () => {
  const db = await createFixtureDatabase()

  try {
    const withoutTrials = await db.query(`
      select public.sync_calendar_event_parent_scope_v2(
        null, false, '${WHOLE_TEAM_MATCH_ID}', '{}'::uuid[], 'whole_squad'
      ) as result
    `)
    const withTrials = await db.query(`
      select public.sync_calendar_event_parent_scope_v2(
        null, true, '${WHOLE_TEAM_MATCH_ID}', '{}'::uuid[], 'whole_squad'
      ) as result
    `)
    const activeInvites = await db.query(`
      select count(*)::integer as count
      from public.calendar_event_invites
      where match_day_id = '${WHOLE_TEAM_MATCH_ID}'
        and invite_status = 'active'
    `)

    assert.equal(withoutTrials.rows[0].result.portalRecordCount, 2)
    assert.equal(withoutTrials.rows[0].result.selectedPlayerCount, 2)
    assert.equal(withTrials.rows[0].result.portalRecordCount, 3)
    assert.equal(withTrials.rows[0].result.selectedPlayerCount, 3)
    assert.equal(activeInvites.rows[0].count, 3)
  } finally {
    await db.close()
  }
})

test('manual involved-player scope materializes the exact Squad calendar players', async () => {
  const db = await createFixtureDatabase()

  try {
    const synced = await db.query(`
      select public.sync_calendar_event_parent_scope_v2(
        null,
        false,
        '${INVOLVED_MATCH_ID}',
        array[
          '50000000-0000-4000-8000-000000000001'::uuid,
          '50000000-0000-4000-8000-000000000002'::uuid
        ],
        'manual'
      ) as result
    `)
    const activeInvites = await db.query(`
      select count(*)::integer as count
      from public.calendar_event_invites
      where match_day_id = '${INVOLVED_MATCH_ID}'
        and invite_status = 'active'
    `)

    assert.equal(synced.rows[0].result.portalRecordCount, 2)
    assert.equal(synced.rows[0].result.selectedPlayerCount, 2)
    assert.equal(activeInvites.rows[0].count, 2)
  } finally {
    await db.close()
  }
})

test('selection mode and player scope injection remain fail closed', async () => {
  const db = await createFixtureDatabase()

  try {
    await assert.rejects(
      () => db.query(`
        select public.sync_calendar_event_parent_scope_v2(
          null,
          false,
          '${WHOLE_TEAM_MATCH_ID}',
          array['50000000-0000-4000-8000-000000000005'::uuid],
          'manual'
        )
      `),
      /requires server-resolved whole squad scope/,
    )
    await assert.rejects(
      () => db.query(`
        select public.sync_calendar_event_parent_scope_v2(
          null,
          false,
          '${WHOLE_TEAM_MATCH_ID}',
          array['50000000-0000-4000-8000-000000000001'::uuid],
          'whole_squad'
        )
      `),
      /resolved by the server/,
    )
    await assert.rejects(
      () => db.query(`
        select public.sync_calendar_event_parent_scope_v2(
          null, false, '${INVOLVED_MATCH_ID}', '{}'::uuid[], 'whole_squad'
        )
      `),
      /requires manual player scope/,
    )
  } finally {
    await db.close()
  }
})

test('the canonical materializer is internal and v2 remains the authenticated entry point', async () => {
  const db = await createFixtureDatabase()

  try {
    const privileges = await db.query(`
      select
        has_function_privilege(
          'authenticated',
          'public.sync_calendar_event_parent_scope(uuid,uuid,uuid[])',
          'execute'
        ) as authenticated_internal,
        has_function_privilege(
          'authenticated',
          'public.sync_calendar_event_parent_scope_v2(uuid,boolean,uuid,uuid[],text)',
          'execute'
        ) as authenticated_v2,
        has_function_privilege(
          'anon',
          'public.sync_calendar_event_parent_scope_v2(uuid,boolean,uuid,uuid[],text)',
          'execute'
        ) as anon_v2
    `)

    assert.deepEqual(privileges.rows[0], {
      authenticated_internal: false,
      authenticated_v2: true,
      anon_v2: false,
    })
  } finally {
    await db.close()
  }
})
