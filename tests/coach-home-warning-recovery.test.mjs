import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { execFileSync } from 'node:child_process'
import test from 'node:test'
import { buildCoachChatSummary, countPendingCoachAvailability, preserveCoachAvailabilitySummary, preserveCoachChatSummary, updateCoachHomeSourceState, mergeCoachHomeOperationalSnapshots } from '../apps/mobile-core/src/coachPhase31GCore.js'
import { isMatchdayPlan, isMobileRouteAllowed } from '../apps/mobile-core/src/matchdayPolicyCore.js'

// Execute the real host callback with synthetic loaders, never live user data.
const source = process.env.COACH_HOME_BASELINE
  ? execFileSync('git', ['show', `${process.env.COACH_HOME_BASELINE}:apps/coach-mobile/App.js`], { encoding: 'utf8' })
  : readFileSync('apps/coach-mobile/App.js', 'utf8')
const body = source.slice(source.indexOf('async ({ refresh = false, chatOnly = false, availabilityOnly = false } = {}) => {'), source.indexOf('\n  }, [activeContext, selectedMobileUser, user?.id])') + 4)
assert.ok(body.startsWith('async') && body.endsWith('}'))
const baselineCore = process.env.COACH_HOME_BASELINE
  ? execFileSync('git', ['show', `${process.env.COACH_HOME_BASELINE}:apps/mobile-core/src/coachPhase31GCore.js`], { encoding: 'utf8' })
  : ''
const baselinePreserveAvailability = baselineCore
  ? new Function(`${baselineCore.slice(baselineCore.indexOf('export function preserveCoachAvailabilitySummary('), baselineCore.indexOf('export function buildCoachHomeOperationalSnapshot(')).replace('export ', '')}; return preserveCoachAvailabilitySummary`)()
  : preserveCoachAvailabilitySummary
const deferred = () => { let resolve, reject; const promise = new Promise((yes, no) => { resolve = yes; reject = no }); return { promise, resolve, reject } }
const healthy = () => ({ errors: [], partial: false, pendingAvailability: 0, chatRooms: [], unreadChat: 0, activePolls: 3, developmentRecords: 4, matches: [{ id: 'synthetic-match' }], loading: false, stale: false })

function harness(errors = []) {
  let state = { ...healthy(), pendingAvailability: 9, chatRooms: [{ id: 'saved-room', unreadCount: 2 }], unreadChat: 2, errors, partial: errors.length > 0 }
  const reads = [], attentionOptions = []
  const deps = {
    selectedMobileUser: { id: 'synthetic-coach', clubId: 'synthetic-club', activeTeamId: 'synthetic-team' },
    isMobileRouteAllowed, isMatchdayPlan,
    requestIdRef: { current: 0 }, chatRefreshIdRef: { current: 0 }, availabilityRefreshIdRef: { current: 0 },
    setHomeState: update => { state = typeof update === 'function' ? update(state) : update },
    readMobileResource: async (user, key, loader, options) => { reads.push({ key, options }); return loader() },
    getCoachInvitesAndAvailability: async () => ({ all: [] }), getCoachChatRooms: async () => [{ id: 'fresh-room', unreadCount: 5 }],
    buildCoachChatSummary, countPendingCoachAvailability, preserveCoachAvailabilitySummary: baselinePreserveAvailability, preserveCoachChatSummary, updateCoachHomeSourceState,
    setIsRefreshing() {}, peekMobileResource: () => undefined, readCoachOfflineResources: async () => null,
    user: { id: 'synthetic-coach' }, activeContext: { id: 'synthetic-context' },
    getCoachPhase31GPrimaryHomeSnapshot: async (_user, progress) => { progress(healthy()); return healthy() },
    getCoachPhase31GAttentionSnapshot: async (_user, options) => { attentionOptions.push(options); return healthy() },
    mergeCoachPhase31GHomeSnapshots: mergeCoachHomeOperationalSnapshots,
    setLastUpdatedAt() {}, lastHomeRefreshAtRef: { current: 0 }, saveCoachOfflineResources: async () => {},
    InteractionManager: { runAfterInteractions() {} }, getCoachFriendlyError: () => 'Unavailable',
  }
  return { deps, reads, attentionOptions, state: () => state, load: options => new Function(...Object.keys(deps), `return (${body})`)(...Object.values(deps))(options) }
}
const targets = [
  { source: 'invites', options: { availabilityOnly: true }, loader: 'getCoachInvitesAndAvailability', value: { all: [] }, field: 'pendingAvailability', expected: 0 },
  { source: 'chatRooms', options: { chatOnly: true }, loader: 'getCoachChatRooms', value: [{ id: 'fresh-room', unreadCount: 5 }], field: 'unreadChat', expected: 5 },
]

for (const target of targets) {
  test(`${target.source} recovery clears its last warning`, async () => {
    const h = harness([`${target.source}:unavailable`])
    await h.load(target.options)
    assert.deepEqual(h.state().errors, [])
    assert.equal(h.state().partial, false)
    assert.equal(h.state()[target.field], target.expected)
    assert.equal(h.reads.length, 1)
    assert.equal(h.reads[0].options.force, true)
  })
  test(`${target.source} recovery retains other-source warnings and healthy data`, async () => {
    const h = harness([`${target.source}:unavailable`, 'calendar:unavailable', 'polls:unavailable'])
    const before = h.state()
    await h.load(target.options)
    assert.deepEqual(h.state().errors, ['calendar:unavailable', 'polls:unavailable'])
    assert.equal(h.state().partial, true)
    assert.equal(h.state().matches, before.matches)
    assert.equal(h.state().activePolls, before.activePolls)
    assert.equal(h.state().developmentRecords, before.developmentRecords)
  })
  test(`${target.source} failure marks partial and retains previous healthy data`, async () => {
    const h = harness(), before = h.state()
    h.deps[target.loader] = async () => { throw new Error('Synthetic outage') }
    await h.load(target.options)
    await h.load(target.options)
    assert.deepEqual(h.state().errors, [`${target.source}:unavailable`])
    assert.equal(h.state().partial, true)
    assert.equal(h.state()[target.field], before[target.field])
    assert.equal(h.state().matches, before.matches)
  })
  for (const failure of [false, true]) test(`${target.source} newer targeted ${failure ? 'failure' : 'recovery'} survives slower full attention`, async () => {
    const h = harness([`${target.source}:old`]), attention = deferred(), started = deferred()
    h.deps.getCoachPhase31GAttentionSnapshot = () => { started.resolve(); return attention.promise }
    const full = h.load({ refresh: true })
    await started.promise
    assert.ok(h.state().errors.includes(`${target.source}:old`), 'primary progress retains source health')
    h.deps[target.loader] = failure ? async () => { throw new Error('Synthetic outage') } : async () => target.value
    await h.load(target.options)
    attention.resolve({ ...healthy(), errors: failure ? [] : [`${target.source}:older-full-failure`], partial: !failure })
    await full
    assert.deepEqual(h.state().errors, failure ? [`${target.source}:unavailable`] : [])
    assert.equal(h.state().partial, failure)
    assert.equal(h.state()[target.field], failure ? (target.source === 'invites' ? 9 : 2) : target.expected)
  })
  for (const change of ['newer-target', 'full-refresh', 'context']) test(`${target.source} late failure cannot overwrite ${change}`, async () => {
    const h = harness(), slow = deferred()
    h.deps[target.loader] = () => slow.promise
    const old = h.load(target.options)
    h.deps[target.loader] = async () => target.value
    if (change === 'newer-target') await h.load(target.options)
    if (change === 'full-refresh') await h.load({ refresh: true })
    if (change === 'context') { h.deps.requestIdRef.current++; h.deps.setHomeState(healthy()) }
    const current = h.state()
    slow.reject(new Error('Synthetic late outage'))
    await old
    assert.equal(h.state(), current)
  })
}

test('overlapping targeted sources recover independently in either completion order', async () => {
  for (const order of [targets, [...targets].reverse()]) {
    const h = harness(['invites:unavailable', 'chatRooms:unavailable']), pending = targets.map(() => deferred())
    targets.forEach((target, i) => { h.deps[target.loader] = () => pending[i].promise })
    const loads = targets.map(target => h.load(target.options))
    for (const target of order) { const i = targets.indexOf(target); pending[i].resolve(target.value); await loads[i] }
    assert.deepEqual(h.state().errors, [])
    assert.equal(h.state().partial, false)
  }
})

test('full forced retry clears every source failure and forces primary and attention reads', async () => {
  const h = harness(['matches:unavailable', 'calendar:unavailable', 'sessions:unavailable', 'development:unavailable', 'polls:unavailable', 'invites:unavailable', 'chatRooms:unavailable'])
  await h.load({ refresh: true })
  assert.deepEqual(h.state().errors, [])
  assert.equal(h.state().partial, false)
  assert.equal(h.reads[0].options.force, true)
  assert.deepEqual(h.attentionOptions, [{ force: true }])
  assert.ok(source.includes('homeState.partial && !homeState.stale ? <Pressable'))
  assert.ok(source.includes('onPress={() => reloadHome({ refresh: true })}'))
})

test('unclassified attention failure survives targeted recovery until a full successful retry', async () => {
  const h = harness()
  h.deps.getCoachPhase31GAttentionSnapshot = async () => { throw new Error('Synthetic attention outage') }
  await h.load({ refresh: true })
  await h.load({ availabilityOnly: true })
  await h.load({ chatOnly: true })
  assert.deepEqual(h.state().errors, ['attention:unavailable'])
  assert.equal(h.state().partial, true)
  h.deps.getCoachPhase31GAttentionSnapshot = async () => healthy()
  await h.load({ refresh: true })
  assert.equal(h.state().partial, false)
})

for (const failedSource of ['matches', 'sessions', 'calendar', 'development', 'chatRooms', 'polls', 'invites']) test(`full retry retains ${failedSource} failure until that source recovers`, async () => {
  const h = harness()
  const primarySource = ['matches', 'sessions', 'calendar'].includes(failedSource)
  const loader = primarySource ? 'getCoachPhase31GPrimaryHomeSnapshot' : 'getCoachPhase31GAttentionSnapshot'
  h.deps[loader] = async () => ({ ...healthy(), errors: [`${failedSource}:unavailable`], partial: true })
  await h.load({ refresh: true })
  assert.deepEqual(h.state().errors, [`${failedSource}:unavailable`])
  assert.equal(h.state().partial, true)
  h.deps[loader] = async () => healthy()
  await h.load({ refresh: true })
  assert.deepEqual(h.state().errors, [])
  assert.equal(h.state().partial, false)
})

for (const transition of ['newer full refresh', 'context reset']) test(`late full attention cannot replace ${transition}`, async () => {
  const h = harness(), attention = deferred(), started = deferred()
  h.deps.getCoachPhase31GAttentionSnapshot = () => { started.resolve(); return attention.promise }
  const old = h.load({ refresh: true })
  await started.promise
  if (transition === 'newer full refresh') {
    h.deps.getCoachPhase31GAttentionSnapshot = async () => healthy()
    await h.load({ refresh: true })
  } else { h.deps.requestIdRef.current++; h.deps.setHomeState(healthy()) }
  const current = h.state()
  attention.resolve({ ...healthy(), errors: ['polls:late'], partial: true })
  await old
  assert.equal(h.state(), current)
})
