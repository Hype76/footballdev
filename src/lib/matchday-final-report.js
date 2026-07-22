export const MATCH_DAY_FINAL_REPORT_NOTES_MAX_LENGTH = 5000

const COMPLETED_REPORT_SUMMARY_TYPES = new Set([
  'goal',
  'yellow_card',
  'red_card',
  'substitution',
  'injury',
  'water_break',
])

const MATCH_PHASE_ORDER = new Map([
  ['pre_match', 0],
  ['first_half', 10],
  ['half_time', 20],
  ['second_half', 30],
  ['full_time', 40],
  ['extra_time_first_half', 50],
  ['extra_time_half_time', 60],
  ['extra_time_second_half', 70],
  ['penalties', 80],
])

const EVENT_TYPE_LABELS = {
  goal: 'Goal',
  score_correction: 'Score correction',
  status_change: 'Status update',
  note: 'Match note',
  yellow_card: 'Yellow card',
  red_card: 'Red card',
  substitution: 'Substitution',
  injury: 'Injury',
  water_break: 'Water break',
}

function normalizeText(value) {
  return String(value ?? '').trim().replace(/\s+/g, ' ')
}

function normalizeEventStatus(event) {
  return normalizeText(event?.eventStatus ?? event?.event_status) || 'active'
}

function normalizeEventType(event) {
  return normalizeText(event?.eventType ?? event?.event_type)
}

function firstText(...values) {
  for (const value of values) {
    const normalizedValue = normalizeText(value)

    if (normalizedValue) {
      return normalizedValue
    }
  }

  return ''
}

function normalizeOptionalNumber(value) {
  if (value === null || value === undefined || value === '') {
    return null
  }

  const number = Number(value)
  return Number.isFinite(number) ? number : null
}

function getEventPhaseOrder(event) {
  const explicitOrder = normalizeOptionalNumber(
    event?.phaseOrder
    ?? event?.phase_order
    ?? event?.matchPhaseOrder
    ?? event?.match_phase_order,
  )

  if (explicitOrder !== null) {
    return explicitOrder
  }

  const phase = normalizeText(
    event?.matchPhase
    ?? event?.match_phase
    ?? event?.eventPhase
    ?? event?.event_phase
    ?? event?.phase,
  ).toLowerCase()

  return MATCH_PHASE_ORDER.get(phase) ?? 0
}

function getEventMinuteParts(event) {
  const rawMinute = event?.displayMinute
    ?? event?.display_minute
    ?? event?.matchMinute
    ?? event?.match_minute
    ?? event?.minute
  const explicitStoppage = normalizeOptionalNumber(
    event?.stoppageMinute
    ?? event?.stoppage_minute
    ?? event?.stoppageTime
    ?? event?.stoppage_time,
  )

  if (typeof rawMinute === 'string') {
    const match = rawMinute.trim().match(/^(\d+)\s*\+\s*(\d+)$/)

    if (match) {
      const minute = Number(match[1])
      const stoppage = Number(match[2])
      return { minute, stoppage, effectiveMinute: minute + stoppage }
    }
  }

  const minute = normalizeOptionalNumber(rawMinute)
  const stoppage = explicitStoppage ?? 0

  if (minute === null) {
    return { minute: -1, stoppage, effectiveMinute: -1 }
  }

  return { minute, stoppage, effectiveMinute: minute + stoppage }
}

function getEventSequence(event) {
  return normalizeOptionalNumber(
    event?.eventSequence
    ?? event?.event_sequence
    ?? event?.sequence
    ?? event?.sequenceNumber
    ?? event?.sequence_number,
  ) ?? 0
}

function getEventTimestamp(event) {
  const value = event?.recordedAt
    ?? event?.recorded_at
    ?? event?.createdAt
    ?? event?.created_at
    ?? ''
  const timestamp = new Date(value).getTime()
  return Number.isFinite(timestamp) ? timestamp : 0
}

function getStableEventId(event) {
  return normalizeText(event?.id ?? event?.eventId ?? event?.event_id)
}

function getClubTeamName(match) {
  return firstText(match?.teamName, match?.team_name, match?.teams?.name) || 'Our team'
}

function getOpponentTeamName(match) {
  return firstText(match?.opponent, match?.opponentName, match?.opponent_name) || 'Opponent'
}

function getRecordedTeamSide(event) {
  if (event?.teamSideRecorded === false || event?.team_side_recorded === false) {
    return ''
  }

  return normalizeText(event?.teamSide ?? event?.team_side).toLowerCase()
}

function getEventTeamId(event) {
  return firstText(event?.eventTeamId, event?.event_team_id)
}

export function resolveCompletedMatchEventTeam(event = {}, match = {}) {
  const eventTeamId = getEventTeamId(event)
  const clubTeamId = firstText(match?.teamId, match?.team_id)
  const opponentTeamId = firstText(match?.opponentTeamId, match?.opponent_team_id)
  const clubTeamName = getClubTeamName(match)
  const opponentTeamName = getOpponentTeamName(match)

  if (eventTeamId && clubTeamId && eventTeamId === clubTeamId) {
    return { id: eventTeamId, name: clubTeamName, side: 'club' }
  }

  if (eventTeamId && opponentTeamId && eventTeamId === opponentTeamId) {
    return { id: eventTeamId, name: opponentTeamName, side: 'opponent' }
  }

  const recordedSide = getRecordedTeamSide(event)
  const homeAway = normalizeText(match?.homeAway ?? match?.home_away).toLowerCase()
  const clubIsAway = homeAway === 'away'

  if (recordedSide === 'club') {
    return { id: clubTeamId, name: clubTeamName, side: 'club' }
  }

  if (recordedSide === 'opponent') {
    return { id: opponentTeamId, name: opponentTeamName, side: 'opponent' }
  }

  if (recordedSide === 'home') {
    return clubIsAway
      ? { id: opponentTeamId, name: opponentTeamName, side: 'opponent' }
      : { id: clubTeamId, name: clubTeamName, side: 'club' }
  }

  if (recordedSide === 'away') {
    return clubIsAway
      ? { id: clubTeamId, name: clubTeamName, side: 'club' }
      : { id: opponentTeamId, name: opponentTeamName, side: 'opponent' }
  }

  const recordedTeamLabel = firstText(
    event?.eventTeamName,
    event?.event_team_name,
    event?.teamLabel,
    event?.team_label,
  )

  if (recordedTeamLabel) {
    return { id: eventTeamId, name: recordedTeamLabel, side: 'recorded' }
  }

  return { id: eventTeamId, name: 'Team not recorded', side: 'unknown' }
}

export function resolveCompletedMatchPlayerName(event = {}, role = 'primary') {
  const isSecondary = role === 'secondary'
  const fullName = isSecondary
    ? firstText(
        event?.assistName,
        event?.assist_name,
        event?.playerOnName,
        event?.player_on_name,
        event?.assistPlayer?.playerName,
        event?.assistPlayer?.player_name,
        event?.assistPlayer?.name,
      )
    : firstText(
        event?.scorerName,
        event?.scorer_name,
        event?.playerName,
        event?.player_name,
        event?.player?.playerName,
        event?.player?.player_name,
        event?.player?.name,
      )

  if (fullName) {
    return fullName
  }

  const shirtNumber = isSecondary
    ? firstText(
        event?.assistShirtNumber,
        event?.assist_shirt_number,
        event?.playerOnShirtNumber,
        event?.player_on_shirt_number,
      )
    : firstText(
        event?.scorerShirtNumber,
        event?.scorer_shirt_number,
        event?.playerShirtNumber,
        event?.player_shirt_number,
      )

  return shirtNumber ? `Shirt #${shirtNumber}` : 'Unknown player'
}

export function compareCompletedMatchEventsChronologically(left = {}, right = {}) {
  const phaseDifference = getEventPhaseOrder(left) - getEventPhaseOrder(right)

  if (phaseDifference !== 0) {
    return phaseDifference
  }

  const leftMinute = getEventMinuteParts(left)
  const rightMinute = getEventMinuteParts(right)
  const effectiveMinuteDifference = leftMinute.effectiveMinute - rightMinute.effectiveMinute

  if (effectiveMinuteDifference !== 0) {
    return effectiveMinuteDifference
  }

  const minuteDifference = leftMinute.minute - rightMinute.minute

  if (minuteDifference !== 0) {
    return minuteDifference
  }

  const stoppageDifference = leftMinute.stoppage - rightMinute.stoppage

  if (stoppageDifference !== 0) {
    return stoppageDifference
  }

  const sequenceDifference = getEventSequence(left) - getEventSequence(right)

  if (sequenceDifference !== 0) {
    return sequenceDifference
  }

  const timestampDifference = getEventTimestamp(left) - getEventTimestamp(right)

  if (timestampDifference !== 0) {
    return timestampDifference
  }

  return getStableEventId(left).localeCompare(getStableEventId(right))
}

export function sortCompletedMatchEvents(events, { newestFirst = false } = {}) {
  const direction = newestFirst ? -1 : 1

  return (Array.isArray(events) ? events : [])
    .slice()
    .sort((left, right) => direction * compareCompletedMatchEventsChronologically(left, right))
}

export function formatCompletedMatchEventMinute(event = {}) {
  const { minute, stoppage } = getEventMinuteParts(event)

  if (minute < 0) {
    return 'Minute not recorded'
  }

  return stoppage > 0 ? `${minute}+${stoppage}'` : `${minute}'`
}

export function buildCompletedMatchEventPresentation(event = {}, match = {}, { includeNotes = true } = {}) {
  const eventType = normalizeEventType(event)
  const team = resolveCompletedMatchEventTeam(event, match)
  const primaryPlayerName = resolveCompletedMatchPlayerName(event, 'primary')
  const secondaryPlayerName = resolveCompletedMatchPlayerName(event, 'secondary')
  const requiresPrimaryPlayer = ['goal', 'yellow_card', 'red_card', 'substitution', 'injury'].includes(eventType)
  let detail = ''

  if (eventType === 'substitution') {
    detail = `${primaryPlayerName} off, ${secondaryPlayerName} on`
  } else if (requiresPrimaryPlayer) {
    detail = primaryPlayerName
  } else if (includeNotes) {
    detail = normalizeText(event?.notes)
  }

  const homeScore = normalizeOptionalNumber(event?.homeScore ?? event?.home_score)
  const awayScore = normalizeOptionalNumber(event?.awayScore ?? event?.away_score)

  return {
    detail,
    eventType,
    minuteLabel: formatCompletedMatchEventMinute(event),
    notes: includeNotes && requiresPrimaryPlayer ? normalizeText(event?.notes) : '',
    scoreLabel: homeScore !== null && awayScore !== null ? `${homeScore} - ${awayScore}` : 'Score not recorded',
    status: normalizeEventStatus(event),
    team,
    title: EVENT_TYPE_LABELS[eventType] || 'Match event',
  }
}

export function isFinalMatchReportAvailable(match) {
  return normalizeText(match?.status) === 'full_time'
}

export function buildFinalMatchReportSummary(match = {}) {
  const events = Array.isArray(match.events) ? match.events : []
  const activeEvents = events.filter((event) => normalizeEventStatus(event) !== 'voided')
  const voidedEvents = events.filter((event) => normalizeEventStatus(event) === 'voided')
  const newestFirst = (items) => sortCompletedMatchEvents(items, { newestFirst: true })

  return {
    activeEvents: newestFirst(activeEvents),
    activeGoals: newestFirst(activeEvents.filter((event) => normalizeEventType(event) === 'goal')),
    activeCards: newestFirst(activeEvents.filter((event) => ['yellow_card', 'red_card'].includes(normalizeEventType(event)))),
    activeSubstitutions: newestFirst(activeEvents.filter((event) => normalizeEventType(event) === 'substitution')),
    activeInjuries: newestFirst(activeEvents.filter((event) => normalizeEventType(event) === 'injury')),
    activeWaterBreaks: newestFirst(activeEvents.filter((event) => normalizeEventType(event) === 'water_break')),
    activeOtherEvents: newestFirst(activeEvents.filter((event) => !COMPLETED_REPORT_SUMMARY_TYPES.has(normalizeEventType(event)))),
    timelineEvents: sortCompletedMatchEvents(events),
    voidedEvents: newestFirst(voidedEvents),
  }
}

export function validateFinalMatchReportNotes(value) {
  const staffNotes = normalizeText(value)

  if (staffNotes.length > MATCH_DAY_FINAL_REPORT_NOTES_MAX_LENGTH) {
    throw new Error(`Staff notes must be ${MATCH_DAY_FINAL_REPORT_NOTES_MAX_LENGTH} characters or fewer.`)
  }

  return staffNotes
}
