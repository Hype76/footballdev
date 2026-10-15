import { assertPasswordPolicy } from '../../../src/lib/password-policy.js'
import { getMobileRuntimeConfig } from './config'
import { fetchJsonWithTimeout } from './http'
import { getAccessToken, supabase } from './supabase'
import { requestFreshCoachSignup } from '../../../src/lib/fresh-coach-signup.js'

export async function mobileAccountRequest(appRole, name, body, expectedActorId = '') {
  const session = expectedActorId ? (await supabase.auth.getSession()).data?.session : null
  if (expectedActorId && session?.user?.id !== expectedActorId) throw new Error('The selected account changed. Open the action again.')
  const token = expectedActorId ? session?.access_token : await getAccessToken()
  if (!token) throw new Error('Sign in again to continue.')
  const { ok, response, result } = await fetchJsonWithTimeout(`${getMobileRuntimeConfig(appRole).apiBaseUrl}/.netlify/functions/${name}`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
  if (!ok || result.success === false) {
    const error = new Error(result.message || 'Please try again in a moment.')
    if (typeof result.code === 'string') error.code = result.code
    if (response?.status) error.status = response.status
    throw error
  }
  return result
}

export async function createMobileAccount({ appRole, name, email, password, teamName }) {
  if (!['coach', 'parent'].includes(appRole)) throw new Error('Choose a valid app.')
  const displayName = String(name || '').trim()
  const clubName = String(teamName || '').trim()
  if (!displayName || displayName.length > 100) throw new Error('Enter your name, up to 100 characters.')
  if (appRole === 'coach' && (!clubName || clubName.length > 120)) throw new Error('Enter your team name, up to 120 characters.')
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(email || '').trim())) throw new Error('Enter a valid email address.')
  assertPasswordPolicy(password)
  const { data, error } = await supabase.auth.signUp({
    email: email.trim().toLowerCase(), password,
    options: {
      emailRedirectTo: appRole === 'coach' ? 'https://footballplayer.online/sign-in' : 'https://parent.footballplayer.online/sign-in',
      data: { name: displayName, display_name: displayName, account_type: appRole, verification_mode: 'app_code',
        ...(appRole === 'coach' ? { club_name: clubName, signup_plan_key: 'matchday' } : {}) },
    },
  })
  if (error) throw error
  if (appRole === 'coach' && data?.user && Array.isArray(data.user.identities) && data.user.identities.length === 0) {
    try {
      const freshSignupRequestId = await requestFreshCoachSignup({ apiBaseUrl: getMobileRuntimeConfig('coach').apiBaseUrl, email: email.trim().toLowerCase(), name: displayName, teamName: clubName })
      return { needsEmailVerification: true, freshSignupRequestId }
    } catch (failure) {
      failure.freshSignupPending = true
      throw failure
    }
  }
  return { needsEmailVerification: !data?.session }
}

export async function verifyMobileAccount(email, token) {
  const code = String(token || '').trim()
  if (!/^\d{6,10}$/.test(code)) throw new Error('Enter the verification code from your newest email.')
  const { error } = await supabase.auth.verifyOtp({ email: String(email || '').trim().toLowerCase(), token: code, type: 'signup' })
  if (error) throw new Error('That code could not be verified. Use the newest email or request another code.')
}

export async function resendMobileAccountCode(email) {
  const { error } = await supabase.auth.resend({ type: 'signup', email: String(email || '').trim().toLowerCase() })
  if (error) throw new Error('Another code could not be sent yet. Wait a minute and try again.')
}
