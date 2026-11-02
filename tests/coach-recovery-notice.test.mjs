import assert from 'node:assert/strict'
import test from 'node:test'
import { createCoachRecoveryNotice } from '../apps/coach-mobile/src/coachRecoveryNotice.js'

test('recovery notice survives sign-out and restart, and ignores ordinary connection failures', async () => {
  const values = new Map()
  const storage = { getItem: async key => values.get(key), setItem: async (key, value) => values.set(key, value) }
  const first = createCoachRecoveryNotice(storage, 'recovery')
  const messages = []
  const unsubscribe = first.subscribe(value => messages.push(value))
  first.report(new Error('network unavailable'))
  assert.equal(messages.length, 0)
  first.report(new Error('offline_legacy_recovery_required'))
  assert.match(messages[0], /Keep app data and contact support/)
  unsubscribe()
  await Promise.resolve()
  const nextLaunch = createCoachRecoveryNotice(storage, 'recovery')
  const restored = []
  nextLaunch.subscribe(value => restored.push(value))
  await nextLaunch.load()
  assert.match(restored[0], /Reference: RECOVERY/)
})

test('a failed marker write still immediately warns the current app session', async () => {
  const notice = createCoachRecoveryNotice({ getItem: async () => null, setItem: async () => { throw new Error('full') } }, 'recovery')
  const messages = []
  notice.subscribe(value => messages.push(value))
  notice.report({ status: 'corrupt' })
  assert.equal(messages.length, 1)
  await Promise.resolve()
})
