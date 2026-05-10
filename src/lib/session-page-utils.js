import { formatUkDate } from './date-format.js'

export const SESSION_PLAYER_PAGE_SIZE = 8
export const AVAILABLE_PLAYER_PAGE_SIZE = 10

export function createInitialSessionForm() {
  return {
    teamId: '',
    team: '',
    opponent: '',
    sessionType: '',
    sessionDate: '',
    section: 'Trial',
  }
}

export function createInitialGameForm() {
  return {
    opponent: '',
    teamScore: '',
    opponentScore: '',
    gameDate: '',
    notes: '',
  }
}

export function formatSessionType(value) {
  const normalizedValue = String(value ?? '').trim()

  if (normalizedValue === 'match') {
    return 'Match'
  }

  if (normalizedValue === 'tournament') {
    return 'Tournament'
  }

  return 'Training'
}

export function formatSessionDate(value) {
  const normalizedValue = String(value ?? '').trim()

  if (!normalizedValue) {
    return 'No date entered'
  }

  const parsedDate = new Date(`${normalizedValue.slice(0, 10)}T00:00:00`)

  if (Number.isNaN(parsedDate.getTime())) {
    return normalizedValue
  }

  return formatUkDate(parsedDate.toISOString().slice(0, 10), normalizedValue)
}

export function readStoredSessionWorkspace(storageKey) {
  if (!storageKey) {
    return {}
  }

  try {
    const storedValue = localStorage.getItem(storageKey)
    const parsedValue = storedValue ? JSON.parse(storedValue) : {}
    return parsedValue && typeof parsedValue === 'object' ? parsedValue : {}
  } catch (error) {
    console.error(error)
    return {}
  }
}

export function writeStoredSessionWorkspace(storageKey, value) {
  if (!storageKey) {
    return
  }

  try {
    localStorage.setItem(storageKey, JSON.stringify(value))
  } catch (error) {
    console.error(error)
  }
}

export function getSessionProgressKey(user, sessionId) {
  if (!user?.clubId || !sessionId) {
    return ''
  }

  return `session-assessment-progress:${user.clubId}:${sessionId}`
}

export function normalizeProgressName(value) {
  return String(value ?? '').trim().toLowerCase()
}

export function normalizeTeamName(value) {
  return String(value ?? '')
    .trim()
    .toLowerCase()
    .replace(/[^\w\s]/g, '')
    .replace(/\s+/g, ' ')
}

export function normalizeSessionDateKey(value) {
  const normalizedValue = String(value ?? '').trim()

  if (!normalizedValue) {
    return ''
  }

  if (/^\d{4}-\d{2}-\d{2}/.test(normalizedValue)) {
    return normalizedValue.slice(0, 10)
  }

  const ukDateMatch = normalizedValue.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/)

  if (ukDateMatch) {
    const [, day, month, year] = ukDateMatch
    return `${year}-${month.padStart(2, '0')}-${day.padStart(2, '0')}`
  }

  const parsedDate = new Date(normalizedValue)

  if (Number.isNaN(parsedDate.getTime())) {
    return normalizedValue.toLowerCase()
  }

  return parsedDate.toISOString().slice(0, 10)
}

export function readCompletedPlayerNames(user, sessionId) {
  const progressKey = getSessionProgressKey(user, sessionId)

  if (!progressKey) {
    return []
  }

  try {
    const storedValue = localStorage.getItem(progressKey)
    const parsedValue = storedValue ? JSON.parse(storedValue) : []
    return Array.isArray(parsedValue) ? parsedValue.map(normalizeProgressName).filter(Boolean) : []
  } catch (error) {
    console.error(error)
    return []
  }
}

export function getHistoricalSessionId(evaluation) {
  const key = [
    String(evaluation.session || evaluation.date || 'No date entered').trim(),
    String(evaluation.team || 'No team entered').trim(),
    String(evaluation.section || 'Trial').trim(),
  ].join('|')

  return `history:${encodeURIComponent(key)}`
}

export function buildHistoricalSessionsFromEvaluations(evaluations, realSessions = []) {
  const realSessionKeys = new Set(
    realSessions.map((session) =>
      [
        String(session.sessionDate || '').slice(0, 10),
        String(session.team || '').trim().toLowerCase(),
      ].join('|'),
    ),
  )
  const groupedSessions = new Map()

  evaluations.forEach((evaluation) => {
    const sessionDate = String(evaluation.session || evaluation.date || '').trim()
    const team = String(evaluation.team || '').trim()
    const section = String(evaluation.section || 'Trial').trim() || 'Trial'

    if (!sessionDate && !team) {
      return
    }

    const realSessionKey = [sessionDate.slice(0, 10), team.toLowerCase()].join('|')

    if (realSessionKeys.has(realSessionKey)) {
      return
    }

    const historicalSession = {
      id: getHistoricalSessionId(evaluation),
      clubId: evaluation.clubId,
      teamId: evaluation.teamId || '',
      team,
      opponent: '',
      sessionType: 'training',
      sessionDate,
      title: `${team || 'Historical session'} | ${formatSessionDate(sessionDate)} | ${section}`,
      createdBy: evaluation.coachId || '',
      createdAt: evaluation.createdAt || '',
      updatedAt: evaluation.createdAt || '',
      section,
      isHistorical: true,
      status: 'open',
    }

    if (!groupedSessions.has(historicalSession.id)) {
      groupedSessions.set(historicalSession.id, historicalSession)
    }
  })

  return Array.from(groupedSessions.values())
}

export function buildHistoricalSessionPlayers(evaluations, selectedSession) {
  if (!selectedSession?.isHistorical) {
    return []
  }

  const selectedSessionId = selectedSession.id
  const playersByName = new Map()

  evaluations
    .filter((evaluation) => getHistoricalSessionId(evaluation) === selectedSessionId)
    .forEach((evaluation) => {
      const playerName = String(evaluation.playerName ?? '').trim()

      if (!playerName || playersByName.has(playerName.toLowerCase())) {
        return
      }

      playersByName.set(playerName.toLowerCase(), {
        id: `history-player:${evaluation.id}`,
        sessionId: selectedSessionId,
        playerId: evaluation.playerId || '',
        playerName,
        section: evaluation.section || selectedSession.section || 'Trial',
        team: evaluation.team || selectedSession.team || '',
        parentName: evaluation.parentName || '',
        parentEmail: evaluation.parentEmail || '',
        parentContacts: evaluation.parentContacts || [],
        notes: evaluation.comments?.overall || evaluation.comments?.strengths || '',
        createdAt: evaluation.createdAt || '',
        updatedAt: evaluation.createdAt || '',
      })
    })

  return Array.from(playersByName.values())
}

export function getCompletedPlayerNamesFromEvaluations(evaluations, selectedSession, sessionPlayers) {
  if (!selectedSession || sessionPlayers.length === 0) {
    return []
  }

  const sessionPlayerNames = new Set(sessionPlayers.map((player) => normalizeProgressName(player.playerName)).filter(Boolean))
  const selectedSessionId = String(selectedSession.id ?? '').trim()
  const selectedSessionDate = normalizeSessionDateKey(selectedSession.sessionDate)
  const selectedTeam = String(selectedSession.team ?? '').trim().toLowerCase()

  return [
    ...new Set(
      evaluations
        .filter((evaluation) => {
          const playerName = normalizeProgressName(evaluation.playerName)

          if (!sessionPlayerNames.has(playerName)) {
            return false
          }

          const evaluationSessionId = String(evaluation.assessmentSessionId ?? evaluation.assessment_session_id ?? '').trim()

          if (selectedSessionId && evaluationSessionId) {
            return selectedSessionId === evaluationSessionId
          }

          const evaluationSessionDate = normalizeSessionDateKey(evaluation.session || evaluation.date)
          const evaluationTeam = String(evaluation.team ?? '').trim().toLowerCase()

          if (selectedSessionDate && evaluationSessionDate && selectedSessionDate !== evaluationSessionDate) {
            return false
          }

          if (selectedTeam && evaluationTeam && selectedTeam !== evaluationTeam) {
            return false
          }

          return true
        })
        .map((evaluation) => normalizeProgressName(evaluation.playerName)),
    ),
  ]
}

export function getAssessmentCountForSession(evaluations, selectedSession) {
  if (!selectedSession || selectedSession.isHistorical) {
    return 0
  }

  const selectedSessionId = String(selectedSession.id ?? '').trim()
  const selectedSessionDate = normalizeSessionDateKey(selectedSession.sessionDate)
  const selectedTeamId = String(selectedSession.teamId ?? '').trim()
  const selectedTeam = String(selectedSession.team ?? '').trim().toLowerCase()

  return evaluations.filter((evaluation) => {
    const evaluationSessionId = String(evaluation.assessmentSessionId ?? evaluation.assessment_session_id ?? '').trim()

    if (selectedSessionId && evaluationSessionId) {
      return selectedSessionId === evaluationSessionId
    }

    const evaluationSessionDate = normalizeSessionDateKey(evaluation.session || evaluation.date)
    const evaluationTeamId = String(evaluation.teamId ?? '').trim()
    const evaluationTeam = String(evaluation.team ?? '').trim().toLowerCase()

    if (selectedSessionDate && evaluationSessionDate && selectedSessionDate !== evaluationSessionDate) {
      return false
    }

    if (selectedTeamId && evaluationTeamId) {
      return selectedTeamId === evaluationTeamId
    }

    if (selectedTeam && evaluationTeam) {
      return selectedTeam === evaluationTeam
    }

    return false
  }).length
}
