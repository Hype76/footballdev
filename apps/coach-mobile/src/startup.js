import AsyncStorage from '@react-native-async-storage/async-storage'
import { clearBiometricPreference } from '../../mobile-core/src/biometrics'
import { commitMobileRuntimeOwnership, inspectMobileRuntimeOwnership } from '../../mobile-core/src/runtimeState'
import { clearCoachAllLocalState } from './localState'

export async function prepareCoachMobileStartup(config) {
  if (
    config?.appRole !== 'coach'
    || config?.supabaseEnvironment !== 'test'
    || config?.isProduction
    || !config?.isUsable
  ) {
    const error = new Error('coach_test_environment_required')
    error.code = 'COACH_TEST_ENVIRONMENT_REQUIRED'
    throw error
  }

  const ownership = await inspectMobileRuntimeOwnership({ config, storage: AsyncStorage })
  if (ownership.status === 'ready') return { ownership, quarantined: false }

  await Promise.all([
    clearCoachAllLocalState(),
    clearBiometricPreference('coach'),
  ])
  await commitMobileRuntimeOwnership({ ownership, storage: AsyncStorage })
  return { ownership, quarantined: ownership.status === 'incompatible' }
}
