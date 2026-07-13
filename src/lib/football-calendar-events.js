import { getMatchDayDisplayName } from './matchday-display.js'
import { getMatchCalendarLocation, getMatchVenueDisplay } from './match-location.js'
import { getFixtureKickoffLabel } from './calendar-datetime-integrity.js'

function toDateOnly(value) {
  if (value instanceof Date) {
    const year = value.getFullYear()
    const month = String(value.getMonth() + 1).padStart(2, '0')
    const day = String(value.getDate()).padStart(2, '0')
    return Number.isNaN(value.getTime()) ? '' : `${year}-${month}-${day}`
  }

  const normalizedValue = String(value ?? '').trim()
  if (!normalizedValue) {
    return ''
  }

  if (/^\d{4}-\d{2}-\d{2}$/.test(normalizedValue)) {
    return normalizedValue
  }

  const parsedDate = new Date(normalizedValue)
  return Number.isNaN(parsedDate.getTime()) ? '' : parsedDate.toISOString().slice(0, 10)
}

function toTimeOnly(value) {
  const normalizedValue = String(value ?? '').trim()

  if (/^\d{2}:\d{2}/.test(normalizedValue)) {
    return normalizedValue.slice(0, 5)
  }

  const parsedDate = new Date(normalizedValue)

  if (Number.isNaN(parsedDate.getTime())) {
    return ''
  }

  return `${String(parsedDate.getHours()).padStart(2, '0')}:${String(parsedDate.getMinutes()).padStart(2, '0')}`
}

function buildDateTime(dateValue, timeValue) {
  const date = toDateOnly(dateValue)
  const time = toTimeOnly(timeValue)

  return date && time ? `${date}T${time}:00` : ''
}

function addDays(date, days) {
  const nextDate = new Date(date)
  nextDate.setDate(date.getDate() + days)
  return nextDate
}

function addMonths(date, months) {
  const nextDate = new Date(date)
  nextDate.setMonth(date.getMonth() + months)
  return nextDate
}

function getCalendarEventDisplayType(eventType) {
  if (eventType === 'training') {
    return 'training'
  }

  if (eventType === 'match') {
    return 'match'
  }

  return eventType === 'general' ? 'club-event' : 'deadline'
}

function getDateTime(value) {
  const parsedDate = new Date(value)
  return Number.isNaN(parsedDate.getTime()) ? 0 : parsedDate.getTime()
}

function getSessionSeriesKey(session) {
  if (session?.isHistorical || session?.sessionType === 'match') {
    return ''
  }

  const createdAt = getDateTime(session.createdAt)

  if (!createdAt) {
    return ''
  }

  return [
    session.clubId || '',
    session.teamId || '',
    String(session.team || '').trim().toLowerCase(),
    String(session.sessionType || 'training').trim().toLowerCase(),
    String(session.title || '').trim().toLowerCase(),
    String(session.startTime || '').trim(),
    String(session.endTime || '').trim(),
    String(session.location || '').trim().toLowerCase(),
    String(session.notes || '').trim().toLowerCase(),
    session.createdBy || '',
  ].join('|')
}

function getDayDifference(leftDate, rightDate) {
  const left = new Date(`${toDateOnly(leftDate)}T00:00:00`)
  const right = new Date(`${toDateOnly(rightDate)}T00:00:00`)

  if (Number.isNaN(left.getTime()) || Number.isNaN(right.getTime())) {
    return 0
  }

  return Math.round((right.getTime() - left.getTime()) / 86400000)
}

function getSessionSeriesFrequency(sortedSessions) {
  const gaps = []

  for (let index = 1; index < sortedSessions.length; index += 1) {
    gaps.push(getDayDifference(sortedSessions[index - 1].sessionDate, sortedSessions[index].sessionDate))
  }

  if (gaps.length === 0 || gaps.some((gap) => gap <= 0)) {
    return 'none'
  }

  if (gaps.every((gap) => gap === 7)) {
    return 'weekly'
  }

  if (gaps.every((gap) => gap === 14)) {
    return 'fortnightly'
  }

  const monthly = sortedSessions.every((session, index) => {
    if (index === 0) {
      return true
    }

    const previous = new Date(`${sortedSessions[index - 1].sessionDate}T00:00:00`)
    const current = new Date(`${session.sessionDate}T00:00:00`)
    const expected = addMonths(previous, 1)

    return toDateOnly(expected) === toDateOnly(current)
  })

  return monthly ? 'monthly' : 'none'
}

function buildLegacySessionSeriesById(sessions = []) {
  const groups = new Map()

  sessions.forEach((session) => {
    const key = getSessionSeriesKey(session)

    if (!key) {
      return
    }

    if (!groups.has(key)) {
      groups.set(key, [])
    }

    groups.get(key).push(session)
  })

  const seriesById = new Map()

  groups.forEach((group, key) => {
    const sortedGroup = group
      .filter((session) => toDateOnly(session.sessionDate))
      .sort((left, right) => toDateOnly(left.sessionDate).localeCompare(toDateOnly(right.sessionDate)))

    if (sortedGroup.length < 2) {
      return
    }

    const createdTimes = sortedGroup.map((session) => getDateTime(session.createdAt)).filter(Boolean)
    const createdWindowMs = Math.max(...createdTimes) - Math.min(...createdTimes)

    if (createdTimes.length !== sortedGroup.length || createdWindowMs > 30 * 60 * 1000) {
      return
    }

    const recurrenceFrequency = getSessionSeriesFrequency(sortedGroup)

    if (recurrenceFrequency === 'none') {
      return
    }

    const series = {
      id: `legacy-session-series:${key}:${Math.min(...createdTimes)}`,
      recurrenceFrequency,
      recurrenceUntil: toDateOnly(sortedGroup[sortedGroup.length - 1].sessionDate),
      sessionIds: sortedGroup.map((session) => session.id),
      startsOn: toDateOnly(sortedGroup[0].sessionDate),
    }

    sortedGroup.forEach((session) => {
      seriesById.set(session.id, series)
    })
  })

  return seriesById
}

function buildCalendarEventOccurrences(calendarEvent) {
  const startsAt = new Date(calendarEvent.startsAt)

  if (Number.isNaN(startsAt.getTime())) {
    return []
  }

  const frequency = calendarEvent.recurrenceFrequency || 'none'
  const recurrenceUntil = calendarEvent.recurrenceUntil ? new Date(`${calendarEvent.recurrenceUntil}T23:59:59`) : null
  const maxDate = recurrenceUntil && !Number.isNaN(recurrenceUntil.getTime())
    ? recurrenceUntil
    : addMonths(startsAt, 3)
  const occurrences = []
  let occurrenceDate = new Date(startsAt)
  let occurrenceIndex = 0

  while (occurrenceIndex < 80 && occurrenceDate.getTime() <= maxDate.getTime()) {
    const date = toDateOnly(occurrenceDate)
    const isClubWide = Boolean(calendarEvent.isClubWide || !calendarEvent.teamId)
    const isInheritedClubEvent = Boolean(calendarEvent.isInheritedClubEvent)
    const endDayOffset = getDayDifference(calendarEvent.startsAt, calendarEvent.endsAt || calendarEvent.startsAt)
    const occurrenceEndDate = addDays(new Date(`${date}T00:00:00`), endDayOffset)
    const occurrenceStartsAt = buildDateTime(date, calendarEvent.startsAt)
    const occurrenceEndsAt = buildDateTime(occurrenceEndDate, calendarEvent.endsAt || calendarEvent.startsAt)
    const isRecurring = frequency !== 'none'

    occurrences.push({
      id: occurrenceIndex === 0 ? `calendar:${calendarEvent.id}` : `calendar:${calendarEvent.id}:${date}`,
      sourceId: calendarEvent.id,
      sourceType: 'calendar',
      occurrenceDate: date,
      date,
      time: toTimeOnly(calendarEvent.startsAt),
      type: getCalendarEventDisplayType(calendarEvent.eventType),
      title: occurrenceIndex === 0 ? calendarEvent.title : `${calendarEvent.title} repeats`,
      description: [isClubWide ? 'Club-wide' : '', calendarEvent.location, calendarEvent.notes].filter(Boolean).join(', ') || 'Calendar event',
      editable: calendarEvent.canEdit !== false,
      isClubWide,
      isInheritedClubEvent,
      location: calendarEvent.location,
      data: {
        ...calendarEvent,
        startsAt: occurrenceStartsAt || calendarEvent.startsAt,
        endsAt: occurrenceEndsAt || calendarEvent.endsAt,
        isGeneratedOccurrence: isRecurring && occurrenceIndex > 0,
        isRecurring,
        isClubWide,
        isInheritedClubEvent,
        recurrenceOccurrenceDate: date,
        recurrenceOccurrenceIndex: occurrenceIndex,
        recurrenceSeriesId: calendarEvent.id,
        seriesEndsAt: calendarEvent.endsAt,
        seriesStartsAt: calendarEvent.startsAt,
        canEdit: calendarEvent.canEdit !== false,
      },
    })

    occurrenceIndex += 1

    if (frequency === 'weekly') {
      occurrenceDate = addDays(occurrenceDate, 7)
    } else if (frequency === 'fortnightly') {
      occurrenceDate = addDays(occurrenceDate, 14)
    } else if (frequency === 'monthly') {
      occurrenceDate = addMonths(occurrenceDate, 1)
    } else {
      break
    }
  }

  return occurrences
}

function buildAssessmentReminderEvents(assessmentReminders, evaluations) {
  const evaluationsById = new Map(evaluations.map((evaluation) => [String(evaluation.id ?? ''), evaluation]))
  const latestReminderByEvaluation = new Map()

  assessmentReminders.forEach((reminder) => {
    const evaluationId = String(reminder.evaluationId || reminder.metadata?.evaluationId || '').trim()
    const dueDate = toDateOnly(reminder.metadata?.dueDate)

    if (!evaluationId || !dueDate) {
      return
    }

    const existingReminder = latestReminderByEvaluation.get(evaluationId)
    const existingCreatedAt = new Date(existingReminder?.createdAt || 0).getTime()
    const nextCreatedAt = new Date(reminder.createdAt || 0).getTime()

    if (!existingReminder || nextCreatedAt >= existingCreatedAt) {
      latestReminderByEvaluation.set(evaluationId, reminder)
    }
  })

  return Array.from(latestReminderByEvaluation.values())
    .map((reminder) => {
      const evaluationId = String(reminder.evaluationId || reminder.metadata?.evaluationId || '').trim()
      const evaluation = evaluationsById.get(evaluationId)

      if (!evaluation) {
        return null
      }

      const date = toDateOnly(reminder.metadata?.dueDate)
      const playerName = String(reminder.metadata?.playerName || evaluation.playerName || '').trim()
      const team = String(reminder.metadata?.team || evaluation.team || '').trim()

      return {
        id: `assessment-reminder:${reminder.id}`,
        date,
        time: toTimeOnly(reminder.metadata?.dueDate),
        type: 'assessment-reminder',
        title: `${playerName || 'Player'} assessment reminder`,
        description: [team, reminder.metadata?.section || evaluation.section, 'Next assessment due'].filter(Boolean).join(', '),
        href: `/assess-player/new?evaluationId=${encodeURIComponent(evaluationId)}`,
        editable: false,
        sourceId: reminder.id,
        sourceType: 'assessment-reminder',
        data: {
          reminder,
          evaluation,
        },
      }
    })
    .filter(Boolean)
}

export function buildFootballCalendarEvents({ calendarEvents = [], sessions = [], evaluations = [], matchDays = [], polls = [], assessmentReminders = [] }) {
  const legacySessionSeriesById = buildLegacySessionSeriesById(sessions)
  const sessionEvents = sessions
    .map((session) => {
      const date = toDateOnly(session.sessionDate || session.date)
      if (!date) {
        return null
      }

      const type = session.sessionType === 'match' ? 'match' : 'training'
      const title = session.title || (session.opponent ? `Match vs ${session.opponent}` : '') || (type === 'match' ? 'Match' : 'Training session')
      const legacyRecurringSeries = legacySessionSeriesById.get(session.id) || null

      return {
        id: `session:${session.id}`,
        date,
        time: toTimeOnly(session.startTime),
        type,
        title,
        description: type === 'match'
          ? [
            session.arrivalTime ? `Arrival ${session.arrivalTime}` : '',
            session.startTime ? `Kick-off ${session.startTime}` : '',
            session.opponent ? `vs ${session.opponent}` : '',
            session.location,
          ].filter(Boolean).join(', ') || 'Fixture'
          : [session.startTime, session.location, session.team || 'Team', session.status].filter(Boolean).join(', '),
        href: `/sessions?sessionId=${encodeURIComponent(session.id)}`,
        editable: !session.isHistorical,
        sourceId: session.id,
        sourceType: 'session',
        data: legacyRecurringSeries ? {
          ...session,
          legacyRecurringSeries,
          recurrenceFrequency: legacyRecurringSeries.recurrenceFrequency,
          recurrenceUntil: legacyRecurringSeries.recurrenceUntil,
        } : session,
      }
    })
    .filter(Boolean)

  const matchEvents = matchDays
    .filter((match) => String(match.status ?? '').trim().toLowerCase() !== 'cancelled')
    .map((match) => {
      const date = toDateOnly(match.matchDate)
      if (!date) {
        return null
      }

      const kickoffLabel = getFixtureKickoffLabel(match)

      return {
        id: `match:${match.id}`,
        date,
        time: kickoffLabel,
        type: 'match-day',
        title: getMatchDayDisplayName(match),
        description: [kickoffLabel ? `Kick off ${kickoffLabel}` : '', getMatchVenueDisplay(match)].filter(Boolean).join(', '),
        location: getMatchCalendarLocation(match),
        href: '/match-day',
        editable: ['scheduled', 'scorer_request', 'postponed'].includes(String(match.status ?? '').trim().toLowerCase()),
        sourceId: match.id,
        sourceType: 'match-day',
        data: match,
      }
    })
    .filter(Boolean)

  const pollEvents = polls
    .map((poll) => {
      const date = toDateOnly(poll.closesAt)
      if (!date) {
        return null
      }

      return {
        id: `poll:${poll.id}`,
        date,
        time: toTimeOnly(poll.closesAt),
        type: 'deadline',
        title: `${poll.title || 'Parent response'} closes`,
        description: poll.teamName || poll.audience || 'Response cut off',
        href: '/polls',
        editable: false,
        sourceId: poll.id,
        sourceType: 'poll',
        data: poll,
      }
    })
    .filter(Boolean)

  const developmentEvents = evaluations
    .map((evaluation) => {
      const date = toDateOnly(evaluation.date)
      if (!date) {
        return null
      }

      const playerName = String(evaluation.playerName ?? '').trim()

      return {
        id: `development:${evaluation.id}`,
        date,
        time: '',
        type: 'development',
        title: `${playerName || 'Player'} development record`,
        description: evaluation.session || evaluation.team || 'Development activity',
        href: playerName ? `/player/${encodeURIComponent(playerName)}` : '/players',
        editable: false,
        sourceId: evaluation.id,
        sourceType: 'development',
        data: evaluation,
      }
    })
    .filter(Boolean)

  const customEvents = calendarEvents.flatMap(buildCalendarEventOccurrences)
  const reminderEvents = buildAssessmentReminderEvents(assessmentReminders, evaluations)

  return [...sessionEvents, ...matchEvents, ...pollEvents, ...developmentEvents, ...customEvents, ...reminderEvents]
    .sort((left, right) =>
      left.date.localeCompare(right.date) ||
      String(left.time || '').localeCompare(String(right.time || '')) ||
      left.title.localeCompare(right.title),
    )
}
