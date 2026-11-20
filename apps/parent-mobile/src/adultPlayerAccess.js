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

  const link = await loadTeamBrandingDisplay(client, {
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
