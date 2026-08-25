import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'

import { PGlite } from '@electric-sql/pglite'

import {
  filterCoachCalendarEvents,
  normalizeCoachCalendarEvent,
} from '../apps/mobile-core/src/coachCalendarCore.js'
import {
  getMobileAvailableFormationPlayers,
  getMobileFormationPlayerAvailability,
} from '../apps/mobile-core/src/coachFormationBoardCore.js'
import { getParentCalendarEventBucket } from '../apps/mobile-core/src/parentCalendarCore.js'
import { countUnreadNonChatNotifications } from '../apps/mobile-core/src/parentNotificationInboxCore.js'
import { getParentCalendarGroups } from '../apps/parent-mobile/src/parentExperience.js'
import { getParentInvitationSections } from '../apps/parent-mobile/src/parentPresentationCore.js'
import { isCurrentMatchDayNotificationReference } from '../netlify/functions/lib/_parent-notification-validity.js'

const root = new URL('../', import.meta.url)
const source = (path) => readFile(new URL(path, root), 'utf8')

test('Match Day push authority uses active Team membership and every active linked Parent', async () => {
  const migration = await source('supabase/migrations/20260825052644_mobile_matchday_recipient_and_scorer_email_94.sql')
  assert.match(migration, /join public\.player_team_memberships membership[\s\S]*membership\.status = 'active'[\s\S]*membership\.ended_at is null/)
  assert.match(migration, /join public\.parent_player_links parent_link[\s\S]*parent_link\.player_id = player\.id[\s\S]*parent_link\.auth_user_id is not null/)
  assert.doesNotMatch(migration, /parent_link\.team_id = match_day\.team_id/)
  assert.match(migration, /Active app context and Match squad selection are intentionally not recipient filters/)
  assert.match(migration, /authorize_match_day_push_before_recipient_fanout_94/)
  assert.match(migration, /authorize_match_day_push_v2_before_recipient_fanout_94/)
})

test('recipient authority and scorer branding migration execute against PostgreSQL contracts', async () => {
  const migration = await source('supabase/migrations/20260825052644_mobile_matchday_recipient_and_scorer_email_94.sql')
  const db = new PGlite()
  try {
    await db.exec(`
      create role anon;
      create role authenticated;
      create role service_role;
      create table public.match_days (
        id uuid primary key, club_id uuid not null, team_id uuid, deleted_at timestamptz,
        concluded_at timestamptz, status text default 'scheduled', opponent text,
        match_date date, kickoff_time time, arrival_time time, venue_name text, venue_address text
      );
      create table public.player_team_memberships (
        id uuid primary key, club_id uuid not null, team_id uuid not null, player_id uuid not null,
        status text default 'active', ended_at timestamptz
      );
      create table public.players (
        id uuid primary key, club_id uuid not null, status text default 'active', archived_at timestamptz
      );
      create table public.parent_player_links (
        id uuid primary key, club_id uuid not null, team_id uuid, player_id uuid not null,
        status text default 'active', auth_user_id uuid, email text
      );
      create table public.match_day_role_assignments (
        id uuid primary key, match_day_id uuid not null, role text, parent_link_id uuid,
        auth_user_id uuid, club_id uuid, team_id uuid
      );
      create table public.clubs (
        id uuid primary key, name text, timezone_name text, logo_url text, theme_accent text
      );
      create table public.teams (id uuid primary key, name text, theme_accent text);
      create table public.scheduled_email_queue (
        id uuid primary key, status text, subject text, payload jsonb default '{}'::jsonb
      );
      create table public.match_day_scorer_reminder_operations (
        match_day_id uuid, role_assignment_id uuid, email_queue_id uuid, status text
      );
      create function public.calendar_event_notification_escape_html(value text)
      returns text language sql immutable as $$ select coalesce(value, '') $$;
      create function public.authorize_match_day_push(uuid, uuid, uuid, text, uuid default null)
      returns jsonb language sql stable as $$ select '{"allowed":true,"targetParentLinkIds":[]}'::jsonb $$;
      create function public.authorize_match_day_push_v2(uuid, uuid, uuid, text, uuid default null)
      returns jsonb language sql stable as $$ select '{"allowed":true,"targetParentLinkIds":[]}'::jsonb $$;
      create function public.schedule_match_day_scorer_reminder(uuid, uuid)
      returns jsonb language sql as $$
        select '{"scheduled":true,"emailQueueId":"90000000-0000-4000-8000-000000000001"}'::jsonb
      $$;
    `)
    await db.exec(migration)

    await db.exec(`
      insert into public.clubs values ('10000000-0000-4000-8000-000000000001', 'FP TEST FC', 'Europe/London', 'https://example.test/badge.png', '#123456');
      insert into public.teams values ('20000000-0000-4000-8000-000000000001', 'FP TEST U17', '#234567');
      insert into public.match_days values ('30000000-0000-4000-8000-000000000001', '10000000-0000-4000-8000-000000000001', '20000000-0000-4000-8000-000000000001', null, null, 'scheduled', 'Visitors', '2026-08-30', '15:00', '14:15', 'Test Ground', '1 Test Road');
      insert into public.players values ('40000000-0000-4000-8000-000000000001', '10000000-0000-4000-8000-000000000001', 'active', null);
      insert into public.player_team_memberships values ('50000000-0000-4000-8000-000000000001', '10000000-0000-4000-8000-000000000001', '20000000-0000-4000-8000-000000000001', '40000000-0000-4000-8000-000000000001', 'active', null);
      insert into public.parent_player_links values ('60000000-0000-4000-8000-000000000001', '10000000-0000-4000-8000-000000000001', null, '40000000-0000-4000-8000-000000000001', 'active', '70000000-0000-4000-8000-000000000001', 'parent@example.test');
      insert into public.match_day_role_assignments values ('80000000-0000-4000-8000-000000000001', '30000000-0000-4000-8000-000000000001', 'scorer', '60000000-0000-4000-8000-000000000001', '70000000-0000-4000-8000-000000000001', '10000000-0000-4000-8000-000000000001', '20000000-0000-4000-8000-000000000001');
      insert into public.scheduled_email_queue values ('90000000-0000-4000-8000-000000000001', 'scheduled', 'Old subject', '{}');
    `)

    const recipientResult = await db.query(
      'select public.get_match_day_parent_notification_link_ids($1) as ids',
      ['30000000-0000-4000-8000-000000000001'],
    )
    assert.deepEqual(recipientResult.rows[0].ids, ['60000000-0000-4000-8000-000000000001'])

    const reminderResult = await db.query(
      'select public.schedule_match_day_scorer_reminder($1, $2) as result',
      ['30000000-0000-4000-8000-000000000001', '80000000-0000-4000-8000-000000000001'],
    )
    assert.equal(reminderResult.rows[0].result.branded, true)
    const queueResult = await db.query('select subject, payload from public.scheduled_email_queue')
    assert.match(queueResult.rows[0].subject, /FP TEST FC/)
    assert.match(queueResult.rows[0].payload.resendPayload.html, /Open scorer Game Mode/)
    assert.match(queueResult.rows[0].payload.resendPayload.html, /badge\.png/)
  } finally {
    await db.close()
  }
})

test('Coach Match Day actions request team push delivery after saved lifecycle and alert events', async () => {
  const coachData = await source('apps/mobile-core/src/coachMatchDayData.js')
  assert.match(coachData, /sendCoachMatchDayPush\(match, pushType\)/)
  assert.match(coachData, /value === 'resume'.*'half_time'/s)
  assert.match(coachData, /\? 'second_half'/)
  assert.match(coachData, /type === 'goal' \|\| type === 'yellow_card' \|\| type === 'red_card' \|\| type === 'substitution'/)
  assert.match(coachData, /sendCoachMatchDayPush\(match, 'score_correction', savedEvent\?\.id\)/)
  assert.match(coachData, /\.netlify\/functions\/send-match-day-push/)
})

test('scorer reminders keep their operation identity while queued email copy becomes club branded', async () => {
  const migration = await source('supabase/migrations/20260825052644_mobile_matchday_recipient_and_scorer_email_94.sql')
  assert.match(migration, /schedule_match_day_scorer_reminder_before_branding_94/)
  assert.match(migration, /You are scoring today/)
  assert.match(migration, /Open scorer Game Mode/)
  assert.match(migration, /club_row\.logo_url/)
  assert.match(migration, /queue\.payload -> 'resendPayload'/)
  assert.match(migration, /match_day_scorer_reminder_operations operation/)
})

test('current volunteer assignments can be removed without a surviving response row and scorers get deselection mail', async () => {
  const server = await source('netlify/functions/select-match-day-volunteer.js')
  const screen = await source('apps/coach-mobile/src/CoachMatchDayScreen.js')
  assert.match(server, /if \(!selected\)[\s\S]*previousAssignment\?\.id/)
  assert.match(server, /request = \{[\s\S]*parent_link_id: previousAssignment\.parent_link_id/)
  assert.match(server, /if \(previousAssignment\?\.id && \(!selected \|\| !isSameSelection\)\)/)
  assert.doesNotMatch(server, /role !== 'scorer' && previousAssignment/)
  assert.match(screen, /const removalTarget = assignment \? \{[\s\S]*parentLinkId: assignment\.parentLinkId/)
  assert.match(screen, /\$\{assignment \? 'Change to' : 'Select'\}/)
})

test('formation selection exposes availability without replacing the coach squad decision', () => {
  const players = [{ id: 'one' }, { id: 'two' }, { id: 'three' }]
  const rows = [
    { playerId: 'one', status: 'available' },
    { playerId: 'two', status: 'unavailable' },
    { playerId: 'three', status: 'maybe' },
  ]
  assert.deepEqual(getMobileAvailableFormationPlayers(players, rows), [players[0]])
  assert.deepEqual(getMobileFormationPlayerAvailability('two', rows), { label: 'Unavailable', status: 'unavailable' })
  assert.deepEqual(getMobileFormationPlayerAvailability('missing', rows), { label: 'Awaiting response', status: 'pending' })
})

test('same-day training moves from upcoming to history at its end time', () => {
  const event = normalizeCoachCalendarEvent({
    id: 'training',
    event_type: 'training',
    starts_at: '2026-08-25T17:00:00.000Z',
    ends_at: '2026-08-25T18:00:00.000Z',
    title: 'Training',
  })
  assert.deepEqual(filterCoachCalendarEvents([event], 'upcoming', new Date('2026-08-25T17:30:00.000Z')), [event])
  assert.deepEqual(filterCoachCalendarEvents([event], 'upcoming', new Date('2026-08-25T18:01:00.000Z')), [])
  assert.deepEqual(filterCoachCalendarEvents([event], 'history', new Date('2026-08-25T18:01:00.000Z')), [event])
})

test('Parent upcoming calendar and invite counters use the event end boundary', () => {
  const event = {
    calendarDate: '2026-08-25',
    endsAt: '2026-08-25T18:00:00.000Z',
    startsAt: '2026-08-25T17:00:00.000Z',
    status: 'scheduled',
  }
  assert.equal(getParentCalendarEventBucket(event, new Date('2026-08-25T17:30:00.000Z')), 'upcoming')
  assert.equal(getParentCalendarEventBucket(event, new Date('2026-08-25T18:01:00.000Z')), 'history')
  assert.deepEqual(getParentCalendarGroups([event], new Date('2026-08-25T18:01:00.000Z')), { recent: [event], upcoming: [] })

  const invitation = {
    canRespond: true,
    childId: 'child',
    eventDate: '2026-08-25',
    eventEnd: '2026-08-25T18:00:00.000Z',
    eventStart: '2026-08-25T17:00:00.000Z',
    invitationState: 'active',
    invitationType: 'training',
    isPending: true,
    sourceRecordId: 'request',
  }
  assert.equal(getParentInvitationSections([invitation], new Date('2026-08-25T17:30:00.000Z')).needsResponse.length, 1)
  assert.equal(getParentInvitationSections([invitation], new Date('2026-08-25T18:01:00.000Z')).needsResponse.length, 0)
  assert.equal(getParentInvitationSections([invitation], new Date('2026-08-25T18:01:00.000Z')).history.length, 1)
})

test('terminal Match Day and poll result notifications remain history but do not count on the app icon', () => {
  assert.equal(isCurrentMatchDayNotificationReference({ id: 'match', match_date: '2026-08-25', status: 'live' }, '2026-08-25'), true)
  assert.equal(isCurrentMatchDayNotificationReference({ concluded_at: '2026-08-25T18:00:00Z', id: 'match', match_date: '2026-08-25', status: 'full_time' }, '2026-08-25'), false)
  assert.equal(countUnreadNonChatNotifications([
    { id: 'active', isBadgeEligible: true, isRead: false },
    { id: 'history', isBadgeEligible: false, isRead: false },
  ]), 1)
})
