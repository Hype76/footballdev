import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'

import { sendExpoPushMessages } from '../netlify/functions/lib/_expo-push.js'

const read = (path) => readFile(new URL(path, import.meta.url), 'utf8')

test('availability creation selects every Player without an existing request by default', async () => {
  const screen = await read('../apps/coach-mobile/src/CoachPhase31EScreens.js')
  assert.match(screen, /Send to all \$\{availablePlayers\.length\} Players without a request/)
  assert.match(screen, /setPlayerIds\(next \? availablePlayers\.map\(\(player\) => player\.id\) : \[\]\)/)
  assert.match(screen, /All eligible Players are selected by default/)
  assert.match(screen, /Review and send \$\{playerIds\.length\} request/)
})

test('Coach Player detail keeps Development compact and at the bottom', async () => {
  const screen = await read('../apps/coach-mobile/src/CoachOperationalScreens.js')
  assert.match(screen, /developmentOpen/)
  assert.match(screen, /Show recent records/)
  assert.match(screen, /detail\.evaluations\.slice\(0, 5\)/)
  assert.match(screen, /Showing the 5 most recent records/)
  assert.doesNotMatch(screen, /detail\.evaluations\.length \? detail\.evaluations\.map/)
})

test('Parent Development PDFs are generated from the authorised report snapshot on demand', async () => {
  const [history, handler] = await Promise.all([
    read('../netlify/functions/lib/_parent-development-history.js'),
    read('../netlify/functions/parent-development-history.js'),
  ])
  assert.match(history, /pdfState: pdfAttached \? 'attached' : 'generated_on_demand'/)
  assert.match(history, /canDownloadPdf: true/)
  assert.match(handler, /if \(!reportSnapshot\)/)
  assert.doesNotMatch(handler, /!report\.canDownloadPdf/)
})

test('Parent Calendar legend is an interactive event filter', async () => {
  const screen = await read('../apps/parent-mobile/src/ParentPortalScreens.js')
  assert.match(screen, /accessibilityLabel="Calendar filters"/)
  assert.match(screen, /toggleMarkerTone/)
  assert.match(screen, /accessibilityState=\{\{ selected \}\}/)
  assert.match(screen, /getParentCalendarMonthGrid\(filteredEvents, monthCursor\)/)
})

test('resource notifications respect the Parent channel and deep-link to Resources', async () => {
  const [resourceEmail, worker, push] = await Promise.all([
    read('../netlify/functions/lib/_resource-notification-email.js'),
    read('../netlify/functions/process-scheduled-emails.js'),
    read('../netlify/functions/send-parent-mobile-push.js'),
  ])
  assert.match(resourceEmail, /notificationId: context\.notificationId/)
  assert.match(worker, /type: 'resource_shared'/)
  assert.match(push, /route: 'resources'/)
  assert.match(push, /\['matchday_availability', 'parent_message', 'parent_poll', 'resource_shared', 'training_availability'\]/)
})

test('Parent notification inbox is child-scoped and read state remains service-only', async () => {
  const [app, endpoint, migration] = await Promise.all([
    read('../apps/parent-mobile/App.js'),
    read('../netlify/functions/parent-mobile-notifications.js'),
    read('../supabase/migrations/20260818103000_parent_notification_inbox_resource_badges.sql'),
  ])
  assert.match(app, /title="Notifications"/)
  assert.match(app, /onOpenNotification/)
  assert.match(app, /getNotificationTypeIcon/)
  assert.match(app, /MaterialIcons/)
  assert.match(endpoint, /\.eq\('parent_link_id', link\.id\)/)
  assert.match(endpoint, /\.eq\('auth_user_id', authUser\.id\)/)
  assert.match(migration, /add column if not exists read_at timestamptz/)
  assert.match(migration, /revoke all on public\.parent_mobile_notification_events from public, anon, authenticated/)
})

test('pushes set a visible badge and neither app clears it during normal startup', async () => {
  const [parentNotifications, coachNotifications, sharedNotifications] = await Promise.all([
    read('../apps/parent-mobile/src/notifications.js'),
    read('../apps/coach-mobile/src/notifications.js'),
    read('../apps/mobile-core/src/notifications.js'),
  ])
  assert.match(parentNotifications, /shouldSetBadge: true/)
  assert.match(coachNotifications, /shouldSetBadge: true/)
  assert.doesNotMatch(sharedNotifications, /setBadgeCountAsync\(0\)/)

  const originalFetch = globalThis.fetch
  let outgoing = null
  globalThis.fetch = async (_url, options) => {
    outgoing = JSON.parse(options.body)
    return { ok: true, json: async () => ({ data: [{ status: 'ok' }] }) }
  }
  try {
    await sendExpoPushMessages([{ to: 'ExpoPushToken[badge-test]', title: 'Update' }])
    assert.equal(outgoing[0].badge, 1)
  } finally {
    globalThis.fetch = originalFetch
  }
})

test('Parent Poll final results use an idempotent preference-aware scheduled delivery', async () => {
  const [mobileScreen, webScreen, mobileData, webDomain, worker, migration] = await Promise.all([
    read('../apps/coach-mobile/src/CoachPhase31EScreens.js'),
    read('../src/pages/PollsPage.jsx'),
    read('../apps/mobile-core/src/coachPhase31EData.js'),
    read('../src/lib/domain/polls.js'),
    read('../netlify/functions/send-poll-result-notifications.js'),
    read('../supabase/migrations/20260818104500_poll_result_delivery.sql'),
  ])
  assert.match(mobileScreen, /Send final Poll results/)
  assert.match(webScreen, /Send final results when the poll closes/)
  assert.match(mobileData, /configure_poll_result_delivery/)
  assert.match(webDomain, /configure_poll_result_delivery/)
  assert.match(worker, /everyoneReplied/)
  assert.match(worker, /deadlineReached/)
  assert.match(worker, /getParentCommunicationChannels/)
  assert.match(worker, /idempotencyKey: `poll-results:/)
  assert.match(worker, /intent_type: 'poll_results'/)
  assert.match(migration, /unique \(poll_id, auth_user_id\)/)
  assert.match(migration, /notify_results_on_close boolean not null default false/)
})

test('release 66 authorises only the guarded Coach and Parent internal production builds', async () => {
  const [guard, submitGuard] = await Promise.all([
    read('../apps/scripts/mobile-build-guard.mjs'),
    read('../apps/scripts/mobile-submit-guard.mjs'),
  ])
  const occurrences = guard.match(/FP-MOBILE-NOTIFICATIONS-PROFILE-66/g) || []
  assert.equal(occurrences.length, 3)
  assert.match(guard, /const productionBuilds = new Set/)
  assert.match(guard, /const currentInternalIos/)
  assert.match(submitGuard, /promotionReference === 'FP-MOBILE-NOTIFICATIONS-PROFILE-66'/)
  assert.match(submitGuard, /--groups', 'Internal Testers'/)
})
