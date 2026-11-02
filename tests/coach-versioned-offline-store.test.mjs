import test from 'node:test'
import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { createCoachVersionedOfflineStore } from '../apps/mobile-core/src/coachVersionedOfflineStore.js'

function memory(initial = null) {
  let document = initial, scope = ''
  return { activate(value) { scope = value }, invalidate() { scope = '' }, async read(value) { return document && document.userScope !== value ? { status: 'scope_mismatch', document: null } : document ? { status: 'ready', document: structuredClone(document) } : { status: 'missing', document: null } },
    async readSnapshot(value) { return this.read(value) }, async inspect(value) { return this.read(value) }, async inspectArtifacts() { return { hasPointer: Boolean(document), hasGeneration: Boolean(document) } },
    async write(value, data) { if (value !== scope) throw Error('scope'); document = { ...structuredClone(data), userScope: value }; return structuredClone(document) },
    async update(value, updater) { const current = (await this.read(value)).document, next = await updater(current); if (!next || next === current) return current; return this.write(value, next) },
    async clear() { document = null }, mutate(value) { document = value }, peek() { return document } }
}
function fixture(initial = { userScope: 'coach-a', pending: [{ id: 'unsent' }] }) {
  const old = memory(initial), markers = new Map(), stores = new Map()
  const markerStorage = { async getAllKeys() { return [...markers.keys()] }, async getItem(k) { return markers.get(k) || null }, async setItem(k,v) { markers.set(k,v) }, async removeItem(k) { markers.delete(k) } }
  const store = createCoachVersionedOfflineStore({ legacyStore: old, markerStorage, markerPrefix: 'migration', createScopedStore(key) { if (!stores.has(key)) stores.set(key,memory()); return stores.get(key) }, fingerprint: async value => createHash('sha256').update(value).digest('hex') })
  return { old, markers, stores, store, markerStorage }
}

test('migration keeps the legacy encrypted snapshot and preserves pending work', async () => {
  const f = fixture(); f.store.activate('coach-a'); const read = await f.store.read('coach-a')
  assert.equal(read.document.pending[0].id, 'unsent'); assert.equal(f.old.peek().pending[0].id, 'unsent')
  await f.store.update('coach-a', current => ({ ...current, pending: [...current.pending, { id: 'new' }] }))
  assert.equal((await f.store.read('coach-a')).document.pending.length, 2); assert.equal(f.old.peek().pending.length, 1)
})

test('old-binary writes or sign-out stop reactivation without clearing either account copy', async () => {
  for (const changed of [null, { userScope: 'coach-a', pending: [{ id: 'old-app-change' }] }]) {
    const f = fixture(); f.store.activate('coach-a'); await f.store.read('coach-a'); await f.store.update('coach-a', x => ({ ...x, pending: [{ id: 'new-app-work' }] }))
    f.old.mutate(changed); f.store.activate('coach-b'); f.store.activate('coach-a')
    await assert.rejects(f.store.read('coach-a'), /offline_legacy_recovery_required/)
    assert.equal(f.stores.get('coach_a').peek().pending[0].id, 'new-app-work')
    assert.deepEqual(f.old.peek(), changed)
  }
})

test('a failed migration after the durable marker stops re-import rather than overwriting saved work', async () => {
  const f = fixture(); f.store.activate('coach-a'); f.store.activate('coach-b'); f.store.activate('coach-a')
  f.markers.set('migration.coach_a','1')
  await assert.rejects(f.store.read('coach-a'), /offline_migration_recovery_required/)
  assert.equal(f.old.peek().pending[0].id, 'unsent')
})

test('a different account gets its own namespace and cannot clear the old account snapshot', async () => {
  const f = fixture(); f.store.activate('coach-b'); assert.equal((await f.store.read('coach-b')).status, 'missing')
  await f.store.update('coach-b', () => ({ pending: [{ id: 'b-work' }] }))
  await f.store.clear(); assert.equal(f.old.peek().pending[0].id, 'unsent')
})

test('a captured guard rejects work after switching accounts', async () => {
  const f = fixture(); f.store.activate('coach-a'); const guard = f.store.captureScopeGuard('coach-a'); f.store.activate('coach-b')
  assert.throws(guard, /offline_scope_invalidated/)
})


test('an interrupted migration with no committed artifacts can safely retry the unchanged legacy snapshot', async () => {
  const f = fixture(); const digest = createHash('sha256').update(JSON.stringify(f.old.peek())).digest('hex')
  f.markers.set('migration.coach_a', `preparing:sha256:${digest}`)
  f.store.activate('coach-a'); assert.equal((await f.store.read('coach-a')).document.pending[0].id, 'unsent')
  assert.equal(f.markers.get('migration.coach_a'), `committed:sha256:${digest}`)
})

test('cold-start sign-out clears only the previously active account and its key', async () => {
  const f = fixture(); f.store.activate('coach-a'); await f.store.read('coach-a')
  const replacement = createCoachVersionedOfflineStore({ legacyStore: f.old, markerStorage: { async getAllKeys() { return [...f.markers.keys()] }, async getItem(k) { return f.markers.get(k) || null }, async setItem(k,v) { f.markers.set(k,v) }, async removeItem(k) { f.markers.delete(k) } }, markerPrefix:'migration', createScopedStore(key) { return f.stores.get(key) || memory() }, fingerprint:async value => createHash('sha256').update(value).digest('hex') })
  await replacement.clear(); assert.equal(f.old.peek(),null); assert.equal(f.stores.get('coach_a').peek(),null); assert.equal(f.markers.has('migration.active'),false)
})

test('sign-out invalidates captured guards immediately before asynchronous cleanup', async () => {
  const f = fixture(); f.store.activate('coach-a'); await f.store.read('coach-a'); const guard = f.store.captureScopeGuard('coach-a')
  const clearing = f.store.clear(); assert.throws(guard,/offline_scope_invalidated/); await clearing
})


test('sign-out waits for an in-flight marker write and cannot resurrect an account', async () => {
  const f = fixture(); f.store.activate('coach-a'); await f.store.read('coach-a')
  let release, started
  const begun = new Promise(resolve => { started = resolve })
  const priorSet = f.markerStorage.setItem
  f.markerStorage.setItem = async (key, value) => {
    if (key === 'migration.coach_a' && value.startsWith('preparing:')) {
      started(); await new Promise(resolve => { release = resolve })
    }
    return priorSet(key, value)
  }
  const writing = f.store.update('coach-a', current => ({ ...current, pending: [{ id: 'new' }] }))
  const rejected = assert.rejects(writing, /offline_scope_invalidated/)
  await begun; const clearing = f.store.clear(); release()
  await rejected; await clearing
  assert.equal(f.markers.has('migration.coach_a'), false); assert.equal(f.stores.get('coach_a').peek(), null); assert.equal(f.old.peek(), null)
})

test('a different account activation waits for sign-out cleanup', async () => {
  const f = fixture(); f.store.activate('coach-a'); await f.store.read('coach-a')
  const clearing = f.store.clear(); f.store.activate('coach-b')
  await clearing; assert.equal((await f.store.read('coach-b')).status, 'missing')
  await f.store.update('coach-b', () => ({ pending: [{ id: 'b' }] }))
  assert.equal((await f.store.read('coach-b')).document.pending[0].id, 'b')
  assert.equal(f.markers.get('migration.active'), 'coach-b')
})


test('sign-out cannot delete the new copy when the old binary changed or damaged legacy data', async () => {
  for (const corrupt of [false, true]) {
    const f = fixture(); f.store.activate('coach-a'); await f.store.read('coach-a')
    await f.store.update('coach-a', x => ({ ...x, pending: [{ id: 'new-unsent' }] }))
    if (corrupt) f.old.read = async () => ({ status: 'corrupt', document: null })
    else f.old.mutate({ userScope: 'coach-a', pending: [{ id: 'old-unsent' }] })
    await assert.rejects(f.store.clear(), /offline_legacy_recovery_required/)
    assert.equal(f.stores.get('coach_a').peek().pending[0].id, 'new-unsent')
    if (!corrupt) assert.equal(f.old.peek().pending[0].id, 'old-unsent')
    assert.ok(f.markers.has('migration.coach_a'))
  }
})

test('cold-start sign-out preserves both copies when the legacy snapshot changed', async () => {
  const f = fixture(); f.store.activate('coach-a'); await f.store.read('coach-a')
  await f.store.update('coach-a', x => ({ ...x, pending: [{ id: 'new-unsent' }] }))
  f.old.mutate({ userScope: 'coach-a', pending: [{ id: 'old-unsent' }] })
  const replacement = createCoachVersionedOfflineStore({ legacyStore: f.old, markerStorage: f.markerStorage, markerPrefix:'migration', createScopedStore:key => f.stores.get(key) || memory(), fingerprint:async value => createHash('sha256').update(value).digest('hex') })
  await assert.rejects(replacement.clear(), /offline_legacy_recovery_required/)
  assert.equal(f.stores.get('coach_a').peek().pending[0].id,'new-unsent')
  assert.equal(f.old.peek().pending[0].id,'old-unsent')
})
