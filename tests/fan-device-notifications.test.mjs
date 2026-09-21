import assert from 'node:assert/strict'
import test from 'node:test'
import { readFanDeviceNotifications, enableFanDeviceNotifications, disableFanDeviceNotifications } from '../apps/parent-mobile/src/fanDeviceNotifications.js'

function fixture() {
  const state = { permission: { status: 'granted', canAskAgain: true }, token: null, registered: false, requests: [], registrationFails: false }
  const services = {
    notifications: { getPermissionsAsync: async () => state.permission, requestPermissionsAsync: async () => state.permission, getExpoPushTokenAsync: async () => ({ data: 'ExpoPushToken[test-device]' }) },
    secureStore: { getItemAsync: async () => state.token, setItemAsync: async (_key, value) => { state.token = value }, deleteItemAsync: async () => { state.token = null } },
    request: async body => { state.requests.push(body); if (body.action === 'register_device') { if (state.registrationFails) throw Error('Registration failed'); state.registered = true; return { success: true } } if (body.action === 'unregister_device') { state.registered = false; return { success: true } } return { registered: state.registered } },
  }
  return { state, services }
}

test('Phone status requires permission and current account registration, not the player alert preference', async () => {
  const { state, services } = fixture()
  assert.equal((await readFanDeviceNotifications(services)).status, 'not_registered')
  state.token = 'ExpoPushToken[test-device]'
  assert.equal((await readFanDeviceNotifications(services)).status, 'not_registered')
  state.registered = true
  assert.equal((await readFanDeviceNotifications(services)).status, 'enabled')
  state.permission = { status: 'denied', canAskAgain: false }
  assert.deepEqual(await readFanDeviceNotifications(services), { status: 'off', canAskAgain: false })
  state.permission = { status: 'granted' }
  assert.equal((await readFanDeviceNotifications(services)).status, 'enabled')
  state.registered = false
  assert.equal((await readFanDeviceNotifications(services)).status, 'not_registered')
})

test('Enabling updates status only after permission, registration and server readback succeed', async () => {
  const { state, services } = fixture()
  assert.equal((await enableFanDeviceNotifications(services)).status, 'enabled')
  assert.deepEqual(state.requests.map(item => item.action), ['register_device', 'device_status'])
  state.registrationFails = true
  await assert.rejects(enableFanDeviceNotifications(services), /Registration failed/)
  state.permission = { status: 'denied' }
  await assert.rejects(enableFanDeviceNotifications(services), /phone settings/)
  state.permission = { status: 'granted' }
  await assert.rejects(enableFanDeviceNotifications({ ...services, request: async () => ({ success: true, registered: false }) }), /could not be confirmed/)
})

test('Disabling removes the registered device before clearing its local token', async () => {
  const { state, services } = fixture()
  await enableFanDeviceNotifications(services)
  assert.equal((await disableFanDeviceNotifications(services)).status, 'not_registered')
  assert.equal(state.token, null)
  assert.equal(state.registered, false)
  assert.deepEqual(state.requests.slice(-1), [{ action: 'unregister_device', token: 'ExpoPushToken[test-device]' }])
})

test('A failed unregister keeps the local token so the enabled state can be retried', async () => {
  const { state, services } = fixture()
  await enableFanDeviceNotifications(services)
  const failingServices = { ...services, request: async body => { if (body.action === 'unregister_device') throw Error('Could not disable'); return services.request(body) } }
  await assert.rejects(disableFanDeviceNotifications(failingServices), /Could not disable/)
  assert.equal(state.token, 'ExpoPushToken[test-device]')
})
