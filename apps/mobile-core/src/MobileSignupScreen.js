import { useState } from 'react'
import { Image, Linking, Pressable, SafeAreaView, ScrollView, Text, View } from 'react-native'
import { PrimaryButton, TextField } from './ui'
import { createMobileAccount } from './mobileSignup'
import { getMobileConnectionErrorMessage } from './mobileFetchCore'
import { PASSWORD_POLICY_SUMMARY } from '../../../src/lib/password-policy.js'

export function MobileSignupScreen({ appRole, logoSource, onBack }) {
  const [form, setForm] = useState({ name: '', teamName: '', email: '', password: '', confirmation: '' })
  const [accepted, setAccepted] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [complete, setComplete] = useState(false)
  const coach = appRole === 'coach'
  const set = key => value => setForm(current => ({ ...current, [key]: value }))
  async function submit() {
    if (busy) return
    setError('')
    if (form.password !== form.confirmation) { setError('Your passwords do not match.'); return }
    if (!accepted) { setError('Please accept the terms and privacy policy.'); return }
    setBusy(true)
    try { await createMobileAccount({ ...form, appRole }); setComplete(true); setForm(current => ({ ...current, password: '', confirmation: '' })) }
    catch (failure) { setError(getMobileConnectionErrorMessage(failure) ? 'We could not confirm account creation. Check your connection and try again. If a confirmation email has arrived, follow it and then sign in. Your details are still here.' : failure.message || 'Account creation could not be completed. Please try again.') }
    finally { setBusy(false) }
  }
  return <SafeAreaView style={{ flex: 1, backgroundColor: '#f4f7f6' }}>
    <ScrollView keyboardShouldPersistTaps="handled" automaticallyAdjustKeyboardInsets contentContainerStyle={{ padding: 24, paddingTop: 48, gap: 18, maxWidth: 560, width: '100%', alignSelf: 'center' }}>
      <Image source={logoSource} style={{ width: 72, height: 72 }} />
      <Text style={{ fontSize: 30, fontWeight: '800', color: '#142b25' }}>{complete ? 'Check your email' : 'Create your account'}</Text>
      <Text style={{ fontSize: 16, lineHeight: 24, color: '#425850' }}>{complete ? `Open the newest confirmation email sent to ${form.email.trim()}, then return here to sign in. An older link from a previous signup will not work. If you already have an account, sign in or use Forgot password.` : coach ? 'Start with free Match Day. Set up your team, invite parents and share live match alerts.' : 'Stay close to your player. Create your account now, then connect using an invitation from your team.'}</Text>
      {!complete && <View style={{ gap: 14 }}>
        <TextField light label="Your name" autoCapitalize="words" value={form.name} onChangeText={set('name')} />
        {coach && <TextField light label="Team name" autoCapitalize="words" value={form.teamName} onChangeText={set('teamName')} />}
        <TextField light label="Email" keyboardType="email-address" autoComplete="email" value={form.email} onChangeText={set('email')} />
        <TextField light label="Password" secureTextEntry autoComplete="new-password" value={form.password} onChangeText={set('password')} />
        <Text style={{ color: '#425850', lineHeight: 21 }}>{PASSWORD_POLICY_SUMMARY}</Text>
        <TextField light label="Confirm password" secureTextEntry autoComplete="new-password" value={form.confirmation} onChangeText={set('confirmation')} />
        <Pressable accessibilityRole="checkbox" accessibilityState={{ checked: accepted }} onPress={() => setAccepted(value => !value)} style={{ minHeight: 48, justifyContent: 'center' }}><Text style={{ color: '#173f35', fontSize: 16 }}>{accepted ? '✓ ' : '○ '}I accept the terms and privacy policy</Text></Pressable>
        <View style={{ flexDirection: 'row', gap: 24 }}>
          {[['Terms', 'terms'], ['Privacy policy', 'gdpr']].map(([label, path]) => <Pressable key={path} accessibilityRole="link" onPress={() => Linking.openURL(`https://footballplayer.online/${path}`).catch(() => setError('The link could not be opened. Please try again.'))} style={{ minHeight: 44, justifyContent: 'center' }}><Text style={{ color: '#214c86', textDecorationLine: 'underline' }}>{label}</Text></Pressable>)}
        </View>
        {error ? <Text accessibilityRole="alert" style={{ color: '#a52323' }}>{error}</Text> : null}
        <PrimaryButton loading={busy} disabled={!accepted} onPress={submit}>Create account</PrimaryButton>
      </View>}
      <PrimaryButton disabled={busy} variant="secondary" onPress={onBack}>{complete ? 'Back to sign in' : 'Already have an account? Sign in'}</PrimaryButton>
    </ScrollView>
  </SafeAreaView>
}
