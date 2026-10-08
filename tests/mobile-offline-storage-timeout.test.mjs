import assert from 'node:assert/strict'
import test from 'node:test'
import { createEncryptedOfflineStore } from '../apps/mobile-core/src/offlineStorageCore.js'
import { developmentSaveStatus } from '../apps/mobile-core/src/developmentSaveStatusCore.js'

const deferred = () => { let resolve; const promise = new Promise(done => { resolve = done }); return { promise, resolve } }
function harness(ref) {
  const values = new Map(), keys = new Map()
  let writeGate = null, readGate = null, pendingWrites = 0, maximumWrites = 0
  const storage = {
    async getItem(key) { if (readGate) await readGate.promise; return values.get(key) || null },
    async setItem(key, value) {
      pendingWrites++; maximumWrites = Math.max(maximumWrites, pendingWrites)
      try { if (writeGate) await writeGate.promise; values.set(key, value) } finally { pendingWrites-- }
    },
    async removeItem(key) { values.delete(key) },
  }
  // A reversible encoding adapter isolates transaction ordering from encryption;
  // the existing real-cipher suites verify authentication and ciphertext privacy.
  const cryptoProvider = {
    async randomBytes(length) { return new Uint8Array(length).fill(1) },
    async seal({ plaintext }) { return new TextEncoder().encode(plaintext) },
    async open({ ciphertext }) { return new TextDecoder().decode(ciphertext) },
  }
  const store = createEncryptedOfflineStore({ appRole: 'coach', environment: 'test', projectRef: ref, storage,
    operationTimeoutMs: 30, cryptoProvider, keyStore: {
      async getItemAsync(key) { return keys.get(key) || null },
      async setItemAsync(key, value) { keys.set(key, value) },
      async deleteItemAsync(key) { keys.delete(key) },
    } })
  store.activate('coach')
  return { store, values, blockWrite() { writeGate = deferred(); return writeGate }, blockRead() { readGate = deferred(); return readGate },
    release() { readGate?.resolve(); writeGate?.resolve(); readGate = null; writeGate = null }, maximumWrites: () => maximumWrites }
}

test('stalled native save releases callers without claiming success or overlapping later writes', async () => {
  const f = harness('assessmenttimeoutwrite')
  await f.store.write('coach', { values: { score: 4 } })
  f.blockWrite()
  const first = f.store.update('coach', doc => ({ ...doc, values: { score: 5 } }))
  const second = f.store.update('coach', doc => ({ ...doc, values: { score: 6 } }))
  const results = await Promise.allSettled([first, second])
  assert.ok(results.every(result => result.status === 'rejected' && result.reason.code === 'offline_storage_timeout'))
  assert.match(developmentSaveStatus({ ready: true, saving: 0, unsaved: true, error: results[0].reason.message }), /not been saved/)
  assert.equal((await f.store.readSnapshot('coach')).document.values.score, 4, 'Visible snapshot only exposes the last confirmed commit')
  assert.equal(f.maximumWrites(), 1, 'Retry must retain serialization while the native write remains pending')
  f.release()
  const saved = await f.store.read('coach')
  assert.equal(saved.document.values.score, 6, 'Late writes retain their original order')
  assert.equal(f.maximumWrites(), 1)
  await f.store.update('coach', doc => ({ ...doc, values: { score: 7 } }))
  assert.equal((await f.store.read('coach')).document.values.score, 7)
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
