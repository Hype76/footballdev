import { useEffect, useState } from 'react'
import { supabase } from './supabase-client.js'
import { validateMatchdayFlags } from './matchday-policy.js'

const UNAVAILABLE_POLICY = Object.freeze({ revision: null, flags: Object.freeze({}) })

export function useMatchdayPolicy(user) {
  const context = `${user?.id || ''}:${user?.clubId || ''}:${user?.planKey || ''}`
  const enabled = user?.planKey === 'matchday'
  const [loaded, setLoaded] = useState(null)
  useEffect(() => {
    if (!enabled) return undefined
    let active = true
    let request = 0
    const refresh = async () => {
      const currentRequest = ++request
      try {
        const { data, error } = await supabase.rpc('get_matchday_plan_config')
        if (error) throw error
        const policy = { revision: data.revision, flags: validateMatchdayFlags(data.flags) }
        if (active && currentRequest === request) setLoaded({ context, policy })
      } catch {
        if (active && currentRequest === request) setLoaded({ context, policy: UNAVAILABLE_POLICY })
      }
    }
    const onVisible = () => { if (document.visibilityState === 'visible') void refresh() }
    void refresh()
    window.addEventListener('focus', refresh)
    document.addEventListener('visibilitychange', onVisible)
    return () => {
      active = false
      window.removeEventListener('focus', refresh)
      document.removeEventListener('visibilitychange', onVisible)
    }
  }, [context, enabled])
  return enabled ? (loaded?.context === context ? loaded.policy : UNAVAILABLE_POLICY) : undefined
}
