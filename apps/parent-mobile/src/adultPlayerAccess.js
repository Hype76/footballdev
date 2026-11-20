import { requestAdultPlayerWorkspace } from '../../mobile-core/src/adultPlayerWorkspace'
import { loadTeamBrandingDisplay } from '../../../src/lib/team-branding-display.js'

export async function getAdultPlayerAccess(client, userId) {
  const { data, error } = await client.rpc('get_own_adult_player_account_state')
  if (error) throw new Error('Player access could not be checked. Check your connection and try again.')

  const row = Array.isArray(data) ? data[0] : data
  if (!row) return { status: 'unlinked' }
  if (row.user_id !== userId || row.access_granted !== true || row.link_status !== 'active'
    || row.access_mode !== 'player' || !row.verified_at || !row.link_id || !row.player_id || !row.team_id || !row.club_id) {
    return { status: 'denied' }
  }

  let profile
  try {
    profile = await requestAdultPlayerWorkspace('profile', { userId, expectedLinkId: row.link_id })
  } catch (error) {
    if (error.status === 401 || error.status === 403) return { status: 'denied' }
    error.playerLinkVerified = true
    throw error
  }
  const selected = profile.link
  if (selected?.id !== row.link_id || selected.playerId !== row.player_id
    || selected.clubId !== row.club_id || selected.teamId !== row.team_id || !profile.planKey) {
    return { status: 'denied' }
  }

  const link = await loadTeamBrandingDisplay(client, {
    linkType: 'adult_player',
    planKey: profile.planKey,
    planStatus: profile.planStatus,
    capabilities: profile.capabilities || {},
    id: row.link_id,
    playerId: row.player_id,
    playerName: row.player_name,
    clubId: row.club_id,
    clubName: row.club_name,
    clubLogoUrl: row.club_logo_url,
    teamId: row.team_id,
    teamName: row.team_name,
    themeAccent: row.theme_accent,
    themeButtonStyle: row.theme_button_style,
  })

  return { status: 'linked', link }
}

export function selectAdultPlayerView({ access, hasParent, hasFan, preferredMode }) {
  if (access.link && (!hasParent || preferredMode === 'player') && !(hasFan && preferredMode === 'fan')) return 'player'
  if (hasParent) return 'parent'
  if (hasFan) return 'fan'
  if (access.status === 'checking' && !access.previouslyUnlinked) return 'checking'
  if (access.status === 'denied' || (access.status === 'error' && access.previouslyLinked)) return 'retry'
  return 'parent'
}
