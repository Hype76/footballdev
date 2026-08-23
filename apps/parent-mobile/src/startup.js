import AsyncStorage from '@react-native-async-storage/async-storage'
import { clearBiometricPreference } from '../../mobile-core/src/biometrics'
import { shouldClearMobileDevicePreferences } from '../../mobile-core/src/deviceSettingsCore'
import { commitMobileRuntimeOwnership, inspectMobileRuntimeOwnership } from '../../mobile-core/src/runtimeState'
import { quarantineIncompatibleMobileSessionStorage } from '../../mobile-core/src/sessionStorage'
import { quarantineIncompatibleParentOfflineState } from './offline'
import { clearIncompatibleParentNotificationState } from './notifications'

export async function prepareParentMobileStartup(config) {
  const ownership = await inspectMobileRuntimeOwnership({ config, storage: AsyncStorage })
  if (ownership.status === 'ready') return { ownership, quarantined: false }

  const quarantineTasks = [
    quarantineIncompatibleMobileSessionStorage(config),
    quarantineIncompatibleParentOfflineState(),
    clearIncompatibleParentNotificationState(config.apiBaseUrl),
  ]
  if (shouldClearMobileDevicePreferences(ownership.status)) {
    quarantineTasks.push(clearBiometricPreference())
  }
  await Promise.all(quarantineTasks)
  await commitMobileRuntimeOwnership({ ownership, storage: AsyncStorage })
  return { ownership, quarantined: true }
}
