import { createHash } from 'node:crypto'
import { resolveEligibleEventInvitationContacts } from './_match-day-actionable-invitation.js'
import { loadActiveAuthorityProfile } from './_authority-profile.js'
import { buildOccurrences } from './_training-calendar.js'

const text = value => String(value ?? '').trim()
const escape = value => text(value).replace(/[&<>"']/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[char])
export function normalizeAvailabilityFollowUp(value) {
  const message = text(value)
  if (!message || message.length > 500) throw Object.assign(new Error('Enter a follow-up message of 1 to 500 characters.'), { statusCode: 400 })
  return message
}

async function followUpScope(client, scope) {
  const isMatch = scope.sourceType === 'match-day'
  const eventResult = await client.from(isMatch ? 'match_days' : 'calendar_events')
    .select(isMatch ? 'id,club_id,team_id,status,deleted_at,match_date,opponent' : 'id,club_id,team_id,event_type,title,starts_at,ends_at,recurrence_frequency,recurrence_until,cancelled_at')
    .eq('id', scope.eventId).eq('club_id', scope.clubId).eq('team_id', scope.teamId).maybeSingle()
  if (eventResult.error) throw eventResult.error
  const event = eventResult.data
  const today = new Date().toISOString().slice(0, 10)
  const valid = isMatch
    ? event && !event.deleted_at && !['cancelled', 'completed', 'full_time', 'postponed'].includes(event.status) && event.match_date >= today
    : event && event.event_type === 'training' && !event.cancelled_at && buildOccurrences(event).some(item => item.occurrenceDate === scope.occurrenceDate && item.occurrenceStartsAt.getTime() > Date.now())
  if (!valid) throw Object.assign(new Error('This event is no longer open for follow-up messages.'), { statusCode: 409 })
  const invite = await client.from('calendar_event_invites').select('id')
    .eq(isMatch ? 'match_day_id' : 'calendar_event_id', event.id).eq('club_id', scope.clubId).eq('team_id', scope.teamId)
    .eq('player_id', scope.playerId).neq('invite_status', 'cancelled').is('cancelled_at', null).maybeSingle()
  if (invite.error) throw invite.error
  if (!invite.data?.id) throw Object.assign(new Error('This Player no longer has an active invitation.'), { statusCode: 409 })
  if (!isMatch) {
    const excluded = await client.from('event_player_occurrence_exclusions').select('scope,effective_from_date').eq('calendar_event_id', event.id).eq('player_id', scope.playerId)
    if (excluded.error) throw excluded.error
    if ((excluded.data || []).some(item => item.scope === 'occurrence' ? item.effective_from_date === scope.occurrenceDate : item.scope === 'this_and_future' && item.effective_from_date <= scope.occurrenceDate)) throw Object.assign(new Error('This Player was removed from this occurrence.'), { statusCode: 409 })
  }
  const contacts = await resolveEligibleEventInvitationContacts(client, { clubId: scope.clubId, teamId: scope.teamId, playerIds: [scope.playerId] })
  return { event, contacts }
}

export async function queueAvailabilityFollowUp({ client, profile, scopedEvent, sourceType, occurrenceDate, playerId, message, idempotencyKey }) {
  message = normalizeAvailabilityFollowUp(message)
  const scope = { eventId: scopedEvent.id, clubId: scopedEvent.club_id, teamId: scopedEvent.team_id, sourceType, occurrenceDate, playerId }
  const { event, contacts } = await followUpScope(client, scope)
  if (!contacts.length) throw Object.assign(new Error('No eligible recipient is linked to this Player.'), { statusCode: 409 })
  const subject = `Availability follow-up: ${text(event.title || event.opponent) || 'Team event'}`
  const rows = contacts.map(contact => {
    const hash = createHash('sha256').update(`${idempotencyKey}:${contact.email}:${contact.parentLinkId || ''}`).digest('hex')
    const id = `${hash.slice(0, 8)}-${hash.slice(8, 12)}-5${hash.slice(13, 16)}-a${hash.slice(17, 20)}-${hash.slice(20, 32)}`
    const metadata = {
      source: 'club_announcement', authorType: 'club_staff', type: 'availability_follow_up', body: message, subject,
      recipientLinkId: contact.parentLinkId || '', parentLinkId: contact.parentLinkId || '', teamId: scope.teamId,
      ...(sourceType === 'match-day' ? { matchDayId: scope.eventId } : { calendarEventId: scope.eventId, occurrenceDate }),
    }
    return {
      id, club_id: scope.clubId, team_id: scope.teamId, created_by: profile.id, created_by_email: profile.email,
      to_email: contact.email, subject, status: 'scheduled', scheduled_at: new Date().toISOString(),
      payload: {
        requiredFeature: 'parentEmails', displayName: 'Football Player', clubId: scope.clubId, teamId: scope.teamId,
        actorId: profile.id, actorRole: profile.role, parentLinkId: contact.parentLinkId || '',
        availabilityFollowUp: { ...scope, recipientEmail: contact.email, parentLinkId: contact.parentLinkId || '', actorId: profile.id },
        resendPayload: { to: [contact.email], subject, text: message, html: `<p>${escape(message).replace(/\n/g, '<br>')}</p><p>Your existing availability response has not changed. Open Football Player Parents to review it.</p>` },
        communicationLog: { clubId: scope.clubId, playerId, userId: profile.id, userName: text(profile.display_name || profile.name), userEmail: profile.email, recipientEmail: contact.email, metadata },
      },
    }
  })
  const result = await client.from('scheduled_email_queue').upsert(rows, { onConflict: 'id', ignoreDuplicates: true })
  if (result.error) throw result.error
  return { playerId, queuedCount: rows.length, recipientCount: rows.length, sentCount: 0, requestState: 'follow_up_queued' }
}

export async function prepareScheduledAvailabilityFollowUpRow(row, client) {
  const scope = row.payload?.availabilityFollowUp
  if (!scope) return { row, skipped: false, skipReason: '' }
  if (scope.clubId !== row.club_id || scope.teamId !== row.team_id || scope.recipientEmail !== row.to_email || scope.actorId !== row.created_by) return { row, skipped: true, skipReason: 'Follow-up scope does not match its queue record.' }
  try {
    const profile = await loadActiveAuthorityProfile(client, { id: scope.actorId })
    if (profile.club_id !== scope.clubId || Number(profile.role_rank) < 20 || profile.role === 'super_admin') throw Object.assign(new Error('Staff access changed.'), { statusCode: 403 })
    if (Number(profile.role_rank) < 50) {
      const staff = await client.from('team_staff').select('team_id').eq('team_id', scope.teamId).eq('user_id', profile.id).maybeSingle()
      if (staff.error) throw staff.error
      if (!staff.data) throw Object.assign(new Error('Team access changed.'), { statusCode: 403 })
    }
    const { contacts } = await followUpScope(client, scope)
    if (!contacts.some(contact => contact.email === scope.recipientEmail && text(contact.parentLinkId) === text(scope.parentLinkId))) throw Object.assign(new Error('Recipient access changed.'), { statusCode: 409 })
    return { row, skipped: false, skipReason: '' }
  } catch (error) {
    if (![403, 409].includes(error.statusCode)) throw error
    return { row, skipped: true, skipReason: error.message }
  }
}
