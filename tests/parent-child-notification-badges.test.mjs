import assert from 'node:assert/strict'
import test from 'node:test'
import { getParentChildNotificationBadges } from '../netlify/functions/lib/_parent-child-notification-badges.js'
import { countUnreadGeneralNotifications, prepareParentNotificationInbox } from '../apps/mobile-core/src/parentNotificationInboxCore.js'

function badgeFixture(events) {
  const links = ['lucas', 'jenson-jpl', 'jenson-eja'].map((id) => ({ id, auth_user_id: 'parent', status: 'active', created_at: '2026-01-01' }))
  const admin = { from(table) {
    let rows = table === 'parent_player_links' ? links : events
    const query = {
      select() { return query },
      eq(key, value) { rows = rows.filter((row) => row[key] === value); return query },
      is(key, value) { rows = rows.filter((row) => row[key] === value); return query },
      gte() { return query }, order() { return query }, limit() { return query },
      then(resolve) { return Promise.resolve({ data: rows, error: null }).then(resolve) },
    }
    return query
  } }
  const collapse = (rows) => prepareParentNotificationInbox(rows.map((row) => ({
    id: row.id, intentType: row.intent_type, data: row.data || {}, isRead: Boolean(row.read_at),
    sentAt: row.sent_at, isBadgeEligible: row.isBadgeEligible,
  })))
  return { read: () => getParentChildNotificationBadges({ admin, authUserId: 'parent', collapse, filterAvailable: async (rows) => rows }), collapse }
}

function event(id, parentLinkId, overrides = {}) {
  return { id, parent_link_id: parentLinkId, auth_user_id: 'parent', status: 'sent', dismissed_at: null, read_at: null, intent_type: 'parent_message', ...overrides }
}

test('player dots match the Notifications counter and exclude separate chat, poll and invitation alerts', async () => {
  const events = [
    event('chat', 'lucas', { intent_type: 'parent_chat', data: { route: 'chat', roomId: 'room' } }),
    event('poll', 'lucas', { intent_type: 'parent_poll', data: { pollId: 'poll' } }),
    event('invite', 'lucas', { intent_type: 'matchday_update', data: { availabilityRequestId: 'request' } }),
    event('training', 'lucas', { intent_type: 'training_update', data: { trainingRequestPlayerId: 'training' } }),
    event('read-news', 'lucas', { read_at: '2026-09-11T10:00:00Z' }),
    event('old-match', 'lucas', { intent_type: 'matchday_update', isBadgeEligible: false }),
    event('new-news', 'jenson-jpl'),
  ]
  const fixture = badgeFixture(events)
  const counts = await fixture.read()
  assert.deepEqual(counts, { lucas: 0, 'jenson-jpl': 1, 'jenson-eja': 0 })
  for (const linkId of Object.keys(counts)) {
    assert.equal(counts[linkId], countUnreadGeneralNotifications(fixture.collapse(events.filter((row) => row.parent_link_id === linkId))))
  }
})

test('reading the final notification clears only that player-team dot and a new update restores it', async () => {
  const events = [event('lucas-news', 'lucas'), event('jpl-news', 'jenson-jpl'), event('eja-news', 'jenson-eja')]
  const fixture = badgeFixture(events)
  assert.deepEqual(await fixture.read(), { lucas: 1, 'jenson-jpl': 1, 'jenson-eja': 1 })
  events[0].read_at = '2026-09-11T11:00:00Z'
  assert.deepEqual(await fixture.read(), { lucas: 0, 'jenson-jpl': 1, 'jenson-eja': 1 })
  events.push(event('new-lucas-news', 'lucas'))
  assert.deepEqual(await fixture.read(), { lucas: 1, 'jenson-jpl': 1, 'jenson-eja': 1 })
  events[1].dismissed_at = '2026-09-11T11:01:00Z'
  assert.deepEqual(await fixture.read(), { lucas: 1, 'jenson-jpl': 0, 'jenson-eja': 1 })
})

test('child badge summary returns only the signed in Parents active links and never mutates events', async () => {
  const calls = []
  const tables = {
    parent_player_links: [
      { id: 'one', auth_user_id: 'parent', status: 'active', created_at: '2026-01-01' },
      { id: 'two', auth_user_id: 'parent', status: 'active', created_at: '2026-01-01' },
      { id: 'foreign', auth_user_id: 'other', status: 'active', created_at: '2026-01-01' },
    ],
    parent_mobile_notification_events: [
      { id: '1', auth_user_id: 'parent', parent_link_id: 'one', status: 'sent', dismissed_at: null, read_at: null },
      { id: '2', auth_user_id: 'parent', parent_link_id: 'one', status: 'sent', dismissed_at: null, read_at: 'now' },
      { id: '3', auth_user_id: 'parent', parent_link_id: 'two', status: 'sent', dismissed_at: null, read_at: null },
    ],
  }
  const admin = { from(table) {
    let rows = tables[table]; const query = {
      select() { calls.push(['select', table]); return query },
      eq(key, value) { rows = rows.filter((row) => row[key] === value); return query },
      is(key, value) { rows = rows.filter((row) => row[key] === value); return query },
      gte() { return query }, order() { return query }, limit() { return Promise.resolve({ data: rows, error: null }) },
      then(resolve) { return Promise.resolve({ data: rows, error: null }).then(resolve) },
    }; return query
  } }
  const counts = await getParentChildNotificationBadges({ admin, authUserId: 'parent', collapse: (rows) => rows.map((row) => ({ ...row, isRead: Boolean(row.read_at) })), filterAvailable: async (rows) => rows })
  assert.deepEqual(counts, { one: 1, two: 1 })
  assert.equal(calls.every(([operation]) => operation === 'select'), true)
})
