import assert from 'node:assert/strict'
import test from 'node:test'
import { selectCoachMatchDayDisplayMatch } from '../apps/coach-mobile/src/coachMatchDayDisplayCore.js'

const before = { id: 'fixture', status: 'full_time', homeScore: 1, awayScore: 0, updatedAt: '2026-10-01T09:00:00Z', concludedAt: '' }
const concluded = { ...before, updatedAt: '2026-10-01T09:01:00Z', concludedAt: '2026-10-01T09:01:00Z' }

test('a confirmed conclusion wins over an older empty offline journal', () => {
  assert.equal(selectCoachMatchDayDisplayMatch(concluded, before), concluded)
  assert.equal(selectCoachMatchDayDisplayMatch({ ...concluded, updatedAt: before.updatedAt }, before).concludedAt, concluded.concludedAt)
})

test('a newer synced journal wins over an older screen fetch', () => {
  assert.equal(selectCoachMatchDayDisplayMatch(before, concluded), concluded)
})

test('unsynced actions keep their projected score and events', () => {
  const projected = { ...before, homeScore: 2, events: [{ id: 'pending-goal' }] }
  assert.equal(selectCoachMatchDayDisplayMatch(concluded, projected, 1), projected)
})

test('missing, invalid and other-fixture snapshots do not hide authoritative state', () => {
  assert.equal(selectCoachMatchDayDisplayMatch(concluded, null), concluded)
  assert.equal(selectCoachMatchDayDisplayMatch(concluded, { ...before, id: 'other-fixture' }, 1), concluded)
  assert.equal(selectCoachMatchDayDisplayMatch(concluded, { ...before, updatedAt: undefined }), concluded)
  assert.equal(selectCoachMatchDayDisplayMatch(null, before), before)
  assert.equal(selectCoachMatchDayDisplayMatch(null, null), null)
})
