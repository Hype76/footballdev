import { createHash, randomBytes } from 'node:crypto'
import { createSupabaseAdminClient } from './lib/_supabase.js'
import { loadCoachCalendarAuthority } from './lib/_coach-calendar-authority.js'
import { changeCalendarSubscriptionToken } from './lib/_calendar-subscription-tokens.js'
import { buildAcceptedCalendarFeed } from './parent-calendar-feed.js'
import { buildCoachCalendarEvents } from '../../apps/mobile-core/src/coachCalendarCore.js'
import { getDateInTimeZone } from '../../apps/mobile-core/src/parentCalendarCore.js'

const sha256 = value => createHash('sha256').update(value).digest('hex')
const headers = { 'Cache-Control': 'private, no-store', 'X-Content-Type-Options': 'nosniff', 'Referrer-Policy': 'no-referrer' }
const json = (statusCode, value) => ({ statusCode, headers: { ...headers, 'Content-Type': 'application/json' }, body: JSON.stringify(value) })

async function readPages(createQuery) {
  const rows = []
  for (let offset = 0; offset < 10000; offset += 500) {
    const result = await createQuery().range(offset, offset + 499)
    if (result.error) throw result.error
    rows.push(...(result.data || []))
    if ((result.data || []).length < 500) return rows
  }
  throw new Error('Calendar exceeds the supported window.')
}

export async function loadCoachFeedEvents(client, authority, now = new Date()) {
  const start = getDateInTimeZone(now)
  const endInstant = new Date(`${start}T12:00:00Z`)
  endInstant.setUTCDate(endInstant.getUTCDate() + 90)
  const end = endInstant.toISOString().slice(0, 10)
  const scope = query => authority.teamId
    ? query.eq('club_id', authority.clubId).or(`team_id.eq.${authority.teamId},team_id.is.null`)
    : query.eq('club_id', authority.clubId).is('team_id', null)
  const calendarEvents = await readPages(() => scope(client.from('calendar_events')
    .select('id,team_id,title,event_type,starts_at,ends_at,recurrence_frequency,recurrence_until,location,cancelled_at,updated_at,deleted_occurrence_dates'))
    .lte('starts_at', `${end}T23:59:59Z`).order('starts_at').order('id'))
  const matches = authority.teamId ? await readPages(() => client.from('match_days')
    .select('id,team_id,title,opponent,home_away,match_date,kickoff_time,kickoff_time_tbc,match_duration_minutes,status,venue_name,venue_address,updated_at,deleted_at')
    .eq('club_id', authority.clubId).eq('team_id', authority.teamId).is('deleted_at', null)
    .gte('match_date', start).lte('match_date', end).order('match_date').order('id')) : []
  const sessions = authority.teamId ? await readPages(() => client.from('assessment_sessions')
    .select('id,team_id,title,session_type,session_date,start_time,end_time,location,status,updated_at')
    .eq('club_id', authority.clubId).eq('team_id', authority.teamId)
    .gte('session_date', start).lte('session_date', end).order('session_date').order('id')) : []
  const deletedDates = new Map(calendarEvents.map(event => [event.id, new Set(event.deleted_occurrence_dates || [])]))
  return buildCoachCalendarEvents({ calendarEvents, matches: matches.map(row => ({ ...row,
    kickoff_time_tbc: row.kickoff_time_tbc === true || !String(row.kickoff_time || '').trim(),
  })), sessions, recurrenceWindow: { windowStart: start, windowEnd: end } })
    .filter(event => event.calendarDate >= start && event.calendarDate <= end && !event.dateTimeIssue
      && !(event.sourceType === 'calendar_event' && deletedDates.get(event.sourceId)?.has(event.occurrenceDate)))
    .map(event => ({
      id: `${event.sourceType}:${event.sourceId}${event.recurrenceFrequency !== 'none' ? `:${event.occurrenceDate}` : ''}`, title: event.title, date: event.calendarDate, time: event.kickoffTimeTbc ? '' : event.calendarTime,
      starts_at: event.kickoffTimeTbc ? event.calendarDate : event.startsAt, ends_at: event.kickoffTimeTbc ? '' : event.endsAt,
      location: event.location, status: event.status, cancelled_at: event.cancelledAt, updated_at: event.updatedAt,
      event_type: event.sourceType === 'match_day' ? 'match_day' : event.eventType, response: 'available',
    }))
}

export async function handleCoachCalendarFeed(event, { client = createSupabaseAdminClient(event), now = new Date() } = {}) {
  try {
    if (event.httpMethod === 'GET') {
      const token = String(event.queryStringParameters?.token || '')
      if (!/^[a-f0-9]{64}$/.test(token)) return json(404, { message: 'Calendar unavailable.' })
      const saved = await client.from('coach_calendar_feed_tokens').select('auth_user_id,context_id,club_id,team_id')
        .eq('token_hash', sha256(token)).maybeSingle()
      if (saved.error) throw saved.error
      if (!saved.data) return json(404, { message: 'Calendar unavailable.' })
      const owner = await client.auth.admin.getUserById(saved.data.auth_user_id)
      if (owner.error || !owner.data?.user || owner.data.user.banned_until && Date.parse(owner.data.user.banned_until) > now.getTime()) {
        return json(404, { message: 'Calendar unavailable.' })
      }
      const authority = await loadCoachCalendarAuthority(client, owner.data.user, saved.data.context_id)
      if (authority.clubId !== saved.data.club_id || authority.teamId !== saved.data.team_id) return json(404, { message: 'Calendar unavailable.' })
      const items = await loadCoachFeedEvents(client, authority, now)
      const body = buildAcceptedCalendarFeed(items, `${saved.data.auth_user_id}-${authority.contextId}`)
        .replace('X-WR-CALNAME:Football Player accepted events', 'X-WR-CALNAME:Football Player Coach calendar')
      return { statusCode: 200, headers: { ...headers, 'Content-Type': 'text/calendar; charset=utf-8' }, body }
    }
    if (!['POST', 'DELETE'].includes(event.httpMethod)) return json(405, { message: 'Method not allowed.' })
    const token = String(event.headers?.authorization || event.headers?.Authorization || '').replace(/^Bearer\s+/i, '')
    if (!token) return json(401, { message: 'Sign in to continue.' })
    const auth = await client.auth.getUser(token)
    if (auth.error || !auth.data?.user) return json(401, { message: 'Sign in to continue.' })
    if ((event.body || '').length > 2048) return json(413, { message: 'Request too large.' })
    const body = JSON.parse(event.body || '{}')
    const authority = await loadCoachCalendarAuthority(client, auth.data.user, body.contextId)
    const previousToken = String(body.previousToken || '')
    if (event.httpMethod === 'DELETE') {
      if (!previousToken) return json(400, { message: 'Choose the calendar link to revoke.' })
      await changeCalendarSubscriptionToken(client, { tables: ['coach_calendar_feed_tokens'],
        scope: { auth_user_id: auth.data.user.id, context_id: authority.contextId }, previousToken })
      return json(200, { success: true })
    }
    const secret = randomBytes(32).toString('hex')
    await changeCalendarSubscriptionToken(client, { tables: ['coach_calendar_feed_tokens'],
      scope: { auth_user_id: auth.data.user.id, club_id: authority.clubId, team_id: authority.teamId, context_id: authority.contextId },
      previousToken, nextToken: secret })
    return json(200, { url: `https://footballplayer.online/.netlify/functions/coach-calendar-feed?token=${secret}` })
  } catch (error) {
    const statusCode = error instanceof SyntaxError ? 400 : [400, 401, 403, 410].includes(error.statusCode) ? error.statusCode : 500
    return json(statusCode, { message: 'Calendar could not be loaded. Check your access and try again.' })
  }
}

export const handler = event => handleCoachCalendarFeed(event)
