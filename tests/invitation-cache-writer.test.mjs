import assert from 'node:assert/strict'
import test from 'node:test'
import { createInvitationCacheWriter } from '../apps/mobile-core/src/invitationCacheWriter.js'
const deferred = () => { let resolve; const promise = new Promise(done => { resolve = done }); return { promise, resolve } }

test('invitation cache serialises writes, coalesces intermediate snapshots and skips unchanged rows', async () => {
  const gate = deferred(), writes = [], confirmed = []
  const writer = createInvitationCacheWriter({ isCurrent: () => true, onSaved: job => confirmed.push(job.key), onFailure: () => assert.fail('Unexpected cache failure') })
  const job = key => ({ key, snapshot: key, write: async value => { writes.push(value); if (value === 'first') await gate.promise } })
  const saving = writer.schedule(job('first'))
  writer.schedule(job('intermediate')); writer.schedule(job('latest'))
  assert.deepEqual(writes, ['first'])
  gate.resolve(); await saving
  assert.deepEqual(writes, ['first', 'latest']); assert.deepEqual(confirmed, ['latest'])
  await writer.schedule(job('latest')); assert.deepEqual(writes, ['first', 'latest'])
})

test('failed invitation cache retains the latest retry without refetching the network', async () => {
  let fail = true, writes = 0
  const failures = [], saved = []
  const writer = createInvitationCacheWriter({ isCurrent: () => true, onSaved: job => saved.push(job.key), onFailure: job => failures.push(job.key) })
  await writer.schedule({ key: 'all-17-invites', snapshot: { rows: Array(17).fill('invite') }, write: async () => { writes++; if (fail) throw Error('Storage unavailable') } })
  assert.deepEqual(failures, ['all-17-invites']); assert.deepEqual(saved, [])
  fail = false; await writer.retry()
  assert.equal(writes, 2); assert.deepEqual(saved, ['all-17-invites'])
})

test('a superseded or inactive cache writer cannot publish old failure or start queued work', async () => {
  const gate = deferred(), writes = [], notices = []
  let current = true
  const writer = createInvitationCacheWriter({ isCurrent: () => current, onSaved: () => notices.push('saved'), onFailure: () => notices.push('failed') })
  const saving = writer.schedule({ key: 'old', snapshot: {}, write: async () => { writes.push('old'); await gate.promise; throw Error('Late failure') } })
  writer.schedule({ key: 'new', snapshot: {}, write: async () => writes.push('new') })
  current = false; gate.resolve(); await saving; await writer.retry()
  assert.deepEqual(writes, ['old']); assert.deepEqual(notices, [])
})
