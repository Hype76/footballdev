import test from 'node:test'
import assert from 'node:assert/strict'
import { createNotificationReminderController, notificationReminderKey, shouldShowNotificationReminder } from '../apps/mobile-core/src/notificationReminderCore.js'

const off = { enabled: false, registered: false, permissionGranted: false, detailLevel: 'off' }
const on = { enabled: true, registered: true, permissionGranted: true, detailLevel: 'minimal' }
const options = { appRole: 'coach', userId: 'user-a', state: off, status: 'ready' }
function fixture(storageValues = new Map()) {
  const events = [], writes = []
  const storage = { read: async key => storageValues.get(key), write: async (key, value) => { writes.push(key); storageValues.set(key, value) } }
  return { events, writes, storage, controller: createNotificationReminderController({ storage, onChange: event => events.push(event) }) }
}
test('first login explains disabled alerts once and dismissal survives another visit', async () => {
  const values = new Map(), first = fixture(values), key = notificationReminderKey('coach', 'user-a')
  await first.controller.check(options)
  assert.deepEqual(first.events.at(-1), { key, visible: true })
  assert.equal(first.controller.dismiss(key), true)
  assert.equal(first.controller.dismiss(key), false)
  await first.controller.check(options)
  assert.equal(first.events.at(-1).visible, false)
  const second = fixture(values)
  await second.controller.check(options)
  assert.equal(second.events.at(-1).visible, false)
  assert.equal(first.writes.length, 1)
})
test('enabled alerts do not prompt, and a later opt-out does not create a first-login prompt', async () => {
  const f = fixture()
  await f.controller.check({ ...options, state: on })
  await f.controller.check(options)
  assert.equal(f.events.at(-1).visible, false)
  assert.equal(f.writes.length, 1)
})
for (const change of [{ status: 'loading' }, { status: 'error' }, { status: 'stale' }, { state: null }, { state: [] }, { offline: true }, { busy: true }]) test(`unconfirmed or busy notification state cannot prompt: ${JSON.stringify(change)}`, async () => {
  const f = fixture()
  await f.controller.check({ ...options, ...change })
  assert.equal(f.events.at(-1).visible, false)
  assert.equal(f.writes.length, 0)
})
test('account and app reminders are independent', async () => {
  const f = fixture(), key = notificationReminderKey('coach', 'user-a')
  await f.controller.check(options); f.controller.dismiss(key)
  await f.controller.check({ ...options, userId: 'user-b' })
  assert.equal(f.events.at(-1).visible, true)
  await f.controller.check({ ...options, appRole: 'parent' })
  assert.equal(f.events.at(-1).visible, true)
  assert.notEqual(f.events.at(-1).key, key)
})
test('a context remount cannot repeat dismissal while the device write is still pending', async () => {
  const completed = new Set(), events = []
  const storage = { read: async () => null, write: () => new Promise(() => {}) }
  const first = createNotificationReminderController({ storage, completed, onChange: event => events.push(event) })
  await first.check(options); first.dismiss(notificationReminderKey('coach', 'user-a')); first.dispose()
  const second = createNotificationReminderController({ storage, completed, onChange: event => events.push(event) })
  await second.check(options)
  assert.equal(events.at(-1).visible, false)
})
test('late storage reads cannot reopen the previous account or an unmounted screen', async () => {
  const pending = [], events = []
  const f = createNotificationReminderController({ storage: { read: () => new Promise(resolve => pending.push(resolve)), write: async () => {} }, onChange: event => events.push(event) })
  const old = f.check(options), current = f.check({ ...options, userId: 'user-b' })
  pending[0](null); await old
  assert.equal(events.at(-1).visible, false)
  f.dispose(); pending[1](null); await current
  assert.equal(events.at(-1).visible, false)
  assert.equal(f.dismiss(notificationReminderKey('coach', 'user-a')), false)
})
test('storage failures do not block the app or repeatedly reopen a dismissed reminder in the same visit', async () => {
  const events = [], readFailure = createNotificationReminderController({ storage: { read: async () => { throw Error('locked') }, write: async () => {} }, onChange: event => events.push(event) })
  await readFailure.check(options); assert.equal(events.at(-1).visible, false)
  const f = createNotificationReminderController({ storage: { read: async () => null, write: async () => { throw Error('locked') } }, onChange: event => events.push(event) })
  await f.check(options); assert.equal(f.dismiss(notificationReminderKey('coach', 'user-a')), true)
  await f.check(options); assert.equal(events.at(-1).visible, false)
})
test('quiet/provisional or unregistered alerts still need first-login guidance', () => {
  assert.equal(shouldShowNotificationReminder({ ...options, state: { ...on, visibleAlertsReady: false } }), true)
  assert.equal(shouldShowNotificationReminder({ ...options, state: { ...on, registered: false } }), true)
  assert.equal(notificationReminderKey('coach', '../other user'), null)
  assert.equal(notificationReminderKey('unknown', 'user-a'), null)
})
