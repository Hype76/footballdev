import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'

import { PGlite } from '@electric-sql/pglite'

const migration = await readFile(
  new URL('../supabase/migrations/20261016152500_marketing_matchday_club_scope.sql', import.meta.url),
  'utf8',
)

const migrationWithoutCron = migration
  .replace('create extension if not exists pg_cron;', '')
  .replace(/select cron\.schedule\([\s\S]*?\);\s*$/i, '')

test('public activity counts teams separately from genuine club workspaces', async () => {
  const db = new PGlite()
  await db.exec(`
    create role anon;
    create role authenticated;

    create table public.clubs (
      id uuid primary key,
      status text not null,
      archived_at timestamptz,
      plan_key text not null
    );

    create table public.teams (
      id uuid primary key,
      club_id uuid not null references public.clubs(id),
      status text not null,
      archived_at timestamptz
    );

    create table public.match_days (
      id uuid primary key,
      status text not null,
      deleted_at timestamptz
    );

    create table public.match_day_events (
      id uuid primary key,
      match_day_id uuid not null references public.match_days(id),
      event_type text not null,
      event_status text not null
    );

    create table public.parent_mobile_notification_events (
      id uuid primary key,
      intent_type text not null,
      status text not null
    );

    create table public.fan_notifications (
      id uuid primary key,
      match_id uuid,
      push_sent_at timestamptz
    );

    insert into public.clubs (id, status, archived_at, plan_key) values
      ('10000000-0000-4000-8000-000000000001', 'active', null, 'matchday'),
      ('10000000-0000-4000-8000-000000000002', 'active', null, 'team'),
      ('10000000-0000-4000-8000-000000000003', 'active', null, 'single_team'),
      ('10000000-0000-4000-8000-000000000004', 'active', null, 'club'),
      ('10000000-0000-4000-8000-000000000005', 'active', null, 'small_club'),
      ('10000000-0000-4000-8000-000000000006', 'active', null, 'development_club'),
      ('10000000-0000-4000-8000-000000000007', 'active', null, 'large_club'),
      ('10000000-0000-4000-8000-000000000008', 'active', null, 'pilot'),
      ('10000000-0000-4000-8000-000000000009', 'suspended', null, 'small_club'),
      ('10000000-0000-4000-8000-000000000010', 'active', now(), 'large_club');

    insert into public.teams (id, club_id, status, archived_at) values
      ('20000000-0000-4000-8000-000000000001', '10000000-0000-4000-8000-000000000001', 'active', null),
      ('20000000-0000-4000-8000-000000000002', '10000000-0000-4000-8000-000000000002', 'active', null),
      ('20000000-0000-4000-8000-000000000003', '10000000-0000-4000-8000-000000000003', 'active', null),
      ('20000000-0000-4000-8000-000000000004', '10000000-0000-4000-8000-000000000004', 'active', null),
      ('20000000-0000-4000-8000-000000000005', '10000000-0000-4000-8000-000000000005', 'active', null),
      ('20000000-0000-4000-8000-000000000006', '10000000-0000-4000-8000-000000000006', 'archived', null),
      ('20000000-0000-4000-8000-000000000007', '10000000-0000-4000-8000-000000000007', 'active', now()),
      ('20000000-0000-4000-8000-000000000008', '10000000-0000-4000-8000-000000000008', 'active', null),
      ('20000000-0000-4000-8000-000000000009', '10000000-0000-4000-8000-000000000009', 'active', null);
  `)

  await db.exec(migrationWithoutCron)

  const { rows } = await db.query(`
    select teams_active, clubs_active
    from public.marketing_matchday_stats
    where id = true
  `)

  assert.deepEqual(rows, [{ teams_active: 6, clubs_active: 4 }])

  await db.exec(`
    insert into public.clubs (id, status, archived_at, plan_key)
    values ('10000000-0000-4000-8000-000000000011', 'active', null, 'matchday');
    insert into public.teams (id, club_id, status, archived_at)
    values ('20000000-0000-4000-8000-000000000010', '10000000-0000-4000-8000-000000000011', 'active', null);
    select app_private.refresh_marketing_matchday_stats();
  `)

  const refreshed = await db.query(`
    select teams_active, clubs_active
    from public.marketing_matchday_stats
    where id = true
  `)

  assert.deepEqual(refreshed.rows, [{ teams_active: 7, clubs_active: 4 }])
  await db.close()
})
