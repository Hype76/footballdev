import assert from 'node:assert/strict'
import test from 'node:test'
import { getParentChildNotificationBadges } from '../netlify/functions/lib/_parent-child-notification-badges.js'

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
