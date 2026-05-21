import { useCallback, useEffect, useState } from 'react'
import { getBiometricAvailability, getBiometricEnabled, setBiometricEnabled } from './biometrics'
import { getNativeNotificationDeviceState, initializeMobileNotifications, registerNativePushDevice, revokeNativePushDevice } from './notifications'
import { getAccessToken } from './supabase'

async function readDeviceControlState() {
  const [availability, enabled, notificationState] = await Promise.all([
    getBiometricAvailability(),
    getBiometricEnabled(),
    getNativeNotificationDeviceState(),
  ])

  return {
    biometricAvailable: availability.available,
    biometricEnabled: enabled,
    notificationState,
  }
}

export function useMobileDeviceControls({
  apiBaseUrl,
  appRole,
  easProjectId,
  notificationDisabledMessage,
  notificationEnabledMessage,
  onStatusMessage,
  parentLinkId = '',
  teamId = '',
}) {
  const [biometricEnabled, setBiometricEnabledState] = useState(false)
  const [biometricAvailable, setBiometricAvailable] = useState(false)
  const [isUpdatingBiometrics, setIsUpdatingBiometrics] = useState(false)
  const [isRegisteringPush, setIsRegisteringPush] = useState(false)
  const [notificationState, setNotificationState] = useState(null)

  const setMessage = useCallback((message) => {
    if (onStatusMessage) {
      onStatusMessage(message)
    }
  }, [onStatusMessage])

  const refreshDeviceState = useCallback(async () => {
    const nextDeviceState = await readDeviceControlState()

    setBiometricAvailable(nextDeviceState.biometricAvailable)
    setBiometricEnabledState(nextDeviceState.biometricEnabled)
    setNotificationState(nextDeviceState.notificationState)
  }, [])

  useEffect(() => {
    void initializeMobileNotifications().catch((error) => {
      console.error(error)
    })
  }, [])

  useEffect(() => {
    let isMounted = true

    async function loadDeviceState() {
      try {
        const nextDeviceState = await readDeviceControlState()

        if (isMounted) {
          setBiometricAvailable(nextDeviceState.biometricAvailable)
          setBiometricEnabledState(nextDeviceState.biometricEnabled)
          setNotificationState(nextDeviceState.notificationState)
        }
      } catch (error) {
        console.error(error)
      }
    }

    void loadDeviceState()

    return () => {
      isMounted = false
    }
  }, [])

  const enableNotifications = useCallback(async () => {
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
      await refreshDeviceState()
      setMessage(notificationEnabledMessage)
    } catch (error) {
      console.error(error)
      setMessage(error.message || 'Notifications could not be enabled.')
    } finally {
      setIsRegisteringPush(false)
    }
  }, [apiBaseUrl, appRole, easProjectId, notificationEnabledMessage, parentLinkId, refreshDeviceState, setMessage, teamId])

  const disableNotifications = useCallback(async () => {
    setIsRegisteringPush(true)
    setMessage('')

    try {
      const accessToken = await getAccessToken()
      await revokeNativePushDevice({
        accessToken,
        apiBaseUrl,
      })
      await refreshDeviceState()
      setMessage(notificationDisabledMessage)
    } catch (error) {
      console.error(error)
      setMessage(error.message || 'Notifications could not be disabled.')
    } finally {
      setIsRegisteringPush(false)
    }
  }, [apiBaseUrl, notificationDisabledMessage, refreshDeviceState, setMessage])

  const toggleBiometrics = useCallback(async () => {
    setIsUpdatingBiometrics(true)
    setMessage('')

    try {
      const nextEnabled = await setBiometricEnabled(!biometricEnabled)
      setBiometricEnabledState(nextEnabled)
      setMessage(nextEnabled ? 'Biometric unlock is enabled.' : 'Biometric unlock is disabled.')
    } catch (error) {
      console.error(error)
      setMessage(error.message || 'Biometric setting could not be updated.')
    } finally {
      setIsUpdatingBiometrics(false)
    }
  }, [biometricEnabled, setMessage])

  return {
    biometricAvailable,
    biometricEnabled,
    disableNotifications,
    enableNotifications,
    isRegisteringPush,
    isUpdatingBiometrics,
    notificationState,
    toggleBiometrics,
  }
}
