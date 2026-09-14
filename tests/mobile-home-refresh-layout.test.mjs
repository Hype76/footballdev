import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'
import { parse } from '@babel/parser'
import { buildCoachChatSummary, countPendingCoachAvailability, preserveCoachAvailabilitySummary } from '../apps/mobile-core/src/coachPhase31GCore.js'
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
const invite = (id, extra = {}) => ({ id, kind: 'match', eventId: 'match', playerId: id, status: 'awaiting', sentAt: '2026-01-01', eventDate: '2099-01-01', ...extra })
function harness() {
  let state = { pendingAvailability: 107, unreadChat: 2, errors: ['polls:unavailable'] }
  const reads = []
  const dependencies = {
    selectedMobileUser: { id: 'coach', clubId: 'club', activeTeamId: 'team' },
    requestIdRef: { current: 1 }, chatRefreshIdRef: { current: 0 }, availabilityRefreshIdRef: { current: 0 },
    setHomeState: update => { state = typeof update === 'function' ? update(state) : update },
    readMobileResource: async (user, key, loader, options) => { reads.push({ user, key, options }); return loader() },
    getCoachInvitesAndAvailability: async () => ({ all: [invite('one'), invite('two', { status: 'available' })] }),
    getCoachChatRooms: async () => [], countPendingCoachAvailability, buildCoachChatSummary, preserveCoachAvailabilitySummary,
    setIsRefreshing() {}, peekMobileResource: () => undefined, readCoachOfflineResources: async () => null,
    activeContext: {}, user: { id: 'coach' }, getCoachPhase31GPrimaryHomeSnapshot: async () => ({ pendingAvailability: 0 }),
    setLastUpdatedAt() {}, lastHomeRefreshAtRef: { current: 0 }, saveCoachOfflineResources: async () => {},
    InteractionManager: { runAfterInteractions() {} },
    getCoachPhase31GAttentionSnapshot: async () => ({ pendingAvailability: 107, errors: [] }),
    mergeCoachPhase31GHomeSnapshots: (primary, attention) => ({ ...primary, ...attention }),
    getCoachFriendlyError: () => 'Unavailable',
  }
  return { dependencies, reads, state: () => state, load: () => evaluate(callback, dependencies) }
}

test('actual Coach targeted refresh replaces 107 with current responses without reloading other domains', async () => {
  const h = harness()
  await h.load()({ availabilityOnly: true })
  assert.equal(h.state().pendingAvailability, 1)
  assert.equal(h.state().unreadChat, 2)
  assert.deepEqual(h.state().errors, ['polls:unavailable'])
  assert.deepEqual(h.reads.map(read => [read.key, read.options.force]), [['coach:phase31e:invites', true]])
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
  const removed = normalizeCoachInvite({ id: 'removed', player_id: 'one', calendar_event_id: 'training', occurrence_date: '2099-01-01', status: 'sent', email_sent_at: '2026-01-01', token_revoked_reason: 'event_participation_removed' }, 'training')
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
