import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import vm from 'node:vm'
import test from 'node:test'
import { parse } from '@babel/parser'
import { restoreCoachAvailabilitySnapshot } from '../apps/mobile-core/src/coachAvailabilityCache.js'
import { getCoachCacheByteLength, COACH_PHASE_31F_MAX_CACHE_BYTES } from '../apps/mobile-core/src/coachPhase31FCore.js'
import { createCoachOfflineDocument, setCoachOfflineProfile, setCoachOfflineResources } from '../apps/mobile-core/src/coachOfflineCore.js'

test('byte counting does not depend on allocating regexp replacement results', async () => {
  const source = await readFile(new URL('../apps/mobile-core/src/coachPhase31FCore.js', import.meta.url), 'utf8')
  const ast = parse(source, { sourceType: 'module' })
  const fn = ast.program.body.find(node => node.declaration?.id?.name === 'getCoachCacheByteLength').declaration
  const count = vm.runInNewContext(`
    RegExp.prototype[Symbol.replace] = function () { throw new RangeError('Out of memory for regexp results.') };
    (${source.slice(fn.start, fn.end)})
  `)
  const value = { notes: 'a'.repeat(1_400_000) }
  assert.equal(count(value), Buffer.byteLength(JSON.stringify(value)))
})

test('Coach cache byte count matches UTF-8 for JSON, Unicode and large documents', () => {
  for (const value of [null, undefined, false, 42, '', '\u0000\n"\\', 'Caf\u00e9 \u6f22\u5b57 \ud83c\udfc6', '\ud800x\udc00', { players: Array.from({ length: 300 }, (_, id) => ({ id, notes: '\u00e9\ud83c\udfc6'.repeat(600) })) }]) {
    assert.equal(getCoachCacheByteLength(value), Buffer.byteLength(JSON.stringify(value ?? null), 'utf8'))
  }
  const value = 'a'.repeat(COACH_PHASE_31F_MAX_CACHE_BYTES - 2)
  assert.equal(getCoachCacheByteLength(value), COACH_PHASE_31F_MAX_CACHE_BYTES)
  assert.equal(getCoachCacheByteLength(value + 'a'), COACH_PHASE_31F_MAX_CACHE_BYTES + 1)
})

test('large cached data still obeys its size limit without losing existing document', () => {
  const context = { id: 'team:test', teamId: 'test', clubId: 'club', role: 'coach' }
  let document = createCoachOfflineDocument({ userScope: 'coach' })
  document = setCoachOfflineProfile(document, { id: 'coach', coachContexts: [context] })
  document = setCoachOfflineResources(document, context, { players: [{ id: 'player', notes: 'a'.repeat(900_000) }] })
  const original = JSON.stringify(document)
  assert.throws(() => setCoachOfflineProfile(document, { id: 'coach', coachContexts: [context], notes: 'a'.repeat(COACH_PHASE_31F_MAX_CACHE_BYTES) }), /offline_cache_payload_too_large/)
  assert.equal(JSON.stringify(document), original)
})

// Execute the actual screen loading callback, including its error boundaries.
const screenSource = await readFile(new URL('../apps/coach-mobile/src/CoachPhase31EScreens.js', import.meta.url), 'utf8')
const ast = parse(screenSource, { sourceType: 'module', plugins: ['jsx'] })
const screen = ast.program.body.find(node => node.type === 'ExportNamedDeclaration' && node.declaration?.id?.name === 'CoachPhase31EScreen').declaration
const callback = screen.body.body.find(node => node.type === 'VariableDeclaration' && node.declarations[0].id.name === 'load').declarations[0].init.arguments[0]

function loadHarness({ saveError, savePending, loadError, cachedValue, cachePending, memoryValue, memoryFresh = false, domain = 'invites', offline = false, matchSnapshot, availabilitySnapshot, initialData = null } = {}) {
  const state = { data: initialData, error: '', notice: '', loading: true, refreshing: false, stale: false, invitesRefreshing: false, saves: 0, reads: 0, timeoutMs: null, scopeCurrent: true }
  const next = { invites: [{ playerId: 'synthetic-player', status: 'maybe' }] }
  const environment = {
    restoreCoachAvailabilitySnapshot, captureLoadScope: () => () => state.scopeCurrent, attendanceLoadGeneration: { current: 0 },
    domain, dataScope: domain, deniedScopeRef: { current: '' }, context: { id: 'team:test' }, user: { id: 'coach', isOfflineProfile: offline },
    LOADERS: { [domain]: async (_user, options) => { state.reads += 1; state.publishMatch = options?.onMatchReady; if (matchSnapshot) options?.onMatchReady?.(matchSnapshot); if (availabilitySnapshot) options?.onAvailabilityReady?.(availabilitySnapshot); if (loadError) throw loadError; return next } },
    TITLES: { [domain]: domain }, dataRef: { get current() { return state.data } }, offlinePolicy: { cache: true },
    peekMobileResource: (_user, _key, options) => options?.allowStale || memoryFresh ? memoryValue : undefined,
    invalidateMobileResource() {}, sanitizeCoachChatOfflineValue: value => value,
    readMobileResource: (_user, _key, loader) => loader(), withMobileAsyncTimeout: (loader, options) => { state.timeoutMs = options?.timeoutMs; return loader() },
    readCoachOfflineResources: async () => { if (cachePending) await cachePending; return { resources: { [`phase31e:${domain}`]: cachedValue } } },
    hasUsableCoachPhase31ECache: (_domain, value) => Boolean(value),
    saveCoachOfflineResources: async () => { state.saves += 1; if (savePending) await savePending; if (saveError) throw saveError },
    getCoachFriendlyError: error => error.message,
    ...Object.fromEntries(['Data', 'Error', 'Notice', 'Loading', 'Refreshing', 'Stale', 'InvitesRefreshing'].map(name => [`set${name}`, value => { state[name.charAt(0).toLowerCase() + name.slice(1)] = typeof value === 'function' ? value(state[name.charAt(0).toLowerCase() + name.slice(1)]) : value }])),
  }
  return { state, next, environment, load: vm.runInNewContext(`(${screenSource.slice(callback.start, callback.end)})`, environment) }
}

test('a failed optional save never hides successfully loaded Coach invites', async () => {
  for (const message of ['Out of memory for regexp results.', 'offline_cache_payload_too_large', 'Device storage unavailable']) {
    const { state, next, load } = loadHarness({ saveError: new Error(message) })
    await load()
    assert.equal(state.data, next)
    assert.equal(state.error, '')
    assert.equal(state.loading, false)
    assert.equal(state.refreshing, false)
    assert.equal(state.stale, false)
    assert.equal(state.invitesRefreshing, false)
    assert.equal(state.timeoutMs, 30000)
    assert.equal(state.reads, 1)
    assert.match(state.notice, /could not be saved/)
  }
})

test('successful saving is quiet; real network failures remain errors', async () => {
  const success = loadHarness()
  await success.load()
  assert.equal(success.state.saves, 1)
  assert.equal(success.state.error, '')
  assert.equal(success.state.notice, '')
  assert.equal(success.state.refreshing, false)
  const failure = loadHarness({ loadError: new Error('Network request failed') })
  await failure.load()
  assert.equal(failure.state.error, 'Network request failed')
  assert.equal(failure.state.saves, 0)
  assert.equal(failure.state.refreshing, false)
})

test('offline and failed-network fallback keep cached data read-only', async () => {
  const cachedValue = { invites: [{ playerId: 'saved-player' }] }
  for (const options of [{ offline: true }, { loadError: new Error('Network request failed') }]) {
    const { state, load } = loadHarness({ ...options, cachedValue })
    await load()
    assert.deepEqual(state.data, { ...cachedValue, availabilityCacheVersion: 0 })
    assert.equal(state.stale, true)
    assert.equal(state.error, '')
    assert.equal(state.saves, 0)
    assert.equal(state.invitesRefreshing, false)
    assert.equal(state.refreshing, false)
    if (options.offline) assert.equal(state.reads, 0)
  }
})

test('actual Coach loader cannot publish late response or cache error into switched attendance scope', async () => {
 const harness = loadHarness({ saveError: new Error('Synthetic late cache failure') })
 // Invalidate the captured scope while its first asynchronous cache read yields.
 const loading = harness.load();harness.state.scopeCurrent = false;await loading
 assert.equal(harness.state.data, null);assert.equal(harness.state.error, '');assert.equal(harness.state.notice, '');assert.equal(harness.state.saves, 0)
})

test('a pending optional cache write cannot block confirmed data or affect a later scope', { timeout: 1000 }, async () => {
  let rejectSave
  const savePending = new Promise((_resolve, reject) => { rejectSave = reject })
  const harness = loadHarness({ savePending })
  await harness.load()
  assert.equal(harness.state.data, harness.next)
  assert.equal(harness.state.loading, false)
  assert.equal(harness.state.refreshing, false)
  assert.equal(harness.state.saves, 1)
  harness.state.scopeCurrent = false
  rejectSave(new Error('Synthetic delayed cache failure'))
  await Promise.resolve()
  await Promise.resolve()
  assert.equal(harness.state.notice, '')
  assert.equal(harness.state.error, '')
})


test('fresh match totals replace the saved list even when remaining invite sources fail', async () => {
  const training = [{ id: 'saved-training' }]
  const initialData = { match: [{ status: 'available', id: 'old' }], matches: [{ id: 'fixture' }], training }
  const snapshot = { matches: [{ id: 'fixture' }], match: Array.from({ length: 13 }, (_, id) => ({ id, status: 'available' })) }
  const { state, load } = loadHarness({ initialData, matchSnapshot: snapshot, loadError: new Error('Training lookup timed out') })
  await load()
  assert.equal(state.data.match, snapshot.match)
  assert.equal(state.data.matches, snapshot.matches)
  assert.equal(state.data.training, training)
  assert.equal(state.loading, false)
  assert.equal(state.stale, true)
  assert.equal(state.error, '')
  assert.equal(state.saves, 0, 'An incomplete domain must not overwrite the full offline copy')
})


test('a late match callback after a failed load cannot replace the visible list', async () => {
  const initialData = { match: [{ id: 'kept' }] }
  const { state, load } = loadHarness({ initialData, loadError: new Error('Timed out') })
  await load()
  state.publishMatch({ match: [{ id: 'late' }] })
  assert.equal(state.data, initialData)
})

test('slow encrypted storage does not block online retrieval or replace the fresh result later', { timeout: 1000 }, async () => {
  let finishCache
  const cachePending = new Promise(resolve => { finishCache = resolve })
  const { state, next, load } = loadHarness({ cachePending, cachedValue: { match: [{ id: 'old' }] } })
  await load({ reuseFresh: true })
  assert.equal(state.reads, 1)
  assert.equal(state.data, next)
  finishCache()
  await new Promise(resolve => setImmediate(resolve))
  assert.equal(state.data, next)
  assert.equal(state.stale, false)
})

test('memory availability stays visible and read-only if revalidation fails', async () => {
  const memoryValue = { match: [{ id: 'saved' }] }
  const { state, load } = loadHarness({ memoryValue, loadError: new Error('Offline') })
  const pending = load({ reuseFresh: true })
  assert.equal(state.data, memoryValue)
  assert.equal(state.loading, false)
  await pending
  assert.equal(state.data, memoryValue)
  assert.equal(state.stale, true)
  assert.equal(state.error, '')
})

test('late saved Training merges with a fast current Match without replacing its response', async () => {
  let finishCache
  const cachePending = new Promise(resolve => { finishCache = resolve })
  const saved = { match: [{ id: 'old-match' }], training: [{ id: 'saved-training' }], players: [{ id: 'saved-player' }] }
  const snapshot = { match: [{ id: 'current-match' }], matches: [{ id: 'fixture' }] }
  const { state, load } = loadHarness({ cachePending, cachedValue: saved, matchSnapshot: snapshot, loadError: new Error('Training timed out') })
  await load()
  assert.equal(state.data.match, snapshot.match)
  finishCache()
  await new Promise(resolve => setImmediate(resolve))
  assert.equal(state.data.match, snapshot.match)
  assert.equal(state.data.training, saved.training)
  assert.equal(state.error, '')
  assert.equal(state.stale, true)
})

test('availability background polling defers to the open fixture and stops while the app is inactive', () => {
  const effect = screen.body.body.find(node => node.type === 'ExpressionStatement'
    && node.expression.callee?.name === 'useEffect'
    && screenSource.slice(node.start, node.end).includes('const refreshInvites'))
    .expression.arguments[0]
  let tick, foreground, removed = false, cleared = false, calls = 0
  const focusedAvailabilityRef = { current: false }
  const AppState = { currentState: 'active', addEventListener(_name, callback) { foreground = callback; return { remove() { removed = true } } } }
  const cleanup = vm.runInNewContext(`(${screenSource.slice(effect.start, effect.end)})`, {
    domain: 'invites', focusedAvailabilityRef, AppState,
    load: () => { calls++; return Promise.resolve() },
    setInterval: callback => { tick = callback; return 1 }, clearInterval: () => { cleared = true },
  })()
  tick(); assert.equal(calls, 1)
  focusedAvailabilityRef.current = true
  tick(); foreground('active'); assert.equal(calls, 1)
  focusedAvailabilityRef.current = false
  AppState.currentState = 'background'
  tick(); assert.equal(calls, 1)
  AppState.currentState = 'active'
  foreground('active'); assert.equal(calls, 2)
  cleanup(); assert.equal(removed && cleared, true)
})

for (const domain of ['development', 'resources', 'chat', 'messages', 'polls']) {
  test(`${domain} keeps expired same-scope content during a failed refresh`, async () => {
    const memoryValue = { items: [{ id: 'saved' }] }
    const h = loadHarness({ domain, memoryValue, loadError: new Error('Offline') })
    const loading = h.load({ reuseFresh: true })
    assert.equal(h.state.data, memoryValue)
    assert.equal(h.state.loading, false)
    await loading
    assert.equal(h.state.reads, 1, 'Expired content is displayed but still revalidated')
    assert.equal(h.state.data, memoryValue)
    assert.equal(h.state.error, '')
    assert.equal(h.state.stale, true)
    assert.ok(h.state.notice)
  })
  test(`${domain} starts its online read while encrypted storage is blocked`, { timeout: 1000 }, async () => {
    let release
    const cachePending = new Promise(resolve => { release = resolve })
    const h = loadHarness({ domain, cachePending, cachedValue: { id: 'old' } })
    await h.load()
    assert.equal(h.state.data, h.next)
    release()
    await new Promise(resolve => setImmediate(resolve))
    assert.equal(h.state.data, h.next)
    assert.equal(h.state.stale, false)
  })
}

test('a confirmed access denial clears retained content and fences cached data on retry', async () => {
  const h = loadHarness({ domain: 'resources', memoryValue: { items: ['private'] }, cachedValue: { items: ['private'] },
    loadError: Object.assign(new Error('Permission denied'), { code: '42501' }) })
  await h.load({ reuseFresh: true })
  assert.equal(h.state.data, null)
  assert.equal(h.environment.deniedScopeRef.current, 'resources')
  assert.equal(h.state.error, 'Permission denied')
  const retry = h.load({ reuseFresh: true })
  assert.equal(h.state.data, null)
  await retry
  assert.equal(h.state.data, null)
})

test('a newer Coach room refresh cannot be replaced by an older room-open request', async () => {
  const chat = ast.program.body.find(node => node.type === 'FunctionDeclaration' && node.id.name === 'ChatDomain')
  const open = chat.body.body.find(node => node.type === 'VariableDeclaration' && node.declarations[0].id.name === 'open').declarations[0].init.arguments[0]
  const effect = chat.body.body.find(node => node.type === 'ExpressionStatement' && node.expression.callee?.name === 'useEffect'
    && screenSource.slice(node.start, node.end).includes('const refreshOpenRoom')).expression.arguments[0]
  const refresh = effect.body.body.find(node => node.type === 'VariableDeclaration' && node.declarations[0].id.name === 'refreshOpenRoom').declarations[0].init
  let finishOpen, messages = [], notice = ''
  const room = { id: 'room', kind: 'staff' }, old = [{ id: 'old' }], next = [{ id: 'new' }]
  const env = { user: { id: 'coach' }, room, disposed: false, openRequest: { current: 0 }, activeRoomIdRef: { current: '' },
    roomRefreshRef: { current: false }, messagesRef: { current: messages }, AppState: { currentState: 'active' },
    setMessages(value) { messages = value; env.messagesRef.current = value }, setBody() {}, setRoomId() {},
    setNotice(value) { notice = typeof value === 'function' ? value(notice) : value },
    peekMobileResource: () => old, readMobileResource: () => new Promise(resolve => { finishOpen = resolve }),
    getCoachChatMessages: async () => next, getMobileChatMessagesFingerprint: JSON.stringify,
    markCoachChatRead: async () => {}, load: async () => {}, reloadHome: async () => {}, denyRoom() {}, getCoachFriendlyError: error => error.message,
  }
  const openRoom = vm.runInNewContext(`(${screenSource.slice(open.start, open.end)})`, env)
  const refreshRoom = vm.runInNewContext(`(${screenSource.slice(refresh.start, refresh.end)})`, env)
  const opening = openRoom(room)
  await refreshRoom()
  assert.equal(messages, next)
  assert.equal(notice, '')
  finishOpen(old)
  await opening
  assert.equal(messages, next)
})

test('complete availability is saved before optional enrichment fails', async () => {
  const availabilitySnapshot = { matches: [{ id: 'fixture' }], match: [{ id: 'response', eventId: 'fixture', playerId: 'player', status: 'available' }], training: [], calendar: [] }
  const h = loadHarness({ availabilitySnapshot, loadError: new Error('Optional preparation timed out') })
  const saved = []
  h.environment.saveCoachOfflineResources = async (_user, _context, resources) => { saved.push(resources) }
  await h.load()
  assert.equal(saved.length, 1)
  assert.equal(saved[0]['phase31e:invites'].availabilityCacheVersion, 1)
  assert.equal(saved[0]['phase31e:invites'].match, availabilitySnapshot.match)
  assert.equal(h.state.data.match, availabilitySnapshot.match)
  assert.equal(h.state.error, '')
})
