import { fetchJsonWithTimeout, joinApiPath } from '../../mobile-core/src/http'
import { getAccessToken } from '../../mobile-core/src/supabase'

function normalizeChannel(value) {
  const channel = String(value ?? '').trim().toLowerCase()
  return ['app', 'email', 'both'].includes(channel) ? channel : 'both'
}

async function requestPreference({ apiBaseUrl, communicationChannel = '', method = 'GET' } = {}) {
  const accessToken = await getAccessToken()
  if (!accessToken) throw new Error('Sign in again before changing communication settings.')
  if (!apiBaseUrl) throw new Error('Communication settings are not ready for this build.')

  const { ok, result } = await fetchJsonWithTimeout(
    joinApiPath(apiBaseUrl, '/.netlify/functions/parent-communication-preferences'),
    {
      method,
      headers: {
        Authorization: `Bearer ${accessToken}`,
        'Content-Type': 'application/json',
      },
      ...(method === 'PUT' ? { body: JSON.stringify({ communicationChannel: normalizeChannel(communicationChannel) }) } : {}),
    },
  )

  if (!ok || result.success === false) throw new Error(result.message || 'Communication settings could not be saved.')
  return {
    communicationChannel: normalizeChannel(result.preference?.communicationChannel),
    updatedAt: result.preference?.updatedAt || '',
  }
}

export function getParentCommunicationPreference(apiBaseUrl) {
  return requestPreference({ apiBaseUrl })
}

export function updateParentCommunicationPreference(apiBaseUrl, communicationChannel) {
  return requestPreference({ apiBaseUrl, communicationChannel, method: 'PUT' })
}
