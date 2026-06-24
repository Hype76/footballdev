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
  return /^\d{2}:\d{2}/.test(normalizedValue) ? normalizedValue.slice(0, 5) : ''
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

    occurrences.push({
      id: occurrenceIndex === 0 ? `calendar:${calendarEvent.id}` : `calendar:${calendarEvent.id}:${date}`,
      sourceId: calendarEvent.id,
      sourceType: 'calendar',
      occurrenceDate: date,
      date,
      time: toTimeOnly(calendarEvent.startsAt),
      type: calendarEvent.eventType === 'general' ? 'club-event' : 'deadline',
      title: occurrenceIndex === 0 ? calendarEvent.title : `${calendarEvent.title} repeats`,
      description: [isClubWide ? 'Club-wide' : '', calendarEvent.location, calendarEvent.notes].filter(Boolean).join(', ') || 'Calendar event',
      editable: calendarEvent.canEdit !== false,
      isClubWide,
      isInheritedClubEvent,
      location: calendarEvent.location,
      data: {
        ...calendarEvent,
        isClubWide,
        isInheritedClubEvent,
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
  const sessionEvents = sessions
    .map((session) => {
      const date = toDateOnly(session.sessionDate || session.date)
      if (!date) {
        return null
      }

      const type = session.sessionType === 'match' ? 'match' : 'training'
      const title = session.title || (session.opponent ? `Match vs ${session.opponent}` : '') || (type === 'match' ? 'Match' : 'Training session')

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
        data: session,
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

      return {
        id: `match:${match.id}`,
        date,
        time: toTimeOnly(match.kickoffTime),
        type: 'match-day',
        title: `${match.teamName || 'Team'} vs ${match.opponent || 'Opponent'}`,
        description: [match.kickoffTime ? `Kick off ${match.kickoffTime}` : '', match.venueName].filter(Boolean).join(', '),
        href: '/match-day',
        editable: true,
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
