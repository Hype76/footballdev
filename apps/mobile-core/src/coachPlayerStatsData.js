import { assertCoachOperationalRead } from './coachOperationalData'
import { supabase } from './supabase'

export async function getCoachPlayerStats(user, playerId) {
  assertCoachOperationalRead(user, { requiresTeam: true })
  const year = Number(new Intl.DateTimeFormat('en-GB', { year: 'numeric', timeZone: 'Europe/London' }).format(new Date()))
  const [scoring, squad] = await Promise.all([
    supabase.rpc('get_end_season_stats', { team_id_value: user.activeTeamId }).eq('player_id', playerId),
    supabase.from('match_day_player_squad_decisions')
      .select('match_day_id,match_days!inner(id,club_id,team_id,match_date,status,concluded_at,deleted_at)', { count: 'exact', head: true })
      .eq('player_id', playerId).eq('status', 'selected')
      .eq('match_days.club_id', user.clubId).eq('match_days.team_id', user.activeTeamId)
      .is('match_days.deleted_at', null)
      .gte('match_days.match_date', `${year}-01-01`).lt('match_days.match_date', `${year + 1}-01-01`)
      .not('match_days.status', 'in', '(cancelled,postponed)')
      .or('status.eq.full_time,concluded_at.not.is.null', { referencedTable: 'match_days' }),
  ])
  if (scoring.error || squad.error) throw scoring.error || squad.error
  if (!Number.isInteger(squad.count)) throw new Error('Matchday squad count is unavailable.')
  const row = scoring.data?.find((item) => item.player_id === playerId)
  return {
    year,
    matchdaySquad: squad.count,
    goals: row ? Number(row.goals || 0) : null,
    assists: row ? Number(row.assists || 0) : null,
  }
}
