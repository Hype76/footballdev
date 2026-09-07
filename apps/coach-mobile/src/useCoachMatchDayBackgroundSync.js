import { useEffect } from 'react'
import { AppState } from 'react-native'
import NetInfo from '@react-native-community/netinfo'
import { applyCoachContext } from '../../mobile-core/src/coachContextCore'
import { createMatchDayOutbox } from '../../mobile-core/src/matchDayOutboxCore'
import { syncCoachMatchDayCommand } from '../../mobile-core/src/coachMatchDayData'
import { withMobileAsyncTimeout } from '../../mobile-core/src/http'
import { getPendingCoachMatchDays, readCoachMatchDayOutbox, updateCoachMatchDayOutbox } from './offline'

export function useCoachMatchDayBackgroundSync({ user, contexts, enabled }) {
  useEffect(() => {
    if (!enabled || !user?.id) return undefined
    let stopped = false
    let running = false
    let controller
    const sync = async () => {
      if (stopped || running || AppState.currentState !== 'active') return
      running = true
      try {
        const pending = await getPendingCoachMatchDays(user.id)
        for (const { contextId, matchId } of pending) {
          if (stopped) return
          const context = contexts.find(item => item.id === contextId)
          if (!context) continue
          let scopedUser
          try { scopedUser = applyCoachContext(user, context) } catch { continue }
          controller = createMatchDayOutbox({ key: `${user.id}:${contextId}:${matchId}`,
            read: () => readCoachMatchDayOutbox(user.id, context, matchId),
            update: change => updateCoachMatchDayOutbox(user.id, context, matchId, change),
            send: (command, baseMatch) => withMobileAsyncTimeout(() => syncCoachMatchDayCommand(scopedUser, command, baseMatch)),
          })
          await controller.sync()
        }
      } catch { /* Saved actions stay encrypted and visible in their original fixture. */ }
      finally { running = false }
    }
    void sync()
    const removeNetwork = NetInfo.addEventListener(state => { if (state.isConnected !== false && state.isInternetReachable !== false) void sync() })
    const appState = AppState.addEventListener('change', state => { if (state === 'active') void sync() })
    const interval = setInterval(() => void sync(),15000)
    return () => { stopped = true; controller?.stop(); removeNetwork(); appState.remove(); clearInterval(interval) }
  }, [user, contexts, enabled])
}
