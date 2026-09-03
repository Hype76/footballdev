import assert from 'node:assert/strict'
import test from 'node:test'
import { buildCoachMatchDaySquad, filterCoachMatchDays, isCoachMatchDaySquadNotificationApplied, reconcileCoachSquadNotificationResults } from '../apps/mobile-core/src/coachMatchDayCore.js'
process.env.VITE_SUPABASE_URL = 'https://example.supabase.co'
process.env.SUPABASE_SERVICE_ROLE_KEY = 'test-only-not-a-real-key'
const { createSquadNotificationHandler } = await import('../netlify/functions/notify-match-day-squad.mjs')
const { deliverSquadDecisionNotifications } = await import('../netlify/functions/lib/_squad-decision-notifications.js')
const id = '9a090303-0000-4000-8000-000000000001'
const request = (body, token = 'coach-token') => new Request('https://example.test/notify', { method: 'POST', headers: token ? { Authorization: 'Bearer ' + token } : {}, body: JSON.stringify(body) })

test('TBC fixtures sort by date despite blank scheduled timestamps and reverse insertion order', () => {
  const fixtures = ['2026-10-17', '2026-10-10', '2026-10-03', '2026-09-26'].map((date) => ({ id: date, matchDate: date, kickoffTime: '', scheduledKickoffAt: '', kickoffTimeTbc: true, status: 'scheduled' }))
  const before = JSON.stringify(fixtures)
  for (const filter of ['all', 'upcoming']) assert.deepEqual(filterCoachMatchDays(fixtures, filter, new Date('2026-09-03T09:00:00Z')).map((m) => m.matchDate), ['2026-09-26', '2026-10-03', '2026-10-10', '2026-10-17'])
  assert.equal(JSON.stringify(fixtures), before)
})
test('same-day timed matches precede TBC and previous fixtures remain newest first', () => {
  const fixtures = [{ id: 'tbc', matchDate: '2026-09-02', kickoffTimeTbc: true, kickoffTime: '00:00' }, { id: 'early', matchDate: '2026-09-02', kickoffTime: '09:00' }, { id: 'late', matchDate: '2026-09-02', kickoffTime: '18:00' }, { id: 'unknown', matchDate: '' }]
  assert.deepEqual(filterCoachMatchDays(fixtures, 'all').map((m) => m.id), ['early', 'late', 'tbc', 'unknown'])
  assert.deepEqual(filterCoachMatchDays(fixtures, 'previous', new Date('2026-09-03T09:00:00Z')).map((m) => m.id), ['tbc', 'late', 'early'])
})
test('saved notification status is tied to the current decision revision, separate from availability', () => {
  const match = { squadDecisions: [{ playerId: id, status: 'not_selected', decisionRevision: 'r1', notifiedAt: 'now' }], playerAvailability: [{ playerId: id, status: 'available' }] }
  const player = buildCoachMatchDaySquad([{ id, playerName: 'Alex' }], match).rows[0]
  assert.equal(player.availability, 'available'); assert.equal(player.notifiedAt, 'now')
  assert.equal(isCoachMatchDaySquadNotificationApplied(match, id, 'r1'), true)
  assert.equal(isCoachMatchDaySquadNotificationApplied(match, id, 'r2'), false)
  assert.equal(isCoachMatchDaySquadNotificationApplied({ squadDecisions: [{ ...match.squadDecisions[0], notifiedAt: '' }] }, id, 'r1'), false)
})
test('notification endpoint rejects missing authentication before saving or delivery', async () => {
  const handler = createSquadNotificationHandler({ admin: { auth: { getUser: async () => ({ error: {} }) } }, deliver: async () => { throw new Error('Must not deliver') } })
  assert.equal((await handler(request({}, ''))).status, 401)
  assert.equal((await handler(request({}))).status, 401)
})
test('verified coach JWT and saved revision reach the authority RPC, arbitrary recipients and copy do not', async () => {
  let args; let options; let delivered
  const handler = createSquadNotificationHandler({ admin: { auth: { getUser: async () => ({ data: { user: { id: 'coach' } } }) } }, publicClient: (_, settings) => { options = settings; return { rpc: async (_, value) => { args = value; return { data: { sent: true, revision: id, notificationIds: ['receipt'] } } } } }, deliver: async (ids) => { delivered = ids } })
  const result = await handler(request({ matchId: id, playerId: id, revision: id, parentIds: ['unrelated'], body: 'Arbitrary content' }))
  assert.equal(result.status, 200)
  assert.deepEqual(args, { match_id: id, player_id_value: id, expected_revision: id })
  assert.equal(options.global.headers.Authorization, 'Bearer coach-token')
  assert.deepEqual(delivered, ['receipt'])
})
test('stale or unauthorised decisions never deliver', async () => {
  const handler = createSquadNotificationHandler({ admin: { auth: { getUser: async () => ({ data: { user: { id } } }) } }, publicClient: () => ({ rpc: async () => ({ error: { code: 'P0001', message: 'The squad decision has changed.' } }) }), deliver: async () => { throw new Error('Must not deliver') } })
  assert.equal((await handler(request({ matchId: id, playerId: id, revision: id }))).status, 400)
})
test('phone delivery failure leaves the saved in-app notification confirmed and queued for retry', async () => {
  const handler = createSquadNotificationHandler({ admin: { auth: { getUser: async () => ({ data: { user: { id } } }) } }, publicClient: () => ({ rpc: async () => ({ data: { sent: true, revision: id, notificationIds: ['receipt'] } }) }), deliver: async () => { throw new Error('Offline') } })
  assert.equal((await (await handler(request({ matchId: id, playerId: id, revision: id }))).json()).sent, true)
})
test('receipt delivery only uses the saved recipient and never rewrites the already saved inbox', async () => {
  const updates = []; let payload
  const admin = { rpc: async () => ({ data: { id, match_day_id: 'fixture', parent_link_id: 'parent-a', title: 'Squad update', body: 'Alex is selected.' } }), from: (table) => ({ select: () => ({ eq: () => ({ single: async () => ({ data: { id: 'fixture' } }) }) }), update: (value) => ({ eq: async () => { updates.push({ table, value }); return {} } }) }) }
  await deliverSquadDecisionNotifications([id], { admin, deliver: async (value) => { payload = value; return { mobileFailed: 0, webFailed: 0 } } })
  assert.deepEqual(payload.targetParentLinkIds, ['parent-a']); assert.equal(payload.inboxAlreadySaved, true)
  assert.equal(payload.notificationCopy.detailedBody, 'Alex is selected.'); assert.ok(updates[0].value.push_finished_at)
  assert.doesNotMatch(payload.notificationCopy.minimalBody, /Alex|selected/)
  assert.equal(payload.notificationCopy.tag, 'match-day-fixture')
})
test('an already claimed or obsolete receipt does not produce another phone message', async () => {
  assert.deepEqual(await deliverSquadDecisionNotifications([id], { admin: { rpc: async () => ({ data: null }) }, deliver: async () => { throw new Error('Must not deliver') } }), { completed: 0 })
})

test('batch endpoint calls one authority RPC and returns each player outcome without direct phone fanout', async () => {
  const second = '9a090303-0000-4000-8000-000000000002'
  let call
  const outcomes = [{ playerId: id, revision: id, sent: true }, { playerId: second, revision: second, sent: false, message: 'No active parent app account is linked to this player.' }]
  const handler = createSquadNotificationHandler({ admin: { auth: { getUser: async () => ({ data: { user: { id } } }) } }, publicClient: () => ({ rpc: async (name, args) => { call = { name, args }; return { data: { results: outcomes, notificationIds: ['private-receipt'] } } } }), deliver: async () => { throw new Error('Batch phone delivery belongs to the durable worker') } })
  const response = await handler(request({ matchId: id, decisions: [{ playerId: id, revision: id, copy: 'ignored' }, { playerId: second, revision: second }], parentIds: ['ignored'] }))
  assert.equal(response.status, 200)
  assert.deepEqual(call, { name: 'notify_match_day_squad_decisions', args: { match_id: id, decisions: [{ playerId: id, revision: id }, { playerId: second, revision: second }] } })
  assert.deepEqual(await response.json(), { success: true, results: outcomes })
})

test('batch rejects empty, duplicate, malformed and oversized choices before any write', async () => {
  let calls = 0
  const handler = createSquadNotificationHandler({ admin: { auth: { getUser: async () => ({ data: { user: { id } } }) } }, publicClient: () => { calls++; throw new Error('Must not write') } })
  for (const decisions of [[], [{ playerId: id, revision: id }, { playerId: id, revision: id }], [null], [{ playerId: id, revision: 'old' }], Array.from({ length: 101 }, () => ({ playerId: id, revision: id }))]) {
    assert.equal((await handler(request({ matchId: id, decisions }))).status, 400)
  }
  assert.equal(calls, 0)
})

test('uncertain batch reconciles each current revision without losing partial success', () => {
  const choices = [{ id: 'a', decisionRevision: 'a1' }, { id: 'b', decisionRevision: 'b1' }, { id: 'c', decisionRevision: 'c1' }]
  const results = reconcileCoachSquadNotificationResults(choices, [{ playerId: 'b', revision: 'b1', sent: false, message: 'No linked parent.' }, { playerId: 'c', revision: 'old', sent: true }], { squadDecisions: [{ playerId: 'a', decisionRevision: 'a1', notifiedAt: 'now' }, { playerId: 'c', decisionRevision: 'c2', notifiedAt: 'now' }] }, 'Request timed out.')
  assert.deepEqual(results.map((r) => r.sent), [true, false, false])
  assert.equal(results[1].message, 'No linked parent.')
  assert.equal(results[2].message, 'Request timed out.')
  assert.equal(reconcileCoachSquadNotificationResults([choices[0]], [{ playerId: 'a', revision: 'a1', sent: true }], null)[0].sent, true)
})
