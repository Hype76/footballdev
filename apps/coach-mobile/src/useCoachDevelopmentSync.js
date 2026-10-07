import { useEffect } from 'react'
import { AppState } from 'react-native'
import { subscribeDevelopmentSync, syncCoachDevelopmentDrafts } from './coachDevelopmentSync'

export function useCoachDevelopmentSync({ user, contexts, enabled }) {
  useEffect(() => {
    if (!enabled || !user?.id || user.isOfflineProfile) return undefined
    let stopped = false
    let running = false
    let requested = false
    const sync = async () => {
      if (stopped || AppState.currentState !== 'active') return
      if (running) { requested = true; return }
      running = true
      try {
        do {
          requested = false
          for (const context of contexts) {
            if (stopped || AppState.currentState !== 'active') return
            if (context.teamId) await syncCoachDevelopmentDrafts(user, context, () => !stopped)
          }
        } while (requested && !stopped)
      } catch { /* Keep the encrypted drafts for the next connection. */ }
      finally { running = false }
    }
    void sync()
    const unsubscribe = subscribeDevelopmentSync(event => { if (event?.kind === 'queued') void sync() })
    const interval = setInterval(() => void sync(), 15000)
    const subscription = AppState.addEventListener('change', state => { if (state === 'active') void sync() })
    return () => { stopped = true; unsubscribe(); clearInterval(interval); subscription.remove() }
  }, [user, contexts, enabled])
}
