import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'
import { isMatchdayPlan, isMobileRouteAllowed } from '../apps/mobile-core/src/matchdayPolicyCore.js'
import { parse } from '@babel/parser'
import { buildCoachChatSummary, countPendingCoachAvailability, preserveCoachAvailabilitySummary, preserveCoachChatSummary, preserveCoachDevelopmentSummary, updateCoachHomeSourceState } from '../apps/mobile-core/src/coachPhase31GCore.js'
import { mergeUnfinishedDevelopmentDrafts } from '../apps/mobile-core/src/developmentOfflineCore.js'
import { normalizeCoachInvite } from '../apps/mobile-core/src/coachPhase31ECore.js'
import { createParentHomePreferences } from '../apps/parent-mobile/src/parentHomePreferencesCore.js'

const source = await readFile(new URL('../apps/coach-mobile/App.js', import.meta.url), 'utf8')
const ast = parse(source, { sourceType: 'module', plugins: ['jsx'] })
function find(node, predicate) {
  if (!node || typeof node !== 'object') return null
  if (predicate(node)) return node
  for (const value of Object.values(node)) {
    const result = Array.isArray(value) ? value.map(item => find(item, predicate)).find(Boolean) : find(value, predicate)
    if (result) return result
  }
  return null
}
const callback = find(ast, node => node.type === 'VariableDeclarator' && node.id.name === 'loadHome').init.arguments[0]
const effect = find(ast, node => node.type === 'CallExpression' && node.callee.name === 'useEffect' && source.slice(node.arguments[0].start, node.arguments[0].end).includes('const returnedHome')).arguments[0]
const evaluate = (node, dependencies) => new Function(...Object.keys(dependencies), `return (${source.slice(node.start, node.end)})`)(...Object.values(dependencies))
const deferred = () => { let resolve; const promise = new Promise(done => { resolve = done }); return { promise, resolve } }
const invite = (id, extra = {}) => ({ id, kind: 'match', eventId: 'match', playerId: id, status: 'awaiting', sentAt: '2026-01-01', eventAt: new Date(Date.now() + 86400000).toISOString(), ...extra })
function harness(initial = { pendingAvailability: 107, unreadChat: 2, errors: ['polls:unavailable'] }) {
  let state = initial
  const reads = []
  const dependencies = {
    isMatchdayPlan, isMobileRouteAllowed,
    HOME_REFRESH_MIN_INTERVAL_MS: 180000,
    selectedMobileUser: { id: 'coach', clubId: 'club', activeTeamId: 'team' },
    requestIdRef: { current: 1 }, chatRefreshIdRef: { current: 0 }, availabilityRefreshIdRef: { current: 0 },
    developmentRefreshIdRef: { current: 0 }, homeStateRef: { current: state },
    homeDeniedScopeRef: { current: false },
    readCoachDevelopmentDrafts: async () => ({}), mergeUnfinishedDevelopmentDrafts, preserveCoachDevelopmentSummary,
    setHomeState: update => { state = typeof update === 'function' ? update(state) : update; dependencies.homeStateRef.current = state },
    readMobileResource: async (user, key, loader, options) => { reads.push({ user, key, options }); return loader() },
    getCoachInvitesAndAvailability: async () => ({ all: [invite('one'), invite('two', { status: 'available' })] }),
    getCoachChatRooms: async () => [], countPendingCoachAvailability, buildCoachChatSummary, preserveCoachAvailabilitySummary, preserveCoachChatSummary, updateCoachHomeSourceState,
    setIsRefreshing() {}, peekMobileResource: () => undefined, readCoachOfflineResources: async () => null, readCoachHomeOfflineView: async () => ({ cache: null, developmentDrafts: {} }),
    activeContext: {}, user: { id: 'coach' }, getCoachPhase31GPrimaryHomeSnapshot: async () => ({ pendingAvailability: 0 }),
    setLastUpdatedAt() {}, lastHomeRefreshAtRef: { current: 0 }, saveCoachOfflineResources: async () => {},
    InteractionManager: { runAfterInteractions() {} },
    getCoachPhase31GAttentionSnapshot: async () => ({ pendingAvailability: 107, errors: [] }),
    mergeCoachPhase31GHomeSnapshots: (primary, attention) => ({ ...primary, ...attention }),
    getCoachFriendlyError: () => 'Unavailable',
    recordCoachPerformanceSample() {},
  }
  return { dependencies, reads, state: () => state, load: () => evaluate(callback, dependencies) }
}

test('Coach Home keeps same-scope data while refreshing without replacing it from storage', async () => {
  const h = harness({ savedAt: '2026-01-01', hasSnapshot: true, loading: false, pendingAvailability: 23, errors: [] })
  const primary = deferred(); let diskReads = 0
  h.dependencies.getCoachPhase31GPrimaryHomeSnapshot = () => primary.promise
  h.dependencies.readCoachHomeOfflineView = async () => { diskReads++; return { cache: { resources: { home: { pendingAvailability: 3 } } } } }
  const refresh = h.load()()
  await Promise.resolve()
  assert.equal(h.state().pendingAvailability, 23)
  assert.equal(h.state().loading, false)
  assert.equal(diskReads, 0)
  primary.resolve({ pendingAvailability: 4 })
  await refresh
})

test('Coach Home publishes expired scoped cache while fetching live data', async () => {
  const h = harness({ loading: true, savedAt: '', error: '', pendingAvailability: 0, errors: [] })
  const primary = deferred(); let options
  h.dependencies.peekMobileResource = (_user, _key, value) => { options = value; return { nextMatch: { id: 'cached' } } }
  h.dependencies.getCoachPhase31GPrimaryHomeSnapshot = () => primary.promise
  const refresh = h.load()()
  await Promise.resolve()
  assert.deepEqual(options, { allowStale: true })
  assert.equal(h.state().nextMatch.id, 'cached')
  assert.equal(h.state().stale, true)
  assert.equal(h.state().loading, false)
  primary.resolve({ nextMatch: null })
  await refresh
  assert.equal(h.state().nextMatch, null)
})

test('Coach Home live result does not wait for a slow phone read and ignores its late result', async () => {
  const h = harness({ loading: true, savedAt: '', error: '', errors: [] }), disk = deferred()
  h.dependencies.readCoachHomeOfflineView = () => disk.promise
  h.dependencies.getCoachPhase31GPrimaryHomeSnapshot = async () => ({ nextMatch: { id: 'live' } })
  await h.load()()
  assert.equal(h.state().nextMatch.id, 'live')
  disk.resolve({ cache: { resources: { home: { nextMatch: { id: 'old' } } } }, developmentDrafts: {} })
  await Promise.resolve()
  assert.equal(h.state().nextMatch.id, 'live')
})

test('Coach Home permission denial clears retained data and prevents cached rehydration', async () => {
  const h = harness({ savedAt: '2026-01-01', hasSnapshot: true, loading: false, nextMatch: { id: 'protected' }, errors: [] })
  h.dependencies.getCoachPhase31GPrimaryHomeSnapshot = async () => { throw Object.assign(new Error('permission denied'), { code: '42501' }) }
  await h.load()({ refresh: true })
  assert.equal(h.state().nextMatch, undefined)
  assert.equal(h.dependencies.homeDeniedScopeRef.current, true)
  let readOptions
  h.dependencies.readMobileResource = async (_user, _key, loader, options) => { readOptions = options; return loader() }
  h.dependencies.peekMobileResource = () => ({ nextMatch: { id: 'old' } })
  const pending = deferred()
  h.dependencies.getCoachPhase31GPrimaryHomeSnapshot = () => pending.promise
  const retry = h.load()()
  await Promise.resolve()
  assert.equal(h.state().nextMatch, undefined)
  assert.equal(readOptions.force, true)
  pending.resolve({ nextMatch: null })
  await retry
})

test('an older Coach Home success cannot clear a newer permission denial', async () => {
  const h = harness({ savedAt: '2026-01-01', hasSnapshot: true, loading: false, nextMatch: { id: 'protected' }, errors: [] })
  const pending = deferred()
  h.dependencies.getCoachPhase31GPrimaryHomeSnapshot = () => pending.promise
  const older = h.load()({ refresh: true })
  h.dependencies.getCoachPhase31GPrimaryHomeSnapshot = async () => { throw Object.assign(new Error('restricted'), { status: 403 }) }
  await h.load()({ refresh: true })
  assert.equal(h.dependencies.homeDeniedScopeRef.current, true)
  pending.resolve({ nextMatch: { id: 'obsolete' } })
  await older
  assert.equal(h.dependencies.homeDeniedScopeRef.current, true)
  assert.equal(h.state().nextMatch, undefined)
})

test('Coach operational permission classifiers recognise HTTP 403 without message text', async () => {
  for (const [file, name] of [
    ['CoachOperationalScreens.js', 'operationalAccessDenied'],
    ['CoachFormationScreen.js', 'isFormationAccessDenied'],
    ['CoachMatchDayScreen.js', 'isMatchDayAccessDenied'],
  ]) {
    const input = await readFile(new URL(`../apps/coach-mobile/src/${file}`, import.meta.url), 'utf8')
    const node = parse(input, { sourceType: 'module', plugins: ['jsx'] }).program.body.find(item => item.type === 'FunctionDeclaration' && item.id.name === name)
    const classify = new Function(`${input.slice(node.start, node.end)}; return ${name}`)()
    assert.equal(classify({ status: 403 }), true, file)
    assert.equal(classify({ statusCode: 403 }), true, file)
    assert.equal(classify({ status: 500 }), false, file)
  }
})

test('Coach Home retains known source values on partial network failure but clears successful empty results', async () => {
  const h = harness({ savedAt: '2026-01-01', hasSnapshot: true, loading: false, nextMatch: { id: 'saved-match' }, pendingAvailability: 8, homeSources: { invites: true }, errors: [] })
  h.dependencies.getCoachPhase31GPrimaryHomeSnapshot = async () => ({ nextMatch: null, matches: [], errors: ['matches:network unavailable'], partial: true })
  h.dependencies.getCoachPhase31GAttentionSnapshot = async () => ({ pendingAvailability: 0, errors: ['invites:network unavailable'] })
  await h.load()({ refresh: true })
  assert.equal(h.state().nextMatch.id, 'saved-match')
  assert.equal(h.state().homeSavedSources.matches, true)
  assert.equal(h.state().pendingAvailability, 8)
  assert.equal(h.state().homeSources.invites, true)
  h.dependencies.getCoachPhase31GPrimaryHomeSnapshot = async () => ({ nextMatch: null, matches: [], errors: [] })
  h.dependencies.getCoachPhase31GAttentionSnapshot = async () => ({ pendingAvailability: 0, errors: [] })
  await h.load()({ refresh: true })
  assert.equal(h.state().nextMatch, null)
  assert.equal(h.state().pendingAvailability, 0)
})

test('Coach Home primary reports pending, ready and denied sources and preserves typed total failure', async () => {
  const data = await readFile(new URL('../apps/mobile-core/src/coachPhase31GData.js', import.meta.url), 'utf8')
  const start = data.indexOf('export async function getCoachPhase31GPrimaryHomeSnapshot(')
  const end = data.indexOf('export async function getCoachPhase31GAttentionSnapshot(', start)
  const body = data.slice(start, end).replace('export async function', 'async function')
  const matches = deferred(), sessions = deferred(), calendar = deferred(), progress = []
  const create = new Function('getCoachMatchDays', 'getCoachSessions', 'getCoachCalendarResources', 'withMobileAsyncTimeout', 'isMobileRouteAllowed', 'buildCoachHomeOperationalSnapshot', 'sourceError', `${body}; return getCoachPhase31GPrimaryHomeSnapshot`)
  const sourceError = (name, result) => result.status === 'rejected' ? `${name}:${result.reason.message}` : ''
  const load = create(() => matches.promise, () => sessions.promise, () => calendar.promise, fn => fn(), () => true, value => ({ ...value }), sourceError)
  const request = load({}, value => progress.push(value))
  matches.resolve([])
  await new Promise(resolve => setImmediate(resolve))
  assert.deepEqual(progress.at(-1).sourceStates, { matches: 'ready', sessions: 'pending', calendar: 'pending' })
  sessions.resolve([]); calendar.resolve([])
  const result = await request
  assert.deepEqual(result.sourceStates, { matches: 'ready', sessions: 'ready', calendar: 'ready' })
  const denied = Object.assign(new Error('access refused'), { code: '42501' })
  const fail = create(async () => { throw new Error('network') }, async () => { throw denied }, async () => { throw new Error('network') }, fn => fn(), () => true, value => value, sourceError)
  await assert.rejects(fail({}, value => progress.push(value)), error => error === denied)
  assert.equal(progress.at(-1).sourceStates.sessions, 'denied')
  const forbidden = Object.assign(new Error('restricted'), { status: 403 })
  const fail403 = create(async () => { throw new Error('network') }, async () => { throw forbidden }, async () => { throw new Error('network') }, fn => fn(), () => true, value => value, sourceError)
  await assert.rejects(fail403({}, value => progress.push(value)), error => error === forbidden)
  assert.equal(progress.at(-1).sourceStates.sessions, 'denied')
})

test('Coach Home source errors preserve code-only and HTTP permission denials', async () => {
  const data = await readFile(new URL('../apps/mobile-core/src/coachPhase31GData.js', import.meta.url), 'utf8')
  const start = data.indexOf('function sourceError(')
  const end = data.indexOf('export async function getCoachPhase31GHomeSnapshot(', start)
  const sourceError = new Function(`${data.slice(start, end)}; return sourceError`)()
  assert.equal(sourceError('invites', { status: 'rejected', reason: { code: '42501' } }), 'invites:permission denied')
  assert.equal(sourceError('chatRooms', { status: 'rejected', reason: { status: 403 } }), 'chatRooms:permission denied')
  assert.equal(sourceError('development', { status: 'rejected', reason: { statusCode: 403 } }), 'development:permission denied')
  assert.equal(sourceError('polls', { status: 'rejected', reason: { message: 'network unavailable' } }), 'polls:network unavailable')
})

test('actual Coach targeted refresh replaces 107 with current responses without reloading other domains', async () => {
  const h = harness()
  await h.load()({ availabilityOnly: true })
  assert.equal(h.state().pendingAvailability, 1)
  assert.equal(h.state().unreadChat, 2)
  assert.deepEqual(h.state().errors, ['polls:unavailable'])
  assert.deepEqual(h.reads.map(read => [read.key, read.options.force]), [['coach:home-availability-summary', true]])
})

test('late Coach reads cannot overwrite a newer response or another context', async () => {
  const h = harness(), slow = deferred()
  h.dependencies.getCoachInvitesAndAvailability = () => slow.promise
  const old = h.load()({ availabilityOnly: true })
  h.dependencies.getCoachInvitesAndAvailability = async () => ({ all: [] })
  await h.load()({ availabilityOnly: true })
  slow.resolve({ all: [invite('one')] })
  await old
  assert.equal(h.state().pendingAvailability, 0)
  const other = deferred()
  h.dependencies.getCoachInvitesAndAvailability = () => other.promise
  const changingContext = h.load()({ availabilityOnly: true })
  h.dependencies.requestIdRef.current++
  other.resolve({ all: [invite('one')] })
  await changingContext
  assert.equal(h.state().pendingAvailability, 0)
})

test('slower full Home attention cannot replace a newer targeted availability result', async () => {
  const h = harness(), attention = deferred(), started = deferred()
  h.dependencies.getCoachPhase31GAttentionSnapshot = () => { started.resolve(); return attention.promise }
  const full = h.load()({ refresh: true })
  await started.promise
  assert.equal(h.state().pendingAvailability, 107, 'primary rendering must not flash zero')
  await h.load()({ availabilityOnly: true })
  attention.resolve({ pendingAvailability: 107, errors: [] })
  await full
  assert.equal(h.state().pendingAvailability, 1)
})

test('failed refresh is unavailable, then recovers, and offline profiles make no reads', async () => {
  const h = harness()
  h.dependencies.getCoachInvitesAndAvailability = async () => { throw new Error('Offline') }
  await h.load()({ availabilityOnly: true })
  assert.ok(h.state().errors.includes('invites:unavailable'))
  h.dependencies.getCoachInvitesAndAvailability = async () => ({ all: [] })
  await h.load()({ availabilityOnly: true })
  assert.deepEqual(h.state().errors, ['polls:unavailable'])
  h.dependencies.selectedMobileUser.isOfflineProfile = true
  const before = h.reads.length
  await h.load()({ availabilityOnly: true })
  assert.equal(h.reads.length, before)
})

test('Home re-entry, foreground timer and trusted-app notification refresh availability; cleanup and background stop polling', () => {
  const calls = [], timers = []
  let notification, removed = false
  const dependencies = {
    activeRoute: 'home', previousHomeRouteRef: { current: 'more' }, contextOwnedByCurrentUser: true,
    selectedMobileUser: { activeTeamId: 'team' }, appStateRef: { current: 'active' },
    loadHome: async options => { calls.push(options) }, HOME_REFRESH_MIN_INTERVAL_MS: 30000,
    Notifications: { addNotificationReceivedListener: listener => { notification = listener; return { remove: () => { removed = true } } } },
    setInterval: (callback, delay) => { assert.equal(delay, 30000); timers.push(callback); return 1 },
    clearInterval: id => { assert.equal(id, 1); timers.length = 0 },
  }
  const cleanup = evaluate(effect, dependencies)()
  assert.deepEqual(calls, [{ availabilityOnly: true }])
  timers[0]()
  notification({ request: { content: { data: { app: 'coach', count: 999 } } } })
  assert.equal(calls.filter(call => call.availabilityOnly).length, 3)
  dependencies.appStateRef.current = 'background'
  timers[0]()
  assert.equal(calls.length, 5)
  cleanup()
  assert.equal(removed, true)
  assert.equal(timers.length, 0)
})

test('removed participation is excluded from pending while its response and delivery history remain intact', () => {
  const removed = normalizeCoachInvite({ id: 'removed', player_id: 'one', calendar_event_id: 'training', occurrence_date: '2099-01-01', status: 'sent', email_sent_at: '2026-01-01', token_revoked_at: '2026-01-02', token_revoked_reason: 'event_participation_removed' }, 'training')
  assert.equal(removed.status, 'awaiting')
  assert.equal(removed.sentAt, '2026-01-01')
  assert.equal(countPendingCoachAvailability([removed, invite('two')]), 1)
})

test('Parent section choices persist independently and restore after a fresh app instance', async () => {
  let storage = null
  const adapter = { read: async () => storage, write: async value => { storage = value } }
  const preference = createParentHomePreferences(adapter)
  assert.deepEqual(await preference.read(), { fixtures: true, calendar: true, recentMatches: true })
  await Promise.all([preference.toggle('fixtures'), preference.toggle('calendar'), preference.toggle('fixtures')])
  assert.deepEqual(await createParentHomePreferences(adapter).read(), { fixtures: true, calendar: false, recentMatches: true })
  assert.throws(() => preference.toggle('nextUp'), /Unknown Home section/)
  assert.deepEqual(await createParentHomePreferences({ ...adapter, read: async () => 'bad json' }).read(), { fixtures: true, calendar: true, recentMatches: true })
})

test('late preference read never overrides a newer choice and failed writes can recover', async () => {
  const slow = deferred()
  let fail = true
  const preference = createParentHomePreferences({ read: () => slow.promise, write: async () => { if (fail) throw new Error('Storage unavailable') } })
  const reading = preference.read()
  await assert.rejects(preference.toggle('calendar'), /Storage unavailable/)
  slow.resolve('{"fixtures":false}')
  assert.equal((await reading).calendar, false)
  fail = false
  await preference.toggle('recentMatches')
  assert.equal(preference.peek().recentMatches, false)
})
