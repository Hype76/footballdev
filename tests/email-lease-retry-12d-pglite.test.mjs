import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { test } from 'node:test'
import { PGlite } from '@electric-sql/pglite'

const observabilitySql = await readFile(
  new URL('../supabase/migrations/20260731051937_email_observability_12a.sql', import.meta.url),
  'utf8',
)
const migrationSql = await readFile(
  new URL('../supabase/migrations/20260731095100_email_lease_retry_12d.sql', import.meta.url),
  'utf8',
)

const CLUB_ID = '12d00000-0000-4000-8000-000000000001'
const TEAM_ID = '12d00000-0000-4000-8000-000000000002'
const HISTORICAL_QUEUE_ID = '12d00000-0000-4000-8000-000000000003'
const HISTORICAL_LOG_ID = '12d00000-0000-4000-8000-000000000004'
const NEW_QUEUE_ID = '12d00000-0000-4000-8000-000000000005'
const NEW_LOG_ID = '12d00000-0000-4000-8000-000000000006'
const WORKER_A = '12d00000-0000-4000-8000-000000000010'
const WORKER_B = '12d00000-0000-4000-8000-000000000011'
const WORKER_C = '12d00000-0000-4000-8000-000000000012'

async function createDatabase() {
  const db = new PGlite()
  await db.exec(`
    create role anon;
    create role authenticated;
    create role service_role;
    create table public.clubs(id uuid primary key);
    create table public.teams(id uuid primary key);
    create table public.email_logs(
      id uuid primary key default gen_random_uuid(),
      dedupe_key text unique,
      idempotency_key text,
      to_email text not null,
      subject text,
      status text not null default 'pending' check (status in ('pending', 'sent', 'failed')),
      attempts integer not null default 0,
      last_error text,
      payload jsonb not null default '{}'::jsonb,
      is_processing boolean not null default false,
      next_retry_at timestamptz,
      created_at timestamptz not null default timezone('utc', now()),
      updated_at timestamptz not null default timezone('utc', now())
    );
    create table public.scheduled_email_queue(
      id uuid primary key default gen_random_uuid(),
      club_id uuid not null references public.clubs(id),
      team_id uuid references public.teams(id),
      created_by uuid,
      created_by_email text not null default '',
      to_email text not null,
      subject text not null default '',
      status text not null default 'scheduled'
        check (status in ('scheduled', 'sending', 'sent', 'failed')),
      scheduled_at timestamptz not null,
      payload jsonb not null default '{}'::jsonb,
      last_error text,
      attempts integer not null default 0,
      created_at timestamptz not null default timezone('utc', now()),
      updated_at timestamptz not null default timezone('utc', now())
    );
    insert into public.clubs(id) values ('${CLUB_ID}');
    insert into public.teams(id) values ('${TEAM_ID}');
    insert into public.scheduled_email_queue(
      id, club_id, team_id, to_email, status, scheduled_at, attempts
    ) values (
      '${HISTORICAL_QUEUE_ID}', '${CLUB_ID}', '${TEAM_ID}',
      'legacy@example.invalid', 'failed', timezone('utc', now()) - interval '1 day', 1
    );
    insert into public.email_logs(
      id, to_email, status, attempts, next_retry_at
    ) values (
      '${HISTORICAL_LOG_ID}', 'legacy@example.invalid', 'failed', 1,
      timezone('utc', now()) - interval '1 day'
    );
  `)
  await db.exec(observabilitySql)
  await db.exec(migrationSql)
  return db
}

test('atomic leases block overlap, expire, and allow one crash reclaim', async () => {
  const db = await createDatabase()
  await db.exec(`
    insert into public.scheduled_email_queue(
      id, club_id, team_id, to_email, status, scheduled_at
    ) values (
      '${NEW_QUEUE_ID}', '${CLUB_ID}', '${TEAM_ID}',
      'new@example.invalid', 'scheduled', timezone('utc', now()) - interval '1 minute'
    );
  `)

  const [claimA, claimB] = await Promise.all([
    db.query(
      'select id, lease_owner, claim_attempt from public.claim_scheduled_email_job_v1($1, $2, 120, false)',
      [NEW_QUEUE_ID, WORKER_A],
    ),
    db.query(
      'select id, lease_owner, claim_attempt from public.claim_scheduled_email_job_v1($1, $2, 120, false)',
      [NEW_QUEUE_ID, WORKER_B],
    ),
  ])
  assert.equal(claimA.rows.length + claimB.rows.length, 1)

  const activeSteal = await db.query(
    'select id from public.claim_scheduled_email_job_v1($1, $2, 120, false)',
    [NEW_QUEUE_ID, WORKER_C],
  )
  assert.equal(activeSteal.rows.length, 0)

  await db.query(
    `update public.scheduled_email_queue
     set lease_expires_at = timezone('utc', now()) - interval '1 second'
     where id = $1`,
    [NEW_QUEUE_ID],
  )
  const [reclaimB, reclaimC] = await Promise.all([
    db.query(
      'select id, claim_attempt from public.claim_scheduled_email_job_v1($1, $2, 120, false)',
      [NEW_QUEUE_ID, WORKER_B],
    ),
    db.query(
      'select id, claim_attempt from public.claim_scheduled_email_job_v1($1, $2, 120, false)',
      [NEW_QUEUE_ID, WORKER_C],
    ),
  ])
  assert.equal(reclaimB.rows.length + reclaimC.rows.length, 1)
  assert.equal(Number((reclaimB.rows[0] || reclaimC.rows[0]).claim_attempt), 2)
  await db.close()
})

test('cutover excludes historical failures and leases only new due retry work', async () => {
  const db = await createDatabase()
  const historical = await db.query(`
    select retry_enabled, legacy_review_required
    from public.email_logs
    where id = '${HISTORICAL_LOG_ID}'
  `)
  assert.deepEqual(historical.rows[0], {
    legacy_review_required: true,
    retry_enabled: false,
  })

  await db.exec(`
    insert into public.email_logs(
      id, idempotency_key, to_email, status, attempts, next_retry_at
    ) values (
      '${NEW_LOG_ID}', 'new-log-12d', 'new@example.invalid', 'failed', 1,
      timezone('utc', now()) - interval '1 second'
    );
  `)
  const claimed = await db.query(
    'select id from public.claim_email_retry_jobs_v1($1, 120, 25)',
    [WORKER_A],
  )
  assert.deepEqual(claimed.rows.map((row) => row.id), [NEW_LOG_ID])
  await db.close()
})

test('provider events are idempotent and keep accepted separate from delivered', async () => {
  const db = await createDatabase()
  await db.exec(`
    insert into public.email_logs(
      id, idempotency_key, to_email, status, provider_message_id,
      delivery_state, provider_accepted_at
    ) values (
      '${NEW_LOG_ID}', 'provider-log-12d', 'new@example.invalid', 'sent',
      'provider_12d', 'provider_accepted', timezone('utc', now())
    );
    insert into public.scheduled_email_queue(
      id, club_id, team_id, to_email, status, scheduled_at,
      provider_message_id, delivery_state, provider_accepted_at
    ) values (
      '${NEW_QUEUE_ID}', '${CLUB_ID}', '${TEAM_ID}', 'new@example.invalid',
      'sent', timezone('utc', now()), 'provider_12d', 'provider_accepted',
      timezone('utc', now())
    );
  `)
  const deferred = await db.query(
    `select public.record_email_provider_event_v1(
      'event_deferred_12d', 'provider_12d', 'email.delivery_delayed',
      timezone('utc', now()), repeat('d', 64)
    ) as inserted`,
  )
  assert.equal(deferred.rows[0].inserted, true)
  const deferredStates = await db.query(`
    select delivery_state::text as delivery_state
    from public.email_logs
    where id = '${NEW_LOG_ID}'
    union all
    select delivery_state::text
    from public.scheduled_email_queue
    where id = '${NEW_QUEUE_ID}'
  `)
  assert.deepEqual(
    deferredStates.rows.map((row) => row.delivery_state),
    ['deferred', 'deferred'],
  )

  const first = await db.query(
    `select public.record_email_provider_event_v1(
      'event_12d', 'provider_12d', 'email.delivered',
      timezone('utc', now()), repeat('a', 64)
    ) as inserted`,
  )
  const duplicate = await db.query(
    `select public.record_email_provider_event_v1(
      'event_12d', 'provider_12d', 'email.delivered',
      timezone('utc', now()), repeat('a', 64)
    ) as inserted`,
  )
  assert.equal(first.rows[0].inserted, true)
  assert.equal(duplicate.rows[0].inserted, false)

  const states = await db.query(`
    select delivery_state::text as delivery_state
    from public.email_logs
    where id = '${NEW_LOG_ID}'
    union all
    select delivery_state::text
    from public.scheduled_email_queue
    where id = '${NEW_QUEUE_ID}'
  `)
  assert.deepEqual(states.rows.map((row) => row.delivery_state), ['delivered', 'delivered'])
  await db.close()
})
