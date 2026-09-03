import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'

import { PGlite } from '@electric-sql/pglite'

const root = new URL('../', import.meta.url)
const source = (path) => readFile(new URL(path, root), 'utf8')

test('web and Coach mobile request Parent notifications after a saved substitution', async () => {
  const [matchDayPage, coachData, sender, copy] = await Promise.all([
    source('src/pages/MatchDayPage.jsx'),
    source('apps/mobile-core/src/coachMatchDayData.js'),
    source('netlify/functions/send-match-day-push.js'),
    source('netlify/functions/lib/_match-day-notification-copy.js'),
  ])

  assert.match(matchDayPage, /\['yellow_card', 'red_card', 'substitution'\]\.includes\(savedEvent\.eventType \|\| savedEvent\.event_type\)/)
  assert.match(coachData, /type === 'red_card' \|\| type === 'substitution'/)
  assert.match(sender, /\['yellow_card', 'red_card', 'substitution'\]\.includes\(type\)[\s\S]*authorize_match_day_scorer_event_push/)
  assert.match(copy, /case 'substitution':[\s\S]*A substitution was recorded/)
})

test('substitution push authorization verifies the saved active event and fans out to every current Team Parent link', async () => {
  const migration = await source('supabase/migrations/20260825132439_matchday_substitution_parent_notifications_98.sql')
  const db = new PGlite()

  try {
    await db.exec(`
      create role anon;
      create role authenticated;
      create role service_role;
      create table public.match_days (
        id uuid primary key, club_id uuid not null, team_id uuid not null,
        deleted_at timestamptz, concluded_at timestamptz, status text,
        timer_status text
      );
      create table public.users (
        id uuid primary key, role text, role_rank integer, club_id uuid
      );
      create table public.team_staff (team_id uuid, user_id uuid);
      create table public.match_day_events (
        id uuid primary key, match_day_id uuid not null, event_type text,
        event_status text
      );
      create function public.get_match_day_parent_notification_link_ids(uuid)
      returns uuid[] language sql stable as $$
        select array['60000000-0000-4000-8000-000000000001'::uuid]
      $$;
      create function public.authorize_match_day_push_v2(uuid, uuid, uuid, text, uuid default null)
      returns jsonb language sql stable as $$
        select '{"allowed":true,"targetParentLinkIds":[]}'::jsonb
      $$;
    `)
    await db.exec(migration)
    await db.exec(`
      insert into public.match_days values (
        '10000000-0000-4000-8000-000000000001',
        '20000000-0000-4000-8000-000000000001',
        '30000000-0000-4000-8000-000000000001',
        null, null, 'live', 'running'
      );
      insert into public.users values (
        '40000000-0000-4000-8000-000000000001',
        'coach', 30, '20000000-0000-4000-8000-000000000001'
      );
      insert into public.team_staff values (
        '30000000-0000-4000-8000-000000000001',
        '40000000-0000-4000-8000-000000000001'
      );
      insert into public.match_day_events values (
        '50000000-0000-4000-8000-000000000001',
        '10000000-0000-4000-8000-000000000001',
        'substitution', 'active'
      );
    `)

    const result = await db.query(`
      select public.authorize_match_day_push_v2(
        '40000000-0000-4000-8000-000000000001',
        '10000000-0000-4000-8000-000000000001',
        null,
        'substitution',
        '50000000-0000-4000-8000-000000000001'
      ) as authorization
    `)

    assert.equal(result.rows[0].authorization.allowed, true)
    assert.deepEqual(result.rows[0].authorization.targetParentLinkIds, ['60000000-0000-4000-8000-000000000001'])
    assert.equal(
      result.rows[0].authorization.operationKey,
      'match-day:10000000-0000-4000-8000-000000000001:substitution:50000000-0000-4000-8000-000000000001',
    )

    await db.exec(`
      update public.match_day_events
      set event_status = 'voided'
      where id = '50000000-0000-4000-8000-000000000001'
    `)
    const voidedResult = await db.query(`
      select public.authorize_match_day_push_v2(
        '40000000-0000-4000-8000-000000000001',
        '10000000-0000-4000-8000-000000000001',
        null,
        'substitution',
        '50000000-0000-4000-8000-000000000001'
      ) as authorization
    `)
    assert.deepEqual(voidedResult.rows[0].authorization, { allowed: false, reason: 'event_scope' })
  } finally {
    await db.close()
  }
})
