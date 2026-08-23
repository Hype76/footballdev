import { useCallback, useEffect, useState } from 'react'
import { getBiometricAvailability, getBiometricEnabled, setBiometricEnabled } from './biometrics'
import { MOBILE_SETTING_LOAD_STATES } from './deviceSettingsCore'
import { getNativeNotificationDeviceState, initializeMobileNotifications, registerNativePushDevice, revokeNativePushDevice } from './notifications'
import { getAccessToken } from './supabase'

async function readBiometricControlState(appRole = '') {
  const [availability, enabled] = await Promise.all([
    getBiometricAvailability(),
    getBiometricEnabled(appRole),
  ])

  return {
    biometricAvailable: availability.available,
    biometricEnabled: enabled,
  }
}

export function useMobileDeviceControls({
  apiBaseUrl,
  appRole,
  easProjectId,
  notificationDisabledMessage,
  notificationEnabledMessage,
  manageNotifications = true,
  onStatusMessage,
  parentLinkId = '',
  teamId = '',
}) {
  const [biometricEnabled, setBiometricEnabledState] = useState(false)
  const [biometricAvailable, setBiometricAvailable] = useState(false)
  const [biometricStateStatus, setBiometricStateStatus] = useState(MOBILE_SETTING_LOAD_STATES.LOADING)
  const [isUpdatingBiometrics, setIsUpdatingBiometrics] = useState(false)
  const [isRegisteringPush, setIsRegisteringPush] = useState(false)
  const [notificationState, setNotificationState] = useState(null)

  const setMessage = useCallback((message) => {
    if (onStatusMessage) {
      onStatusMessage(message)
    }
  }, [onStatusMessage])

  const refreshBiometricState = useCallback(async () => {
    setBiometricStateStatus(MOBILE_SETTING_LOAD_STATES.LOADING)
    try {
      const nextBiometricState = await readBiometricControlState(appRole)
      setBiometricAvailable(nextBiometricState.biometricAvailable)
      setBiometricEnabledState(nextBiometricState.biometricEnabled)
      setBiometricStateStatus(MOBILE_SETTING_LOAD_STATES.READY)
      return nextBiometricState
    } catch (error) {
      setBiometricStateStatus(MOBILE_SETTING_LOAD_STATES.ERROR)
      throw error
    }
  }, [appRole])

  const refreshNotificationState = useCallback(async () => {
    if (!manageNotifications) return null
    const nextNotificationState = await getNativeNotificationDeviceState({
      appRole,
      parentLinkId,
      teamId,
    })
    setNotificationState(nextNotificationState)
    return nextNotificationState
  }, [appRole, manageNotifications, parentLinkId, teamId])

  useEffect(() => {
    if (!manageNotifications) return undefined
    void initializeMobileNotifications().catch((error) => {
      console.error(error)
    })
    return undefined
  }, [manageNotifications])

  useEffect(() => {
    void refreshBiometricState().catch((error) => {
      console.error(error)
    })
    if (manageNotifications) {
      void refreshNotificationState().catch((error) => {
        console.error(error)
      })
    }
  }, [manageNotifications, refreshBiometricState, refreshNotificationState])

  const enableNotifications = useCallback(async () => {
    if (!manageNotifications) return
    setIsRegisteringPush(true)
    setMessage('')

    try {
      const accessToken = await getAccessToken()
      await registerNativePushDevice({
        accessToken,
        apiBaseUrl,
        appRole,
        easProjectId,
        parentLinkId,
        teamId,
      })
      await refreshNotificationState()
      setMessage(notificationEnabledMessage)
    } catch (error) {
      console.error(error)
      setMessage(error.message || 'Notifications could not be enabled.')
    } finally {
      setIsRegisteringPush(false)
    }
  }, [apiBaseUrl, appRole, easProjectId, manageNotifications, notificationEnabledMessage, parentLinkId, refreshNotificationState, setMessage, teamId])

  const disableNotifications = useCallback(async () => {
    if (!manageNotifications) return
    setIsRegisteringPush(true)
    setMessage('')

    try {
      const accessToken = await getAccessToken()
      await revokeNativePushDevice({
        accessToken,
        apiBaseUrl,
        appRole,
      })
      await refreshNotificationState()
      setMessage(notificationDisabledMessage)
    } catch (error) {
      console.error(error)
      setMessage(error.message || 'Notifications could not be disabled.')
    } finally {
      setIsRegisteringPush(false)
    }
  }, [apiBaseUrl, appRole, manageNotifications, notificationDisabledMessage, refreshNotificationState, setMessage])

  const toggleBiometrics = useCallback(async () => {
    setIsUpdatingBiometrics(true)
    setMessage('')

    try {
      const nextEnabled = await setBiometricEnabled(!biometricEnabled, appRole)
      setBiometricEnabledState(nextEnabled)
      setBiometricStateStatus(MOBILE_SETTING_LOAD_STATES.READY)
      setMessage(nextEnabled ? 'Biometric unlock is enabled.' : 'Biometric unlock is disabled.')
    } catch (error) {
      console.error(error)
      setMessage(error.message || 'Biometric setting could not be updated.')
    } finally {
      setIsUpdatingBiometrics(false)
    }
  }, [appRole, biometricEnabled, setMessage])

  return {
    biometricAvailable,
    biometricEnabled,
    biometricStateStatus,
    disableNotifications,
    enableNotifications,
    isRegisteringPush,
    isUpdatingBiometrics,
    notificationState,
    refreshBiometricState,
    toggleBiometrics,
  }
}
