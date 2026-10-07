import assert from 'node:assert/strict'
import test from 'node:test'
import { acceptDurableMobileAction } from '../apps/mobile-core/src/durableMobileAction.js'

function deferred() {
  let resolve
  let reject
  const promise = new Promise((done, fail) => { resolve = done; reject = fail })
  return { promise, resolve, reject }
}

test('phone acceptance finishes under one second while remote work remains pending', async () => {
  const remote = deferred()
  const events = []
  const started = performance.now()
  const accepted = await acceptDurableMobileAction({
    enqueue: async () => { events.push('persisted'); return { commandId: 'vote' } },
    isCurrent: () => true,
    onAccepted: () => events.push('accepted'),
    sync: () => remote.promise,
    onSynced: () => events.push('confirmed'),
  })
  assert.ok(performance.now() - started < 1000)
  assert.deepEqual(events, ['persisted', 'accepted'])
  remote.resolve({ results: [{ commandId: 'vote', status: 'succeeded' }] })
  await accepted.background
  assert.deepEqual(events, ['persisted', 'accepted', 'confirmed'])
})

test('failed persistence never reports acceptance or starts remote work', async () => {
  let accepted = false
  let synced = false
  await assert.rejects(acceptDurableMobileAction({
    enqueue: async () => { throw new Error('disk unavailable') },
    isCurrent: () => true,
    onAccepted: () => { accepted = true },
    sync: () => { synced = true },
  }), /disk unavailable/)
  assert.equal(accepted, false)
  assert.equal(synced, false)
})

test('account or player change while persisting prevents all stale UI callbacks', async () => {
  const persistence = deferred()
  let current = true
  let callbacks = 0
  const action = acceptDurableMobileAction({
    enqueue: () => persistence.promise,
    isCurrent: () => current,
    onAccepted: () => { callbacks += 1 },
    sync: () => { callbacks += 1 },
  })
  current = false
  persistence.resolve({ commandId: 'old-player' })
  await (await action).background
  assert.equal(callbacks, 0)
})

test('a late confirmation cannot update a different scope or superseding action', async () => {
  const remote = deferred()
  let current = true
  let confirmations = 0
  const action = await acceptDurableMobileAction({
    enqueue: async () => ({ commandId: 'old' }),
    isCurrent: () => current,
    onAccepted: () => {},
    sync: () => remote.promise,
    onSynced: () => { confirmations += 1 },
  })
  current = false
  remote.resolve({ results: [] })
  await action.background
  assert.equal(confirmations, 0)
})

test('remote failure retains local acceptance and exposes retry without throwing later', async () => {
  const events = []
  const action = await acceptDurableMobileAction({
    enqueue: async () => ({ commandId: 'saved' }),
    isCurrent: () => true,
    onAccepted: () => events.push('phone-saved'),
    sync: async () => { throw new Error('offline') },
    onSynced: () => events.push('server-saved'),
    onSyncError: () => events.push('retry'),
  })
  await action.background
  assert.deepEqual(events, ['phone-saved', 'retry'])
})
