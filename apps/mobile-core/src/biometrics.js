import * as LocalAuthentication from 'expo-local-authentication'
import * as SecureStore from 'expo-secure-store'

const LEGACY_BIOMETRIC_ENABLED_KEY = 'football-player-biometric-enabled'

export function getBiometricPreferenceKey(appRole = 'parent') {
  const app = String(appRole || '').trim().toLowerCase()
  if (!['coach', 'parent'].includes(app)) throw new Error('biometric_app_role_invalid')
  return `fp.mobile.biometric.v1.${app}.enabled`
}

export async function getBiometricAvailability() {
  const [hasHardware, isEnrolled, supportedTypes] = await Promise.all([
    LocalAuthentication.hasHardwareAsync(),
    LocalAuthentication.isEnrolledAsync(),
    LocalAuthentication.supportedAuthenticationTypesAsync().catch(() => []),
  ])

  return {
    available: Boolean(hasHardware && isEnrolled),
    hasHardware,
    isEnrolled,
    supportedTypes,
    message: hasHardware && isEnrolled
      ? 'Use Face ID or fingerprint, with your device passcode as a fallback.'
      : hasHardware
        ? 'Set up or allow Face ID or fingerprint in device settings. You can also use your device passcode.'
        : 'Face ID or fingerprint is not currently available. Retry or use your device passcode.',
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
    if (appRole !== 'coach') {
      const availability = await getBiometricAvailability()
      if (!availability.available) throw new Error('Biometric unlock is not available on this device.')
    }

    const result = await LocalAuthentication.authenticateAsync({
      cancelLabel: 'Cancel',
      disableDeviceFallback: false,
      promptMessage: 'Enable biometric unlock',
    })

    if (!result.success) {
      throw new Error(getBiometricFailureMessage(result.error))
    }
  }

  await SecureStore.setItemAsync(getBiometricPreferenceKey(appRole), enabled ? 'true' : 'false')
  return enabled
}

export async function authenticateWithBiometrics(appRole = 'parent') {
  if (appRole !== 'coach') {
    const availability = await getBiometricAvailability()
    if (!availability.available) throw new Error('Biometric unlock is not available on this device.')
  }

  const result = await LocalAuthentication.authenticateAsync({
    cancelLabel: 'Cancel',
    disableDeviceFallback: false,
    promptMessage: 'Unlock Football Player',
  })

  if (!result.success) {
    throw new Error(getBiometricFailureMessage(result.error))
  }

  return true
}

export function getBiometricFailureMessage(code) {
  if (['user_cancel', 'app_cancel', 'system_cancel'].includes(code)) return 'Device authentication was cancelled. Your setting has not changed.'
  if (code === 'passcode_not_set') return 'Set a device passcode in your phone settings, then try again.'
  if (code === 'not_enrolled') return 'Set up Face ID or a fingerprint in your phone settings, then try again.'
  if (code === 'lockout') return 'Unlock your phone with its passcode, then try again.'
  if (code === 'not_available') return 'Allow Face ID or fingerprint for this app in device settings, then try again.'
  return 'Device authentication was not completed. Please try again.'
}
