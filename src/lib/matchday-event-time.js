import { isContinuousMatchClock, normalizeMatchDurationMinutes } from './matchday-model.js'
import { getMatchTimerElapsedSeconds, getMatchTimerMinute } from './matchday-timer.js'

export function getMatchPeriodEndMinute(match = {}, phaseValue) {
  if (isContinuousMatchClock(match)) return null
  const phase = phaseValue || match.currentMatchPhase || match.current_match_phase || match.status
  const duration = normalizeMatchDurationMinutes(match.matchDurationMinutes ?? match.match_duration_minutes)
  const extraHalf = Number(match.extraTimeHalfMinutes ?? match.extra_time_half_minutes ?? 15)
  if (['first_half', 'live', 'half_time'].includes(phase)) return duration / 2
  if (['second_half', 'normal_time_complete'].includes(phase)) return duration
  if (['extra_time_first_half', 'extra_time_half_time'].includes(phase)) return duration + extraHalf
  if (['extra_time_second_half', 'extra_time_complete'].includes(phase)) return duration + extraHalf * 2
  return null
}

export function getMatchEventTime(match, minuteValue, phase, stoppageValue = null) {
  if (minuteValue == null || minuteValue === '') return { minute: null, stoppageMinute: null }
  const minute = Number(minuteValue)
  const stoppage = Number(stoppageValue || 0)
  const end = getMatchPeriodEndMinute(match, phase)
  if (stoppage > 0) return { minute, stoppageMinute: stoppage }
  return end != null && minute > end
    ? { minute: end, stoppageMinute: minute - end }
    : { minute, stoppageMinute: null }
}

export function captureMatchEventTime(match, now = Date.now()) {
  return getMatchEventTime(match, getMatchTimerMinute(match, now))
}

export function formatMatchAddedTimeClock(match, now = Date.now()) {
  const elapsed = getMatchTimerElapsedSeconds(match, now)
  if (elapsed == null) return '0:00'
  const end = getMatchPeriodEndMinute(match)
  const added = end != null && elapsed > end * 60
  const seconds = added ? elapsed - end * 60 : elapsed
  return `${added ? `${end}+` : ''}${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, '0')}`
}
