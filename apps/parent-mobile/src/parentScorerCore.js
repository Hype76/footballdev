import { captureMatchEventTime, formatMatchAddedTimeClock } from '../../../src/lib/matchday-event-time.js'
import { sortCompletedMatchEvents } from '../../../src/lib/matchday-final-report.js'

export function getParentScorerMatches(matches = []) {
  return matches.filter((match) => match.isScorer && !match.concludedAt
    && !['cancelled', 'postponed'].includes(match.status))
    .sort((a, b) => Number(['scheduled', 'scorer_request'].includes(a.status)) - Number(['scheduled', 'scorer_request'].includes(b.status)))
}

export function getParentScorerActionLabel(match = {}) {
  return ['scheduled', 'scorer_request'].includes(match.status) ? 'Open scoring' : match.status === 'full_time' ? 'Finish match report' : 'Resume scoring'
}

export function captureParentScorerAction(match, kind, now = Date.now()) {
  const time = captureMatchEventTime(match, now)
  return { kind, capturedClock: formatMatchAddedTimeClock(match, now), capturedMinute: time.minute, capturedStoppageMinute: time.stoppageMinute }
}

export function getParentMatchTimeline(match = {}) {
  const events = sortCompletedMatchEvents((match.events || []).filter((event) => !event.voidedAt && event.eventStatus !== 'voided'), { newestFirst: true })
  if (!['live', 'half_time', 'second_half', 'extra_time', 'penalties', 'full_time'].includes(match.status)) return events
  const kickoff = { id: `${match.id}:kickoff`, eventType: 'kick_off', timelineBoundary: true, minute: 0, homeScore: 0, awayScore: 0 }
  const fullTime = { id: `${match.id}:fulltime`, eventType: 'full_time', timelineBoundary: true, homeScore: match.homeScore, awayScore: match.awayScore }
  return [...(match.status === 'full_time' ? [fullTime] : []), ...events, kickoff]
}
