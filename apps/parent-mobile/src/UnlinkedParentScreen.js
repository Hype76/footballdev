import { useState } from 'react'
import { Image, Pressable, Text, View } from 'react-native'
import { useMobileAuth } from '../../mobile-core/src/auth'
import { PrimaryButton, TextField } from '../../mobile-core/src/ui'
import { mobileAccountRequest } from '../../mobile-core/src/mobileSignup'
import { supabase } from '../../mobile-core/src/supabase'
import { APP_DOWNLOAD_LINKS } from '../../../src/lib/app-download-links.js'

export function UnlinkedParentScreen() {
  const { user, refreshUserProfile, signOut } = useMobileAuth()
  const [mode, setMode] = useState('home')
  const [name, setName] = useState(user.displayName || '')
  const [email, setEmail] = useState('')
  const [message, setMessage] = useState('')
  const [invitation, setInvitation] = useState('')
  const [preview, setPreview] = useState(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [sent, setSent] = useState('')
  async function run(action) {
    if (busy) return
    setBusy(true); setError('')
    try { await action() } catch (failure) { setError(failure.message || 'Please try again.') } finally { setBusy(false) }
  }
  async function acceptInvitation() {
    let token = ''
    try {
      const url = new URL(invitation.trim())
      if (url.protocol !== 'https:' || !['footballplayer.online', 'parent.footballplayer.online', 'www.footballplayer.online'].includes(url.hostname)) throw new Error()
      token = url.pathname.startsWith('/parent-invite/') ? decodeURIComponent(url.pathname.split('/')[2] || '') : url.searchParams.get('parentInvite') || ''
    } catch { throw new Error('Paste the full Football Player invitation link from your email.') }
    if (!token || token.length > 256) throw new Error('This is not a player invitation link. Open your invitation email and copy its link.')
    const result = await supabase.rpc('accept_parent_player_link', { invite_token_value: token })
    if (result.error) throw result.error
    if (!(Array.isArray(result.data) ? result.data[0] : result.data)?.id) throw new Error('The invitation could not be accepted. Please ask your Coach for a new invitation.')
    await refreshUserProfile()
  }
  return <View style={{ paddingVertical: 16, gap: 18, backgroundColor: '#f4f7f6' }}>
      <Image source={require('../assets/football-player-logo.png')} style={{ width: 64, height: 64 }} />
      <Text style={{ fontSize: 28, fontWeight: '800', color: '#142b25' }}>{sent ? 'Invitation sent' : mode === 'invite' ? 'Invite your Coach' : mode === 'link' ? 'Connect to your player' : 'Welcome to Football Player'}</Text>
      <Text style={{ fontSize: 16, lineHeight: 24, color: '#425850' }}>{sent ? `Your invitation has been sent to ${sent}. Your Coach can get started and invite you to your player. You can check for access below.` : 'Your account is ready. Your team needs to invite you before you can see player information, fixtures and live alerts.'}</Text>
      {mode === 'home' && !sent && <>
        <PrimaryButton onPress={() => setMode('invite')}>Invite your Coach</PrimaryButton>
        <PrimaryButton variant="secondary" onPress={() => setMode('link')}>I already have an invitation</PrimaryButton>
      </>}
      {mode === 'invite' && !sent && !preview && <>
        <TextField light label="Your name" value={name} onChangeText={setName} autoCapitalize="words" />
        <TextField light label="Coach email address" value={email} onChangeText={setEmail} keyboardType="email-address" />
        <TextField light label="Personal message (optional)" value={message} onChangeText={setMessage} multiline />
        <Text style={{ color: '#425850' }}>We will include your name and email so your Coach can reply, plus an introduction to Football Player, app links and QR codes.</Text>
        <PrimaryButton loading={busy} onPress={() => run(async () => setPreview(await mobileAccountRequest('parent', 'invite-coach', { action: 'preview', name, email, message })))}>Preview invitation</PrimaryButton>
      </>}
      {preview && !sent && <>
        <Text style={{ fontWeight: '700', color: '#142b25' }}>To: {email.trim()}</Text>
        <Text style={{ fontWeight: '700', fontSize: 18, color: '#142b25' }}>{preview.subject}</Text>
        <Text style={{ lineHeight: 24, color: '#425850' }}>{preview.text}</Text>
        <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 12 }}>{['apple', 'android'].map(store => <View key={store} style={{ gap: 8 }}>
          <Image accessibilityLabel={store === 'apple' ? 'App Store' : 'Google Play'} source={{ uri: `https://footballplayer.online/email-apps/${store === 'apple' ? 'app-store' : 'google-play'}-badge.png` }} style={{ width: 135, height: 44 }} resizeMode="contain" />
          <Image accessibilityLabel={`${store === 'apple' ? 'iPhone' : 'Android'} Coach app QR code`} source={{ uri: APP_DOWNLOAD_LINKS.coach[`${store}Qr`] }} style={{ width: 112, height: 112 }} />
        </View>)}</View>
        <PrimaryButton loading={busy} onPress={() => run(async () => { await mobileAccountRequest('parent', 'invite-coach', { action: 'send', name, email, message }); setSent(email.trim()); setPreview(null); setMode('home') })}>Send invitation</PrimaryButton>
        <PrimaryButton disabled={busy} variant="secondary" onPress={() => setPreview(null)}>Edit invitation</PrimaryButton>
      </>}
      {mode === 'link' && <>
        <Text style={{ color: '#425850', lineHeight: 24 }}>Use the invitation sent to {user.email}. Paste the player invitation link below. For a Fan invitation, open the original email link.</Text>
        <TextField light label="Player invitation link" value={invitation} onChangeText={setInvitation} />
        <PrimaryButton loading={busy} onPress={() => run(acceptInvitation)}>Accept invitation</PrimaryButton>
      </>}
      {error ? <Text accessibilityRole="alert" style={{ color: '#a52323' }}>{error}</Text> : null}
      <View style={{ borderTopWidth: 1, borderColor: '#cbd8d2', paddingTop: 16, gap: 12 }}>
        {sent && <PrimaryButton variant="secondary" onPress={() => { setSent(''); setMode('link') }}>I already have an invitation</PrimaryButton>}
        <PrimaryButton loading={busy} variant="secondary" onPress={() => run(async () => { const updated = await refreshUserProfile(); if (!updated?.parentPortalLinks?.length) setError('No active player link yet. Accept your invitation or ask your Coach to invite this email address.') })}>Check for access</PrimaryButton>
        {mode !== 'home' && <PrimaryButton disabled={busy} variant="secondary" onPress={() => { setMode('home'); setPreview(null); setError('') }}>Back</PrimaryButton>}
        <Pressable accessibilityRole="button" disabled={busy} onPress={() => run(signOut)} style={{ minHeight: 48, justifyContent: 'center' }}><Text style={{ color: '#214c86', fontWeight: '700' }}>Sign out</Text></Pressable>
      </View>
  </View>
}
