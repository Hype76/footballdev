import { useEffect, useMemo, useRef, useState } from 'react'
import { Navigate, useNavigate, useSearchParams } from 'react-router-dom'
import { ConfirmModal } from '../components/ui/ConfirmModal.jsx'
import { CoachOptionsSection } from '../components/sessions/CoachOptionsSection.jsx'
import { CreateSessionSection } from '../components/sessions/CreateSessionSection.jsx'
import { FootballCalendar } from '../components/sessions/FootballCalendar.jsx'
import { OpenSessionsSection } from '../components/sessions/OpenSessionsSection.jsx'
import { SessionPlayersSection } from '../components/sessions/SessionPlayersSection.jsx'
import { NoticeBanner } from '../components/ui/NoticeBanner.jsx'
import { getPaginatedItems } from '../components/ui/pagination-utils.js'
import { useToast } from '../components/ui/toast-context.js'
import { canCreateEvaluation, isClubAdmin, useAuth, verifyCurrentUserPassword } from '../lib/auth.js'
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
import { buildFootballCalendarEvents } from '../lib/football-calendar-events.js'
import {
  addPlayersToAssessmentSession,
  clearAssessmentSessionPlayers,
  completeAssessmentSession,
  createCalendarEvent,
  createAssessmentSession,
  createPlayerStaffNote,
  createMatchDay,
  deleteCalendarEvent,
  deleteAssessmentSession,
  deletePlayerStaffNote,
  getEvaluations,
  getCalendarEvents,
  getMatchDays,
  getPolls,
  getAssessmentSessionPlayers,
  getAssessmentSessions,
  getAvailableTeamsForUser,
  getSessionStaffNotes,
  getPlayers,
  readViewCache,
  readViewCacheValue,
  updateCalendarEvent,
  updateAssessmentSession,
  updateMatchDay,
  withRequestTimeout,
  writeViewCache,
} from '../lib/supabase.js'

const eyebrowClass = 'text-xs font-black uppercase tracking-[0.18em] text-[#065f46]'
const bodyTextClass = 'text-sm font-semibold leading-6 text-[#4b5f55]'
const primaryButtonClass = 'inline-flex min-h-14 items-center justify-center rounded-lg bg-[#047857] px-5 py-4 text-base font-black text-white shadow-sm shadow-[#047857]/20 transition hover:bg-[#065f46] disabled:cursor-not-allowed disabled:opacity-60'
const secondaryButtonClass = 'inline-flex min-h-12 items-center justify-center rounded-lg border border-[#d7e5dc] bg-white px-5 py-3 text-sm font-black text-[#101828] shadow-sm shadow-[#101828]/5 transition hover:border-[#047857] hover:bg-[#ecfdf5]'
const fieldClass = 'min-h-12 w-full rounded-lg border border-[#d7e5dc] bg-[#f7faf8] px-4 py-3 text-sm font-semibold text-[#101828] outline-none transition placeholder:text-[#94a3b8] focus:border-[#047857] focus:bg-white focus:ring-2 focus:ring-[#bbf7d0]'
const EVENT_TYPE_OPTIONS = [
  { value: 'training', label: 'Training session' },
  { value: 'match', label: 'Match or fixture' },
  { value: 'availability_deadline', label: 'Availability deadline' },
  { value: 'parent_cutoff', label: 'Parent response cut-off' },
  { value: 'general', label: 'General club or team event' },
]
const RECURRENCE_OPTIONS = [
  { value: 'none', label: 'Does not repeat' },
  { value: 'weekly', label: 'Weekly' },
  { value: 'fortnightly', label: 'Fortnightly' },
  { value: 'monthly', label: 'Monthly' },
]

function formatDateInput(value) {
  const normalizedValue = String(value ?? '').trim()

  if (/^\d{4}-\d{2}-\d{2}$/.test(normalizedValue)) {
    return normalizedValue
  }

  const parsedDate = new Date(normalizedValue)
  return Number.isNaN(parsedDate.getTime()) ? '' : parsedDate.toISOString().slice(0, 10)
}

function formatTimeInput(value) {
  return /^\d{2}:\d{2}/.test(String(value ?? '').trim()) ? String(value).trim().slice(0, 5) : ''
}

function buildDateTime(date, time) {
  const dateValue = formatDateInput(date)
  const timeValue = formatTimeInput(time) || '09:00'

  return dateValue ? `${dateValue}T${timeValue}:00` : ''
}

function addMinutesToTime(time, minutesToAdd) {
  const timeValue = formatTimeInput(time) || '09:00'
  const [hours, minutes] = timeValue.split(':').map(Number)
  const totalMinutes = (hours * 60 + minutes + minutesToAdd + 1440) % 1440
  const nextHours = Math.floor(totalMinutes / 60)
  const nextMinutes = totalMinutes % 60
  return `${String(nextHours).padStart(2, '0')}:${String(nextMinutes).padStart(2, '0')}`
}

function getDefaultCalendarForm(date = '') {
  const eventDate = formatDateInput(date) || new Date().toISOString().slice(0, 10)

  return {
    date: eventDate,
    endTime: '10:00',
    eventType: 'training',
    location: '',
    notes: '',
    opponent: '',
    recurrenceFrequency: 'none',
    recurrenceUntil: '',
    startTime: '09:00',
    teamId: '',
    title: '',
  }
}

function canCreateClubCalendarEvent(user) {
  return isClubAdmin(user)
}

function getSafeCalendarTeamId(user, teamId) {
  const normalizedTeamId = String(teamId ?? '').trim()

  if (canCreateClubCalendarEvent(user)) {
    return normalizedTeamId
  }

  return normalizedTeamId || String(user?.activeTeamId ?? '').trim()
}

function getFormFromCalendarEvent(event) {
  const source = event?.data || {}
  const sourceType = event?.sourceType || ''

  if (sourceType === 'session') {
    return {
      ...getDefaultCalendarForm(source.sessionDate || event.date),
      date: formatDateInput(source.sessionDate || event.date),
      endTime: formatTimeInput(source.endTime) || addMinutesToTime(source.startTime, 60),
      eventType: source.sessionType === 'match' ? 'match' : 'training',
      location: source.location || '',
      notes: source.notes || '',
      opponent: source.opponent || '',
      startTime: formatTimeInput(source.startTime) || '09:00',
      teamId: source.teamId || '',
      title: source.title || '',
    }
  }

  if (sourceType === 'match-day') {
    return {
      ...getDefaultCalendarForm(source.matchDate || event.date),
      date: formatDateInput(source.matchDate || event.date),
      endTime: addMinutesToTime(source.kickoffTime, 105),
      eventType: 'match',
      location: source.venueName || '',
      notes: source.notes || '',
      opponent: source.opponent || '',
      startTime: formatTimeInput(source.kickoffTime) || '10:00',
      teamId: source.teamId || '',
      title: `${source.teamName || 'Team'} vs ${source.opponent || 'Opponent'}`,
    }
  }

  if (sourceType === 'calendar') {
    return {
      ...getDefaultCalendarForm(source.startsAt || event.date),
      date: formatDateInput(source.startsAt || event.date),
      endTime: formatTimeInput(source.endsAt) || addMinutesToTime(source.startsAt, 60),
      eventType: source.eventType || 'general',
      location: source.location || '',
      notes: source.notes || '',
      recurrenceFrequency: source.recurrenceFrequency || 'none',
      recurrenceUntil: source.recurrenceUntil || '',
      startTime: formatTimeInput(source.startsAt) || '09:00',
      teamId: source.teamId || '',
      title: source.title || '',
    }
  }

  return getDefaultCalendarForm(event?.date)
}

export function SessionsPage({ calendarOnly = false, setupOpen = false }) {
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
  const [matchDays, setMatchDays] = useState(() => {
    const cachedMatchDays = readViewCacheValue(cacheKey, 'matchDays', [])
    return Array.isArray(cachedMatchDays) ? cachedMatchDays : []
  })
  const [polls, setPolls] = useState(() => {
    const cachedPolls = readViewCacheValue(cacheKey, 'polls', [])
    return Array.isArray(cachedPolls) ? cachedPolls : []
  })
  const [calendarItems, setCalendarItems] = useState(() => {
    const cachedCalendarItems = readViewCacheValue(cacheKey, 'calendarItems', [])
    return Array.isArray(cachedCalendarItems) ? cachedCalendarItems : []
  })
  const [calendarView, setCalendarView] = useState('month')
  const [calendarCursor, setCalendarCursor] = useState(() => new Date())
  const [calendarModal, setCalendarModal] = useState(null)
  const [calendarForm, setCalendarForm] = useState(() => getDefaultCalendarForm())
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
  const [isCreateSessionModalOpen, setIsCreateSessionModalOpen] = useState(false)
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
  const calendarEvents = useMemo(
    () => buildFootballCalendarEvents({
      calendarEvents: calendarItems,
      evaluations,
      matchDays,
      polls,
      sessions: combinedSessions,
    }),
    [calendarItems, combinedSessions, evaluations, matchDays, polls],
  )

  useEffect(() => {
    const requestedAction = String(searchParams.get('action') ?? '').trim()

    if (requestedAction !== 'add-event' && requestedAction !== 'add-session') {
      return
    }

    const nextSearchParams = new URLSearchParams(searchParams)
    nextSearchParams.delete('action')
    setSearchParams(nextSearchParams, { replace: true })

    if (requestedAction === 'add-event') {
      handleCalendarDateClick(new Date().toISOString().slice(0, 10))
      return
    }

    setIsCreateSessionModalOpen(true)
  // This reacts only to explicit route quick actions.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [searchParams, setSearchParams])

  useEffect(() => {
    let isMounted = true
    const cachedValue = readViewCache(cacheKey)

    const loadData = async () => {
      setErrorMessage('')

      try {
        const [sessionsResult, playersResult, teamsResult, evaluationsResult, matchDaysResult, pollsResult, calendarItemsResult] = await Promise.allSettled([
          withRequestTimeout(() => getAssessmentSessions({ user }), 'Could not load sessions.'),
          withRequestTimeout(() => getPlayers({ user }), 'Could not load players.'),
          withRequestTimeout(() => getAvailableTeamsForUser(user), 'Could not load teams.'),
          withRequestTimeout(() => getEvaluations({ user }), 'Could not load historical sessions.'),
          withRequestTimeout(() => getMatchDays({ user }), 'Could not load match days.'),
          withRequestTimeout(() => getPolls({ user }), 'Could not load response cut offs.'),
          withRequestTimeout(() => getCalendarEvents({ user }), 'Could not load calendar events.'),
        ])

        if (!isMounted) {
          return
        }

        const nextSessions = sessionsResult.status === 'fulfilled' ? sessionsResult.value : cachedValue?.sessions || []
        const nextPlayers = playersResult.status === 'fulfilled' ? playersResult.value : cachedValue?.players || []
        const nextTeams = teamsResult.status === 'fulfilled' ? teamsResult.value : cachedValue?.teams || []
        const nextEvaluations =
          evaluationsResult.status === 'fulfilled' ? evaluationsResult.value : cachedValue?.evaluations || []
        const nextMatchDays = matchDaysResult.status === 'fulfilled' ? matchDaysResult.value : cachedValue?.matchDays || []
        const nextPolls = pollsResult.status === 'fulfilled' ? pollsResult.value : cachedValue?.polls || []
        const nextCalendarItems =
          calendarItemsResult.status === 'fulfilled' ? calendarItemsResult.value : cachedValue?.calendarItems || []

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

        if (matchDaysResult.status === 'rejected') {
          console.error(matchDaysResult.reason)
        }

        if (pollsResult.status === 'rejected') {
          console.error(pollsResult.reason)
        }

        if (calendarItemsResult.status === 'rejected') {
          console.error(calendarItemsResult.reason)
        }

        setSessions(nextSessions)
        setPlayers(nextPlayers)
        setTeams(nextTeams)
        setEvaluations(nextEvaluations)
        setMatchDays(nextMatchDays)
        setPolls(nextPolls)
        setCalendarItems(nextCalendarItems)
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
          matchDays: nextMatchDays,
          polls: nextPolls,
          calendarItems: nextCalendarItems,
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

  const writeCalendarAwareCache = (nextState = {}) => {
    writeViewCache(cacheKey, {
      evaluations,
      matchDays,
      players,
      polls,
      sessions,
      teams,
      calendarItems,
      ...nextState,
    })
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
      return false
    }

    if (!sessionForm.sessionDate) {
      setErrorMessage('Select a session date before creating the session.')
      setIsSaving(false)
      return false
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
      return true
    } catch (error) {
      console.error(error)
      setErrorMessage(error.message || 'Could not create session.')
      showToast({ title: 'Session not created', message: error.message || 'Could not create session.', tone: 'error' })
      return false
    } finally {
      setIsSaving(false)
    }
  }

  const handleCreateSessionFromModal = async (event) => {
    const created = await handleCreateSession(event)

    if (created) {
      setIsCreateSessionModalOpen(false)
    }
  }

  const handleSessionSetupFocus = () => {
    const setupSection = document.getElementById('session-setup')

    if (setupSection && 'open' in setupSection) {
      setupSection.open = true
    }

    window.requestAnimationFrame(() => {
      setupSection?.scrollIntoView({ behavior: 'smooth', block: 'start' })
    })
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

  const handleCalendarDateClick = (date) => {
    setErrorMessage('')
    setCalendarForm({
      ...getDefaultCalendarForm(date),
      teamId: canCreateClubCalendarEvent(user) ? '' : String(user?.activeTeamId ?? '').trim(),
    })
    setCalendarModal({ mode: 'create', event: null })
  }

  const handleCalendarEventOpen = (event) => {
    setErrorMessage('')
    setCalendarForm(getFormFromCalendarEvent(event))
    setCalendarModal({ mode: 'view', event })
  }

  const handleCalendarFormChange = (event) => {
    const { name, value } = event.target

    setErrorMessage('')
    setCalendarForm((current) => {
      const nextForm = {
        ...current,
        [name]: value,
      }

      if (name === 'teamId') {
        const selectedTeam = teams.find((team) => team.id === value)
        nextForm.team = selectedTeam?.name || ''
      }

      if (name === 'eventType' && value === 'training' && !current.title) {
        nextForm.title = ''
      }

      return nextForm
    })
  }

  const getCalendarTeamName = (teamId) => {
    const normalizedTeamId = String(teamId ?? '').trim()
    return teams.find((team) => team.id === normalizedTeamId)?.name || user?.activeTeamName || ''
  }

  const handleCalendarSave = async (event) => {
    event.preventDefault()
    setIsSaving(true)
    setErrorMessage('')

    const activeEvent = calendarModal?.event || null
    const sourceType = activeEvent?.sourceType || ''
    const safeTeamId = getSafeCalendarTeamId(user, calendarForm.teamId)
    const teamName = getCalendarTeamName(safeTeamId)
    const isTraining = calendarForm.eventType === 'training'
    const isMatch = calendarForm.eventType === 'match'

    try {
      if (!canCreateClubCalendarEvent(user) && !safeTeamId) {
        throw new Error('Choose your assigned team before saving this calendar event.')
      }

      if (isTraining || (sourceType === 'session' && activeEvent?.data?.sessionType !== 'match')) {
        const payload = {
          endTime: calendarForm.endTime,
          location: calendarForm.location,
          notes: calendarForm.notes,
          opponent: '',
          sessionDate: calendarForm.date,
          sessionType: 'training',
          startTime: calendarForm.startTime,
          team: teamName,
          teamId: safeTeamId,
          title: calendarForm.title || teamName,
        }
        const savedSession = sourceType === 'session'
          ? await updateAssessmentSession({ user, sessionId: activeEvent.sourceId, session: payload })
          : await createAssessmentSession({ user, session: payload })
        const nextSessions = [savedSession, ...sessions.filter((session) => session.id !== savedSession.id)]
        setSessions(nextSessions)
        writeCalendarAwareCache({ sessions: nextSessions })
        showToast({ title: sourceType === 'session' ? 'Session updated' : 'Session created', message: savedSession.title || 'Calendar updated.' })
      } else if (isMatch || sourceType === 'match-day' || (sourceType === 'session' && activeEvent?.data?.sessionType === 'match')) {
        if (sourceType === 'session') {
          const payload = {
            endTime: calendarForm.endTime,
            location: calendarForm.location,
            notes: calendarForm.notes,
            opponent: calendarForm.opponent,
            sessionDate: calendarForm.date,
            sessionType: 'match',
            startTime: calendarForm.startTime,
            team: teamName,
            teamId: safeTeamId,
            title: calendarForm.title || `${teamName} vs ${calendarForm.opponent}`,
          }
          const savedSession = await updateAssessmentSession({ user, sessionId: activeEvent.sourceId, session: payload })
          const nextSessions = [savedSession, ...sessions.filter((session) => session.id !== savedSession.id)]
          setSessions(nextSessions)
          writeCalendarAwareCache({ sessions: nextSessions })
          showToast({ title: 'Match session updated', message: savedSession.title || 'Calendar updated.' })
        } else {
          const payload = {
            arrivalTime: '',
            homeAway: 'home',
            kickoffTime: calendarForm.startTime,
            matchDate: calendarForm.date,
            notes: calendarForm.notes,
            opponent: calendarForm.opponent,
            scorerRequestMessage: '',
            status: 'scheduled',
            teamId: safeTeamId,
            venueAddress: '',
            venueName: calendarForm.location,
          }
          const savedMatch = sourceType === 'match-day'
            ? await updateMatchDay({ user, matchId: activeEvent.sourceId, updates: payload })
            : await createMatchDay({ user, match: payload })
          const nextMatchDays = [savedMatch, ...matchDays.filter((match) => match.id !== savedMatch.id)]
          setMatchDays(nextMatchDays)
          writeCalendarAwareCache({ matchDays: nextMatchDays })
          showToast({ title: sourceType === 'match-day' ? 'Fixture updated' : 'Fixture created', message: savedMatch.opponent || 'Calendar updated.' })
        }
      } else {
        const payload = {
          endsAt: buildDateTime(calendarForm.date, calendarForm.endTime),
          eventType: calendarForm.eventType,
          location: calendarForm.location,
          notes: calendarForm.notes,
          recurrenceFrequency: calendarForm.recurrenceFrequency,
          recurrenceUntil: calendarForm.recurrenceUntil,
          startsAt: buildDateTime(calendarForm.date, calendarForm.startTime),
          teamId: safeTeamId,
          title: calendarForm.title,
        }
        const savedEvent = sourceType === 'calendar'
          ? await updateCalendarEvent({ user, eventId: activeEvent.sourceId, event: payload })
          : await createCalendarEvent({ user, event: payload })
        const nextCalendarItems = [savedEvent, ...calendarItems.filter((item) => item.id !== savedEvent.id)]
        setCalendarItems(nextCalendarItems)
        writeCalendarAwareCache({ calendarItems: nextCalendarItems })
        showToast({ title: sourceType === 'calendar' ? 'Event updated' : 'Event created', message: savedEvent.title || 'Calendar updated.' })
      }

      setCalendarModal(null)
    } catch (error) {
      console.error(error)
      setErrorMessage(error.message || 'Calendar event could not be saved.')
      showToast({ title: 'Calendar not saved', message: error.message || 'Calendar event could not be saved.', tone: 'error' })
    } finally {
      setIsSaving(false)
    }
  }

  const handleCalendarDelete = async () => {
    const activeEvent = calendarModal?.event || null

    if (!activeEvent?.sourceId) {
      return
    }

    setIsSaving(true)
    setErrorMessage('')

    try {
      if (activeEvent.sourceType === 'calendar') {
        await deleteCalendarEvent({ user, eventId: activeEvent.sourceId })
        const nextCalendarItems = calendarItems.filter((item) => item.id !== activeEvent.sourceId)
        setCalendarItems(nextCalendarItems)
        writeCalendarAwareCache({ calendarItems: nextCalendarItems })
        showToast({ title: 'Event deleted', message: 'The calendar event was removed.' })
      } else if (activeEvent.sourceType === 'session') {
        const assessmentCount = getAssessmentCountForSession(evaluations, activeEvent.data)

        if (assessmentCount > 0) {
          throw new Error('Sessions with development records cannot be deleted.')
        }

        await deleteAssessmentSession({ user, sessionId: activeEvent.sourceId })
        const nextSessions = sessions.filter((session) => session.id !== activeEvent.sourceId)
        setSessions(nextSessions)
        writeCalendarAwareCache({ sessions: nextSessions })
        showToast({ title: 'Session deleted', message: 'The session was removed.' })
      } else if (activeEvent.sourceType === 'match-day') {
        const cancelledMatch = await updateMatchDay({
          user,
          matchId: activeEvent.sourceId,
          updates: { status: 'cancelled' },
        })
        const nextMatchDays = [cancelledMatch, ...matchDays.filter((match) => match.id !== cancelledMatch.id)]
        setMatchDays(nextMatchDays)
        writeCalendarAwareCache({ matchDays: nextMatchDays })
        showToast({ title: 'Fixture cancelled', message: cancelledMatch.opponent || 'The fixture was cancelled.' })
      } else {
        throw new Error('This calendar item opens in its own workflow.')
      }

      setCalendarModal(null)
    } catch (error) {
      console.error(error)
      setErrorMessage(error.message || 'Calendar event could not be deleted.')
      showToast({ title: 'Calendar not deleted', message: error.message || 'Calendar event could not be deleted.', tone: 'error' })
    } finally {
      setIsSaving(false)
    }
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

  if (calendarOnly) {
    return (
      <div className="space-y-5">
        <section className="rounded-lg border border-[#d7e5dc] bg-white px-5 py-5 shadow-sm shadow-[#101828]/5 sm:px-6">
          <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
            <div className="min-w-0">
              <p className={eyebrowClass}>Calendar</p>
              <h1 className="mt-2 text-2xl font-black tracking-tight text-[#101828] sm:text-3xl">
                Football calendar
              </h1>
              <p className="mt-2 max-w-3xl text-sm font-semibold leading-6 text-[#4b5f55]">
                Plan training, fixtures, parent cut offs, and club events without opening the sessions workflow.
              </p>
            </div>

            <button
              type="button"
              onClick={() => handleCalendarDateClick(new Date().toISOString().slice(0, 10))}
              className={primaryButtonClass}
            >
              Add event
            </button>
          </div>
        </section>

        {errorMessage ? <NoticeBanner title="Calendar action not completed" message={errorMessage} /> : null}

        <FootballCalendar
          cursor={calendarCursor}
          events={calendarEvents}
          isLoading={isLoading}
          onCursorChange={setCalendarCursor}
          onOpenEvent={handleCalendarEventOpen}
          onViewChange={setCalendarView}
          view={calendarView}
        />

        <CalendarEventModal
          event={calendarModal?.event}
          form={calendarForm}
          isBusy={isSaving}
          isOpen={Boolean(calendarModal)}
          mode={calendarModal?.mode || 'create'}
          onCancel={() => setCalendarModal(null)}
          onChange={handleCalendarFormChange}
          onDelete={handleCalendarDelete}
          onEdit={() => setCalendarModal((current) => ({ ...current, mode: 'edit' }))}
          onOpenWorkflow={() => {
            const href = calendarModal?.event?.href
            setCalendarModal(null)
            navigate(href || '/sessions')
          }}
          onSubmit={handleCalendarSave}
          teams={teams}
          user={user}
        />
      </div>
    )
  }

  return (
    <div className="space-y-5">
      <section className="rounded-lg border border-[#d7e5dc] bg-white px-5 py-5 shadow-sm shadow-[#101828]/5 sm:px-6">
        <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
          <div className="min-w-0">
            <p className={eyebrowClass}>Sessions</p>
            <h1 className="mt-2 text-2xl font-black tracking-tight text-[#101828] sm:text-3xl">
              Training and match sessions
            </h1>
            <p className="mt-2 max-w-3xl text-sm font-semibold leading-6 text-[#4b5f55]">
              Create a block, add players, then record coach notes against the right session.
            </p>
          </div>

          <div className="grid gap-2 sm:grid-cols-2 lg:min-w-[22rem]">
            <button
              type="button"
              onClick={() => setIsCreateSessionModalOpen(true)}
              className={primaryButtonClass}
            >
              Create session
            </button>
            <button
              type="button"
              onClick={handleCurrentSessionFocus}
              disabled={!selectedSession}
              className={secondaryButtonClass}
            >
              Open selected
            </button>
          </div>
        </div>
      </section>

      {errorMessage ? <NoticeBanner title="Session action not completed" message={errorMessage} /> : null}

      <FootballCalendar
        cursor={calendarCursor}
        events={calendarEvents}
        isLoading={isLoading}
        onCursorChange={setCalendarCursor}
        onOpenEvent={handleCalendarEventOpen}
        onViewChange={setCalendarView}
        view={calendarView}
      />

      <section className="grid gap-3 md:grid-cols-4">
        <SessionSummaryCard isLoading={isLoading} label="Sessions" value={combinedSessions.length} caption="Saved training and match blocks." />
        <SessionSummaryCard isLoading={isLoading} label="Open" value={openSessionCount} caption="Sessions still available to work." />
        <SessionSummaryCard isLoading={isSessionPlayersLoading} label="In queue" value={sessionPlayers.length} caption="Players attached to the selected session." />
        <SessionSummaryCard isLoading={isSessionPlayersLoading} label="Remaining" value={unassessedPlayerQueue.length} caption="Player records still to complete." />
      </section>

      {requestedSessionMissing ? (
        <div className="rounded-lg border border-[#fedf89] bg-[#fffaeb] px-4 py-4 text-sm text-[#101828] shadow-sm shadow-[#101828]/5">
          <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <div>
              <p className="font-black">Session link could not be opened</p>
              <p className="mt-1 font-semibold leading-6 text-[#4b5f55]">
                The session in this link was not found, so the current available session is shown instead.
              </p>
            </div>
            <button
              type="button"
              onClick={clearRequestedSession}
              className="inline-flex min-h-11 items-center justify-center rounded-lg border border-[#fedf89] bg-white px-4 py-3 text-sm font-black text-[#101828] transition hover:bg-[#fffaeb]"
            >
              Clear session link
            </button>
          </div>
        </div>
      ) : null}

      {completedSessionId ? (
        <div className="rounded-lg border border-[#bbf7d0] bg-[#ecfdf5] px-4 py-4 text-sm text-[#101828] shadow-sm shadow-[#065f46]/10">
          <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <div>
              <p className="font-black">Session development records completed</p>
              <p className="mt-1 font-semibold text-[#4b5f55]">
                {completedCount > 0 ? `${completedCount} player development records were completed.` : 'All queued development records were completed.'}
              </p>
            </div>
            <button
              type="button"
              onClick={() => setSearchParams({})}
              className="inline-flex min-h-11 items-center justify-center rounded-lg border border-[#bbf7d0] bg-white px-4 py-3 text-sm font-black text-[#101828] transition hover:bg-[#ecfdf5]"
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
        onOpenCreateSession={() => setIsCreateSessionModalOpen(true)}
        onOpenSessionSetup={handleSessionSetupFocus}
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
        className="rounded-lg border border-[#d7e5dc] bg-white p-3 shadow-sm shadow-[#101828]/5 sm:p-4"
      >
        <summary className="flex min-h-12 cursor-pointer list-none flex-col justify-center gap-1 rounded-lg px-2 text-base font-black text-[#101828] sm:flex-row sm:items-center sm:justify-between">
          Session setup
          <span className="text-sm font-bold text-[#4b5f55]">Create sessions, switch context, add players</span>
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
      <CreateSessionModal
        form={sessionForm}
        isLoading={isLoading}
        isOpen={isCreateSessionModalOpen}
        isSaving={isSaving}
        onCancel={() => setIsCreateSessionModalOpen(false)}
        onChange={handleSessionFormChange}
        onSubmit={handleCreateSessionFromModal}
        teams={teams}
      />
      <CalendarEventModal
        event={calendarModal?.event}
        form={calendarForm}
        isBusy={isSaving}
        isOpen={Boolean(calendarModal)}
        mode={calendarModal?.mode || 'create'}
        onCancel={() => setCalendarModal(null)}
        onChange={handleCalendarFormChange}
        onDelete={handleCalendarDelete}
        onEdit={() => setCalendarModal((current) => ({ ...current, mode: 'edit' }))}
        onOpenWorkflow={() => {
          const href = calendarModal?.event?.href
          setCalendarModal(null)
          navigate(href || '/sessions')
        }}
        onSubmit={handleCalendarSave}
        teams={teams}
        user={user}
      />
    </div>
  )
}

function CalendarEventModal({
  event,
  form,
  isBusy,
  isOpen,
  mode,
  onCancel,
  onChange,
  onDelete,
  onEdit,
  onOpenWorkflow,
  onSubmit,
  teams,
  user,
}) {
  if (!isOpen) {
    return null
  }

  const isEditing = mode !== 'view'
  const editableSource = !event || event.editable || ['session', 'match-day', 'calendar'].includes(event.sourceType)
  const isCalendarEvent = !event || event.sourceType === 'calendar'
  const showOpponent = form.eventType === 'match'
  const showRecurrence = isCalendarEvent && !['training', 'match'].includes(form.eventType)
  const title = mode === 'create' ? 'Add calendar event' : mode === 'edit' ? 'Edit calendar event' : 'Calendar event'
  const selectedSummary = [form.date, form.startTime, form.location].filter(Boolean).join(', ')
  const canUseClubLevel = canCreateClubCalendarEvent(user)

  return (
    <div className="fixed inset-0 z-[80] flex items-center justify-center overflow-y-auto bg-[#101828]/45 px-4 py-6">
      <div
        role="dialog"
        aria-modal="true"
        className="relative max-h-[calc(100vh-2rem)] w-full max-w-3xl overflow-y-auto rounded-lg border border-[#d7e5dc] bg-white p-5 shadow-xl shadow-[#047857]/15 sm:p-6"
      >
        <button
          type="button"
          onClick={onCancel}
          disabled={isBusy}
          className="absolute right-4 top-4 inline-flex h-9 w-9 items-center justify-center rounded-lg border border-[#d7e5dc] bg-[#ecfdf5] text-sm font-black text-[#101828] transition hover:border-[#0f9f6e] hover:bg-white disabled:cursor-not-allowed disabled:opacity-60"
          aria-label="Close calendar event"
        >
          X
        </button>
        <p className={eyebrowClass}>Calendar</p>
        <h2 className="mt-3 pr-12 text-2xl font-black tracking-tight text-[#101828]">{title}</h2>
        <p className="mt-2 text-sm font-semibold leading-6 text-[#4b5f55]">
          Add, move, edit, or cancel football activity from one place.
        </p>

        {!isEditing ? (
          <div className="mt-5 rounded-lg border border-[#d7e5dc] bg-[#f7faf8] p-4">
            <p className="text-xs font-black uppercase tracking-[0.14em] text-[#047857]">{event?.sourceType || 'event'}</p>
            <h3 className="mt-2 text-xl font-black text-[#101828]">{event?.title || form.title || 'Calendar event'}</h3>
            <p className="mt-2 text-sm font-semibold leading-6 text-[#4b5f55]">
              {selectedSummary || event?.description || 'Calendar activity'}
            </p>
            {form.notes ? <p className="mt-3 text-sm font-semibold leading-6 text-[#4b5f55]">{form.notes}</p> : null}
          </div>
        ) : null}

        {isEditing ? (
          <form onSubmit={onSubmit} className="mt-5 grid gap-4">
            <div className="grid gap-4 md:grid-cols-2">
              <label className="block">
                <span className="mb-2 block text-sm font-black text-[#101828]">Type</span>
                <select
                  name="eventType"
                  value={form.eventType}
                  onChange={onChange}
                  disabled={isBusy || Boolean(event && event.sourceType !== 'calendar')}
                  className={fieldClass}
                >
                  {EVENT_TYPE_OPTIONS.map((option) => (
                    <option key={option.value} value={option.value}>{option.label}</option>
                  ))}
                </select>
              </label>
              <label className="block">
                <span className="mb-2 block text-sm font-black text-[#101828]">Team</span>
                <select name="teamId" value={form.teamId} onChange={onChange} disabled={isBusy} className={fieldClass}>
                  {canUseClubLevel ? <option value="">Club level</option> : null}
                  {teams.map((team) => (
                    <option key={team.id} value={team.id}>{team.name}</option>
                  ))}
                </select>
                {!canUseClubLevel ? (
                  <span className="mt-2 block text-xs font-bold leading-5 text-[#4b5f55]">
                    Team staff can only save events against their assigned team.
                  </span>
                ) : null}
              </label>
            </div>

            <label className="block">
              <span className="mb-2 block text-sm font-black text-[#101828]">Title</span>
              <input
                name="title"
                value={form.title}
                onChange={onChange}
                placeholder={form.eventType === 'training' ? 'Example: U12 training' : 'Example: Parent response deadline'}
                className={fieldClass}
              />
            </label>

            {showOpponent ? (
              <label className="block">
                <span className="mb-2 block text-sm font-black text-[#101828]">Opponent</span>
                <input name="opponent" value={form.opponent} onChange={onChange} placeholder="Example: Riverside Juniors" className={fieldClass} />
              </label>
            ) : null}

            <div className="grid gap-4 md:grid-cols-3">
              <label className="block">
                <span className="mb-2 block text-sm font-black text-[#101828]">Date</span>
                <input name="date" type="date" value={form.date} onChange={onChange} required className={fieldClass} />
              </label>
              <label className="block">
                <span className="mb-2 block text-sm font-black text-[#101828]">Start time</span>
                <input name="startTime" type="time" value={form.startTime} onChange={onChange} required className={fieldClass} />
              </label>
              <label className="block">
                <span className="mb-2 block text-sm font-black text-[#101828]">End time</span>
                <input name="endTime" type="time" value={form.endTime} onChange={onChange} className={fieldClass} />
              </label>
            </div>

            <label className="block">
              <span className="mb-2 block text-sm font-black text-[#101828]">Location</span>
              <input name="location" value={form.location} onChange={onChange} placeholder="Pitch, venue, or meeting point" className={fieldClass} />
            </label>

            <label className="block">
              <span className="mb-2 block text-sm font-black text-[#101828]">Notes</span>
              <textarea name="notes" value={form.notes} onChange={onChange} rows={4} className={fieldClass} />
            </label>

            {showRecurrence ? (
              <div className="grid gap-4 rounded-lg border border-[#d7e5dc] bg-[#f7faf8] p-4 md:grid-cols-2">
                <label className="block">
                  <span className="mb-2 block text-sm font-black text-[#101828]">Repeats</span>
                  <select name="recurrenceFrequency" value={form.recurrenceFrequency} onChange={onChange} className={fieldClass}>
                    {RECURRENCE_OPTIONS.map((option) => (
                      <option key={option.value} value={option.value}>{option.label}</option>
                    ))}
                  </select>
                </label>
                <label className="block">
                  <span className="mb-2 block text-sm font-black text-[#101828]">Repeat until</span>
                  <input
                    name="recurrenceUntil"
                    type="date"
                    value={form.recurrenceUntil}
                    onChange={onChange}
                    disabled={form.recurrenceFrequency === 'none'}
                    className={fieldClass}
                  />
                </label>
              </div>
            ) : null}

            <div className="flex flex-col gap-3 border-t border-[#d7e5dc] pt-4 sm:flex-row sm:items-center sm:justify-between">
              <div>
                {event?.href ? <button type="button" onClick={onOpenWorkflow} className={secondaryButtonClass}>Open workflow</button> : null}
              </div>
              <div className="flex flex-col gap-3 sm:flex-row sm:justify-end">
                {event && editableSource ? (
                  <button
                    type="button"
                    onClick={onDelete}
                    disabled={isBusy}
                    className="inline-flex min-h-11 items-center justify-center rounded-lg border border-red-200 bg-red-50 px-5 py-3 text-sm font-black text-red-700 transition hover:bg-red-100 disabled:cursor-not-allowed disabled:opacity-60"
                  >
                    {event.sourceType === 'match-day' ? 'Cancel fixture' : 'Delete'}
                  </button>
                ) : null}
                <button type="button" onClick={onCancel} disabled={isBusy} className={secondaryButtonClass}>Cancel</button>
                <button type="submit" disabled={isBusy} className={primaryButtonClass}>{isBusy ? 'Saving...' : 'Save event'}</button>
              </div>
            </div>
          </form>
        ) : (
          <div className="mt-6 flex flex-col gap-3 sm:flex-row sm:justify-end">
            {event?.href ? <button type="button" onClick={onOpenWorkflow} className={secondaryButtonClass}>Open workflow</button> : null}
            {editableSource ? <button type="button" onClick={onEdit} className={primaryButtonClass}>Edit or move</button> : null}
            <button type="button" onClick={onCancel} className={secondaryButtonClass}>Close</button>
          </div>
        )}
      </div>
    </div>
  )
}

function CreateSessionModal({
  form,
  isLoading,
  isOpen,
  isSaving,
  onCancel,
  onChange,
  onSubmit,
  teams,
}) {
  if (!isOpen) {
    return null
  }

  return (
    <div className="fixed inset-0 z-[80] flex items-center justify-center overflow-y-auto bg-[#101828]/45 px-4 py-6">
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="create-session-modal-title"
        className="max-h-[calc(100vh-2rem)] w-full max-w-3xl overflow-y-auto rounded-lg border border-[#d7e5dc] bg-white shadow-xl shadow-[#047857]/15"
      >
        <div className="flex items-start justify-between gap-4 border-b border-[#d7e5dc] bg-[#f7faf8] px-5 py-5 sm:px-6">
          <div className="min-w-0">
            <p className={eyebrowClass}>Session setup</p>
            <h2 id="create-session-modal-title" className="mt-2 text-2xl font-black tracking-tight text-[#101828]">
              Create session
            </h2>
            <p className={`mt-2 max-w-2xl ${bodyTextClass}`}>
              Create one training or match block before adding the player queue.
            </p>
          </div>
          <button
            type="button"
            onClick={onCancel}
            disabled={isSaving}
            title={isSaving ? 'Please wait while this session is saving.' : 'Close this window'}
            aria-label="Close this window"
            className="inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-lg border border-[#d7e5dc] bg-white text-sm font-black text-[#101828] transition hover:border-[#0f9f6e] hover:bg-[#ecfdf5] disabled:cursor-not-allowed disabled:opacity-60"
          >
            X
          </button>
        </div>
        <div className="px-5 py-5 sm:px-6">
          <CreateSessionSection
            form={form}
            isLoading={isLoading}
            isSaving={isSaving}
            onChange={onChange}
            onSubmit={onSubmit}
            teams={teams}
          />
        </div>
      </div>
    </div>
  )
}

function MatchdayFocus({
  assessedPlayerCount,
  isLoading,
  onAssessAll,
  onOpenCreateSession,
  onOpenSessionSetup,
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

  return (
    <section className="rounded-lg border border-[#d7e5dc] bg-white p-5 shadow-sm shadow-[#101828]/5 sm:p-6">
      <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_auto] lg:items-center">
        <div className="min-w-0">
          <p className={eyebrowClass}>
            Live session
          </p>
          <h3 className="mt-2 break-words text-3xl font-black tracking-tight text-[#101828] sm:text-4xl">
            {selectedSession?.title || selectedSession?.team || 'Get the next session ready'}
          </h3>
          <div className="mt-3 flex flex-wrap gap-2 text-sm font-semibold">
            <span className="rounded-lg border border-[#d7e5dc] bg-[#f7faf8] px-3 py-1 text-[#101828]">
              {progressLabel}
            </span>
            {selectedSessionCompleted ? (
              <span className="rounded-lg border border-[#bbf7d0] bg-[#ecfdf5] px-3 py-1 text-[#065f46]">Completed</span>
            ) : (
              <span className="rounded-lg border border-[#bbf7d0] bg-[#dcfce7] px-3 py-1 text-[#166534]">Open</span>
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
              onClick={hasSession ? onOpenSessionSetup : onOpenCreateSession}
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
              onClick={onOpenSessionSetup}
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
    <div className="rounded-lg border border-[#bbf7d0] bg-white px-3 py-3 shadow-sm shadow-[#065f46]/10">
      <p className="text-[11px] font-black uppercase tracking-[0.14em] text-[#065f46]">{label}</p>
      <p className="mt-2 text-2xl font-black text-[#101828]">{isLoading ? '...' : value}</p>
    </div>
  )
}

function SessionSummaryCard({ caption, isLoading, label, value }) {
  return (
    <article className="rounded-lg border border-[#d7e5dc] bg-white p-5 shadow-sm shadow-[#101828]/5">
      <p className={eyebrowClass}>{label}</p>
      <p className="mt-3 text-4xl font-black tracking-tight text-[#101828]">{isLoading ? '...' : value}</p>
      <p className={`mt-2 ${bodyTextClass}`}>{caption}</p>
    </article>
  )
}
