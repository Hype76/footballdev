import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { AppState, Platform } from 'react-native'
import * as Notifications from 'expo-notifications'
import * as SecureStore from 'expo-secure-store'
import { readFanDeviceNotifications, enableFanDeviceNotifications, disableFanDeviceNotifications } from './fanDeviceNotifications'

export function useFanDeviceNotifications({ userId, apiBaseUrl, projectId, request }) {
  const session = useMemo(() => ({ userId, apiBaseUrl, projectId }), [userId, apiBaseUrl, projectId])
  const lifecycleRef = useRef(null)
  useLayoutEffect(() => {
    const lifecycle = { session, active: true, generation: 0 }
    lifecycleRef.current = lifecycle
    return () => { lifecycle.active = false }
  }, [session])
  const [state, setState] = useState(null)
  const operate = useCallback(async (operation, devicePushToken) => {
    if (Platform.OS === 'web' || !session.userId) return
    const lifecycle = lifecycleRef.current
    if (lifecycle?.session !== session || !lifecycle.active) return
    const generation = ++lifecycle.generation
    const isCurrent = () => lifecycle.active && lifecycleRef.current === lifecycle
    const services = {
      ...session, notifications: Notifications, secureStore: SecureStore,
      isCurrent,
      request: body => request(body, isCurrent),
    }
    const update = value => { if (isCurrent() && generation === lifecycle.generation) setState({ session, ...value }) }
    update({ status: 'checking' })
    try {
      const result = await operation(services, devicePushToken)
      update(result)
      return result
    } catch (error) { update({ status: 'unknown' }); throw error }
  }, [request, session])
  const refresh = useCallback(devicePushToken => operate(readFanDeviceNotifications, devicePushToken), [operate])
  const enable = useCallback(() => operate(enableFanDeviceNotifications), [operate])
  const disable = useCallback(() => operate(disableFanDeviceNotifications), [operate])
  useEffect(() => {
    let active = true
    if (Platform.OS === 'web' || !session.userId) return undefined
    const recheck = token => { if (active) void refresh(token).catch(() => {}) }
    void Promise.resolve().then(() => recheck())
    const foreground = AppState.addEventListener('change', status => { if (status === 'active') recheck() })
    const rotation = Notifications.addPushTokenListener(token => recheck(token))
    return () => { active = false; foreground.remove(); rotation.remove() }
  }, [refresh, session])
  return {
    deviceNotifications: Platform.OS === 'web' ? { status: 'web' } : state?.session === session ? state : { status: 'checking' },
    refresh, enable, disable,
  }
}
