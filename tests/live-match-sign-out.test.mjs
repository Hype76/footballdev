import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
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

test('forced authentication loss cancels a pending follow before it can show a display', async () => {
  const barrier = createLiveMatchStartBarrier()
  let finishRegistration
  const registration = new Promise(resolve => { finishRegistration = resolve })
  let shown = false
  const generation = barrier.generation('coach')
  const start = barrier.start('coach', 'match-1', async () => {
    await registration
    barrier.check('coach', generation)
    shown = true
  })
  const forcedLoss = barrier.beforeSignOut('coach')
  finishRegistration()
  await assert.rejects(start, /signed out/)
  await forcedLoss
  assert.equal(shown, false)
  barrier.allow('coach')
  assert.throws(() => barrier.check('coach', generation), /signed out/)
})

test('actual Android follow never saves or displays after forced session loss during registration', async () => {
  const source = readFileSync(new URL('../apps/mobile-core/src/liveMatchFollow.js', import.meta.url), 'utf8')
  const startSource = source.slice(source.indexOf('async function startLiveMatchFollow('), source.indexOf('export async function stopLiveMatchFollow('))
  const barrier = createLiveMatchStartBarrier()
  const saved = [], shown = [], revoked = []
  let finishRegistration, reachedRegistration
  const registrationReached = new Promise(resolve => { reachedRegistration = resolve })
  const registration = new Promise(resolve => { finishRegistration = resolve })
  const deps = {
    startBarrier: barrier,
    getMobileRuntimeConfig: () => ({ isUsable: true, appRole: 'coach', easProjectId: 'test' }),
    supabase: { auth: { getUser: async () => ({ data: { user: { id: 'coach-1' } } }) }, rpc: async name => {
      if (name === 'follow_live_match') { reachedRegistration(); await registration; return { data: 'follow-1' } }
      revoked.push(name); return { error: null }
    } },
    confirmedMatch: async () => ({ id: 'match-1' }),
    createLiveMatchState: () => ({ end: false }),
    Platform: { OS: 'android' },
    Notifications: { getPermissionsAsync: async () => ({ granted: true }), getExpoPushTokenAsync: async () => ({ data: 'push-token' }) },
    AsyncStorage: { setItem: async (...args) => { saved.push(args) }, removeItem: async () => {} },
    showLiveMatchNotification: async (...args) => { shown.push(args) },
    hideLiveMatchNotification: async () => {},
    keyFor: () => 'saved-follow',
    iosActivity: null,
  }
  const startFollow = new Function(...Object.keys(deps), `${startSource}; return startLiveMatchFollow`)(...Object.values(deps))
  const start = barrier.start('coach', 'match-1', () => startFollow('coach', 'match-1'))
  await registrationReached
  const forcedLoss = barrier.beforeSignOut('coach')
  finishRegistration()
  await assert.rejects(start, /signed out/)
  await forcedLoss
  assert.equal(saved.length, 0)
  assert.equal(shown.length, 0)
  assert.deepEqual(revoked, ['stop_following_live_match'])
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
