import assert from 'node:assert/strict'
import test from 'node:test'
import { appendParentScorerCommand, projectParentScorerOutbox } from '../apps/parent-mobile/src/parentScorerOutboxCore.js'
import { deliverParentScorerCommands } from '../netlify/functions/lib/_parent-scorer-command-notifications.js'

const startAt = '2026-09-26T11:00:00Z'
const base = { id: 'match', clubId: 'club', teamId: 'team', updatedAt: startAt, homeAway: 'home',
  homeScore: 0, awayScore: 0, status: 'scheduled', timerStatus: 'not_started', currentMatchPhase: 'pre_match',
  matchDurationMinutes: 80, events: [], shootoutEvents: [], isScorer: true }
const journal = () => ({ baseMatch: base, pending: [], verifiedAt: startAt, error: '' })

test('offline start, goal, score and handover project immediately in capture order', () => {
  let saved = appendParentScorerCommand(journal(), { id: 'start', kind: 'start', capturedAt: startAt })
  saved = appendParentScorerCommand(saved, { id: 'goal', kind: 'goal', capturedAt: '2026-09-26T11:05:00Z',
    payload: { teamSide: 'club', scorerName: 'FP TEST', minute: 5 } })
  saved = appendParentScorerCommand(saved, { id: 'score', kind: 'score', capturedAt: '2026-09-26T11:06:00Z',
    payload: { homeScore: 2, awayScore: 0 } })
  saved = appendParentScorerCommand(saved, { id: 'review', kind: 'request-review', capturedAt: '2026-09-26T11:07:00Z' })
  const projected = projectParentScorerOutbox(saved)
  assert.equal(projected.status, 'live')
  assert.equal(projected.timerStartedAt, startAt)
  assert.equal(projected.homeScore, 2)
  assert.equal(projected.events.length, 2)
  assert.equal(projected.pendingReview, true)
  assert.equal(projected.isScorer, true)
  assert.equal(saved.pending[1].previousCommandId, 'start')
  assert.equal(saved.pending[1].expectedUpdatedAt, null)
  assert.throws(() => appendParentScorerCommand(saved, { id: 'later', kind: 'goal', payload: { teamSide: 'club' } }), /sent to the Coach/)
})

test('offline queue refuses stale fixtures, invalid actions and clock reversal', () => {
  assert.throws(() => appendParentScorerCommand({ ...journal(), verifiedAt: '2026-09-24T11:00:00Z' },
    { id: 'start', kind: 'start', capturedAt: startAt }), /over 24 hours/)
  assert.throws(() => appendParentScorerCommand(journal(), { id: 'bad', kind: 'timer', payload: { action: 'delete' }, capturedAt: startAt }), /unavailable/)
  const first = appendParentScorerCommand(journal(), { id: 'first', kind: 'goal', payload: { teamSide: 'club' },
    capturedAt: '2026-09-26T11:05:00Z' })
  assert.throws(() => appendParentScorerCommand(first, { id: 'second', kind: 'goal', payload: { teamSide: 'club' },
    capturedAt: '2026-09-26T11:04:00Z' }), /device clock changed/)
})

test('goal corrections and shootout changes remain visible before sync', () => {
  const live = { ...base, status: 'penalties', currentMatchPhase: 'penalties', homeScore: 1,
    events: [{ id: 'goal-1', eventType: 'goal', teamSide: 'club', scorerName: 'FP TEST' }],
    shootoutEvents: [{ id: 'kick-1', teamSide: 'club', outcome: 'scored' }], homeShootoutScore: 1 }
  let saved = { baseMatch: live, pending: [], verifiedAt: startAt, error: '' }
  saved = appendParentScorerCommand(saved, { id: 'correct', kind: 'correct-goal',
    payload: { eventId: 'goal-1', goal: { teamSide: 'opponent', scorerName: 'FP TEST Opponent' } }, capturedAt: startAt })
  saved = appendParentScorerCommand(saved, { id: 'void', kind: 'void-shootout', payload: { kickId: 'kick-1' },
    capturedAt: startAt })
  const projected = projectParentScorerOutbox(saved)
  assert.equal(projected.homeScore, 0)
  assert.equal(projected.awayScore, 1)
  assert.equal(projected.homeShootoutScore, 0)
  assert.ok(projected.shootoutEvents[0].voidedAt)
})

test('extended match phases stay available in the saved offline view', () => {
  let saved = { ...journal(), baseMatch: { ...base, status: 'second_half', currentMatchPhase: 'second_half',
    timerStatus: 'running', matchConclusionRule: 'extra_time_then_penalties', timerStartedAt: startAt } }
  for (const [index, action] of ['normal_time_complete', 'start_extra_time', 'extra_time_half_time',
    'start_extra_time_second_half', 'complete_extra_time', 'start_penalties'].entries()) {
    saved = appendParentScorerCommand(saved, { id: action, kind: 'extended', payload: { action },
      capturedAt: new Date(Date.parse(startAt) + (index + 1) * 60000).toISOString() })
  }
  const projected = projectParentScorerOutbox(saved)
  assert.equal(projected.status, 'penalties')
  assert.equal(projected.currentMatchPhase, 'penalties')
  assert.equal(projected.timerStatus, 'paused')
})

test('saved Parent scorer notifications retry without changing the match', async () => {
  const calls = []
  const command = { id: 'command', match: { id: 'match', home_score: 1 }, type: 'goal', eventId: 'event' }
  const client = {
    async rpc(name, args) {
      calls.push({ name, args })
      return { data: name.startsWith('claim_') ? [command] : name.startsWith('get_') ? ['link', 'link'] : null }
    },
    from() { return { select() { return this }, eq() { return this }, is() { return this }, async maybeSingle() { return { data: { teams: { name: 'Team' }, clubs: { name: 'Club', status: 'active' } } } } } },
  }
  let attempt = 0
  const deliver = async input => {
    assert.equal(input.match.home_score, 1)
    assert.deepEqual(input.targetParentLinkIds, ['link'])
    assert.equal(input.eventId, 'event')
    return { mobileFailed: attempt++ === 0 ? 1 : 0, webFailed: 0, fanFailed: 0 }
  }
  assert.deepEqual(await deliverParentScorerCommands('command', 'actor', { client, deliver }), { completed: 0, failed: 1 })
  assert.match(calls.at(-1).args.error_value, /retried/)
  assert.deepEqual(calls[0].args, { command_id_value: 'command', actor_user_id_value: 'actor' })
  assert.deepEqual(await deliverParentScorerCommands('command', 'actor', { client, deliver }), { completed: 1, failed: 0 })
  assert.equal(calls.at(-1).args.error_value, '')
})
