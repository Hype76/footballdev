import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import vm from 'node:vm'
import test from 'node:test'
import { parse } from '@babel/parser'
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

function loadHarness({ saveError, loadError, cachedValue, offline = false } = {}) {
  const state = { data: null, error: '', notice: '', loading: true, stale: false, saves: 0, reads: 0 }
  const next = { invites: [{ playerId: 'synthetic-player', status: 'maybe' }] }
  const environment = {
    domain: 'invites', context: { id: 'team:test' }, user: { id: 'coach', isOfflineProfile: offline },
    LOADERS: { invites: async () => { state.reads += 1; if (loadError) throw loadError; return next } },
    TITLES: { invites: 'Invites' }, dataRef: { current: null }, offlinePolicy: { cache: true },
    peekMobileResource: () => undefined,
    readMobileResource: (_user, _key, loader) => loader(), withMobileAsyncTimeout: loader => loader(),
    readCoachOfflineResources: async () => ({ resources: { 'phase31e:invites': cachedValue } }),
    hasUsableCoachPhase31ECache: (_domain, value) => Boolean(value),
    saveCoachOfflineResources: async () => { state.saves += 1; if (saveError) throw saveError },
    getCoachFriendlyError: error => error.message,
    ...Object.fromEntries(['Data', 'Error', 'Notice', 'Loading', 'Stale'].map(name => [`set${name}`, value => { state[name.toLowerCase()] = value }])),
  }
  return { state, next, load: vm.runInNewContext(`(${screenSource.slice(callback.start, callback.end)})`, environment) }
}

test('a failed optional save never hides successfully loaded Coach invites', async () => {
  for (const message of ['Out of memory for regexp results.', 'offline_cache_payload_too_large', 'Device storage unavailable']) {
    const { state, next, load } = loadHarness({ saveError: new Error(message) })
    await load()
    assert.equal(state.data, next)
    assert.equal(state.error, '')
    assert.equal(state.loading, false)
    assert.equal(state.stale, false)
    assert.match(state.notice, /could not be saved/)
  }
})

test('successful saving is quiet; real network failures remain errors', async () => {
  const success = loadHarness()
  await success.load()
  assert.equal(success.state.saves, 1)
  assert.equal(success.state.error, '')
  assert.equal(success.state.notice, '')
  const failure = loadHarness({ loadError: new Error('Network request failed') })
  await failure.load()
  assert.equal(failure.state.error, 'Network request failed')
  assert.equal(failure.state.saves, 0)
})

test('offline and failed-network fallback keep cached data read-only', async () => {
  const cachedValue = { invites: [{ playerId: 'saved-player' }] }
  for (const options of [{ offline: true }, { loadError: new Error('Network request failed') }]) {
    const { state, load } = loadHarness({ ...options, cachedValue })
    await load()
    assert.equal(state.data, cachedValue)
    assert.equal(state.stale, true)
    assert.equal(state.error, '')
    assert.equal(state.saves, 0)
    if (options.offline) assert.equal(state.reads, 0)
  }
})
