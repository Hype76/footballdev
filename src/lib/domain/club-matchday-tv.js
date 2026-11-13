import { supabase } from '../supabase-client.js'
import { clubTvDate, TV_SPONSOR_BUCKET, tvUpcomingPeriodWindow } from '../club-matchday-tv.js'

export async function getClubMatchdayTv({ clubId, date, period, signal, action, postcode, password, slug, preferences, revision, imagePath, mimeType, bytes }) {
  const { data, error } = await supabase.auth.getSession()
  const token = error ? '' : data?.session?.access_token
  const linkedRead = Boolean(slug) && (!action || action === 'view' || action === 'weather' || action === 'sponsorArtwork')
  if (!token && !linkedRead) throw Object.assign(new Error('Sign in again to refresh the display.'), { status: 401 })
  const headers = { 'Content-Type': 'application/json' }
  if (token) headers.Authorization = `Bearer ${token}`
  const response = await fetch('/.netlify/functions/club-matchday-tv', {
    method: 'POST', cache: 'no-store', signal,
    headers,
    body: JSON.stringify({ clubId, date, period, action, postcode, password, slug, preferences, revision, imagePath, mimeType, bytes }),
  })
  const payload = await response.json()
  if (!response.ok) throw Object.assign(new Error(payload.message || 'Scores could not be refreshed.'), { status: response.status, availability: payload.availability })
  if ((action === 'view' ? !payload.club?.id : payload.club?.id !== clubId) || (!action && (payload.date !== date || !Array.isArray(payload.matches)))) throw new Error('The display response did not match this club and date.')
  if (!action && period && period !== 'day') {
    const refreshedAt = new Date(payload.refreshedAt)
    const expected = Number.isFinite(refreshedAt.getTime()) ? tvUpcomingPeriodWindow(date, period, clubTvDate(refreshedAt)) : null
    if (!expected || payload.window?.kind !== expected.kind || payload.window?.startDate !== expected.startDate || payload.window?.endDate !== expected.endDate) throw new Error('The display response did not match the selected date range.')
  }
  return payload
}

export async function uploadClubTvSponsor(clubId, file) {
  const { upload } = await getClubMatchdayTv({ clubId, action: 'sponsorUpload', mimeType: file.type, bytes: file.size })
  const { error } = await supabase.storage.from(TV_SPONSOR_BUCKET)
    .uploadToSignedUrl(upload.path, upload.token, file, { contentType: file.type, cacheControl: '300' })
  if (error) throw error
  return upload.path
}
