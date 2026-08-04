const UK_TIME_ZONE = 'Europe/London'
const CLOSED_MATCH_STATUSES = new Set(['cancelled', 'postponed', 'full_time'])

function normalizeText(value) {
  return String(value ?? '').trim()
}

function isInActiveTeamScope(itemTeamId, activeTeamId, allowClubWide = false) {
  const normalizedActiveTeamId = normalizeText(activeTeamId)
  const normalizedItemTeamId = normalizeText(itemTeamId)

  if (!normalizedActiveTeamId) {
    return allowClubWide ? !normalizedItemTeamId : true
  }

  return normalizedItemTeamId === normalizedActiveTeamId || (allowClubWide && !normalizedItemTeamId)
}

function getUkDateTimeParts(value) {
  const date = value instanceof Date ? value : new Date(value)

  if (Number.isNaN(date.getTime())) {
    return null
  }

  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: UK_TIME_ZONE,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  }).formatToParts(date)
  const values = Object.fromEntries(parts.map((part) => [part.type, part.value]))
  return {
    date: `${values.year}-${values.month}-${values.day}`,
    time: `${values.hour}:${values.minute}`,
  }
}

function addDate(dateValue, frequency) {
  const date = new Date(`${dateValue}T12:00:00Z`)

  if (frequency === 'weekly') {
    date.setUTCDate(date.getUTCDate() + 7)
  } else if (frequency === 'fortnightly') {
    date.setUTCDate(date.getUTCDate() + 14)
  } else if (frequency === 'monthly') {
    date.setUTCMonth(date.getUTCMonth() + 1)
  } else {
    return ''
  }

  return date.toISOString().slice(0, 10)
}

function getCalendarEventType(eventType) {
  if (eventType === 'training') {
    return 'training'
  }

  if (eventType === 'match') {
    return 'match'
  }

  return 'club-event'
}

function buildCalendarOccurrences(calendarEvent) {
  const startsAt = getUkDateTimeParts(calendarEvent.startsAt)

  if (!startsAt) {
    return []
  }

  const frequency = normalizeText(calendarEvent.recurrenceFrequency) || 'none'
  const recurrenceUntil = normalizeText(calendarEvent.recurrenceUntil) || startsAt.date
  const occurrences = []
  let occurrenceDate = startsAt.date
  let occurrenceIndex = 0

  while (occurrenceIndex < 80 && occurrenceDate <= recurrenceUntil) {
    occurrences.push({
      id: occurrenceIndex === 0 ? `calendar:${calendarEvent.id}` : `calendar:${calendarEvent.id}:${occurrenceDate}`,
      sourceId: calendarEvent.id,
      sourceType: 'calendar',
      date: occurrenceDate,
      time: startsAt.time,
      startKey: `${occurrenceDate}T${startsAt.time}`,
      type: getCalendarEventType(calendarEvent.eventType),
      title: calendarEvent.title || 'Calendar event',
      description: [calendarEvent.location, calendarEvent.notes].filter(Boolean).join(', '),
      data: {
        ...calendarEvent,
        recurrenceOccurrenceDate: occurrenceDate,
        recurrenceOccurrenceIndex: occurrenceIndex,
        isGeneratedOccurrence: occurrenceIndex > 0,
      },
    })

    occurrenceIndex += 1
    occurrenceDate = addDate(occurrenceDate, frequency)

    if (!occurrenceDate) {
      break
    }
  }

  return occurrences
}

function buildMatchEvent(match) {
  const date = normalizeText(match.matchDate)

  if (!date) {
    return null
  }

  const kickoffTime = match.kickoffTimeTbc === true
    ? '23:59'
    : normalizeText(match.kickoffTime).slice(0, 5) || '23:59'

  return {
    id: `match:${match.id}`,
    sourceId: match.id,
    sourceType: 'match-day',
    date,
    time: match.kickoffTimeTbc === true ? 'TBC' : kickoffTime,
    startKey: `${date}T${kickoffTime}`,
    type: 'match-day',
    title: match.opponent ? `Match vs ${match.opponent}` : 'Match Day',
    description: [match.venueName, match.venueAddress].filter(Boolean).join(', '),
    data: match,
  }
}

export function getManagerHomeNextUp({ calendarEvents = [], matchDays = [], activeTeamId = '', now = new Date() } = {}) {
  const nowParts = getUkDateTimeParts(now)

  if (!nowParts) {
    return null
  }

  const nowKey = `${nowParts.date}T${nowParts.time}`
  const scopedCalendarEvents = calendarEvents
    .filter((event) => !event.cancelledAt && isInActiveTeamScope(event.teamId, activeTeamId, true))
    .flatMap(buildCalendarOccurrences)
  const scopedMatchDays = matchDays
    .filter((match) => (
      !match.deletedAt
      && !match.concludedAt
      && !CLOSED_MATCH_STATUSES.has(normalizeText(match.status).toLowerCase())
      && isInActiveTeamScope(match.teamId, activeTeamId)
    ))
    .map(buildMatchEvent)
    .filter(Boolean)

  return [...scopedCalendarEvents, ...scopedMatchDays]
    .filter((event) => event.startKey >= nowKey)
    .sort((left, right) => left.startKey.localeCompare(right.startKey) || left.title.localeCompare(right.title))[0] || null
}

export function getManagerHomeNextUpContext(event) {
  if (!event) {
    return 'Add an event or open the calendar when the next team activity is ready.'
  }

  const date = new Intl.DateTimeFormat('en-GB', {
    weekday: 'short',
    day: 'numeric',
    month: 'short',
    timeZone: 'UTC',
  }).format(new Date(`${event.date}T12:00:00Z`))
  const type = event.type === 'match-day'
    ? 'Match'
    : event.type === 'training'
      ? 'Training'
      : 'Calendar event'
  const time = normalizeText(event.time)

  return [type, date, time && time !== 'TBC' ? time : time === 'TBC' ? 'Time TBC' : ''].filter(Boolean).join(', ')
}

export function getManagerHomeNextUpHref(event) {
  if (!event) {
    return '/calendar?action=add-event'
  }

  if (event.sourceType === 'match-day') {
    return `/match-day?fixture=${encodeURIComponent(event.sourceId)}`
  }

  const searchParams = new URLSearchParams({
    action: 'view',
    eventId: event.sourceId,
    source: event.sourceType || 'calendar',
  })

  return `/calendar?${searchParams.toString()}`
}
