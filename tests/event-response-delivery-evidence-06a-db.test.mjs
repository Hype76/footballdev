import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'
import { PGlite } from '@electric-sql/pglite'

const migrationUrl = new URL(
  '../supabase/migrations/20260730105121_event_response_delivery_evidence.sql',
  import.meta.url,
)
const truthMigrationUrl = new URL(
  '../supabase/migrations/20260827144500_event_delivery_pre_provider_truth.sql',
  import.meta.url,
)
const migrationSql = `${await readFile(migrationUrl, 'utf8')}\n${await readFile(truthMigrationUrl, 'utf8')}`

const CLUB_ID = '10000000-0000-4000-8000-000000000001'
const TEAM_ID = '10000000-0000-4000-8000-000000000002'
const ACTOR_ID = '10000000-0000-4000-8000-000000000003'
const CALENDAR_ID = '10000000-0000-4000-8000-000000000004'
const OTHER_CALENDAR_ID = '10000000-0000-4000-8000-000000000005'
const PLAYER_ID = '10000000-0000-4000-8000-000000000006'
const BLOCKED_PLAYER_ID = '10000000-0000-4000-8000-000000000007'
const BLOCKED_QUEUE_ID = '10000000-0000-4000-8000-000000000008'

async function createDatabase() {
  const db = new PGlite()

  await db.exec(`
    create schema if not exists auth;
    create role anon;
    create role authenticated;

    create function auth.uid()
    returns uuid
    language sql
    stable
    as $$
      select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid
    $$;

    create function public.current_user_can_access_team(uuid, uuid)
    returns boolean
    language sql
    stable
    as $$
      select coalesce(current_setting('test.event_delivery_allowed', true), '') = 'true'
    $$;

    create table public.calendar_events (
      id uuid primary key,
      club_id uuid not null,
      team_id uuid,
      cancelled_at timestamptz
    );

    create table public.match_days (
      id uuid primary key,
      club_id uuid not null,
      team_id uuid,
      deleted_at timestamptz
    );

    create table public.assessment_sessions (
      id uuid primary key,
      club_id uuid not null,
      team_id uuid
    );

    create table public.calendar_event_notification_events (
      id uuid primary key,
      club_id uuid not null,
      team_id uuid,
      calendar_event_id uuid,
      match_day_id uuid,
      player_id uuid,
      recipient_email text not null,
      status text not null,
      last_error text,
      requested_at timestamptz not null,
      created_at timestamptz not null,
      updated_at timestamptz not null
    );

    create table public.scheduled_email_queue (
      id uuid primary key,
      club_id uuid not null,
      delivery_state text not null,
      attempts integer not null default 0,
      payload jsonb not null default '{}'::jsonb,
      provider_message_id text,
      provider_accepted_at timestamptz
    );

    alter table public.calendar_event_notification_events
      add column email_queue_id uuid;
  `)
  await db.exec(migrationSql)
  await db.exec(`
    insert into public.calendar_events (id, club_id, team_id)
    values
      ('${CALENDAR_ID}', '${CLUB_ID}', '${TEAM_ID}'),
      ('${OTHER_CALENDAR_ID}', '${CLUB_ID}', '${TEAM_ID}');

    insert into public.calendar_event_notification_events (
      id,
      club_id,
      team_id,
      calendar_event_id,
      player_id,
      recipient_email,
      status,
      last_error,
      requested_at,
      created_at,
      updated_at
    )
    values
      (
        '20000000-0000-4000-8000-000000000001',
        '${CLUB_ID}',
        '${TEAM_ID}',
        '${CALENDAR_ID}',
        '${PLAYER_ID}',
        'private-recipient@example.invalid',
        'failed',
        'Private provider detail',
        '2026-07-30T10:00:00Z',
        '2026-07-30T10:00:00Z',
        '2026-07-30T10:01:00Z'
      ),
      (
        '20000000-0000-4000-8000-000000000002',
        '${CLUB_ID}',
        '${TEAM_ID}',
        '${OTHER_CALENDAR_ID}',
        '${PLAYER_ID}',
        'other-private-recipient@example.invalid',
        'sent',
        null,
        '2026-07-30T10:00:00Z',
        '2026-07-30T10:00:00Z',
        '2026-07-30T10:01:00Z'
      ),
      (
        '20000000-0000-4000-8000-000000000003',
        '${CLUB_ID}',
        '${TEAM_ID}',
        '${CALENDAR_ID}',
        '${BLOCKED_PLAYER_ID}',
        'blocked-private-recipient@example.invalid',
        'failed',
        'Actionable invitation preparation failed closed.',
        '2026-08-27T13:06:25Z',
        '2026-08-27T13:06:25Z',
        '2026-08-27T13:06:25Z'
      );

    update public.calendar_event_notification_events
    set email_queue_id = '${BLOCKED_QUEUE_ID}'
    where id = '20000000-0000-4000-8000-000000000003';

    insert into public.scheduled_email_queue (
      id,
      club_id,
      delivery_state,
      attempts,
      payload
    ) values (
      '${BLOCKED_QUEUE_ID}',
      '${CLUB_ID}',
      'scheduled',
      0,
      '{"calendarActionableInvitationBlocked": true}'::jsonb
    );

    select set_config('request.jwt.claim.sub', '${ACTOR_ID}', false);
  `)

  return db
}

test('delivery evidence is exact-event scoped and strips private recipient data', async () => {
  const db = await createDatabase()
  await db.exec(`select set_config('test.event_delivery_allowed', 'true', false);`)

  const result = await db.query(
    `select * from public.get_event_response_delivery_evidence('calendar', $1)`,
    [CALENDAR_ID],
  )

  assert.equal(result.rows.length, 2)
  const providerFailure = result.rows.find((row) => row.player_id === PLAYER_ID)
  const blockedBeforeProvider = result.rows.find((row) => row.player_id === BLOCKED_PLAYER_ID)
  assert.equal(providerFailure.status, 'failed')
  assert.equal(providerFailure.last_error, 'Delivery issue')
  assert.equal(blockedBeforeProvider.status, 'not_sent')
  assert.equal(blockedBeforeProvider.last_error, '')
  assert.equal(Object.hasOwn(providerFailure, 'recipient_email'), false)
  assert.doesNotMatch(JSON.stringify(result.rows), /private-recipient|provider detail/i)
})

test('cross-scope access and unsupported event sources fail closed', async () => {
  const db = await createDatabase()
  await db.exec(`select set_config('test.event_delivery_allowed', 'false', false);`)

  await assert.rejects(
    db.query(
      `select * from public.get_event_response_delivery_evidence('calendar', $1)`,
      [CALENDAR_ID],
    ),
    /not authorised/i,
  )
  await db.exec(`select set_config('test.event_delivery_allowed', 'true', false);`)
  await assert.rejects(
    db.query(
      `select * from public.get_event_response_delivery_evidence('unsupported', $1)`,
      [CALENDAR_ID],
    ),
    /supported event source/i,
  )
})

test('migration keeps the private ledger ungranted and exposes only the narrow RPC', () => {
  assert.match(
    migrationSql,
    /revoke all on function public\.get_event_response_delivery_evidence\(text, uuid\) from public/i,
  )
  assert.match(
    migrationSql,
    /grant execute on function public\.get_event_response_delivery_evidence\(text, uuid\) to authenticated/i,
  )
  assert.doesNotMatch(
    migrationSql,
    /grant\s+select\s+on\s+(table\s+)?public\.calendar_event_notification_events/i,
  )
})
