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

  if (status === 'full_time' || timerStatus === 'full_time') {
    return 'full_time'
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

  if (lifecycleState === 'concluded' || ['cancelled', 'postponed'].includes(status)) {
    return []
  }

  if (lifecycleState === 'not_started') {
    return [{ action: 'start', label: 'Start match' }]
  }

  if (lifecycleState === 'playing') {
    return [
      { action: 'pause', label: 'Pause' },
      { action: 'hydration', label: 'Hydration break' },
      status === 'live' ? { action: 'half_time', label: 'Half time' } : null,
      { action: 'full_time', label: 'Full time' },
    ].filter(Boolean)
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
