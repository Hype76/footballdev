import assert from 'node:assert/strict'
import test from 'node:test'
import { readFile } from 'node:fs/promises'
import { parse } from '@babel/parser'
import { normalizeMatchDayShirtChoice } from '../src/lib/matchday-model.js'
import { normalizePitchType } from '../src/lib/pitch-type.js'
import { normalizePersonName } from '../src/lib/person-name.js'
import { appendParentScorerCommand, getVisibleParentScorerMatch, mergeParentScorerAcknowledgement, projectParentScorerOutbox } from '../apps/parent-mobile/src/parentScorerOutboxCore.js'
import { deliverParentScorerCommands } from '../netlify/functions/lib/_parent-scorer-command-notifications.js'

const startAt = '2026-09-26T11:00:00Z'
const base = { id: 'match', clubId: 'club', teamId: 'team', updatedAt: startAt, homeAway: 'home',
  homeScore: 0, awayScore: 0, status: 'scheduled', timerStatus: 'not_started', currentMatchPhase: 'pre_match',
  matchDurationMinutes: 80, events: [], shootoutEvents: [], isScorer: true }
const journal = () => ({ baseMatch: base, pending: [], verifiedAt: startAt, error: '' })

async function actualFunctions(file, names) {
  const source = await readFile(new URL(file, import.meta.url), 'utf8')
  const declarations = parse(source, { sourceType: 'module' }).program.body.map(node => node.declaration || node)
  return names.map(name => {
    const node = declarations.find(item => item.type === 'FunctionDeclaration' && item.id?.name === name)
    assert.ok(node, name)
    return source.slice(node.start, node.end)
  }).join('\n')
}
const coreFunctions = await actualFunctions('../apps/mobile-core/src/data.js', ['normalizeText', 'getRelatedRow', 'normalizeMatchDayEvent', 'normalizeMatchDay'])
const parentFunctions = await actualFunctions('../apps/parent-mobile/src/parentPortalData.js', ['normalizeParentMatchEvent', 'normalizeParentMatchDay', 'applyParentScorerCommand'])
let rpcResult
const dependencies = { normalizeMatchDayShirtChoice, normalizePitchType, normalizePersonName, mergeParentScorerAcknowledgement,
  normalizeParentMatchFormationPlan: () => { throw new Error('Unexpected formation access') },
  requireSelectedLink: user => user.link, scorerRpc: async () => rpcResult, getMobileRuntimeConfig: () => ({}), getAccessToken: async () => '' }
const { normalizeParentMatchDay, applyParentScorerCommand } = new Function(...Object.keys(dependencies), `${coreFunctions}\n${parentFunctions}\nreturn { normalizeParentMatchDay, applyParentScorerCommand }`)(...Object.values(dependencies))

test('queued goal removal keeps the score reduced before, between and after acknowledgements', () => {
  for (const homeAway of ['home', 'away']) for (const teamSide of ['club', 'opponent']) {
    const side = (teamSide === 'club') === (homeAway === 'home') ? 'homeScore' : 'awayScore'
    let saved = { ...journal(), baseMatch: { ...base, homeAway } }
    saved = appendParentScorerCommand(saved, { id: 'local-goal', kind: 'goal', capturedAt: startAt, payload: { teamSide, minute: 5 } })
    saved = appendParentScorerCommand(saved, { id: 'remove-goal', kind: 'void-goal', capturedAt: startAt, payload: { eventId: 'local-goal', reason: 'Added by mistake' } })
    assert.equal(projectParentScorerOutbox(saved)[side], 0)
    const updatedAt = '2026-09-26T11:01:00Z'
    const firstAck = normalizeParentMatchDay(mergeParentScorerAcknowledgement(saved.baseMatch, saved.pending[0], { match: { [side === 'homeScore' ? 'home_score' : 'away_score']: 1, updated_at: updatedAt }, savedEvent: { id: 'server-goal', eventType: 'goal', teamSide } }))
    saved = { ...saved, baseMatch: firstAck, pending: saved.pending.slice(1) }
    assert.equal(firstAck.events[0].requestId, 'local-goal')
    assert.equal(projectParentScorerOutbox(saved)[side], 0, 'The local ID still resolves after the server changes its goal ID')
    const secondAck = normalizeParentMatchDay(mergeParentScorerAcknowledgement(firstAck, saved.pending[0], { match: { [side === 'homeScore' ? 'home_score' : 'away_score']: 0, updated_at: '2026-09-26T11:02:00Z' } }))
    saved = { ...saved, baseMatch: secondAck, pending: [] }
    assert.equal(getVisibleParentScorerMatch(firstAck, saved)[side], 0, 'A stale fixture fetch does not restore the old score')
    assert.equal(secondAck.events[0].eventStatus, 'voided')
    assert.ok(secondAck.events[0].voidedAt)
    const repeated = appendParentScorerCommand(saved, { id: 'repeated', kind: 'void-goal', capturedAt: '2026-09-26T11:03:00Z', payload: { eventId: 'server-goal' } })
    assert.equal(projectParentScorerOutbox(repeated)[side], 0, 'Removed goals cannot subtract twice')
  }
})

test('actual Parent transport preserves the acknowledged goal alias and void status through normalization', async () => {
  const user = { link: { id: 'parent', clubId: 'club', teamId: 'team' } }
  const goal = { id: 'local', matchId: base.id, kind: 'goal', capturedAt: startAt, payload: { teamSide: 'club', minute: 5 } }
  rpcResult = { match: { home_score: 1, updated_at: '2026-09-26T11:01:00Z' }, savedEvent: { id: 'server', event_type: 'goal', team_side: 'club' } }
  const first = (await applyParentScorerCommand(user, goal, base)).match
  assert.equal(first.homeScore, 1)
  assert.equal(first.events[0].requestId, 'local')
  const removal = { id: 'removal', matchId: base.id, kind: 'void-goal', capturedAt: startAt, payload: { eventId: 'local' } }
  rpcResult = { match: { home_score: 0, updated_at: '2026-09-26T11:02:00Z' } }
  const second = (await applyParentScorerCommand(user, removal, first)).match
  assert.equal(second.homeScore, 0)
  assert.equal(second.events[0].eventStatus, 'voided')
  assert.equal(second.events[0].pendingSync, false)
  assert.ok(second.events[0].voidedAt)
  await assert.rejects(applyParentScorerCommand({ link: { ...user.link, teamId: 'other' } }, removal, first), /outside your current Parent access/)
})

test('a newer server refresh wins after the queue drains, while pending corrections still project', () => {
  const newer = { ...base, updatedAt: '2026-09-26T11:03:00Z', homeScore: 3 }
  assert.equal(getVisibleParentScorerMatch(newer, journal()), newer)
  const removed = { ...journal(), baseMatch: { ...base, homeScore: 1, events: [{ id: 'removed', eventType: 'goal', teamSide: 'club', eventStatus: 'voided' }] } }
  const pending = appendParentScorerCommand(removed, { id: 'repeat', kind: 'void-goal', capturedAt: startAt, payload: { eventId: 'removed' } })
  assert.equal(projectParentScorerOutbox(pending).homeScore, 1)
  const currentAuthority = { ...base, isScorer: false, eventParticipants: [{ id: 'current-player' }] }
  const acknowledged = { ...journal(), baseMatch: { ...base, homeScore: 2, isScorer: true, updatedAt: '2026-09-26T11:01:00Z' } }
  const visible = getVisibleParentScorerMatch(currentAuthority, acknowledged)
  assert.equal(visible.homeScore, 2)
  assert.equal(visible.isScorer, false, 'Retaining a confirmed score cannot restore stale scorer permissions')
  assert.deepEqual(visible.eventParticipants, currentAuthority.eventParticipants)
})

test('a new goal cannot enter the offline journal with a missing match minute', () => {
  for (const minute of ['', ' ', null, undefined, -1, 1.5]) {
    assert.throws(() => appendParentScorerCommand(journal(), {
      id: 'missing-minute', kind: 'goal', capturedAt: startAt,
      payload: { teamSide: 'club', scorerName: 'FP TEST', minute },
    }), /goal minute/)
  }
  for (const minute of [0, '0', 18, '18']) {
    const saved = appendParentScorerCommand(journal(), {
      id: 'timed-goal', kind: 'goal', capturedAt: startAt,
      payload: { teamSide: 'club', scorerName: 'FP TEST', minute },
    })
    assert.equal(saved.pending[0].payload.minute, minute)
  }
})

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
  assert.throws(() => appendParentScorerCommand(saved, { id: 'later', kind: 'goal', capturedAt: '2026-09-26T11:08:00Z', payload: { teamSide: 'club' } }), /sent to the Coach/)
})

test('offline queue refuses stale fixtures, invalid actions and clock reversal', () => {
  assert.throws(() => appendParentScorerCommand({ ...journal(), verifiedAt: '2026-09-24T11:00:00Z' },
    { id: 'start', kind: 'start', capturedAt: startAt }), /over 24 hours/)
  assert.throws(() => appendParentScorerCommand(journal(), { id: 'bad', kind: 'timer', payload: { action: 'delete' }, capturedAt: startAt }), /unavailable/)
  const first = appendParentScorerCommand(journal(), { id: 'first', kind: 'goal', payload: { teamSide: 'club', minute: 6 },
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
