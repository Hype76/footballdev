import assert from 'node:assert/strict'
import test from 'node:test'
import { readFile } from 'node:fs/promises'
import { PGlite } from '@electric-sql/pglite'
import { applyParentNotificationAction, countUnreadGeneralNotifications, getParentNotificationCategory, getParentOpenedNotificationIds, prepareParentUpdates } from '../apps/mobile-core/src/parentNotificationInboxCore.js'
import { updateParentNotificationInbox } from '../netlify/functions/lib/_parent-notification-actions.js'

const now = '2026-09-03T14:00:00Z'
const link = { id: 'child', created_at: '2026-01-01T00:00:00Z' }
const base = { auth_user_id: 'parent', parent_link_id: link.id, status: 'sent', sent_at: '2026-09-03T13:00:00Z', created_at: '2026-09-03T13:00:00Z', read_at: null, dismissed_at: null, data: {} }

function mockAdmin(rows) {
  const calls = []
  return { calls, from: () => {
    const filters = []; let patch; let start = 0; let end = Infinity
    const query = {
      select: () => query,
      eq: (key, value) => { filters.push((row) => row[key] === value); calls.push(['eq', key, value]); return query },
      is: (key, value) => { filters.push((row) => row[key] === value); return query },
      gte: (key, value) => { filters.push((row) => row[key] >= value); return query },
      or: () => { filters.push((row) => (row.sent_at || row.created_at) <= now); return query },
      order: () => query,
      in: (key, values) => { filters.push((row) => values.includes(String(row[key]))); return query },
      range: (from, to) => { start = from; end = to; calls.push(['range', from, to]); return query },
      update: (value) => { patch = value; return query },
      then: (resolve) => {
        const data = rows.filter((row) => filters.every((filter) => filter(row))).slice(start, end + 1)
        if (patch) data.forEach((row) => Object.assign(row, patch))
        return Promise.resolve({ data: data.map((row) => ({ ...row })) }).then(resolve)
      },
    }
    return query
  } }
}

test('general inbox excludes poll, invite and chat notifications before grouping matches', () => {
  const data = { parentLinkId: 'child', matchDayId: 'match', route: 'matchday' }
  const rows = [
    { id: 'score', intentType: 'matchday_update', data, isRead: false },
    { id: 'invite', intentType: 'matchday_update', data: { ...data, route: 'invites' }, isRead: false },
    { id: 'legacy-invite', intentType: 'matchday_update', data: { ...data, availabilityRequestId: 'request' }, isRead: false },
    { id: 'training', intentType: 'training_update', data: { trainingRequestPlayerId: 'training' } },
    { id: 'poll', intentType: 'parent_poll', data: {} },
    { id: 'result', intent_type: 'poll_results', data: {} },
    { id: 'chat', intentType: 'parent_chat', data: {} },
    { id: 'routed-chat', data: { route: 'chat', roomId: 'room' } },
    { id: 'news', intentType: 'parent_message', data: {}, isRead: true },
  ]
  assert.deepEqual(prepareParentUpdates(rows).map((row) => row.id), ['score', 'news'])
  assert.equal(countUnreadGeneralNotifications(rows), 1)
  assert.deepEqual(getParentOpenedNotificationIds(data, rows), ['score'])
  assert.deepEqual(getParentOpenedNotificationIds({ ...data, route: 'invites' }, rows), ['invite', 'legacy-invite'])
})

test('clear all persists only general notifications for this parent and child, including beyond 500', async () => {
  const rows = Array.from({ length: 505 }, (_, i) => ({ ...base, id: String(i + 1), intent_type: 'matchday_update' }))
  rows.push(...[
    { id: '600', intent_type: 'parent_chat' }, { id: '601', intent_type: 'parent_poll' },
    { id: '602', intent_type: 'poll_results' }, { id: '603', data: { route: 'invites' } },
    { id: '604', auth_user_id: 'someone-else' }, { id: '605', parent_link_id: 'sibling' },
    { id: '606', created_at: '2025-01-01T00:00:00Z' }, { id: '607', sent_at: '2026-09-03T15:00:00Z' },
  ].map((row) => ({ ...base, ...row })))
  const admin = mockAdmin(rows)
  const result = await updateParentNotificationInbox({ admin, authUser: { id: 'parent' }, link, action: 'clear_general', now })
  assert.equal(result.notificationIds.length, 505)
  assert.equal(rows.filter((row) => row.dismissed_at === now).length, 505)
  assert.ok(rows.slice(505).every((row) => row.dismissed_at === null && row.read_at === null))
  assert.ok(admin.calls.some((call) => call[0] === 'range' && call[1] === 500))
  assert.equal((await updateParentNotificationInbox({ admin, authUser: { id: 'parent' }, link, action: 'clear_general', now })).notificationIds.length, 0)
})

test('mark read changes only specified owned events and empty IDs never mark the whole inbox', async () => {
  const rows = [{ ...base, id: '1' }, { ...base, id: '2' }, { ...base, id: '3', auth_user_id: 'other' }]
  const admin = mockAdmin(rows)
  await updateParentNotificationInbox({ admin, authUser: { id: 'parent' }, link, notificationIds: [], now })
  assert.ok(rows.every((row) => !row.read_at))
  const result = await updateParentNotificationInbox({ admin, authUser: { id: 'parent' }, link, notificationIds: ['1', '3', 'invalid'], now })
  assert.deepEqual(result.notificationIds, ['1'])
  assert.equal(rows[0].read_at, now)
  assert.ok(rows.slice(1).every((row) => !row.read_at))
  assert.ok(rows.every((row) => !row.dismissed_at))
})

test('local and offline state preserve new replacements and unrelated categories', () => {
  const rows = [{ id: '1', sentAt: '2026-09-03T13:00:00Z' }, { id: '2', sentAt: '2026-09-03T15:00:00Z' }, { id: '3', data: { route: 'chat' } }]
  assert.deepEqual(applyParentNotificationAction(rows, ['1', '2'], 'clear', now).map((row) => row.id), ['2', '3'])
  assert.deepEqual(applyParentNotificationAction(rows, ['1'], 'read', now).map((row) => Boolean(row.isRead)), [true, false, false])
  assert.equal(getParentNotificationCategory(rows[2]), 'chat')
})

test('database keeps dismissals on read but reveals new score updates on the same event row', async () => {
  const db = new PGlite()
  try {
    await db.exec("create role anon; create role authenticated; create schema private; create table public.parent_mobile_notification_events(id int primary key,title text,body text,sent_at timestamptz,read_at timestamptz);")
    await db.exec(await readFile(new URL('../supabase/migrations/20260903125604_parent_notification_inbox_controls.sql', import.meta.url), 'utf8'))
    await db.exec("insert into public.parent_mobile_notification_events values(1,'Match','Half time','2026-09-03T13:00Z',null,null); update public.parent_mobile_notification_events set dismissed_at='2026-09-03T13:01Z',read_at='2026-09-03T13:01Z';")
    assert.ok((await db.query('select dismissed_at from public.parent_mobile_notification_events')).rows[0].dismissed_at)
    await db.exec("update public.parent_mobile_notification_events set body='Full time',sent_at='2026-09-03T13:10Z',read_at=null;")
    assert.equal((await db.query('select dismissed_at from public.parent_mobile_notification_events')).rows[0].dismissed_at, null)
    await db.exec('set role authenticated')
    await assert.rejects(db.exec('update public.parent_mobile_notification_events set dismissed_at=now()'), /permission denied/)
  } finally { await db.close() }
})
