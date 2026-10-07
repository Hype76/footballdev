import { useEffect, useRef, useState } from 'react'
import { AppState, Linking, Pressable, Text, View } from 'react-native'
import AsyncStorage from '@react-native-async-storage/async-storage'
import { mobileAccountRequest } from '../../mobile-core/src/mobileSignup'
import { assertTeamBrandingManagementScope, buildClubAppearanceSetupUrl, buildTeamBrandingSetupUrl, canOfferTeamBrandingSetup, isCoachBrandingReturn } from '../../../src/lib/team-branding-onboarding.js'
import { getWorkspaceScope } from '../../../src/lib/workspace-scope.js'
import { CoachNativeTeamBrandingEditor } from './CoachNativeTeamBrandingEditor'

export function CoachTeamBrandingSetup({ context, user, apiBaseUrl, palette, prompt = false, visible = true, refreshUserProfile }) {
  const [management, setManagement] = useState(null)
  const [dismissed, setDismissed] = useState(true)
  const [error, setError] = useState('')
  const [opening, setOpening] = useState(false)
  const [retry, setRetry] = useState(0)
  const [editing, setEditing] = useState(false)
  const pending = useRef(null)
  const openingAttempt = useRef(0)
  const refreshing = useRef(false)
  const initialLinkChecked = useRef(false)
  const scope = `${user?.id || ''}:${context?.clubId || ''}:${context?.teamId || ''}`
  const scopeRef = useRef(scope)
  scopeRef.current = scope
  const key = `fp.coach.branding-setup-dismissed.v1.${scope}`
  const allowed = canOfferTeamBrandingSetup(context, user)
  const paidClub = getWorkspaceScope(user).key === 'club' || context?.teamBrandingDisplay?.source === 'paid_club'
  const clubAdmin = paidClub && user?.role === 'admin' && Number(user?.roleRank) >= 90

  useEffect(() => {
    let current = true
    openingAttempt.current += 1
    pending.current = null; setOpening(false); setEditing(false); setManagement(null); setError(''); setDismissed(true)
    if (allowed) {
      AsyncStorage.getItem(key).then(value => { if (current) setDismissed(value === '1') }).catch(() => { if (current) setDismissed(false) })
      if (clubAdmin) setManagement({ enabled: true })
      else mobileAccountRequest('coach', 'manage-team-branding', { action: 'read', teamId: context.teamId })
        .then(value => {
          const checked = assertTeamBrandingManagementScope(value, context.teamId, context.clubId)
          if (current) setManagement(checked)
        }).catch(() => { if (current) setError('Branding access could not be checked. Try again when connected.') })
    }
    return () => { current = false }
  }, [allowed, clubAdmin, context?.teamId, context?.clubId, key, retry])

  useEffect(() => {
    if (!allowed) return undefined
    let current = true
    async function refresh() {
      if (refreshing.current) return
      refreshing.current = true
      const requestedScope = scope
      try {
        await refreshUserProfile()
        if (current && scopeRef.current === requestedScope) { pending.current = null; setRetry(value => value + 1) }
      } catch {
        if (current && scopeRef.current === requestedScope) setError('Branding could not refresh. Try again when connected.')
      } finally { refreshing.current = false }
    }
    const links = Linking.addEventListener('url', ({ url }) => { if (isCoachBrandingReturn(url)) void refresh() })
    if (!initialLinkChecked.current) {
      initialLinkChecked.current = true
      void Linking.getInitialURL().then(url => { if (current && isCoachBrandingReturn(url)) void refresh() }).catch(() => {})
    }
    const resumes = AppState.addEventListener('change', state => {
      if (state === 'active' && pending.current === scope) void refresh()
    })
    return () => { current = false; links.remove(); resumes.remove() }
  }, [allowed, scope, refreshUserProfile])

  async function openSetup() {
    if (opening) return
    if (!clubAdmin) { setEditing(true); return }
    setOpening(true); setError('')
    const requestedScope = scope
    const attempt = ++openingAttempt.current
    try {
      const url = clubAdmin ? buildClubAppearanceSetupUrl(apiBaseUrl, context.clubId) : buildTeamBrandingSetupUrl(apiBaseUrl, context.teamId)
      pending.current = requestedScope
      await Linking.openURL(url)
    } catch {
      if (openingAttempt.current === attempt && scopeRef.current === requestedScope) {
        pending.current = null
        setError('The setup page could not be opened. Try again.')
      }
    } finally { if (openingAttempt.current === attempt && scopeRef.current === requestedScope) setOpening(false) }
  }
  async function skip() {
    setDismissed(true)
    try { await AsyncStorage.setItem(key, '1') } catch { /* Dismissed for this session; Settings remains available. */ }
  }
  if (!visible || !allowed || management?.enabled === false) return null
  if (editing && management?.enabled) return <CoachNativeTeamBrandingEditor key={scope} context={context} user={user} management={management} apiBaseUrl={apiBaseUrl} palette={palette} refreshUserProfile={refreshUserProfile} onBrowserOpen={() => { pending.current = scope }} onBack={() => { setEditing(false); setRetry(value => value + 1) }} />
  const needsSetup = (management?.state === 'unclaimed' && management.claimAllowed === true) || (!management?.logoUrl && ['grandfathered', 'permanent', 'provisional'].includes(management?.state))
  if (prompt && (!management?.enabled || dismissed || paidClub || !needsSetup)) return null
  const action = (label, onPress, disabled = false) => <Pressable accessibilityRole="button" accessibilityLabel={label} disabled={disabled} onPress={onPress} style={{ minHeight: 48, justifyContent: 'center', paddingHorizontal: 4 }}><Text style={{ color: palette.accentText, fontSize: 16, fontWeight: '700' }}>{label}</Text></Pressable>
  return <View style={{ borderTopWidth: 1, borderBottomWidth: 1, borderColor: palette.border, paddingVertical: 8, gap: 4 }}>
    <Text style={{ color: palette.textPrimary, fontSize: 16, fontWeight: '700' }}>{clubAdmin ? 'Club branding' : prompt ? 'Add your team badge and colour' : 'Team branding'}</Text>
    <Text style={{ color: palette.textSecondary, fontSize: 14, lineHeight: 21 }}>{clubAdmin ? 'Set your Club badge and colour in your phone browser, then return to Coach.' : paidClub ? 'Your badge and colours are managed by your Club.' : 'Choose your team colour here in the app. Only badge upload opens your signed-in account in the browser.'}</Text>
    {clubAdmin && !prompt && action(opening ? 'Opening setup...' : 'Add or edit Club badge and colour', openSetup, opening)}
    {!paidClub && management?.enabled && action(opening ? 'Opening setup...' : 'Add or edit badge and colour', openSetup, opening)}
    {prompt && action('Do this later', skip, opening)}
    {error && <Text accessibilityRole="alert" style={{ color: palette.textPrimary, fontSize: 14 }}>{error}</Text>}
    {!prompt && error && action('Retry branding access', () => setRetry(value => value + 1))}
  </View>
}
