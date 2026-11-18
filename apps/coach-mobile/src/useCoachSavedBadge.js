import { useEffect, useState } from 'react'
import { AppState } from 'react-native'
import { getScopedTeamBranding } from '../../../src/lib/team-branding-display.js'
import { resolveCoachSavedBadge } from './coachAccountOfflineService'

export function useCoachSavedBadge(user, context, remoteUrl) {
  const [saved, setSaved] = useState(null)
  const [expiryTick, setExpiryTick] = useState(0)
  const key = JSON.stringify([user?.id, context?.id, context?.authorityId, context?.authoritySource, context?.role, remoteUrl])
  useEffect(() => {
    let current = true
    const read = async () => {
      try {
        const uri = await resolveCoachSavedBadge(user, context)
        if (current) setSaved(uri ? { key, uri } : null)
      } catch { if (current) setSaved(null) }
    }
    void read()
    const timer = setInterval(() => void read(), 15_000)
    const subscription = AppState.addEventListener('change', state => { if (state === 'active') void read() })
    const expiry = Date.parse(context?.teamBrandingDisplay?.expiresAt || '')
    const expiryTimer = Number.isFinite(expiry) && expiry > Date.now()
      ? setTimeout(() => { if (current) setExpiryTick(value => value + 1) }, Math.min(expiry - Date.now() + 1, 2_147_483_647)) : null
    return () => { current = false; clearInterval(timer); if (expiryTimer) clearTimeout(expiryTimer); subscription.remove() }
  }, [key, user, context, expiryTick])
  const display = getScopedTeamBranding(context)
  const approvedUrl = display ? display.logoUrl : remoteUrl
  return approvedUrl === remoteUrl && saved?.key === key ? saved.uri : approvedUrl
}
