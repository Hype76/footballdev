import { useEffect, useMemo, useState } from 'react'
import { Navigate, useNavigate, useSearchParams } from 'react-router-dom'
import { NoticeBanner } from '../components/ui/NoticeBanner.jsx'
import { PageHeader } from '../components/ui/PageHeader.jsx'
import { SectionCard } from '../components/ui/SectionCard.jsx'
import { useToast } from '../components/ui/Toast.jsx'
import { canCreateEvaluation, useAuth } from '../lib/auth.js'
import {
  EVALUATION_SECTIONS,
  addPlayersToAssessmentSession,
  clearAssessmentSessionPlayers,
  createAssessmentSession,
  getEvaluations,
  getAssessmentSessionPlayers,
  getAssessmentSessions,
  getAvailableTeamsForUser,
  getPlayers,
  readViewCache,
  readViewCacheValue,
  updateAssessmentSessionPlayer,
  withRequestTimeout,
  writeViewCache,
} from '../lib/supabase.js'

function getTodayDate() {
  return new Date().toISOString().slice(0, 10)
}

function createInitialSessionForm() {
  return {
    teamId: '',
    team: '',
    opponent: '',
    sessionType: 'training',
    sessionDate: getTodayDate(),
    section: 'Trial',
  }
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
  const [sessionForm, setSessionForm] = useState(createInitialSessionForm)
  const [selectedSessionId, setSelectedSessionId] = useState(() => String(storedSessionWorkspace.selectedSessionId ?? ''))
  const [selectedPlayerIds, setSelectedPlayerIds] = useState(() =>
    Array.isArray(storedSessionWorkspace.selectedPlayerIds) ? storedSessionWorkspace.selectedPlayerIds : [],
  )
  const [notesDrafts, setNotesDrafts] = useState(() => {
    const draftsBySession = storedSessionWorkspace.notesDraftsBySession
    const selectedId = String(storedSessionWorkspace.selectedSessionId ?? '')
    return draftsBySession && selectedId && typeof draftsBySession[selectedId] === 'object'
      ? draftsBySession[selectedId]
      : {}
  })
  const [isLoading, setIsLoading] = useState(() => sessions.length === 0 && players.length === 0 && teams.length === 0)
  const [isSessionPlayersLoading, setIsSessionPlayersLoading] = useState(false)
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
        setNotesDrafts({})
        return
      }

      if (selectedSession?.isHistorical) {
        const historicalPlayers = buildHistoricalSessionPlayers(evaluations, selectedSession)
        setSessionPlayers(historicalPlayers)
        setNotesDrafts(Object.fromEntries(historicalPlayers.map((player) => [player.id, player.notes || ''])))
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
        setNotesDrafts((current) => {
          const storedDrafts = storedSessionWorkspace.notesDraftsBySession?.[selectedSessionId]
          const baseDrafts = storedDrafts && typeof storedDrafts === 'object' ? storedDrafts : current
          return Object.fromEntries(
            nextSessionPlayers.map((player) => [player.id, baseDrafts[player.id] ?? player.notes ?? '']),
          )
        })
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
  }, [combinedSessions, evaluations, selectedSessionId, storedSessionWorkspace.notesDraftsBySession, user])

  useEffect(() => {
    if (!workspaceStorageKey) {
      return
    }

    const currentStoredWorkspace = readStoredSessionWorkspace(workspaceStorageKey)
    writeStoredSessionWorkspace(workspaceStorageKey, {
      ...currentStoredWorkspace,
      selectedSessionId,
      selectedPlayerIds,
      notesDraftsBySession: {
        ...(currentStoredWorkspace.notesDraftsBySession || {}),
        ...(selectedSessionId ? { [selectedSessionId]: notesDrafts } : {}),
      },
    })
  }, [notesDrafts, selectedPlayerIds, selectedSessionId, workspaceStorageKey])

  const filteredPlayers = useMemo(
    () =>
      players.filter(
        (player) =>
          player.section === sessionForm.section &&
          (!sessionForm.team || player.team === sessionForm.team),
      ),
    [players, sessionForm.section, sessionForm.team],
  )

  useEffect(() => {
    if (!selectedSession) {
      return
    }

    setSessionForm((current) => ({
      ...current,
      teamId: selectedSession.teamId || current.teamId,
      team: selectedSession.team || current.team,
      opponent: selectedSession.opponent || current.opponent,
      sessionType: selectedSession.sessionType || current.sessionType,
      sessionDate: selectedSession.sessionDate || current.sessionDate,
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
      const matchingTeam = teams.find((team) => team.id === value)
      setSessionForm((current) => ({
        ...current,
        teamId: value,
        team: matchingTeam?.name || '',
      }))
      return
    }

    setSessionForm((current) => ({
      ...current,
      [name]: value,
    }))
  }

  const handleCreateSession = async (event) => {
    event.preventDefault()
    setIsSaving(true)
    setErrorMessage('')

    try {
      const createdSession = await createAssessmentSession({
        user,
        session: sessionForm,
      })
      const nextSessions = [createdSession, ...sessions.filter((session) => session.id !== createdSession.id)]
      setSessions(nextSessions)
      setSelectedSessionId(createdSession.id)
      setSelectedPlayerIds([])
      setSessionForm((current) => ({
        ...current,
        opponent: '',
      }))
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

  const handleImportPlayers = async (mode) => {
    if (!selectedSessionId) {
      setErrorMessage('Create or select a session first.')
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
      setNotesDrafts((current) =>
        Object.fromEntries(nextSessionPlayers.map((player) => [player.id, current[player.id] ?? player.notes ?? ''])),
      )
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

  const handleSaveNotes = async (sessionPlayer) => {
    setIsSaving(true)
    setErrorMessage('')

    try {
      const updatedPlayer = await updateAssessmentSessionPlayer({
        user,
        sessionPlayerId: sessionPlayer.id,
        notes: notesDrafts[sessionPlayer.id],
      })
      setSessionPlayers((current) => current.map((player) => (player.id === updatedPlayer.id ? updatedPlayer : player)))
      showToast({ title: 'Player notes saved', message: `${updatedPlayer.playerName} was updated.` })
    } catch (error) {
      console.error(error)
      setErrorMessage(error.message || 'Could not save player notes.')
      showToast({ title: 'Notes not saved', message: error.message || 'Could not save notes.', tone: 'error' })
    } finally {
      setIsSaving(false)
    }
  }

  const handleClearSessionPlayers = async () => {
    if (!selectedSessionId) {
      setErrorMessage('Select a session first.')
      return
    }

    if (!window.confirm('Clear this session? All players will be removed from the session list, but the session itself will remain.')) {
      return
    }

    setIsSaving(true)
    setErrorMessage('')

    try {
      await clearAssessmentSessionPlayers({
        user,
        sessionId: selectedSessionId,
      })
      setSessionPlayers([])
      setNotesDrafts({})
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

    navigate(buildAssessmentUrl(queue[0], queue))
  }

  return (
    <div className="space-y-5 sm:space-y-6">
      <PageHeader
        eyebrow="Sessions"
        title="Session planning"
        description="Create a team session, add players from Trial or Squad, make coach notes, then assess everyone from one queue."
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
                      Open
                    </span>
                  </div>
                  <p className="mt-1 text-xs uppercase tracking-[0.14em] text-[var(--text-secondary)]">
                    {(selectedSession?.sessionType === 'match' ? 'Match' : 'Training')} | {formatSessionDate(selectedSession?.sessionDate)}
                  </p>
                  <p className="mt-1 text-sm text-[var(--text-muted)]">{selectedSession?.team || 'No team entered'}</p>
                </div>
                <span className="inline-flex min-h-11 items-center justify-center rounded-2xl border border-[var(--border-color)] bg-[var(--panel-bg)] px-4 py-3 text-sm font-semibold text-[var(--text-primary)]">
                  Current Session
                </span>
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
                    {(session.sessionType === 'match' ? 'Match' : 'Training')} | {session.title || session.team} | {formatSessionDate(session.sessionDate)}
                  </option>
                ))}
              </select>
            </label>
          </div>
        )}
      </SectionCard>

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

            <label className="block">
              <span className="mb-2 block text-sm font-semibold text-[var(--text-primary)]">Session Type</span>
              <select
                name="sessionType"
                value={sessionForm.sessionType}
                onChange={handleSessionFormChange}
                className="min-h-11 w-full rounded-2xl border border-[var(--border-color)] bg-[var(--panel-alt)] px-4 py-3 text-sm text-[var(--text-primary)] outline-none transition focus:border-[var(--accent)]"
              >
                <option value="training">Training</option>
                <option value="match">Match</option>
              </select>
            </label>

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
                    {(session.sessionType === 'match' ? 'Match' : 'Training')} | {session.title || session.team} | {formatSessionDate(session.sessionDate)}
                  </option>
                ))}
              </select>
            </label>

            <div className="grid gap-3 lg:grid-cols-2">
              {filteredPlayers.map((player) => (
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

            {filteredPlayers.length === 0 ? (
              <div className="rounded-[20px] border border-dashed border-[var(--border-color)] bg-[var(--panel-alt)] px-4 py-6 text-sm text-[var(--text-muted)]">
                No {sessionForm.section.toLowerCase()} players are available for {sessionForm.team || 'this team'}.
              </div>
            ) : null}

            <div className="flex flex-col gap-3 sm:flex-row sm:flex-wrap">
              <button
                type="button"
                disabled={isSaving || filteredPlayers.length === 0}
                onClick={() => void handleImportPlayers('all')}
                className="inline-flex min-h-11 items-center justify-center rounded-2xl bg-[var(--button-primary)] px-5 py-3 text-sm font-semibold text-[var(--button-primary-text)] transition hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-60"
              >
                Add All {sessionForm.section} Players
              </button>
              <button
                type="button"
                disabled={isSaving || selectedPlayerIds.length === 0}
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
            <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
              <div>
                <p className="text-sm font-semibold text-[var(--text-primary)]">
                  {selectedSession?.title || selectedSession?.team || 'Session'}
                </p>
                <p className="mt-1 text-sm text-[var(--text-muted)]">
                  {(selectedSession?.sessionType === 'match' ? 'Match' : 'Training')} | {formatSessionDate(selectedSession?.sessionDate)}
                </p>
              </div>
              <div className="flex flex-col gap-3 sm:flex-row">
                <button
                  type="button"
                  onClick={handleAssessAll}
                  className="inline-flex min-h-11 items-center justify-center rounded-2xl bg-[var(--button-primary)] px-5 py-3 text-sm font-semibold text-[var(--button-primary-text)] transition hover:opacity-90"
                >
                  {completedPlayerNames.length > 0 ? 'Continue Assessments' : 'Assess All'}
                </button>
                <button
                  type="button"
                  disabled={isSaving}
                  onClick={() => void handleClearSessionPlayers()}
                  className="inline-flex min-h-11 items-center justify-center rounded-2xl border border-red-500/40 bg-red-600 px-5 py-3 text-sm font-semibold text-white transition hover:bg-red-700 disabled:cursor-not-allowed disabled:opacity-60"
                >
                  Clear Session
                </button>
              </div>
            </div>

            {sessionPlayers.map((player) => (
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
                    onClick={() => navigate(buildAssessmentUrl(player.playerName))}
                    className="inline-flex min-h-11 items-center justify-center rounded-2xl border border-[var(--border-color)] bg-[var(--panel-bg)] px-4 py-3 text-sm font-semibold text-[var(--text-primary)] transition hover:bg-[var(--panel-soft)]"
                  >
                    Assess Player
                  </button>
                </div>

                <label className="mt-4 block">
                  <span className="mb-2 block text-sm font-semibold text-[var(--text-primary)]">Coach notes</span>
                  <textarea
                    value={notesDrafts[player.id] ?? ''}
                    onChange={(event) =>
                      setNotesDrafts((current) => ({
                        ...current,
                        [player.id]: event.target.value,
                      }))
                    }
                    rows="3"
                    className="min-h-24 w-full rounded-2xl border border-[var(--border-color)] bg-[var(--panel-bg)] px-4 py-3 text-sm text-[var(--text-primary)] outline-none transition focus:border-[var(--accent)]"
                  />
                </label>

                <button
                  type="button"
                  disabled={isSaving}
                  onClick={() => void handleSaveNotes(player)}
                  className="mt-3 inline-flex min-h-11 items-center justify-center rounded-2xl border border-[var(--border-color)] bg-[var(--panel-bg)] px-4 py-3 text-sm font-semibold text-[var(--text-primary)] transition hover:bg-[var(--panel-soft)] disabled:cursor-not-allowed disabled:opacity-60"
                >
                  Save Notes
                </button>
              </div>
            ))}
          </div>
        )}
      </SectionCard>
    </div>
  )
}
