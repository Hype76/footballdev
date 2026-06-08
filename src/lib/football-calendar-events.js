function toDateOnly(value) {
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

export function buildFootballCalendarEvents({ sessions = [], evaluations = [], matchDays = [], polls = [] }) {
  const sessionEvents = sessions
    .map((session) => {
      const date = toDateOnly(session.sessionDate || session.date)
      if (!date) {
        return null
      }

      const type = session.sessionType === 'match' ? 'match' : 'training'
      const title = session.title || (session.opponent ? `${session.team || 'Team'} vs ${session.opponent}` : session.team) || 'Session'

      return {
        id: `session:${session.id}`,
        date,
        type,
        title,
        description: `${session.team || 'Team'}${session.status ? `, ${session.status}` : ''}`,
        href: `/sessions?sessionId=${encodeURIComponent(session.id)}`,
      }
    })
    .filter(Boolean)

  const matchEvents = matchDays
    .map((match) => {
      const date = toDateOnly(match.matchDate)
      if (!date) {
        return null
      }

      return {
        id: `match:${match.id}`,
        date,
        type: 'match-day',
        title: `${match.teamName || 'Team'} vs ${match.opponent || 'Opponent'}`,
        description: [match.kickoffTime ? `Kick off ${match.kickoffTime}` : '', match.venueName].filter(Boolean).join(', '),
        href: '/match-day',
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
        type: 'deadline',
        title: `${poll.title || 'Parent response'} closes`,
        description: poll.teamName || poll.audience || 'Response cut off',
        href: '/polls',
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
        type: 'development',
        title: `${playerName || 'Player'} development record`,
        description: evaluation.session || evaluation.team || 'Development activity',
        href: playerName ? `/player/${encodeURIComponent(playerName)}` : '/players',
      }
    })
    .filter(Boolean)

  return [...sessionEvents, ...matchEvents, ...pollEvents, ...developmentEvents]
    .sort((left, right) => left.date.localeCompare(right.date) || left.title.localeCompare(right.title))
}
