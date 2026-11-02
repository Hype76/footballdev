const text = value => String(value ?? '').trim()
const email = value => text(value).toLowerCase()

// Resolve only the specific parent contact addressed by a current training request.
export async function getTrainingChangeParentLinkIds(db, { clubId, teamId, eventId, now = Date.now() }) {
  if (!clubId || !teamId || !eventId) return []
  const requestsResult = await db.from('training_availability_requests')
    .select('id, status, occurrence_starts_at').eq('club_id', clubId).eq('team_id', teamId).eq('calendar_event_id', eventId)
  if (requestsResult.error) throw requestsResult.error
  const requests = (requestsResult.data || []).filter(request => !['cancelled', 'expired'].includes(text(request.status).toLowerCase()) && Date.parse(request.occurrence_starts_at) > now)
  if (!requests.length) return []
  const byId = new Map(requests.map(request => [text(request.id), request]))
  const playersResult = await db.from('training_availability_request_players')
    .select('request_id, player_id, parent_link_id, recipient_email, recipient_type, status, token_revoked_at, response_deadline_at')
    .eq('club_id', clubId).eq('team_id', teamId).in('request_id', [...byId.keys()])
  if (playersResult.error) throw playersResult.error
  const rows = (playersResult.data || []).filter(row => {
    const request = byId.get(text(row.request_id))
    return request && text(row.recipient_type).toLowerCase() === 'parent'
      && ['pending', 'queued', 'sent', 'failed', 'responded'].includes(text(row.status).toLowerCase())
      && !row.token_revoked_at && Date.parse(row.response_deadline_at || request.occurrence_starts_at) > now
  })
  const playerIds = [...new Set(rows.map(row => text(row.player_id)).filter(Boolean))]
  if (!playerIds.length) return []
  const linksResult = await db.from('parent_player_links').select('id, player_id, email')
    .eq('club_id', clubId).eq('team_id', teamId).eq('status', 'active').in('player_id', playerIds)
  if (linksResult.error) throw linksResult.error
  return [...new Set((linksResult.data || []).filter(link => rows.some(row => text(row.player_id) === text(link.player_id)
    && (text(row.parent_link_id) ? text(row.parent_link_id) === text(link.id) : Boolean(email(row.recipient_email)) && email(row.recipient_email) === email(link.email))))
    .map(link => text(link.id)).filter(Boolean))]
}
