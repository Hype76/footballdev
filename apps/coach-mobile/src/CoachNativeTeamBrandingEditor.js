import { useLayoutEffect, useRef, useState } from 'react'
import { Image, Linking, Pressable, Text, TextInput, View } from 'react-native'
import { mobileAccountRequest } from '../../mobile-core/src/mobileSignup'
import { assertTeamBrandingManagementScope } from '../../../src/lib/team-branding-onboarding.js'
import { buildCoachWebHandoffUrl } from '../../../src/lib/coach-web-handoff.js'

export function CoachNativeTeamBrandingEditor({ context, user, management, apiBaseUrl, palette, refreshUserProfile, onBack, onBrowserOpen }) {
  const [state, setState] = useState(management)
  const [accent, setAccent] = useState(management.accent || 'green')
  const [changed, setChanged] = useState(false)
  const [accepted, setAccepted] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [message, setMessage] = useState('')
  const inFlight = useRef(false)
  const alive = useRef(false)
  useLayoutEffect(() => { alive.current = true; return () => { alive.current = false } }, [])
  const request = async (action, extra = {}) => assertTeamBrandingManagementScope(await mobileAccountRequest('coach', 'manage-team-branding', {
    ...extra, action, teamId: context.teamId,
  }, user.id), context.teamId, context.clubId)
  const act = async action => {
    if (inFlight.current) return
    inFlight.current = true; setBusy(true); setError(''); setMessage('')
    try {
      const fresh = await request('read')
      if (!alive.current) return
      setState(fresh)
      if (action === 'claim') {
        if (!accepted || !fresh.claimAllowed || fresh.termsVersion !== state.termsVersion) { setAccepted(false); throw new Error('Read and accept the current offer terms before claiming.') }
        setState(await request('claim', { termsVersion: fresh.termsVersion }))
        setMessage('Your place is reserved. Choose your badge and colour.')
      } else if (action === 'save') {
        if (!fresh.coloursAllowed) throw new Error('Team colour access is no longer available.')
        if (!/^(yellow|blue|green|red|purple|#[0-9a-f]{6})$/i.test(accent)) throw new Error('Choose a colour or enter a six-digit hex colour, such as #047857.')
        setState(await request('save', { accent: accent.toLowerCase() }))
        setChanged(false)
        setMessage('Team colour saved.')
        try { await refreshUserProfile() } catch { setMessage('Team colour saved. Refresh the app when connected to see it.') }
      } else {
        if (!fresh.logoAllowed) throw new Error('Team badge access is no longer available.')
        const handoff = await mobileAccountRequest('coach', 'create-coach-web-handoff', { purpose: 'badge', teamId: context.teamId }, user.id)
        if (!alive.current) return
        if (handoff.actorId !== user.id || handoff.teamId !== context.teamId || handoff.purpose !== 'badge') throw new Error('Badge upload access could not be verified.')
        const url = buildCoachWebHandoffUrl(apiBaseUrl, handoff)
        onBrowserOpen?.()
        await Linking.openURL(url)
      }
    } catch (failure) { if (alive.current) setError(failure.message || 'Your saved branding was kept. Try again.') }
    finally { inFlight.current = false; if (alive.current) setBusy(false) }
  }
  const action = (label, onPress, disabled = false) => <Pressable accessibilityRole="button" accessibilityLabel={label} disabled={disabled} onPress={onPress} style={{ minHeight: 48, justifyContent: 'center' }}><Text style={{ color: palette.accentText, fontSize: 16, fontWeight: '700' }}>{label}</Text></Pressable>
  return <View style={{ gap: 8, paddingVertical: 8 }}>
    {action('Back to team branding', onBack, busy)}
    <Text accessibilityRole="header" style={{ color: palette.textPrimary, fontWeight: '700', fontSize: 20 }}>Team badge and colour</Text>
    {state?.state === 'unclaimed' && state.claimAllowed && <>
      <Text style={{ color: palette.textSecondary, fontSize: 14, lineHeight: 21 }}>First 250 teams: accept the offer terms to reserve a place. Within {state.qualificationMonths || 3} months, link {state.requiredPlayers || 7} active players to accepted Parent accounts and complete {state.requiredMatches || 10} matches. Branding becomes permanent when both are met. Otherwise promotional display ends and artwork is kept. One place per team.</Text>
      <Pressable accessibilityRole="checkbox" accessibilityState={{ checked: accepted, disabled: busy }} disabled={busy} onPress={() => setAccepted(value => !value)} style={{ minHeight: 48, justifyContent: 'center' }}><Text style={{ color: palette.textPrimary, fontSize: 16 }}>{accepted ? '✓ ' : '○ '}I accept the offer terms ({state.termsVersion})</Text></Pressable>
      {action(busy ? 'Please wait...' : "Claim this team's place", () => void act('claim'), busy || !accepted)}
    </>}
    {state?.logoAllowed && <>
      {state.logoUrl ? <Image accessibilityLabel="Saved team badge" source={{ uri: state.logoUrl }} style={{ width: 64, height: 64 }} resizeMode="contain" /> : null}
      {action('Upload team badge', () => void act('badge'), busy)}
      <Text style={{ color: palette.textSecondary, lineHeight: 21 }}>Badge upload opens your signed-in account in the browser. Return to Coach when finished.</Text>
    </>}
    {state?.coloursAllowed && <>
      <Text style={{ color: palette.textPrimary, fontSize: 16, fontWeight: '700' }}>Team colour</Text>
      <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
        {['green', 'blue', 'yellow', 'red', 'purple'].map(colour => <Pressable key={colour} accessibilityRole="radio" accessibilityLabel={`${colour} team colour`} accessibilityState={{ selected: accent === colour, disabled: busy }} disabled={busy} onPress={() => { setAccent(colour); setChanged(true) }} style={{ minHeight: 48, justifyContent: 'center', paddingHorizontal: 8, borderBottomWidth: accent === colour ? 2 : 0, borderColor: palette.accentText }}><Text style={{ color: palette.textPrimary, fontSize: 16 }}>{colour[0].toUpperCase() + colour.slice(1)}</Text></Pressable>)}
      </View>
      <TextInput accessibilityLabel="Custom team colour" placeholder="#047857" placeholderTextColor={palette.textSecondary} editable={!busy} autoCapitalize="none" autoCorrect={false} value={accent} onChangeText={value => { setAccent(value); setChanged(true) }} style={{ color: palette.textPrimary, fontSize: 16, minHeight: 48, borderBottomWidth: 1, borderColor: palette.border }} />
      {action(busy ? 'Please wait...' : 'Save team colour', () => void act('save'), busy || !changed)}
    </>}
    {message ? <Text accessibilityLiveRegion="polite" style={{ color: palette.textPrimary, lineHeight: 21 }}>{message}</Text> : null}
    {error ? <Text accessibilityRole="alert" style={{ color: palette.textPrimary, lineHeight: 21 }}>{error}</Text> : null}
  </View>
}
