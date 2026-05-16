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

export function formatSessionType(value) {
  const normalizedValue = String(value ?? '').trim()

  if (normalizedValue === 'match') {
    return 'Match'
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

export function getNextSelectedPlayerIds(currentIds, playerId, checked) {
  return checked ? [...new Set([...currentIds, playerId])] : currentIds.filter((id) => id !== playerId)
}

export function getOpenSessionSearchParams(searchParams, sessionId) {
  const nextSearchParams = new URLSearchParams(searchParams)
  nextSearchParams.set('sessionId', sessionId)
  nextSearchParams.delete('completedSessionId')
  nextSearchParams.delete('completedCount')
  return nextSearchParams
}

export function getSessionsWithUpdatedSession(sessions, updatedSession) {
  return [
    updatedSession,
    ...sessions.filter((session) => session.id !== updatedSession.id),
  ]
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

export function getFilteredSessionPlayers({
  activePlayerSection,
  activePlayerTeam,
  activePlayerTeamId,
  players,
}) {
  const normalizedActiveTeam = normalizeTeamName(activePlayerTeam)
  const sectionPlayers = players.filter((player) => player.section === activePlayerSection)
  const teamMatchedPlayers = sectionPlayers.filter((player) => {
    const playerTeamId = String(player.teamId ?? '').trim()
    const playerTeam = normalizeTeamName(player.team)

    if (activePlayerTeamId && playerTeamId) {
      return String(activePlayerTeamId) === playerTeamId
    }

    if (!normalizedActiveTeam || !playerTeam) {
      return true
    }

    return playerTeam === normalizedActiveTeam
  })

  return teamMatchedPlayers.length > 0 ? teamMatchedPlayers : sectionPlayers
}

export function updateSessionFormValue({ currentForm, name, teams, value }) {
  if (name === 'teamId') {
    const matchingTeam = teams.find((team) => team.id === value)

    return {
      ...currentForm,
      teamId: value,
      team: matchingTeam?.name || '',
    }
  }

  if (name === 'sessionType') {
    return {
      ...currentForm,
      sessionType: value,
      opponent: value === 'match' ? currentForm.opponent : '',
    }
  }

  return {
    ...currentForm,
    [name]: value,
  }
}

export function buildSessionAssessmentUrl({
  playerName,
  queue = [],
  selectedSession,
  selectedSessionId,
  sessionForm,
  sessionPlayers,
}) {
  const params = new URLSearchParams()
  params.set('player', playerName)
  params.set('team', selectedSession?.team || sessionForm.team)
  params.set('session', selectedSession?.sessionDate || sessionForm.sessionDate)
  params.set('section', sessionPlayers.find((player) => player.playerName === playerName)?.section || sessionForm.section)

  if (selectedSessionId) {
    params.set('sessionId', selectedSessionId)
  }

  if (queue.length > 0) {
    params.set('queue', JSON.stringify(queue))
    params.set('queueTotal', String(queue.length))
  }

  return `/assess-player/new?${params.toString()}`
}

export function getUnassessedPlayerQueue({ completedPlayerNames, sessionPlayers }) {
  const completedSet = new Set(completedPlayerNames)

  return sessionPlayers
    .map((player) => player.playerName)
    .filter(Boolean)
    .filter((playerName) => !completedSet.has(normalizeProgressName(playerName)))
}

export function getRecorderOptions() {
  if (!globalThis.MediaRecorder) {
    return undefined
  }

  const supportedType = ['audio/webm', 'audio/mp4', 'audio/ogg'].find((type) => globalThis.MediaRecorder.isTypeSupported(type))
  return supportedType ? { mimeType: supportedType } : undefined
}

export function createSessionFromHistoricalTarget({ historicalSession, teams }) {
  const matchingTeam = teams.find(
    (team) =>
      String(team.id ?? '') === String(historicalSession.teamId ?? '') ||
      String(team.name ?? '').trim().toLowerCase() === String(historicalSession.team ?? '').trim().toLowerCase(),
  )

  if (!matchingTeam?.id) {
    throw new Error('Create the team before completing this historical session.')
  }

  return {
    teamId: matchingTeam.id,
    team: matchingTeam.name,
    opponent: historicalSession.opponent || '',
    sessionType: historicalSession.sessionType || 'training',
    sessionDate: historicalSession.sessionDate,
    section: historicalSession.section || 'Trial',
  }
}

export function buildSessionCachePayload({ evaluations, nextState = {}, players, sessions, teams }) {
  return {
    sessions,
    players,
    teams,
    evaluations,
    ...nextState,
  }
}
