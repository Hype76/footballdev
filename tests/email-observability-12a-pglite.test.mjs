import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'
import { PGlite } from '@electric-sql/pglite'

const migrationUrl = new URL(
  '../supabase/migrations/20260731051937_email_observability_12a.sql',
  import.meta.url,
)
const migrationSql = await readFile(migrationUrl, 'utf8')

const CLUB_ID = '40000000-0000-4000-8000-000000000001'
const TEAM_ID = '40000000-0000-4000-8000-000000000002'
const EMAIL_LOG_ID = '40000000-0000-4000-8000-000000000003'
const WORKER_ID = '40000000-0000-4000-8000-000000000004'

async function createDatabase() {
  const db = new PGlite()

  await db.exec(`
    create role anon;
    create role authenticated;
    create role service_role;

    create table public.clubs (
      id uuid primary key
    );

    create table public.teams (
      id uuid primary key
    );

    create table public.email_logs (
      id uuid primary key,
      status text not null
    );
  `)
  await db.exec(migrationSql)
  await db.exec(`
    insert into public.clubs(id) values ('${CLUB_ID}');
    insert into public.teams(id) values ('${TEAM_ID}');
    insert into public.email_logs(id, status) values ('${EMAIL_LOG_ID}', 'pending');
  `)

  return db
}

test('migration records append-only attempts and persists provider acceptance evidence', async () => {
  const db = await createDatabase()
  const telemetryInput = {
    logicalKey: `email_log:${EMAIL_LOG_ID}`,
    sourceType: 'email_log',
    sourceId: EMAIL_LOG_ID,
    emailLogId: EMAIL_LOG_ID,
    deliveryType: 'development_parent_pdf',
    clubId: CLUB_ID,
    teamId: TEAM_ID,
    recipientCount: 2,
    hasPdf: true,
    originActionAt: '2026-07-31T05:00:00.000Z',
    eligibleAt: '2026-07-31T05:00:01.000Z',
    enqueuedAt: '2026-07-31T05:00:02.000Z',
    scheduledAt: '2026-07-31T05:00:03.000Z',
    claimedAt: '2026-07-31T05:00:04.000Z',
    processingStartedAt: '2026-07-31T05:00:04.000Z',
    pdfStartedAt: '2026-07-31T05:00:04.100Z',
    pdfFinishedAt: '2026-07-31T05:00:04.600Z',
    providerRequestedAt: '2026-07-31T05:00:05.000Z',
    workerInvocationId: WORKER_ID,
  }
  const firstAttempt = await db.query(
    'select * from public.begin_email_delivery_attempt_v1($1::jsonb)',
    [JSON.stringify(telemetryInput)],
  )
  const attempt = firstAttempt.rows[0]

  assert.equal(attempt.attempt_number, 1)
  assert.equal(attempt.worker_invocation_id, WORKER_ID)

  await db.query(
    `select public.complete_email_delivery_attempt_v1(
      $1::uuid,
      $2::uuid,
      'accepted',
      'resend_provider_12a',
      'accepted',
      null,
      null,
      '2026-07-31T05:00:05.250Z'::timestamptz
    )`,
    [attempt.job_id, attempt.attempt_id],
  )

  const stored = await db.query(`
    select
      status,
      attempt_count,
      provider_message_id,
      provider_status,
      processing_duration_ms,
      pdf_duration_ms,
      provider_duration_ms,
      total_eligible_to_accept_ms
    from public.email_delivery_jobs
    where id = '${attempt.job_id}'
  `)
  assert.deepEqual(stored.rows[0], {
    attempt_count: 1,
    pdf_duration_ms: 500,
    processing_duration_ms: 1250,
    provider_duration_ms: 250,
    provider_message_id: 'resend_provider_12a',
    provider_status: 'accepted',
    status: 'provider_accepted',
    total_eligible_to_accept_ms: 4250,
  })

  const secondAttempt = await db.query(
    'select * from public.begin_email_delivery_attempt_v1($1::jsonb)',
    [JSON.stringify({
      ...telemetryInput,
      providerRequestedAt: '2026-07-31T05:01:00.000Z',
      processingStartedAt: '2026-07-31T05:01:00.000Z',
    })],
  )

  assert.equal(secondAttempt.rows[0].job_id, attempt.job_id)
  assert.equal(secondAttempt.rows[0].attempt_number, 2)

  const attempts = await db.query(`
    select attempt_number
    from public.email_delivery_attempts
    where job_id = '${attempt.job_id}'
    order by attempt_number
  `)
  assert.deepEqual(attempts.rows.map((row) => row.attempt_number), [1, 2])

  await db.close()
})

test('operational metrics are aggregate-only, null-safe, and locked to service role', async () => {
  const db = await createDatabase()
  const columns = await db.query(`
    select column_name
    from information_schema.columns
    where table_schema = 'public'
      and table_name = 'email_delivery_operational_metrics_v1'
    order by ordinal_position
  `)
  const columnNames = columns.rows.map((row) => row.column_name)

  assert.equal(columnNames.includes('recipient_email'), false)
  assert.equal(columnNames.includes('subject'), false)
  assert.equal(columnNames.includes('payload'), false)
  assert.equal(columnNames.includes('oldest_eligible_age_seconds'), true)
  assert.equal(columnNames.includes('eligibility_to_claim_p95_ms'), true)

  const metrics = await db.query(`
    select *
    from public.email_delivery_operational_metrics_v1
    where delivery_type = 'all'
  `)
  assert.equal(metrics.rows.length, 1)
  assert.equal(Number(metrics.rows[0].pending_count), 0)
  assert.equal(Number(metrics.rows[0].eligibility_to_claim_p50_ms), 0)
  assert.equal(Number(metrics.rows[0].pdf_duration_p95_ms), 0)

  const grants = await db.query(`
    select grantee, privilege_type
    from information_schema.role_table_grants
    where table_schema = 'public'
      and table_name in (
        'email_delivery_jobs',
        'email_delivery_attempts',
        'email_delivery_operational_metrics_v1'
      )
      and grantee in ('anon', 'authenticated')
  `)
  assert.equal(grants.rows.length, 0)

  await db.close()
})

test('preparation failures preserve the fact that no provider request occurred', async () => {
  const db = await createDatabase()
  const started = await db.query(
    'select * from public.begin_email_delivery_attempt_v1($1::jsonb)',
    [JSON.stringify({
      deliveryType: 'development_parent_pdf',
      eligibleAt: '2026-07-31T05:00:00.000Z',
      logicalKey: 'pdf-preparation-failure-12a',
      pdfFinishedAt: '2026-07-31T05:00:02.000Z',
      pdfStartedAt: '2026-07-31T05:00:01.000Z',
      processingStartedAt: '2026-07-31T05:00:01.000Z',
      providerRequested: false,
      recipientCount: 0,
      sourceType: 'development_pdf_preparation',
      workerInvocationId: WORKER_ID,
    })],
  )
  const attempt = started.rows[0]

  await db.query(
    `select public.complete_email_delivery_attempt_v1(
      $1::uuid,
      $2::uuid,
      'preparation_failed',
      null,
      null,
      'pdf_failure',
      'PDF_ATTACHMENT_GENERATION_FAILED',
      '2026-07-31T05:00:02.000Z'::timestamptz
    )`,
    [attempt.job_id, attempt.attempt_id],
  )

  const stored = await db.query(`
    select
      failure_category,
      provider_failed_at,
      provider_requested_at,
      provider_status,
      status
    from public.email_delivery_jobs
    where id = '${attempt.job_id}'
  `)

  assert.deepEqual(stored.rows[0], {
    failure_category: 'pdf_failure',
    provider_failed_at: null,
    provider_requested_at: null,
    provider_status: 'not_requested',
    status: 'failed',
  })

  await db.close()
})
