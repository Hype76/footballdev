import * as SecureStore from 'expo-secure-store'
import { getMobileRuntimeConfig } from './config'
import { fetchJsonWithTimeout, joinApiPath } from './http'
import { getAccessToken } from './supabase'
import { getCalendarSubscriptionToken } from './calendarSubscriptionCore.js'

const keyFor = (user, context) => `fp.coach.calendar.${user.id}.${context.id.replace(':', '.')}`

export async function readCoachCalendarSubscription(user, context) {
  return await SecureStore.getItemAsync(keyFor(user, context)) || ''
}

export async function changeCoachCalendarSubscription(user, context, action = 'generate') {
  if (!user?.id || !context?.id || user.isOfflineProfile) throw new Error('Connect and choose an active Coach calendar.')
  const token = await getAccessToken()
  if (!token) throw new Error('Sign in again before connecting your calendar.')
  const config = getMobileRuntimeConfig('coach')
  const key = keyFor(user, context)
  const previousUrl = await SecureStore.getItemAsync(key)
  if (action === 'connect' && previousUrl) return previousUrl
  const previousToken = previousUrl ? getCalendarSubscriptionToken(previousUrl, 'coach') : ''
  const { ok, result } = await fetchJsonWithTimeout(joinApiPath(config.apiBaseUrl, '/.netlify/functions/coach-calendar-feed'), {
    method: action === 'revoke' ? 'DELETE' : 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ contextId: context.id, previousToken }),
  })
  if (!ok || result?.success === false) throw new Error(result?.message || 'The calendar could not be connected.')
  if (action === 'revoke') {
    await SecureStore.deleteItemAsync(key)
    return ''
  }
  if (!/^https:\/\//.test(result?.url || '')) throw new Error('The calendar link was not returned.')
  await SecureStore.setItemAsync(key, result.url, { keychainAccessible: SecureStore.AFTER_FIRST_UNLOCK_THIS_DEVICE_ONLY })
  return result.url
}
