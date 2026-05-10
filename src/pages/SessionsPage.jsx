import { useEffect, useMemo, useRef, useState } from 'react'
import { Navigate, useNavigate, useSearchParams } from 'react-router-dom'
import { ConfirmModal } from '../components/ui/ConfirmModal.jsx'
import { CoachOptionsSection } from '../components/sessions/CoachOptionsSection.jsx'
import { CreateSessionSection } from '../components/sessions/CreateSessionSection.jsx'
import { OpenSessionsSection } from '../components/sessions/OpenSessionsSection.jsx'
import { SessionPlayersSection } from '../components/sessions/SessionPlayersSection.jsx'
import { TournamentResultsSection } from '../components/sessions/TournamentResultsSection.jsx'
import { NoticeBanner } from '../components/ui/NoticeBanner.jsx'
import { Pagination } from '../components/ui/Pagination.jsx'
import { getPaginatedItems } from '../components/ui/pagination-utils.js'
import { PageHeader } from '../components/ui/PageHeader.jsx'
import { SectionCard } from '../components/ui/SectionCard.jsx'
import { useToast } from '../components/ui/toast-context.js'
import { canCreateEvaluation, useAuth, verifyCurrentUserPassword } from '../lib/auth.js'
import {
  AVAILABLE_PLAYER_PAGE_SIZE,
  SESSION_PLAYER_PAGE_SIZE,
  buildSessionAssessmentUrl,
  buildHistoricalSessionPlayers,
  buildHistoricalSessionsFromEvaluations,
  buildSessionCachePayload,
  createSessionFromHistoricalTarget,
  createInitialGameForm,
  createInitialSessionForm,
  getAssessmentCountForSession,
  getCompletedPlayerNamesFromEvaluations,
  getFilteredSessionPlayers,
  getNextSelectedPlayerIds,
  getOpenSessionSearchParams,
  getRecorderOptions,
  getSessionProgressKey,
  getSessionsWithUpdatedSession,
  getUnassessedPlayerQueue,
  readCompletedPlayerNames,
  readStoredSessionWorkspace,
  updateSessionFormValue,
  writeStoredSessionWorkspace,
} from '../lib/session-page-utils.js'
import {
  addPlayersToAssessmentSession,
  clearAssessmentSessionPlayers,
  completeAssessmentSession,
  createAssessmentSession,
  createAssessmentSessionGame,
  createPlayerStaffNote,
  deleteAssessmentSession,
  deleteAssessmentSessionGame,
  deletePlayerStaffNote,
  getEvaluations,
  getAssessmentSessionGames,
  getAssessmentSessionPlayers,
  getAssessmentSessions,
  getAvailableTeamsForUser,
  getSessionStaffNotes,
  getPlayers,
  readViewCache,
  readViewCacheValue,
  withRequestTimeout,
  writeViewCache,
} from '../lib/supabase.js'

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
  const [sessionVoiceNotes, setSessionVoiceNotes] = useState([])
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
  const [deleteSessionTarget, setDeleteSessionTarget] = useState(null)
  const [deleteGameTarget, setDeleteGameTarget] = useState(null)
  const [voiceNoteDeleteTarget, setVoiceNoteDeleteTarget] = useState(null)
  const [isLoading, setIsLoading] = useState(() => sessions.length === 0 && players.length === 0 && teams.length === 0)
  const [isSessionPlayersLoading, setIsSessionPlayersLoading] = useState(false)
  const [isSessionGamesLoading, setIsSessionGamesLoading] = useState(false)
  const [isSaving, setIsSaving] = useState(false)
  const [recordingTarget, setRecordingTarget] = useState(null)
  const [isSavingVoiceNote, setIsSavingVoiceNote] = useState(false)
  const [deletingVoiceNoteId, setDeletingVoiceNoteId] = useState('')
  const [errorMessage, setErrorMessage] = useState('')
  const mediaRecorderRef = useRef(null)
  const recordingChunksRef = useRef([])
  const recordingStartedAtRef = useRef(0)
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
  const canDeleteSessions = Number(user?.roleRank ?? 0) >= 50
  const selectedSessionCompleted = selectedSession?.status === 'completed'
  const selectedSessionLocked = selectedSessionCompleted && !canCompleteSessions
  const activePlayerSection = selectedSession?.section || sessionForm.section
  const activePlayerTeam = selectedSession?.team || sessionForm.team
  const activePlayerTeamId = selectedSession?.teamId || sessionForm.teamId
  const selectedSessionAssessmentCount = useMemo(
    () => getAssessmentCountForSession(evaluations, selectedSession),
    [evaluations, selectedSession],
  )
  const deleteSessionDisabledReason = selectedSession?.isHistorical
    ? 'This is an assessment history group. It cannot be deleted as a session.'
    : selectedSessionAssessmentCount > 0
      ? 'Sessions with assessments cannot be deleted.'
      : ''
  const completedPlayerNames = useMemo(() => {
    const dbCompletedPlayerNames = getCompletedPlayerNamesFromEvaluations(evaluations, selectedSession, sessionPlayers)
    const localCompletedPlayerNames = readCompletedPlayerNames(user, selectedSessionId)

    return [...new Set([...dbCompletedPlayerNames, ...localCompletedPlayerNames])]
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

      if (!selectedSession) {
        if (!isLoading) {
          setSessionPlayers([])
        }
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
          setErrorMessage('Session players could not be loaded. Try again in a moment.')
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
  }, [combinedSessions, evaluations, isLoading, selectedSessionId, user])

  useEffect(() => {
    let isMounted = true

    const loadSessionGames = async () => {
      const activeSession = combinedSessions.find((session) => session.id === selectedSessionId)

      if (!selectedSessionId || activeSession?.sessionType !== 'tournament' || activeSession?.isHistorical) {
        setSessionGames([])
        return
      }

      if (!activeSession) {
        if (!isLoading) {
          setSessionGames([])
        }
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
  }, [combinedSessions, isLoading, selectedSessionId, user])

  useEffect(() => {
    let isMounted = true

    const loadSessionVoiceNotes = async () => {
      const activeSession = combinedSessions.find((session) => session.id === selectedSessionId)

      if (!selectedSessionId || activeSession?.isHistorical) {
        setSessionVoiceNotes([])
        return
      }

      try {
        const nextSessionVoiceNotes = await withRequestTimeout(
          () => getSessionStaffNotes({ user, sessionId: selectedSessionId }),
          'Could not load voice notes.',
        )

        if (isMounted) {
          setSessionVoiceNotes(nextSessionVoiceNotes)
        }
      } catch (error) {
        console.error(error)

        if (isMounted) {
          setSessionVoiceNotes([])
        }
      }
    }

    void loadSessionVoiceNotes()

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
    () => getFilteredSessionPlayers({
      activePlayerSection,
      activePlayerTeam,
      activePlayerTeamId,
      players,
    }),
    [activePlayerSection, activePlayerTeam, activePlayerTeamId, players],
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
    setAvailablePlayerPage(1)
    setSelectedPlayerIds([])
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
    writeViewCache(cacheKey, buildSessionCachePayload({ evaluations, nextState, players, sessions, teams }))
  }

  const handleSessionFormChange = (event) => {
    const { name, value } = event.target
    setErrorMessage('')

    if (name === 'teamId' || name === 'section') {
      setAvailablePlayerPage(1)
    }

    setSessionForm((current) => updateSessionFormValue({
      currentForm: current,
      name,
      teams,
      value,
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
    setSelectedPlayerIds((current) => getNextSelectedPlayerIds(current, playerId, checked))
  }

  const handleOpenSession = (sessionId) => {
    const nextSessionId = String(sessionId ?? '').trim()

    if (!nextSessionId) {
      return
    }

    setErrorMessage('')
    setSelectedSessionId(nextSessionId)
    setSelectedPlayerIds([])
    setSearchParams(getOpenSessionSearchParams(searchParams, nextSessionId), { replace: true })
  }

  const handleCompleteSession = async () => {
    if (!selectedSessionId || !selectedSession) {
      setErrorMessage('Select a session before completing it.')
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
      let sessionToCompleteId = selectedSessionId

      if (completeSessionTarget.isHistorical) {
        const createdSession = await createAssessmentSession({
          user,
          session: createSessionFromHistoricalTarget({
            historicalSession: completeSessionTarget,
            teams,
          }),
        })
        sessionToCompleteId = createdSession.id
        setSelectedSessionId(createdSession.id)
      }

      const completedSession = await completeAssessmentSession({
        user,
        sessionId: sessionToCompleteId,
      })
      const nextSessions = getSessionsWithUpdatedSession(sessions, completedSession)
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

  const handleDeleteSession = () => {
    if (!selectedSessionId || selectedSession?.isHistorical) {
      setErrorMessage('Select a saved session before deleting it.')
      return
    }

    if (!canDeleteSessions) {
      setErrorMessage('Only managers and team admins can delete sessions.')
      return
    }

    if (selectedSessionAssessmentCount > 0) {
      setErrorMessage('This session has assessments and cannot be deleted.')
      return
    }

    setDeleteSessionTarget({
      session: selectedSession,
      assessmentCount: selectedSessionAssessmentCount,
      playerCount: sessionPlayers.length,
      gameCount: sessionGames.length,
    })
  }

  const confirmDeleteSession = async (password) => {
    if (!deleteSessionTarget?.session?.id) {
      return
    }

    setIsSaving(true)
    setErrorMessage('')

    try {
      await verifyCurrentUserPassword(user?.email, password)
      await deleteAssessmentSession({
        user,
        sessionId: deleteSessionTarget.session.id,
      })
      const nextSessions = sessions.filter((session) => session.id !== deleteSessionTarget.session.id)
      setSessions(nextSessions)
      setSessionPlayers([])
      setSessionGames([])
      setSelectedPlayerIds([])
      setDeleteSessionTarget(null)
      setSelectedSessionId(nextSessions[0]?.id || '')
      writeSessionCache({
        sessions: nextSessions,
      })
      showToast({ title: 'Session deleted', message: 'The session was removed.' })
    } catch (error) {
      console.error(error)
      setErrorMessage(error.message || 'Could not delete this session.')
      showToast({ title: 'Session not deleted', message: error.message || 'Could not delete this session.', tone: 'error' })
    } finally {
      setIsSaving(false)
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

    if (selectedSession?.isHistorical) {
      setErrorMessage('Historical sessions are read only. Create or select a saved session to add players.')
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

  const handleAssessAll = () => {
    const queue = getUnassessedPlayerQueue({ completedPlayerNames, sessionPlayers })

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

    navigate(buildSessionAssessmentUrl({
      playerName: queue[0],
      queue,
      selectedSession,
      selectedSessionId,
      sessionForm,
      sessionPlayers,
    }))
  }

  const handleStartVoiceNote = async (target) => {
    if (!globalThis.MediaRecorder || !navigator.mediaDevices?.getUserMedia) {
      setErrorMessage('Voice recording is not supported in this browser.')
      showToast({ title: 'Voice note not started', message: 'Voice recording is not supported in this browser.', tone: 'error' })
      return
    }

    if (selectedSessionLocked) {
      setErrorMessage('This session has been completed and can no longer be edited.')
      return
    }

    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true })
      const recorder = new globalThis.MediaRecorder(stream, getRecorderOptions())
      recordingChunksRef.current = []
      recordingStartedAtRef.current = Date.now()
      setRecordingTarget(target)

      recorder.ondataavailable = (event) => {
        if (event.data?.size > 0) {
          recordingChunksRef.current.push(event.data)
        }
      }

      recorder.onstop = async () => {
        const chunks = recordingChunksRef.current
        const durationSeconds = Math.max(1, Math.round((Date.now() - recordingStartedAtRef.current) / 1000))
        stream.getTracks().forEach((track) => track.stop())
        mediaRecorderRef.current = null
        recordingChunksRef.current = []

        if (chunks.length === 0) {
          setRecordingTarget(null)
          setErrorMessage('No audio was captured. Try recording again.')
          return
        }

        const audioBlob = new Blob(chunks, { type: recorder.mimeType || 'audio/webm' })
        setIsSavingVoiceNote(true)

        try {
          const savedNote = await createPlayerStaffNote({
            user,
            playerId: target.playerId || '',
            sessionId: target.sessionId || selectedSessionId,
            note: target.playerName
              ? `Voice note for ${target.playerName}`
              : `Team voice note for ${selectedSession?.title || selectedSession?.team || 'session'}`,
            audioBlob,
            audioDurationSeconds: durationSeconds,
          })

          if (!target.playerId) {
            setSessionVoiceNotes((currentNotes) => [savedNote, ...currentNotes])
          }

          showToast({
            title: 'Voice note saved',
            message: target.playerName ? `Saved for ${target.playerName}.` : 'Saved for this session.',
          })
        } catch (error) {
          console.error(error)
          setErrorMessage(error.message || 'Could not save the voice note.')
          showToast({ title: 'Voice note not saved', message: error.message || 'Could not save the voice note.', tone: 'error' })
        } finally {
          setIsSavingVoiceNote(false)
          setRecordingTarget(null)
        }
      }

      mediaRecorderRef.current = recorder
      recorder.start()
    } catch (error) {
      console.error(error)
      setRecordingTarget(null)
      setErrorMessage('Microphone access was not allowed.')
      showToast({ title: 'Voice note not started', message: 'Microphone access was not allowed.', tone: 'error' })
    }
  }

  const handleStopVoiceNote = () => {
    if (mediaRecorderRef.current?.state === 'recording') {
      mediaRecorderRef.current.stop()
    }
  }

  const confirmDeleteVoiceNote = async () => {
    if (!voiceNoteDeleteTarget?.id) {
      return
    }

    setDeletingVoiceNoteId(voiceNoteDeleteTarget.id)
    setErrorMessage('')

    try {
      await deletePlayerStaffNote({ noteId: voiceNoteDeleteTarget.id })
      setSessionVoiceNotes((currentNotes) => currentNotes.filter((note) => note.id !== voiceNoteDeleteTarget.id))
      showToast({ title: 'Voice note deleted', message: 'The voice note has been removed.' })
    } catch (error) {
      console.error(error)
      setErrorMessage(error.message || 'Voice note could not be deleted.')
      showToast({ title: 'Voice note not deleted', message: error.message || 'Voice note could not be deleted.', tone: 'error' })
    } finally {
      setDeletingVoiceNoteId('')
      setVoiceNoteDeleteTarget(null)
    }
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
        <div className="rounded-lg border border-[var(--border-color)] bg-[var(--panel-alt)] px-4 py-4 text-sm text-[var(--text-primary)]">
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
              className="inline-flex min-h-11 items-center justify-center rounded-lg border border-[var(--border-color)] bg-[var(--panel-bg)] px-4 py-3 text-sm font-semibold text-[var(--text-primary)] transition hover:bg-[var(--panel-soft)]"
            >
              Dismiss
            </button>
          </div>
        </div>
      ) : null}

      <OpenSessionsSection
        canCompleteSessions={canCompleteSessions}
        canDeleteSessions={canDeleteSessions}
        combinedSessions={combinedSessions}
        deleteSessionDisabledReason={deleteSessionDisabledReason}
        isLoading={isLoading}
        isSaving={isSaving}
        onCompleteSession={handleCompleteSession}
        onDeleteSession={handleDeleteSession}
        onOpenSession={handleOpenSession}
        previousSessions={previousSessions}
        selectedSession={selectedSession}
        selectedSessionCompleted={selectedSessionCompleted}
      />

      <TournamentResultsSection
        form={gameForm}
        games={sessionGames}
        isLoading={isSessionGamesLoading}
        isSaving={isSaving}
        isSessionLocked={selectedSessionLocked}
        onChange={handleGameFormChange}
        onDeleteGame={handleDeleteTournamentGame}
        onSubmit={handleAddTournamentGame}
        selectedSession={selectedSession}
      />

      <CreateSessionSection
        form={sessionForm}
        isLoading={isLoading}
        isSaving={isSaving}
        onChange={handleSessionFormChange}
        onSubmit={handleCreateSession}
        teams={teams}
      />

      <CoachOptionsSection
        activePlayerSection={activePlayerSection}
        activePlayerTeam={activePlayerTeam}
        canDeleteSessions={canDeleteSessions}
        combinedSessions={combinedSessions}
        filteredPlayers={filteredPlayers}
        isSaving={isSaving}
        onImportPlayers={handleImportPlayers}
        onOpenSession={handleOpenSession}
        onPlayerPageChange={setAvailablePlayerPage}
        onPlayerSelection={handlePlayerSelection}
        onSectionChange={handleSessionFormChange}
        paginatedPlayers={paginatedFilteredPlayers}
        playerPage={availablePlayerPage}
        selectedPlayerIds={selectedPlayerIds}
        selectedSessionAssessmentCount={selectedSessionAssessmentCount}
        selectedSessionId={selectedSessionId}
        selectedSessionLocked={selectedSessionLocked}
        sessions={sessions}
      />

      <SessionPlayersSection
        canCompleteSessions={canCompleteSessions}
        completedPlayerNames={completedPlayerNames}
        isLoading={isSessionPlayersLoading}
        isSaving={isSaving}
        isSavingVoiceNote={isSavingVoiceNote}
        deletingVoiceNoteId={deletingVoiceNoteId}
        onAssessAll={handleAssessAll}
        onAssessPlayer={(player) =>
          navigate(buildSessionAssessmentUrl({
            playerName: player.playerName,
            selectedSession,
            selectedSessionId,
            sessionForm,
            sessionPlayers,
          }))
        }
        onClearSessionPlayers={handleClearSessionPlayers}
        onDeleteVoiceNote={setVoiceNoteDeleteTarget}
        onPageChange={setSessionPlayerPage}
        onStartVoiceNote={handleStartVoiceNote}
        onStopVoiceNote={handleStopVoiceNote}
        paginatedPlayers={paginatedSessionPlayers}
        page={sessionPlayerPage}
        recordingTarget={recordingTarget}
        selectedSession={selectedSession}
        selectedSessionCompleted={selectedSessionCompleted}
        selectedSessionId={selectedSessionId}
        selectedSessionLocked={selectedSessionLocked}
        sessionPlayers={sessionPlayers}
        sessionVoiceNotes={sessionVoiceNotes}
      />

      <ConfirmModal
        isOpen={Boolean(voiceNoteDeleteTarget)}
        isBusy={Boolean(deletingVoiceNoteId)}
        title="Delete voice note"
        message="This removes the voice note and its audio file from this workspace."
        items={[
          `Voice note: ${voiceNoteDeleteTarget?.note || 'Selected voice note'}`,
          `Created by: ${voiceNoteDeleteTarget?.userName || voiceNoteDeleteTarget?.userEmail || 'Staff'}`,
        ]}
        confirmLabel="Delete Voice Note"
        onCancel={() => setVoiceNoteDeleteTarget(null)}
        onConfirm={() => void confirmDeleteVoiceNote()}
      />

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
        isOpen={Boolean(deleteSessionTarget)}
        isBusy={isSaving}
        title="Delete session"
        message="This removes the session, the player list, and any tournament results. Sessions with assessments cannot be deleted."
        items={[
          `Session: ${deleteSessionTarget?.session?.title || deleteSessionTarget?.session?.team || 'Selected session'}`,
          `Players in session: ${deleteSessionTarget?.playerCount ?? 0}`,
          `Tournament results: ${deleteSessionTarget?.gameCount ?? 0}`,
          `Assessments linked: ${deleteSessionTarget?.assessmentCount ?? 0}`,
        ]}
        confirmLabel="Delete Session"
        onCancel={() => setDeleteSessionTarget(null)}
        requirePassword
        onConfirm={(password) => void confirmDeleteSession(password)}
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
