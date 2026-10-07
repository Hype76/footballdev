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
  if (Number(profile.roleRank ?? 0) < 50) {
    throw Object.assign(new Error('You need manager access before sending Coach invites.'), { statusCode: 403 })
  }
  if (Number(invite.role_rank ?? 0) > Number(profile.roleRank ?? 0)) {
    throw Object.assign(new Error('You cannot invite a role above your own level.'), { statusCode: 403 })
  }
  return profile
}
