import { getScopedTeamBranding } from '../../../src/lib/team-branding-display.js'

// Call only after the sending path has authorised the invitation relationship.
// The service-only RPC reads current eligibility without changing offer progress.
export async function loadParentInviteBranding(client, inviteLink) {
  const teamId = String(inviteLink?.team_id || '').trim()
  const clubId = String(inviteLink?.club_id || '').trim()
  if (!teamId || !clubId) throw new Error('Parent invitation branding scope is missing.')
  const { data, error } = await client.rpc('read_parent_invite_branding', {
    team_value: teamId, club_value: clubId,
  })
  if (error) throw new Error('Parent invitation branding could not be verified.', { cause: error })
  if (data === null) return null
  const display = getScopedTeamBranding({ teamId, clubId, teamBrandingDisplay: data })
  if (!display) throw new Error('Parent invitation branding scope could not be verified.')
  return display
}
