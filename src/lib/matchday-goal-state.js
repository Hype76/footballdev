function normalizeText(value) {
  return String(value ?? '').trim()
}

function normalizeScore(value) {
  const score = Number(value ?? 0)
  return Number.isFinite(score) ? score : 0
}

function normalizeGoalEvent(event = {}, match = {}) {
  return {
    id: normalizeText(event.id),
    matchDayId: normalizeText(event.matchDayId ?? event.match_day_id) || normalizeText(match.id),
    eventType: normalizeText(event.eventType ?? event.event_type) || 'goal',
    teamSide: normalizeText(event.teamSide ?? event.team_side) === 'opponent' ? 'opponent' : 'club',
    minute: event.minute ?? null,
    scorerName: normalizeText(event.scorerName ?? event.scorer_name),
    scorerInitials: normalizeText(event.scorerInitials ?? event.scorer_initials),
    scorerShirtNumber: normalizeText(event.scorerShirtNumber ?? event.scorer_shirt_number),
    assistName: normalizeText(event.assistName ?? event.assist_name),
    assistInitials: normalizeText(event.assistInitials ?? event.assist_initials),
    assistShirtNumber: normalizeText(event.assistShirtNumber ?? event.assist_shirt_number),
    homeScore: normalizeScore(event.homeScore ?? event.home_score ?? match.homeScore),
    awayScore: normalizeScore(event.awayScore ?? event.away_score ?? match.awayScore),
    notes: normalizeText(event.notes),
    eventStatus: normalizeText(event.eventStatus ?? event.event_status) || 'active',
    correctedAt: event.correctedAt || event.corrected_at || '',
    correctedByName: normalizeText(event.correctedByName ?? event.corrected_by_name),
    voidedAt: event.voidedAt || event.voided_at || '',
    voidedByName: normalizeText(event.voidedByName ?? event.voided_by_name),
    correctionReason: normalizeText(event.correctionReason ?? event.correction_reason),
    createdByName: normalizeText(event.createdByName ?? event.created_by_name),
    createdAt: event.createdAt || event.created_at || '',
  }
}

function getMatchEventLabel(eventType) {
  const labels = {
    yellow_card: 'Yellow card',
    red_card: 'Red card',
    substitution: 'Substitution',
    water_break: 'Water break',
  }

  return labels[normalizeText(eventType)] || 'Match event'
}

function getGoalEventKey(event = {}) {
  const normalizedEvent = normalizeGoalEvent(event)

  return normalizedEvent.id || [
    normalizedEvent.matchDayId,
    normalizedEvent.eventType,
    normalizedEvent.teamSide,
    normalizedEvent.minute ?? '',
    normalizedEvent.homeScore,
    normalizedEvent.awayScore,
    normalizedEvent.scorerName,
    normalizedEvent.createdAt,
  ].join(':')
}

function hasMatchingGoalEvent(events, savedEvent) {
  const savedKey = getGoalEventKey(savedEvent)

  return events.some((event) => getGoalEventKey(event) === savedKey)
}

function getSavedStatus(match = {}) {
  return ['scheduled', 'scorer_request'].includes(normalizeText(match.status))
    ? 'live'
    : normalizeText(match.status) || 'scheduled'
}

function getActorName(user = {}, savedEvent = {}) {
  return normalizeText(savedEvent.createdByName)
    || normalizeText(user.displayName)
    || normalizeText(user.name)
    || normalizeText(user.email)
}

export function buildLocalMatchDayGoalEventLogEntry({
  event,
  match = {},
  now = new Date().toISOString(),
  user = {},
}) {
  const savedEvent = normalizeGoalEvent(event, match)
  const goalEventId = savedEvent.id
  const eventKey = getGoalEventKey(savedEvent)

  return {
    id: `local-goal-log-${goalEventId || eventKey}`,
    clubId: normalizeText(match.clubId),
    teamId: normalizeText(match.teamId),
    matchDayId: savedEvent.matchDayId || normalizeText(match.id),
    playerId: '',
    playerName: '',
    actorUserId: normalizeText(user.id),
    actorDisplayName: getActorName(user, savedEvent),
    actorRole: normalizeText(user.roleLabel || user.role) || 'staff',
    eventType: 'scorer_updated',
    eventLabel: 'Goal added',
    previousValue: {
      homeScore: normalizeScore(match.homeScore),
      awayScore: normalizeScore(match.awayScore),
      status: normalizeText(match.status),
    },
    newValue: {
      homeScore: savedEvent.homeScore,
      awayScore: savedEvent.awayScore,
      status: getSavedStatus(match),
    },
    metadata: {
      goalEventId,
      teamSide: savedEvent.teamSide,
      minute: savedEvent.minute,
      scorerName: savedEvent.scorerName,
      source: 'staff_match_day',
      localReconciled: true,
    },
    createdAt: savedEvent.createdAt || now,
  }
}

function hasMatchingGoalEventLogEntry(entries, savedEvent) {
  const goalEventId = normalizeText(savedEvent.id)
  const localEntryId = `local-goal-log-${goalEventId || getGoalEventKey(savedEvent)}`

  return entries.some((entry) => (
    normalizeText(entry.id) === localEntryId
    || (goalEventId && normalizeText(entry.metadata?.goalEventId) === goalEventId)
  ))
}

export function reconcileMatchDayGoal(match, {
  event,
  now,
  user,
} = {}) {
  if (!match?.id || !event) {
    return match
  }

  const savedEvent = normalizeGoalEvent(event, match)
  const currentEvents = Array.isArray(match.events) ? match.events : []
  const currentEventLog = Array.isArray(match.eventLog) ? match.eventLog : []
  const nextEvents = hasMatchingGoalEvent(currentEvents, savedEvent)
    ? currentEvents
    : [savedEvent, ...currentEvents]
  const localEventLogEntry = buildLocalMatchDayGoalEventLogEntry({
    event: savedEvent,
    match,
    now,
    user,
  })
  const nextEventLog = hasMatchingGoalEventLogEntry(currentEventLog, savedEvent)
    ? currentEventLog
    : [localEventLogEntry, ...currentEventLog]

  return {
    ...match,
    status: getSavedStatus(match),
    homeScore: savedEvent.homeScore,
    awayScore: savedEvent.awayScore,
    events: nextEvents,
    eventLog: nextEventLog,
  }
}

export function reconcileMatchDayGoalInList(matches, {
  matchId,
  ...options
} = {}) {
  return (matches || []).map((match) => (
    String(match.id) === String(matchId)
      ? reconcileMatchDayGoal(match, options)
      : match
  ))
}

export function reconcileMatchDayEvent(match, {
  event,
  now,
  user,
} = {}) {
  if (!match?.id || !event) {
    return match
  }

  const savedEvent = normalizeGoalEvent(event, match)
  const currentEvents = Array.isArray(match.events) ? match.events : []
  const currentEventLog = Array.isArray(match.eventLog) ? match.eventLog : []
  const nextEvents = hasMatchingGoalEvent(currentEvents, savedEvent)
    ? currentEvents
    : [savedEvent, ...currentEvents]
  const eventKey = getGoalEventKey(savedEvent)
  const localEventLogId = `local-match-event-log-${savedEvent.id || eventKey}`
  const nextEventLog = currentEventLog.some((entry) => normalizeText(entry.id) === localEventLogId || normalizeText(entry.metadata?.matchEventId) === savedEvent.id)
    ? currentEventLog
    : [{
      id: localEventLogId,
      clubId: normalizeText(match.clubId),
      teamId: normalizeText(match.teamId),
      matchDayId: savedEvent.matchDayId || normalizeText(match.id),
      playerId: '',
      playerName: '',
      actorUserId: normalizeText(user?.id),
      actorDisplayName: getActorName(user, savedEvent),
      actorRole: normalizeText(user?.roleLabel || user?.role) || 'staff',
      eventType: savedEvent.eventType,
      eventLabel: getMatchEventLabel(savedEvent.eventType),
      previousValue: null,
      newValue: {
        eventType: savedEvent.eventType,
        teamSide: savedEvent.teamSide,
        minute: savedEvent.minute,
        playerName: savedEvent.scorerName,
        notes: savedEvent.notes,
      },
      metadata: {
        matchEventId: savedEvent.id,
        teamSide: savedEvent.teamSide,
        minute: savedEvent.minute,
        playerName: savedEvent.scorerName,
        source: 'staff_match_day',
        localReconciled: true,
      },
      createdAt: savedEvent.createdAt || now || new Date().toISOString(),
    }, ...currentEventLog]

  return {
    ...match,
    events: nextEvents,
    eventLog: nextEventLog,
  }
}

export function reconcileMatchDayEventInList(matches, {
  matchId,
  ...options
} = {}) {
  return (matches || []).map((match) => (
    String(match.id) === String(matchId)
      ? reconcileMatchDayEvent(match, options)
      : match
  ))
}

function normalizeGoalCorrectionResult(result = {}, match = {}) {
  const event = normalizeGoalEvent(result.event || result, match)

  return {
    matchDayId: normalizeText(result.matchDayId ?? result.match_day_id) || event.matchDayId || normalizeText(match.id),
    homeScore: normalizeScore(result.homeScore ?? result.home_score ?? event.homeScore),
    awayScore: normalizeScore(result.awayScore ?? result.away_score ?? event.awayScore),
    status: normalizeText(result.status) || normalizeText(match.status),
    event,
  }
}

function buildLocalGoalCorrectionLogEntry({
  action = 'corrected',
  event,
  match = {},
  now = new Date().toISOString(),
  user = {},
}) {
  const correctedEvent = normalizeGoalEvent(event, match)
  const isVoided = action === 'voided' || correctedEvent.eventStatus === 'voided'
  const label = isVoided ? 'Goal removed' : 'Goal corrected'

  return {
    id: `local-goal-correction-log-${correctedEvent.id}-${isVoided ? 'voided' : 'corrected'}-${now}`,
    clubId: normalizeText(match.clubId),
    teamId: normalizeText(match.teamId),
    matchDayId: correctedEvent.matchDayId || normalizeText(match.id),
    playerId: '',
    playerName: '',
    actorUserId: normalizeText(user.id),
    actorDisplayName: getActorName(user, correctedEvent),
    actorRole: normalizeText(user.roleLabel || user.role) || 'staff',
    eventType: 'scorer_updated',
    eventLabel: label,
    previousValue: {
      homeScore: normalizeScore(match.homeScore),
      awayScore: normalizeScore(match.awayScore),
    },
    newValue: {
      homeScore: correctedEvent.homeScore,
      awayScore: correctedEvent.awayScore,
      eventStatus: correctedEvent.eventStatus,
    },
    metadata: {
      goalEventId: correctedEvent.id,
      correctionAction: isVoided ? 'voided' : 'corrected',
      teamSide: correctedEvent.teamSide,
      source: 'match_day_goal_correction_rpc',
      localReconciled: true,
    },
    createdAt: correctedEvent.correctedAt || correctedEvent.voidedAt || now,
  }
}

export function reconcileMatchDayGoalCorrection(match, {
  action = 'corrected',
  result,
  now,
  user,
} = {}) {
  if (!match?.id || !result) {
    return match
  }

  const normalizedResult = normalizeGoalCorrectionResult(result, match)
  const correctedEvent = normalizedResult.event
  const currentEvents = Array.isArray(match.events) ? match.events : []
  const replacedEvents = currentEvents.some((event) => normalizeText(event.id) === correctedEvent.id)
    ? currentEvents.map((event) => (normalizeText(event.id) === correctedEvent.id ? correctedEvent : event))
    : [correctedEvent, ...currentEvents]
  const currentEventLog = Array.isArray(match.eventLog) ? match.eventLog : []
  const nextEventLog = [
    buildLocalGoalCorrectionLogEntry({
      action,
      event: correctedEvent,
      match,
      now,
      user,
    }),
    ...currentEventLog,
  ]

  return {
    ...match,
    status: normalizedResult.status || match.status,
    homeScore: normalizedResult.homeScore,
    awayScore: normalizedResult.awayScore,
    events: replacedEvents,
    eventLog: nextEventLog,
  }
}

export function reconcileMatchDayGoalCorrectionInList(matches, {
  matchId,
  ...options
} = {}) {
  return (matches || []).map((match) => (
    String(match.id) === String(matchId)
      ? reconcileMatchDayGoalCorrection(match, options)
      : match
  ))
}
