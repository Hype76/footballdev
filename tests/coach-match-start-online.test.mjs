import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'
const source = readFileSync(new URL('../apps/coach-mobile/src/CoachMatchDayScreen.js', import.meta.url), 'utf8')
const body = source.slice(source.indexOf('  const runTimer = action => {'), source.indexOf('\n  const runFinish', source.indexOf('  const runTimer = action => {')))
function fixture(overrides = {}) {
  const calls = []
  const dependencies = { user: { isOfflineProfile: false }, stale: false, reconciling: false, busyRef: { current: false },
    outbox: { syncing: false, journal: { pending: [], error: '', errorCode: '' } }, canQueueFullTime: true,
    OFFLINE_MATCH_TIMER_ACTIONS: new Set(['start','pause','full_time']), match: { id: 'fixture' }, selectedMatchId: { current: 'fixture' },
    capture: async (...args) => { calls.push(['capture', ...args]); return 'queued' },
    replace: async operation => { calls.push(['replace']); return operation() },
    runCoachMatchDayTimerAction: async (_user, _match, action) => { calls.push(['server', action]); return 'live' },
    isCoachMatchDayTimerActionApplied: () => true, setError: message => calls.push(['error', message]), ...overrides }
  return { calls, run: new Function(...Object.keys(dependencies), `${body}; return runTimer`)(...Object.values(dependencies)) }
}
test('fresh connected start uses server without requiring a phone write', async () => {
  const f = fixture(); assert.equal(await f.run('start'), 'live'); assert.deepEqual(f.calls, [['replace'], ['server', 'start']])
})
test('offline, stale and unknown state retain the existing queue path', async () => {
  for (const overrides of [{ user: { isOfflineProfile: true } }, { stale: true }, { outbox: { syncing: false, journal: null } }]) {
    const f = fixture(overrides); assert.equal(await f.run('start'), 'queued'); assert.equal(f.calls[0][0], 'capture')
  }
})
test('pending, rejected, syncing, reconciling or busy starts cannot be duplicated', async () => {
  for (const overrides of [{ outbox: { syncing: true, journal: { pending: [] } } },
    { outbox: { syncing: false, journal: { pending: [{}] } } }, { outbox: { syncing: false, journal: { pending: [], error: 'rejected' } } },
    { reconciling: true }, { busyRef: { current: true } }]) {
    const f = fixture(overrides); await assert.rejects(f.run('start')); assert.equal(f.calls.length, 1); assert.equal(f.calls[0][0], 'error')
  }
})
test('a stale Fixture view cannot start a different selected match', async () => {
  const f = fixture({ selectedMatchId: { current: 'other-fixture' } })
  await assert.rejects(f.run('start'), /selected fixture changed/)
  assert.deepEqual(f.calls, [['error', 'The selected fixture changed. Open it again before starting the match.']])
})
test('other offline timer actions retain their queue route', async () => {
  const f = fixture(); assert.equal(await f.run('pause'), 'queued'); assert.equal(f.calls[0][0], 'capture')
})
const replaceBody = source.slice(source.indexOf('  const replace = async (operation, verify) => {'), source.indexOf('\n  const confirm = async', source.indexOf('  const replace = async (operation, verify) => {')))
function replaceFixture({ failRead = false } = {}) {
  const changes = { notices: [], errors: [], reconciling: [] }
  const detail = { id: 'fixture', homeScore: 0, awayScore: 0 }
  const selection = {current:'fixture'}, epoch = {current:0}
  const deps = { selectedMatchId: selection, selectionEpochRef: epoch, matches: [detail], match: detail, players: [], user: {}, matchRef: {}, busyRef: {}, reconciliationPendingRef: {}, uncertainFixtureIdsRef: { current: new Set() },
    setBusy: () => {}, setError: value => changes.errors.push(value), setNotice: value => changes.notices.push(value),
    setReconciling: value => changes.reconciling.push(value), setMatch: () => {}, setMatches: () => {}, setScoreDraft: () => {}, setStale: () => {},
    cache: async () => { throw Error('phone storage failed') },
    getCoachMatchDayDetail: async () => { if (failRead) throw Error('offline'); return detail },
    errorMessage: (error, fallback) => error.message || fallback }
  return { changes, selection, epoch, replace: new Function(...Object.keys(deps), `${replaceBody}; return replace`)(...Object.values(deps)), detail }
}
test('confirmed online start survives failed phone cache without uncertain reconciliation', async () => {
  const f = replaceFixture(); assert.equal(await f.replace(async () => f.detail), f.detail); await new Promise(resolve => setImmediate(resolve))
  assert.ok(f.changes.notices.some(value => typeof value === 'function' && value('').includes('saved online')))
  assert.ok(!f.changes.reconciling.includes(true))
})
test('failed server start reconciles before permitting retry', async () => {
  const f = replaceFixture(); await assert.rejects(f.replace(async () => { throw Error('server rejected') }, () => false))
  assert.ok(f.changes.errors.some(value => value.includes('server confirmed it was not saved')))
  const uncertain = replaceFixture({ failRead: true }); await assert.rejects(uncertain.replace(async () => { throw Error('network failed') }, () => false))
  assert.ok(uncertain.changes.errors.some(value => value.includes('Refresh to reconcile')))
})
test('late start cannot return success or change the newly selected fixture', async () => {
  let release; const wait=new Promise(resolve => { release=resolve })
  const f=replaceFixture(); const operation=f.replace(() => wait)
  f.selection.current='other'; f.epoch.current++
  release(f.detail); await assert.rejects(operation, /Fixture changed/)
  assert.equal(f.changes.reconciling.includes(true),false)
})
