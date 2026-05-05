import { useEffect, useMemo, useState } from 'react'
import { Navigate, useNavigate, useSearchParams } from 'react-router-dom'
import { ConfirmModal } from '../components/ui/ConfirmModal.jsx'
import { NoticeBanner } from '../components/ui/NoticeBanner.jsx'
import { getPaginatedItems, Pagination } from '../components/ui/Pagination.jsx'
import { PageHeader } from '../components/ui/PageHeader.jsx'
import { SectionCard } from '../components/ui/SectionCard.jsx'
import { useToast } from '../components/ui/Toast.jsx'
import { canCreateEvaluation, useAuth, verifyCurrentUserPassword } from '../lib/auth.js'
import {
  EVALUATION_SECTIONS,
  addPlayersToAssessmentSession,
  clearAssessmentSessionPlayers,
  completeAssessmentSession,
  createAssessmentSession,
  createAssessmentSessionGame,
  deleteAssessmentSessionGame,
  getEvaluations,
  getAssessmentSessionGames,
  getAssessmentSessionPlayers,
  getAssessmentSessions,
  getAvailableTeamsForUser,
  getPlayers,
  readViewCache,
  readViewCacheValue,
  withRequestTimeout,
  writeViewCache,
} from '../lib/supabase.js'

function createInitialSessionForm() {
  return {
    teamId: '',
    team: '',
    opponent: '',
    sessionType: '',
    sessionDate: '',
    section: 'Trial',
  }
}

function createInitialGameForm() {
  return {
    opponent: '',
    teamScore: '',
    opponentScore: '',
    gameDate: '',
    notes: '',
  }
}

const SESSION_PLAYER_PAGE_SIZE = 8
const AVAILABLE_PLAYER_PAGE_SIZE = 10

function formatSessionType(value) {
  const normalizedValue = String(value ?? '').trim()

  if (normalizedValue === 'match') {
    return 'Match'
  }

  if (normalizedValue === 'tournament') {
    return 'Tournament'
  }

  return 'Training'
}

function formatSessionDate(value) {
  const normalizedValue = String(value ?? '').trim()

  if (!normalizedValue) {
    return 'No date entered'
  }

  const parsedDate = new Date(`${normalizedValue.slice(0, 10)}T00:00:00`)

  if (Number.isNaN(parsedDate.getTime())) {
    return normalizedValue
  }

  return new Intl.DateTimeFormat('en-GB', {
    weekday: 'short',
    day: 'numeric',
    month: 'long',
    year: 'numeric',
  }).format(parsedDate)
}

function readStoredSessionWorkspace(storageKey) {
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

function writeStoredSessionWorkspace(storageKey, value) {
  if (!storageKey) {
    return
  }

  try {
    localStorage.setItem(storageKey, JSON.stringify(value))
  } catch (error) {
    console.error(error)
  }
}

function getSessionProgressKey(user, sessionId) {
  if (!user?.clubId || !sessionId) {
    return ''
  }

  return `session-assessment-progress:${user.clubId}:${sessionId}`
}

function normalizeProgressName(value) {
  return String(value ?? '').trim().toLowerCase()
}

function normalizeSessionDateKey(value) {
  const normalizedValue = String(value ?? '').trim()

  if (!normalizedValue) {
    return ''
  }

  if (/^\d{4}-\d{2}-\d{2}/.test(normalizedValue)) {
    return normalizedValue.slice(0, 10)
  }

  const parsedDate = new Date(normalizedValue)

  if (Number.isNaN(parsedDate.getTime())) {
    return normalizedValue.toLowerCase()
  }

  return parsedDate.toISOString().slice(0, 10)
}

function readCompletedPlayerNames(user, sessionId) {
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

function getHistoricalSessionId(evaluation) {
  const key = [
    String(evaluation.session || evaluation.date || 'No date entered').trim(),
    String(evaluation.team || 'No team entered').trim(),
    String(evaluation.section || 'Trial').trim(),
  ].join('|')

  return `history:${encodeURIComponent(key)}`
}

function buildHistoricalSessionsFromEvaluations(evaluations, realSessions = []) {
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

function buildHistoricalSessionPlayers(evaluations, selectedSession) {
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

function getCompletedPlayerNamesFromEvaluations(evaluations, selectedSession, sessionPlayers) {
  if (!selectedSession || sessionPlayers.length === 0) {
    return []
  }

  const sessionPlayerNames = new Set(sessionPlayers.map((player) => normalizeProgressName(player.playerName)).filter(Boolean))
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

export function SessionsPage() {
  const { user } = useAuth()
  const navigate = useNavigate()
  const [searchParams, setSearchParams] = useSearchParams()
  const { showToast } = useToast()
  const activeTeamScope = user?.activeTeamId || user?.activeTeamName || 'assigned'
  const cacheKey = user?.clubId ? `sessions:${user.clubId}:${user.id}:${user.roleRank}:${activeTeamScope}` : ''
  const workspaceStorageKey = user?.clubId ? `session-workspace:${user.clubId}:${user.id}:${activeTeamScope}` : ''
  const storedSessionWorkspace = useMemo(
    () => readStoredSessionWorkspace(workspaceStorageKey),
    [workspaceStorageKey],
  )
  const [sessions, setSessions] = useState(() => {
    const cachedSessions = readViewCacheValue(cacheKey, 'sessions', [])
    return Array.isArray(cachedSessions) ? cachedSessions : []
  })
  const [players, setPlayers] = useState(() => {
    const cachedPlayers = readViewCacheValue(cacheKey, 'players', [])
    return Array.isArray(cachedPlayers) ? cachedPlayers : []
  })
  const [teams, setTeams] = useState(() => {
    const cachedTeams = readViewCacheValue(cacheKey, 'teams', [])
    return Array.isArray(cachedTeams) ? cachedTeams : []
  })
  const [evaluations, setEvaluations] = useState(() => {
    const cachedEvaluations = readViewCacheValue(cacheKey, 'evaluations', [])
    return Array.isArray(cachedEvaluations) ? cachedEvaluations : []
  })
  const [sessionPlayers, setSessionPlayers] = useState([])
  const [sessionGames, setSessionGames] = useState([])
  const [sessionForm, setSessionForm] = useState(createInitialSessionForm)
  const [gameForm, setGameForm] = useState(createInitialGameForm)
  const [selectedSessionId, setSelectedSessionId] = useState(() => String(storedSessionWorkspace.selectedSessionId ?? ''))
  const [selectedPlayerIds, setSelectedPlayerIds] = useState(() =>
    Array.isArray(storedSessionWorkspace.selectedPlayerIds) ? storedSessionWorkspace.selectedPlayerIds : [],
  )
  const [availablePlayerPage, setAvailablePlayerPage] = useState(1)
  const [sessionPlayerPage, setSessionPlayerPage] = useState(1)
  const [clearSessionTarget, setClearSessionTarget] = useState(null)
  const [completeSessionTarget, setCompleteSessionTarget] = useState(null)
  const [deleteGameTarget, setDeleteGameTarget] = useState(null)
  const [isLoading, setIsLoading] = useState(() => sessions.length === 0 && players.length === 0 && teams.length === 0)
  const [isSessionPlayersLoading, setIsSessionPlayersLoading] = useState(false)
  const [isSessionGamesLoading, setIsSessionGamesLoading] = useState(false)
  const [isSaving, setIsSaving] = useState(false)
  const [errorMessage, setErrorMessage] = useState('')
  const userScopeKey = user
    ? `${user.id}:${user.clubId || ''}:${user.role}:${user.roleRank}:${user.activeTeamId || ''}:${user.activeTeamName || ''}`
    : ''
  const completedSessionId = String(searchParams.get('completedSessionId') ?? '').trim()
  const completedCount = Number(searchParams.get('completedCount') ?? 0)
  const requestedSessionId = String(searchParams.get('sessionId') ?? '').trim()

  const combinedSessions = useMemo(
    () => [...sessions, ...buildHistoricalSessionsFromEvaluations(evaluations, sessions)],
    [evaluations, sessions],
  )
  const selectedSession = combinedSessions.find((session) => session.id === selectedSessionId)
  const canCompleteSessions = Number(user?.roleRank ?? 0) >= 50
  const selectedSessionCompleted = selectedSession?.status === 'completed'
  const selectedSessionLocked = selectedSessionCompleted && !canCompleteSessions
  const completedPlayerNames = useMemo(() => {
    const dbCompletedPlayerNames = getCompletedPlayerNamesFromEvaluations(evaluations, selectedSession, sessionPlayers)
    const localCompletedPlayerNames = readCompletedPlayerNames(user, selectedSessionId)

    return dbCompletedPlayerNames.length > 0
      ? dbCompletedPlayerNames
      : localCompletedPlayerNames
  }, [evaluations, selectedSession, selectedSessionId, sessionPlayers, user])
  const previousSessions = useMemo(
    () => combinedSessions.filter((session) => session.id !== selectedSessionId),
    [combinedSessions, selectedSessionId],
  )

  useEffect(() => {
    let isMounted = true
    const cachedValue = readViewCache(cacheKey)

    const loadData = async () => {
      setErrorMessage('')

      try {
        const [sessionsResult, playersResult, teamsResult, evaluationsResult] = await Promise.allSettled([
          withRequestTimeout(() => getAssessmentSessions({ user }), 'Could not load sessions.'),
          withRequestTimeout(() => getPlayers({ user }), 'Could not load players.'),
          withRequestTimeout(() => getAvailableTeamsForUser(user), 'Could not load teams.'),
          withRequestTimeout(() => getEvaluations({ user }), 'Could not load historical sessions.'),
        ])

        if (!isMounted) {
          return
        }

        const nextSessions = sessionsResult.status === 'fulfilled' ? sessionsResult.value : cachedValue?.sessions || []
        const nextPlayers = playersResult.status === 'fulfilled' ? playersResult.value : cachedValue?.players || []
        const nextTeams = teamsResult.status === 'fulfilled' ? teamsResult.value : cachedValue?.teams || []
        const nextEvaluations =
          evaluationsResult.status === 'fulfilled' ? evaluationsResult.value : cachedValue?.evaluations || []

        if (sessionsResult.status === 'rejected') {
          console.error(sessionsResult.reason)
        }

        if (playersResult.status === 'rejected') {
          console.error(playersResult.reason)
        }

        if (teamsResult.status === 'rejected') {
          console.error(teamsResult.reason)
        }

        if (evaluationsResult.status === 'rejected') {
          console.error(evaluationsResult.reason)
        }

        setSessions(nextSessions)
        setPlayers(nextPlayers)
        setTeams(nextTeams)
        setEvaluations(nextEvaluations)
        setSelectedSessionId((current) => {
          const nextCombinedSessions = [...nextSessions, ...buildHistoricalSessionsFromEvaluations(nextEvaluations, nextSessions)]

          if (requestedSessionId && nextSessions.some((session) => session.id === requestedSessionId)) {
            return requestedSessionId
          }

          if (requestedSessionId && nextCombinedSessions.some((session) => session.id === requestedSessionId)) {
            return requestedSessionId
          }

          if (completedSessionId && nextSessions.some((session) => session.id === completedSessionId)) {
            return completedSessionId
          }

          if (nextCombinedSessions.some((session) => session.id === current)) {
            return current
          }

          const storedSessionId = String(storedSessionWorkspace.selectedSessionId ?? '')
          return nextCombinedSessions.some((session) => session.id === storedSessionId)
            ? storedSessionId
            : nextCombinedSessions[0]?.id || ''
        })
        setSessionForm((current) => ({
          ...current,
          teamId: nextTeams.some((team) => team.id === current.teamId) ? current.teamId : nextTeams[0]?.id || '',
          team: nextTeams.some((team) => team.id === current.teamId) ? current.team : nextTeams[0]?.name || '',
        }))
        writeViewCache(cacheKey, {
          sessions: nextSessions,
          players: nextPlayers,
          teams: nextTeams,
          evaluations: nextEvaluations,
        })

        if (
          sessionsResult.status === 'rejected' ||
          playersResult.status === 'rejected' ||
          teamsResult.status === 'rejected' ||
          evaluationsResult.status === 'rejected'
        ) {
          setErrorMessage('Some session data could not be refreshed. Existing data is still available where possible.')
        }
      } finally {
        if (isMounted) {
          setIsLoading(false)
        }
      }
    }

    if (user) {
      void loadData()
    }

    return () => {
      isMounted = false
    }
  }, [cacheKey, completedSessionId, requestedSessionId, storedSessionWorkspace.selectedSessionId, user, userScopeKey])

  useEffect(() => {
    let isMounted = true

    const loadSessionPlayers = async () => {
      const selectedSession = combinedSessions.find((session) => session.id === selectedSessionId)

      if (!selectedSessionId) {
        setSessionPlayers([])
        return
      }

      if (selectedSession?.isHistorical) {
        const historicalPlayers = buildHistoricalSessionPlayers(evaluations, selectedSession)
        setSessionPlayers(historicalPlayers)
        return
      }

      setIsSessionPlayersLoading(true)

      try {
        const nextSessionPlayers = await withRequestTimeout(
          () => getAssessmentSessionPlayers({ user, sessionId: selectedSessionId }),
          'Could not load session players.',
        )

        if (!isMounted) {
          return
        }

        setSessionPlayers(nextSessionPlayers)
      } catch (error) {
        console.error(error)

        if (isMounted) {
          setErrorMessage('Session players could not be loaded right now.')
        }
      } finally {
        if (isMounted) {
          setIsSessionPlayersLoading(false)
        }
      }
    }

    void loadSessionPlayers()

    return () => {
      isMounted = false
    }
  }, [combinedSessions, evaluations, selectedSessionId, user])

  useEffect(() => {
    let isMounted = true

    const loadSessionGames = async () => {
      const activeSession = combinedSessions.find((session) => session.id === selectedSessionId)

      if (!selectedSessionId || activeSession?.sessionType !== 'tournament' || activeSession?.isHistorical) {
        setSessionGames([])
        return
      }

      setIsSessionGamesLoading(true)

      try {
        const nextSessionGames = await withRequestTimeout(
          () => getAssessmentSessionGames({ user, sessionId: selectedSessionId }),
          'Could not load tournament results.',
        )

        if (!isMounted) {
          return
        }

        setSessionGames(nextSessionGames)
      } catch (error) {
        console.error(error)

        if (isMounted) {
          setErrorMessage('Tournament results could not be loaded right now.')
        }
      } finally {
        if (isMounted) {
          setIsSessionGamesLoading(false)
        }
      }
    }

    void loadSessionGames()

    return () => {
      isMounted = false
    }
  }, [combinedSessions, selectedSessionId, user])

  useEffect(() => {
    if (!workspaceStorageKey) {
      return
    }

    const currentStoredWorkspace = readStoredSessionWorkspace(workspaceStorageKey)
    writeStoredSessionWorkspace(workspaceStorageKey, {
      ...currentStoredWorkspace,
      selectedSessionId,
      selectedPlayerIds,
    })
  }, [selectedPlayerIds, selectedSessionId, workspaceStorageKey])

  const filteredPlayers = useMemo(
    () =>
      players.filter(
        (player) =>
          player.section === sessionForm.section &&
          (!sessionForm.team || player.team === sessionForm.team),
      ),
    [players, sessionForm.section, sessionForm.team],
  )
  const paginatedFilteredPlayers = useMemo(
    () => getPaginatedItems(filteredPlayers, availablePlayerPage, AVAILABLE_PLAYER_PAGE_SIZE),
    [availablePlayerPage, filteredPlayers],
  )
  const paginatedSessionPlayers = useMemo(
    () => getPaginatedItems(sessionPlayers, sessionPlayerPage, SESSION_PLAYER_PAGE_SIZE),
    [sessionPlayerPage, sessionPlayers],
  )

  useEffect(() => {
    if (!selectedSession) {
      return
    }

    setSessionPlayerPage(1)
    setSessionForm((current) => ({
      ...current,
      teamId: selectedSession.teamId || current.teamId,
      team: selectedSession.team || current.team,
    }))
  }, [selectedSession])

  if (!canCreateEvaluation(user)) {
    return <Navigate to="/" replace />
  }

  const writeSessionCache = (nextState = {}) => {
    writeViewCache(cacheKey, {
      sessions,
      players,
      teams,
      evaluations,
      ...nextState,
    })
  }

  const handleSessionFormChange = (event) => {
    const { name, value } = event.target
    setErrorMessage('')

    if (name === 'teamId') {
      setAvailablePlayerPage(1)
      const matchingTeam = teams.find((team) => team.id === value)
      setSessionForm((current) => ({
        ...current,
        teamId: value,
        team: matchingTeam?.name || '',
      }))
      return
    }

    if (name === 'section') {
      setAvailablePlayerPage(1)
    }

    if (name === 'sessionType') {
      setSessionForm((current) => ({
        ...current,
        sessionType: value,
        opponent: value === 'match' ? current.opponent : '',
      }))
      return
    }

    setSessionForm((current) => ({
      ...current,
      [name]: value,
    }))
  }

  const handleGameFormChange = (event) => {
    const { name, value } = event.target
    setErrorMessage('')
    setGameForm((current) => ({
      ...current,
      [name]: value,
    }))
  }

  const handleCreateSession = async (event) => {
    event.preventDefault()
    setIsSaving(true)
    setErrorMessage('')

    if (!sessionForm.sessionType) {
      setErrorMessage('Select a session type before creating the session.')
      setIsSaving(false)
      return
    }

    if (!sessionForm.sessionDate) {
      setErrorMessage('Select a session date before creating the session.')
      setIsSaving(false)
      return
    }

    try {
      const createdSession = await createAssessmentSession({
        user,
        session: {
          ...sessionForm,
          opponent: sessionForm.sessionType === 'match' ? sessionForm.opponent : '',
        },
      })
      const nextSessions = [createdSession, ...sessions.filter((session) => session.id !== createdSession.id)]
      setSessions(nextSessions)
      setSelectedSessionId(createdSession.id)
      setSelectedPlayerIds([])
      setSessionForm(createInitialSessionForm())
      writeSessionCache({
        sessions: nextSessions,
      })
      writeStoredSessionWorkspace(workspaceStorageKey, {
        ...readStoredSessionWorkspace(workspaceStorageKey),
        selectedSessionId: createdSession.id,
        selectedPlayerIds: [],
      })
      showToast({ title: 'Session created', message: createdSession.title || 'Session added.' })
    } catch (error) {
      console.error(error)
      setErrorMessage(error.message || 'Could not create session.')
      showToast({ title: 'Session not created', message: error.message || 'Could not create session.', tone: 'error' })
    } finally {
      setIsSaving(false)
    }
  }

  const handleAddTournamentGame = async (event) => {
    event.preventDefault()

    if (!selectedSessionId || selectedSession?.sessionType !== 'tournament') {
      setErrorMessage('Select a tournament session before adding results.')
      return
    }

    if (selectedSessionLocked) {
      setErrorMessage('This session is completed and locked.')
      return
    }

    setIsSaving(true)
    setErrorMessage('')

    try {
      const createdGame = await createAssessmentSessionGame({
        user,
        sessionId: selectedSessionId,
        game: gameForm,
      })
      const nextGames = [...sessionGames, createdGame]
      setSessionGames(nextGames)
      setGameForm(createInitialGameForm())
      showToast({ title: 'Tournament result added', message: `${createdGame.opponent} result saved.` })
    } catch (error) {
      console.error(error)
      setErrorMessage(error.message || 'Could not save tournament result.')
      showToast({ title: 'Result not saved', message: error.message || 'Could not save tournament result.', tone: 'error' })
    } finally {
      setIsSaving(false)
    }
  }

  const handleDeleteTournamentGame = async (gameId) => {
    if (selectedSessionLocked) {
      setErrorMessage('This session is completed and locked.')
      return
    }

    const matchingGame = sessionGames.find((game) => game.id === gameId)

    if (!matchingGame) {
      setErrorMessage('Choose a tournament result to delete.')
      return
    }

    setDeleteGameTarget(matchingGame)
  }

  const confirmDeleteTournamentGame = async (password) => {
    if (!deleteGameTarget) {
      return
    }

    setIsSaving(true)
    setErrorMessage('')

    try {
      await verifyCurrentUserPassword(user?.email, password)
      await deleteAssessmentSessionGame({ user, gameId: deleteGameTarget.id })
      setSessionGames((current) => current.filter((game) => game.id !== deleteGameTarget.id))
      setDeleteGameTarget(null)
      showToast({ title: 'Tournament result removed', message: 'The game result has been deleted.' })
    } catch (error) {
      console.error(error)
      setErrorMessage(error.message || 'Could not delete tournament result.')
      showToast({ title: 'Result not deleted', message: error.message || 'Could not delete tournament result.', tone: 'error' })
    } finally {
      setIsSaving(false)
    }
  }

  const handlePlayerSelection = (playerId, checked) => {
    setSelectedPlayerIds((current) =>
      checked ? [...new Set([...current, playerId])] : current.filter((id) => id !== playerId),
    )
  }

  const handleOpenSession = (sessionId) => {
    const nextSessionId = String(sessionId ?? '').trim()

    if (!nextSessionId) {
      return
    }

    setErrorMessage('')
    setSelectedSessionId(nextSessionId)
    setSelectedPlayerIds([])
    const nextSearchParams = new URLSearchParams(searchParams)
    nextSearchParams.set('sessionId', nextSessionId)
    nextSearchParams.delete('completedSessionId')
    nextSearchParams.delete('completedCount')
    setSearchParams(nextSearchParams, { replace: true })
  }

  const handleCompleteSession = async () => {
    if (!selectedSessionId || selectedSession?.isHistorical) {
      setErrorMessage('Select a saved session before completing it.')
      return
    }

    if (!canCompleteSessions) {
      setErrorMessage('Only managers and team admins can complete sessions.')
      return
    }

    setCompleteSessionTarget(selectedSession)
  }

  const confirmCompleteSession = async () => {
    if (!completeSessionTarget || !selectedSessionId) {
      return
    }

    setIsSaving(true)
    setErrorMessage('')

    try {
      const completedSession = await completeAssessmentSession({
        user,
        sessionId: selectedSessionId,
      })
      const nextSessions = sessions.map((session) =>
        session.id === completedSession.id ? completedSession : session,
      )
      setSessions(nextSessions)
      writeSessionCache({
        sessions: nextSessions,
      })
      showToast({ title: 'Session completed', message: completedSession.title || 'Session marked as completed.' })
    } catch (error) {
      console.error(error)
      setErrorMessage(error.message || 'Could not complete this session.')
      showToast({ title: 'Session not completed', message: error.message || 'Could not complete session.', tone: 'error' })
    } finally {
      setIsSaving(false)
      setCompleteSessionTarget(null)
    }
  }

  const handleImportPlayers = async (mode) => {
    if (!selectedSessionId) {
      setErrorMessage('Create or select a session first.')
      return
    }

    if (selectedSessionLocked) {
      setErrorMessage('This session has been completed and can no longer be edited.')
      return
    }

    const playersToAdd =
      mode === 'all'
        ? filteredPlayers
        : filteredPlayers.filter((player) => selectedPlayerIds.includes(player.id))

    if (playersToAdd.length === 0) {
      setErrorMessage('Select at least one player to add to this session.')
      return
    }

    setIsSaving(true)
    setErrorMessage('')

    try {
      await addPlayersToAssessmentSession({
        user,
        sessionId: selectedSessionId,
        players: playersToAdd,
      })
      const nextSessionPlayers = await getAssessmentSessionPlayers({ user, sessionId: selectedSessionId })
      setSessionPlayers(nextSessionPlayers)
      setSelectedPlayerIds([])
      showToast({ title: 'Players added', message: `${playersToAdd.length} players added to the session.` })
    } catch (error) {
      console.error(error)
      setErrorMessage(error.message || 'Could not add players to this session.')
      showToast({ title: 'Players not added', message: error.message || 'Could not add players.', tone: 'error' })
    } finally {
      setIsSaving(false)
    }
  }

  const handleClearSessionPlayers = async () => {
    if (!selectedSessionId) {
      setErrorMessage('Select a session first.')
      return
    }

    if (selectedSessionLocked) {
      setErrorMessage('This session has been completed and can no longer be edited.')
      return
    }

    setClearSessionTarget({
      session: selectedSession,
      playerCount: sessionPlayers.length,
    })
  }

  const confirmClearSessionPlayers = async (password) => {
    if (!clearSessionTarget || !selectedSessionId) {
      return
    }

    setIsSaving(true)
    setErrorMessage('')

    try {
      await verifyCurrentUserPassword(user.email, password)
      await clearAssessmentSessionPlayers({
        user,
        sessionId: selectedSessionId,
      })
      setSessionPlayers([])
      setSelectedPlayerIds([])
      const progressKey = getSessionProgressKey(user, selectedSessionId)

      if (progressKey) {
        localStorage.removeItem(progressKey)
      }
      showToast({ title: 'Session cleared', message: 'All players were removed from this session list.' })
    } catch (error) {
      console.error(error)
      setErrorMessage(error.message || 'Could not clear this session.')
      showToast({ title: 'Session not cleared', message: error.message || 'Could not clear this session.', tone: 'error' })
    } finally {
      setIsSaving(false)
      setClearSessionTarget(null)
    }
  }

  const buildAssessmentUrl = (playerName, queue = []) => {
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

    return `/assess-player?${params.toString()}`
  }

  const handleAssessAll = () => {
    const completedSet = new Set(completedPlayerNames)
    const queue = sessionPlayers
      .map((player) => player.playerName)
      .filter(Boolean)
      .filter((playerName) => !completedSet.has(normalizeProgressName(playerName)))

    if (queue.length === 0) {
      setErrorMessage(
        sessionPlayers.length === 0
          ? 'Add players to the session before using Assess All.'
          : 'All players in this session have already been assessed.',
      )
      return
    }

    if (selectedSessionLocked) {
      setErrorMessage('This session has been completed and can no longer be assessed.')
      return
    }

    navigate(buildAssessmentUrl(queue[0], queue))
  }

  return (
    <div className="space-y-5 sm:space-y-6">
      <PageHeader
        eyebrow="Sessions"
        title="Session planning"
        description="Create a team session, add players from Trial or Squad, then assess everyone from one queue."
      />

      {errorMessage ? <NoticeBanner title="Session action not completed" message={errorMessage} /> : null}

      {completedSessionId ? (
        <div className="rounded-[20px] border border-[var(--border-color)] bg-[var(--panel-alt)] px-4 py-4 text-sm text-[var(--text-primary)]">
          <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <div>
              <p className="font-semibold">Session assessments completed</p>
              <p className="mt-1 text-[var(--text-muted)]">
                {completedCount > 0 ? `${completedCount} player assessments were completed.` : 'All queued assessments were completed.'}
              </p>
            </div>
            <button
              type="button"
              onClick={() => setSearchParams({})}
              className="inline-flex min-h-11 items-center justify-center rounded-2xl border border-[var(--border-color)] bg-[var(--panel-bg)] px-4 py-3 text-sm font-semibold text-[var(--text-primary)] transition hover:bg-[var(--panel-soft)]"
            >
              Dismiss
            </button>
          </div>
        </div>
      ) : null}

      <SectionCard
        title="Open existing sessions"
        description="Reopen any saved session to continue notes, add players, or carry on assessments."
      >
        {isLoading ? (
          <div className="rounded-[20px] border border-[var(--border-color)] bg-[var(--panel-alt)] px-4 py-4 text-sm text-[var(--text-muted)]">
            Loading saved sessions...
          </div>
        ) : combinedSessions.length === 0 ? (
          <div className="rounded-[20px] border border-dashed border-[var(--border-color)] bg-[var(--panel-alt)] px-4 py-6 text-sm text-[var(--text-muted)]">
            No saved sessions yet. Create a session below and it will appear here.
          </div>
        ) : (
          <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_minmax(280px,420px)]">
            <div className="rounded-2xl border border-[var(--accent)] bg-[var(--panel-soft)] px-4 py-4">
              <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                <div className="min-w-0">
                  <div className="flex flex-wrap items-center gap-2">
                    <p className="truncate text-sm font-semibold text-[var(--text-primary)]">
                      {selectedSession?.title || selectedSession?.team || 'Current session'}
                    </p>
                    <span className="rounded-full bg-[var(--accent)] px-3 py-1 text-[11px] font-semibold uppercase tracking-[0.14em] text-[var(--accent-contrast)]">
                      {selectedSessionCompleted ? 'Completed' : 'Open'}
                    </span>
                  </div>
                  <p className="mt-1 text-xs uppercase tracking-[0.14em] text-[var(--text-secondary)]">
                    {formatSessionType(selectedSession?.sessionType)} | {formatSessionDate(selectedSession?.sessionDate)}
                  </p>
                  <p className="mt-1 text-sm text-[var(--text-muted)]">{selectedSession?.team || 'No team entered'}</p>
                </div>
                <div className="flex flex-col gap-2 sm:flex-row">
                  {canCompleteSessions && !selectedSessionCompleted && !selectedSession?.isHistorical ? (
                    <button
                      type="button"
                      disabled={isSaving}
                      onClick={() => void handleCompleteSession()}
                      className="inline-flex min-h-11 items-center justify-center rounded-2xl border border-[var(--border-color)] bg-[var(--panel-bg)] px-4 py-3 text-sm font-semibold text-[var(--text-primary)] transition hover:bg-[var(--panel-alt)] disabled:cursor-not-allowed disabled:opacity-60"
                    >
                      Complete Session
                    </button>
                  ) : null}
                  <span className="inline-flex min-h-11 items-center justify-center rounded-2xl border border-[var(--border-color)] bg-[var(--panel-bg)] px-4 py-3 text-sm font-semibold text-[var(--text-primary)]">
                    Current Session
                  </span>
                </div>
              </div>
            </div>

            <label className="block">
              <span className="mb-2 block text-sm font-semibold text-[var(--text-primary)]">Previous sessions</span>
              <select
                value=""
                onChange={(event) => handleOpenSession(event.target.value)}
                disabled={previousSessions.length === 0}
                className="min-h-11 w-full rounded-2xl border border-[var(--border-color)] bg-[var(--panel-alt)] px-4 py-3 text-sm text-[var(--text-primary)] outline-none transition focus:border-[var(--accent)] disabled:cursor-not-allowed disabled:opacity-60"
              >
                <option value="">
                  {previousSessions.length === 0 ? 'No previous sessions yet' : 'Choose previous session'}
                </option>
                {previousSessions.map((session) => (
                  <option key={session.id} value={session.id}>
                    {formatSessionType(session.sessionType)} | {session.title || session.team} | {formatSessionDate(session.sessionDate)} | {session.status === 'completed' ? 'Completed' : 'Open'}
                  </option>
                ))}
              </select>
            </label>
          </div>
        )}
      </SectionCard>

      {selectedSession?.sessionType === 'tournament' ? (
        <SectionCard
          title="Tournament results"
          description="Add each game result for this tournament session. A team can play multiple games in one tournament."
        >
          <div className="space-y-5">
            <form className="grid gap-4 md:grid-cols-2 xl:grid-cols-5" onSubmit={handleAddTournamentGame}>
              <label className="block xl:col-span-2">
                <span className="mb-2 block text-sm font-semibold text-[var(--text-primary)]">Opponent</span>
                <input
                  type="text"
                  name="opponent"
                  value={gameForm.opponent}
                  onChange={handleGameFormChange}
                  required
                  placeholder="Opponent team"
                  disabled={selectedSessionLocked}
                  className="min-h-11 w-full rounded-2xl border border-[var(--border-color)] bg-[var(--panel-alt)] px-4 py-3 text-sm text-[var(--text-primary)] outline-none transition focus:border-[var(--accent)] disabled:cursor-not-allowed disabled:opacity-60"
                />
              </label>

              <label className="block">
                <span className="mb-2 block text-sm font-semibold text-[var(--text-primary)]">{selectedSession.team || 'Our team'} score</span>
                <input
                  type="number"
                  name="teamScore"
                  value={gameForm.teamScore}
                  onChange={handleGameFormChange}
                  required
                  min="0"
                  disabled={selectedSessionLocked}
                  className="min-h-11 w-full rounded-2xl border border-[var(--border-color)] bg-[var(--panel-alt)] px-4 py-3 text-sm text-[var(--text-primary)] outline-none transition focus:border-[var(--accent)] disabled:cursor-not-allowed disabled:opacity-60"
                />
              </label>

              <label className="block">
                <span className="mb-2 block text-sm font-semibold text-[var(--text-primary)]">Opponent score</span>
                <input
                  type="number"
                  name="opponentScore"
                  value={gameForm.opponentScore}
                  onChange={handleGameFormChange}
                  required
                  min="0"
                  disabled={selectedSessionLocked}
                  className="min-h-11 w-full rounded-2xl border border-[var(--border-color)] bg-[var(--panel-alt)] px-4 py-3 text-sm text-[var(--text-primary)] outline-none transition focus:border-[var(--accent)] disabled:cursor-not-allowed disabled:opacity-60"
                />
              </label>

              <label className="block">
                <span className="mb-2 block text-sm font-semibold text-[var(--text-primary)]">Game date</span>
                <input
                  type="date"
                  name="gameDate"
                  value={gameForm.gameDate}
                  onChange={handleGameFormChange}
                  disabled={selectedSessionLocked}
                  className="min-h-11 w-full rounded-2xl border border-[var(--border-color)] bg-[var(--panel-alt)] px-4 py-3 text-sm text-[var(--text-primary)] outline-none transition focus:border-[var(--accent)] disabled:cursor-not-allowed disabled:opacity-60"
                />
              </label>

              <label className="block md:col-span-2 xl:col-span-4">
                <span className="mb-2 block text-sm font-semibold text-[var(--text-primary)]">Notes</span>
                <input
                  type="text"
                  name="notes"
                  value={gameForm.notes}
                  onChange={handleGameFormChange}
                  placeholder="Optional game note"
                  disabled={selectedSessionLocked}
                  className="min-h-11 w-full rounded-2xl border border-[var(--border-color)] bg-[var(--panel-alt)] px-4 py-3 text-sm text-[var(--text-primary)] outline-none transition focus:border-[var(--accent)] disabled:cursor-not-allowed disabled:opacity-60"
                />
              </label>

              <div className="flex items-end">
                <button
                  type="submit"
                  disabled={isSaving || selectedSessionLocked}
                  className="inline-flex min-h-11 w-full items-center justify-center rounded-2xl bg-[var(--button-primary)] px-5 py-3 text-sm font-semibold text-[var(--button-primary-text)] transition hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-60"
                >
                  {isSaving ? 'Saving...' : 'Add Result'}
                </button>
              </div>
            </form>

            {isSessionGamesLoading ? (
              <div className="rounded-[20px] border border-[var(--border-color)] bg-[var(--panel-alt)] px-4 py-4 text-sm text-[var(--text-muted)]">
                Loading tournament results...
              </div>
            ) : sessionGames.length === 0 ? (
              <div className="rounded-[20px] border border-dashed border-[var(--border-color)] bg-[var(--panel-alt)] px-4 py-6 text-sm text-[var(--text-muted)]">
                No tournament game results have been added yet.
              </div>
            ) : (
              <div className="grid gap-3 md:grid-cols-2">
                {sessionGames.map((game) => (
                  <div key={game.id} className="rounded-[22px] border border-[var(--border-color)] bg-[var(--panel-alt)] p-4">
                    <div className="flex items-start justify-between gap-3">
                      <div className="min-w-0">
                        <p className="text-sm font-semibold text-[var(--text-primary)]">
                          {selectedSession.team || 'Team'} {game.teamScore} - {game.opponentScore} {game.opponent}
                        </p>
                        <p className="mt-1 text-xs uppercase tracking-[0.14em] text-[var(--text-secondary)]">
                          {game.gameDate ? formatSessionDate(game.gameDate) : formatSessionDate(selectedSession.sessionDate)}
                        </p>
                        {game.notes ? <p className="mt-2 text-sm text-[var(--text-muted)]">{game.notes}</p> : null}
                      </div>
                      <button
                        type="button"
                        disabled={isSaving || selectedSessionLocked}
                        onClick={() => void handleDeleteTournamentGame(game.id)}
                        className="inline-flex min-h-10 shrink-0 items-center justify-center rounded-2xl border border-red-500/40 bg-red-600/20 px-3 py-2 text-xs font-semibold text-red-100 transition hover:bg-red-600/30 disabled:cursor-not-allowed disabled:opacity-60"
                      >
                        Delete
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </SectionCard>
      ) : null}

      <SectionCard
        title="Create session"
        description="Use a date only. Times are not required for assessments."
      >
        {isLoading ? (
          <div className="rounded-[20px] border border-[var(--border-color)] bg-[var(--panel-alt)] px-4 py-4 text-sm text-[var(--text-muted)]">
            Loading session setup...
          </div>
        ) : teams.length === 0 ? (
          <div className="rounded-[20px] border border-dashed border-[var(--border-color)] bg-[var(--panel-alt)] px-4 py-6 text-sm text-[var(--text-muted)]">
            No teams are available yet. Create a team first, then sessions can be planned.
          </div>
        ) : (
          <form className="grid gap-4 md:grid-cols-2 xl:grid-cols-3" onSubmit={handleCreateSession}>
            <label className="block">
              <span className="mb-2 block text-sm font-semibold text-[var(--text-primary)]">Team</span>
              <select
                name="teamId"
                value={sessionForm.teamId}
                onChange={handleSessionFormChange}
                required
                className="min-h-11 w-full rounded-2xl border border-[var(--border-color)] bg-[var(--panel-alt)] px-4 py-3 text-sm text-[var(--text-primary)] outline-none transition focus:border-[var(--accent)]"
              >
                <option value="">Select team</option>
                {teams.map((team) => (
                  <option key={team.id} value={team.id}>
                    {team.name}
                  </option>
                ))}
              </select>
            </label>

            <label className="block">
              <span className="mb-2 block text-sm font-semibold text-[var(--text-primary)]">Session Type</span>
              <select
                name="sessionType"
                value={sessionForm.sessionType}
                onChange={handleSessionFormChange}
                required
                className="min-h-11 w-full rounded-2xl border border-[var(--border-color)] bg-[var(--panel-alt)] px-4 py-3 text-sm text-[var(--text-primary)] outline-none transition focus:border-[var(--accent)]"
              >
                <option value="">Select session type</option>
                <option value="training">Training</option>
                <option value="match">Match</option>
                <option value="tournament">Tournament</option>
              </select>
            </label>

            {sessionForm.sessionType === 'match' ? (
              <label className="block">
                <span className="mb-2 block text-sm font-semibold text-[var(--text-primary)]">Opponent</span>
                <input
                  type="text"
                  name="opponent"
                  value={sessionForm.opponent}
                  onChange={handleSessionFormChange}
                  placeholder="Opposition team"
                  className="min-h-11 w-full rounded-2xl border border-[var(--border-color)] bg-[var(--panel-alt)] px-4 py-3 text-sm text-[var(--text-primary)] outline-none transition focus:border-[var(--accent)]"
                />
              </label>
            ) : null}

            <label className="block">
              <span className="mb-2 block text-sm font-semibold text-[var(--text-primary)]">Date</span>
              <input
                type="date"
                name="sessionDate"
                value={sessionForm.sessionDate}
                onChange={handleSessionFormChange}
                required
                className="min-h-11 w-full rounded-2xl border border-[var(--border-color)] bg-[var(--panel-alt)] px-4 py-3 text-sm text-[var(--text-primary)] outline-none transition focus:border-[var(--accent)]"
              />
            </label>

            <label className="block">
              <span className="mb-2 block text-sm font-semibold text-[var(--text-primary)]">Player list</span>
              <select
                name="section"
                value={sessionForm.section}
                onChange={handleSessionFormChange}
                className="min-h-11 w-full rounded-2xl border border-[var(--border-color)] bg-[var(--panel-alt)] px-4 py-3 text-sm text-[var(--text-primary)] outline-none transition focus:border-[var(--accent)]"
              >
                {EVALUATION_SECTIONS.map((section) => (
                  <option key={section} value={section}>
                    {section}
                  </option>
                ))}
              </select>
            </label>

            <div className="flex items-end">
              <button
                type="submit"
                disabled={isSaving}
                className="inline-flex min-h-11 w-full items-center justify-center rounded-2xl bg-[var(--button-primary)] px-5 py-3 text-sm font-semibold text-[var(--button-primary-text)] transition hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-60"
              >
                {isSaving ? 'Saving...' : 'Create Session'}
              </button>
            </div>
          </form>
        )}
      </SectionCard>

      <SectionCard
        title="Coach options"
        description="Select a session, add all players from the chosen list, or pick specific players."
      >
        {sessions.length === 0 ? (
          <div className="rounded-[20px] border border-dashed border-[var(--border-color)] bg-[var(--panel-alt)] px-4 py-6 text-sm text-[var(--text-muted)]">
            No sessions created yet.
          </div>
        ) : (
          <div className="space-y-5">
            <label className="block max-w-xl">
              <span className="mb-2 block text-sm font-semibold text-[var(--text-primary)]">Active session</span>
              <select
                value={selectedSessionId}
                onChange={(event) => handleOpenSession(event.target.value)}
                className="min-h-11 w-full rounded-2xl border border-[var(--border-color)] bg-[var(--panel-alt)] px-4 py-3 text-sm text-[var(--text-primary)] outline-none transition focus:border-[var(--accent)]"
              >
                {combinedSessions.map((session) => (
                  <option key={session.id} value={session.id}>
                    {formatSessionType(session.sessionType)} | {session.title || session.team} | {formatSessionDate(session.sessionDate)} | {session.status === 'completed' ? 'Completed' : 'Open'}
                  </option>
                ))}
              </select>
            </label>

            <div className="grid gap-3 md:grid-cols-2">
              {paginatedFilteredPlayers.items.map((player) => (
                <label
                  key={player.id}
                  className="flex min-h-11 items-center gap-3 rounded-2xl border border-[var(--border-color)] bg-[var(--panel-alt)] px-4 py-3 text-sm text-[var(--text-primary)]"
                >
                  <input
                    type="checkbox"
                    checked={selectedPlayerIds.includes(player.id)}
                    onChange={(event) => handlePlayerSelection(player.id, event.target.checked)}
                    className="h-4 w-4"
                  />
                  <span>{player.playerName} | {player.team || 'No team'}</span>
                </label>
              ))}
            </div>
            <Pagination
              currentPage={availablePlayerPage}
              onPageChange={setAvailablePlayerPage}
              pageSize={AVAILABLE_PLAYER_PAGE_SIZE}
              totalItems={filteredPlayers.length}
            />

            {filteredPlayers.length === 0 ? (
              <div className="rounded-[20px] border border-dashed border-[var(--border-color)] bg-[var(--panel-alt)] px-4 py-6 text-sm text-[var(--text-muted)]">
                No {sessionForm.section.toLowerCase()} players are available for {sessionForm.team || 'this team'}.
              </div>
            ) : null}

            <div className="flex flex-col gap-3 sm:flex-row sm:flex-wrap">
              <button
                type="button"
                disabled={isSaving || filteredPlayers.length === 0 || selectedSessionLocked}
                onClick={() => void handleImportPlayers('all')}
                className="inline-flex min-h-11 items-center justify-center rounded-2xl bg-[var(--button-primary)] px-5 py-3 text-sm font-semibold text-[var(--button-primary-text)] transition hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-60"
              >
                Add All {sessionForm.section} Players
              </button>
              <button
                type="button"
                disabled={isSaving || selectedPlayerIds.length === 0 || selectedSessionLocked}
                onClick={() => void handleImportPlayers('selected')}
                className="inline-flex min-h-11 items-center justify-center rounded-2xl border border-[var(--border-color)] bg-[var(--panel-bg)] px-5 py-3 text-sm font-semibold text-[var(--text-primary)] transition hover:bg-[var(--panel-soft)] disabled:cursor-not-allowed disabled:opacity-60"
              >
                Add Selected Players
              </button>
            </div>
          </div>
        )}
      </SectionCard>

      <SectionCard
        title="Session players"
        description="Coaches can record quick notes during the game or training, then start every assessment in sequence."
      >
        {!selectedSessionId ? (
          <div className="rounded-[20px] border border-dashed border-[var(--border-color)] bg-[var(--panel-alt)] px-4 py-6 text-sm text-[var(--text-muted)]">
            Select a session to manage players.
          </div>
        ) : isSessionPlayersLoading ? (
          <div className="rounded-[20px] border border-[var(--border-color)] bg-[var(--panel-alt)] px-4 py-4 text-sm text-[var(--text-muted)]">
            Loading session players...
          </div>
        ) : sessionPlayers.length === 0 ? (
          <div className="rounded-[20px] border border-dashed border-[var(--border-color)] bg-[var(--panel-alt)] px-4 py-6 text-sm text-[var(--text-muted)]">
            No players have been added to this session yet.
          </div>
        ) : (
          <div className="space-y-4">
            {selectedSessionCompleted ? (
              <div className="rounded-[20px] border border-[var(--border-color)] bg-[var(--panel-alt)] px-4 py-4 text-sm text-[var(--text-muted)]">
                {canCompleteSessions
                  ? 'This session has been completed. Managers can still correct notes or assessments if needed.'
                  : 'This session has been completed. Notes and assessments are kept for review, but the session is no longer editable.'}
              </div>
            ) : null}

            <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
              <div>
                <p className="text-sm font-semibold text-[var(--text-primary)]">
                  {selectedSession?.title || selectedSession?.team || 'Session'}
                </p>
                <p className="mt-1 text-sm text-[var(--text-muted)]">
                  {formatSessionType(selectedSession?.sessionType)} | {formatSessionDate(selectedSession?.sessionDate)}
                </p>
              </div>
              <div className="flex flex-col gap-3 sm:flex-row">
                <button
                  type="button"
                  onClick={handleAssessAll}
                  disabled={selectedSessionLocked}
                  className="inline-flex min-h-11 items-center justify-center rounded-2xl bg-[var(--button-primary)] px-5 py-3 text-sm font-semibold text-[var(--button-primary-text)] transition hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-60"
                >
                  {completedPlayerNames.length > 0 ? 'Continue Assessments' : 'Assess All'}
                </button>
                <button
                  type="button"
                  disabled={isSaving || selectedSessionLocked}
                  onClick={() => void handleClearSessionPlayers()}
                  className="inline-flex min-h-11 items-center justify-center rounded-2xl border border-red-500/40 bg-red-600 px-5 py-3 text-sm font-semibold text-white transition hover:bg-red-700 disabled:cursor-not-allowed disabled:opacity-60"
                >
                  Clear Session
                </button>
              </div>
            </div>

            {paginatedSessionPlayers.items.map((player) => (
              <div key={player.id} className="rounded-[24px] border border-[var(--border-color)] bg-[var(--panel-alt)] p-4">
                <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
                  <div className="min-w-0">
                    <p className="text-base font-semibold text-[var(--text-primary)]">{player.playerName}</p>
                    <p className="mt-1 text-sm text-[var(--text-muted)]">{player.section} | {player.team || 'No team'}</p>
                    {completedPlayerNames.includes(normalizeProgressName(player.playerName)) ? (
                      <p className="mt-1 text-xs font-semibold uppercase tracking-[0.14em] text-[var(--accent)]">
                        Assessment completed
                      </p>
                    ) : null}
                  </div>
                  <button
                    type="button"
                    disabled={selectedSessionLocked}
                    onClick={() => navigate(buildAssessmentUrl(player.playerName))}
                    className="inline-flex min-h-11 items-center justify-center rounded-2xl border border-[var(--border-color)] bg-[var(--panel-bg)] px-4 py-3 text-sm font-semibold text-[var(--text-primary)] transition hover:bg-[var(--panel-soft)] disabled:cursor-not-allowed disabled:opacity-60"
                  >
                    Assess Player
                  </button>
                </div>

              </div>
            ))}
            <Pagination
              currentPage={sessionPlayerPage}
              onPageChange={setSessionPlayerPage}
              pageSize={SESSION_PLAYER_PAGE_SIZE}
              totalItems={sessionPlayers.length}
            />
          </div>
        )}
      </SectionCard>

      <ConfirmModal
        isOpen={Boolean(clearSessionTarget)}
        isBusy={isSaving}
        title="Clear session players"
        message="This keeps the session itself, but removes all players from the session list."
        items={[
          `Session: ${clearSessionTarget?.session?.title || clearSessionTarget?.session?.team || 'Selected session'}`,
          `${clearSessionTarget?.playerCount ?? sessionPlayers.length} players from this session list`,
        ]}
        confirmLabel="Clear Session"
        onCancel={() => setClearSessionTarget(null)}
        requirePassword
        onConfirm={(password) => void confirmClearSessionPlayers(password)}
      />

      <ConfirmModal
        isOpen={Boolean(deleteGameTarget)}
        isBusy={isSaving}
        title="Delete tournament result"
        message="This removes the saved score result from this tournament session."
        items={[
          `Opponent: ${deleteGameTarget?.opponent || 'Selected opponent'}`,
          `Score: ${deleteGameTarget ? `${selectedSession?.team || 'Team'} ${deleteGameTarget.teamScore} - ${deleteGameTarget.opponentScore}` : 'Selected result'}`,
        ]}
        confirmLabel="Delete Result"
        onCancel={() => setDeleteGameTarget(null)}
        requirePassword
        onConfirm={(password) => void confirmDeleteTournamentGame(password)}
      />

      <ConfirmModal
        isOpen={Boolean(completeSessionTarget)}
        isBusy={isSaving}
        title="Complete session"
        message="Coaches will no longer be able to continue editing this session after it is completed."
        itemsTitle="This will change:"
        items={[
          `Session: ${completeSessionTarget?.title || completeSessionTarget?.team || 'Selected session'}`,
          'Session status will change to completed',
          'Managers can still review and correct it later',
        ]}
        confirmLabel="Complete Session"
        onCancel={() => setCompleteSessionTarget(null)}
        onConfirm={() => void confirmCompleteSession()}
      />
    </div>
  )
}
