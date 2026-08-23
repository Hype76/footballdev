import AsyncStorage from '@react-native-async-storage/async-storage'
import { clearBiometricPreference } from '../../mobile-core/src/biometrics'
import { shouldClearMobileDevicePreferences } from '../../mobile-core/src/deviceSettingsCore'
import { commitMobileRuntimeOwnership, inspectMobileRuntimeOwnership } from '../../mobile-core/src/runtimeState'
import { quarantineIncompatibleMobileSessionStorage } from '../../mobile-core/src/sessionStorage'
import { clearCoachAllLocalState } from './localState'
import { clearIncompatibleCoachNotificationState } from './notifications'
import { quarantineIncompatibleCoachOfflineState } from './offline'

export async function prepareCoachMobileStartup(config) {
  const productionBoundaryValid = config?.supabaseEnvironment === 'production' && config?.isProduction === true
  const testBoundaryValid = config?.supabaseEnvironment === 'test' && config?.isProduction === false
  if (
    config?.appRole !== 'coach'
    || !config?.isUsable
    || (!productionBoundaryValid && !testBoundaryValid)
  ) {
    const error = new Error('coach_environment_boundary_required')
    error.code = 'COACH_ENVIRONMENT_BOUNDARY_REQUIRED'
    throw error
  }

  const ownership = await inspectMobileRuntimeOwnership({ config, storage: AsyncStorage })
  if (ownership.status === 'ready') return { ownership, quarantined: false }

  const quarantineTasks = [
    quarantineIncompatibleMobileSessionStorage(config),
    quarantineIncompatibleCoachOfflineState(),
    clearIncompatibleCoachNotificationState(config.apiBaseUrl),
  ]
  if (shouldClearMobileDevicePreferences(ownership.status)) {
    quarantineTasks.push(
      clearCoachAllLocalState(),
      clearBiometricPreference('coach'),
    )
  }
  await Promise.all(quarantineTasks)
  await commitMobileRuntimeOwnership({ ownership, storage: AsyncStorage })
  return { ownership, quarantined: true }
}
