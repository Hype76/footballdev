import { useRef, useState } from 'react'
import { SafeAreaView, ScrollView, Text } from 'react-native'
import { useDeviceAppearance } from './useDeviceAppearance'
import { createParentMobileTheme } from './parentThemeCore'
import { PrimaryButton, TextField } from './ui'
import { supabase } from './supabase'
import { assertPasswordPolicy, PASSWORD_POLICY_SUMMARY } from '../../../src/lib/password-policy.js'

export function MobilePasswordRecovery({ appRole, email, onComplete, onCancel, onResend }) {
  const [code, setCode] = useState('')
  const [password, setPassword] = useState('')
  const [confirmation, setConfirmation] = useState('')
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')
  const [busy, setBusy] = useState(false)
  const pending = useRef(false)
  const verified = useRef(false)
  const mode = useDeviceAppearance(appRole)
  const tokens = createParentMobileTheme({ mode }).tokens
  async function cancel() {
    if (pending.current) return
    pending.current = true; setBusy(true); setError('')
    try { await onCancel() }
    catch (failure) { setError(failure.message || 'Sign out could not be completed. Try again.') }
    finally { pending.current = false; setBusy(false) }
  }
  async function act(resend = false) {
    if (pending.current) return
    pending.current = true; setBusy(true); setError(''); setNotice('')
    try {
      if (resend) {
        await onResend(email); verified.current = false; setCode('')
        setNotice('A new code has been requested. Check your newest email.')
      } else {
        assertPasswordPolicy(password)
        if (password !== confirmation) throw new Error('Your passwords do not match.')
        if (!verified.current) {
          if (!/^\d{6,10}$/.test(code.trim())) throw new Error('Enter the recovery code from your email.')
          const result = await supabase.auth.verifyOtp({ email, token: code.trim(), type: 'recovery' })
          if (result.error || !result.data?.session || result.data.user?.email?.toLowerCase() !== email) throw new Error('This code could not be verified. Check your newest email or request another code.')
          verified.current = true
        }
        const { data: sessionData } = await supabase.auth.getSession()
        if (sessionData.session?.user?.email?.toLowerCase() !== email) { verified.current = false; throw new Error('Recovery access changed. Request another code.') }
        const result = await supabase.auth.updateUser({ password })
        if (result.error) throw result.error
        setPassword(''); setConfirmation(''); onComplete()
      }
    } catch (failure) { setError(failure.message || 'Password recovery could not be completed. Try again.') }
    finally { pending.current = false; setBusy(false) }
  }
  return <SafeAreaView style={{ flex: 1, backgroundColor: tokens.portalBackground }}>
    <ScrollView keyboardShouldPersistTaps="handled" automaticallyAdjustKeyboardInsets contentContainerStyle={{ padding: 24, gap: 16, maxWidth: 560, width: '100%', alignSelf: 'center' }}>
      <Text accessibilityRole="header" style={{ fontSize: 28, fontWeight: '800', color: tokens.textPrimary }}>Reset your password</Text>
      <Text style={{ color: tokens.textSecondary, lineHeight: 24 }}>If an account exists for {email}, enter the code from the newest recovery email and choose your new password here.</Text>
      <TextField light={mode === 'light'} label="Recovery code" keyboardType="number-pad" autoComplete="one-time-code" value={code} onChangeText={setCode} />
      <TextField light={mode === 'light'} label="New password" secureTextEntry autoComplete="new-password" value={password} onChangeText={setPassword} />
      <Text style={{ color: tokens.textSecondary }}>{PASSWORD_POLICY_SUMMARY}</Text>
      <TextField light={mode === 'light'} label="Confirm new password" secureTextEntry autoComplete="new-password" value={confirmation} onChangeText={setConfirmation} />
      {error ? <Text accessibilityRole="alert" style={{ color: tokens.danger }}>{error}</Text> : null}
      {notice ? <Text accessibilityLiveRegion="polite" style={{ color: tokens.textSecondary }}>{notice}</Text> : null}
      <PrimaryButton themeTokens={tokens} loading={busy} onPress={() => void act()}>Save new password</PrimaryButton>
      <PrimaryButton themeTokens={tokens} disabled={busy} variant="secondary" onPress={() => void act(true)}>Send another code</PrimaryButton>
      <PrimaryButton themeTokens={tokens} disabled={busy} variant="secondary" onPress={() => void cancel()}>Back to sign in</PrimaryButton>
    </ScrollView>
  </SafeAreaView>
}
