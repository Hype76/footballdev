import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { test } from 'node:test'
import { PGlite } from '@electric-sql/pglite'

import { buildFootballCalendarEvents } from '../src/lib/football-calendar-events.js'
import { getManagerHomeNextUp } from '../src/lib/manager-home-next-up.js'
import { buildOccurrences } from '../netlify/functions/lib/_training-calendar.js'

const event = {
  id: 'series-1',
  startsAt: '2026-10-05T17:00:00.000Z',
  endsAt: '2026-10-05T18:00:00.000Z',
  recurrenceFrequency: 'weekly',
  recurrenceUntil: '2026-10-26',
  eventType: 'training',
  title: 'Monday training',
}

test('a deleted date disappears from the calendar and training schedule without removing later repeats', () => {
  const changed = { ...event, deletedOccurrenceDates: ['2026-10-12'] }
  assert.deepEqual(
    buildFootballCalendarEvents({ calendarEvents: [changed] }).map((item) => item.occurrenceDate),
    ['2026-10-05', '2026-10-19', '2026-10-26'],
  )
  assert.deepEqual(
    buildOccurrences(changed).map((item) => item.occurrenceDate),
    ['2026-10-05', '2026-10-19', '2026-10-26'],
  )
})

test('shortening the repeat until date keeps earlier dates only', () => {
  const changed = { ...event, recurrenceUntil: '2026-10-12' }
  assert.deepEqual(
    buildFootballCalendarEvents({ calendarEvents: [changed] }).map((item) => item.occurrenceDate),
    ['2026-10-05', '2026-10-12'],
  )
  assert.deepEqual(
    buildOccurrences(changed).map((item) => item.occurrenceDate),
    ['2026-10-05', '2026-10-12'],
  )
})

test('Manager Home skips a removed repeat date', () => {
  const next = getManagerHomeNextUp({
    activeTeamId: 'team-1',
    calendarEvents: [{ ...event, teamId: 'team-1', deletedOccurrenceDates: ['2026-10-12'] }],
    now: new Date('2026-10-10T09:00:00.000Z'),
  })
  assert.equal(next.date, '2026-10-19')
})

test('hiding a development calendar entry keeps the saved record out of the calendar', () => {
  const evaluation = {
    id: 'record-1',
    playerName: 'Amelia Price',
    date: '2026-09-06',
    calendarHiddenAt: '2026-09-28T09:00:00.000Z',
  }
  assert.equal(buildFootballCalendarEvents({ evaluations: [evaluation] }).length, 0)
  assert.equal(buildFootballCalendarEvents({ evaluations: [{ ...evaluation, calendarHiddenAt: '' }] }).length, 1)
})

test('migration cancels only removed training requests and keeps earlier responses', async () => {
  const db = new PGlite()
  try {
    await db.exec(`
      create role anon;
      create role authenticated;
      create schema app_private;
      create table public.calendar_events (
        id uuid primary key,
        deleted_occurrence_dates date[] not null default '{}',
        recurrence_until date,
        cancelled_at timestamptz
      );
      create table public.evaluations (id uuid primary key);
      create table public.training_availability_requests (
        id uuid primary key,
        calendar_event_id uuid not null,
        occurrence_date date not null,
        status text not null,
        updated_at timestamptz
      );
      create table public.training_availability_request_players (
        request_id uuid not null,
        status text not null,
        updated_at timestamptz
      );
    `)
    const migration = await readFile(new URL('../supabase/migrations/20260928094023_calendar_occurrence_deletion_scopes.sql', import.meta.url), 'utf8')
    await db.exec(migration)
    await db.exec(`
      insert into public.calendar_events (id, recurrence_until)
      values ('00000000-0000-0000-0000-000000000001', '2026-10-26');
      insert into public.training_availability_requests (id, calendar_event_id, occurrence_date, status)
      values
        ('00000000-0000-0000-0000-000000000011', '00000000-0000-0000-0000-000000000001', '2026-10-05', 'sent'),
        ('00000000-0000-0000-0000-000000000012', '00000000-0000-0000-0000-000000000001', '2026-10-12', 'queued'),
        ('00000000-0000-0000-0000-000000000013', '00000000-0000-0000-0000-000000000001', '2026-10-19', 'pending');
      insert into public.training_availability_request_players (request_id, status)
      values
        ('00000000-0000-0000-0000-000000000011', 'responded'),
        ('00000000-0000-0000-0000-000000000012', 'queued'),
        ('00000000-0000-0000-0000-000000000013', 'pending');
      update public.calendar_events
      set deleted_occurrence_dates = array['2026-10-12']::date[]
      where id = '00000000-0000-0000-0000-000000000001';
    `)
    let rows = await db.query('select occurrence_date::text as date, status from public.training_availability_requests order by occurrence_date')
    assert.deepEqual(rows.rows, [
      { date: '2026-10-05', status: 'sent' },
      { date: '2026-10-12', status: 'cancelled' },
      { date: '2026-10-19', status: 'pending' },
    ])
    await db.exec(`update public.calendar_events set recurrence_until = '2026-10-05' where id = '00000000-0000-0000-0000-000000000001'`)
    rows = await db.query('select occurrence_date::text as date, status from public.training_availability_requests order by occurrence_date')
    assert.deepEqual(rows.rows, [
      { date: '2026-10-05', status: 'sent' },
      { date: '2026-10-12', status: 'cancelled' },
      { date: '2026-10-19', status: 'cancelled' },
    ])
    const playerRows = await db.query('select status from public.training_availability_request_players order by request_id')
    assert.deepEqual(playerRows.rows.map((row) => row.status), ['responded', 'cancelled', 'cancelled'])
    await db.exec(`update public.calendar_events set cancelled_at = now() where id = '00000000-0000-0000-0000-000000000001'`)
    const cancelledRows = await db.query('select status from public.training_availability_requests order by occurrence_date')
    assert.deepEqual(cancelledRows.rows.map((row) => row.status), ['cancelled', 'cancelled', 'cancelled'])
  } finally {
    await db.close()
  }
})
