import assert from 'node:assert/strict'
import test from 'node:test'
import { createMobileResourceCache, mobileResourceKey } from '../apps/mobile-core/src/mobileResourceCache.js'
import { runPrioritizedMobileLoads } from '../apps/mobile-core/src/mobileLoadCoordinator.js'
import { createParentOfflineDocument, getParentOfflineResources, setParentOfflineResources } from '../apps/mobile-core/src/parentOfflineCore.js'

test('recent reads and concurrent refreshes share one request, explicit refresh and expiry fetch again', async () => {
  let time = 0
  let calls = 0
  const cache = createMobileResourceCache({ now: () => time })
  const load = async () => ++calls
  assert.deepEqual(await Promise.all([cache.read('a', load), cache.read('a', load)]), [1, 1])
  assert.equal(await cache.read('a', load), 1)
  assert.equal(await cache.read('a', load, { force: true }), 2)
  time = 30001
  assert.equal(await cache.read('a', load), 3)
})

test('a forced refresh supersedes an older preload so mutations cannot reuse its stale result', async () => {
  const cache = createMobileResourceCache()
  let finish
  const preload = cache.read('a', () => new Promise((resolve) => { finish = resolve }))
  await Promise.resolve()
  let calls = 0
  const refresh = () => { calls++; return 'updated' }
  assert.deepEqual(await Promise.all([cache.read('a', refresh, { force: true }), cache.read('a', refresh, { force: true })]), ['updated', 'updated'])
  finish('old')
  await preload
  assert.equal(cache.peek('a'), 'updated')
  assert.equal(calls, 1)
})

test('sign-out clearing prevents an older request from repopulating the cache', async () => {
  const cache = createMobileResourceCache()
  let finish
  const pending = cache.read('a', () => new Promise((resolve) => { finish = resolve }))
  await Promise.resolve()
  cache.clear()
  finish('old account')
  await pending
  assert.equal(cache.peek('a'), undefined)
  assert.equal(await cache.read('a', async () => 'new session'), 'new session')
})

test('cache identities isolate accounts, teams, children and changed authority', () => {
  const base = { id: 'one', role: 'coach', roleRank: 40, clubId: 'club', activeTeamId: 'team-a' }
  const keys = [base, { ...base, id: 'two' }, { ...base, activeTeamId: 'team-b' }, { ...base, roleRank: 20 }, { ...base, selectedParentLinkId: 'child' }]
    .map((user) => mobileResourceKey(user, 'calendar'))
  assert.equal(new Set(keys).size, keys.length)
})

test('partial Parent refresh retains failed sections and their original freshness', () => {
  let time = 0
  const profile = { id: 'parent', parentPortalLinks: [{ id: 'child' }] }
  let document = createParentOfflineDocument({ profile, userScope: 'parent', now: () => time })
  document = setParentOfflineResources(document, 'child', { messages: [{ id: 'old' }], calendar: [{ id: 'event' }] }, { now: () => time })
  const originalMessages = document.resources.child.messages
  time = 7 * 60 * 60 * 1000
  document = setParentOfflineResources(document, 'child', { calendar: [{ id: 'new event' }], notifications: [{ id: 'notification' }] }, { now: () => time })
  assert.deepEqual(document.resources.child.messages, originalMessages)
  const view = getParentOfflineResources(document, 'child', { now: () => time })
  assert.equal(view.stale, true)
  assert.equal(view.resources.messages[0].id, 'old')
  assert.equal(view.resources.calendar[0].id, 'new event')
  assert.equal(view.resources.notifications[0].id, 'notification')
  assert.throws(() => setParentOfflineResources(document, 'another child', {}), /scope_invalid/)
})

test('Calendar dependencies settle before an unrelated slow or failing section and requests are bounded', async () => {
  let finishDevelopment
  let calendarReady = false
  let active = 0
  let peak = 0
  const loader = (value) => async () => { active++; peak = Math.max(peak, active); await Promise.resolve(); active--; return value }
  const batch = runPrioritizedMobileLoads({
    development: () => new Promise((resolve) => { finishDevelopment = resolve }),
    calendar: loader(['event']), invitations: loader(['invite']), matches: loader(['match']),
    resources: async () => { throw new Error('offline') },
  }, {
    priority: ['calendar', 'invitations', 'matches'], concurrency: 3,
    onSettled(_name, _result, results) { if (['calendar', 'invitations', 'matches'].every((name) => results[name])) calendarReady = true },
  })
  await new Promise((resolve) => setImmediate(resolve))
  assert.equal(calendarReady, true)
  assert.ok(peak <= 3)
  finishDevelopment([])
  const results = await batch
  assert.equal(results.resources.status, 'rejected')
  assert.deepEqual(results.calendar.value, ['event'])
})
