import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import path from 'node:path'
import test from 'node:test'
import { fileURLToPath } from 'node:url'

import { xchacha20poly1305 } from '../apps/parent-mobile/node_modules/@noble/ciphers/chacha.js'
import { bytesToUtf8, utf8ToBytes } from '../apps/parent-mobile/node_modules/@noble/ciphers/utils.js'
import {
  createEncryptedOfflineStore,
  deriveOfflineStorageNamespace,
  MOBILE_OFFLINE_KEY_BYTES,
  MOBILE_OFFLINE_NONCE_BYTES,
  MOBILE_OFFLINE_STORAGE_SCHEMA_VERSION,
} from '../apps/mobile-core/src/offlineStorageCore.js'
import {
  classifyParentCommandError,
  createParentOfflineDocument,
  createParentSyncCoordinator,
  enqueueParentOfflineCommand,
  getParentOfflineResources,
  getParentSyncSummary,
  PARENT_OFFLINE_MAX_AUTOMATIC_ATTEMPTS,
  PARENT_OFFLINE_COMMAND_SCHEMA_VERSION,
  PARENT_OFFLINE_DOCUMENT_SCHEMA_VERSION,
  setParentOfflineProfile,
  setParentOfflineResources,
  setParentOfflineSelection,
} from '../apps/mobile-core/src/parentOfflineCore.js'

const repositoryRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const projectRef = 'ndohkecigwlwayghsopw'

class MemoryStorage {
  constructor(values = new Map()) {
    this.values = values
    this.failSet = null
  }
  async getItem(key) { return this.values.get(key) ?? null }
  async removeItem(key) { this.values.delete(key) }
  async setItem(key, value) {
    if (this.failSet?.(key, value)) throw new Error('synthetic_storage_failure')
    this.values.set(key, value)
  }
}

class MemoryKeyStore {
  constructor(values = new Map()) { this.values = values }
  async deleteItemAsync(key) { this.values.delete(key) }
  async getItemAsync(key) { return this.values.get(key) ?? null }
  async setItemAsync(key, value) { this.values.set(key, value) }
}

function deterministicCrypto() {
  let seed = 0
  return {
    async open({ aad, ciphertext, key, nonce }) {
      return bytesToUtf8(xchacha20poly1305(key, nonce, utf8ToBytes(aad)).decrypt(ciphertext))
    },
    async randomBytes(length) {
      seed += 1
      return Uint8Array.from({ length }, (_, index) => (seed + index) % 256)
    },
    async seal({ aad, key, nonce, plaintext }) {
      return xchacha20poly1305(key, nonce, utf8ToBytes(aad)).encrypt(utf8ToBytes(plaintext))
    },
  }
}

function createStoreHarness({ keyValues = new Map(), values = new Map() } = {}) {
  const storage = new MemoryStorage(values)
  const keyStore = new MemoryKeyStore(keyValues)
  const store = createEncryptedOfflineStore({
    appRole: 'parent',
    cryptoProvider: deterministicCrypto(),
    environment: 'test',
    keyStore,
    projectRef,
    storage,
  })
  return { keyStore, storage, store }
}

function profile(userScope = 'parent-a') {
  return {
    displayName: 'Synthetic Parent',
    email: 'parent@example.test',
    id: userScope,
    parentPortalLinks: [
      { id: 'link-a', playerId: 'player-a', playerName: 'Child Alpha', teamId: 'team-a', teamName: 'Team Amber' },
      { id: 'link-b', playerId: 'player-b', playerName: 'Child Beta', teamId: 'team-b', teamName: 'Team Blue' },
    ],
    role: 'parent_portal',
    selectedParentLinkId: 'link-a',
  }
}

function documentFor(userScope = 'parent-a') {
  return createParentOfflineDocument({ profile: profile(userScope), selectedLinkId: 'link-a', userScope })
}

test('offline storage constants and namespaces bind schema, app, environment and test project', () => {
  assert.equal(MOBILE_OFFLINE_STORAGE_SCHEMA_VERSION, 1)
  assert.equal(MOBILE_OFFLINE_KEY_BYTES, 32)
  assert.equal(MOBILE_OFFLINE_NONCE_BYTES, 24)
  assert.equal(PARENT_OFFLINE_DOCUMENT_SCHEMA_VERSION, 1)
  assert.equal(PARENT_OFFLINE_COMMAND_SCHEMA_VERSION, 1)
  assert.match(deriveOfflineStorageNamespace({ appRole: 'parent', environment: 'test', projectRef }), /^fp\.mobile\.offline\.v1\.parent\.test\./)
  assert.notEqual(
    deriveOfflineStorageNamespace({ appRole: 'parent', environment: 'test', projectRef }),
    deriveOfflineStorageNamespace({ appRole: 'coach', environment: 'test', projectRef }),
  )
})

test('authenticated encryption round trips while storage contains no Parent or child plaintext', async () => {
  const { keyStore, storage, store } = createStoreHarness()
  const original = documentFor()
  await store.write('parent-a', original)
  const restored = await store.read('parent-a')
  assert.equal(restored.status, 'ready')
  assert.equal(restored.document.profile.value.parentPortalLinks[0].playerName, 'Child Alpha')
  const persisted = [...storage.values.values()].join('\n')
  assert.doesNotMatch(persisted, /Synthetic Parent|parent@example\.test|Child Alpha|Child Beta|player-a|parent-a/)
  assert.equal([...keyStore.values.values()].some((value) => value.length >= 40), true)
})

test('ciphertext tampering fails authentication, clears corrupt generations and exposes no data', async () => {
  const { storage, store } = createStoreHarness()
  await store.write('parent-a', documentFor())
  const generationKey = [...storage.values.keys()].find((key) => key.includes('.g.'))
  const envelope = JSON.parse(storage.values.get(generationKey))
  envelope.ciphertext = `${envelope.ciphertext.slice(0, -4)}AAAA`
  storage.values.set(generationKey, JSON.stringify(envelope))
  const result = await store.read('parent-a')
  assert.equal(result.status, 'corrupt')
  assert.equal(result.document, null)
  assert.equal([...storage.values.keys()].some((key) => key.includes('.g.')), false)
})

test('a different signed-in Parent cannot read the previous Parent document', async () => {
  const { storage, store } = createStoreHarness()
  await store.write('parent-a', documentFor())
  const result = await store.read('parent-b')
  assert.equal(result.status, 'scope_mismatch')
  assert.equal(result.document, null)
  assert.equal(storage.values.size, 0)
})

test('failed replacement before activation preserves the previous complete document', async () => {
  const { storage, store } = createStoreHarness()
  await store.write('parent-a', documentFor())
  const replacement = setParentOfflineSelection(documentFor(), 'link-b')
  storage.failSet = (key) => key.endsWith('.g.b')
  await assert.rejects(() => store.write('parent-a', replacement), /synthetic_storage_failure/)
  storage.failSet = null
  assert.equal((await store.read('parent-a')).document.selectedLinkId, 'link-a')
})

test('cache preserves exact child scopes and never treats Team labels as child identities', () => {
  let document = documentFor()
  document = setParentOfflineResources(document, 'link-a', {
    calendar: [{ id: 'calendar-a' }],
    matches: [{ id: 'match-a', teamName: 'Team Amber' }],
    messages: [{ id: 'message-a' }],
    polls: [{ id: 'poll-a' }],
  })
  document = setParentOfflineResources(document, 'link-b', {
    calendar: [{ id: 'calendar-b' }],
    matches: [{ id: 'match-b', teamName: 'Team Blue' }],
    messages: [{ id: 'message-b' }],
    polls: [{ id: 'poll-b' }],
  })
  assert.equal(getParentOfflineResources(document, 'link-a').resources.messages[0].id, 'message-a')
  assert.equal(getParentOfflineResources(document, 'link-b').resources.messages[0].id, 'message-b')
  assert.equal(getParentOfflineResources(document, 'Team Amber'), null)
})

test('selected child survives profile refresh only while the active link still exists', () => {
  let document = setParentOfflineSelection(documentFor(), 'link-b')
  document = setParentOfflineProfile(document, profile())
  assert.equal(document.selectedLinkId, 'link-b')
  const removed = { ...profile(), parentPortalLinks: [profile().parentPortalLinks[0]] }
  document = setParentOfflineProfile(document, removed)
  assert.equal(document.selectedLinkId, 'link-a')
})

test('removed Parent links purge cached child data and reject unsafe pending commands', () => {
  let document = setParentOfflineResources(documentFor(), 'link-b', {
    calendar: [], matches: [], messages: [{ id: 'private-message-b' }], polls: [],
  })
  document = enqueueParentOfflineCommand(document, {
    actorScope: 'parent-a', childScope: 'link-b', entityId: 'private-message-b', payload: {}, type: 'message_read',
  }, { commandId: 'removed-link-command' }).document
  const removed = { ...profile(), parentPortalLinks: [profile().parentPortalLinks[0]] }
  document = setParentOfflineProfile(document, removed)
  assert.equal(getParentOfflineResources(document, 'link-b'), null)
  assert.equal(document.journal[0].status, 'permanently_rejected')
  assert.equal(document.journal[0].lastErrorCategory, 'authority_removed')
})

test('invalid or removed child scope fails closed instead of sharing another child cache', () => {
  assert.throws(() => setParentOfflineResources(documentFor(), 'missing-link', {}), /offline_child_scope_invalid/)
  assert.throws(() => setParentOfflineSelection(documentFor(), 'Team Amber'), /offline_child_scope_invalid/)
})

test('message read and poll vote commands use stable IDs, ordering and durable states', () => {
  let document = documentFor()
  const first = enqueueParentOfflineCommand(document, {
    actorScope: 'parent-a', childScope: 'link-a', entityId: 'message-a', payload: {}, type: 'message_read',
  }, { commandId: 'command-1' })
  document = first.document
  const second = enqueueParentOfflineCommand(document, {
    actorScope: 'parent-a', childScope: 'link-b', entityId: 'poll-b', payload: { optionId: 'option-1' }, type: 'poll_vote',
  }, { commandId: 'command-2' })
  assert.equal(first.command.commandId, first.command.idempotencyKey)
  assert.equal(first.command.localSequence, 1)
  assert.equal(second.command.localSequence, 2)
  assert.equal(second.command.status, 'pending')
  assert.equal(getParentSyncSummary(second.document).waiting, 2)
})

test('double tap with the same semantic command reuses one pending journal entry', () => {
  const input = { actorScope: 'parent-a', childScope: 'link-a', entityId: 'poll-a', payload: { optionId: 'one' }, type: 'poll_vote' }
  const first = enqueueParentOfflineCommand(documentFor(), input, { commandId: 'command-1' })
  const second = enqueueParentOfflineCommand(first.document, input, { commandId: 'command-2' })
  assert.equal(second.command.commandId, 'command-1')
  assert.equal(second.document.journal.length, 1)
})

function queuedDocument(command = {}) {
  return enqueueParentOfflineCommand(documentFor(), {
    actorScope: 'parent-a',
    childScope: 'link-a',
    entityId: 'poll-a',
    payload: { optionId: 'one' },
    type: 'poll_vote',
    ...command,
  }, { commandId: 'command-1' }).document
}

test('successful replay is persisted before completion and duplicate replay is prevented', async () => {
  let document = queuedDocument()
  let executions = 0
  const coordinator = createParentSyncCoordinator({
    execute: async () => { executions += 1 },
    readDocument: async () => document,
    writeDocument: async (_scope, value) => { document = structuredClone(value) },
  })
  const first = await coordinator.sync({ userScope: 'parent-a' })
  const second = await coordinator.sync({ userScope: 'parent-a' })
  assert.equal(executions, 1)
  assert.equal(first.results[0].status, 'succeeded')
  assert.equal(second.results.length, 0)
  assert.equal(document.journal[0].status, 'succeeded')
})

test('process termination during syncing recovers the command and executes it once on restart', async () => {
  let document = queuedDocument()
  document.journal[0].status = 'syncing'
  let executions = 0
  const coordinator = createParentSyncCoordinator({
    execute: async () => { executions += 1 },
    readDocument: async () => structuredClone(document),
    writeDocument: async (_scope, value) => { document = structuredClone(value) },
  })
  await coordinator.sync({ userScope: 'parent-a' })
  assert.equal(executions, 1)
  assert.equal(document.journal[0].status, 'succeeded')
})

test('network failures remain durable with bounded backoff and explicit retry support', async () => {
  let document = queuedDocument()
  let now = Date.parse('2026-08-07T10:00:00.000Z')
  let fail = true
  const coordinator = createParentSyncCoordinator({
    execute: async () => { if (fail) throw new Error('Network request failed') },
    now: () => now,
    random: () => 0,
    readDocument: async () => structuredClone(document),
    writeDocument: async (_scope, value) => { document = structuredClone(value) },
  })
  await coordinator.sync({ userScope: 'parent-a' })
  assert.equal(document.journal[0].status, 'retryable_failure')
  assert.ok(document.journal[0].nextAttemptAt)
  fail = false
  await coordinator.sync({ explicitRetry: true, userScope: 'parent-a' })
  assert.equal(document.journal[0].status, 'succeeded')
})

test('automatic retry stops at the bound while a deliberate retry remains available', async () => {
  let document = queuedDocument()
  document.journal[0] = {
    ...document.journal[0],
    attemptCount: PARENT_OFFLINE_MAX_AUTOMATIC_ATTEMPTS,
    nextAttemptAt: '',
    status: 'retryable_failure',
  }
  let executions = 0
  const coordinator = createParentSyncCoordinator({
    execute: async () => { executions += 1 },
    readDocument: async () => structuredClone(document),
    writeDocument: async (_scope, value) => { document = structuredClone(value) },
  })
  await coordinator.sync({ userScope: 'parent-a' })
  assert.equal(executions, 0)
  await coordinator.sync({ explicitRetry: true, userScope: 'parent-a' })
  assert.equal(executions, 1)
  assert.equal(document.journal[0].status, 'succeeded')
})

test('conflict and authority rejection are retained and surfaced for attention', async () => {
  for (const error of [
    Object.assign(new Error('parent_poll_vote_locked'), { code: '55000' }),
    Object.assign(new Error('parent_poll_unavailable'), { code: '42501' }),
  ]) {
    let document = queuedDocument()
    const coordinator = createParentSyncCoordinator({
      execute: async () => { throw error },
      readDocument: async () => document,
      writeDocument: async (_scope, value) => { document = structuredClone(value) },
    })
    await coordinator.sync({ userScope: 'parent-a' })
    assert.ok(['conflict', 'permanently_rejected'].includes(document.journal[0].status))
    assert.equal(getParentSyncSummary(document).needsAttention, 1)
  }
})

test('error classification distinguishes retryable, conflict and permanent failures', () => {
  assert.equal(classifyParentCommandError(new Error('Failed to fetch')), 'retryable_failure')
  assert.equal(classifyParentCommandError(Object.assign(new Error('locked'), { code: '55000' })), 'conflict')
  assert.equal(classifyParentCommandError(Object.assign(new Error('forbidden'), { status: 403 })), 'permanently_rejected')
})

test('logout clears encrypted cache, journal, pointer and key idempotently', async () => {
  const { keyStore, storage, store } = createStoreHarness()
  await store.write('parent-a', queuedDocument())
  await store.clear()
  await store.clear()
  assert.equal(storage.values.size, 0)
  assert.equal(keyStore.values.size, 0)
  assert.equal((await store.read('parent-a')).document, null)
})

test('runtime integration uses one offline service, network awareness and logout cleanup', async () => {
  const [app, auth, adapter, storageCore] = await Promise.all([
    readFile(path.join(repositoryRoot, 'apps/parent-mobile/App.js'), 'utf8'),
    readFile(path.join(repositoryRoot, 'apps/mobile-core/src/auth.js'), 'utf8'),
    readFile(path.join(repositoryRoot, 'apps/parent-mobile/src/offline.js'), 'utf8'),
    readFile(path.join(repositoryRoot, 'apps/mobile-core/src/offlineStorageCore.js'), 'utf8'),
  ])
  assert.match(app, /NetInfo\.addEventListener/)
  assert.match(app, /Offline\. Showing your last saved information\./)
  assert.match(app, /queueParentMessageRead/)
  assert.match(app, /queueParentPollVote/)
  assert.match(app, /syncParentOfflineCommands/)
  assert.match(app, /offlineProfileStore=\{parentOfflineProfileStore\}/)
  assert.match(auth, /await offlineProfileStore\.clear\(\)/)
  assert.match(auth, /persistedProfile = await offlineProfileStore\.write\(profile\) \|\| profile/)
  assert.match(auth, /setUser\(persistedProfile\)/)
  assert.match(adapter, /xchacha20poly1305/)
  assert.match(adapter, /AFTER_FIRST_UNLOCK_THIS_DEVICE_ONLY/)
  assert.match(storageCore, /authenticated-envelope/)
  assert.doesNotMatch(adapter, /AsyncStorage\.setItem\([^,]+,\s*JSON\.stringify\(profile/)
})

test('existing server RPCs remain authoritative and identical replays converge idempotently', async () => {
  const [messageMigration, pollMigration, dataSource] = await Promise.all([
    readFile(path.join(repositoryRoot, 'supabase/migrations/20260518153000_parent_portal_message_reads.sql'), 'utf8'),
    readFile(path.join(repositoryRoot, 'supabase/migrations/20260720173941_p2_privileged_function_authority_hardening.sql'), 'utf8'),
    readFile(path.join(repositoryRoot, 'apps/mobile-core/src/data.js'), 'utf8'),
  ])
  assert.match(messageMigration, /link\.auth_user_id = auth\.uid\(\)/)
  assert.match(messageMigration, /link\.status = 'active'/)
  assert.match(messageMigration, /on conflict \(parent_link_id, communication_log_id, auth_user_id\)/)
  assert.match(pollMigration, /link\.auth_user_id = actor_id/)
  assert.match(pollMigration, /poll\.status = 'open'/)
  assert.match(pollMigration, /if existing_vote_id is not null then\s+return existing_vote_id;/)
  assert.match(dataSource, /supabase\.rpc\('mark_parent_portal_message_read'/)
  assert.match(dataSource, /supabase\.rpc\('submit_parent_portal_poll_vote'/)
})
