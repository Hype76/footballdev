import { useEffect, useRef, useState } from 'react'
import { Image, Linking, Pressable, ScrollView, Text, View } from 'react-native'
import { SafeAreaView } from 'react-native-safe-area-context'
import { supabase } from '../../mobile-core/src/supabase'
import { useMobileAuth } from '../../mobile-core/src/auth'
import { fanBrandingLink, fanBrandTheme } from '../../../src/lib/fan-branding'
import { fanAccessSummary } from '../../../src/lib/fans'

export function FanInvitationScreen({ token, session, onSignIn, onClose, onAccepted, themeMode = 'light' }) {
  const { refreshUserProfile } = useMobileAuth()
  const actor = session?.user?.id || ''
  const identity = `${actor}:${token}`
  const current = useRef(identity)
  current.current = identity
  const epoch = useRef(0)
  const priorIdentity = useRef(identity)
  if (priorIdentity.current !== identity) { priorIdentity.current = identity; epoch.current += 1 }
  const generation = epoch.current
  const mounted = useRef(true)
  const operation = useRef(false)
  const [data, setData] = useState(null)
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  const [loading, setLoading] = useState(true)
  const [attempt, setAttempt] = useState(0)
  useEffect(() => { mounted.current = true; return () => { mounted.current = false } }, [])
  useEffect(() => {
    let active = true
    setData(null); setError(''); setLoading(true); setBusy(false); operation.current = false
    const name = actor ? 'get_fan_invitation' : 'get_fan_invitation_branding'
    supabase.rpc(name, { token_value: token }).then(({ data: result, error: failure }) => {
      if (!active) return
      if (failure) throw failure
      if (!result) throw new Error('This invitation is no longer available. Ask the Parent for a new invitation.')
      setData({ identity, value: result })
    }).catch(failure => { if (active) setError(failure.message || 'The invitation could not be loaded.') }).finally(() => { if (active) setLoading(false) })
    return () => { active = false }
  }, [actor, identity, token, attempt])
  const invite = data?.identity === identity ? data.value : null
  const brand = fanBrandingLink(invite)
  const tokens = fanBrandTheme(invite || {}, themeMode).tokens
  const valid = () => mounted.current && current.current === identity && epoch.current === generation
  const run = async action => {
    if (operation.current) return
    operation.current = true; setBusy(true); setError('')
    try { await action() } catch (failure) { if (valid()) setError(failure.message || 'The invitation could not be accepted. Please try again.') }
    finally { if (valid()) { operation.current = false; setBusy(false) } }
  }
  const button = (label, action, primary = false) => <Pressable accessibilityRole="button" accessibilityLabel={label} accessibilityState={{ disabled: busy }} disabled={busy} onPress={action} style={{ minHeight: 48, padding: 14, borderRadius: 10, backgroundColor: primary ? tokens.buttonPrimary : tokens.portalBackground, opacity: busy ? 0.5 : 1 }}><Text style={{ color: primary ? tokens.accentForeground : tokens.accentText, fontWeight: '700' }}>{label}</Text></Pressable>
  return <SafeAreaView style={{ flex: 1, backgroundColor: tokens.portalBackground }}><ScrollView contentContainerStyle={{ padding: 20, gap: 18, flexGrow: 1 }} keyboardShouldPersistTaps="handled">
    {brand.clubName ? <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12 }}>{brand.clubLogoUrl ? <Image source={{ uri: brand.clubLogoUrl }} accessibilityLabel={`${brand.clubName} logo`} resizeMode="contain" style={{ width: 48, height: 48 }} /> : null}<Text style={{ flex: 1, color: tokens.textPrimary, fontSize: 20, fontWeight: '800' }}>{brand.clubName}</Text></View> : null}
    <Text accessibilityRole="header" style={{ fontSize: 26, fontWeight: '800', color: tokens.textPrimary }}>Your Fan invitation</Text>
    <Text style={{ color: tokens.textSecondary, fontSize: 15, lineHeight: 22 }}>Use the email address the Parent invited. Access starts only when you accept.</Text>
    {loading ? <Text accessibilityLiveRegion="polite" style={{ color: tokens.textSecondary }}>Loading invitation...</Text> : null}
    {error ? <View style={{ gap: 12 }}><Text accessibilityRole="alert" style={{ color: tokens.danger }}>{error}</Text>{!invite ? button('Try again', () => setAttempt(value => value + 1)) : null}</View> : null}
    {actor ? <>
      <Text style={{ color: tokens.textSecondary }}>Signed in as {session.user.email}</Text>
      {invite ? <View style={{ backgroundColor: tokens.portalSurface, padding: 18, borderRadius: 14, gap: 16 }}><Text accessibilityRole="header" style={{ color: tokens.textPrimary, fontSize: 20, fontWeight: '700' }}>Follow {invite.player_name}</Text>{fanAccessSummary(invite.permissions).map(line => <Text key={line} style={{ color: tokens.textSecondary, lineHeight: 21 }}>{line}</Text>)}<Text style={{ color: tokens.textSecondary, lineHeight: 21 }}>You cannot invite others or change this player's information. You can remove your access in Settings.</Text>{button(busy ? 'Accepting invitation...' : 'Accept invitation', () => run(async () => {
        const { error: failure } = await supabase.rpc('accept_fan_invitation', { token_value: token })
        if (failure) throw failure
        if (!valid()) return
        await refreshUserProfile()
        if (valid()) onAccepted?.()
      }), true)}</View> : null}
    </> : <>{button('Sign in', onSignIn, true)}{button('Create account on website', () => run(() => Linking.openURL(`https://parent.footballplayer.online/fan-invite/${encodeURIComponent(token)}?continue=web`)))}</>}
    {button('Close invitation', onClose)}
  </ScrollView></SafeAreaView>
}
