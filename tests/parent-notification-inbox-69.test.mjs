import assert from 'node:assert/strict'
import { test } from 'node:test'

import {
  getParentNotificationDedupeKey,
  writeParentNotificationInbox,
} from '../netlify/functions/lib/_parent-notification-inbox.js'

test('Parent inbox dedupe keys are stable per source, intent, and Parent link', () => {
  assert.equal(getParentNotificationDedupeKey({
    data: { availabilityRequestId: 'request-1' },
    intentType: 'matchday_update',
    parentLinkId: 'link-1',
  }), 'matchday_update:link-1:request-1')
  assert.equal(getParentNotificationDedupeKey({
    data: { matchDayId: 'match-1', type: 'yellow_card' },
    intentType: 'matchday_update',
    parentLinkId: 'link-1',
  }), 'matchday_update:link-1:match-1')
  assert.equal(getParentNotificationDedupeKey({
    data: { notificationId: 'notification-1', resourceId: 'resource-1' },
    intentType: 'resource_shared',
    parentLinkId: 'link-1',
  }), 'resource_shared:link-1:notification-1')
})

test('Parent inbox writes one canonical event per link without needing an installation', async () => {
  const calls = []
  const client = {
    from(table) {
      return {
        upsert(rows, options) {
          calls.push({ table, rows, options })
          return { select: async () => ({ data: rows.map((_, index) => ({ id: `event-${index}` })), error: null }) }
        },
      }
    },
  }
  const result = await writeParentNotificationInbox({
    body: 'Response needed.',
    client,
    clubId: 'club-1',
    data: { availabilityRequestId: 'request-1', route: 'invites', type: 'matchday_availability' },
    intentType: 'matchday_update',
    parentLinks: [
      { id: 'link-1', auth_user_id: 'user-1' },
      { id: 'link-1', auth_user_id: 'user-1' },
      { id: 'link-2', auth_user_id: 'user-2' },
    ],
    teamId: 'team-1',
    title: 'Availability needed',
  })

  assert.deepEqual(result, { available: 2, inserted: 2 })
  assert.equal(calls.length, 1)
  assert.equal(calls[0].table, 'parent_mobile_notification_events')
  assert.deepEqual(calls[0].options, { ignoreDuplicates: true, onConflict: 'dedupe_key' })
  assert.deepEqual(calls[0].rows.map((row) => row.installation_id), [null, null])
  assert.deepEqual(calls[0].rows.map((row) => row.dedupe_key), [
    'matchday_update:link-1:request-1',
    'matchday_update:link-2:request-1',
  ])
})

test('Parent inbox refuses an event without a durable source identity', async () => {
  const result = await writeParentNotificationInbox({
    client: { from() { throw new Error('must not write') } },
    intentType: 'parent_message',
    parentLinks: [{ id: 'link-1', auth_user_id: 'user-1' }],
  })
  assert.deepEqual(result, { available: 0, inserted: 0 })
})
