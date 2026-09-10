import assert from 'node:assert/strict'
import test from 'node:test'
import { readFile } from 'node:fs/promises'
import vm from 'node:vm'

const source = (await readFile('apps/mobile-core/src/biometrics.js', 'utf8')).replace(/^import .*$/gm, '').replace(/export /g, '')
function fixture() {
  const state = { hardware: false, enrolled: false, result: { success: true }, prompts: [], saved: new Map() }
  const context = vm.createContext({ LocalAuthentication: {
    hasHardwareAsync: async () => state.hardware, isEnrolledAsync: async () => state.enrolled,
    supportedAuthenticationTypesAsync: async () => [],
    authenticateAsync: async options => { state.prompts.push(options); return state.result },
  }, SecureStore: {
    getItemAsync: async key => state.saved.get(key) ?? null,
    setItemAsync: async (key, value) => state.saved.set(key, value), deleteItemAsync: async key => state.saved.delete(key),
  } })
  vm.runInContext(source, context)
  return { state, context }
}
test('Coach asks native authentication even after an unavailable probe, permits device passcode and saves only success', async () => {
  const { state, context } = fixture()
  assert.equal((await context.getBiometricAvailability()).available, false)
  assert.equal(await context.setBiometricEnabled(true, 'coach'), true)
  assert.equal(state.prompts[0].disableDeviceFallback, false)
  assert.equal(state.saved.get('fp.mobile.biometric.v1.coach.enabled'), 'true')
  assert.equal(await context.authenticateWithBiometrics('coach'), true)
})
test('native cancellation or failure cannot enable or unlock Coach', async () => {
  for (const error of ['user_cancel', 'not_available', 'lockout', 'passcode_not_set']) {
    const { state, context } = fixture()
    state.result = { success: false, error }
    await assert.rejects(context.setBiometricEnabled(true, 'coach'))
    await assert.rejects(context.authenticateWithBiometrics('coach'))
    assert.equal(state.saved.size, 0)
  }
})
test('Parent hardware gate and app-specific preferences remain independent', async () => {
  const { state, context } = fixture()
  await assert.rejects(context.setBiometricEnabled(true, 'parent'), /not available/)
  assert.equal(state.prompts.length, 0)
  state.hardware = state.enrolled = true
  await context.setBiometricEnabled(true, 'parent')
  await context.setBiometricEnabled(false, 'coach')
  assert.equal(await context.getBiometricEnabled('parent'), true)
  assert.equal(await context.getBiometricEnabled('coach'), false)
})
