import { readFileSync } from 'node:fs'
import test from 'node:test'
import assert from 'node:assert/strict'
import { runPrioritizedMobileLoads } from '../apps/mobile-core/src/mobileLoadCoordinator.js'
import { createParentChatRequestGate, discardDeniedParentCache, filterDeniedParentChatHistory, isParentAccessDenied, parentCalendarDependencies, resolveParentCalendarRefresh, resolveParentResourceFailure, shouldClearParentChatOnSettlement } from '../apps/parent-mobile/src/parentRefreshCore.js'

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

const appSource = readFileSync(new URL('../apps/parent-mobile/App.js', import.meta.url), 'utf8')
const loadSource = appSource.slice(
  appSource.indexOf('  const loadParentData = useCallback('),
  appSource.indexOf('  const parentSyncScopeRef'),
)
const resourceNames = [
  'calendar', 'chatHistory', 'chatRooms', 'development', 'invitations', 'matches',
  'messages', 'notifications', 'polls', 'resources',
]

function deferred() {
  let resolve
  const promise = new Promise((done) => { resolve = done })
  return { promise, resolve }
}

function loadFixture({ denyChat = false, isOffline = false, warm = false } = {}) {
  const cache = deferred()
  const details = deferred()
  const notifications = deferred()
  const link = { id: 'child', clubId: 'club', teamId: 'team', playerId: 'player' }
  const requestIdRef = { current: 0 }
  const createResourceState = () => Object.fromEntries(resourceNames.map(name => [name, { items: [], error: '', loading: true }]))
  const resourcesRef = { current: createResourceState() }
  const requests = []
  const read = (name, value = []) => () => { requests.push(name); return Promise.resolve(value) }
  const noop = () => {}
  const scorerOutboxesRevisionRef = { current: 0 }
  const syncSummaryRevisionRef = { current: 0 }
  const published = {}
  const deps = {
    useCallback: (callback) => callback, requestIdRef, isOffline, resourceNames, resourcesRef,
    selectedMobileUser: { id: 'parent' }, selectedLink: link, parentLinks: [link],
    hydratedScopeRef: { current: warm ? JSON.stringify(['parent', [['child', 'club', 'team', 'player']], ['child', 'club', 'team', 'player']]) : '' },
    mobileResourceKey: () => 'parent', createResourceState,
    setResources: (change) => { resourcesRef.current = typeof change === 'function' ? change(resourcesRef.current) : change },
    scorerOutboxesRevisionRef, syncSummaryRevisionRef,
    setScorerOutboxes: value => { published.scorer = value }, setSyncSummary: value => { published.sync = value },
    setLastUpdatedAt: noop, setOfflineCacheState: noop,
    deniedResourceScopesRef: { current: new Set() }, deniedChatScopesRef: { current: new Set() },
    chatRequestGateRef: { current: { invalidate: noop } }, setChatMessages: noop, parentChatScope: (...args) => args.at(-1),
    readParentOfflineView: () => { requests.push('cache'); return cache.promise },
    getParentCalendarEventResources: read('attachments'), buildCalendarResourcesByOccurrence: () => new Map(),
    getParentCalendarEventDetails: read('details', details.promise), normalizeText: String,
    getParentCalendarEvents: read('calendar'), getParentDevelopmentHistory: read('development'),
    getParentChatRooms: denyChat ? async () => { throw { status: 403 } } : read('chat', ['live chat']),
    getParentInvitations: read('invites'), getParentPortalMatchDays: read('matches'), getParentPortalMatchDayPlayers: read('players'),
    getParentMessages: read('messages', ['live message']), getParentNotificationInbox: read('notifications', notifications.promise),
    getParentPolls: read('polls'), getParentResources: read('resources'),
    parentCalendarDependencies, runPrioritizedMobileLoads, isParentAccessDenied, shouldClearParentChatOnSettlement,
    discardParentOfflineResources: async () => {}, filterDeniedParentChatHistory,
    prepareParentResourceItems: (_name, items) => items || [], resolveParentResourceFailure, resolveParentCalendarRefresh,
    buildParentCalendarEvents: ({ calendarEvents, matches, invitations }) => [...calendarEvents, ...matches, ...invitations],
    reconcileAttendance: noop, setMatchDayPlayers: noop, lastDataRefreshAtRef: {},
    getParentFriendlyError: (_reason, fallback) => fallback, resourceFallbacks: {},
    InteractionManager: { runAfterInteractions: (done) => done() }, commitParentRefresh: async () => ({ outboxes: {} }),
  }
  const load = new Function(...Object.keys(deps), loadSource + '\nreturn loadParentData')(...Object.values(deps))
  const resolveCache = () => cache.resolve({ scorerOutboxes: { match: 'saved' }, sync: { waiting: 0 }, cache: { resources: { messages: ['cached message'], chatRooms: ['cached room'], chatHistory: [{ roomId: 'restricted' }] } } })
  return { load, requests, details, notifications, resolveCache, resourcesRef, requestIdRef, scorerOutboxesRevisionRef, syncSummaryRevisionRef, published }
}

const tick = () => new Promise(resolve => setImmediate(resolve))

test('actual Parent refresh displays live messages and Chat while disk and calendar details wait', async () => {
  const f = loadFixture()
  const pending = f.load()
  await tick()
  assert.ok(f.requests.includes('chat'))
  assert.deepEqual(f.resourcesRef.current.messages.items, ['live message'])
  assert.deepEqual(f.resourcesRef.current.chatRooms.items, ['live chat'])
  assert.equal(f.resourcesRef.current.calendar.loading, true)
  f.resolveCache()
  await tick()
  assert.deepEqual(f.resourcesRef.current.messages.items, ['live message'])
  assert.deepEqual(f.resourcesRef.current.chatRooms.items, ['live chat'])
  assert.deepEqual(f.resourcesRef.current.chatHistory.items, [{ roomId: 'restricted' }])
  f.notifications.resolve([])
  f.details.resolve([])
  assert.equal((await pending).failed, 0)
})

test('actual Parent refresh cannot restore denied chat from late disk data', async () => {
  const f = loadFixture({ denyChat: true })
  const pending = f.load()
  await tick()
  f.resolveCache()
  await tick()
  assert.deepEqual(f.resourcesRef.current.chatHistory.items, [])
  assert.deepEqual(f.resourcesRef.current.chatRooms.items, [])
  assert.match(f.resourcesRef.current.chatRooms.error, /access/)
  f.notifications.resolve([])
  f.details.resolve([])
  assert.equal((await pending).failed, 1)
})

test('actual Parent refresh ignores late disk after scope changes', async () => {
  const f = loadFixture()
  const pending = f.load()
  await tick()
  f.requestIdRef.current++
  const current = f.resourcesRef.current
  f.resolveCache()
  f.notifications.resolve([])
  f.details.resolve([])
  assert.equal((await pending).stale, true)
  assert.equal(f.resourcesRef.current, current)
})

test('warm Parent refresh skips disk and offline refresh starts no network reads', async () => {
  const warm = loadFixture({ warm: true })
  const pending = warm.load()
  warm.notifications.resolve([])
  warm.details.resolve([])
  await pending
  assert.ok(!warm.requests.includes('cache'))
  const offline = loadFixture({ isOffline: true })
  const saved = offline.load()
  offline.resolveCache()
  assert.equal((await saved).cached, true)
  assert.deepEqual(offline.requests, ['cache'])
  assert.deepEqual(offline.resourcesRef.current.messages.items, ['cached message'])
})

test('late Parent cache cannot overwrite newer scorer or sync state', async () => {
  const f = loadFixture()
  const pending = f.load()
  await tick()
  f.scorerOutboxesRevisionRef.current++
  f.syncSummaryRevisionRef.current++
  f.resolveCache()
  await tick()
  assert.deepEqual(f.published, {})
  f.notifications.resolve([])
  f.details.resolve([])
  await pending
})
