import { useEffect, useRef, useState } from 'react'
import { AppState, Linking, Pressable, Text, View } from 'react-native'
import { mobileAccountRequest } from '../../mobile-core/src/mobileSignup'
import { buildCoachWebHandoffUrl } from '../../../src/lib/coach-web-handoff.js'

export function CoachUpgradeAction({ user, context, apiBaseUrl, palette, refreshUserProfile }) {
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const pending = useRef(false)
  const inFlight = useRef(false)
  const alive = useRef(true)
  useEffect(() => {
    alive.current = true
    const listener = AppState.addEventListener('change', state => {
      if (state === 'active' && pending.current) {
        pending.current = false
        void refreshUserProfile().catch(() => { if (alive.current) setError('Your plan could not refresh. Try again when connected.') })
      }
    })
    return () => { alive.current = false; listener.remove() }
  }, [refreshUserProfile])
  const open = async () => {
    if (inFlight.current) return
    inFlight.current = true; setBusy(true); setError('')
    try {
      const handoff = await mobileAccountRequest('coach', 'create-coach-web-handoff', { purpose: 'upgrade' }, user.id)
      if (!alive.current) return
      if (handoff.actorId !== user.id || handoff.purpose !== 'upgrade') throw new Error('Plan access could not be verified.')
      pending.current = true
      await Linking.openURL(buildCoachWebHandoffUrl(apiBaseUrl, handoff))
    } catch (failure) { pending.current = false; if (alive.current) setError(failure.message || 'Upgrade options could not be opened. Try again.') }
    finally { inFlight.current = false; if (alive.current) setBusy(false) }
  }
  if (!['team', 'club'].includes(context?.paymentAccess?.payerAuthority)) return <Text style={{ color: palette.textSecondary, lineHeight: 21 }}>Ask your Team or Club account owner if you want to change plan.</Text>
  return <View style={{ gap: 4 }}>
    <Pressable accessibilityRole="button" accessibilityLabel="Upgrade plan" disabled={busy || user.isOfflineProfile} onPress={() => void open()} style={{ minHeight: 48, justifyContent: 'center' }}><Text style={{ color: palette.accentText, fontSize: 16, fontWeight: '700' }}>{busy ? 'Opening upgrade options...' : 'Upgrade plan'}</Text></Pressable>
    <Text style={{ color: palette.textSecondary, lineHeight: 21 }}>Upgrade on the website through Stripe. Your account opens already signed in.</Text>
    {error ? <Text accessibilityRole="alert" style={{ color: palette.textPrimary, lineHeight: 21 }}>{error}</Text> : null}
  </View>
}
