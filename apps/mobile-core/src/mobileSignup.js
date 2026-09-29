import { assertPasswordPolicy } from '../../../src/lib/password-policy.js'
import { getMobileRuntimeConfig } from './config'
import { fetchJsonWithTimeout } from './http'
import { getAccessToken, supabase } from './supabase'

export async function mobileAccountRequest(appRole, name, body) {
  const token = await getAccessToken()
  if (!token) throw new Error('Sign in again to continue.')
  const { ok, result } = await fetchJsonWithTimeout(`${getMobileRuntimeConfig(appRole).apiBaseUrl}/.netlify/functions/${name}`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
  if (!ok || result.success === false) throw new Error(result.message || 'Please try again in a moment.')
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
      data: { name: displayName, display_name: displayName, account_type: appRole,
        ...(appRole === 'coach' ? { club_name: clubName, signup_plan_key: 'matchday' } : {}) },
    },
  })
  if (error) throw error
  return { needsEmailVerification: !data?.session }
}
