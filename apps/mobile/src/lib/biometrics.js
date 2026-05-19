import * as LocalAuthentication from 'expo-local-authentication'
import * as SecureStore from 'expo-secure-store'
import { Platform } from 'react-native'

const BIOMETRIC_ENABLED_KEY = 'player-feedback-biometric-enabled'

export async function getBiometricAvailability() {
  if (Platform.OS === 'web') {
    return {
      available: false,
      hasHardware: false,
      isEnrolled: false,
    }
  }

  const [hasHardware, isEnrolled] = await Promise.all([
    LocalAuthentication.hasHardwareAsync(),
    LocalAuthentication.isEnrolledAsync(),
  ])

  return {
    available: Boolean(hasHardware && isEnrolled),
    hasHardware,
    isEnrolled,
  }
}

export async function getBiometricPreference() {
  if (Platform.OS === 'web') {
    return globalThis.localStorage?.getItem(BIOMETRIC_ENABLED_KEY) === 'true'
  }

  return (await SecureStore.getItemAsync(BIOMETRIC_ENABLED_KEY)) === 'true'
}

export async function setBiometricPreference(enabled) {
  if (Platform.OS === 'web') {
    if (enabled) {
      globalThis.localStorage?.setItem(BIOMETRIC_ENABLED_KEY, 'true')
      return
    }

    globalThis.localStorage?.removeItem(BIOMETRIC_ENABLED_KEY)
    return
  }

  if (enabled) {
    await SecureStore.setItemAsync(BIOMETRIC_ENABLED_KEY, 'true')
    return
  }

  await SecureStore.deleteItemAsync(BIOMETRIC_ENABLED_KEY)
}

export async function authenticateWithBiometrics() {
  if (Platform.OS === 'web') {
    return { success: false }
  }

  return LocalAuthentication.authenticateAsync({
    cancelLabel: 'Use password',
    disableDeviceFallback: false,
    promptMessage: 'Unlock Football Player',
  })
}
