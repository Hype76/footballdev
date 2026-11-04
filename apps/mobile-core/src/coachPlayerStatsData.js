import { assertCoachOperationalRead } from './coachOperationalData'
import { supabase } from './supabase'
import { calculatePlayerPlayingTime } from '../../../src/lib/domain/player-playing-time.js'

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
  const { data: matches, error: matchesError } = await supabase.from('match_days')
    .select('id,timer_elapsed_seconds').eq('club_id', user.clubId).eq('team_id', user.activeTeamId)
    .eq('status', 'full_time').is('deleted_at', null)
    .gte('match_date', `${year}-01-01`).lt('match_date', `${year + 1}-01-01`)
  if (matchesError) throw matchesError
  const matchIds = (matches || []).map((match) => match.id)
  let playingTime = { minutes: null, recordedMatches: 0 }
  if (matchIds.length) {
    const [starters, substitutions] = await Promise.all([
      supabase.from('match_day_starting_squads').select('match_day_id,player_ids').eq('club_id', user.clubId).eq('team_id', user.activeTeamId).in('match_day_id', matchIds),
      supabase.from('match_day_events').select('match_day_id,event_type,team_side,event_status,voided_at,scorer_player_id,assist_player_id,minute,created_at')
        .in('match_day_id', matchIds).eq('event_type', 'substitution'),
    ])
    if (starters.error || substitutions.error) throw starters.error || substitutions.error
    playingTime = calculatePlayerPlayingTime(matches, starters.data || [], substitutions.data || [], playerId)
  }
  return {
    year,
    matchdaySquad: squad.count,
    goals: row ? Number(row.goals || 0) : null,
    assists: row ? Number(row.assists || 0) : null,
    playingMinutes: playingTime.minutes,
    playingTimeMatches: playingTime.recordedMatches,
  }
}
