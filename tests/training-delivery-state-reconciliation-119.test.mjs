import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'
import { PGlite } from '@electric-sql/pglite'

const migrationUrl = new URL('../supabase/migrations/20260827103500_training_delivery_state_reconciliation.sql', import.meta.url)
const processorUrl = new URL('../netlify/functions/process-scheduled-emails.js', import.meta.url)

const IDS = {
  acceptedLog: '10000000-0000-4000-8000-000000000001',
  acceptedPlayer: '20000000-0000-4000-8000-000000000001',
  acceptedQueue: '30000000-0000-4000-8000-000000000001',
  deliveredLog: '10000000-0000-4000-8000-000000000002',
  deliveredPlayer: '20000000-0000-4000-8000-000000000002',
  deliveredQueue: '30000000-0000-4000-8000-000000000002',
  untouchedPlayer: '20000000-0000-4000-8000-000000000003',
  untouchedQueue: '30000000-0000-4000-8000-000000000003',
  request: '40000000-0000-4000-8000-000000000001',
  playerOne: '50000000-0000-4000-8000-000000000001',
  playerTwo: '50000000-0000-4000-8000-000000000002',
  playerThree: '50000000-0000-4000-8000-000000000003',
}

async function createDatabase() {
  const db = new PGlite()
  await db.exec(`
    create schema if not exists public;
    create type public.email_delivery_state_v1 as enum (
      'scheduled', 'queued', 'processing', 'provider_accepted', 'delivered',
      'deferred', 'bounced', 'complained', 'failed', 'retrying', 'cancelled', 'suppressed'
    );
    create table public.scheduled_email_queue (
      id uuid primary key,
      status text not null,
      delivery_state public.email_delivery_state_v1 not null,
      provider_message_id text,
      provider_accepted_at timestamptz,
      provider_delivered_at timestamptz,
      last_error text,
      failure_category text,
      safe_error_code text,
      next_retry_at timestamptz,
      terminal_at timestamptz,
      lease_owner text,
      leased_at timestamptz,
      lease_expires_at timestamptz
    );
    create table public.training_availability_request_players (
      id uuid primary key,
      request_id uuid not null,
      player_id uuid not null,
      email_queue_id uuid,
      status text not null,
      email_sent_at timestamptz,
      last_error text
    );
    create table public.training_availability_responses (
      id uuid primary key,
      request_id uuid not null,
      player_id uuid not null
    );
    create table public.email_logs (
      id uuid primary key,
      payload jsonb not null default '{}'::jsonb,
      provider_message_id text,
      delivery_state public.email_delivery_state_v1 not null,
      provider_accepted_at timestamptz,
      provider_delivered_at timestamptz,
      created_at timestamptz not null,
      updated_at timestamptz not null
    );
  `)
  return db
}

test('provider-backed reconciliation restores exact Training delivery state without deleting or resending', async () => {
  const db = await createDatabase()
  try {
    await db.query(`
      insert into public.scheduled_email_queue
        (id, status, delivery_state, last_error, failure_category, safe_error_code, next_retry_at, lease_owner)
      values
        ($1, 'failed', 'cancelled', 'authority changed', 'cancelled', 'stale', now(), 'old-worker'),
        ($2, 'failed', 'cancelled', 'no provider proof', 'cancelled', 'stale', now(), 'old-worker'),
        ($3, 'failed', 'cancelled', 'lease reclaimed', 'cancelled', 'stale', now(), 'old-worker')
    `, [IDS.acceptedQueue, IDS.untouchedQueue, IDS.deliveredQueue])
    await db.query(`
      insert into public.training_availability_request_players
        (id, request_id, player_id, email_queue_id, status, last_error)
      values
        ($1, $2, $3, $4, 'cancelled', 'authority changed'),
        ($5, $2, $6, $7, 'failed', 'no provider proof'),
        ($8, $2, $9, $10, 'cancelled', 'lease reclaimed')
    `, [
      IDS.acceptedPlayer, IDS.request, IDS.playerOne, IDS.acceptedQueue,
      IDS.untouchedPlayer, IDS.playerTwo, IDS.untouchedQueue,
      IDS.deliveredPlayer, IDS.playerThree, IDS.deliveredQueue,
    ])
    await db.query(`
      insert into public.training_availability_responses(id, request_id, player_id)
      values ('60000000-0000-4000-8000-000000000001', $1, $2)
    `, [IDS.request, IDS.playerThree])
    await db.query(`
      insert into public.email_logs
        (id, payload, provider_message_id, delivery_state, provider_accepted_at, provider_delivered_at, created_at, updated_at)
      values
        ($1, jsonb_build_object('trainingInvitation', jsonb_build_object('requestPlayerId', $2::text)), 'provider-accepted-1', 'provider_accepted', now() - interval '2 minutes', null, now() - interval '3 minutes', now() - interval '2 minutes'),
        ($3, jsonb_build_object('trainingInvitation', jsonb_build_object('requestPlayerId', $4::text)), 'provider-delivered-2', 'delivered', now() - interval '3 minutes', now() - interval '1 minute', now() - interval '4 minutes', now() - interval '1 minute')
    `, [IDS.acceptedLog, IDS.acceptedPlayer, IDS.deliveredLog, IDS.deliveredPlayer])

    const beforeCounts = await db.query(`
      select
        (select count(*)::int from public.scheduled_email_queue) as queue_count,
        (select count(*)::int from public.training_availability_request_players) as request_player_count,
        (select count(*)::int from public.training_availability_responses) as response_count
    `)
    await db.exec(await readFile(migrationUrl, 'utf8'))
    const afterCounts = await db.query(`
      select
        (select count(*)::int from public.scheduled_email_queue) as queue_count,
        (select count(*)::int from public.training_availability_request_players) as request_player_count,
        (select count(*)::int from public.training_availability_responses) as response_count
    `)
    assert.deepEqual(afterCounts.rows, beforeCounts.rows)

    const queues = await db.query(`
      select id::text, status, delivery_state::text, provider_message_id, last_error
      from public.scheduled_email_queue
      order by id
    `)
    assert.deepEqual(queues.rows, [
      { delivery_state: 'provider_accepted', id: IDS.acceptedQueue, last_error: null, provider_message_id: 'provider-accepted-1', status: 'sent' },
      { delivery_state: 'delivered', id: IDS.deliveredQueue, last_error: null, provider_message_id: 'provider-delivered-2', status: 'sent' },
      { delivery_state: 'cancelled', id: IDS.untouchedQueue, last_error: 'no provider proof', provider_message_id: null, status: 'failed' },
    ])
    const recipients = await db.query(`
      select id::text, status, email_sent_at is not null as has_email_sent_at, last_error
      from public.training_availability_request_players
      order by id
    `)
    assert.deepEqual(recipients.rows, [
      { email_sent_at: true, has_email_sent_at: true, id: IDS.acceptedPlayer, last_error: null, status: 'sent' },
      { email_sent_at: true, has_email_sent_at: true, id: IDS.deliveredPlayer, last_error: null, status: 'responded' },
      { email_sent_at: false, has_email_sent_at: false, id: IDS.untouchedPlayer, last_error: 'no provider proof', status: 'failed' },
    ].map(({ email_sent_at, ...row }) => row))
  } finally {
    await db.close()
  }
})

test('scheduled processor records provider acceptance before slower follow-up work and retries app push without resending email', async () => {
  const source = await readFile(processorUrl, 'utf8')
  const sendIndex = source.indexOf('const sendResult = await sendPreparedParentEmail')
  const acceptedIndex = source.indexOf('providerAcceptance = await markScheduledEmailProviderAccepted', sendIndex)
  const communicationIndex = source.indexOf('await markScheduledParentPortalInviteSent', acceptedIndex)
  assert.ok(sendIndex >= 0)
  assert.ok(acceptedIndex > sendIndex)
  assert.ok(communicationIndex > acceptedIndex)
  assert.match(source, /retryProviderAcceptedParentAppNotification\(lockedRow, workerInvocationId\)/)
  assert.match(source, /providerAcceptance[\s\S]*post_provider_processing_incomplete/)
})
