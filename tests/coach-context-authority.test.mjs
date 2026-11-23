import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'
import { withMobileAsyncTimeout } from '../apps/mobile-core/src/http.js'
import { createCoachContextAuthority, watchCoachConnection } from '../apps/coach-mobile/src/coachContextAuthorityCore.js'
import { createMobileResourceCache, mobileResourceCache, readMobileResource } from '../apps/mobile-core/src/mobileResourceCache.js'

const user = { id: 'simon', clubId: 'cached-club' }
const context = { id: 'team:jpl', clubId: 'jpl', teamId: 'jpl-team' }
const deferred = () => { let resolve; const promise = new Promise(done => { resolve = done }); return { promise, resolve } }

test('restored, cached same-club selections and foreground returns always reactivate server authority before reads', async () => {
 let serverClub = 'other-device-club'
 const calls = []
 let release
 const authority = createCoachContextAuthority(async club => { calls.push(club); await release.promise; serverClub = club; return {} })
 const scoped = { ...user, clubId: context.clubId, waitForCoachAuthority: () => authority.waitForRead(user.id, context.id) }
 for (const source of ['startup', 'same-club selection', 'resume']) {
  serverClub = 'other-device-club'
  release = deferred()
  const activation = authority.synchronize({ user: scoped, context })
  let readStarted = false
  const read = readMobileResource(scoped, 'coach:players:' + source, () => { readStarted = true; assert.equal(serverClub, context.clubId); return ['player'] }, { force: true })
  await Promise.resolve(); await Promise.resolve()
  assert.equal(readStarted, false)
  release.resolve()
  await activation
  assert.deepEqual(await read, ['player'])
 }
 assert.deepEqual(calls, ['jpl', 'jpl', 'jpl'])
})

test('a newer selection serializes activation and rejects older account/context completions', async () => {
 const first = deferred()
 const started = deferred()
 const calls = []
 const authority = createCoachContextAuthority(async club => { calls.push(club); if (club === 'jpl') { started.resolve(); await first.promise }; return {} })
 const old = authority.synchronize({ user, context })
 await started.promise
 const other = { id: 'team:other', clubId: 'other' }
 const next = authority.synchronize({ user, context: other })
 const rejected = assert.rejects(old, { code: 'coach_context_changed' })
 first.resolve(); await rejected; await next
 assert.deepEqual(calls, ['jpl', 'other'])
 await assert.rejects(authority.waitForRead(user.id, context.id), { code: 'coach_context_changed' })
 let current = true
 const pending = deferred()
 const accountAuthority = createCoachContextAuthority(async () => { await pending.promise; return {} })
 const oldAccount = accountAuthority.synchronize({ user, context, isCurrent: () => current })
 await Promise.resolve(); current = false; pending.resolve()
 await assert.rejects(oldAccount, { code: 'coach_context_changed' })
})

test('only connection errors allow offline cache mode and cannot run network loaders', async () => {
 for (const error of [new TypeError('Network request failed'), new Error('Failed to fetch')]) {
  const authority = createCoachContextAuthority(async () => { throw error })
  assert.equal((await authority.synchronize({ user, context })).offline, true)
  await assert.rejects(authority.waitForRead(user.id, context.id), /offline/)
 }
 for (const error of [Object.assign(new Error('permission denied'), { code: '42501' }), Object.assign(new Error('connection denied'), { status: 403 }), new Error('unexpected response')]) {
  const authority = createCoachContextAuthority(async () => ({ error }))
  await assert.rejects(authority.synchronize({ user, context }), error)
 }
 let calls = 0
 const authority = createCoachContextAuthority(async () => { calls++; return {} })
 assert.equal((await authority.synchronize({ user: { ...user, isOfflineProfile: true }, context })).offline, true)
 assert.equal(calls, 0)
})

test('resume uses the real App callback without changing the mounted draft gate', async () => {
 const source = readFileSync('apps/coach-mobile/App.js', 'utf8')
 const start = source.indexOf('async (context, { preserveView = false } = {}) => {')
 const end = source.indexOf('}, [contextAuthority, user])', start)
 assert.ok(start >= 0 && end > start)
 const pending = deferred()
 const readyChanges = []
 const dependencies = { authorityRequestRef: { current: 0 }, user, authorityUserIdRef: { current: user.id }, contextAuthorityReadyRef: { current: true }, setContextReady: value => readyChanges.push(value), requestIdRef: { current: 0 }, contextAuthority: { synchronize: () => pending.promise }, setContextAuthorityOffline() {}, setIsRefreshing() {}, allowVerifiedCoachWorkspace: async () => {} }
 const synchronize = new Function(...Object.keys(dependencies), 'return (' + source.slice(start, end + 1) + ')')(...Object.values(dependencies))
 const resume = synchronize(context, { preserveView: true })
 assert.deepEqual(readyChanges, [])
 pending.resolve({ offline: false }); await resume
 assert.deepEqual(readyChanges, [])
 assert.match(source, /synchronizeContextAuthority\(activeContext, \{ preserveView: true \}\)/)
 // Startup and explicit selection still hold the existing loading boundary.
 await synchronize(context)
 assert.deepEqual(readyChanges, [false])
})

test('ordinary cache and Parent resources keep their existing loader behavior', async () => {
 const cache = createMobileResourceCache()
 let reads = 0
 assert.equal(await cache.read('key', () => ++reads), 1)
 assert.equal(await cache.read('key', () => ++reads), 1)
 assert.equal(await readMobileResource({ id: 'parent', waitForCoachAuthority: () => { throw new Error('must not gate parent') } }, 'parent:links', () => 'links'), 'links')
 mobileResourceCache.clear()
})


test('a response started before reactivation cannot publish into the current Coach cache', async () => {
 const authority = createCoachContextAuthority(async () => ({}))
 const scoped = { ...user, waitForCoachAuthority: () => authority.waitForRead(user.id, context.id), getCoachAuthorityGeneration: () => authority.getGeneration() }
 await authority.synchronize({ user, context })
 const pending = deferred(), started = deferred()
 const old = readMobileResource(scoped, 'coach:delayed-players', async () => { started.resolve(); return pending.promise }, { force: true })
 await started.promise
 await authority.synchronize({ user, context })
 const next = readMobileResource(scoped, 'coach:delayed-players', () => ['current'], { force: true })
 pending.resolve(['old'])
 await assert.rejects(old, /workspace changed/)
 assert.deepEqual(await next, ['current'])
})

for (const name of ['useCoachDevelopmentSync', 'useCoachMatchDayBackgroundSync']) test(name + ' actual resume runner waits for activation before direct domain work', async () => {
 const source = readFileSync('apps/coach-mobile/src/' + name + '.js', 'utf8').replace(/^import .+\r?\n/gm, '').replace(/^export /gm, '')
 const activation = deferred(), completed = deferred()
 let reads = 0, cleanup
 const scoped = { ...user, waitForCoachAuthority: () => activation.promise }
 const dependencies = {
  useEffect: callback => { cleanup = callback() }, AppState: { currentState: 'active', addEventListener: () => ({ remove() {} }) },
  setInterval: () => 1, clearInterval() {},
  subscribeDevelopmentSync: () => () => {}, syncCoachDevelopmentDrafts: async () => { reads++; completed.resolve() },
  getPendingCoachMatchDays: async () => { reads++; completed.resolve(); return [] },
 }
 const hook = new Function(...Object.keys(dependencies), source + '; return ' + name)(...Object.values(dependencies))
 hook({ user: scoped, contexts: [context], enabled: true })
 await Promise.resolve(); assert.equal(reads, 0)
 activation.resolve(); await completed.promise
 assert.equal(reads, 1); cleanup()
})


test('actual offline preparation waits for activation and fences an older preparation generation', async () => {
 const { createCoachAccountPreparationCoordinator, coachPreparationScopeKey } = await import('../apps/coach-mobile/src/coachAccountPreparationCoordinator.js')
 const { prepareCoachAccountOffline } = await import('../apps/coach-mobile/src/coachAccountOfflinePreparation.js')
 const source = readFileSync('apps/coach-mobile/src/useCoachOfflinePreparation.js', 'utf8')
 const start = source.indexOf('async runnerIsCurrent => {'), end = source.indexOf('\n      },', start)
 assert.ok(start>=0 && end>start,'The actual account preparation runner is present')
 const service = readFileSync('apps/coach-mobile/src/coachAccountOfflineService.js', 'utf8')
 const serviceStart = service.indexOf('export async function prepareCoachAccount('), serviceEnd = service.indexOf('async function savedResource(', serviceStart)
 const activation = deferred(), started = deferred(), work = deferred()
 let generation = 1, writes = 0, preparations = 0
 const caches = new Map()
 const linkedContexts=[context,{...context,id:'linked-team',clubId:'linked-club',teamId:'linked-team'}]
 const scopedUser = { ...user, clubId: context.clubId, waitForCoachAuthority: () => activation.promise, getCoachAuthorityGeneration: () => generation }
 const serviceDependencies = {
  withMobileAsyncTimeout, preparationCoordinator: createCoachAccountPreparationCoordinator(), coachPreparationScopeKey,
  captureCoachOfflineAccount: () => () => {}, getMedia: () => ({}), startup: Promise.resolve(),
  prepareCoachAccountOffline: options => { preparations++; assert.equal(options.user,scopedUser); assert.equal(options.user.clubId,context.clubId,'Server-selected club remains unchanged'); assert.deepEqual(options.contexts,linkedContexts,'Every own linked context reaches the account preparer'); assert.equal(options.selectedContextId,context.id); return prepareCoachAccountOffline(options) },
  createCoachOfflineResourceSaver: (_profile,team) => async resources => { writes++; const cache=caches.get(team.id)||{resourceMetadata:{}}; for(const key of Object.keys(resources)) cache.resourceMetadata[key]={fingerprint:key}; caches.set(team.id,cache); return cache },
  readCoachAccountPreparation: async (_id, teams, options) => { assert.deepEqual(teams, linkedContexts); assert.equal(options?.verifyMedia ?? true, true); return {} },
  saveCoachAccountPreparation: async () => {}, readCoachOfflineResources: async (_id,team) => caches.get(team.id), saveCoachPreparedMatchDays: async () => {},
  applyCoachContext: profile => profile, getScopedTeamBranding: () => null,
  loadCoachOfflineContext: async (_profile,_context,options) => { started.resolve(); await work.promise; await options.onResource({cacheKey:'home',value:{},complete:true}); return {complete:true} },
 }
 const prepare = new Function(...Object.keys(serviceDependencies), service.slice(serviceStart,serviceEnd).replace('export ','')+'; return prepareCoachAccount')(...Object.values(serviceDependencies))
 const dependencies = { latest:{current:{user:scopedUser,contexts:linkedContexts}}, InteractionManager:{runAfterInteractions:resolve=>resolve()}, selectedId:{current:context.id}, busy:{current:false}, lastInteraction:{current:0}, prepareCoachAccount:prepare }
 const run = new Function(...Object.keys(dependencies), 'return (' + source.slice(start, end + 8) + ')')(...Object.values(dependencies))
 const pending = run(() => true)
 await Promise.resolve(); assert.equal(writes, 0); assert.equal(preparations,0)
 activation.resolve(); await started.promise
 generation++; work.resolve(); await pending
 assert.equal(writes, 0)
 assert.equal(scopedUser.clubId,context.clubId)
 await run(()=>true)
 assert.equal(preparations,2)
 assert.equal(writes,4,'The current generation saves the home and media inventory for each linked team')
 assert.deepEqual([...caches.keys()].sort(),linkedContexts.map(team=>team.id).sort())
})


test('Coach connection checks detect network loss and recovery without changing screens', async () => {
 const statuses = []
 let tick, active = true, probes = 0, cancelled = false, failure
 const stop = watchCoachConnection({
  probe: async () => { probes += 1; return {error:failure} },
  isActive: () => active,
  onOffline: value => statuses.push(value),
  schedule: (run, interval) => { assert.equal(interval, 15000); tick = run; return 42 },
  cancel: timer => { assert.equal(timer, 42); cancelled = true },
 })
 await tick()
 failure = new TypeError('Network request failed')
 await tick()
 assert.deepEqual(statuses, [], 'A single slow probe keeps the previous status')
 await tick()
 active = false
 await tick()
 assert.equal(probes, 3)
 active = true
 failure = Object.assign(new Error('Permission denied'), {status:403})
 await tick()
 assert.deepEqual(statuses, [true], 'A single responding probe keeps the offline status')
 failure = undefined
 await tick()
 assert.deepEqual(statuses, [true, false])
 stop()
 await tick()
 assert.equal(cancelled, true)
 assert.equal(probes, 5)
})

test('same workspace retains verified display cache, shares Home refresh and invalidates on denial', async () => {
 const authority = createCoachContextAuthority(async () => ({}))
 const scoped = { ...user, waitForCoachAuthority: () => authority.waitForRead(user.id, context.id), getCoachAuthorityGeneration: () => authority.getGeneration() }
 await authority.synchronize({ user, context })
 assert.deepEqual(await readMobileResource(scoped, 'coach:players', () => ['saved']), ['saved'])
 await authority.synchronize({ user, context })
 assert.deepEqual(await readMobileResource(scoped, 'coach:players', () => assert.fail('Revalidated display should keep a fresh value')), ['saved'])
 const request = deferred()
 const normal = readMobileResource(scoped, 'coach:home-primary', () => request.promise)
 const forced = readMobileResource(scoped, 'coach:home-primary', () => assert.fail('Home should share its current request'), { force: true })
 request.resolve(['home'])
 assert.deepEqual(await Promise.all([normal, forced]), [['home'], ['home']])
 await assert.rejects(readMobileResource(scoped, 'coach:players', () => { throw Object.assign(new Error('Denied'), { status: 403 }) }, { force: true }), /Denied/)
 assert.deepEqual(await readMobileResource(scoped, 'coach:players', () => ['approved again']), ['approved again'])
 mobileResourceCache.clear()
})

test('workspace denial survives restart and clears only after current live verification', async () => {
 const source = readFileSync('apps/coach-mobile/src/offline.js', 'utf8')
 const body = source.slice(source.indexOf('const deniedCoachWorkspaces'), source.indexOf("for (const method of ['clear'")).replaceAll('export async function', 'async function').replaceAll('export function', 'function')
 const primary = new Map(), secure = new Map()
 const make = () => new Function('config', 'projectRef', 'AsyncStorage', 'SecureStore', 'queueStartupRevocationChange',
   body + '; return { isCoachWorkspaceDenied, markCoachWorkspaceDenied, allowVerifiedCoachWorkspace };')(
   { isProduction: true }, 'project', { getItem: async key => primary.get(key), setItem: async (key, value) => primary.set(key, value), removeItem: async key => primary.delete(key) },
   { getItemAsync: async key => secure.get(key), setItemAsync: async (key, value) => secure.set(key, value), deleteItemAsync: async key => secure.delete(key) }, async change => change())
 const first = make()
 await first.markCoachWorkspaceDenied('coach', 'club-a')
 const restarted = make()
 assert.equal(await restarted.isCoachWorkspaceDenied('coach', 'club-a'), true)
 assert.equal(await restarted.isCoachWorkspaceDenied('coach', 'club-b'), false)
 assert.equal(await restarted.isCoachWorkspaceDenied('other', 'club-a'), false)
 await restarted.allowVerifiedCoachWorkspace('coach', 'club-a', () => false)
 assert.equal(await make().isCoachWorkspaceDenied('coach', 'club-a'), true)
 await restarted.allowVerifiedCoachWorkspace('coach', 'club-a', () => true)
 assert.equal(await make().isCoachWorkspaceDenied('coach', 'club-a'), false)
})

test('saved startup renders a preview only and defers external links until workspace verification', () => {
 const source = readFileSync('apps/coach-mobile/App.js', 'utf8')
 const preview = source.slice(source.indexOf('  if (startupAuthorityPending) {'), source.indexOf('    <MobileActivityProvider key='))
 assert.match(preview, /Checking access to your saved workspace/)
 assert.doesNotMatch(preview, /<CoachRoute|<CoachNavigation|<CoachQuickActions/)
 assert.match(source, /if \(!pendingCoachLink \|\| !contextReady \|\| startupAuthorityPending \|\| !contextAuthorityReadyRef.current\) return/)
 assert.match(source, /setReadyAuthorityGeneration\(generation => generation \+ 1\)/)
})

test('a denial during compact snapshot storage read discards the result', async () => {
 const source = readFileSync('apps/coach-mobile/src/offline.js', 'utf8')
 const body = source.slice(source.indexOf('export async function readCoachStartupHome'), source.indexOf('export async function saveCoachStartupHome')).replace('export ', '')
 const pending = deferred(), entered = deferred()
 let denied = false
 const read = new Function('captureCoachOfflineAccount', 'revokedStartupProfiles', 'readStartupRevocation', 'isCoachWorkspaceDenied', 'startupHomeStore', 'peekCoachWorkspaceDenied', 'startupHomeAuthority', body + '; return readCoachStartupHome')(
   () => () => {}, new Set(), async () => false, async () => denied, { read: () => { entered.resolve(); return pending.promise } }, () => denied, () => 'authority')
 const result = read(user.id, context)
 await entered.promise
 denied = true
 pending.resolve({ document: { startupHome: { contextId: context.id, authority: 'authority', home: { nextMatch: 'private' } } } })
 assert.equal(await result, null)
})
