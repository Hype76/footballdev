import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { test } from 'node:test'

const read = (path) => readFile(new URL(path, import.meta.url), 'utf8')

test('Match and Training invitations share one authoritative recipient resolver', async () => {
  const [automaticTraining, manualInvitation, resolver, migration] = await Promise.all([
    read('../netlify/functions/process-training-availability-requests.js'),
    read('../netlify/functions/send-event-player-invitation.js'),
    read('../netlify/functions/lib/_match-day-actionable-invitation.js'),
    read('../supabase/migrations/20260818153000_invite_notification_fanout_integrity.sql'),
  ])

  assert.match(automaticTraining, /resolveEligibleEventInvitationContacts/)
  assert.match(manualInvitation, /resolveEligibleEventInvitationContacts/)
  assert.match(resolver, /rpc\('event_player_eligible_recipients'/)
  assert.match(migration, /from public\.player_team_memberships membership/)
  assert.match(migration, /join auth\.users parent_auth/)
  assert.doesNotMatch(migration, /join public\.users parent_profile/)
})

test('Parent inbox delivery is independent of devices and protected against duplicates', async () => {
  const [migration, helper, scheduledWorker, schedulerWrapper] = await Promise.all([
    read('../supabase/migrations/20260818153000_invite_notification_fanout_integrity.sql'),
    read('../netlify/functions/lib/_parent-notification-inbox.js'),
    read('../netlify/functions/process-scheduled-emails.js'),
    read('../netlify/functions/send-scheduled-emails.js'),
  ])

  assert.match(migration, /add column if not exists dedupe_key text/)
  assert.match(migration, /create unique index if not exists parent_mobile_notification_events_dedupe_key/)
  assert.match(migration, /'training_update'/)
  assert.match(helper, /installation_id: null/)
  assert.match(helper, /onConflict: 'dedupe_key'/)
  assert.match(scheduledWorker, /Number\(pushResult\?\.inbox \|\| 0\) > 0/)
  assert.match(schedulerWrapper, /schedule: '\* \* \* \* \*'/)
})

test('Every Parent notification path keeps its exact deep link source', async () => {
  const [directPush, matchDayPush, chatPollWorker, pollResults] = await Promise.all([
    read('../netlify/functions/send-parent-mobile-push.js'),
    read('../netlify/functions/send-match-day-push.js'),
    read('../netlify/functions/process-chat-mobile-notifications.js'),
    read('../netlify/functions/send-poll-result-notifications.js'),
  ])

  assert.match(directPush, /availabilityRequestId: request\.id/)
  assert.match(directPush, /trainingRequestPlayerId: requestPlayer\.id/)
  assert.match(directPush, /notificationId: notification\.id/)
  assert.match(directPush, /pollId: poll\.id/)
  assert.match(matchDayPush, /writeParentNotificationInbox/)
  assert.match(chatPollWorker, /messageId: normalizeText\(intent\.message_id\)/)
  assert.match(pollResults, /pollId: poll\.id/)
})
