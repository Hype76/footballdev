import { loadActiveAuthorityProfile } from './_authority-profile.js'

export async function loadCoachCalendarAuthority(client, authUser, contextId) {
  const match = /^(club|team):([a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12})$/i.exec(String(contextId || ''))
  if (!match) throw Object.assign(new Error('Choose a Coach calendar.'), { statusCode: 400 })
  const profile = await loadActiveAuthorityProfile(client, authUser, { select: 'id,club_id,role,role_rank,status' })
  if (['parent_portal', 'super_admin'].includes(profile.role) || Number(profile.role_rank) < 20) {
    throw Object.assign(new Error('Active Coach access is required.'), { statusCode: 403 })
  }
  const [, type, resourceId] = match
  if (type === 'club') {
    if (resourceId !== profile.club_id || profile.role !== 'admin' || Number(profile.role_rank) < 90) {
      throw Object.assign(new Error('This calendar is unavailable.'), { statusCode: 403 })
    }
    return { clubId: profile.club_id, teamId: null, contextId, profile }
  }
  const team = await client.from('teams').select('id,status,archived_at').eq('id', resourceId).eq('club_id', profile.club_id).maybeSingle()
  if (team.error) throw team.error
  if (!team.data || team.data.status !== 'active' || team.data.archived_at) {
    throw Object.assign(new Error('This calendar is unavailable.'), { statusCode: 403 })
  }
  if (profile.role !== 'admin') {
    const assignment = await client.from('team_staff').select('id,role_rank').eq('team_id', resourceId).eq('user_id', profile.id).maybeSingle()
    if (assignment.error) throw assignment.error
    if (!assignment.data || Number(assignment.data.role_rank) < 20) {
      throw Object.assign(new Error('This calendar is unavailable.'), { statusCode: 403 })
    }
  }
  return { clubId: profile.club_id, teamId: resourceId, contextId, profile }
}
