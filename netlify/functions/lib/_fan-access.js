export const fanDenied = () => Object.assign(new Error('This Fan access is no longer available.'), { statusCode: 403 })
async function one(query) {
  const { data, error } = await query.maybeSingle()
  if (error) throw error
  if (!data) throw fanDenied()
  return data
}
export async function loadFanScope(client, authUserId, connectionId, permission) {
  const fan = await one(client.from('fan_connections').select('*').eq('id', connectionId).eq('auth_user_id', authUserId).eq('status', 'active'))
  if (fan.relationship_type !== 'fan' || (permission && fan.permissions?.[permission] !== true)) throw fanDenied()
  const parent = await one(client.from('parent_player_links').select('id, auth_user_id, player_id, club_id, team_id, status, link_type')
    .eq('id', fan.parent_link_id).eq('status', 'active').eq('link_type', 'parent').eq('auth_user_id', fan.invited_by).eq('player_id', fan.player_id).eq('club_id', fan.club_id))
  const player = await one(client.from('players').select('id, player_name, club_id, team_id, status, archived_at').eq('id', fan.player_id).eq('club_id', fan.club_id))
  const club = await one(client.from('clubs').select('id, name, status').eq('id', fan.club_id).eq('status', 'active'))
  if (player.status === 'archived' || player.archived_at || (parent.team_id && parent.team_id !== player.team_id)) throw fanDenied()
  const { data: suspended, error } = await client.from('users').select('id, role, club_id').in('id', [authUserId, parent.auth_user_id]).eq('status', 'suspended')
  if (error) throw error
  if ((suspended || []).some((u) => u.role === 'parent_portal' || u.club_id === fan.club_id)) throw fanDenied()
  return { fan, parent, player, club }
}
export async function loadFanInviteForOwner(client, authUserId, connectionId) {
  const fan = await one(client.from('fan_connections').select('*').eq('id', connectionId).eq('invited_by', authUserId).eq('status', 'pending'))
  if (Date.parse(fan.expires_at) <= Date.now()) throw fanDenied()
  const club = await loadFanInvitingParent(client, fan)
  return { ...fan, club }
}
export async function loadFanInvitingParent(client, fan) {
  await one(client.from('parent_player_links').select('id').eq('id', fan.parent_link_id).eq('auth_user_id', fan.invited_by).eq('player_id', fan.player_id).eq('club_id', fan.club_id).eq('link_type', 'parent').eq('status', 'active'))
  const player = await one(client.from('players').select('status,archived_at').eq('id', fan.player_id).eq('club_id', fan.club_id))
  const club = await one(client.from('clubs').select('id,name,logo_url,theme_accent,theme_button_style').eq('id', fan.club_id).eq('status', 'active'))
  if (player.status === 'archived' || player.archived_at) throw fanDenied()
  const { data, error } = await client.from('users').select('role,club_id').eq('id', fan.invited_by).eq('status', 'suspended')
  if (error) throw error
  if ((data || []).some((u) => u.role === 'parent_portal' || u.club_id === fan.club_id)) throw fanDenied()
  return club
}
