import assert from 'node:assert/strict'
import test from 'node:test'
import { createEncryptedOfflineStore } from '../apps/mobile-core/src/offlineStorageCore.js'
import { developmentSaveStatus } from '../apps/mobile-core/src/developmentSaveStatusCore.js'

const deferred = () => { let resolve; const promise = new Promise(done => { resolve = done }); return { promise, resolve } }
function harness(ref) {
  const values = new Map(), keys = new Map()
  const blockers = new Map(), calls = []
  let writeGate = null, readGate = null, pendingWrites = 0, maximumWrites = 0, mutations = 0
  async function nativeStep(stage) {
    calls.push(stage)
    const blocked = blockers.get(stage)
    if (!blocked) return
    if (blocked.skip > 0) { blocked.skip--; return }
    blockers.delete(stage)
    await blocked.gate.promise
  }
  const storage = {
    async getItem(key) { await nativeStep(key.endsWith('.active') ? 'pointer_read' : 'generation_read'); if (readGate) await readGate.promise; return values.get(key) || null },
    async setItem(key, value) {
      pendingWrites++; maximumWrites = Math.max(maximumWrites, pendingWrites)
      try { await nativeStep(key.endsWith('.active') ? 'pointer_write' : 'generation_write'); if (writeGate) await writeGate.promise; mutations++; values.set(key, value) } finally { pendingWrites-- }
    },
    async removeItem(key) { await nativeStep(key.endsWith('.active') ? 'pointer_remove' : 'generation_remove'); mutations++; values.delete(key) },
  }
  // A reversible encoding adapter isolates transaction ordering from encryption;
  // the existing real-cipher suites verify authentication and ciphertext privacy.
  const cryptoProvider = {
    async randomBytes(length) { await nativeStep('crypto_random'); return new Uint8Array(length).fill(1) },
    async seal({ plaintext }) { await nativeStep('crypto_encrypt'); return new TextEncoder().encode(plaintext) },
    async open({ ciphertext }) { await nativeStep('crypto_decrypt'); return new TextDecoder().decode(ciphertext) },
  }
  const create = () => createEncryptedOfflineStore({ appRole: 'coach', environment: 'test', projectRef: ref, storage,
    operationTimeoutMs: 30, cryptoProvider, keyStore: {
      async getItemAsync(key) { await nativeStep('key_read'); return keys.get(key) || null },
      async setItemAsync(key, value) { await nativeStep('key_write'); mutations++; keys.set(key, value) },
      async deleteItemAsync(key) { await nativeStep('key_remove'); mutations++; keys.delete(key) },
    } })
  const store = create()
  store.activate('coach')
  return { store, values, keys, calls, restart: create,
    blockNext(stage, skip = 0) { const gate = deferred(); blockers.set(stage, { gate, skip }); return gate },
    blockWrite() { writeGate = deferred(); return writeGate }, blockRead() { readGate = deferred(); return readGate },
    release() { readGate?.resolve(); writeGate?.resolve(); readGate = null; writeGate = null }, maximumWrites: () => maximumWrites,
    mutations: () => mutations }
}

test('stalled native save releases callers without claiming success or overlapping later writes', async () => {
  const f = harness('assessmenttimeoutwrite')
  await f.store.write('coach', { values: { score: 4 } })
  f.blockWrite()
  const first = f.store.update('coach', doc => ({ ...doc, values: { score: 5 } }))
  const second = f.store.update('coach', doc => ({ ...doc, values: { score: 6 } }))
  const results = await Promise.allSettled([first, second])
  assert.ok(results.every(result => result.status === 'rejected' && result.reason.code === 'offline_storage_timeout'))
  assert.equal(results[0].reason.storageStage, 'generation_write')
  assert.equal(results[1].reason.storageStage, 'queued')
  assert.equal(results[1].reason.storageBlockedStage, 'generation_write')
  assert.match(developmentSaveStatus({ ready: true, saving: 0, unsaved: true, error: results[0].reason.message }), /not been saved/)
  assert.equal((await f.store.readSnapshot('coach')).document.values.score, 4, 'Visible snapshot only exposes the last confirmed commit')
  assert.equal(f.maximumWrites(), 1, 'Retry must retain serialization while the native write remains pending')
  f.release()
  const saved = await f.store.read('coach')
  assert.equal(saved.document.values.score, 4, 'Expired transactions must not activate unconfirmed or queued stale writes')
  assert.equal(f.maximumWrites(), 1)
  await f.store.update('coach', doc => ({ ...doc, values: { score: 7 } }))
  assert.equal((await f.store.read('coach')).document.values.score, 7)
})

for (const stage of ['pointer_read', 'key_read', 'generation_read', 'crypto_decrypt', 'crypto_random', 'crypto_encrypt']) {
  test(`retry recovers from permanently stalled ${stage} without releasing its original response`, async () => {
    const f = harness(`recover${stage.replaceAll('_', '')}`)
    await f.store.write('coach', { values: { score: 4 }, notes: 'Private assessment marker' })
    const store = f.restart()
    const held = f.blockNext(stage)
    const before = [...f.values.entries()]
    let failure
    await assert.rejects(store.update('coach', doc => ({ ...doc, values: { score: 5 } })), error => {
      failure = error
      return error.code === 'offline_storage_timeout' && error.storageStage === stage
    })
    assert.equal(failure.storageOperation, 'update')
    assert.match(failure.message, /Step: [A-Z]/)
    assert.equal(failure.message.includes(stage), false, 'Internal stage names stay out of app copy')
    assert.equal(JSON.stringify(failure).includes('Private assessment marker'), false)
    assert.equal(JSON.stringify(failure).includes('fp.mobile'), false)
    assert.deepEqual([...f.values.entries()], before, 'A timeout must not be treated as ciphertext corruption or delete the retained record')
    await store.update('coach', doc => ({ ...doc, values: { score: 7 } }))
    assert.equal((await store.read('coach')).document.values.score, 7)
    const writes = f.mutations()
    held.resolve()
    await new Promise(resolve => setImmediate(resolve))
    assert.equal(f.mutations(), writes, 'Late original response must never resume a stale transaction into writes')
    assert.equal((await store.read('coach')).document.values.score, 7)
  })
}

test('stalled encrypted generation readback releases safely and cannot activate stale ciphertext later', async () => {
  const f = harness('readbacktimeout')
  await f.store.write('coach', { values: { score: 4 } })
  const held = f.blockNext('generation_read', 1)
  await assert.rejects(f.store.update('coach', doc => ({ ...doc, values: { score: 5 } })), error => error.storageStage === 'generation_read')
  assert.equal((await f.store.read('coach')).document.values.score, 4)
  await f.store.update('coach', doc => ({ ...doc, values: { score: 7 } }))
  const writes = f.mutations()
  held.resolve()
  await new Promise(resolve => setImmediate(resolve))
  assert.equal(f.mutations(), writes)
  assert.equal((await f.store.read('coach')).document.values.score, 7)
})

test('a stalled new key readback retains the written key and a retry verifies it without key replacement', async () => {
  const f = harness('keyreadbacktimeout')
  const held = f.blockNext('key_read', 1)
  await assert.rejects(f.store.write('coach', { values: { score: 5 } }), error => error.storageStage === 'key_read')
  const originalKey = [...f.keys.entries()]
  assert.equal(originalKey.length, 1)
  assert.equal(f.values.size, 0)
  await f.store.write('coach', { values: { score: 7 } })
  assert.deepEqual([...f.keys.entries()], originalKey)
  const writes = f.mutations()
  held.resolve()
  await new Promise(resolve => setImmediate(resolve))
  assert.equal(f.mutations(), writes)
  assert.equal((await f.store.read('coach')).document.values.score, 7)
})

test('explicit clear still finishes all ciphertext and key removal after its caller times out', async () => {
  const f = harness('cleartimeout')
  await f.store.write('coach', { values: { score: 4 } })
  const held = f.blockNext('pointer_remove')
  await assert.rejects(f.store.clear(), error => error.storageStage === 'pointer_remove')
  assert.equal((await f.store.readSnapshot('coach')).document, null)
  held.resolve()
  await new Promise(resolve => setImmediate(resolve))
  assert.equal(f.values.size, 0)
  assert.equal(f.keys.size, 0)
  assert.equal((await f.store.read('coach')).document, null)
})

for (const stage of ['key_write', 'generation_write', 'pointer_write']) {
  test(`uncertain ${stage} stays serialized and expired queued updates never run`, async () => {
    const f = harness(`uncertain${stage.replaceAll('_', '')}`)
    if (stage !== 'key_write') await f.store.write('coach', { values: { score: 4 } })
    const held = f.blockNext(stage)
    let queuedUpdaterCalls = 0
    const first = f.store.write('coach', { values: { score: 5 } })
    const queued = f.store.update('coach', doc => { queuedUpdaterCalls++; return { ...doc, values: { score: 6 } } })
    const results = await Promise.allSettled([first, queued])
    assert.ok(results.every(result => result.status === 'rejected'))
    assert.equal(results[0].reason.storageStage, stage)
    assert.equal(results[1].reason.storageStage, 'queued')
    assert.equal(results[1].reason.storageBlockedStage, stage)
    assert.match(results[1].reason.message, /Waiting for an earlier save/)
    assert.equal(queuedUpdaterCalls, 0)
    const nativeCalls = f.calls.length
    await assert.rejects(f.store.read('coach'), error => error.storageStage === 'queued')
    assert.equal(f.calls.length, nativeCalls, 'No later native operation starts while the uncertain mutation is pending')
    const mutationsBeforeCompletion = f.mutations()
    held.resolve()
    await new Promise(resolve => setImmediate(resolve))
    assert.equal(f.mutations(), mutationsBeforeCompletion + 1, 'Only the already dispatched mutation may finish late')
    assert.equal(queuedUpdaterCalls, 0)
    await f.store.write('coach', { values: { score: 7 } })
    assert.equal((await f.store.read('coach')).document.values.score, 7)
    assert.equal(f.maximumWrites(), 1)
  })
}

test('clear supersedes a timed-out native mutation and removes its late ciphertext before new account work', async () => {
  const f = harness('clearlatemutation')
  await f.store.write('coach', { values: { score: 4 } })
  const held = f.blockNext('generation_write')
  await assert.rejects(f.store.write('coach', { values: { score: 5 } }), error => error.storageStage === 'generation_write')
  await assert.rejects(f.store.clear(), error => error.storageStage === 'queued')
  f.store.activate('new-coach')
  held.resolve()
  await new Promise(resolve => setImmediate(resolve))
  assert.equal(f.values.size, 0)
  assert.equal(f.keys.size, 0)
  await f.store.write('new-coach', { values: { score: 9 } })
  assert.equal((await f.store.read('new-coach')).document.values.score, 9)
  assert.equal((await f.store.read('coach')).document, null)
})

test('stalled read is bounded and a later account switch rejects the old pending save', async () => {
  const f = harness('assessmenttimeoutscope')
  await f.store.write('coach', { values: { score: 4 } })
  f.blockRead()
  const pending = f.store.update('coach', doc => ({ ...doc, values: { score: 5 } }))
  await assert.rejects(pending, error => error.code === 'offline_storage_timeout')
  f.store.activate('other-coach')
  f.release()
  await new Promise(resolve => setImmediate(resolve))
  const result = await f.store.read('other-coach')
  assert.equal(result.document, null)
  assert.equal(f.values.size, 0, 'Old account ciphertext must not survive the new scope')
})
