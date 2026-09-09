import { useEffect } from 'react'
import { AppState } from 'react-native'
import { syncCoachDevelopmentDrafts } from './coachDevelopmentSync'

export function useCoachDevelopmentSync({ user, contexts, enabled }) {
  useEffect(() => {
    if (!enabled || !user?.id || user.isOfflineProfile) return undefined
    let stopped = false
    let running = false
    const sync = async () => {
      if (stopped || running || AppState.currentState !== 'active') return
      running = true
      try {
        for (const context of contexts) {
          if (stopped) return
          if (context.teamId) await syncCoachDevelopmentDrafts(user, context, () => !stopped)
        }
      } catch { /* Keep the encrypted drafts for the next connection. */ }
      finally { running = false }
    }
    void sync()
    const interval = setInterval(() => void sync(), 15000)
    const subscription = AppState.addEventListener('change', state => { if (state === 'active') void sync() })
    return () => { stopped = true; clearInterval(interval); subscription.remove() }
  }, [user, contexts, enabled])
}
