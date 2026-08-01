import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { test } from 'node:test'
import { PGlite } from '@electric-sql/pglite'

const migrationUrl = new URL(
  '../supabase/migrations/20260801192646_training_availability_runtime_repair_05.sql',
  import.meta.url,
)

async function createDatabase() {
  const db = new PGlite()
  await db.exec(`
    create role anon;
    create role authenticated;
    create role service_role bypassrls;
    create table public.clubs (id uuid primary key);
    create table public.teams (id uuid primary key, club_id uuid not null references public.clubs(id));
    create table public.calendar_events (
      id uuid primary key,
      club_id uuid not null references public.clubs(id),
      team_id uuid references public.teams(id),
      event_type text not null,
      starts_at timestamptz not null,
      ends_at timestamptz not null,
      recurrence_frequency text,
      recurrence_until date,
      cancelled_at timestamptz
    );
    create table public.training_availability_settings (
      id uuid primary key,
      club_id uuid not null references public.clubs(id),
      team_id uuid not null references public.teams(id),
      calendar_event_id uuid not null references public.calendar_events(id),
      enabled boolean not null,
      send_days_before integer not null
    );
    create table public.training_availability_requests (
      id uuid primary key,
      club_id uuid not null references public.clubs(id),
      team_id uuid not null references public.teams(id),
      setting_id uuid not null references public.training_availability_settings(id),
      calendar_event_id uuid not null references public.calendar_events(id),
      occurrence_date date not null,
      occurrence_starts_at timestamptz not null,
      occurrence_ends_at timestamptz not null,
      send_at timestamptz not null,
      status text not null
    );
    create table public.training_availability_request_players (
      id uuid primary key default gen_random_uuid(),
      request_id uuid not null references public.training_availability_requests(id)
    );
    grant insert, update on public.training_availability_settings to authenticated;

    insert into public.clubs values ('10000000-0000-4000-8000-000000000001');
    insert into public.teams values (
      '20000000-0000-4000-8000-000000000001',
      '10000000-0000-4000-8000-000000000001'
    );
  `)
  await db.exec(await readFile(migrationUrl, 'utf8'))
  return db
}

async function insertSetting(db, suffix) {
  const eventId = `30000000-0000-4000-8000-${String(suffix).padStart(12, '0')}`
  const settingId = `40000000-0000-4000-8000-${String(suffix).padStart(12, '0')}`
  await db.query(`
    insert into public.calendar_events (
      id, club_id, team_id, event_type, starts_at, ends_at,
      recurrence_frequency, recurrence_until
    ) values ($1, $2, $3, 'training', now() + interval '1 day',
      now() + interval '1 day 1 hour', 'weekly', current_date + 30)
  `, [
    eventId,
    '10000000-0000-4000-8000-000000000001',
    '20000000-0000-4000-8000-000000000001',
  ])
  await db.query(`
    insert into public.training_availability_settings (
      id, club_id, team_id, calendar_event_id, enabled, send_days_before
    ) values ($1, $2, $3, $4, true, 3)
  `, [
    settingId,
    '10000000-0000-4000-8000-000000000001',
    '20000000-0000-4000-8000-000000000001',
    eventId,
  ])
  return { eventId, settingId }
}

test('migration exposes only service-role claims with atomic leases and safe search paths', async () => {
  const migration = await readFile(migrationUrl, 'utf8')

  assert.match(migration, /force row level security/i)
  assert.match(migration, /for update skip locked/i)
  assert.match(migration, /claim_expires_at/i)
  assert.match(migration, /revision bigint not null default 1/i)
  assert.match(migration, /set search_path = ''/i)
  assert.match(migration, /security definer[\s\S]*queue_training_availability_recurrence_work_v1/i)
  assert.match(migration, /security definer[\s\S]*queue_training_availability_request_work_v1/i)
  assert.match(migration, /grant execute on function public\.claim_training_availability_processor_work_v1[\s\S]*to service_role/i)
  assert.doesNotMatch(migration, /grant (select|insert|update|delete)[^;]*to (anon|authenticated)/i)
  assert.doesNotMatch(migration, /grant execute[^;]*to (anon|authenticated)/i)
})

test('concurrent workers claim distinct due rows and expired leases recover', async () => {
  const db = await createDatabase()
  try {
    for (let index = 1; index <= 5; index += 1) {
      await insertSetting(db, index)
    }

    const claims = await Promise.all(Array.from({ length: 5 }, (_, index) => db.query(
      'select * from public.claim_training_availability_processor_work_v1($1, 1, 45)',
      [`50000000-0000-4000-8000-${String(index + 1).padStart(12, '0')}`],
    )))
    const claimedIds = claims.flatMap((result) => result.rows.map((row) => row.id))

    assert.equal(claimedIds.length, 5)
    assert.equal(new Set(claimedIds).size, 5)

    const noWork = await db.query(
      'select * from public.claim_training_availability_processor_work_v1($1, 1, 45)',
      ['60000000-0000-4000-8000-000000000001'],
    )
    assert.equal(noWork.rows.length, 0)

    await db.query(
      "update public.training_availability_processor_work set claim_expires_at = now() - interval '1 second' where id = $1",
      [claimedIds[0]],
    )
    const recovered = await db.query(
      'select * from public.claim_training_availability_processor_work_v1($1, 1, 45)',
      ['60000000-0000-4000-8000-000000000002'],
    )
    assert.equal(recovered.rows[0].id, claimedIds[0])
    assert.equal(Number(recovered.rows[0].attempt_count), 2)
  } finally {
    await db.close()
  }
})

test('future request work is not claimed until its schedule becomes due', async () => {
  const db = await createDatabase()
  try {
    const { eventId, settingId } = await insertSetting(db, 10)
    const recurrence = await db.query(
      'select * from public.claim_training_availability_processor_work_v1($1, 1, 45)',
      ['70000000-0000-4000-8000-000000000001'],
    )
    await db.query(
      "select public.complete_training_availability_processor_work_v1($1, $2, $3, 'terminal')",
      [recurrence.rows[0].id, '70000000-0000-4000-8000-000000000001', recurrence.rows[0].revision],
    )

    const requestId = '80000000-0000-4000-8000-000000000001'
    await db.query(`
      insert into public.training_availability_requests (
        id, club_id, team_id, setting_id, calendar_event_id, occurrence_date,
        occurrence_starts_at, occurrence_ends_at, send_at, status
      ) values ($1, $2, $3, $4, $5, current_date + 2, now() + interval '2 days',
        now() + interval '2 days 1 hour', now() + interval '1 day', 'pending')
    `, [
      requestId,
      '10000000-0000-4000-8000-000000000001',
      '20000000-0000-4000-8000-000000000001',
      settingId,
      eventId,
    ])

    const early = await db.query(
      'select * from public.claim_training_availability_processor_work_v1($1, 1, 45)',
      ['70000000-0000-4000-8000-000000000002'],
    )
    assert.equal(early.rows.length, 0)

    await db.query(
      "update public.training_availability_requests set send_at = now() - interval '1 second' where id = $1",
      [requestId],
    )
    const due = await db.query(
      'select * from public.claim_training_availability_processor_work_v1($1, 1, 45)',
      ['70000000-0000-4000-8000-000000000003'],
    )
    assert.equal(due.rows[0].request_id, requestId)
  } finally {
    await db.close()
  }
})

test('a newer setting revision requeues stale claimed work from the beginning', async () => {
  const db = await createDatabase()
  try {
    const { settingId } = await insertSetting(db, 20)
    const workerId = '90000000-0000-4000-8000-000000000001'
    const claim = await db.query(
      'select * from public.claim_training_availability_processor_work_v1($1, 1, 45)',
      [workerId],
    )
    await db.query(
      'update public.training_availability_settings set send_days_before = 4 where id = $1',
      [settingId],
    )
    const completion = await db.query(
      "select public.complete_training_availability_processor_work_v1($1, $2, $3, 'completed', current_date)",
      [claim.rows[0].id, workerId, claim.rows[0].revision],
    )
    const work = await db.query(
      'select state, cursor_date, revision from public.training_availability_processor_work where id = $1',
      [claim.rows[0].id],
    )

    assert.equal(completion.rows[0].complete_training_availability_processor_work_v1, 'superseded')
    assert.equal(work.rows[0].state, 'pending')
    assert.equal(work.rows[0].cursor_date, null)
    assert.equal(Number(work.rows[0].revision), 2)
  } finally {
    await db.close()
  }
})
