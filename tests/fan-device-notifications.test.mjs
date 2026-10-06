import assert from 'node:assert/strict'
import test from 'node:test'
import { readFanDeviceNotifications as read, enableFanDeviceNotifications as enable, disableFanDeviceNotifications as disable, fanNotificationPreferenceKey as preferenceKey } from '../apps/parent-mobile/src/fanDeviceNotifications.js'

function fixture() {
  const state = { permission: { status: 'granted', canAskAgain: true }, token: 'ExpoPushToken[current]', storage: new Map(), registered: new Set(), requests: [], prompts: 0, tokenReads: [], failRegister: false, failUnregister: false }
  const services = {
    userId: 'account-a', apiBaseUrl: 'https://example.test', projectId: 'project-test',
    notifications: {
      getPermissionsAsync: async () => state.permission,
      requestPermissionsAsync: async () => { state.prompts++; return state.permission },
      getExpoPushTokenAsync: async options => { state.tokenReads.push(options); return { data: state.token } },
    },
    secureStore: { getItemAsync: async key => state.storage.get(key) || null, setItemAsync: async (key, value) => { state.storage.set(key, value) }, deleteItemAsync: async key => { state.storage.delete(key) } },
    request: async body => {
      state.requests.push(body)
      const key = `${services.userId}:${body.token}`
      if (body.action === 'register_device') { if (state.failRegister) throw Error('Registration failed'); state.registered.add(key); return { success: true } }
      if (body.action === 'unregister_device') { if (state.failUnregister) throw Error('Could not disable'); state.registered.delete(key); return { success: true } }
      return { registered: state.registered.has(key) }
    },
  }
  const preference = () => JSON.parse(state.storage.get(preferenceKey(services)))
  return { state, services, preference }
}

test('permission alone and another account legacy token never opt an account in', async () => {
  const { state, services } = fixture()
  assert.equal((await read(services)).status, 'not_registered')
  state.storage.set('fan-notification-device', 'ExpoPushToken[other]')
  state.registered.add('account-b:ExpoPushToken[other]')
  assert.equal((await read(services)).status, 'not_registered')
  assert.equal(state.tokenReads.length, 0)
  assert.equal(state.prompts, 0)
  assert.equal(state.requests.some(body => body.action === 'register_device'), false)
})

test('legacy registration migrates only after ownership readback, then replaces its stale token', async () => {
  const { state, services, preference } = fixture()
  state.storage.set('fan-notification-device', 'ExpoPushToken[old]')
  state.registered.add('account-a:ExpoPushToken[old]')
  assert.equal((await read(services)).status, 'enabled')
  assert.deepEqual(preference(), { enabled: true, tokens: [state.token], legacyToken: state.token })
  assert.deepEqual([...state.registered], [`account-a:${state.token}`])
  assert.equal(state.storage.get('fan-notification-device'), state.token)
  assert.equal(state.prompts, 0)
})

test('restart after server invalid-token cleanup restores the saved choice without prompting', async () => {
  const { state, services } = fixture()
  await enable(services)
  state.registered.clear()
  state.requests = []
  assert.equal((await read({ ...services })).status, 'enabled')
  assert.deepEqual(state.requests.map(body => body.action), ['device_status', 'register_device', 'device_status'])
  assert.equal(state.prompts, 0)
})

test('token rotation converts the native token and removes previous registered tokens', async () => {
  const { state, services, preference } = fixture()
  await enable(services)
  state.token = 'ExpoPushToken[rotated]'
  const nativeToken = { type: 'ios', data: 'native-apns-token' }
  assert.equal((await read(services, nativeToken)).status, 'enabled')
  assert.deepEqual(state.tokenReads.at(-1), { projectId: 'project-test', devicePushToken: nativeToken })
  assert.deepEqual([...state.registered], [`account-a:${state.token}`])
  assert.deepEqual(preference().tokens, [state.token])
  assert.equal(state.storage.get('fan-notification-device'), state.token, 'Rollback readers receive the verified current token')
})

test('an explicit pause survives restart and token change', async () => {
  const { state, services, preference } = fixture()
  await enable(services)
  assert.equal((await disable(services)).status, 'paused')
  const tokenReads = state.tokenReads.length
  state.token = 'ExpoPushToken[new]'
  assert.equal((await read(services)).status, 'paused')
  assert.equal(preference().enabled, false)
  assert.equal(state.tokenReads.length, tokenReads)
  assert.equal(state.registered.size, 0)
  assert.equal(state.storage.has('fan-notification-device'), false, 'Rollback readers cannot restore a deliberate pause')
})

test('a pause in the older rollback client is respected when returning to the fix', async () => {
  const { state, services, preference } = fixture()
  await enable(services)
  const oldClientToken = state.storage.get('fan-notification-device')
  assert.equal((await services.request({ action: 'device_status', token: oldClientToken })).registered, true)
  await services.request({ action: 'unregister_device', token: oldClientToken })
  state.storage.delete('fan-notification-device')
  const tokenReads = state.tokenReads.length
  assert.equal((await read(services)).status, 'paused')
  assert.equal(preference().enabled, false)
  assert.equal(state.tokenReads.length, tokenReads)
  assert.equal(state.registered.size, 0)
})

test('failed unregister retains the opt-out and token ledger, then retries cleanup without enabling', async () => {
  const { state, services, preference } = fixture()
  await enable(services)
  state.failUnregister = true
  await assert.rejects(disable(services), /Could not disable/)
  assert.deepEqual(preference(), { enabled: false, tokens: [state.token] })
  assert.equal(state.storage.has('fan-notification-device'), false, 'Even failed cleanup keeps the rollback reader paused')
  state.failUnregister = false
  assert.equal((await read(services)).status, 'paused')
  assert.equal(state.registered.size, 0)
  assert.deepEqual(preference().tokens, [])
})

test('OS permission denial preserves the saved opt-in and restoration waits until allowed', async () => {
  const { state, services, preference } = fixture()
  await enable(services)
  state.permission = { status: 'denied', canAskAgain: false }
  state.registered.clear()
  assert.deepEqual(await read(services), { status: 'off', canAskAgain: false })
  assert.equal(preference().enabled, true)
  assert.equal(state.registered.size, 0)
  state.permission = { status: 'granted' }
  assert.equal((await read(services)).status, 'enabled')
  assert.equal(state.prompts, 0)
})

for (const iosStatus of [2, 3, 4]) test(`iOS authorisation ${iosStatus} is accepted without permission prompts`, async () => {
  const { state, services } = fixture()
  state.permission = { status: 'undetermined', ios: { status: iosStatus } }
  const result = await enable(services)
  assert.equal(result.status, 'enabled')
  assert.equal(result.quiet, iosStatus === 3)
  assert.equal(state.prompts, 0)
})

test('explicit enable requests permission only when necessary, and denied permission does not persist opt-in', async () => {
  const { state, services } = fixture()
  state.permission = { status: 'denied' }
  await assert.rejects(enable(services), /phone settings/)
  assert.equal(state.prompts, 1)
  assert.equal(state.storage.has(preferenceKey(services)), false)
})

test('offline registration retains explicit consent and a later read retries registration', async () => {
  const { state, services, preference } = fixture()
  state.failRegister = true
  await assert.rejects(enable(services), /Registration failed/)
  assert.equal(preference().enabled, true)
  state.failRegister = false
  assert.equal((await read(services)).status, 'enabled')
  assert.equal(state.prompts, 0)
})

test('server readback must confirm registration before reporting enabled', async () => {
  const { services } = fixture()
  await assert.rejects(enable({ ...services, request: async () => ({ registered: false }) }), /could not be confirmed/)
})

test('account and API environment each isolate stored consent', async () => {
  const { state, services } = fixture()
  await enable(services)
  const tokenReads = state.tokenReads.length
  const otherScopeRequest = async body => {
    assert.equal(body.action, 'device_status', 'An unregistered account/environment cannot register without consent')
    return { registered: false }
  }
  assert.equal((await read({ ...services, userId: 'account-b', request: otherScopeRequest })).status, 'not_registered')
  assert.equal((await read({ ...services, apiBaseUrl: 'https://other.test', request: otherScopeRequest })).status, 'not_registered')
  assert.equal(state.tokenReads.length, tokenReads)
  assert.equal((await read({ ...services, apiBaseUrl: services.apiBaseUrl + '/' })).status, 'enabled')
  assert.equal(state.prompts, 0)
})

test('an account switch during SDK token lookup prevents stale registration', async () => {
  const { state, services } = fixture()
  await enable(services)
  state.requests = []
  let current = true
  const changed = { ...services, isCurrent: () => current, notifications: { ...services.notifications, getExpoPushTokenAsync: async () => { current = false; return { data: 'ExpoPushToken[stale]' } } } }
  await assert.rejects(read(changed), /account changed/)
  assert.deepEqual(state.requests, [])
})

test('a pause queued during registration wins and removes every attempted token', async () => {
  const { state, services, preference } = fixture()
  let release, started
  const waiting = new Promise(resolve => { started = resolve })
  const original = services.request
  services.request = async body => {
    if (body.action === 'register_device') { started(); await new Promise(resolve => { release = resolve }) }
    return original(body)
  }
  const enabling = enable(services)
  await waiting
  const pausing = disable(services)
  release()
  await enabling
  assert.equal((await pausing).status, 'paused')
  assert.equal(preference().enabled, false)
  assert.equal(state.registered.size, 0)
})

test('corrupt preferences cannot silently grant consent', async () => {
  const { state, services } = fixture()
  state.storage.set(preferenceKey(services), '{"enabled":"yes","tokens":[]}')
  await assert.rejects(read(services), /preferences could not be checked/)
  assert.equal(state.tokenReads.length, 0)
})
