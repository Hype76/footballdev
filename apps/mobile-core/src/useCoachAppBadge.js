import { useEffect, useRef } from 'react'
import { AppState } from 'react-native'
import * as Notifications from 'expo-notifications'
import { getCoachAppBadgeCount, syncMobileAppBadge } from './appBadge'

export function useCoachAppBadge({ homeState, activeRoute, contextId }) {
  const count = getCoachAppBadgeCount({ unreadChat: homeState.unreadChat })
  const latestCount = useRef(count)

  useEffect(() => {
    latestCount.current = count
    // A push can change the OS badge even when the refreshed unread count stays zero.
    void syncMobileAppBadge({ appRole: 'coach', count }).catch(() => {})
  }, [count, homeState, activeRoute, contextId])

  useEffect(() => {
    const reconcile = () => {
      void syncMobileAppBadge({ appRole: 'coach', count: latestCount.current }).catch(() => {})
    }
    const appState = AppState.addEventListener('change', state => {
      if (state === 'active') reconcile()
    })
    const received = Notifications.addNotificationReceivedListener(reconcile)
    return () => { appState.remove(); received.remove() }
  }, [])
}
