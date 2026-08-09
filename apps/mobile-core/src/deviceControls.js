import { useCallback, useEffect, useState } from 'react'
import { getBiometricAvailability, getBiometricEnabled, setBiometricEnabled } from './biometrics'
import { getNativeNotificationDeviceState, initializeMobileNotifications, registerNativePushDevice, revokeNativePushDevice } from './notifications'
import { getAccessToken } from './supabase'

async function readDeviceControlState({ appRole = '', manageNotifications = true, parentLinkId = '', teamId = '' } = {}) {
  const [availability, enabled, notificationState] = await Promise.all([
    getBiometricAvailability(),
    getBiometricEnabled(appRole),
    manageNotifications ? getNativeNotificationDeviceState({
      appRole,
      parentLinkId,
      teamId,
    }) : Promise.resolve(null),
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
  manageNotifications = true,
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
    const nextDeviceState = await readDeviceControlState({
      appRole,
      manageNotifications,
      parentLinkId,
      teamId,
    })

    setBiometricAvailable(nextDeviceState.biometricAvailable)
    setBiometricEnabledState(nextDeviceState.biometricEnabled)
    setNotificationState(nextDeviceState.notificationState)
  }, [appRole, manageNotifications, parentLinkId, teamId])

  useEffect(() => {
    if (!manageNotifications) return undefined
    void initializeMobileNotifications().catch((error) => {
      console.error(error)
    })
    return undefined
  }, [manageNotifications])

  useEffect(() => {
    let isMounted = true

    async function loadDeviceState() {
      try {
          const nextDeviceState = await readDeviceControlState({
            appRole,
            manageNotifications,
            parentLinkId,
            teamId,
          })

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
  }, [appRole, manageNotifications, parentLinkId, teamId])

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
      await refreshDeviceState()
      setMessage(notificationEnabledMessage)
    } catch (error) {
      console.error(error)
      setMessage(error.message || 'Notifications could not be enabled.')
    } finally {
      setIsRegisteringPush(false)
    }
  }, [apiBaseUrl, appRole, easProjectId, manageNotifications, notificationEnabledMessage, parentLinkId, refreshDeviceState, setMessage, teamId])

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
      await refreshDeviceState()
      setMessage(notificationDisabledMessage)
    } catch (error) {
      console.error(error)
      setMessage(error.message || 'Notifications could not be disabled.')
    } finally {
      setIsRegisteringPush(false)
    }
  }, [apiBaseUrl, appRole, manageNotifications, notificationDisabledMessage, refreshDeviceState, setMessage])

  const toggleBiometrics = useCallback(async () => {
    setIsUpdatingBiometrics(true)
    setMessage('')

    try {
      const nextEnabled = await setBiometricEnabled(!biometricEnabled, appRole)
      setBiometricEnabledState(nextEnabled)
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
    disableNotifications,
    enableNotifications,
    isRegisteringPush,
    isUpdatingBiometrics,
    notificationState,
    toggleBiometrics,
  }
}
