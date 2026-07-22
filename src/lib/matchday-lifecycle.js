import {
  getMatchDayExtendedTimerActions,
  getNormalTimeCompletionAction,
} from './matchday-extended-ops.js'

function normalizeText(value) {
  return String(value ?? '').trim()
}

export function isMatchDayConcluded(match = {}) {
  return Boolean(normalizeText(match.concludedAt ?? match.concluded_at))
}

export function isMatchDayAtFullTime(match = {}) {
  return normalizeText(match.status) === 'full_time' && !isMatchDayConcluded(match)
}

export function canResumeMatchDay(match = {}) {
  return isMatchDayAtFullTime(match) && normalizeText(match.timerStatus ?? match.timer_status) === 'full_time'
}

export function getMatchDayLifecycleState(match = {}) {
  if (isMatchDayConcluded(match)) {
    return 'concluded'
  }

  const status = normalizeText(match.status)
  const timerStatus = normalizeText(match.timerStatus ?? match.timer_status)
  const currentMatchPhase = normalizeText(match.currentMatchPhase ?? match.current_match_phase)

  if (status === 'full_time' || timerStatus === 'full_time') {
    return 'full_time'
  }

  if (currentMatchPhase === 'penalties') {
    return 'shootout'
  }

  if (['normal_time_complete', 'extra_time_half_time', 'extra_time_complete'].includes(currentMatchPhase)) {
    return 'phase_break'
  }

  if (['paused', 'half_time', 'hydration'].includes(timerStatus) || status === 'half_time') {
    return 'paused'
  }

  if (timerStatus === 'running' || ['live', 'second_half', 'extra_time', 'penalties'].includes(status)) {
    return 'playing'
  }

  return 'not_started'
}

export function getParentScorerTimerActions(match = {}) {
  const lifecycleState = getMatchDayLifecycleState(match)
  const status = normalizeText(match.status)
  const timerStatus = normalizeText(match.timerStatus ?? match.timer_status) || 'not_started'
  const currentMatchPhase = normalizeText(match.currentMatchPhase ?? match.current_match_phase)
  const extendedActions = getMatchDayExtendedTimerActions(match)

  if (lifecycleState === 'concluded' || ['cancelled', 'postponed'].includes(status)) {
    return []
  }

  if (lifecycleState === 'not_started') {
    return [{ action: 'start', label: 'Start match' }]
  }

  if (lifecycleState === 'playing') {
    if (['extra_time_first_half', 'extra_time_second_half'].includes(currentMatchPhase)) {
      return [
        { action: 'pause', label: 'Pause' },
        { action: 'hydration', label: 'Hydration break' },
        ...extendedActions,
      ]
    }

    const completionAction = getNormalTimeCompletionAction(match)
    return [
      { action: 'pause', label: 'Pause' },
      { action: 'hydration', label: 'Hydration break' },
      status === 'live' ? { action: 'half_time', label: 'Half time' } : null,
      { action: completionAction, label: completionAction === 'full_time' ? 'Full time' : 'End normal time' },
    ].filter(Boolean)
  }

  if (lifecycleState === 'phase_break' || lifecycleState === 'shootout') {
    return extendedActions
  }

  if (lifecycleState === 'paused') {
    return [{
      action: 'resume',
      label: timerStatus === 'half_time' || status === 'half_time' ? 'Start second half' : 'Resume',
    }]
  }

  if (lifecycleState === 'full_time') {
    return [
      { action: 'resume', label: 'Resume match' },
      { action: 'conclude', label: 'Conclude match' },
    ]
  }

  return []
}
