import { fetchJsonWithTimeout, joinApiPath } from '../../mobile-core/src/http.js'
import { getAccessToken } from '../../mobile-core/src/supabase.js'

const normalize = (value) => String(value ?? '').trim().toLowerCase()

async function requestPreference({ apiBaseUrl, communicationChannel = '', method = 'GET' }) {
  const accessToken = await getAccessToken()
  if (!accessToken) throw new Error('Sign in before changing communication settings.')

  const { ok, response, result } = await fetchJsonWithTimeout(
    joinApiPath(apiBaseUrl, '/.netlify/functions/parent-communication-preferences'),
    {
      method,
      headers: {
        Authorization: `Bearer ${accessToken}`,
        'Content-Type': 'application/json',
      },
      ...(method === 'PUT' ? { body: JSON.stringify({ communicationChannel }) } : {}),
    },
  )

  if (!ok || result.success === false) {
    const error = new Error(result.message || 'Communication settings could not be saved.')
    error.status = response.status
    throw error
  }

  const channel = normalize(result.preference?.communicationChannel)
  return ['app', 'email', 'both'].includes(channel) ? channel : 'both'
}

export function loadParentCommunicationPreference(apiBaseUrl) {
  return requestPreference({ apiBaseUrl })
}

export function saveParentCommunicationPreference(apiBaseUrl, communicationChannel) {
  return requestPreference({ apiBaseUrl, communicationChannel, method: 'PUT' })
}
