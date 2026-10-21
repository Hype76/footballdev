import { supabase } from '../supabase-client.js'

export async function getClubMatchdayTv({ clubId, date, signal, action, postcode, password }) {
  const { data, error } = await supabase.auth.getSession()
  if (error || !data?.session?.access_token) throw Object.assign(new Error('Sign in again to refresh the display.'), { status: 401 })
  const response = await fetch('/.netlify/functions/club-matchday-tv', {
    method: 'POST', cache: 'no-store', signal,
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${data.session.access_token}` },
    body: JSON.stringify({ clubId, date, action, postcode, password }),
  })
  const payload = await response.json()
  if (!response.ok) throw Object.assign(new Error(payload.message || 'Scores could not be refreshed.'), { status: response.status })
  if (payload.club?.id !== clubId || (!action && (payload.date !== date || !Array.isArray(payload.matches)))) throw new Error('The display response did not match this club and date.')
  return payload
}
