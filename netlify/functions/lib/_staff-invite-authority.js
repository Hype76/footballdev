export async function assertStaffInviteAuthority({ event, invite, phoneTeamCommand = false, authenticatedActorId, client, getPlanProfile, assertFeature }) {
  const profile = await getPlanProfile(event, { clubId: invite.club_id, teamId: invite.team_id })
  assertFeature(profile, invite.team_id ? 'teamStaffRoles' : 'clubStaffRoles')
  if (phoneTeamCommand === true) {
    if (!profile.id || String(profile.id) !== String(authenticatedActorId) || !invite.team_id || String(profile.clubId) !== String(invite.club_id)) {
      throw Object.assign(new Error('Only the team admin can add coaches.'), { statusCode: 403 })
    }
    const { data, error } = await client.rpc('phone_team_invite_can_send', { actor_value: profile.id, invite_value: invite.id })
    if (error || data !== true) {
      throw Object.assign(new Error('Only the team admin can send this coach invitation.'), { statusCode: 403 })
    }
    return profile
  }
  if (profile.role === 'super_admin') return profile
  if (String(profile.clubId) !== String(invite.club_id)) {
    throw Object.assign(new Error('This Coach invite belongs to a different club.'), { statusCode: 403 })
  }
  if (!profile.id || String(profile.id) !== String(authenticatedActorId)) {
    throw Object.assign(new Error('Only an authorised Team Admin or Club Admin can send this staff invitation.'), { statusCode: 403 })
  }
  const { data, error } = await client.rpc('staff_invite_actor_can_send', { actor_value: profile.id, invite_value: invite.id })
  if (error || data !== true) {
    throw Object.assign(new Error('Only an authorised Team Admin or Club Admin can send this staff invitation.'), { statusCode: 403 })
  }
  return profile
}
