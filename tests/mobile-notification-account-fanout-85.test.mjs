import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'

const readSource = (path) => readFile(new URL(`../${path}`, import.meta.url), 'utf8')

test('mobile notification fanout follows current account authority instead of selected UI context', async () => {
  const [migration, parentPush, matchPush, pollPush, coachPush, worker] = await Promise.all([
    readSource('supabase/migrations/20260824065755_mobile_notification_account_fanout_85.sql'),
    readSource('netlify/functions/send-parent-mobile-push.js'),
    readSource('netlify/functions/send-match-day-push.js'),
    readSource('netlify/functions/send-poll-result-notifications.js'),
    readSource('netlify/functions/send-coach-mobile-push.js'),
    readSource('netlify/functions/process-chat-mobile-notifications.js'),
  ])

  assert.match(migration, /join lateral \([\s\S]*parent_chat_parent_link_can_receive_notification/)
  assert.match(migration, /order by \(link\.id = installation\.parent_link_id\) desc/)
  assert.match(migration, /app_private\.parent_chat_mobile_notification_intent_is_current/)
  assert.match(migration, /app_private\.staff_chat_mobile_notification_intent_is_current/)
  assert.match(migration, /coalesce\(parent_link\.team_id, player\.team_id\) = poll\.team_id/)
  assert.doesNotMatch(migration, /installation\.context_id = 'team:' \|\| target_room\.team_id/)
  assert.doesNotMatch(migration, /installation\.team_id = target_conversation\.team_id/)

  assert.match(parentPush, /\.in\('auth_user_id', authUserIds\)/)
  assert.match(parentPush, /targetLink = links\.find/)
  assert.match(matchPush, /\.in\('auth_user_id', authUserIds\)/)
  assert.match(matchPush, /targetParentLinks: appNotificationParentLinks/)
  assert.match(pollPush, /getPushDevices\(authUserId\)/)
  assert.match(pollPush, /parentLinkId: link\.id/)
  assert.match(coachPush, /\.eq\('id', match\.team_id\)/)
  assert.doesNotMatch(coachPush, /team_id\.is\.null,team_id\.eq/)
  assert.match(worker, /getCoachTargetContext/)
  assert.match(worker, /if \(normalizeText\(teamId\)\) return `team:/)
})

test('signed out mobile apps retain their authorised installation while local data is cleared', async () => {
  const [auth, parentApp, coachApp] = await Promise.all([
    readSource('apps/mobile-core/src/auth.js'),
    readSource('apps/parent-mobile/App.js'),
    readSource('apps/coach-mobile/App.js'),
  ])

  assert.match(auth, /!preserveNativePushOnSignOut/)
  assert.match(parentApp, /preserveNativePushOnSignOut/)
  assert.match(coachApp, /preserveNativePushOnSignOut/)
  assert.match(coachApp, /clearCoachBeforeSignOut[\s\S]*clearCoachAllLocalState/)
  assert.doesNotMatch(parentApp, /onBeforeSignOut=\{unbindParentNotifications\}/)
  assert.doesNotMatch(coachApp, /unbindCoachNotifications/)
})

test('repository release policy keeps Parent and Coach mobile changes OTA only', async () => {
  const agents = await readSource('AGENTS.md')
  assert.match(agents, /Mobile app releases are OTA-only by default/)
  assert.match(agents, /Do not create, submit, or promote a new App Store or Google Play build/)
})
