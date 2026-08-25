import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'

import { PGlite } from '@electric-sql/pglite'

const root = new URL('../', import.meta.url)
const source = (path) => readFile(new URL(path, root), 'utf8')

test('Calendar change notification storage is service-only and accepts the three explicit change actions', async () => {
  const migration = await source('supabase/migrations/20260825163154_calendar_change_notification_preparations.sql')
  const db = new PGlite()
  try {
    await db.exec(`
      create role anon;
      create role authenticated;
      create role service_role;
      create schema auth;
      create table auth.users (id uuid primary key);
      create table public.clubs (id uuid primary key);
      create table public.teams (id uuid primary key);
      create table public.parent_mobile_notification_events (intent_type text);
    `)
    await db.exec(migration)
    await db.exec(`
      insert into auth.users values ('10000000-0000-4000-8000-000000000001');
      insert into public.clubs values ('20000000-0000-4000-8000-000000000001');
      insert into public.teams values ('30000000-0000-4000-8000-000000000001');
    `)
    for (const [index, action] of ['rescheduled', 'cancelled', 'deleted'].entries()) {
      await db.query(`
        insert into public.calendar_change_notification_preparations (
          request_token, actor_user_id, club_id, team_id, source_type, source_id, change_action
        ) values ($1, $2, $3, $4, 'calendar', $5, $6)
      `, [
        `40000000-0000-4000-8000-00000000000${index + 1}`,
        '10000000-0000-4000-8000-000000000001',
        '20000000-0000-4000-8000-000000000001',
        '30000000-0000-4000-8000-000000000001',
        `50000000-0000-4000-8000-00000000000${index + 1}`,
        action,
      ])
    }
    await db.exec("insert into public.parent_mobile_notification_events (intent_type) values ('calendar_update')")
    const result = await db.query('select change_action from public.calendar_change_notification_preparations order by change_action')
    assert.deepEqual(result.rows.map((row) => row.change_action), ['cancelled', 'deleted', 'rescheduled'])
    await assert.rejects(
      db.exec("insert into public.parent_mobile_notification_events (intent_type) values ('unsafe_internal_type')"),
      /parent_mobile_notification_events_intent_check/,
    )
  } finally {
    await db.close()
  }
})

test('web asks before reschedules, cancellations, and deletions and commits only after the mutation', async () => {
  const [page, matchDay, client, modal] = await Promise.all([
    source('src/pages/SessionsPage.jsx'),
    source('src/pages/MatchDayPage.jsx'),
    source('src/lib/calendar-change-notifications.js'),
    source('src/components/ui/ConfirmModal.jsx'),
  ])
  assert.match(page, /Notify everyone about this \$\{calendarChangePrompt\?\.action/)
  assert.match(page, /secondaryActionLabel="Do not notify"/)
  assert.match(page, /prepareCalendarChangeNotification[\s\S]*commitCalendarChangeNotification/)
  assert.doesNotMatch(page, /window\.confirm\(deleteMessage\)/)
  assert.match(matchDay, /notificationChoice: status === 'cancelled'/)
  assert.match(client, /operation: 'prepare'/)
  assert.match(client, /operation: 'commit'/)
  assert.match(modal, /secondaryActionLabel/)
})

test('Coach OTA Calendar asks the same question and supports reschedule, cancel, and delete', async () => {
  const [screen, data] = await Promise.all([
    source('apps/coach-mobile/src/CoachOperationalScreens.js'),
    source('apps/mobile-core/src/coachCalendarData.js'),
  ])
  assert.match(screen, /Alert\.alert\(/)
  assert.match(screen, /Notify everyone/)
  assert.match(screen, /Do not notify/)
  assert.match(screen, /prepareCoachCalendarChangeNotification\(selected, 'rescheduled'\)/)
  assert.match(screen, /changeEventState\('cancelled'\)/)
  assert.match(screen, /changeEventState\('deleted'\)/)
  assert.match(data, /calendar-change-notifications/)
  assert.match(data, /commitCoachCalendarChangeNotification/)
})

test('server captures recipient authority before the change and verifies it before delivery', async () => {
  const sender = await source('netlify/functions/calendar-change-notifications.js')
  assert.match(sender, /parent_link_ids: parentLinkIds/)
  assert.match(sender, /verifyChange\(preparation\)/)
  assert.match(sender, /if \(!verification\.changed\)/)
  assert.match(sender, /writeParentNotificationInbox/)
  assert.match(sender, /sendExpoPushMessages/)
  assert.match(sender, /sendEmail/)
  assert.match(sender, /if \(!link\.auth_user_id\) return Boolean\(normalizeText\(link\.email\)\)/)
  assert.match(sender, /status: 'committed'/)
})

test('Calendar change copy keeps UK local times and date-only changes free of invented times', async () => {
  const { buildCalendarNotificationLocalDateTime, formatCalendarNotificationDateTime } = await import('../src/lib/calendar-notification-email.js')
  assert.equal(buildCalendarNotificationLocalDateTime('2026-08-25', '12:00'), '2026-08-25T12:00:00+01:00')
  assert.equal(buildCalendarNotificationLocalDateTime('2026-12-25', '12:00'), '2026-12-25T12:00:00Z')
  assert.doesNotMatch(formatCalendarNotificationDateTime('2026-08-25'), /12:00|13:00/)
})

test('Goal, Yellow, Red, and Substitution all use compact detailed copy and the shared sender route', async () => {
  const [copy, page, coach] = await Promise.all([
    source('netlify/functions/lib/_match-day-notification-copy.js'),
    source('src/pages/MatchDayPage.jsx'),
    source('apps/mobile-core/src/coachMatchDayData.js'),
  ])
  assert.match(copy, /Goal: \$\{scorer\}/)
  assert.match(copy, /Yellow: \$\{formatPerson/)
  assert.match(copy, /Red: \$\{formatPerson/)
  assert.match(copy, /Sub: \$\{formatPerson/)
  assert.match(page, /\['yellow_card', 'red_card', 'substitution'\]\.includes/)
  assert.match(coach, /type === 'goal' \|\| type === 'yellow_card' \|\| type === 'red_card' \|\| type === 'substitution'/)
})
