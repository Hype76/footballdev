import { useRef, useState } from 'react'
import { Image, Pressable, SafeAreaView, ScrollView, Text, View } from 'react-native'
import { useDeviceAppearance } from './useDeviceAppearance'
import { createParentMobileTheme } from './parentThemeCore'
import { PrimaryButton, TextField } from './ui'
import { createMobileAccount, resendMobileAccountCode, verifyMobileAccount } from './mobileSignup'
import { MobileLegalNotice } from './MobileLegalNotice'
import { getMobileConnectionErrorMessage } from './mobileFetchCore'
import { PASSWORD_POLICY_SUMMARY } from '../../../src/lib/password-policy.js'

export function MobileSignupScreen({ appRole, logoSource, onBack }) {
  const [form, setForm] = useState({ name: '', teamName: '', email: '', password: '', confirmation: '' })
  const [accepted, setAccepted] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [complete, setComplete] = useState(false)
  const [code, setCode] = useState('')
  const [notice, setNotice] = useState('')
  const [status, setStatus] = useState('')
  const inFlight = useRef(false)
  const mode = useDeviceAppearance(appRole)
  const tokens = createParentMobileTheme({ mode }).tokens
  const coach = appRole === 'coach'
  const set = key => value => setForm(current => ({ ...current, [key]: value }))
  async function submit() {
    if (inFlight.current) return
    setError('')
    if (form.password !== form.confirmation) { setError('Your passwords do not match.'); return }
    if (!accepted) { setError('Please accept the terms and privacy policy.'); return }
    inFlight.current = true; setBusy(true)
    try { await createMobileAccount({ ...form, appRole }); setComplete(true); setForm(current => ({ ...current, password: '', confirmation: '' })) }
    catch (failure) { setError(getMobileConnectionErrorMessage(failure) ? 'We could not confirm account creation. Check your connection and try again. If your code has arrived, choose Enter verification code below. Your details are still here.' : failure.message || 'Account creation could not be completed. Please try again.') }
    finally { inFlight.current = false; setBusy(false) }
  }
  async function verification(resend = false) {
    if (inFlight.current) return
    inFlight.current = true; setBusy(true); setError(''); setStatus('')
    try {
      if (resend) { await resendMobileAccountCode(form.email); setStatus('A new code has been requested. Check your newest email.'); setCode('') }
      else await verifyMobileAccount(form.email, code)
    } catch (failure) { setError(failure.message || 'Verification could not be completed. Try again.') }
    finally { inFlight.current = false; setBusy(false) }
  }
  return <SafeAreaView style={{ flex: 1, backgroundColor: tokens.portalBackground }}>
    <ScrollView keyboardShouldPersistTaps="handled" automaticallyAdjustKeyboardInsets contentContainerStyle={{ padding: 24, paddingTop: 48, gap: 18, maxWidth: 560, width: '100%', alignSelf: 'center' }}>
      <Image source={logoSource} style={{ width: 72, height: 72 }} />
      <Text style={{ fontSize: 30, fontWeight: '800', color: tokens.textPrimary }}>{complete ? 'Check your email' : 'Create your account'}</Text>
      <Text style={{ fontSize: 16, lineHeight: 24, color: tokens.textSecondary }}>{complete ? `Enter the verification code from the newest email sent to ${form.email.trim()} to finish here in the app. If you already have an account, sign in or use Forgot password.` : coach ? 'Start with free Match Day. Set up your team, invite parents and share live match alerts.' : 'Stay close to your player. Create your account now, then connect using an invitation from your team.'}</Text>
      {!complete && <View style={{ gap: 14 }}>
        <TextField editable={!busy} light={mode === 'light'} label="Your name" autoCapitalize="words" value={form.name} onChangeText={set('name')} />
        {coach && <TextField editable={!busy} light={mode === 'light'} label="Team name" autoCapitalize="words" value={form.teamName} onChangeText={set('teamName')} />}
        <TextField editable={!busy} light={mode === 'light'} label="Email" keyboardType="email-address" autoComplete="email" value={form.email} onChangeText={set('email')} />
        <TextField editable={!busy} light={mode === 'light'} label="Password" secureTextEntry autoComplete="new-password" value={form.password} onChangeText={set('password')} />
        <Text style={{ color: tokens.textSecondary, lineHeight: 21 }}>{PASSWORD_POLICY_SUMMARY}</Text>
        <TextField editable={!busy} light={mode === 'light'} label="Confirm password" secureTextEntry autoComplete="new-password" value={form.confirmation} onChangeText={set('confirmation')} />
        <Pressable accessibilityRole="checkbox" accessibilityState={{ checked: accepted }} onPress={() => setAccepted(value => !value)} style={{ minHeight: 48, justifyContent: 'center' }}><Text style={{ color: tokens.textPrimary, fontSize: 16 }}>{accepted ? '✓ ' : '○ '}I accept the terms and privacy policy</Text></Pressable>
        <View style={{ flexDirection: 'row', gap: 24 }}>
          {[['Terms', 'terms'], ['Privacy policy', 'gdpr']].map(([label, path]) => <Pressable key={path} accessibilityRole="button" onPress={() => setNotice(path)} style={{ minHeight: 44, justifyContent: 'center' }}><Text style={{ color: tokens.accentText, textDecorationLine: 'underline' }}>{label}</Text></Pressable>)}
        </View>
        {error ? <Text accessibilityRole="alert" style={{ color: tokens.danger }}>{error}</Text> : null}
        <PrimaryButton themeTokens={tokens} loading={busy} disabled={!accepted} onPress={submit}>Create account</PrimaryButton>
        {error && form.email.trim() ? <PrimaryButton themeTokens={tokens} disabled={busy} variant="secondary" onPress={() => { setError(''); setComplete(true) }}>Enter verification code</PrimaryButton> : null}
      </View>}
      {complete && <View style={{ gap: 14 }}>
        <TextField light={mode === 'light'} label="Verification code" keyboardType="number-pad" autoComplete="one-time-code" value={code} onChangeText={setCode} />
        {error ? <Text accessibilityRole="alert" style={{ color: tokens.danger }}>{error}</Text> : null}
        {status ? <Text accessibilityLiveRegion="polite" style={{ color: tokens.textSecondary }}>{status}</Text> : null}
        <PrimaryButton themeTokens={tokens} loading={busy} onPress={() => verification()}>Verify and continue</PrimaryButton>
        <PrimaryButton themeTokens={tokens} disabled={busy} variant="secondary" onPress={() => verification(true)}>Send another code</PrimaryButton>
      </View>}
      <PrimaryButton themeTokens={tokens} disabled={busy} variant="secondary" onPress={onBack}>{complete ? 'Back to sign in' : 'Already have an account? Sign in'}</PrimaryButton>
    </ScrollView>
    <MobileLegalNotice notice={notice} tokens={tokens} onClose={() => setNotice('')} />
  </SafeAreaView>
}
