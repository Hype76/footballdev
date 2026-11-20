import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'
const source = readFileSync(new URL('../apps/coach-mobile/src/CoachMatchDayScreen.js', import.meta.url), 'utf8')
const slice = (start, end) => source.slice(source.indexOf(start), source.indexOf(end, source.indexOf(start)))
const openSource = slice('  const open = async (summary) => {', '\n  const replace = async')
const closeSource = slice('  const closeFixture = () => {', '\n  const focusedLiveMode')
function fixture({ pendingSquadCount = 0 } = {}) {
  const state = { busy: false, reconciling: true, selected: 'A', errors: [], notices: [], fail: false, details: [] }
  const selectedMatchId = { current: 'A' }, matchRef = { current: { id: 'A' } }, busyRef = { current: true }
  const reconciliationPendingRef = { current: true }, uncertainFixtureIdsRef = { current: new Set(['A']) }
  const selectionEpochRef = { current: 0 }
  const selectSource = slice('  const selectFixture = useCallback(', '\n  const targetRequestId')
  const selectFixture = new Function('useCallback', 'selectedMatchId', 'selectionEpochRef', 'reconciliationPendingRef', 'uncertainFixtureIdsRef', 'busyRef', `${selectSource}; return selectFixture`)(
    callback => callback, selectedMatchId, selectionEpochRef, reconciliationPendingRef, uncertainFixtureIdsRef, busyRef,
  )
  const context = { id: 'team' }, contextRef = { current: context }, user = { id: 'coach' }, userRef = { current: user }
  const dependencies = { selectedMatchId, selectionEpochRef, selectFixture, matchRef, busyRef, reconciliationPendingRef, uncertainFixtureIdsRef, context, contextRef, user, userRef,
    get busy() { return state.busy }, pendingSquadCount,
    setBusy: x => { state.busy = x }, setReconciling: x => { state.reconciling = x }, setError: x => state.errors.push(x),
    setNotice: x => state.notices.push(x), setMatch: x => { state.selected = x?.id || '' }, setPanel: () => {},
    readCoachMatchDayOutbox: async () => null, readCoachOfflineResources: async () => null,
    withMobileAsyncTimeout: fn => fn(), getCoachMatchDayDetail: async (_user, id) => { if (state.detailHandler) return state.detailHandler(id); if (state.fail) throw Error('offline'); state.details.push(id); return { id, homeScore: 0, awayScore: 0 } },
    normalizeCoachMatchDay: x => x, setStale: () => {}, playersStaleRef: { current: false }, accessDeniedRef: {}, setAccessDenied: () => {},
    setScoreDraft: () => {}, setEventForm: () => {}, createCoachMatchDayEventForm: () => ({}), isLiveMatch: () => false,
    cache: async () => {}, matches: [], players: [], isMatchDayAccessDenied: () => false, clearDenied: () => {}, errorMessage: e => e.message }
  const names=Object.keys(dependencies)
  const factory=new Function(...names, `${openSource}\n${closeSource}\nreturn {open,closeFixture}`)
  return { state, selectFixture, selectedMatchId, selectionEpochRef, busyRef, reconciliationPendingRef, uncertainFixtureIdsRef, ...factory(...names.map(name => dependencies[name])) }
}
async function startSelected(f, id) {
  const timerSource = slice('  const runTimer = action => {', '\n  const runFinish')
  const starts = []
  const dependencies = {
    user: { isOfflineProfile: false },
    stale: false,
    reconciling: f.state.reconciling,
    outbox: { syncing: false, journal: { pending: [] } },
    busyRef: f.busyRef,
    setError: message => f.state.errors.push(message),
    replace: async operation => operation(),
    runCoachMatchDayTimerAction: async (_user, match) => { starts.push(match.id); return match },
    match: { id },
    selectedMatchId: f.selectedMatchId,
    isCoachMatchDayTimerActionApplied: () => true,
    OFFLINE_MATCH_TIMER_ACTIONS: new Set(['start']),
    capture: async () => { throw new Error('Unexpected queue call') },
    canQueueFullTime: true,
  }
  const runTimer = new Function(...Object.keys(dependencies), `${timerSource}; return runTimer`)(...Object.values(dependencies))
  await runTimer('start')
  return starts
}
test('uncertain A remains protected while B opens and A can be reconciled on return', async () => {
  const f=fixture(); f.closeFixture(); assert.equal(f.state.selected, ''); assert.equal(f.state.reconciling, false)
  assert.equal(f.uncertainFixtureIdsRef.current.has('A'), true)
  await f.open({id:'B'}); assert.equal(f.state.selected,'B'); assert.equal(f.state.reconciling,false); assert.equal(f.uncertainFixtureIdsRef.current.has('A'),true)
  const starts = await startSelected(f, 'B')
  assert.deepEqual(starts, ['B'])
  assert.ok(f.uncertainFixtureIdsRef.current.has('A'))
  f.closeFixture(); f.state.fail=true; await f.open({id:'A'}); assert.equal(f.state.reconciling,true); assert.equal(f.uncertainFixtureIdsRef.current.has('A'),true)
  f.state.fail=false; await f.open({id:'A'}); assert.equal(f.state.reconciling,false); assert.equal(f.uncertainFixtureIdsRef.current.has('A'),false)
})
test('in-flight action and unsaved squad still prevent leaving', () => {
  const f=fixture(); f.reconciliationPendingRef.current=false; f.closeFixture(); assert.equal(f.selectedMatchId.current,'A'); assert.match(f.state.notices.at(-1),/finish/)
  const squad=fixture({pendingSquadCount:1}); squad.closeFixture(); assert.equal(squad.selectedMatchId.current,'A'); assert.match(squad.state.notices.at(-1),/squad selections/)
})

test('late fixture A detail cannot overwrite a newer B selection', async () => {
  const f=fixture(); f.closeFixture()
  let releaseA; f.state.detailHandler = id => id === 'A' ? new Promise(resolve => { releaseA = resolve }) : Promise.resolve({id,homeScore:0,awayScore:0})
  const openingA=f.open({id:'A'}); await new Promise(resolve => setImmediate(resolve))
  await f.open({id:'B'}); releaseA({id:'A',homeScore:0,awayScore:0}); await openingA
  assert.equal(f.state.selected,'B'); assert.equal(f.uncertainFixtureIdsRef.current.has('A'),true)
})
test('external fixture selection releases only the earlier reconciliation lock', async () => {
  const f = fixture()
  const previousEpoch = f.selectionEpochRef.current
  f.selectFixture('B')
  assert.equal(f.reconciliationPendingRef.current, false)
  assert.equal(f.busyRef.current, false)
  assert.ok(f.uncertainFixtureIdsRef.current.has('A'))
  await f.open({ id: 'B' })
  assert.equal(f.state.selected, 'B')
  assert.equal(f.state.reconciling, false)
  assert.equal(f.busyRef.current, false)
  assert.deepEqual(await startSelected(f, 'B'), ['B'])
  f.selectFixture('A')
  assert.equal(f.reconciliationPendingRef.current, true)
  assert.notEqual(f.selectionEpochRef.current, previousEpoch)
  assert.match(source, /selectionEpochRef\.current !== loadSelectionEpoch/)
})
test('external selection keeps an actual server operation busy', () => {
  const f = fixture()
  f.reconciliationPendingRef.current = false
  f.selectFixture('B')
  assert.equal(f.busyRef.current, true)
})
