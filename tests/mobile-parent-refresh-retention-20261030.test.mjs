import test from 'node:test'
import assert from 'node:assert/strict'
import { runPrioritizedMobileLoads } from '../apps/mobile-core/src/mobileLoadCoordinator.js'
import { createParentChatRequestGate, discardDeniedParentCache, filterDeniedParentChatHistory, isParentAccessDenied, resolveParentCalendarRefresh, resolveParentResourceFailure, shouldClearParentChatOnSettlement } from '../apps/parent-mobile/src/parentRefreshCore.js'

const ok = (value) => ({ status: 'fulfilled', value })
const failed = { status: 'rejected', reason: new Error('offline') }
const build = (results) => [...results.calendar.value, ...results.invitations.value, ...results.matches.value]

test('Calendar retains its previous view until all dependencies settle', () => {
  const previous = { items: ['saved'], error: '', loading: true }
  assert.strictEqual(resolveParentCalendarRefresh(previous, { calendar: ok([]) }, build), previous)
})

test('Calendar keeps the complete previous view and reports a partial failure', () => {
  const previous = { items: ['saved'], error: '', loading: true }
  const result = resolveParentCalendarRefresh(previous, { calendar: ok(['new']), invitations: failed, matches: ok([]) }, build)
  assert.deepEqual(result.items, ['saved'])
  assert.match(result.error, /could not be refreshed/)
  assert.equal(result.loading, false)
})

test('Calendar replaces saved data when the complete new result is empty', () => {
  const result = resolveParentCalendarRefresh({ items: ['saved'], error: 'old', loading: true }, { calendar: ok([]), invitations: ok([]), matches: ok([]) }, build)
  assert.deepEqual(result, { items: [], error: '', loading: false })
})

test('a later same-room chat refresh wins when responses finish in reverse order', async () => {
  const gate = createParentChatRequestGate()
  const scope = 'account:child:room'
  let displayed = []
  let finishOld
  let finishNew
  const oldResponse = new Promise((resolve) => { finishOld = resolve })
  const newResponse = new Promise((resolve) => { finishNew = resolve })
  const load = async (response) => {
    const request = gate.begin(scope)
    const items = await response
    if (gate.isCurrent(request, scope)) displayed = items
  }
  const oldLoad = load(oldResponse)
  const newLoad = load(newResponse)
  finishNew(['new'])
  await newLoad
  finishOld(['old'])
  await oldLoad
  assert.deepEqual(displayed, ['new'])
  const request = gate.begin(scope)
  assert.equal(gate.isCurrent(request, 'account:other-child:room'), false)
  gate.invalidate()
  assert.equal(gate.isCurrent(request, scope), false)
})

test('access denied clears retained resources while connection failures preserve them', () => {
  const prior = { items: [{ id: 'private' }], error: '', loading: true }
  for (const error of [{ status: 403 }, { statusCode: 403 }, { code: '42501' }, { message: 'permission denied' }]) {
    assert.equal(isParentAccessDenied(error), true)
    const result = resolveParentResourceFailure(prior, error, 'Failed')
    assert.deepEqual(result.items, [])
    assert.match(result.error, /access/)
  }
  const offline = resolveParentResourceFailure(prior, { message: 'network timeout' }, 'Could not refresh')
  assert.deepEqual(offline.items, prior.items)
  assert.equal(offline.error, 'Could not refresh')
})

test('a denied Calendar dependency clears the previous view without waiting for other requests', () => {
  const previous = { items: ['private'], error: '', loading: true }
  const denied = resolveParentCalendarRefresh(previous, { invitations: { status: 'rejected', reason: { code: '42501' } } }, build)
  assert.deepEqual(denied.items, [])
  assert.match(denied.error, /access/)
  assert.equal(denied.loading, false)
})

test('denied cache removal preserves other resources, rooms and child scopes', () => {
  const document = { journal: [{ id: 'queued' }], parentScorerOutboxes: { a: { score: 1 } }, resources: {
    a: { authority: 'a', calendar: { value: ['private'] }, messages: { value: ['keep'] }, chatHistory: { value: [{ roomId: 'denied' }, { roomId: 'keep' }] } },
    b: { calendar: { value: ['other child'] } },
  } }
  const result = discardDeniedParentCache(document, 'a', ['calendar', 'journal'], 'denied')
  assert.equal(result.resources.a.calendar, undefined)
  assert.deepEqual(result.resources.a.messages.value, ['keep'])
  assert.deepEqual(result.resources.a.chatHistory.value, [{ roomId: 'keep' }])
  assert.deepEqual(result.resources.b, document.resources.b)
  assert.deepEqual(result.journal, document.journal)
  assert.deepEqual(result.parentScorerOutboxes, document.parentScorerOutboxes)
})

test('in-flight chat history is filtered after a room is denied before publication and saving', async () => {
  const denied = new Set()
  let finish
  const pending = new Promise((resolve) => { finish = resolve })
  const captured = [{ roomId: 'restricted', id: 'old' }, { roomId: 'allowed', id: 'keep' }]
  const scope = (roomId) => `account:child:${roomId}`
  const load = pending.then(() => filterDeniedParentChatHistory(captured, denied, scope))
  denied.add(scope('restricted'))
  finish()
  const published = await load
  assert.deepEqual(published, [{ roomId: 'allowed', id: 'keep' }])
  denied.add(scope('allowed'))
  assert.deepEqual(filterDeniedParentChatHistory(published, denied, scope), [])
})

test('room-list denial clears open chat before unrelated loaders finish and blocks later history', async () => {
  let releaseOther
  const held = new Promise((resolve) => { releaseOther = resolve })
  let deniedAll = false
  let openMessages = ['private']
  let history = ['private']
  let gateInvalidated = false
  const pending = runPrioritizedMobileLoads({
    chatRooms: async () => { throw { status: 403 } },
    other: async () => held,
  }, { concurrency: 2, onSettled(name, result) {
    if (shouldClearParentChatOnSettlement(name, result)) {
      deniedAll = true
      gateInvalidated = true
      openMessages = []
      history = []
    }
  } })
  await Promise.resolve()
  await Promise.resolve()
  assert.equal(gateInvalidated, true)
  assert.deepEqual(openMessages, [])
  assert.deepEqual(history, [])
  const lateHistory = [{ roomId: 'room', id: 'private' }]
  assert.deepEqual(filterDeniedParentChatHistory(lateHistory, new Set(), (room) => room, deniedAll), [])
  releaseOther([])
  await pending
})
