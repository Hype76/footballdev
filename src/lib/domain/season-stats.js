import { supabase } from '../supabase-client.js'

function normalizeText(value) {
  return String(value ?? '').trim()
}

function assertSeasonStatsAccess(user) {
  if (!user?.clubId || user.role === 'parent_portal' || user.role === 'super_admin' || Number(user.roleRank ?? 0) < 50) {
    throw new Error('Manager access is required for end of season stats.')
  }
}

export async function getEndSeasonStats({ user, teamId = '' } = {}) {
  assertSeasonStatsAccess(user)

  const { data, error } = await supabase.rpc('get_end_season_stats', {
    team_id_value: normalizeText(teamId) || user.activeTeamId || null,
  })

  if (error) {
    console.error(error)
    throw error
  }

  return (data ?? []).map((row) => ({
    playerId: row.player_id ?? row.playerId ?? '',
    playerName: normalizeText(row.player_name ?? row.playerName),
    shirtNumber: normalizeText(row.shirt_number ?? row.shirtNumber),
    teamId: row.team_id ?? row.teamId ?? '',
    teamName: normalizeText(row.team_name ?? row.teamName),
    goals: Number(row.goals ?? 0),
    assists: Number(row.assists ?? 0),
    motmVotes: Number(row.motm_votes ?? row.motmVotes ?? 0),
  }))
}
