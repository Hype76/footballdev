import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { after, before, test } from 'node:test'
import { PGlite } from '@electric-sql/pglite'

const migrationUrl = new URL('../supabase/migrations/20260826155348_calendar_resource_occurrence_scope.sql', import.meta.url)
let db

before(async () => {
  db = new PGlite()
  await db.exec(`
    create role anon;
    create role authenticated;
    create role service_role;
    create schema app_private;
    create table public.calendar_events (
      id uuid primary key,
      club_id uuid not null,
      team_id uuid not null,
      starts_at timestamptz not null,
      recurrence_frequency text not null default 'none',
      recurrence_until date,
      cancelled_at timestamptz
    );
    create table public.resource_library_links (
      id uuid primary key,
      resource_id uuid not null,
      club_id uuid not null,
      team_id uuid not null,
      linked_type text not null,
      linked_id uuid not null,
      removed_at timestamptz
    );
    create unique index resource_library_links_active_target_key
      on public.resource_library_links (resource_id, linked_type, linked_id)
      where removed_at is null;
    insert into public.calendar_events values
      ('10000000-0000-4000-8000-000000000001','20000000-0000-4000-8000-000000000001','30000000-0000-4000-8000-000000000001','2026-08-27T14:00:00Z','weekly','2026-09-17',null);
    insert into public.resource_library_links values
      ('40000000-0000-4000-8000-000000000001','50000000-0000-4000-8000-000000000001','20000000-0000-4000-8000-000000000001','30000000-0000-4000-8000-000000000001','calendar_event','10000000-0000-4000-8000-000000000001',null);
  `)
  await db.exec(await readFile(migrationUrl, 'utf8'))
})

after(async () => db?.close())

test('existing Calendar Resource links are assigned to the first dated occurrence', async () => {
  const result = await db.query('select calendar_occurrence_date from public.resource_library_links where id = $1', ['40000000-0000-4000-8000-000000000001'])
  assert.equal(new Date(result.rows[0].calendar_occurrence_date).toISOString().slice(0, 10), '2026-08-27')
})

test('one Resource can be attached independently to another valid week', async () => {
  await db.query(`insert into public.resource_library_links
    (id, resource_id, club_id, team_id, linked_type, linked_id, calendar_occurrence_date)
    values ($1,$2,$3,$4,'calendar_event',$5,$6)`, [
    '40000000-0000-4000-8000-000000000002',
    '50000000-0000-4000-8000-000000000001',
    '20000000-0000-4000-8000-000000000001',
    '30000000-0000-4000-8000-000000000001',
    '10000000-0000-4000-8000-000000000001',
    '2026-09-03',
  ])
  const result = await db.query('select count(*)::integer as count from public.resource_library_links where resource_id = $1 and removed_at is null', ['50000000-0000-4000-8000-000000000001'])
  assert.equal(result.rows[0].count, 2)
})

test('an invalid date outside the repeat pattern is rejected', async () => {
  await assert.rejects(() => db.query(`insert into public.resource_library_links
    (id, resource_id, club_id, team_id, linked_type, linked_id, calendar_occurrence_date)
    values ($1,$2,$3,$4,'calendar_event',$5,$6)`, [
    '40000000-0000-4000-8000-000000000003',
    '50000000-0000-4000-8000-000000000002',
    '20000000-0000-4000-8000-000000000001',
    '30000000-0000-4000-8000-000000000001',
    '10000000-0000-4000-8000-000000000001',
    '2026-09-04',
  ]), /calendar_resource_occurrence_invalid/)
})
