export const GUEST_SCORER_ENDPOINT = '/.netlify/functions/guest-match-day-scorer'
export async function requestGuestScorer(body, { token = '', origin = '', fetcher = fetch } = {}) {
  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), 20000)
  try {
  const result = await fetcher(origin.replace(/\/$/, '') + GUEST_SCORER_ENDPOINT, {
    method: 'POST', headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: 'Bearer ' + token } : {}) },
    body: JSON.stringify(body), signal: controller.signal, cache: 'no-store',
  })
  const data = await result.json()
  if (!result.ok || data.success === false) throw new Error(data.message || 'The change could not be confirmed. Retry the same change.')
  return data
  } finally { clearTimeout(timeout) }
}
export function newGuestSecret() {
  return Array.from(crypto.getRandomValues(new Uint8Array(32)), (byte) => byte.toString(16).padStart(2, '0')).join('')
}
export function getGuestTimerRequest(action) {
  if (action === 'start') return { action: 'start', details: {} }
  if (['normal_time_complete', 'start_extra_time', 'extra_time_half_time', 'start_extra_time_second_half', 'complete_extra_time', 'start_penalties'].includes(action)) return { action: 'extended', details: { action } }
  return { action: 'timer', details: { action } }
}
