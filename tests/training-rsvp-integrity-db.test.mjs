import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'
import { PGlite } from '@electric-sql/pglite'

const migrationUrl = new URL(
  '../supabase/migrations/20260730113501_training_rsvp_integrity.sql',
  import.meta.url,
)
const migrationSql = await readFile(migrationUrl, 'utf8')
const consistencyMigrationSql = await readFile(
  new URL('../supabase/migrations/20260801122226_training_rsvp_consistency_21a.sql', import.meta.url),
  'utf8',
)

const CLUB_ID = '30000000-0000-4000-8000-000000000001'
const TEAM_ID = '30000000-0000-4000-8000-000000000002'
const ACTOR_ID = '30000000-0000-4000-8000-000000000003'
const EVENT_ID = '30000000-0000-4000-8000-000000000004'
const PLAYER_ONE_ID = '30000000-0000-4000-8000-000000000005'
const PLAYER_TWO_ID = '30000000-0000-4000-8000-000000000006'
const REQUEST_ID = '30000000-0000-4000-8000-000000000007'
const INFORMATIONAL_PLAYER_ID = '30000000-0000-4000-8000-000000000009'

async function createDatabase() {
  const db = new PGlite()

  await db.exec(`
    create schema if not exists auth;
    create role anon;
    create role authenticated;
    create role service_role;

    create function auth.uid()
    returns uuid
    language sql
    stable
    as $$
      select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid
    $$;

    create function public.training_availability_user_can_manage(uuid, uuid)
    returns boolean
    language sql
    stable
    as $$
      select coalesce(current_setting('test.training_manage_allowed', true), '') = 'true'
    $$;

    create table public.calendar_events (
      id uuid primary key,
      club_id uuid not null,
      team_id uuid,
      event_type text not null,
      cancelled_at timestamptz
    );

    create table public.training_availability_settings (
      id uuid primary key default gen_random_uuid(),
      club_id uuid not null,
      team_id uuid not null,
      calendar_event_id uuid not null unique,
      enabled boolean not null default true,
      send_days_before integer not null default 2,
      created_by uuid,
      updated_by uuid,
      created_at timestamptz not null default timezone('utc', now()),
      updated_at timestamptz not null default timezone('utc', now())
    );

    create table public.calendar_event_invites (
      id uuid primary key default gen_random_uuid(),
      club_id uuid not null,
      team_id uuid not null,
      calendar_event_id uuid not null,
      player_id uuid not null,
      invite_status text not null default 'active',
      notify_requested boolean not null default false,
      response_requirement text not null default 'informational',
      updated_by uuid,
      updated_at timestamptz not null default timezone('utc', now())
    );

    create table public.training_availability_request_players (
      id uuid primary key default gen_random_uuid(),
      request_id uuid not null,
      calendar_event_id uuid not null,
      player_id uuid not null,
      recipient_email text not null,
      recipient_type text not null default 'parent',
      status text not null default 'pending',
      constraint training_availability_request_players_email_check
        check (recipient_email <> '')
    );
  `)
  await db.exec(migrationSql)
  await db.exec(consistencyMigrationSql)
  await db.exec(`
    insert into public.calendar_events (
      id,
      club_id,
      team_id,
      event_type
    ) values (
      '${EVENT_ID}',
      '${CLUB_ID}',
      '${TEAM_ID}',
      'training'
    );

    insert into public.calendar_event_invites (
      club_id,
      team_id,
      calendar_event_id,
      player_id
    ) values
      ('${CLUB_ID}', '${TEAM_ID}', '${EVENT_ID}', '${PLAYER_ONE_ID}'),
      ('${CLUB_ID}', '${TEAM_ID}', '${EVENT_ID}', '${PLAYER_TWO_ID}');

    select set_config('request.jwt.claim.sub', '${ACTOR_ID}', false);
    select set_config('test.training_manage_allowed', 'true', false);
  `)

  return db
}

test('atomic setting command marks only current training participants response-required', async () => {
  const db = await createDatabase()
  const saved = await db.query(
    `select * from public.save_training_availability_setting_v2($1, true, 0)`,
    [EVENT_ID],
  )
  const invites = await db.query(`
    select player_id, notify_requested, response_requirement, training_availability_requested
    from public.calendar_event_invites
    order by player_id
  `)

  assert.equal(saved.rows.length, 1)
  assert.equal(saved.rows[0].enabled, true)
  assert.equal(saved.rows[0].send_days_before, 0)
  assert.equal(saved.rows[0].updated_by, ACTOR_ID)
  assert.equal(invites.rows.length, 2)
  assert.ok(invites.rows.every((row) => row.training_availability_requested === true))
  assert.ok(invites.rows.every((row) => row.notify_requested === true))
  assert.ok(invites.rows.every((row) => row.response_requirement === 'response_required'))
})

test('turning requests off preserves real invitations and returns add-only rows to informational', async () => {
  const db = await createDatabase()
  await db.query(
    `select * from public.save_training_availability_setting_v2($1, true, 2)`,
    [EVENT_ID],
  )
  await db.query(
    `insert into public.training_availability_request_players (
      request_id,
      calendar_event_id,
      player_id,
      recipient_email,
      recipient_type,
      status
    ) values ($1, $2, $3, 'parent@example.test', 'parent', 'sent')`,
    [REQUEST_ID, EVENT_ID, PLAYER_ONE_ID],
  )
  await db.query(
    `insert into public.calendar_event_invites (
      club_id,
      team_id,
      calendar_event_id,
      player_id,
      notify_requested,
      response_requirement
    ) values ($1, $2, $3, $4, true, 'informational')`,
    [CLUB_ID, TEAM_ID, EVENT_ID, INFORMATIONAL_PLAYER_ID],
  )
  await db.query(
    `select * from public.save_training_availability_setting_v2($1, false, 2)`,
    [EVENT_ID],
  )
  const invites = await db.query(`
    select player_id, notify_requested, response_requirement, training_availability_requested
    from public.calendar_event_invites
    order by player_id
  `)
  const byPlayerId = new Map(invites.rows.map((row) => [row.player_id, row]))

  assert.equal(byPlayerId.get(PLAYER_ONE_ID).notify_requested, true)
  assert.equal(byPlayerId.get(PLAYER_ONE_ID).response_requirement, 'response_required')
  assert.equal(byPlayerId.get(PLAYER_ONE_ID).training_availability_requested, true)
  assert.equal(byPlayerId.get(PLAYER_TWO_ID).notify_requested, false)
  assert.equal(byPlayerId.get(PLAYER_TWO_ID).response_requirement, 'informational')
  assert.equal(byPlayerId.get(PLAYER_TWO_ID).training_availability_requested, false)
  assert.equal(byPlayerId.get(INFORMATIONAL_PLAYER_ID).notify_requested, true)
  assert.equal(byPlayerId.get(INFORMATIONAL_PLAYER_ID).response_requirement, 'informational')
  assert.equal(byPlayerId.get(INFORMATIONAL_PLAYER_ID).training_availability_requested, false)
})

test('canonical command preserves add-without-communication for response-required Training', async () => {
  const db = await createDatabase()
  await db.query(
    `select * from public.save_training_availability_setting_v3($1, true, 3, false)`,
    [EVENT_ID],
  )
  const invites = await db.query(`
    select notify_requested, response_requirement, training_availability_requested
    from public.calendar_event_invites
  `)

  assert.ok(invites.rows.every((row) => row.notify_requested === false))
  assert.ok(invites.rows.every((row) => row.response_requirement === 'response_required'))
  assert.ok(invites.rows.every((row) => row.training_availability_requested === true))
})

test('canonical command keeps informational notification separate from response state', async () => {
  const db = await createDatabase()
  await db.query(
    `select * from public.save_training_availability_setting_v3($1, false, 2, true)`,
    [EVENT_ID],
  )
  const invites = await db.query(`
    select notify_requested, response_requirement, training_availability_requested
    from public.calendar_event_invites
  `)

  assert.ok(invites.rows.every((row) => row.notify_requested === true))
  assert.ok(invites.rows.every((row) => row.response_requirement === 'informational'))
  assert.ok(invites.rows.every((row) => row.training_availability_requested === false))
})

test('unavailable recipient state is truthful while ordinary blank recipients are rejected', async () => {
  const db = await createDatabase()

  await db.query(
    `insert into public.training_availability_request_players (
      request_id,
      calendar_event_id,
      player_id,
      recipient_email,
      recipient_type,
      status
    ) values ($1, $2, $3, '', 'unavailable', 'failed')`,
    [REQUEST_ID, EVENT_ID, PLAYER_ONE_ID],
  )

  await assert.rejects(
    db.query(
      `insert into public.training_availability_request_players (
        request_id,
        calendar_event_id,
        player_id,
        recipient_email,
        recipient_type,
        status
      ) values ($1, $2, $3, '', 'parent', 'failed')`,
      ['30000000-0000-4000-8000-000000000008', EVENT_ID, PLAYER_TWO_ID],
    ),
    /training_availability_request_players_email_check/i,
  )
})

test('cross-team or unauthorised setting commands fail closed', async () => {
  const db = await createDatabase()
  await db.exec(`select set_config('test.training_manage_allowed', 'false', false);`)

  await assert.rejects(
    db.query(
      `select * from public.save_training_availability_setting_v2($1, true, 2)`,
      [EVENT_ID],
    ),
    /do not have access/i,
  )
})
