import test from 'node:test'
import assert from 'node:assert/strict'
import { revokeSavedLiveMatchFollows } from '../apps/mobile-core/src/liveMatchSignOutCore.js'

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
