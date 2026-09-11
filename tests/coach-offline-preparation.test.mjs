import assert from 'node:assert/strict'
import test from 'node:test'
import { prepareCoachOfflineData, createCoachPreparationRunner, COACH_PREPARATION_REFRESH_MS } from '../apps/coach-mobile/src/coachOfflinePreparation.js'

function fixture() {
  const state = { resources: {}, resourceMetadata: {}, journals: new Map(), reads: 0, writes: 0, current: true }
  const now = () => Date.parse('2026-09-10T12:00:00Z')
  const dependencies = {
    readResources: async () => state,
    readOutbox: async (_u, _c, id) => state.journals.get(id),
    saveResources: async (_u, _c, values) => { state.writes++; Object.assign(state.resources, values); for (const key of Object.keys(values)) state.resourceMetadata[key] = { savedAt: new Date(now()).toISOString() } },
    getPlayers: async () => { state.reads++; return [{ id: 'player' }] },
    getDevelopment: async () => ({ forms: [{ id: 'form' }] }), getCalendar: async () => [{ id: 'training' }],
    getMatches: async () => Array.from({ length: 10 }, (_, i) => ({ id: `match${i}`, matchDate: '2099-01-01', status: 'scheduled' })),
    getMatch: async (_user, id) => ({ id }),
    updateOutbox: async (_u, _c, id, change) => state.journals.set(id, change(state.journals.get(id))),
  }
  const options = { user: { id: 'coach' }, context: { id: 'team', teamId: 'team' }, dependencies, now, isCurrent: () => state.current }
  return { state, options, dependencies }
}

test('preparation saves without user action, bounds fixtures, keeps pending actions and skips fresh data', async () => {
  const { state, options } = fixture()
  const pending = { baseMatch: { id: 'match0' }, pending: [{ id: 'unsent' }] }
  state.journals.set('match0', pending)
  await prepareCoachOfflineData(options)
  assert.equal(state.journals.size, 8)
  assert.equal(state.journals.get('match0'), pending)
  assert.ok(state.resources.calendar && state.resources['phase31e:development'])
  const reads = state.reads
  assert.equal((await prepareCoachOfflineData(options)).skipped, true)
  assert.equal(state.reads, reads)
  state.journals.delete('match7')
  await prepareCoachOfflineData(options)
  assert.ok(state.journals.has('match7'), 'A fresh match list cannot conceal missing fixture details')
})

test('switching account or context cancels writes from in-flight reads', async () => {
  const { state, options, dependencies } = fixture()
  dependencies.getPlayers = async () => { state.current = false; return [{ id: 'old-team-player' }] }
  assert.equal((await prepareCoachOfflineData(options)).cancelled, true)
  assert.equal(state.writes, 0)
  assert.equal(state.journals.size, 0)
})

test('partial download failures keep prior data and retry remaining preparation', async () => {
  const { state, options, dependencies } = fixture()
  const getMatch = dependencies.getMatch
  dependencies.getMatch = async (_u, id) => { if (id === 'match2') throw Error('offline'); return { id } }
  await assert.rejects(prepareCoachOfflineData(options), /offline/)
  assert.equal(state.journals.size, 2)
  assert.equal(state.resources.matchDayList, undefined)
  dependencies.getMatch = getMatch
  await prepareCoachOfflineData(options)
  assert.equal(state.journals.size, 8)
})

test('runner prevents overlapping requests, backs off failures, pauses when inactive and stops permanently', async () => {
  let currentTime = 0, active = true, calls = 0, release
  const runner = createCoachPreparationRunner({ now: () => currentTime, isActive: () => active, run: async valid => { calls++; await new Promise(resolve => { release = resolve }); return { cancelled: !valid() } } })
  const pending = runner.refresh()
  await runner.refresh()
  assert.equal(calls, 1)
  release(); await pending
  await runner.refresh(); assert.equal(calls, 1)
  currentTime += COACH_PREPARATION_REFRESH_MS
  active = false; await runner.refresh(); assert.equal(calls, 1)
  active = true; runner.stop(); await runner.refresh(); assert.equal(calls, 1)
  const failure = createCoachPreparationRunner({ now: () => currentTime, isActive: () => true, run: async () => { calls++; throw Error('offline') } })
  await failure.refresh(); await failure.refresh(); assert.equal(calls, 2)
  currentTime += 30_000; await failure.refresh(); assert.equal(calls, 3)
})


test('repairing one missing fixture does not download or redate already fresh resources', async () => {
  const { state, options, dependencies } = fixture()
  await prepareCoachOfflineData(options)
  const writes = state.writes
  const reads = state.reads
  state.journals.delete('match7')
  let details = 0
  dependencies.getMatch = async (_user, id) => { details++; return { id } }
  await prepareCoachOfflineData(options)
  assert.equal(details, 1)
  assert.equal(state.reads, reads)
  assert.equal(state.writes, writes)
})
