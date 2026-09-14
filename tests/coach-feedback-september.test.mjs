import test from 'node:test'
import assert from 'node:assert/strict'
import { groupCoachNotifications } from '../apps/mobile-core/src/coachNotificationGroups.js'
import { countPendingCoachAvailability, buildCoachHomeOperationalSnapshot } from '../apps/mobile-core/src/coachPhase31GCore.js'

test('Home counts the next seven days while the full outstanding list remains available', () => {
  const now = new Date('2026-09-14T12:00:00Z')
  const rows = ['2026-09-14T13:00:00Z', '2026-09-20T12:00:00Z', '2026-09-21T12:00:00Z', '2026-10-01T12:00:00Z'].map((eventAt, i) => ({ eventAt, eventId: String(i), playerId: 'p', kind: 'match', sentAt: '2026-09-01', status: 'pending' }))
  assert.equal(countPendingCoachAvailability(rows, now), 4)
  assert.equal(countPendingCoachAvailability(rows, now, 7), 2)
  assert.equal(buildCoachHomeOperationalSnapshot({ invites: { all: rows }, now }).pendingAvailability, 2)
})

test('Notification age groups preserve all history and sort newest first', () => {
  const items = ['2026-09-13', '2026-09-01', '2026-08-01', '2026-06-01', '2026-09-14'].map((created_at, id) => ({ id, created_at }))
  const groups = groupCoachNotifications(items, new Date('2026-09-14T12:00:00Z'))
  assert.deepEqual(groups.map(group => [group.id, group.items.map(item => item.id)]), [['recent', [4, 0]], ['week', [1]], ['month', [2]], ['archive', [3]]])
  assert.equal(items.length, 5)
})
