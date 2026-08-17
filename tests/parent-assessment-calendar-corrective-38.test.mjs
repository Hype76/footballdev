import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'
import { PGlite } from '@electric-sql/pglite'

import { buildParentCalendarEvents } from '../apps/mobile-core/src/parentCalendarCore.js'
import {
  getParentCalendarGroups,
  getParentHomeModel,
} from '../apps/parent-mobile/src/parentExperience.js'
import {
  formatParentProductDateTime,
  formatParentProductTime,
  getParentProductDateTimeParts,
  getParentProductSortTimestamp,
  PARENT_PRODUCT_TIME_ZONE,
} from '../apps/mobile-core/src/parentDateTimeCore.js'

const migrationUrl = new URL('../supabase/migrations/20260810153505_parent_assessment_calendar_corrective_38.sql', import.meta.url)
const calendarCoreUrl = new URL('../apps/mobile-core/src/parentCalendarCore.js', import.meta.url)
const parentAppUrl = new URL('../apps/parent-mobile/App.js', import.meta.url)
const parentDataUrl = new URL('../apps/parent-mobile/src/parentPortalData.js', import.meta.url)
const parentScreensUrl = new URL('../apps/parent-mobile/src/ParentPortalScreens.js', import.meta.url)

const ids = {
  archivedChild: '10000000-0000-4000-8000-000000000004',
  childA: '10000000-0000-4000-8000-000000000001',
  childB: '10000000-0000-4000-8000-000000000002',
  childRevoked: '10000000-0000-4000-8000-000000000003',
  club: '20000000-0000-4000-8000-000000000001',
  completedSession: '30000000-0000-4000-8000-000000000003',
  cancelledSession: '30000000-0000-4000-8000-000000000002',
  linkA: '40000000-0000-4000-8000-000000000001',
  linkB: '40000000-0000-4000-8000-000000000002',
  linkArchived: '40000000-0000-4000-8000-000000000004',
  linkRevoked: '40000000-0000-4000-8000-000000000003',
  match: '50000000-0000-4000-8000-000000000001',
  missingSession: '30000000-0000-4000-8000-000000000099',
  openSessionA: '30000000-0000-4000-8000-000000000001',
  openSessionB: '30000000-0000-4000-8000-000000000004',
  parent: '60000000-0000-4000-8000-000000000001',
  teamA: '70000000-0000-4000-8000-000000000001',
  teamB: '70000000-0000-4000-8000-000000000002',
  wrongParent: '60000000-0000-4000-8000-000000000002',
}

async function setActor(db, actorId) {
  await db.query("select set_config('request.jwt.claims', $1, false)", [JSON.stringify({ sub: actorId })])
}

async function createAssessmentStateDatabase() {
  const db = new PGlite()
  const migration = await readFile(migrationUrl, 'utf8')
  await db.exec(`
    create role anon;
    create role authenticated;
    create role service_role;
    create schema auth;
    create function auth.uid() returns uuid language sql stable as $$
      select (nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'sub')::uuid
    $$;

    create table public.players (
      id uuid primary key,
      status text not null
    );
    create table public.parent_player_links (
      id uuid primary key,
      auth_user_id uuid not null,
      club_id uuid not null,
      team_id uuid not null,
      player_id uuid not null,
      status text not null
    );
    create table public.assessment_sessions (
      id uuid primary key,
      status text not null check (status in ('open', 'completed', 'cancelled'))
    );
    create table public.match_day_player_squad_decisions (
      match_day_id uuid not null,
      player_id uuid not null,
      club_id uuid not null,
      status text not null
    );
    create table public.legacy_invitation_rows (
      invitation_id text not null,
      invitation_type text not null,
      source_record_id uuid not null,
      source_type text not null,
      source_event_type text not null,
      event_id uuid not null,
      event_type text not null,
      event_title text not null,
      event_date date not null,
      kickoff_time_tbc boolean not null default false,
      event_start timestamptz,
      event_end timestamptz,
      event_location text,
      team_name text,
      child_id uuid not null,
      child_name text,
      parent_link_id uuid not null,
      role_type text,
      invitation_state text not null,
      response_state text not null,
      selection_state text not null,
      can_respond boolean not null,
      can_change_response boolean not null,
      lock_reason text,
      response_deadline timestamptz,
      last_responded_at timestamptz,
      event_team_id uuid not null
    );

    create function public.get_parent_portal_invitation_state_match_selection86_legacy(parent_link_id_value uuid)
    returns table (
      invitation_id text, invitation_type text, source_record_id uuid, source_type text,
      source_event_type text, event_id uuid, event_type text, event_title text,
      event_date date, kickoff_time_tbc boolean, event_start timestamptz, event_end timestamptz,
      event_location text, team_name text, child_id uuid, child_name text, parent_link_id uuid,
      role_type text, invitation_state text, response_state text, selection_state text,
      can_respond boolean, can_change_response boolean, lock_reason text,
      response_deadline timestamptz, last_responded_at timestamptz
    ) language sql stable security definer set search_path = '' as $$
      select row.invitation_id, row.invitation_type, row.source_record_id, row.source_type,
        row.source_event_type, row.event_id, row.event_type, row.event_title, row.event_date,
        row.kickoff_time_tbc, row.event_start, row.event_end, row.event_location, row.team_name,
        row.child_id, row.child_name, row.parent_link_id, row.role_type, row.invitation_state,
        row.response_state, row.selection_state, row.can_respond, row.can_change_response,
        row.lock_reason, row.response_deadline, row.last_responded_at
      from public.legacy_invitation_rows row
      join public.parent_player_links link on link.id = row.parent_link_id
      join public.players child on child.id = link.player_id
      where link.id = parent_link_id_value
        and link.auth_user_id = (select auth.uid())
        and link.status = 'active'
        and child.status = 'active'
        and row.child_id = link.player_id
        and row.event_team_id = link.team_id
    $$;
  `)

  await db.query(`insert into public.players (id, status) values
    ($1, 'active'), ($2, 'active'), ($3, 'active'), ($4, 'archived')`,
  [ids.childA, ids.childB, ids.childRevoked, ids.archivedChild])
  await db.query(`insert into public.parent_player_links
    (id, auth_user_id, club_id, team_id, player_id, status) values
    ($1, $5, $9, $10, $6, 'active'),
    ($2, $5, $9, $11, $7, 'active'),
    ($3, $5, $9, $10, $8, 'revoked'),
    ($4, $5, $9, $10, $12, 'active')`,
  [ids.linkA, ids.linkB, ids.linkRevoked, ids.linkArchived, ids.parent, ids.childA, ids.childB, ids.childRevoked, ids.club, ids.teamA, ids.teamB, ids.archivedChild])
  await db.query(`insert into public.assessment_sessions (id, status) values
    ($1, 'open'), ($2, 'cancelled'), ($3, 'completed'), ($4, 'open')`,
  [ids.openSessionA, ids.cancelledSession, ids.completedSession, ids.openSessionB])
  await db.query(`insert into public.match_day_player_squad_decisions
    (match_day_id, player_id, club_id, status) values ($1, $2, $3, 'selected')`,
  [ids.match, ids.childA, ids.club])

  const rows = [
    ['open', ids.openSessionA, ids.linkA, ids.childA, ids.teamA, 'active', 'awaiting_response', true, true, 'assessment_session', 'calendar_attendance'],
    ['cancelled', ids.cancelledSession, ids.linkA, ids.childA, ids.teamA, 'active', 'available', true, true, 'assessment_session', 'calendar_attendance'],
    ['completed', ids.completedSession, ids.linkA, ids.childA, ids.teamA, 'active', 'available', true, true, 'assessment_session', 'calendar_attendance'],
    ['stale', ids.missingSession, ids.linkA, ids.childA, ids.teamA, 'active', 'awaiting_response', true, true, 'assessment_session', 'calendar_attendance'],
    ['wrong-team', ids.openSessionA, ids.linkA, ids.childA, ids.teamB, 'active', 'awaiting_response', true, true, 'assessment_session', 'calendar_attendance'],
    ['match', ids.match, ids.linkA, ids.childA, ids.teamA, 'active', 'awaiting_response', true, true, 'match_day', 'match_attendance'],
    ['child-b', ids.openSessionB, ids.linkB, ids.childB, ids.teamB, 'active', 'awaiting_response', true, true, 'assessment_session', 'calendar_attendance'],
    ['revoked', ids.openSessionA, ids.linkRevoked, ids.childRevoked, ids.teamA, 'active', 'awaiting_response', true, true, 'assessment_session', 'calendar_attendance'],
    ['archived', ids.openSessionA, ids.linkArchived, ids.archivedChild, ids.teamA, 'active', 'awaiting_response', true, true, 'assessment_session', 'calendar_attendance'],
  ]
  for (const [name, eventId, linkId, childId, teamId, state, response, canRespond, canChange, sourceEventType, invitationType] of rows) {
    await db.query(`insert into public.legacy_invitation_rows (
      invitation_id, invitation_type, source_record_id, source_type, source_event_type,
      event_id, event_type, event_title, event_date, event_start, event_end, child_id,
      parent_link_id, invitation_state, response_state, selection_state, can_respond,
      can_change_response, event_team_id
    ) values ($1, $2, $3, $4, $4, $3, $4, $1, '2026-08-17',
      '2026-08-17T08:00:00Z', '2026-08-17T09:00:00Z', $5, $6, $7, $8,
      'legacy', $9, $10, $11)`,
    [`invite-${name}`, invitationType, eventId, sourceEventType, childId, linkId, state, response, canRespond, canChange, teamId])
  }
  await db.exec(migration)
  return db
}

test('Parent product time conversion is fixed to Europe/London across BST, GMT, DST, and midnight', () => {
  assert.equal(PARENT_PRODUCT_TIME_ZONE, 'Europe/London')
  assert.deepEqual(getParentProductDateTimeParts('2026-08-17T08:00:00Z'), {
    date: '2026-08-17', hasTime: true, instant: new Date('2026-08-17T08:00:00Z'), isAllDay: false, isValid: true, time: '09:00',
  })
  assert.equal(getParentProductDateTimeParts('2026-12-17T09:00:00Z').time, '09:00')
  assert.equal(getParentProductDateTimeParts('2026-03-29T00:30:00Z').time, '00:30')
  assert.equal(getParentProductDateTimeParts('2026-03-29T01:30:00Z').time, '02:30')
  assert.equal(getParentProductDateTimeParts('2026-10-25T00:30:00Z').time, '01:30')
  assert.equal(getParentProductDateTimeParts('2026-10-25T01:30:00Z').time, '01:30')
  assert.ok(getParentProductSortTimestamp('2026-10-25T00:30:00Z') < getParentProductSortTimestamp('2026-10-25T01:30:00Z'))
  assert.deepEqual(getParentProductDateTimeParts('2026-08-17T23:30:00Z').date, '2026-08-18')
  assert.match(formatParentProductDateTime('2026-08-17T08:00:00Z'), /17 Aug.*09:00/)
  assert.match(formatParentProductDateTime('2026-08-17T09:00:00Z'), /17 Aug.*10:00/)
})

test('all-day, local product time, malformed, and null values are handled deterministically', () => {
  assert.deepEqual(getParentProductDateTimeParts('2026-08-17'), {
    date: '2026-08-17', hasTime: false, instant: null, isAllDay: true, isValid: true, time: '',
  })
  assert.equal(getParentProductDateTimeParts('2026-08-17T09:00:00').time, '09:00')
  assert.equal(getParentProductDateTimeParts('09:00:00').time, '09:00')
  assert.equal(formatParentProductTime('09:00:00'), '09:00')
  assert.equal(getParentProductDateTimeParts('2026-02-30').isValid, false)
  assert.equal(getParentProductDateTimeParts('not-a-time').isValid, false)
  assert.equal(getParentProductDateTimeParts(null).isValid, false)
  assert.equal(formatParentProductDateTime(null), 'Time to be confirmed')
})

test('Parent Calendar converts Assessment times, removes cancellations, reschedules, and avoids duplicates', () => {
  const cancelled = {
    childName: 'Alex', eventEnd: '2026-08-10T09:00:00Z', eventId: ids.cancelledSession,
    eventStart: '2026-08-10T08:00:00Z', eventTitle: 'Assessment', invitationId: 'invite-cancelled',
    invitationState: 'cancelled', invitationType: 'calendar_attendance', responseState: 'available',
    sourceEventType: 'assessment_session', sourceRecordId: ids.cancelledSession,
  }
  const cancelledEvents = buildParentCalendarEvents({ invitations: [cancelled] })
  assert.equal(cancelledEvents.length, 0)

  const rescheduled = buildParentCalendarEvents({ invitations: [{
    ...cancelled,
    eventStart: '2026-08-17T09:00:00Z',
    invitationId: 'invite-rescheduled',
    invitationState: 'active',
  }] })[0]
  assert.equal(rescheduled.calendarDate, '2026-08-17')
  assert.equal(rescheduled.calendarTime, '10:00')
  assert.equal(rescheduled.status, 'scheduled')

  const deduplicated = buildParentCalendarEvents({
    calendarEvents: [{ id: ids.cancelledSession, startsAt: '2026-08-10T08:00:00Z', title: 'Assessment' }],
    invitations: [cancelled],
  })
  assert.equal(deduplicated.length, 0)

  const homeGroups = getParentCalendarGroups([
    { ...rescheduled, status: 'closed' },
    { calendarDate: '2026-08-10', startsAt: '2026-08-10', status: 'scheduled' },
  ], new Date('2026-08-10T12:00:00Z'))
  assert.equal(homeGroups.upcoming.length, 1)
  assert.equal(homeGroups.recent.length, 1)
})

test('Parent Match Calendar preserves canonical time-only fields and local sort semantics', () => {
  const [match] = buildParentCalendarEvents({
    matches: [{
      id: ids.match,
      kickoffTime: '09:00:00',
      matchDate: '2026-08-17',
      opponent: 'Rovers',
      status: 'scheduled',
      teamName: 'Demo Team',
    }],
  })
  assert.equal(match.calendarDate, '2026-08-17')
  assert.equal(match.calendarTime, '09:00')
  assert.equal(match.sortKey, '2026-08-17T09:00')
  assert.equal(formatParentProductTime('09:00:00'), '09:00')
})

test('Parent Home compares Match and Calendar activity in the same London wall-time model', () => {
  for (const [name, calendarStart, now] of [
    ['BST', '2026-08-17T08:30:00Z', '2026-08-10T12:00:00Z'],
    ['GMT', '2026-12-17T09:30:00Z', '2026-12-10T12:00:00Z'],
  ]) {
    const matchDate = name === 'BST' ? '2026-08-17' : '2026-12-17'
    const home = getParentHomeModel({
      calendarEvents: [{ id: `calendar-${name}`, startsAt: calendarStart, status: 'scheduled' }],
      matches: [{ id: `match-${name}`, kickoffTime: '09:00:00', matchDate, status: 'scheduled' }],
      messages: [],
      now: new Date(now),
      polls: [],
    })
    assert.equal(home.nextActivity.type, 'match', `${name} should place the 09:00 Match before the 09:30 Calendar item`)
  }
})

test('authoritative Assessment states preserve Parent authority and current invitation history', async (t) => {
  const db = await createAssessmentStateDatabase()
  t.after(() => db.close())
  await setActor(db, ids.parent)

  const linkA = await db.query('select * from public.get_parent_portal_invitation_state($1)', [ids.linkA])
  assert.deepEqual(linkA.rows.map((row) => row.invitation_id).sort(), ['invite-cancelled', 'invite-completed', 'invite-match', 'invite-open'])
  const open = linkA.rows.find((row) => row.invitation_id === 'invite-open')
  assert.equal(open.invitation_state, 'active')
  assert.equal(open.can_respond, true)
  const cancelled = linkA.rows.find((row) => row.invitation_id === 'invite-cancelled')
  assert.equal(cancelled.invitation_state, 'cancelled')
  assert.equal(cancelled.response_state, 'available')
  assert.equal(cancelled.can_respond, false)
  assert.equal(cancelled.can_change_response, false)
  assert.match(cancelled.lock_reason, /cancelled/i)
  const completed = linkA.rows.find((row) => row.invitation_id === 'invite-completed')
  assert.equal(completed.invitation_state, 'closed')
  assert.equal(completed.response_state, 'available')
  assert.equal(completed.can_respond, false)
  assert.match(completed.lock_reason, /complete/i)
  assert.equal(linkA.rows.some((row) => row.invitation_id === 'invite-stale'), false)
  assert.equal(linkA.rows.some((row) => row.invitation_id === 'invite-wrong-team'), false)
  assert.equal(linkA.rows.find((row) => row.invitation_id === 'invite-match').selection_state, 'selected')
  assert.equal(linkA.rows.filter((row) => ['active', 'offered'].includes(row.invitation_state) && row.can_respond).length, 2)

  const switchedChild = await db.query('select invitation_id from public.get_parent_portal_invitation_state($1)', [ids.linkB])
  assert.deepEqual(switchedChild.rows, [{ invitation_id: 'invite-child-b' }])
  assert.equal((await db.query('select * from public.get_parent_portal_invitation_state($1)', [ids.linkRevoked])).rows.length, 0)
  assert.equal((await db.query('select * from public.get_parent_portal_invitation_state($1)', [ids.linkArchived])).rows.length, 0)
  await setActor(db, ids.wrongParent)
  assert.equal((await db.query('select * from public.get_parent_portal_invitation_state($1)', [ids.linkA])).rows.length, 0)
})

test('migration is read-only, authenticated-only, ledger-safe, and does not create duplicate events', async () => {
  const migration = await readFile(migrationUrl, 'utf8')
  assert.match(migration, /security definer\s+set search_path = ''/i)
  assert.match(migration, /get_parent_portal_invitation_state_match_selection86_legacy/i)
  assert.match(migration, /assessment_session\.status = 'cancelled'[\s\S]*then 'cancelled'/i)
  assert.match(migration, /assessment_session\.status = 'completed'[\s\S]*then 'closed'/i)
  assert.match(migration, /assessment_session\.id is not null/i)
  assert.match(migration, /revoke execute[^;]+from anon/i)
  assert.match(migration, /grant execute[^;]+to authenticated, service_role/i)
  assert.doesNotMatch(migration, /\b(insert|update|delete|truncate)\b/i)
  assert.doesNotMatch(migration, /calendar_events/i)
})

test('Parent Home, Calendar, Invites, and detail paths share derived terminal state and safe formatting', async () => {
  const [app, calendarCore, data, screens] = await Promise.all([
    readFile(parentAppUrl, 'utf8'),
    readFile(calendarCoreUrl, 'utf8'),
    readFile(parentDataUrl, 'utf8'),
    readFile(parentScreensUrl, 'utf8'),
  ])
  assert.match(app, /formatParentProductDateTime/)
  assert.match(app, /formatParentProductTime/)
  assert.match(screens, /formatParentProductDateTime/)
  assert.match(screens, /formatParentProductTime/)
  assert.match(screens, /getParentInvitationDisplayState/)
  assert.match(screens, /isParentInvitationActionable/)
  assert.match(data, /\['active', 'offered'\]\.includes\(invitationState\)/)
  assert.match(data, /This invitation is no longer available for response/)
  assert.match(calendarCore, /\['cancelled', 'closed', 'expired'\]\.includes\(invitationState\)/)
  assert.doesNotMatch(calendarCore, /match\(\/\^\\d\{4\}-\\d\{2\}-\\d\{2\}/)
  assert.doesNotMatch(calendarCore, /match\(\/T\(\\d\{2\}\):\(\\d\{2\}\)/)
  assert.doesNotMatch(app, /slice\(0,\s*5\)/)
  assert.doesNotMatch(app, /toLocaleDateString/)
  assert.doesNotMatch(screens, /slice\(0,\s*5\)/)
  assert.doesNotMatch(screens, /toLocaleDateString/)
})
