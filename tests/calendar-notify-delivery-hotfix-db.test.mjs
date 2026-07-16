import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { test } from 'node:test'
import { PGlite } from '@electric-sql/pglite'

const migration = await readFile(new URL('../supabase/migrations/20260716110436_calendar_notify_delivery_hotfix.sql', import.meta.url), 'utf8')

const ACTOR_ID = '10000000-0000-4000-8000-000000000001'
const CLUB_ID = '20000000-0000-4000-8000-000000000001'
const TEAM_ID = '30000000-0000-4000-8000-000000000001'
const OTHER_TEAM_ID = '30000000-0000-4000-8000-000000000002'
const MATCH_ID = '40000000-0000-4000-8000-000000000001'
const OTHER_MATCH_ID = '40000000-0000-4000-8000-000000000002'

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
      role_rank integer
    );
    create table public.calendar_events (id uuid primary key, club_id uuid, team_id uuid);
    create table public.match_days (id uuid primary key, club_id uuid, team_id uuid);
    create table public.team_staff (team_id uuid, user_id uuid);
    create table public.players (
      id uuid primary key,
      club_id uuid,
      team_id uuid,
      status text,
      section text
    );
    create table public.calendar_event_notification_events (
      id uuid primary key,
      status text not null,
      constraint calendar_event_notification_events_status_check
        check (status in ('pending', 'queued', 'failed'))
    );
    create table public.scheduled_email_queue (
      id uuid primary key,
      status text not null,
      scheduled_at timestamptz not null,
      payload jsonb not null default '{}'::jsonb,
      constraint scheduled_email_queue_status_check
        check (status in ('scheduled', 'sending', 'failed'))
    );
    create function public.sync_calendar_event_parent_scope(uuid, uuid, uuid[])
    returns jsonb
    language sql
    security definer
    set search_path = ''
    as $$
      select jsonb_build_object(
        'selectedPlayerCount', coalesce(array_length($3, 1), 0),
        'selectedPlayerIds', to_jsonb($3)
      )
    $$;
  `)
  await db.exec(migration)
  await db.exec(`
    insert into public.users values ('${ACTOR_ID}', '${CLUB_ID}', 'coach', 'active', 20);
    insert into public.team_staff values ('${TEAM_ID}', '${ACTOR_ID}');
    insert into public.match_days values
      ('${MATCH_ID}', '${CLUB_ID}', '${TEAM_ID}'),
      ('${OTHER_MATCH_ID}', '${CLUB_ID}', '${OTHER_TEAM_ID}');
    insert into public.players values
      ('50000000-0000-4000-8000-000000000001', '${CLUB_ID}', '${TEAM_ID}', 'active', 'Squad'),
      ('50000000-0000-4000-8000-000000000002', '${CLUB_ID}', '${TEAM_ID}', 'active', 'squad'),
      ('50000000-0000-4000-8000-000000000003', '${CLUB_ID}', '${TEAM_ID}', 'active', 'Trial'),
      ('50000000-0000-4000-8000-000000000004', '${CLUB_ID}', '${TEAM_ID}', 'archived', 'Squad'),
      ('50000000-0000-4000-8000-000000000005', '${CLUB_ID}', '${OTHER_TEAM_ID}', 'active', 'Squad');
  `)
  return db
}

test('delivery migration applies and resolves Whole squad scope server-side', async () => {
  const db = await createFixtureDatabase()

  try {
    const withoutTrials = await db.query(`
      select public.sync_calendar_event_parent_scope_v2(
        null, false, '${MATCH_ID}', '{}'::uuid[], 'whole_squad'
      ) as result
    `)
    const withTrials = await db.query(`
      select public.sync_calendar_event_parent_scope_v2(
        null, true, '${MATCH_ID}', '{}'::uuid[], 'whole_squad'
      ) as result
    `)
    const manual = await db.query(`
      select public.sync_calendar_event_parent_scope_v2(
        null, false, '${MATCH_ID}',
        array['50000000-0000-4000-8000-000000000001'::uuid], 'manual'
      ) as result
    `)

    assert.equal(withoutTrials.rows[0].result.selectedPlayerCount, 2)
    assert.equal(withoutTrials.rows[0].result.selectionMode, 'whole_squad')
    assert.equal(withTrials.rows[0].result.selectedPlayerCount, 3)
    assert.equal(withTrials.rows[0].result.includeTrialPlayers, true)
    assert.equal(manual.rows[0].result.selectedPlayerCount, 1)
    assert.equal(manual.rows[0].result.selectionMode, 'manual')
  } finally {
    await db.close()
  }
})

test('Whole squad injection and unauthorised team scope fail closed', async () => {
  const db = await createFixtureDatabase()

  try {
    await assert.rejects(
      () => db.query(`
        select public.sync_calendar_event_parent_scope_v2(
          null, false, '${MATCH_ID}',
          array['50000000-0000-4000-8000-000000000005'::uuid], 'whole_squad'
        )
      `),
      /Whole squad player scope is resolved by the server/,
    )
    await assert.rejects(
      () => db.query(`
        select public.sync_calendar_event_parent_scope_v2(
          null, false, '${OTHER_MATCH_ID}', '{}'::uuid[], 'whole_squad'
        )
      `),
      /do not have permission/,
    )
  } finally {
    await db.close()
  }
})

test('Calendar notification queue rows become due now while other scheduled mail is unchanged', async () => {
  const db = await createFixtureDatabase()

  try {
    const calendarRow = await db.query(`
      insert into public.scheduled_email_queue (id, status, scheduled_at, payload)
      values (
        '60000000-0000-4000-8000-000000000001',
        'failed',
        now() + interval '10 minutes',
        '{"communicationLog":{"metadata":{"source":"calendar_event_notification"}}}'::jsonb
      )
      returning status, scheduled_at, extract(epoch from (scheduled_at - now())) as due_seconds
    `)
    const ordinaryRow = await db.query(`
      insert into public.scheduled_email_queue (id, status, scheduled_at, payload)
      values (
        '60000000-0000-4000-8000-000000000002',
        'scheduled',
        now() + interval '10 minutes',
        '{}'::jsonb
      )
      returning extract(epoch from (scheduled_at - now())) as due_seconds
    `)

    assert.equal(calendarRow.rows[0].status, 'scheduled')
    assert.ok(Math.abs(Number(calendarRow.rows[0].due_seconds)) < 2)
    assert.ok(Number(ordinaryRow.rows[0].due_seconds) > 590)
    await db.exec(`
      insert into public.calendar_event_notification_events values
        ('70000000-0000-4000-8000-000000000001', 'processing'),
        ('70000000-0000-4000-8000-000000000002', 'sent');
      update public.scheduled_email_queue set status='sent'
      where id='60000000-0000-4000-8000-000000000001';
    `)
  } finally {
    await db.close()
  }
})

test('new helper grants remain authenticated-only and internal trigger execution stays restricted', async () => {
  const db = await createFixtureDatabase()

  try {
    const privileges = await db.query(`
      select
        has_function_privilege('anon', 'public.sync_calendar_event_parent_scope_v2(uuid,boolean,uuid,uuid[],text)', 'execute') as anon_sync,
        has_function_privilege('authenticated', 'public.sync_calendar_event_parent_scope_v2(uuid,boolean,uuid,uuid[],text)', 'execute') as authenticated_sync,
        has_function_privilege('anon', 'public.set_calendar_notification_email_due_now()', 'execute') as anon_trigger,
        has_function_privilege('authenticated', 'public.set_calendar_notification_email_due_now()', 'execute') as authenticated_trigger
    `)

    assert.deepEqual(privileges.rows[0], {
      anon_sync: false,
      authenticated_sync: true,
      anon_trigger: false,
      authenticated_trigger: false,
    })
  } finally {
    await db.close()
  }
})
