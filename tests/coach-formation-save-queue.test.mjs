import assert from 'node:assert/strict'
import test from 'node:test'
import { isRetryableFormationSaveError, mergeFormationPendingSaves } from '../apps/coach-mobile/src/coachFormationSaveQueueCore.js'

test('formation save queues only transport failures', () => {
  assert.equal(isRetryableFormationSaveError(new Error('Failed to fetch')), true)
  assert.equal(isRetryableFormationSaveError(new Error('The request timed out.')), true)
  assert.equal(isRetryableFormationSaveError(Object.assign(new Error('permission denied'), { status: 403 })), false)
  assert.equal(isRetryableFormationSaveError(new Error('formation_board_version_conflict')), false)
})

test('formation queue classification does not treat ordinary validation as reconnectable', () => {
  assert.equal(isRetryableFormationSaveError(Object.assign(new Error('title is required'), { status: 400 })), false)
  assert.equal(isRetryableFormationSaveError(new Error('Board revoked for this Team')), false)
})

test('pending queue changes preserve unrelated boards and migrate an acknowledged key atomically', () => {
  const first = { 'match-a:board-a': { matchDayId: 'match-a', boardId: 'board-a' }, 'match-b:new': { matchDayId: 'match-b', boardId: '' } }
  const acknowledged = { matchDayId: 'match-a', boardId: 'board-a', acknowledged: true }
  assert.deepEqual(mergeFormationPendingSaves(first, undefined), first)
  assert.deepEqual(mergeFormationPendingSaves(first, { 'match-a:board-a': null }), { 'match-b:new': first['match-b:new'] })
  assert.deepEqual(mergeFormationPendingSaves(first, { 'match-a:server-a': acknowledged, 'match-a:board-a': null }), { 'match-a:server-a': acknowledged, 'match-b:new': first['match-b:new'] })
})
