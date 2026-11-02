import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'
import vm from 'node:vm'
import { parse } from '@babel/parser'
import { restoreCoachAvailabilitySnapshot } from '../apps/mobile-core/src/coachAvailabilityCache.js'
import * as cache from '../apps/mobile-core/src/coachOfflineCore.js'

const screenSource = await readFile(new URL('../apps/coach-mobile/src/CoachPhase31EScreens.js', import.meta.url), 'utf8')
const offlineSource = await readFile(new URL('../apps/coach-mobile/src/offline.js', import.meta.url), 'utf8')
const ast = parse(screenSource, { sourceType: 'module', plugins: ['jsx'] })
const screen = ast.program.body.find(node => node.type === 'ExportNamedDeclaration' && node.declaration?.id?.name === 'CoachPhase31EScreen').declaration
const callback = screen.body.body.find(node => node.type === 'VariableDeclaration' && node.declarations[0].id.name === 'load').declarations[0].init.arguments[0]
const offlineAst = parse(offlineSource, { sourceType: 'module' })
const declarations = ['normalize', 'sanitizeCoachBranding', 'sanitizeCoachContext', 'sanitizeCoachProfile', 'createCoachOfflineResourceSaver', 'saveCoachOfflineResourcesWithProfile'].map(name => {
  const node = offlineAst.program.body.map(item => item.declaration || item).find(item => item.type === 'FunctionDeclaration' && item.id?.name === name)
  assert.ok(node, name)
  return offlineSource.slice(node.start, node.end)
}).join('\n')
const context = { id: 'team:test', authorityId: 'authority', authoritySource: 'assignment', clubId: 'club', teamId: 'team', role: 'coach' }
const user = { id: 'coach', coachContexts: [context] }
const pendingDrafts = { 'team:test': { items: { draft: { status: 'pending', values: { rating: 4 } } } } }
const snapshot = { matches: [{ id: 'fixture' }], match: [{ id: 'response', eventId: 'fixture', playerId: 'player', status: 'available' }], training: [], calendar: [] }
const flush = () => new Promise(resolve => setImmediate(resolve))
const clone = value => structuredClone(value)

function harness({ initialDocument = null, diskError = null, authority = context, delayedNetwork = null, wrapSaver = saver => saver } = {}) {
  let document = clone(initialDocument), active = true, writes = 0
  let queued = Promise.resolve()
  const state = { data: null, notice: '', offlineWarning: { scope: '', message: '' }, error: '', scopeCurrent: true }
  const config = { networkError: null }
  const store = {
    captureScopeGuard(id) { if (!active || id !== user.id) throw new Error('offline_scope_invalidated'); return () => { if (!active) throw new Error('offline_scope_invalidated') } },
    update(id, updater) {
      const operation = queued.then(async () => {
        if (!active || id !== user.id) throw new Error('offline_scope_invalidated')
        const next = await updater(clone(document))
        if (diskError) throw diskError
        if (!active) throw new Error('offline_scope_invalidated')
        document = clone(next); writes++
        return clone(document)
      })
      queued = operation.catch(() => {})
      return operation
    },
  }
  const deps = { store, ...cache, getScopedTeamBranding: () => null, mergeFormationPendingSaves: () => { throw new Error('unexpected formation change') } }
  const actualSaver = new Function(...Object.keys(deps), declarations + '\nreturn { createCoachOfflineResourceSaver, saveCoachOfflineResourcesWithProfile }')(...Object.values(deps))
  const environment = {
    restoreCoachAvailabilitySnapshot, captureLoadScope: () => () => state.scopeCurrent,
    attendanceLoadGeneration: { current: 0 }, inviteSaveRef: { current: 0 }, domain: 'invites', dataScope: 'invites', deniedScopeRef: { current: '' },
    context: authority, user, LOADERS: { invites: async (_user, options) => { if (delayedNetwork) await delayedNetwork; if (config.networkError) throw config.networkError; options.onAvailabilityReady(snapshot); return snapshot } },
    TITLES: { invites: 'Invites' }, dataRef: { get current() { return state.data } }, offlinePolicy: { cache: true },
    peekMobileResource: () => undefined, invalidateMobileResource() {}, sanitizeCoachChatOfflineValue: value => value,
    readMobileResource: (_user, _key, loader) => loader(), withMobileAsyncTimeout: loader => loader(),
    readCoachOfflineResources: async () => cache.getCoachOfflineResources(document, authority),
    hasUsableCoachPhase31ECache: (_domain, value) => Boolean(value),
    createCoachOfflineResourceSaver: (...args) => wrapSaver(actualSaver.createCoachOfflineResourceSaver(...args)),
    saveCoachOfflineResources: actualSaver.saveCoachOfflineResourcesWithProfile,
    getCoachFriendlyError: error => error.message,
    ...Object.fromEntries(['Data', 'Error', 'Notice', 'OfflineWarning', 'Loading', 'Refreshing', 'Stale', 'InvitesRefreshing'].map(name => [`set${name}`, value => { const key = name.charAt(0).toLowerCase() + name.slice(1); state[key] = typeof value === 'function' ? value(state[key]) : value }])),
  }
  return { state, config, load: vm.runInNewContext(`(${screenSource.slice(callback.start, callback.end)})`, environment),
    document: () => clone(document), writes: () => writes, invalidate() { active = false; state.scopeCurrent = false }, settle: async () => { await queued; await flush() } }
}

test('Invites load repairs a missing profile and retains pending drafts across refresh', async () => {
  const original = { ...cache.createCoachOfflineDocument({ userScope: user.id }), developmentDrafts: clone(pendingDrafts) }
  const h = harness({ initialDocument: original })
  await h.load(); await h.settle()
  assert.equal(h.document().profile.value.id, user.id)
  assert.deepEqual(h.document().developmentDrafts, pendingDrafts)
  assert.equal(h.document().contexts[context.id].resources['phase31e:invites'].match[0].id, 'response')
  assert.equal(h.state.offlineWarning.message, '')
  await h.load({ silent: true }); await h.settle()
  assert.deepEqual(h.document().developmentDrafts, pendingDrafts)
  assert.equal(h.state.offlineWarning.message, '')
})

test('actual write failure retains live data, protected drafts and a visible inline warning across refreshes', async () => {
  const original = { ...cache.createCoachOfflineDocument({ userScope: user.id }), developmentDrafts: clone(pendingDrafts) }
  const h = harness({ initialDocument: original, diskError: new Error('synthetic device storage failure') })
  await h.load(); await h.settle()
  assert.equal(h.state.data, snapshot)
  assert.equal(h.state.error, '')
  assert.ok(h.state.offlineWarning.message)
  assert.deepEqual(h.document(), original)
  await h.load({ silent: true }); await h.settle()
  assert.ok(h.state.offlineWarning.message)
  assert.deepEqual(h.document(), original)
  const jsx = screenSource.slice(screen.body.start, screen.body.end)
  assert.match(jsx, /<CoachOfflineCopyWarning\s+message=\{offlineWarning\.message\}/)
  assert.doesNotMatch(jsx, /<MobileFailureNotice[^>]*message=\{offlineWarning/)
})

test('a stored authority mismatch cannot be repaired or overwritten by a live Invites read', async () => {
  let original = cache.createCoachOfflineDocument({ userScope: user.id })
  original = cache.setCoachOfflineProfile(original, { ...user, coachContexts: [{ ...context, authorityId: 'other' }] })
  original.developmentDrafts = clone(pendingDrafts)
  const h = harness({ initialDocument: original })
  await h.load(); await h.settle()
  assert.equal(h.state.data, snapshot)
  assert.ok(h.state.offlineWarning.message)
  assert.equal(h.writes(), 0)
  assert.deepEqual(h.document(), original)
})

test('a switched account cannot publish or save a delayed Invites load', async () => {
  let resolve
  const gate = new Promise(done => { resolve = done })
  const h = harness({ delayedNetwork: gate })
  const loading = h.load()
  await flush()
  h.invalidate(); resolve(); await loading; await h.settle()
  assert.equal(h.writes(), 0)
  assert.equal(h.document(), null)
  assert.equal(h.state.data, null)
  assert.equal(h.state.offlineWarning.message, '')
})

test('an older failed save cannot restore a warning after a later save succeeds', async () => {
  let rejectFirst, call = 0
  const first = new Promise((_resolve, reject) => { rejectFirst = reject })
  const h = harness({ wrapSaver: save => value => ++call === 1 ? first : save(value) })
  await h.load(); await h.settle()
  assert.equal(h.document().profile.value.id, user.id)
  assert.equal(h.state.offlineWarning.message, '')
  rejectFirst(new Error('older write failed'))
  await flush()
  assert.equal(h.state.offlineWarning.message, '')
})

test('profile repair does not discard Formation drafts from removed or changed contexts', async () => {
  for (const savedContext of [
    { ...context, id: 'team:removed', authorityId: 'removed' },
    { ...context, authorityId: 'previous-authority' },
    { ...context, authorityId: '', authoritySource: '', clubId: '', teamId: '', role: '' },
  ]) {
    const original = cache.createCoachOfflineDocument({ userScope: user.id })
    original.contexts[savedContext.id] = {
      contextId: savedContext.id, authorityId: savedContext.authorityId,
      authoritySource: savedContext.authoritySource, clubId: savedContext.clubId,
      teamId: savedContext.teamId, role: savedContext.role,
      resources: { formation: { localDrafts: { board: { pending: true } }, pendingSaves: { board: { revision: 2 } } } },
      resourceMetadata: {},
    }
    const h = harness({ initialDocument: original })
    await h.load(); await h.settle()
    assert.equal(h.state.data, snapshot)
    assert.ok(h.state.offlineWarning.message)
    assert.deepEqual(h.document(), original)
    assert.equal(h.writes(), 0)
  }
})

test('an older failed save remains visible when a later refresh fails before saving', async () => {
  let rejectSave
  const pending = new Promise((_resolve, reject) => { rejectSave = reject })
  const h = harness({ wrapSaver: () => () => pending })
  await h.load()
  h.config.networkError = new Error('network unavailable')
  await h.load({ silent: true })
  rejectSave(new Error('device storage failure'))
  await flush()
  assert.ok(h.state.offlineWarning.message)
})

test('a late cache failure cannot publish a warning after an account change', async () => {
  let rejectSave
  const pending = new Promise((_resolve, reject) => { rejectSave = reject })
  const h = harness({ wrapSaver: () => () => pending })
  await h.load()
  h.invalidate()
  rejectSave(new Error('device storage failure'))
  await flush()
  assert.equal(h.state.offlineWarning.message, '')
})

test('offline warnings expose only a coarse reference, never private error details', async () => {
  for (const [error, reference] of [
    [new Error('offline_cache_payload_too_large private player'), 'CACHE'],
    [new Error('offline_context_scope_mismatch private player'), 'ACCESS'],
    [new Error('private player confidential@example.test'), 'DEVICE'],
  ]) {
    const h = harness({ diskError: error })
    await h.load(); await h.settle()
    assert.match(h.state.offlineWarning.message, new RegExp(`Reference: ${reference}\\.`))
    assert.doesNotMatch(h.state.offlineWarning.message, /private player|confidential@example\.test|offline_/i)
  }
})
