import test from 'node:test'
import assert from 'node:assert/strict'
import { appendParentScorerCommand, reviewParentScorerConflict, describeSavedScorerAction, canReviewParentScorerActions } from '../apps/parent-mobile/src/parentScorerOutboxCore.js'

test('only the confirmed conflicting queue can be reviewed against its authorised current match', () => {
  const at = '2026-11-16T09:00:00Z'
  const base = { id: 'match', clubId: 'club', teamId: 'team', updatedAt: at, isScorer: true, status: 'scheduled' }
  const journal = appendParentScorerCommand({ baseMatch: base, verifiedAt: at, pending: [] }, { id: 'start', kind: 'start', capturedAt: at })
  const rejected = { ...journal, errorCode: '40001', error: 'Changed on another device' }
  const latest = { ...base, updatedAt: '2026-11-16T09:01:00Z' }
  assert.throws(() => reviewParentScorerConflict(rejected, latest, []), /changed/)
  assert.throws(() => reviewParentScorerConflict(rejected, { ...latest, isScorer: false }, ['start']), /Refresh/)
  const reviewed = reviewParentScorerConflict(rejected, latest, ['start'])
  assert.equal(reviewed.pending[0].id, 'start')
  assert.equal(reviewed.pending[0].expectedUpdatedAt, latest.updatedAt)
  assert.equal(reviewed.pending[0].capturedAt, at)
  assert.equal(describeSavedScorerAction({ kind: 'score', payload: { homeScore: 2, awayScore: 1 } }), 'score, 2 - 1')
})

test('a redundant start is removed only after review while the later goal is preserved', () => {
  const at = '2026-11-16T09:00:00Z'
  const base = { id: 'match', clubId: 'club', teamId: 'team', updatedAt: at, isScorer: true, status: 'scheduled' }
  const start = appendParentScorerCommand({ baseMatch: base, verifiedAt: at, pending: [] }, { id: 'start', kind: 'start', capturedAt: at })
  const withGoal = appendParentScorerCommand(start, { id: 'goal', kind: 'goal', payload: { minute: 5 }, capturedAt: '2026-11-16T09:05:00Z' })
  const rejected = { ...withGoal, errorCode: '40001', error: 'Changed on another device' }
  const latest = { ...base, status: 'live', currentMatchPhase: 'first_half', timerStatus: 'running', updatedAt: '2026-11-16T09:01:00Z' }
  assert.throws(() => reviewParentScorerConflict(rejected, latest, ['start', 'goal']), /already running/)
  const reviewed = reviewParentScorerConflict(rejected, latest, ['start', 'goal'], { removeRedundantStart: true })
  assert.equal(reviewed.pending[0].id, 'goal')
  assert.deepEqual(reviewed.pending[0].payload, withGoal.pending[1].payload)
  assert.equal(reviewed.pending[0].capturedAt, withGoal.pending[1].capturedAt)
  assert.equal(reviewed.pending[0].expectedUpdatedAt, latest.updatedAt)
  assert.equal(reviewed.pending[0].previousCommandId, null)
  assert.equal(canReviewParentScorerActions({ ...rejected, errorCode: 'P0001', error: 'This saved clock action predates the current clock. Review it before continuing.' }), true)
})
