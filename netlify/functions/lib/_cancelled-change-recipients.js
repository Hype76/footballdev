const text = value => String(value ?? '').trim()
const email = value => text(value).toLowerCase()
import { getTrainingChangeParentLinkIds } from './_training-change-recipients.js'

// The prepared audience is an upper bound, never authority to send after access changes.
export async function getCurrentCancellationRecipients(db, { clubId, teamId, sourceId, sourceType, source, preparedIds = [] }) {
  if (!source || !preparedIds.length) return []
  if (['calendar', 'match-day'].includes(sourceType) && (source.parent_visible !== true || !['all_club_parents', 'all_team_parents', 'involved_players'].includes(text(source.parent_audience)))) return []
  const linksResult = await db.from('parent_player_links').select('id, player_id, team_id, email')
    .eq('club_id', clubId).eq('status', 'active').in('id', preparedIds)
  if (linksResult.error) throw linksResult.error
  const authority = await db.rpc('get_authorized_notification_parent_links', { club_id_value: clubId, parent_link_ids_value: preparedIds })
  if (authority.error) throw authority.error
  const authorized = new Set((authority.data || []).map(row => text(row.parent_link_id)))
  const links = (linksResult.data || []).filter(link => authorized.has(text(link.id)))
  if (sourceType !== 'session' && source.parent_audience === 'all_club_parents') return links.map(link => link.id)
  if (sourceType !== 'session' && source.parent_audience === 'all_team_parents') return links.filter(link => text(link.team_id) === text(teamId) && Boolean(teamId)).map(link => link.id)
  if (!teamId && sourceType !== 'session') return []

  const column = sourceType === 'calendar' ? 'calendar_event_id' : sourceType === 'session' ? 'assessment_session_id' : 'match_day_id'
  const invitesResult = await db.from('calendar_event_invites').select('parent_link_id, player_id, team_id, invite_status')
    .eq('club_id', clubId).eq(column, sourceId).neq('invite_status', 'cancelled')
  if (invitesResult.error) throw invitesResult.error
  const inviteIds = new Set((invitesResult.data || []).filter(invite => invite.parent_link_id && text(invite.team_id) === text(teamId)).map(invite => `${text(invite.parent_link_id)}:${text(invite.player_id)}`))
  const permitted = new Set(links.filter(link => text(link.team_id) === text(teamId) && inviteIds.has(`${text(link.id)}:${text(link.player_id)}`)).map(link => text(link.id)))
  if (sourceType === 'calendar' && source.event_type === 'training') {
    if (source.cancelled_at) {
      const result = await db.rpc('get_cancelled_training_notification_parent_links', { event_id_value: sourceId, club_id_value: clubId, team_id_value: teamId })
      if (result.error) throw result.error
      for (const row of result.data || []) permitted.add(text(row.parent_link_id))
    } else {
      for (const id of await getTrainingChangeParentLinkIds(db, { clubId, teamId, eventId: sourceId })) permitted.add(text(id))
    }
  }
  if (sourceType === 'match-day') {
    const [requests, decisions] = await Promise.all([
      db.from('match_day_availability_requests').select('parent_link_id, player_id, recipient_email, recipient_type, status, token_revoked_at').eq('club_id', clubId).eq('team_id', teamId).eq('match_day_id', sourceId),
      db.from('match_day_player_squad_decisions').select('player_id, status, notified_at').eq('club_id', clubId).eq('team_id', teamId).eq('match_day_id', sourceId),
    ])
    if (requests.error || decisions.error) throw requests.error || decisions.error
    for (const link of links) {
      if (text(link.team_id) !== text(teamId)) continue
      if ((requests.data || []).some(request => text(request.player_id) === text(link.player_id) && text(request.recipient_type) === 'parent' && text(request.status) !== 'expired' && !request.token_revoked_at && (request.parent_link_id ? text(request.parent_link_id) === text(link.id) : Boolean(email(request.recipient_email)) && email(request.recipient_email) === email(link.email)))
        || (decisions.data || []).some(decision => text(decision.player_id) === text(link.player_id) && (decision.status === 'selected' || decision.notified_at))) permitted.add(text(link.id))
    }
  }
  return links.filter(link => permitted.has(text(link.id))).map(link => text(link.id))
}
