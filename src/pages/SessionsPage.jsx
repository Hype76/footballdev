import { useEffect, useMemo, useRef, useState } from 'react'
import { Navigate, useNavigate, useSearchParams } from 'react-router-dom'
import { ConfirmModal } from '../components/ui/ConfirmModal.jsx'
import { CoachOptionsSection } from '../components/sessions/CoachOptionsSection.jsx'
import { CreateSessionSection } from '../components/sessions/CreateSessionSection.jsx'
import { OpenSessionsSection } from '../components/sessions/OpenSessionsSection.jsx'
import { SessionPlayersSection } from '../components/sessions/SessionPlayersSection.jsx'
import { NoticeBanner } from '../components/ui/NoticeBanner.jsx'
import { getPaginatedItems } from '../components/ui/pagination-utils.js'
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
  createPlayerStaffNote,
  deleteAssessmentSession,
  deletePlayerStaffNote,
  getEvaluations,
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

const sessionRuleCards = [
  {
    label: 'Create the real block',
    body: 'Use one session for one training night or match block so notes and records share the same football context.',
  },
  {
    label: 'Build the player queue',
    body: 'Add the relevant squad before recording so coaches can work through players without searching.',
  },
  {
    label: 'Record then complete',
    body: 'Capture quick notes first, finish player records next, then close the session when the work is done.',
  },
]

const eyebrowClass = 'text-xs font-black uppercase tracking-[0.18em] text-[#1d4ed8]'
const bodyTextClass = 'text-sm font-semibold leading-6 text-[#475569]'
const primaryButtonClass = 'inline-flex min-h-14 items-center justify-center rounded-lg bg-[#0f172a] px-5 py-4 text-base font-black text-white transition hover:bg-[#1d4ed8] disabled:cursor-not-allowed disabled:opacity-60'
const secondaryButtonClass = 'inline-flex min-h-12 items-center justify-center rounded-lg border border-[#d8e3ee] bg-white px-5 py-3 text-sm font-black text-[#10231a] shadow-sm shadow-[#0f172a]/5 transition hover:border-[#2563eb] hover:bg-[#eff6ff]'

export function SessionsPage({ setupOpen = false }) {
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
  const [sessionVoiceNotes, setSessionVoiceNotes] = useState([])
  const [sessionForm, setSessionForm] = useState(createInitialSessionForm)
  const [selectedSessionId, setSelectedSessionId] = useState(() => String(storedSessionWorkspace.selectedSessionId ?? ''))
  const [selectedPlayerIds, setSelectedPlayerIds] = useState(() =>
    Array.isArray(storedSessionWorkspace.selectedPlayerIds) ? storedSessionWorkspace.selectedPlayerIds : [],
  )
  const [availablePlayerPage, setAvailablePlayerPage] = useState(1)
  const [sessionPlayerPage, setSessionPlayerPage] = useState(1)
  const [clearSessionTarget, setClearSessionTarget] = useState(null)
  const [completeSessionTarget, setCompleteSessionTarget] = useState(null)
  const [deleteSessionTarget, setDeleteSessionTarget] = useState(null)
  const [voiceNoteDeleteTarget, setVoiceNoteDeleteTarget] = useState(null)
  const [isLoading, setIsLoading] = useState(() => sessions.length === 0 && players.length === 0 && teams.length === 0)
  const [isSessionPlayersLoading, setIsSessionPlayersLoading] = useState(false)
  const [isSaving, setIsSaving] = useState(false)
  const [recordingTarget, setRecordingTarget] = useState(null)
  const [isSavingVoiceNote, setIsSavingVoiceNote] = useState(false)
  const [deletingVoiceNoteId, setDeletingVoiceNoteId] = useState('')
  const [errorMessage, setErrorMessage] = useState('')
  const mediaRecorderRef = useRef(null)
  const recordingChunksRef = useRef([])
  const recordingStartedAtRef = useRef(0)
  const currentSessionRef = useRef(null)
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
  const requestedSessionMissing =
    Boolean(requestedSessionId) && !isLoading && !combinedSessions.some((session) => session.id === requestedSessionId)
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
    ? 'This is a development history group. It cannot be deleted as a session.'
    : selectedSessionAssessmentCount > 0
      ? 'Sessions with development records cannot be deleted.'
      : ''
  const completedPlayerNames = useMemo(() => {
    const dbCompletedPlayerNames = getCompletedPlayerNamesFromEvaluations(evaluations, selectedSession, sessionPlayers)
    const localCompletedPlayerNames = readCompletedPlayerNames(user, selectedSessionId)

    return [...new Set([...dbCompletedPlayerNames, ...localCompletedPlayerNames])]
  }, [evaluations, selectedSession, selectedSessionId, sessionPlayers, user])
  const unassessedPlayerQueue = useMemo(
    () => getUnassessedPlayerQueue({ completedPlayerNames, sessionPlayers }),
    [completedPlayerNames, sessionPlayers],
  )
  const assessedPlayerCount = Math.max(0, sessionPlayers.length - unassessedPlayerQueue.length)
  const previousSessions = useMemo(
    () => combinedSessions.filter((session) => session.id !== selectedSessionId),
    [combinedSessions, selectedSessionId],
  )
  const openSessionCount = combinedSessions.filter((session) => session.status !== 'completed').length
  const completedSessionCount = combinedSessions.filter((session) => session.status === 'completed').length
  const sessionQueueLabel = sessionPlayers.length > 0
    ? `${assessedPlayerCount} of ${sessionPlayers.length} recorded`
    : 'No players added'

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

  const handleCurrentSessionFocus = () => {
    if (!selectedSessionId) {
      setErrorMessage('Select a saved session first.')
      return
    }

    currentSessionRef.current?.scrollIntoView({
      behavior: 'smooth',
      block: 'start',
    })
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
      setErrorMessage('This session has development records and cannot be deleted.')
      return
    }

    setDeleteSessionTarget({
      session: selectedSession,
      assessmentCount: selectedSessionAssessmentCount,
      playerCount: sessionPlayers.length,
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
          : 'All players in this session already have development records.',
      )
      return
    }

    if (selectedSessionLocked) {
      setErrorMessage('This session has been completed and can no longer start development records.')
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

  const clearRequestedSession = () => {
    const nextSearchParams = new URLSearchParams(searchParams)
    nextSearchParams.delete('sessionId')
    setSearchParams(nextSearchParams)
  }

  return (
    <div className="space-y-5">
      <section className="overflow-hidden rounded-lg border border-[#d8e3ee] bg-white shadow-sm shadow-[#0f172a]/5">
        <div className="grid gap-0 xl:grid-cols-[minmax(0,1fr)_25rem]">
          <div>
            <div className="px-5 py-6 sm:px-6 lg:px-8">
              <p className={eyebrowClass}>Session command</p>
              <h1 className="mt-3 max-w-5xl text-4xl font-black leading-[1.02] tracking-tight text-[#10231a] sm:text-5xl">
                Run training from plan to player record.
              </h1>
              <p className="mt-4 max-w-3xl text-base font-semibold leading-7 text-[#475569]">
                Sessions connect the football calendar to the coaching record. Create the block, add the squad, capture notes, then work through the player queue.
              </p>
              <div className="mt-5 grid gap-3 md:grid-cols-3">
                {sessionRuleCards.map((item) => (
                  <article key={item.label} className="rounded-lg border border-[#d8e3ee] bg-[#f8fbfd] p-4 shadow-sm shadow-[#0f172a]/5">
                    <p className="text-xs font-black uppercase tracking-[0.16em] text-[#1d4ed8]">{item.label}</p>
                    <p className={`mt-2 ${bodyTextClass}`}>{item.body}</p>
                  </article>
                ))}
              </div>
            </div>
          </div>
          <div className="grid content-between border-t border-[#bfdbfe] bg-[#eff6ff] p-5 sm:p-6 xl:border-l xl:border-t-0">
            <div>
              <p className="text-xs font-black uppercase tracking-[0.16em] text-[#1d4ed8]">Current queue</p>
              <p className="mt-2 text-2xl font-black tracking-tight text-[#10231a]">
                {selectedSession?.title || selectedSession?.team || 'No session selected'}
              </p>
              <p className={`mt-2 ${bodyTextClass}`}>
                {selectedSession ? sessionQueueLabel : 'Create a session or open a saved one to start the player queue.'}
              </p>
            </div>
            <div className="mt-5 grid grid-cols-2 gap-2">
              <SessionMetric label="Open" value={openSessionCount} isLoading={isLoading} />
              <SessionMetric label="Complete" value={completedSessionCount} isLoading={isLoading} />
              <SessionMetric label="Queued" value={sessionPlayers.length} isLoading={isSessionPlayersLoading} />
              <SessionMetric label="Left" value={unassessedPlayerQueue.length} isLoading={isSessionPlayersLoading} />
            </div>
            <p className={`mt-4 ${bodyTextClass}`}>
              Keep one active session selected so notes, records, and player progress stay together.
            </p>
          </div>
        </div>
      </section>

      {errorMessage ? <NoticeBanner title="Session action not completed" message={errorMessage} /> : null}

      <section className="grid gap-3 md:grid-cols-4">
        <SessionSummaryCard isLoading={isLoading} label="Sessions" value={combinedSessions.length} caption="Saved training and match blocks." />
        <SessionSummaryCard isLoading={isLoading} label="Open" value={openSessionCount} caption="Sessions still available to work." />
        <SessionSummaryCard isLoading={isSessionPlayersLoading} label="In queue" value={sessionPlayers.length} caption="Players attached to the selected session." />
        <SessionSummaryCard isLoading={isSessionPlayersLoading} label="Remaining" value={unassessedPlayerQueue.length} caption="Player records still to complete." />
      </section>

      {requestedSessionMissing ? (
        <div className="rounded-lg border border-[#fedf89] bg-[#fffaeb] px-4 py-4 text-sm text-[#10231a] shadow-sm shadow-[#0f172a]/5">
          <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <div>
              <p className="font-black">Session link could not be opened</p>
              <p className="mt-1 font-semibold leading-6 text-[#475569]">
                The session in this link was not found, so the current available session is shown instead.
              </p>
            </div>
            <button
              type="button"
              onClick={clearRequestedSession}
              className="inline-flex min-h-11 items-center justify-center rounded-lg border border-[#fedf89] bg-white px-4 py-3 text-sm font-black text-[#10231a] transition hover:bg-[#fffaeb]"
            >
              Clear session link
            </button>
          </div>
        </div>
      ) : null}

      {completedSessionId ? (
        <div className="rounded-lg border border-[#bfdbfe] bg-[#eff6ff] px-4 py-4 text-sm text-[#10231a] shadow-sm shadow-[#1d4ed8]/10">
          <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <div>
              <p className="font-black">Session development records completed</p>
              <p className="mt-1 font-semibold text-[#475569]">
                {completedCount > 0 ? `${completedCount} player development records were completed.` : 'All queued development records were completed.'}
              </p>
            </div>
            <button
              type="button"
              onClick={() => setSearchParams({})}
              className="inline-flex min-h-11 items-center justify-center rounded-lg border border-[#bfdbfe] bg-white px-4 py-3 text-sm font-black text-[#10231a] transition hover:bg-[#eff6ff]"
            >
              Dismiss
            </button>
          </div>
        </div>
      ) : null}

      <MatchdayFocus
        assessedPlayerCount={assessedPlayerCount}
        isLoading={isLoading || isSessionPlayersLoading}
        onAssessAll={handleAssessAll}
        selectedSession={selectedSession}
        selectedSessionCompleted={selectedSessionCompleted}
        selectedSessionLocked={selectedSessionLocked}
        sessionPlayers={sessionPlayers}
        unassessedPlayerCount={unassessedPlayerQueue.length}
      />

      <div ref={currentSessionRef} id="current-session">
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
      </div>

      <details
        id="session-setup"
        open={setupOpen || sessions.length === 0}
        className="rounded-lg border border-[#d8e3ee] bg-white p-3 shadow-sm shadow-[#0f172a]/5 sm:p-4"
      >
        <summary className="flex min-h-12 cursor-pointer list-none flex-col justify-center gap-1 rounded-lg px-2 text-base font-black text-[#10231a] sm:flex-row sm:items-center sm:justify-between">
          Session setup
          <span className="text-sm font-bold text-[#475569]">Create sessions, switch context, add players</span>
        </summary>
        <div className="mt-4 space-y-4">
          <CreateSessionSection
            form={sessionForm}
            isLoading={isLoading}
            isSaving={isSaving}
            onChange={handleSessionFormChange}
            onSubmit={handleCreateSession}
            teams={teams}
          />

          <OpenSessionsSection
            canCompleteSessions={canCompleteSessions}
            canDeleteSessions={canDeleteSessions}
            combinedSessions={combinedSessions}
            deleteSessionDisabledReason={deleteSessionDisabledReason}
            isLoading={isLoading}
            isSaving={isSaving}
            onCompleteSession={handleCompleteSession}
            onCurrentSession={handleCurrentSessionFocus}
            onDeleteSession={handleDeleteSession}
            onOpenSession={handleOpenSession}
            previousSessions={previousSessions}
            selectedSession={selectedSession}
            selectedSessionCompleted={selectedSessionCompleted}
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
        </div>
      </details>

      <ConfirmModal
        isOpen={Boolean(voiceNoteDeleteTarget)}
        isBusy={Boolean(deletingVoiceNoteId)}
        title="Delete voice note"
        message="This removes the voice note and its audio file from this workspace."
        items={[
          `Voice note: ${voiceNoteDeleteTarget?.note || 'Selected voice note'}`,
          `Created by: ${voiceNoteDeleteTarget?.userName || voiceNoteDeleteTarget?.userEmail || 'Staff'}`,
        ]}
        confirmLabel="Delete voice note"
        onCancel={() => setVoiceNoteDeleteTarget(null)}
        onConfirm={() => void confirmDeleteVoiceNote()}
      />

      <ConfirmModal
        isOpen={Boolean(clearSessionTarget)}
        isBusy={isSaving}
        title="Clear session players"
        message="This keeps the session itself and removes all players from the session list."
        items={[
          `Session: ${clearSessionTarget?.session?.title || clearSessionTarget?.session?.team || 'Selected session'}`,
          `${clearSessionTarget?.playerCount ?? sessionPlayers.length} players from this session list`,
        ]}
        confirmLabel="Clear session"
        onCancel={() => setClearSessionTarget(null)}
        requirePassword
        onConfirm={(password) => void confirmClearSessionPlayers(password)}
      />

      <ConfirmModal
        isOpen={Boolean(deleteSessionTarget)}
        isBusy={isSaving}
        title="Delete session"
        message="This removes the session and the player list. Sessions with development records cannot be deleted."
        items={[
          `Session: ${deleteSessionTarget?.session?.title || deleteSessionTarget?.session?.team || 'Selected session'}`,
          `Players in session: ${deleteSessionTarget?.playerCount ?? 0}`,
          `Development records linked: ${deleteSessionTarget?.assessmentCount ?? 0}`,
        ]}
        confirmLabel="Delete session"
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
        confirmLabel="Complete session"
        onCancel={() => setCompleteSessionTarget(null)}
        onConfirm={() => void confirmCompleteSession()}
      />
    </div>
  )
}

function MatchdayFocus({
  assessedPlayerCount,
  isLoading,
  onAssessAll,
  selectedSession,
  selectedSessionCompleted,
  selectedSessionLocked,
  sessionPlayers,
  unassessedPlayerCount,
}) {
  const hasSession = Boolean(selectedSession)
  const hasPlayers = sessionPlayers.length > 0
  const progressLabel = hasPlayers
    ? `${assessedPlayerCount} of ${sessionPlayers.length} recorded`
    : 'No players added yet'
  const nextActionLabel = !hasSession
    ? 'Set up session'
    : !hasPlayers
      ? 'Add players'
      : unassessedPlayerCount > 0
        ? assessedPlayerCount > 0 ? 'Continue records' : 'Start records'
        : 'Review completed session'

  const handleSetupScroll = () => {
    document.getElementById('session-setup')?.scrollIntoView({ behavior: 'smooth', block: 'start' })
  }

  return (
    <section className="rounded-lg border border-[#d8e3ee] bg-white p-5 shadow-sm shadow-[#0f172a]/5 sm:p-6">
      <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_auto] lg:items-center">
        <div className="min-w-0">
          <p className={eyebrowClass}>
            Live session
          </p>
          <h3 className="mt-2 break-words text-3xl font-black tracking-tight text-[#10231a] sm:text-4xl">
            {selectedSession?.title || selectedSession?.team || 'Get the next session ready'}
          </h3>
          <div className="mt-3 flex flex-wrap gap-2 text-sm font-semibold">
            <span className="rounded-lg border border-[#d8e3ee] bg-[#f8fbfd] px-3 py-1 text-[#10231a]">
              {progressLabel}
            </span>
            {selectedSessionCompleted ? (
              <span className="rounded-lg bg-[#1d4ed8] px-3 py-1 text-white">Completed</span>
            ) : (
              <span className="rounded-lg bg-[#0f172a] px-3 py-1 text-white">Open</span>
            )}
          </div>
          <p className={`mt-3 max-w-2xl ${bodyTextClass}`}>
            Keep this screen open during training or a match. Add notes quickly, then work through the player queue without leaving the football context.
          </p>
        </div>

        <div className="grid gap-3 sm:min-w-56">
          {hasSession && hasPlayers && unassessedPlayerCount > 0 ? (
            <button
              type="button"
              onClick={onAssessAll}
              disabled={isLoading || selectedSessionLocked}
              title={
                isLoading
                  ? 'Please wait while the session loads.'
                  : selectedSessionLocked
                    ? 'This session is completed, so development records cannot be started from here.'
                    : undefined
              }
              className={primaryButtonClass}
            >
              {nextActionLabel}
            </button>
          ) : (
            <button
              type="button"
              onClick={handleSetupScroll}
              disabled={isLoading}
              title={isLoading ? 'Please wait while the session loads.' : undefined}
              className={primaryButtonClass}
            >
              {nextActionLabel}
            </button>
          )}
          {hasSession ? (
            <button
              type="button"
              onClick={handleSetupScroll}
              className={secondaryButtonClass}
            >
              Session setup
            </button>
          ) : null}
        </div>
      </div>
    </section>
  )
}

function SessionMetric({ isLoading, label, value }) {
  return (
    <div className="rounded-lg border border-[#bfdbfe] bg-white px-3 py-3 shadow-sm shadow-[#1d4ed8]/10">
      <p className="text-[11px] font-black uppercase tracking-[0.14em] text-[#1d4ed8]">{label}</p>
      <p className="mt-2 text-2xl font-black text-[#10231a]">{isLoading ? '...' : value}</p>
    </div>
  )
}

function SessionSummaryCard({ caption, isLoading, label, value }) {
  return (
    <article className="rounded-lg border border-[#d8e3ee] bg-white p-5 shadow-sm shadow-[#0f172a]/5">
      <p className={eyebrowClass}>{label}</p>
      <p className="mt-3 text-4xl font-black tracking-tight text-[#10231a]">{isLoading ? '...' : value}</p>
      <p className={`mt-2 ${bodyTextClass}`}>{caption}</p>
    </article>
  )
}
