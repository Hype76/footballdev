import { supabase } from './supabase-client.js'

function normalizeText(value) {
  return String(value ?? '').trim()
}

async function callCalendarChangeNotifications(payload) {
  const { data, error } = await supabase.auth.getSession()
  const accessToken = data?.session?.access_token || ''
  if (error || !accessToken) throw error || new Error('Sign in again before notifying families.')

  const response = await fetch('/.netlify/functions/calendar-change-notifications', {
    method: 'POST',
    headers: { Authorization: `Bearer ${accessToken}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  })
  const result = await response.json().catch(() => ({}))
  if (!response.ok || result.success === false) {
    throw new Error(result.message || 'Calendar change notifications could not be sent.')
  }
  return result
}

export async function prepareCalendarChangeNotification({ changeAction, requestToken, sourceId, sourceType }) {
  return callCalendarChangeNotifications({
    changeAction: normalizeText(changeAction),
    operation: 'prepare',
    requestToken: normalizeText(requestToken),
    sourceId: normalizeText(sourceId),
    sourceType: normalizeText(sourceType),
  })
}

export async function commitCalendarChangeNotification(preparationId) {
  return callCalendarChangeNotifications({ operation: 'commit', preparationId: normalizeText(preparationId) })
}
