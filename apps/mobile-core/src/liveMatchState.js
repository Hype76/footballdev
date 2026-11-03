import { getMatchDayDisplayParts } from '../../../src/lib/matchday-display.js'
import { getMatchDayPhaseLabel } from '../../../src/lib/matchday-extended-ops.js'
import { getMatchDayLifecycleState } from '../../../src/lib/matchday-lifecycle.js'
import { getMatchTimerState } from '../../../src/lib/matchday-timer.js'

// Only call this with a freshly authorised server snapshot. Local pending scorer
// actions do not represent a confirmed score for other followers.
export function createLiveMatchState(match, sampledAtMs) {
  if (!match || typeof match !== 'object' || !Number.isFinite(sampledAtMs) || sampledAtMs <= 0) {
    throw new Error('live_match_snapshot_invalid')
  }
  const status = String(match.status || '').trim()
  if (['cancelled', 'postponed'].includes(status) || match.deletedAt || match.deleted_at) {
    return { end: true }
  }
  const parts = getMatchDayDisplayParts(match)
  const timer = getMatchTimerState(match, sampledAtMs)
  const lifecycle = getMatchDayLifecycleState(match)
  const phase = String(match.currentMatchPhase ?? match.current_match_phase ?? '')
  const isShootout = phase === 'penalties' || status === 'penalties'
  const score = value => {
    const n = Number(value)
    if (!Number.isSafeInteger(n) || n < 0) throw new Error('live_match_score_invalid')
    return n
  }
  return {
    end: lifecycle === 'concluded',
    homeName: parts.firstTeam.slice(0, 60),
    awayName: parts.secondTeam.slice(0, 60),
    homeScore: score(parts.firstScore),
    awayScore: score(parts.secondScore),
    phase: getMatchDayPhaseLabel(match) || ({ live: 'First half', second_half: 'Second half', half_time: 'Half time', full_time: 'Full time', penalties: 'Penalty shootout' }[status] || 'Pre-match'),
    running: timer.isRunning && lifecycle === 'playing' && !isShootout,
    elapsedSeconds: timer.elapsedSeconds,
    sampledAtMs,
    ...(isShootout ? {
      homeShootoutScore: score(match.homeShootoutScore ?? match.home_shootout_score ?? 0),
      awayShootoutScore: score(match.awayShootoutScore ?? match.away_shootout_score ?? 0),
    } : {}),
  }
}
