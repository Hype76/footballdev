import { createHash, randomBytes } from 'node:crypto'
import { createSupabaseAdminClient } from './lib/_supabase.js'
import { loadPlayerAttendance } from './lib/_fan-schedule.js'

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{12}$/i
const TOKEN = /^[0-9a-f]{64}$/
const headers = { 'Cache-Control': 'private, no-store', 'X-Content-Type-Options': 'nosniff' }
const json = (statusCode, body) => ({ statusCode, headers: { ...headers, 'Content-Type': 'application/json' }, body: JSON.stringify(body) })
const sha256 = value => createHash('sha256').update(value).digest('hex')
const escapeIcs = value => String(value || '').replace(/\\/g, '\\\\').replace(/\r?\n/g, '\\n').replace(/,/g, '\\,').replace(/;/g, '\\;')
const formatIcsTime = value => {
  const date = new Date(value)
  return Number.isNaN(date.getTime()) ? '' : date.toISOString().replace(/[-:]/g, '').replace(/\.\d{3}/, '')
}
const calendarTime = (item, key, timeKey) => {
  if (item[key]) return { value: formatIcsTime(item[key]), utc: true }
  const date = String(item.date || '')
  const time = String(item[timeKey] || item.time || '00:00').replace(/[^0-9:]/g, '')
  return /^\d{4}-\d{2}-\d{2}$/.test(date) && /^\d{2}:\d{2}(?::\d{2})?$/.test(time)
    ? { value: `${date.replace(/-/g, '')}T${time.replace(/:/g, '').padEnd(6, '0')}`, utc: false }
    : { value: '', utc: false }
}

export function buildAcceptedCalendarFeed(items, parentLinkId) {
  const now = formatIcsTime(new Date())
  const lines = ['BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//Football Player//Accepted calendar//EN', 'CALSCALE:GREGORIAN', 'METHOD:PUBLISH', 'X-WR-CALNAME:Football Player accepted events', 'BEGIN:VTIMEZONE', 'TZID:Europe/London', 'BEGIN:DAYLIGHT', 'DTSTART:19700329T010000', 'TZOFFSETFROM:+0000', 'TZOFFSETTO:+0100', 'RRULE:FREQ=YEARLY;BYMONTH=3;BYDAY=-1SU', 'END:DAYLIGHT', 'BEGIN:STANDARD', 'DTSTART:19701025T020000', 'TZOFFSETFROM:+0100', 'TZOFFSETTO:+0000', 'RRULE:FREQ=YEARLY;BYMONTH=10;BYDAY=-1SU', 'END:STANDARD', 'END:VTIMEZONE']
  for (const item of items) {
    if (!['available', 'yes', 'accepted', 'attending'].includes(String(item.response || '').toLowerCase())) continue
    const start = calendarTime(item, 'starts_at', 'time')
    if (!start.value) continue
    const end = calendarTime(item, 'ends_at', 'end_time')
    lines.push('BEGIN:VEVENT', `UID:${escapeIcs(parentLinkId)}-${escapeIcs(item.id)}@footballplayer.online`, `DTSTAMP:${now}`, `${start.utc ? 'DTSTART' : 'DTSTART;TZID=Europe/London'}:${start.value}`)
    if (end.value && end.value > start.value) lines.push(`${end.utc ? 'DTEND' : 'DTEND;TZID=Europe/London'}:${end.value}`)
    lines.push(`SUMMARY:${escapeIcs(item.title || 'Football Player event')}`)
    if (item.location) lines.push(`LOCATION:${escapeIcs(item.location)}`)
    lines.push('END:VEVENT')
  }
  lines.push('END:VCALENDAR')
  return `${lines.join('\r\n')}\r\n`
}

async function one(query) {
  const { data, error } = await query.maybeSingle()
  if (error) throw error
  return data
}

export async function handleParentCalendarFeed(event, { createClient = createSupabaseAdminClient, loadAttendance = loadPlayerAttendance } = {}) {
  const client = createClient(event)
  try {
    if (event.httpMethod === 'GET') {
      const token = String(event.queryStringParameters?.token || '')
      if (!TOKEN.test(token)) return json(404, { message: 'Calendar feed unavailable.' })
      const saved = await one(client.from('parent_calendar_feed_tokens').select('auth_user_id,parent_link_id').eq('token_hash', sha256(token)).is('revoked_at', null))
      if (!saved) return json(404, { message: 'Calendar feed unavailable.' })
      const link = await one(client.from('parent_player_links').select('id,auth_user_id,player_id,club_id,team_id,status').eq('id', saved.parent_link_id).eq('auth_user_id', saved.auth_user_id).eq('status', 'active'))
      if (!link) return json(404, { message: 'Calendar feed unavailable.' })
      const player = await one(client.from('players').select('id,team_id').eq('id', link.player_id).eq('club_id', link.club_id))
      const club = await one(client.from('clubs').select('id,name').eq('id', link.club_id))
      if (!player || !club) return json(404, { message: 'Calendar feed unavailable.' })
      const scope = { fan: { club_id: link.club_id, relationship_type: 'player', permissions: { schedule: true } }, parent: link, player, club }
      const items = await loadAttendance(client, scope)
      return { statusCode: 200, headers: { ...headers, 'Content-Type': 'text/calendar; charset=utf-8', 'Content-Disposition': 'inline; filename="football-player-accepted.ics"' }, body: buildAcceptedCalendarFeed(items, link.id) }
    }
    if (!['POST', 'DELETE'].includes(event.httpMethod)) return json(405, { message: 'Method not allowed.' })
    const token = String(event.headers?.authorization || event.headers?.Authorization || '').replace(/^Bearer\s+/i, '')
    if (!token) return json(401, { message: 'Sign in to continue.' })
    const auth = await client.auth.getUser(token)
    const authUserId = auth.data?.user?.id
    if (auth.error || !authUserId) return json(401, { message: 'Sign in to continue.' })
    const body = JSON.parse(event.body || '{}')
    const parentLinkId = String(body.parentLinkId || '')
    if (!UUID.test(parentLinkId)) return json(400, { message: 'Choose a linked player.' })
    const link = await one(client.from('parent_player_links').select('id').eq('id', parentLinkId).eq('auth_user_id', authUserId).eq('status', 'active'))
    if (!link) return json(403, { message: 'This player link is unavailable.' })
    if (event.httpMethod === 'DELETE') {
      const result = await client.from('parent_calendar_feed_tokens').delete().eq('parent_link_id', parentLinkId).eq('auth_user_id', authUserId)
      if (result.error) throw result.error
      return json(200, { success: true })
    }
    const secret = randomBytes(32).toString('hex')
    const result = await client.from('parent_calendar_feed_tokens').upsert({ auth_user_id: authUserId, parent_link_id: parentLinkId, token_hash: sha256(secret), revoked_at: null }, { onConflict: 'auth_user_id,parent_link_id' })
    if (result.error) throw result.error
    return json(200, { url: `https://parent.footballplayer.online/.netlify/functions/parent-calendar-feed?token=${secret}` })
  } catch (error) {
    return json(error instanceof SyntaxError ? 400 : 500, { message: error instanceof SyntaxError ? 'Invalid request.' : 'Calendar feed could not be loaded.' })
  }
}

export const handler = event => handleParentCalendarFeed(event)
