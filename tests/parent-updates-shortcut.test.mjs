import assert from 'node:assert/strict'
import test from 'node:test'
import { prepareParentUpdates, countUnreadNonChatNotifications, getParentOpenedNotificationIds } from '../apps/mobile-core/src/parentNotificationInboxCore.js'

test('Updates keeps selection and score notifications, groups one match, and excludes Chat', () => {
  const items = [
    { id: 'selection', intentType: 'matchday_update', sentAt: '2026-09-03T10:00:00Z', data: { route: 'matchday', matchDayId: 'one', parentLinkId: 'child', subtype: 'squad_decision' } },
    { id: 'goal', intentType: 'matchday_update', sentAt: '2026-09-03T11:00:00Z', data: { route: 'matchday', matchDayId: 'one', parentLinkId: 'child' } },
    { id: 'other', intentType: 'matchday_update', sentAt: '2026-09-03T10:30:00Z', isRead: true, data: { route: 'matchday', matchDayId: 'two', parentLinkId: 'child' } },
    { id: 'chat', intentType: 'parent_chat', sentAt: '2026-09-03T12:00:00Z', data: { route: 'chat', roomId: 'team' } },
  ]
  assert.deepEqual(prepareParentUpdates(items).map((n) => n.id), ['goal', 'other'])
  assert.equal(countUnreadNonChatNotifications(items), 1)
  assert.deepEqual(new Set(getParentOpenedNotificationIds({ matchDayId: 'one', parentLinkId: 'child' }, items)), new Set(['selection', 'goal']))
  assert.equal(countUnreadNonChatNotifications(items.map((n) => n.id === 'goal' ? { ...n, isRead: true } : n)), 0)
})
