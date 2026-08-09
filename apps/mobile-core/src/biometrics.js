import * as LocalAuthentication from 'expo-local-authentication'
import * as SecureStore from 'expo-secure-store'

const LEGACY_BIOMETRIC_ENABLED_KEY = 'football-player-biometric-enabled'

export function getBiometricPreferenceKey(appRole = 'parent') {
  const app = String(appRole || '').trim().toLowerCase()
  if (!['coach', 'parent'].includes(app)) throw new Error('biometric_app_role_invalid')
  return `fp.mobile.biometric.v1.${app}.enabled`
}

export async function getBiometricAvailability() {
  const hasHardware = await LocalAuthentication.hasHardwareAsync()
  const isEnrolled = hasHardware ? await LocalAuthentication.isEnrolledAsync() : false
  const supportedTypes = hasHardware ? await LocalAuthentication.supportedAuthenticationTypesAsync() : []

  return {
    available: Boolean(hasHardware && isEnrolled),
    hasHardware,
    isEnrolled,
    supportedTypes,
  }
}

export async function getBiometricEnabled(appRole = 'parent') {
  const key = getBiometricPreferenceKey(appRole)
  let value = await SecureStore.getItemAsync(key)
  if (value === null && appRole === 'parent') {
    value = await SecureStore.getItemAsync(LEGACY_BIOMETRIC_ENABLED_KEY)
    if (value !== null) {
      await SecureStore.setItemAsync(key, value)
      await SecureStore.deleteItemAsync(LEGACY_BIOMETRIC_ENABLED_KEY)
    }
  }
  return value === 'true'
}

export async function clearBiometricPreference(appRole = 'parent') {
  await SecureStore.deleteItemAsync(getBiometricPreferenceKey(appRole))
}

export async function setBiometricEnabled(enabled, appRole = 'parent') {
  if (enabled) {
    const availability = await getBiometricAvailability()

    if (!availability.available) {
      throw new Error('Biometric unlock is not available on this device.')
    }

    const result = await LocalAuthentication.authenticateAsync({
      cancelLabel: 'Cancel',
      disableDeviceFallback: false,
      promptMessage: 'Enable biometric unlock',
    })

    if (!result.success) {
      throw new Error('Biometric authentication was cancelled.')
    }
  }

  await SecureStore.setItemAsync(getBiometricPreferenceKey(appRole), enabled ? 'true' : 'false')
  return enabled
}

export async function authenticateWithBiometrics() {
  const availability = await getBiometricAvailability()

  if (!availability.available) {
    throw new Error('Biometric unlock is not available on this device.')
  }

  const result = await LocalAuthentication.authenticateAsync({
    cancelLabel: 'Cancel',
    disableDeviceFallback: false,
    promptMessage: 'Unlock Football Player',
  })

  if (!result.success) {
    throw new Error('Biometric authentication was not completed.')
  }

  return true
}
