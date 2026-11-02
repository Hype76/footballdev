import test from 'node:test'
import assert from 'node:assert/strict'
import { createCoachFileStorage } from '../apps/mobile-core/src/coachFileStorage.js'
import { createEncryptedOfflineStore } from '../apps/mobile-core/src/offlineStorageCore.js'
import { COACH_PHASE_31F_MAX_CACHE_BYTES } from '../apps/mobile-core/src/coachPhase31FCore.js'

const key = 'fp.mobile.offline.v1.coach.live.project.g.a'
const pointer = 'fp.mobile.offline.v1.coach.live.project.active'
function fixture() {
  const legacy = new Map(), files = new Map()
  const storage = { async getItem(k) { return legacy.get(k) ?? null }, async setItem(k,v) { legacy.set(k,v) }, async removeItem(k) { legacy.delete(k) } }
  const fs = { documentDirectory: 'file:///documents/', async getInfoAsync(p) { return { exists: files.has(p), isDirectory: false } }, async makeDirectoryAsync() {}, async readAsStringAsync(p) { return files.get(p) }, async writeAsStringAsync(p,v) { files.set(p,v) }, async moveAsync({from,to}) { if (!files.has(from)) throw Error('missing'); files.set(to,files.get(from)); files.delete(from) }, async deleteAsync(p) { files.delete(p) } }
  return { legacy, files, storage, fs, adapter: createCoachFileStorage({ fileSystem: fs, legacyStorage: storage }) }
}

test('migrates encrypted generations from legacy storage and keeps pointers unchanged', async () => {
  const f = fixture(); f.legacy.set(key, 'encrypted-old'); await f.adapter.setItem(pointer, 'pointer')
  assert.equal(await f.adapter.getItem(key), 'encrypted-old')
  await f.adapter.setItem(key, 'encrypted-new')
  assert.equal(await f.adapter.getItem(key), 'encrypted-new'); assert.equal(f.legacy.has(key), false)
  assert.equal(await f.adapter.getItem(pointer), 'pointer')
  await f.adapter.removeItem(key); assert.equal(await f.adapter.getItem(key), null)
})

test('file storage accepts an encrypted envelope beyond the requested 15 MB document limit', async () => {
  const f = fixture(); assert.equal(COACH_PHASE_31F_MAX_CACHE_BYTES, 15_000_000)
  const envelope = 'x'.repeat(20_000_000)
  await f.adapter.setItem(key, envelope); assert.equal((await f.adapter.getItem(key)).length, envelope.length)
})

test('failed file writes leave the prior encrypted value and never alter the pointer', async () => {
  const f = fixture(); f.legacy.set(key, 'encrypted-old'); f.legacy.set(pointer, 'pointer')
  f.fs.writeAsStringAsync = async () => { throw Error('disk full') }
  await assert.rejects(f.adapter.setItem(key, 'encrypted-new'), /disk full/)
  assert.equal(await f.adapter.getItem(key), 'encrypted-old'); assert.equal(await f.adapter.getItem(pointer), 'pointer')
})

test('without the file bridge, oversized generations fail before touching legacy storage', async () => {
  const f = fixture(); f.legacy.set(key, 'encrypted-old')
  const fallback = createCoachFileStorage({ fileSystem: null, legacyStorage: f.storage })
  await assert.rejects(fallback.setItem(key, 'x'.repeat(1_950_001)), /offline_cache_payload_too_large/)
  assert.equal(await fallback.getItem(key), 'encrypted-old')
})


test('encrypted store migrates an existing document, saves a larger one and preserves it after a failed write', async () => {
  const f = fixture()
  const keys = new Map()
  const keyStore = { async getItemAsync(k) { return keys.get(k) || null }, async setItemAsync(k, v) { keys.set(k, v) }, async deleteItemAsync(k) { keys.delete(k) } }
  const cryptoProvider = { async randomBytes(n) { return new Uint8Array(n).fill(7) }, async seal({ plaintext }) { return new TextEncoder().encode(plaintext) }, async open({ ciphertext }) { return new TextDecoder().decode(ciphertext) } }
  const options = { appRole: 'coach', environment: 'live', projectRef: 'project', keyStore, cryptoProvider, operationTimeoutMs: 60_000 }
  const oldStore = createEncryptedOfflineStore({ ...options, storage: f.storage })
  oldStore.activate('coach'); await oldStore.write('coach', { note: 'old', pending: [{ id: 'unsent' }] })
  const newStore = createEncryptedOfflineStore({ ...options, storage: f.adapter })
  newStore.activate('coach')
  assert.equal((await newStore.read('coach')).document.note, 'old')
  await newStore.write('coach', { note: 'x'.repeat(2_200_000), pending: [{ id: 'unsent' }] })
  const saved = await newStore.read('coach'); assert.equal(saved.document.note.length, 2_200_000); assert.equal(saved.document.pending[0].id, 'unsent')
  f.fs.writeAsStringAsync = async () => { throw Error('disk full') }
  await assert.rejects(newStore.write('coach', { note: 'replacement' }), /disk full/)
  const retained = await newStore.read('coach'); assert.equal(retained.document.note.length, 2_200_000); assert.equal(retained.document.pending[0].id, 'unsent')
})


test('a missing file bridge cannot mistake file-backed data for a missing legacy document', async () => {
  const f = fixture(); await f.adapter.setItem(key, 'encrypted-new')
  const fallback = createCoachFileStorage({ fileSystem: null, legacyStorage: f.storage })
  await assert.rejects(fallback.getItem(key), /offline_storage_file_unavailable/)
  f.legacy.set(pointer, 'pointer')
  await assert.rejects(fallback.removeItem(pointer), /offline_storage_file_unavailable/)
  assert.equal(f.legacy.get(pointer), 'pointer')
  assert.equal(await f.adapter.getItem(key), 'encrypted-new')
  f.files.clear()
  await assert.rejects(f.adapter.getItem(key), /offline_storage_file_unavailable/)
})


test('an interrupted replacement of the inactive generation leaves the active pointer and saved work intact', async () => {
  const f = fixture(), keys = new Map()
  const keyStore = { async getItemAsync(k) { return keys.get(k) || null }, async setItemAsync(k, v) { keys.set(k, v) }, async deleteItemAsync(k) { keys.delete(k) } }
  const cryptoProvider = { async randomBytes(n) { return new Uint8Array(n).fill(7) }, async seal({ plaintext }) { return new TextEncoder().encode(plaintext) }, async open({ ciphertext }) { return new TextDecoder().decode(ciphertext) } }
  const store = createEncryptedOfflineStore({ appRole: 'coach', environment: 'live', projectRef: 'project', keyStore, cryptoProvider, storage: f.adapter })
  store.activate('coach'); await store.write('coach', { pending: [{ id: 'first' }] }); await store.write('coach', { pending: [{ id: 'still-unsent' }] })
  const before = await f.adapter.getItem(pointer)
  f.fs.moveAsync = async () => { throw Error('interrupted move') }
  await assert.rejects(store.write('coach', { pending: [{ id: 'next' }] }), /interrupted move/)
  assert.equal(await f.adapter.getItem(pointer), before)
  assert.equal((await store.read('coach')).document.pending[0].id, 'still-unsent')
})


test('interrupted replacement retains the previous encrypted generation for recovery', async () => {
  const f = fixture(); await f.adapter.setItem(key, 'encrypted-previous')
  const move = f.fs.moveAsync
  f.fs.moveAsync = async ({ from, to }) => { if (from.endsWith('.pending')) throw Error('interrupted move'); return move({ from, to }) }
  await assert.rejects(f.adapter.setItem(key, 'encrypted-next'), /interrupted move/)
  assert.equal(await f.adapter.getItem(key), 'encrypted-previous')
})


test('legacy migration reads do not erase a corrupt pointer or a missing encryption key', async () => {
  for (const pointerValue of ['invalid-json', JSON.stringify({ schemaVersion: 1, active: 'a', previous: '' })]) {
    const f = fixture(), values = new Map()
    const keys = { async getItemAsync() { return null }, async setItemAsync(k,v) { values.set(k,v) }, async deleteItemAsync(k) { values.delete(k) } }
    const cryptoProvider = { async randomBytes(n) { return new Uint8Array(n).fill(7) }, async seal({ plaintext }) { return new TextEncoder().encode(plaintext) }, async open({ ciphertext }) { return new TextDecoder().decode(ciphertext) } }
    await f.storage.setItem(pointer, pointerValue); await f.storage.setItem(key, 'encrypted-unsent')
    const store = createEncryptedOfflineStore({ appRole: 'coach', environment: 'live', projectRef: 'project', keyStore: keys, cryptoProvider, storage: f.storage, preserveOnFailure: true })
    store.activate('coach'); assert.equal((await store.read('coach')).status, 'corrupt')
    assert.equal(await f.storage.getItem(pointer), pointerValue); assert.equal(await f.storage.getItem(key), 'encrypted-unsent')
  }
})


test('a corrupt active generation never allows writing over the only valid previous copy', async () => {
  const f = fixture(), values = new Map()
  const keys = { async getItemAsync(k) { return values.get(k) || null }, async setItemAsync(k,v) { values.set(k,v) }, async deleteItemAsync(k) { values.delete(k) } }
  const cryptoProvider = { async randomBytes(n) { return new Uint8Array(n).fill(7) }, async seal({ plaintext }) { return new TextEncoder().encode(plaintext) }, async open({ ciphertext }) { return new TextDecoder().decode(ciphertext) } }
  const store = createEncryptedOfflineStore({ appRole:'coach', environment:'live', projectRef:'project', keyStore:keys, cryptoProvider, storage:f.storage, preserveOnFailure:true })
  store.activate('coach'); await store.write('coach',{ pending:[{id:'unsent'}] })
  const previous = f.legacy.get(key)
  await store.write('coach',{ pending:[{id:'newer'}] })
  f.legacy.set(key, previous); f.legacy.set(key.replace(/\.a$/,'.b'), '{damaged')
  const pendingPointer = JSON.stringify({schemaVersion:1,active:'b',previous:'a'}); f.legacy.set(pointer,pendingPointer)
  await assert.rejects(store.update('coach', () => ({ pending:[] })),/offline_storage_recovery_required/)
  await assert.rejects(store.write('coach',{ pending:[] }),/offline_storage_recovery_required/)
  assert.equal(f.legacy.get(key),previous); assert.equal(f.legacy.get(pointer),pendingPointer)
})
