import { getAuthenticatedPlanProfile } from './lib/_plan-gate.js'
import { supabaseAdmin } from './lib/_supabase.js'

const uuid = (value) => /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(String(value || ''))
const reply = (statusCode, body) => ({ statusCode, headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' }, body: JSON.stringify(body) })

function validOccurrenceDate(value) {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false
  const date = new Date(`${value}T00:00:00Z`)
  return Number.isFinite(date.getTime()) && date.toISOString().slice(0, 10) === value
}

async function readAllRows(makeQuery) {
  const rows = []
  for (let start = 0; ; start += 200) {
    const result = await makeQuery().order('id').range(start, start + 199)
    if (result.error) throw result.error
    if (!Array.isArray(result.data)) throw new Error('Invitation history is unavailable.')
    rows.push(...result.data)
    if (result.data.length < 200) return rows
    if (start >= 9800) throw new Error('This invitation history is too large to load safely.')
  }
}

export async function readCoachInviteHistory({ db, profile, eventId, playerId, kind, occurrenceDate }) {
  if (!uuid(eventId) || !uuid(playerId) || !['training', 'match'].includes(kind)
    || (kind === 'training' && !validOccurrenceDate(occurrenceDate))) {
    throw Object.assign(new Error('Choose an invitation and session date.'), { statusCode: 400 })
  }
  if (!profile?.id || !profile.clubId || !Number.isFinite(Number(profile.roleRank)) || Number(profile.roleRank) < 20
    || !profile.role || ['parent_portal', 'adult_player', 'super_admin'].includes(profile.role)) {
    throw Object.assign(new Error('Coach access is required.'), { statusCode: 403 })
  }
  const event = await db.from(kind === 'training' ? 'calendar_events' : 'match_days').select('id,club_id,team_id')
    .eq('id', eventId).eq('club_id', profile.clubId).single()
  if (event.error || !event.data?.team_id) throw Object.assign(new Error('This event is not available to your team.'), { statusCode: 403 })
  if (profile.role !== 'admin') {
    const membership = await db.from('team_staff').select('team_id').eq('team_id', event.data.team_id).eq('user_id', profile.id).maybeSingle()
    if (membership.error || !membership.data) throw Object.assign(new Error('You need access to this team.'), { statusCode: 403 })
  }
  const player = await db.from('players').select('id').eq('id', playerId).eq('club_id', profile.clubId).eq('team_id', event.data.team_id).single()
  if (player.error || !player.data) throw Object.assign(new Error('This player is not in this team.'), { statusCode: 403 })
  const payloadScope = kind === 'training'
    ? { trainingInvitation: { eventId, playerId, occurrenceDate } }
    : { matchDayAvailability: { matchDayId: eventId, playerId } }
  const emailRows = await readAllRows(() => db.from('email_logs')
      .select('id,provider_message_id,provider_accepted_at,provider_delivered_at,delivery_state')
      .eq('payload->>clubId', profile.clubId).contains('payload', payloadScope)
      .or('provider_accepted_at.not.is.null,and(provider_message_id.not.is.null,delivery_state.in.(provider_accepted,delivered))'))
  // A provider retry can return the same message ID. Count that message once.
  const emails = new Map()
  for (const row of emailRows) {
    const key = row.provider_message_id || row.id
    // Historical provider evidence can lack an acceptance timestamp. Count it,
    // but never present the log creation time as the actual send time.
    const at = row.provider_accepted_at || null
    if (!emails.has(key) || (at && (!emails.get(key) || Date.parse(at) < Date.parse(emails.get(key))))) emails.set(key, at)
  }
  const resendRows = await readAllRows(() => {
    let query = db.from('audit_logs').select('id,created_at,metadata')
      .eq('club_id', profile.clubId).eq('entity_id', eventId)
      .eq('action', 'event_player_invitation_resend').eq('metadata->>playerId', playerId)
      .eq('metadata->>sourceType', kind === 'training' ? 'calendar' : 'match-day')
    if (kind === 'training') query = query.eq('metadata->>occurrenceDate', occurrenceDate)
    return query
  })
  // Legacy audits without a command key remain individual recorded requests.
  const resends = [...new Map(resendRows.sort((a, b) => Date.parse(a.created_at) - Date.parse(b.created_at))
    .map((row) => [row.metadata?.idempotencyKey || row.id, row])).values()]
    .sort((a, b) => Date.parse(b.created_at) - Date.parse(a.created_at))
  return {
    firstEmailSentAt: [...emails.values()].filter((at) => Number.isFinite(Date.parse(at))).sort((a, b) => Date.parse(a) - Date.parse(b))[0] || null,
    emailSends: emails.size,
    resendRequests: resends.length,
    recentEmailSends: [...emails.values()].filter((at) => Number.isFinite(Date.parse(at))).sort((a, b) => Date.parse(b) - Date.parse(a)).slice(0, 10),
    recentResendRequests: resends.slice(0, 10).map((row) => ({ at: row.created_at, queued: Number(row.metadata?.recipientCount || 0), failed: Number(row.metadata?.failedCount || 0) })),
  }
}

export async function handler(event) {
  if (event.httpMethod !== 'POST') return reply(405, { success: false, message: 'Method Not Allowed' })
  try {
    const profile = await getAuthenticatedPlanProfile(event)
    let body
    try { body = JSON.parse(event.body || '{}') } catch { throw Object.assign(new Error('Invalid request.'), { statusCode: 400 }) }
    if (!body || typeof body !== 'object' || Array.isArray(body)) throw Object.assign(new Error('Invalid request.'), { statusCode: 400 })
    const history = await readCoachInviteHistory({ db: supabaseAdmin, profile, eventId: body.eventId, playerId: body.playerId, kind: body.kind, occurrenceDate: body.occurrenceDate })
    return reply(200, { success: true, history })
  } catch (error) {
    return reply(error.statusCode || 500, { success: false, message: error.statusCode ? error.message : 'Invitation history could not be loaded. Please try again.' })
  }
}
