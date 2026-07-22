export const MATCH_DAY_CONCLUSION_RULE_OPTIONS = [
  { value: 'normal_time', label: 'Finish after normal time' },
  { value: 'extra_time', label: 'Extra time, no shootout' },
  { value: 'extra_time_then_penalties', label: 'Extra time, then penalties if needed' },
  { value: 'straight_to_penalties', label: 'Straight to penalties if needed' },
]

export const MATCH_DAY_EXTRA_TIME_PERIOD_COUNT_OPTIONS = [
  { value: 2, label: 'Two periods' },
  { value: 1, label: 'One period' },
]

export const MATCH_DAY_SHOOTOUT_NO_GOAL_OUTCOME = 'missed'

const MATCH_DAY_CONCLUSION_RULES = new Set(MATCH_DAY_CONCLUSION_RULE_OPTIONS.map((option) => option.value))

export const MATCH_DAY_PHASE_LABELS = {
  pre_match: 'Pre-match',
  first_half: 'First half',
  half_time: 'Half time',
  second_half: 'Second half',
  normal_time_complete: 'Normal time complete',
  extra_time_first_half: 'Extra time first half',
  extra_time_half_time: 'Extra time half time',
  extra_time_second_half: 'Extra time second half',
  extra_time_complete: 'Extra time complete',
  penalties: 'Penalty shootout',
  full_time: 'Full time',
}

export function normalizeMatchDayConclusionRule(value) {
  const normalizedValue = String(value ?? '').trim()
  return MATCH_DAY_CONCLUSION_RULES.has(normalizedValue) ? normalizedValue : 'normal_time'
}

export function normalizeExtraTimeHalfMinutes(value) {
  const minutes = Number(value)
  return Number.isInteger(minutes) && minutes >= 5 && minutes <= 30 ? minutes : 15
}

export function normalizeExtraTimePeriodCount(value) {
  return Number(value) === 1 ? 1 : 2
}

export function getMatchDayPhaseLabel(match = {}) {
  const phase = String(match.currentMatchPhase ?? match.current_match_phase ?? '').trim()
  if (phase === 'extra_time_first_half' && normalizeExtraTimePeriodCount(match.extraTimePeriodCount ?? match.extra_time_period_count) === 1) {
    return 'Extra time'
  }
  return MATCH_DAY_PHASE_LABELS[phase] || ''
}

export function matchUsesExtraTime(match = {}) {
  return ['extra_time', 'extra_time_then_penalties'].includes(normalizeMatchDayConclusionRule(
    match.conclusionRule ?? match.matchConclusionRule ?? match.match_conclusion_rule,
  ))
}

export function matchUsesPenaltyShootout(match = {}) {
  return ['extra_time_then_penalties', 'straight_to_penalties'].includes(normalizeMatchDayConclusionRule(
    match.conclusionRule ?? match.matchConclusionRule ?? match.match_conclusion_rule,
  ))
}

export function getMatchDayShootoutScore(match = {}) {
  return {
    home: Math.max(Number(match.homeShootoutScore ?? match.home_shootout_score ?? 0), 0),
    away: Math.max(Number(match.awayShootoutScore ?? match.away_shootout_score ?? 0), 0),
  }
}

export function getMatchDayShootoutWinnerLabel(match = {}) {
  const winner = String(match.shootoutWinner ?? match.shootout_winner ?? '').trim()
  if (!winner) return ''

  const clubIsAway = String(match.homeAway ?? match.home_away ?? '').trim() === 'away'
  const clubWon = (winner === 'away') === clubIsAway
  return clubWon
    ? String(match.teamName ?? match.team_name ?? '').trim() || 'Our team'
    : String(match.opponent ?? '').trim() || 'Opponent'
}

export function canFinishPenaltyShootout(match = {}) {
  const kicks = (Array.isArray(match.shootoutEvents) ? match.shootoutEvents : [])
    .filter((kick) => kick.eventStatus !== 'voided')
  const clubKicks = kicks.filter((kick) => kick.teamSide === 'club')
  const opponentKicks = kicks.filter((kick) => kick.teamSide === 'opponent')
  const clubGoals = clubKicks.filter((kick) => kick.outcome === 'scored').length
  const opponentGoals = opponentKicks.filter((kick) => kick.outcome === 'scored').length

  if (clubKicks.length < 5 || opponentKicks.length < 5) {
    return clubGoals > opponentGoals + Math.max(5 - opponentKicks.length, 0)
      || opponentGoals > clubGoals + Math.max(5 - clubKicks.length, 0)
  }

  return clubKicks.length === opponentKicks.length && clubGoals !== opponentGoals
}

export function getMatchDayExtendedTimerActions(match = {}) {
  const phase = String(match.currentMatchPhase ?? match.current_match_phase ?? '').trim()
  const rule = normalizeMatchDayConclusionRule(
    match.conclusionRule ?? match.matchConclusionRule ?? match.match_conclusion_rule,
  )

  if (phase === 'normal_time_complete') {
    if (rule === 'straight_to_penalties') {
      return [{ action: 'start_penalties', label: 'Start penalty shootout' }]
    }

    if (matchUsesExtraTime(match)) {
      return [{ action: 'start_extra_time', label: 'Start extra time' }]
    }
  }

  if (phase === 'extra_time_first_half') {
    if (normalizeExtraTimePeriodCount(match.extraTimePeriodCount ?? match.extra_time_period_count) === 1) {
      return [{ action: 'complete_extra_time', label: 'End extra time' }]
    }
    return [{ action: 'extra_time_half_time', label: 'Extra time half time' }]
  }

  if (phase === 'extra_time_half_time') {
    return [{ action: 'start_extra_time_second_half', label: 'Start extra time second half' }]
  }

  if (phase === 'extra_time_second_half') {
    return [{ action: 'complete_extra_time', label: 'End extra time' }]
  }

  if (phase === 'extra_time_complete') {
    if (rule === 'extra_time_then_penalties') {
      return [{ action: 'start_penalties', label: 'Start penalty shootout' }]
    }

    return [{ action: 'full_time', label: 'Full time' }]
  }

  if (phase === 'penalties') {
    return [{ action: 'full_time', label: 'Finish shootout', disabled: !canFinishPenaltyShootout(match) }]
  }

  return []
}

export function getNormalTimeCompletionAction(match = {}) {
  return normalizeMatchDayConclusionRule(
    match.conclusionRule ?? match.matchConclusionRule ?? match.match_conclusion_rule,
  ) === 'normal_time'
    ? 'full_time'
    : 'normal_time_complete'
}
