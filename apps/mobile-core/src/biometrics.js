import * as LocalAuthentication from 'expo-local-authentication'
import * as SecureStore from 'expo-secure-store'

const BIOMETRIC_ENABLED_KEY = 'football-player-biometric-enabled'

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

export async function getBiometricEnabled() {
  const value = await SecureStore.getItemAsync(BIOMETRIC_ENABLED_KEY)
  return value === 'true'
}

export async function setBiometricEnabled(enabled) {
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

  await SecureStore.setItemAsync(BIOMETRIC_ENABLED_KEY, enabled ? 'true' : 'false')
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
