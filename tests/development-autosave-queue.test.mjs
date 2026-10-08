import assert from 'node:assert/strict'
import test from 'node:test'
import { createDevelopmentAutosaveQueue, getPendingDevelopmentAutosave } from '../apps/coach-mobile/src/developmentAutosaveQueue.js'

test('a rapid burst writes only the in-flight and newest pending snapshots', async () => {
  let release
  const gate = new Promise(resolve => { release = resolve })
  const writes = [], receipts = []
  const queue = createDevelopmentAutosaveQueue(async input => {
    writes.push(input)
    if (writes.length === 1) await gate
    return { ...input, revision: writes.length }
  }, { scope: 'burst', onSaved: saved => receipts.push(saved) })
  const first = queue.enqueue({ notes: 'a' })
  await Promise.resolve()
  for (let edit = 2; edit <= 16; edit++) queue.enqueue({ notes: 'a'.repeat(edit) })
  const saved = queue.flush()
  assert.equal(getPendingDevelopmentAutosave('burst'), saved)
  assert.equal(queue.isSaving(), true)
  release()
  const result = await saved
  assert.equal(await first, result)
  assert.deepEqual(writes, [{ notes: 'a' }, { notes: 'a'.repeat(16) }])
  assert.equal(result.revision, 2)
  assert.deepEqual(receipts, [result], 'Only the newest durable snapshot receives completion')
  assert.equal(getPendingDevelopmentAutosave('burst'), null)
  assert.equal(queue.isSaving(), false)
})

test('a failed superseded write cannot lose newer input or publish an old failure', async () => {
  let reject
  const gate = new Promise((_resolve, fail) => { reject = fail })
  const failures = [], writes = []
  const queue = createDevelopmentAutosaveQueue(async input => {
    writes.push(input)
    if (writes.length === 1) await gate
    return input
  }, { onError: failure => failures.push(failure) })
  const initial = queue.enqueue({ notes: 'old' })
  await Promise.resolve()
  queue.enqueue({ notes: 'new' })
  reject(new Error('Superseded write failed'))
  assert.deepEqual(await initial, { notes: 'new' })
  assert.deepEqual(failures, [])
})

test('the newest failed write stays retryable and never reports a durable receipt', async () => {
  const failures = [], receipts = []
  let fail = true
  const queue = createDevelopmentAutosaveQueue(async input => {
    if (fail) throw new Error('Disk unavailable')
    return input
  }, { onSaved: saved => receipts.push(saved), onError: failure => failures.push(failure.message) })
  await assert.rejects(queue.enqueue({ notes: 'kept visible' }), /Disk unavailable/)
  assert.equal(queue.isSaving(), false)
  assert.deepEqual(receipts, [])
  assert.deepEqual(failures, ['Disk unavailable'])
  fail = false
  assert.deepEqual(await queue.enqueue({ notes: 'kept visible' }), { notes: 'kept visible' })
  assert.equal(receipts.length, 1)
})

test('pending work outlives the UI but rejects a revoked captured authority', async () => {
  let release
  const gate = new Promise(resolve => { release = resolve })
  let authorised = true
  const writes = []
  const queue = createDevelopmentAutosaveQueue(async input => {
    if (writes.length) assert.ok(authorised, 'Captured authority changed')
    writes.push(input)
    if (writes.length === 1) await gate
    return input
  }, { scope: 'old-player' })
  const result = queue.enqueue({ playerId: 'one', notes: 'first' })
  await Promise.resolve()
  queue.enqueue({ playerId: 'one', notes: 'latest' })
  const hydrationWait = getPendingDevelopmentAutosave('old-player')
  authorised = false
  release()
  await assert.rejects(result, /Captured authority changed/)
  await assert.rejects(hydrationWait, /Captured authority changed/)
  assert.deepEqual(writes, [{ playerId: 'one', notes: 'first' }])
  assert.equal(getPendingDevelopmentAutosave('old-player'), null)
})
