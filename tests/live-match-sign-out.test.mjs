import test from 'node:test'
import assert from 'node:assert/strict'
import { createLiveMatchStartBarrier, reconcileSavedLiveMatchFollow, revokeSavedLiveMatchFollows } from '../apps/mobile-core/src/liveMatchSignOutCore.js'

test('sign-out waits for a registering follow and revokes its saved ID', async () => {
  const barrier = createLiveMatchStartBarrier()
  const saved = new Map()
  let finishRegistration
  const registration = new Promise(resolve => { finishRegistration = resolve })
  const start = barrier.start('parent', 'match-1', async () => {
    await registration
    saved.set('match-1', { followId: 'new-follow' })
  })
  assert.equal(barrier.start('parent', 'match-1', () => { throw new Error('duplicate start') }), start)
  const events = []
  const signOut = (async () => {
    await barrier.beforeSignOut('parent')
    await revokeSavedLiveMatchFollows({
      keys: [...saved.keys()], read: async key => saved.get(key),
      revoke: async id => { events.push(`revoke:${id}`); return { error: null } },
      finish: async () => { events.push('finish') },
      remove: async keys => { keys.forEach(key => saved.delete(key)); events.push('remove') },
    })
  })()
  await assert.rejects(barrier.start('parent', 'match-2', async () => {}), /Sign-out is in progress/)
  assert.deepEqual(events, [])
  finishRegistration()
  await signOut
  assert.deepEqual(events, ['revoke:new-follow', 'finish', 'remove'])
  assert.equal(saved.size, 0)
  barrier.allow('parent')
  await barrier.start('parent', 'match-2', async () => {})
})

test('sign-out revokes every saved server follow before removing local matches', async () => {
  const events = []
  const keys = ['first', 'second']
  await revokeSavedLiveMatchFollows({
    keys,
    read: async key => ({ followId: key }),
    revoke: async id => { events.push(`revoke:${id}`); return { error: null } },
    finish: async () => { events.push('finish') },
    remove: async entries => { assert.deepEqual(entries, keys); events.push('remove') },
  })
  assert.deepEqual(events, ['revoke:first', 'revoke:second', 'finish', 'remove'])
})

test('failed server revocation keeps local follow IDs for a later retry', async () => {
  const events = []
  const settings = {
    keys: ['first', 'second'],
    read: async key => ({ followId: key }),
    revoke: async id => {
      events.push(`revoke:${id}`)
      return { error: id === 'second' ? new Error('offline') : null }
    },
    finish: async () => { events.push('finish') },
    remove: async () => { events.push('remove') },
  }
  await assert.rejects(revokeSavedLiveMatchFollows(settings), /offline/)
  assert.deepEqual(events, ['revoke:first', 'revoke:second'])
  settings.revoke = async id => { events.push(`retry:${id}`); return { error: null } }
  await revokeSavedLiveMatchFollows(settings)
  assert.deepEqual(events.slice(2), ['retry:first', 'retry:second', 'finish', 'remove'])
})

test('a follow from a revoked session is cleared when the account signs in again', async () => {
  const saved = { followId: 'old-session' }
  let cleared = false
  const stale = await reconcileSavedLiveMatchFollow(saved, {
    check: async () => false,
    clear: async () => { cleared = true },
  })
  assert.equal(stale, null)
  assert.equal(cleared, true)
  const offline = await reconcileSavedLiveMatchFollow(saved, {
    check: async () => { throw new Error('offline') },
    clear: async () => { throw new Error('must keep saved work') },
  })
  assert.equal(offline, saved)
})
