import { useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { canCreateEvaluation, canViewBilling, getWorkspaceHomeCopy, isClubAdmin, useAuth } from '../lib/auth.js'
import {
  assignPlayerStaffNote,
  deletePlayerStaffNote,
  getAssessmentSessionPlayers,
  getAssessmentSessions,
  getCalendarEvents,
  getClubUserInvites,
  getEvaluations,
  getMatchDays,
  getPlayers,
  getTeams,
  getVisibleClubUsers,
  getUnassignedStaffVoiceNotes,
  readViewCache,
  withRequestTimeout,
  writeViewCache,
} from '../lib/supabase.js'
import {
  getManagerHomeNextUp,
  getManagerHomeNextUpContext,
  getManagerHomeNextUpHref,
} from '../lib/manager-home-next-up.js'
import {
  getCompletedPlayerNamesFromEvaluations,
  normalizeProgressName,
} from '../lib/session-page-utils.js'
import { isRecoveryPathVisible } from '../lib/recovery-phase.js'

const surfaceClass = 'overflow-hidden rounded-xl border border-[var(--border-color)] bg-[var(--panel-bg)] shadow-sm shadow-black/10'
const sectionHeaderClass = 'border-b border-[var(--border-color)] bg-[var(--panel-alt)] px-5 py-5 sm:px-6'
const eyebrowClass = 'text-xs font-black uppercase tracking-[0.18em] text-[var(--text-secondary)]'
const bodyTextClass = 'text-sm font-semibold leading-6 text-[var(--text-muted)]'
const primaryButtonClass = 'inline-flex min-h-11 items-center justify-center rounded-lg bg-[var(--button-primary)] px-4 py-3 text-sm font-black text-[var(--button-primary-text)] shadow-sm shadow-black/10 transition hover:bg-[var(--button-primary-hover)] focus:outline-none focus:ring-2 focus:ring-[var(--focus-ring)] focus:ring-offset-2 focus:ring-offset-[var(--panel-bg)]'
const secondaryButtonClass = 'inline-flex min-h-11 items-center justify-center rounded-lg border border-[var(--border-color)] bg-[var(--panel-alt)] px-4 py-3 text-sm font-black text-[var(--text-primary)] transition hover:border-[var(--accent)] hover:bg-[var(--sidebar-active-bg)] focus:outline-none focus:ring-2 focus:ring-[var(--focus-ring)] focus:ring-offset-2 focus:ring-offset-[var(--panel-bg)]'
const COACH_MODE_STORAGE_KEY = 'football-player:coach-mode'
const COACH_MODE_CHANGED_EVENT = 'football-player:coach-mode-changed'

function getStoredCoachModePreference() {
  if (typeof window === 'undefined') {
    return false
  }

  return window.localStorage.getItem(COACH_MODE_STORAGE_KEY) === 'coach'
}

function saveCoachModePreference(isCoachMode) {
  if (typeof window === 'undefined') {
    return
  }

  window.localStorage.setItem(COACH_MODE_STORAGE_KEY, isCoachMode ? 'coach' : 'full')
  window.dispatchEvent(new CustomEvent(COACH_MODE_CHANGED_EVENT))
}

function CoachModeToggle({ isCoachMode, onChange }) {
  return (
    <div
      className="grid w-full grid-cols-2 gap-1 rounded-lg border border-[var(--border-color)] bg-[var(--panel-alt)] p-1"
      aria-label="Coach mode display"
    >
      {[
        { label: 'Coach Mode', value: true },
        { label: 'Full Mode', value: false },
      ].map((option) => (
        <button
          key={option.label}
          type="button"
          onClick={() => onChange(option.value)}
          aria-pressed={isCoachMode === option.value}
          className={`min-h-10 w-full min-w-0 rounded-md px-3 py-2 text-center text-sm font-black transition ${
            isCoachMode === option.value
              ? 'bg-[var(--button-primary)] text-[var(--button-primary-text)] shadow-sm shadow-black/10'
              : 'bg-transparent text-[var(--text-muted)] hover:bg-[var(--sidebar-active-bg)] hover:text-[var(--text-primary)]'
          }`}
        >
          {option.label}
        </button>
      ))}
    </div>
  )
}

function getActiveSession(sessions) {
  const openSessions = sessions.filter((session) => session.status !== 'completed')

  const sortByDate = (items) => [...items].sort((left, right) => {
    const leftTime = new Date(left.sessionDate || left.createdAt || 0).getTime()
    const rightTime = new Date(right.sessionDate || right.createdAt || 0).getTime()
    return leftTime - rightTime
  })

  return sortByDate(openSessions)[0] || sortByDate(sessions)[0] || null
}

function getRecentEvaluations(evaluations) {
  return [...evaluations]
    .sort((left, right) => Number(right.createdAt ?? 0) - Number(left.createdAt ?? 0))
    .slice(0, 3)
}

function getEvaluationSummary(evaluation) {
  const candidates = [
    evaluation?.overallComments,
    evaluation?.comments,
    evaluation?.responses?.['Overall Comments'],
    evaluation?.responses?.overall,
    evaluation?.strengths,
  ]
  const textValue = candidates.find((value) => typeof value === 'string' && value.trim())

  if (textValue) {
    return textValue
  }

  const responseObject = candidates.find((value) => value && typeof value === 'object')
  if (responseObject) {
    return Object.values(responseObject)
      .filter((value) => typeof value === 'string' && value.trim())
      .join(' ')
      .trim() || 'No summary added yet.'
  }

  return 'No summary added yet.'
}

function getEvaluationContextLabel(evaluation, user) {
  return `Team: ${evaluation.team || user?.activeTeamName || 'Team not set'}, Score: ${evaluation.averageScore ?? 'Not scored'}`
}

function formatVoiceNoteDate(value) {
  const date = new Date(value)

  if (!value || !Number.isFinite(date.getTime())) {
    return 'Recently saved'
  }

  return new Intl.DateTimeFormat('en-GB', {
    day: '2-digit',
    month: 'short',
    hour: '2-digit',
    minute: '2-digit',
  }).format(date)
}

function formatVoiceNoteDuration(seconds) {
  const value = Math.max(0, Number(seconds) || 0)
  const minutes = Math.floor(value / 60)
  const remainder = String(value % 60).padStart(2, '0')
  return `${minutes}:${remainder}`
}

function getCoachGreeting(user) {
  const hour = new Date().getHours()
  const greeting = hour >= 5 && hour < 12
    ? 'Good morning'
    : hour >= 12 && hour < 18
      ? 'Good afternoon'
      : 'Good evening'
  const displayName = String(user?.displayName || user?.username || user?.name || '').trim()
  const firstName = displayName.split(/\s+/)[0] || ''

  return firstName ? `${greeting}, ${firstName}.` : `${greeting}.`
}

function getPlanSummary(user) {
  const planName = String(user?.planLabel || user?.planKey || 'Plan').replace(/_/g, ' ')
  const status = String(user?.planStatus || 'active').replace(/_/g, ' ')
  return `${planName}, ${status}`
}

function ClubAdminHomeView({
  errorMessage,
  isLoading,
  pendingInvites,
  players,
  staffUsers,
  teams,
  user,
}) {
  const homeCopy = getWorkspaceHomeCopy(user)
  const greeting = getCoachGreeting(user)
  const [isCoachMode, setIsCoachMode] = useState(getStoredCoachModePreference)
  const adminActions = [
    {
      label: 'Manage teams',
      description: 'Create teams, rename age groups, and check Coach allocations.',
      path: '/teams',
    },
    {
      label: 'Coach Access',
      description: 'Invite Coaches, review roles, and remove pending access.',
      path: '/user-access',
    },
    {
      label: 'Club Profile',
      description: 'Update shared club details, contact information, and identity.',
      path: '/club-settings',
    },
    {
      label: 'Branding and settings',
      description: 'Set display mode, club accent colour, and button style.',
      path: '/user-settings',
    },
    canViewBilling(user) ? {
      label: 'Plan and billing',
      description: 'Review the club plan, limits, and access status.',
      path: '/billing',
    } : null,
  ].filter(Boolean)
  const metricItems = [
    { label: 'Teams', value: teams.length },
    { label: 'Coaches', value: staffUsers.length },
    { label: 'Players', value: players.length },
    { label: 'Pending invites', value: pendingInvites.length },
    { label: 'Plan', value: getPlanSummary(user) },
  ]

  return (
    <div data-testid="manager-home" className="manager-home-theme space-y-5">
      <section
        data-testid="manager-home-header"
        className="rounded-xl bg-[var(--shell-card)] px-5 py-5 shadow-sm shadow-black/10 sm:px-6 lg:flex lg:items-center lg:justify-between lg:gap-8 lg:px-8"
      >
          <div className="min-w-0">
            <p className={eyebrowClass}>{homeCopy.title}</p>
            <h1 className="mt-2 max-w-4xl text-3xl font-black tracking-tight text-[var(--text-primary)] sm:text-4xl">
              {greeting}
            </h1>
            <p className="mt-2 max-w-3xl text-sm font-semibold leading-6 text-[var(--text-muted)] sm:text-base">
              {homeCopy.description}
            </p>
          </div>
          <aside className="mt-5 w-full max-w-md lg:mt-0 lg:shrink-0">
            <div className="mb-3 flex min-w-0 items-center justify-between gap-4">
              <div className="min-w-0">
                <p className="text-[11px] font-black uppercase tracking-[0.16em] text-[var(--text-secondary)]">Club workspace</p>
                <p className="mt-1 truncate text-sm font-black text-[var(--text-primary)]">
                  {user?.clubName || 'Your club'}
                </p>
              </div>
              <p className="shrink-0 text-xs font-semibold text-[var(--text-muted)]">Club Admin</p>
            </div>
              <CoachModeToggle
                isCoachMode={isCoachMode}
                onChange={(value) => {
                  setIsCoachMode(value)
                  saveCoachModePreference(value)
                }}
              />
          </aside>
      </section>

      {errorMessage ? (
        <div className="rounded-lg border border-[#fedf89] bg-[#fffaeb] px-4 py-3 text-sm font-bold text-[#93370d] shadow-sm">
          {errorMessage}
        </div>
      ) : null}

      {!isCoachMode ? <section data-testid="manager-home-club-metrics" className={surfaceClass}>
        <div className={sectionHeaderClass}>
          <p className={eyebrowClass}>Club overview</p>
          <h2 className="mt-2 text-2xl font-black tracking-tight text-[var(--text-primary)]">
            {isLoading ? 'Loading club workspace' : 'Your club at a glance'}
          </h2>
          <p className={`mt-2 ${bodyTextClass}`}>
            Review the shared club setup before moving into a specific team.
          </p>
        </div>
        <div className="grid divide-y divide-[var(--border-color)] md:grid-cols-5 md:divide-x md:divide-y-0">
          {metricItems.map((item) => (
            <div key={item.label} className="px-5 py-4 sm:px-6">
              <p className="text-xs font-black uppercase tracking-[0.14em] text-[var(--text-muted)]">{item.label}</p>
              <p className="mt-2 text-2xl font-black text-[var(--text-primary)]">{item.value}</p>
            </div>
          ))}
        </div>
      </section> : null}

      {!isCoachMode ? <section className={surfaceClass}>
        <div className={sectionHeaderClass}>
          <p className={eyebrowClass}>Admin actions</p>
          <h2 className="mt-2 text-2xl font-black tracking-tight text-[var(--text-primary)]">Club setup tools</h2>
          <p className={`mt-2 ${bodyTextClass}`}>
            Use these controls for club-wide setup. Select a team when you need team operations.
          </p>
        </div>
        <div className="grid gap-2 px-5 py-5 sm:px-6 md:grid-cols-2">
          {adminActions.map((action) => (
            <Link
              key={`${action.path}:${action.label}`}
              to={action.path}
              className="flex min-h-14 items-center justify-between gap-4 rounded-lg px-3 py-3 transition hover:bg-[var(--sidebar-active-bg)] focus:outline-none focus:ring-2 focus:ring-[var(--focus-ring)]"
            >
              <span className="min-w-0">
                <span className="block text-sm font-black text-[var(--text-primary)]">{action.label}</span>
                <span className="mt-1 block text-xs font-semibold leading-5 text-[var(--text-muted)]">{action.description}</span>
              </span>
              <span aria-hidden="true" className="shrink-0 text-xs font-black uppercase tracking-[0.14em] text-[var(--text-secondary)]">Open</span>
            </Link>
          ))}
        </div>
      </section> : null}
    </div>
  )
}

export function CoachHomePage() {
  const { user } = useAuth()
  const activeTeamScope = user?.activeTeamId || user?.activeTeamName || 'assigned'
  const cacheKey = user?.clubId ? `coach-home:${user.clubId}:${user.id}:${user.roleRank}:${activeTeamScope}` : ''
  const cachedValue = useMemo(() => readViewCache(cacheKey), [cacheKey])
  const [sessions, setSessions] = useState(() => cachedValue?.sessions || [])
  const [calendarEvents, setCalendarEvents] = useState(() => cachedValue?.calendarEvents || [])
  const [matchDays, setMatchDays] = useState(() => cachedValue?.matchDays || [])
  const [players, setPlayers] = useState(() => cachedValue?.players || [])
  const [clubTeams, setClubTeams] = useState(() => cachedValue?.clubTeams || [])
  const [clubStaffUsers, setClubStaffUsers] = useState(() => cachedValue?.clubStaffUsers || [])
  const [pendingInvites, setPendingInvites] = useState(() => cachedValue?.pendingInvites || [])
  const [evaluations, setEvaluations] = useState(() => cachedValue?.evaluations || [])
  const [sessionPlayers, setSessionPlayers] = useState(() => cachedValue?.sessionPlayers || [])
  const [unassignedVoiceNotes, setUnassignedVoiceNotes] = useState(() => cachedValue?.unassignedVoiceNotes || [])
  const [voiceNotePickerNote, setVoiceNotePickerNote] = useState(null)
  const [voiceNotePickerSearch, setVoiceNotePickerSearch] = useState('')
  const [voiceNotePickerPlayers, setVoiceNotePickerPlayers] = useState([])
  const [voiceNotePickerError, setVoiceNotePickerError] = useState('')
  const [voiceNotePanelMessage, setVoiceNotePanelMessage] = useState('')
  const [isVoiceNotePickerLoading, setIsVoiceNotePickerLoading] = useState(false)
  const [isVoiceNoteAssigning, setIsVoiceNoteAssigning] = useState(false)
  const [deletingVoiceNoteId, setDeletingVoiceNoteId] = useState('')
  const [isLoading, setIsLoading] = useState(() => sessions.length === 0 && players.length === 0)
  const [errorMessage, setErrorMessage] = useState('')
  const [isCoachMode, setIsCoachMode] = useState(getStoredCoachModePreference)
  const isClubWideAdminHome = isClubAdmin(user) && !user?.activeTeamId
  const activeSession = useMemo(() => getActiveSession(sessions), [sessions])
  const nextUpEvent = useMemo(() => getManagerHomeNextUp({
    calendarEvents,
    matchDays,
    activeTeamId: user?.activeTeamId,
  }), [calendarEvents, matchDays, user?.activeTeamId])
  const greeting = getCoachGreeting(user)
  const homeCopy = getWorkspaceHomeCopy(user)
  const recentEvaluations = useMemo(() => getRecentEvaluations(evaluations), [evaluations])
  const completedNames = useMemo(
    () => getCompletedPlayerNamesFromEvaluations(evaluations, activeSession, sessionPlayers),
    [activeSession, evaluations, sessionPlayers],
  )
  const completedNameSet = useMemo(() => new Set(completedNames), [completedNames])
  const unassessedPlayers = useMemo(
    () => sessionPlayers.filter((player) => !completedNameSet.has(normalizeProgressName(player.playerName))),
    [completedNameSet, sessionPlayers],
  )
  const visiblePlayers = players.length > 0 ? players : sessionPlayers
  const trialPlayerCount = visiblePlayers.filter((player) => player.section === 'Trial').length
  const canUseCoachActions = canCreateEvaluation(user)
  const secondaryActions = useMemo(() => [
    {
      label: 'View squad',
      description: 'Open player records for this team.',
      path: '/players/current',
    },
    {
      label: 'Add player note',
      description: 'Record a short coach observation.',
      path: '/assess-player/new?choosePlayer=1',
    },
    {
      label: 'Add assessment',
      description: 'Create a structured development record.',
      path: '/assess-player/new?choosePlayer=1',
    },
    {
      label: 'Open calendar',
      description: 'Check sessions, matches, and club events.',
      path: '/calendar',
    },
  ].filter((action) => canUseCoachActions && isRecoveryPathVisible(action.path, { user })), [canUseCoachActions, user])
  const snapshotItems = [
    { label: 'Players', value: visiblePlayers.length },
    { label: 'Trial players', value: trialPlayerCount },
    { label: 'Waiting notes', value: unassessedPlayers.length },
    { label: 'Recorded', value: completedNames.length },
  ]
  const filteredVoiceNotePlayers = useMemo(() => {
    const searchValue = voiceNotePickerSearch.trim().toLowerCase()

    return voiceNotePickerPlayers.filter((player) => {
      if (!searchValue) {
        return true
      }

      return [player.playerName, player.section, player.team]
        .filter(Boolean)
        .some((value) => String(value).toLowerCase().includes(searchValue))
    })
  }, [voiceNotePickerPlayers, voiceNotePickerSearch])

  const openVoiceNoteAssignment = async (note) => {
    setVoiceNotePickerNote(note)
    setVoiceNotePickerSearch('')
    setVoiceNotePickerError('')
    setVoiceNotePanelMessage('')
    setIsVoiceNotePickerLoading(true)

    try {
      const nextPlayers = await getPlayers({ user })
      setVoiceNotePickerPlayers(nextPlayers)
    } catch (error) {
      console.error(error)
      setVoiceNotePickerError('Players could not be loaded. Please try again.')
    } finally {
      setIsVoiceNotePickerLoading(false)
    }
  }

  const closeVoiceNoteAssignment = () => {
    setVoiceNotePickerNote(null)
    setVoiceNotePickerSearch('')
    setVoiceNotePickerPlayers([])
    setVoiceNotePickerError('')
    setIsVoiceNoteAssigning(false)
  }

  const assignRecoveredVoiceNote = async (player) => {
    if (!voiceNotePickerNote?.id || !player?.id || isVoiceNoteAssigning) {
      return
    }

    setIsVoiceNoteAssigning(true)
    setVoiceNotePickerError('')

    try {
      await assignPlayerStaffNote({
        user,
        noteId: voiceNotePickerNote.id,
        playerId: player.id,
      })
      setUnassignedVoiceNotes((currentNotes) => {
        const nextNotes = currentNotes.filter((note) => note.id !== voiceNotePickerNote.id)
        writeViewCache(cacheKey, {
          sessions,
          players,
          evaluations,
          sessionPlayers,
          unassignedVoiceNotes: nextNotes,
        })
        return nextNotes
      })
      setVoiceNotePanelMessage(`Voice note assigned to ${player.playerName || 'the selected player'}.`)
      closeVoiceNoteAssignment()
    } catch (error) {
      console.error(error)
      setVoiceNotePickerError('Could not assign the voice note. Please try again.')
    } finally {
      setIsVoiceNoteAssigning(false)
    }
  }

  const deleteRecoveredVoiceNote = async (note) => {
    if (!note?.id || !window.confirm('Delete this voice note?')) {
      return
    }

    setDeletingVoiceNoteId(note.id)
    setErrorMessage('')
    setVoiceNotePanelMessage('')

    try {
      await deletePlayerStaffNote({ noteId: note.id })
      setUnassignedVoiceNotes((currentNotes) => {
        const nextNotes = currentNotes.filter((currentNote) => currentNote.id !== note.id)
        writeViewCache(cacheKey, {
          sessions,
          players,
          evaluations,
          sessionPlayers,
          unassignedVoiceNotes: nextNotes,
        })
        return nextNotes
      })
      setVoiceNotePanelMessage('Voice note deleted.')
    } catch (error) {
      console.error(error)
      setErrorMessage('Could not delete the voice note. Please try again.')
    } finally {
      setDeletingVoiceNoteId('')
    }
  }

  useEffect(() => {
    let isMounted = true

    const loadCoachHome = async () => {
      setErrorMessage('')

      try {
        if (isClubWideAdminHome) {
          const [teamsResult, playersResult, staffResult, invitesResult] = await Promise.allSettled([
            withRequestTimeout(() => getTeams(user), 'Could not load teams.'),
            withRequestTimeout(() => getPlayers({ user }), 'Could not load players.'),
            withRequestTimeout(() => getVisibleClubUsers(user), 'Could not load Coaches.'),
            withRequestTimeout(() => getClubUserInvites(user), 'Could not load pending invites.'),
          ])

          if (!isMounted) {
            return
          }

          const nextTeams = teamsResult.status === 'fulfilled' ? teamsResult.value : cachedValue?.clubTeams || []
          const nextPlayers = playersResult.status === 'fulfilled' ? playersResult.value : cachedValue?.players || []
          const nextStaffUsers = staffResult.status === 'fulfilled' ? staffResult.value : cachedValue?.clubStaffUsers || []
          const nextPendingInvites = invitesResult.status === 'fulfilled' ? invitesResult.value : cachedValue?.pendingInvites || []

          setClubTeams(nextTeams)
          setPlayers(nextPlayers)
          setClubStaffUsers(nextStaffUsers)
          setPendingInvites(nextPendingInvites)
          writeViewCache(cacheKey, {
            clubTeams: nextTeams,
            clubStaffUsers: nextStaffUsers,
            pendingInvites: nextPendingInvites,
            players: nextPlayers,
          })

          if ([teamsResult, playersResult, staffResult, invitesResult].some((result) => result.status === 'rejected')) {
            setErrorMessage('Some club data could not be refreshed. Cached data is shown where available.')
          }
          return
        }

        const [sessionsResult, playersResult, evaluationsResult, voiceNotesResult, calendarEventsResult, matchDaysResult] = await Promise.allSettled([
          withRequestTimeout(() => getAssessmentSessions({ user }), 'Could not load sessions.'),
          withRequestTimeout(() => getPlayers({ user }), 'Could not load players.'),
          withRequestTimeout(() => getEvaluations({ user }), 'Could not load development records.'),
          withRequestTimeout(() => getUnassignedStaffVoiceNotes({ user, limit: 5 }), 'Could not load voice notes.'),
          withRequestTimeout(() => getCalendarEvents({ user }), 'Could not load calendar events.'),
          withRequestTimeout(() => getMatchDays({ user }), 'Could not load fixtures.'),
        ])

        if (!isMounted) {
          return
        }

        const nextSessions = sessionsResult.status === 'fulfilled' ? sessionsResult.value : cachedValue?.sessions || []
        const nextPlayers = playersResult.status === 'fulfilled' ? playersResult.value : cachedValue?.players || []
        const nextEvaluations =
          evaluationsResult.status === 'fulfilled' ? evaluationsResult.value : cachedValue?.evaluations || []
        const nextUnassignedVoiceNotes =
          voiceNotesResult.status === 'fulfilled' ? voiceNotesResult.value : cachedValue?.unassignedVoiceNotes || []
        const nextCalendarEvents =
          calendarEventsResult.status === 'fulfilled' ? calendarEventsResult.value : cachedValue?.calendarEvents || []
        const nextMatchDays = matchDaysResult.status === 'fulfilled' ? matchDaysResult.value : cachedValue?.matchDays || []
        const nextActiveSession = getActiveSession(nextSessions)
        const nextSessionPlayers = nextActiveSession?.id
          ? await withRequestTimeout(
              () => getAssessmentSessionPlayers({ user, sessionId: nextActiveSession.id }),
              'Could not load session players.',
            ).catch((error) => {
              console.error(error)
              return cachedValue?.sessionPlayers || []
            })
          : []

        if (!isMounted) {
          return
        }

        setSessions(nextSessions)
        setPlayers(nextPlayers)
        setEvaluations(nextEvaluations)
        setSessionPlayers(nextSessionPlayers)
        setUnassignedVoiceNotes(nextUnassignedVoiceNotes)
        setCalendarEvents(nextCalendarEvents)
        setMatchDays(nextMatchDays)
        writeViewCache(cacheKey, {
          sessions: nextSessions,
          players: nextPlayers,
          evaluations: nextEvaluations,
          sessionPlayers: nextSessionPlayers,
          unassignedVoiceNotes: nextUnassignedVoiceNotes,
          calendarEvents: nextCalendarEvents,
          matchDays: nextMatchDays,
        })

        if ([sessionsResult, playersResult, evaluationsResult, voiceNotesResult, calendarEventsResult, matchDaysResult].some((result) => result.status === 'rejected')) {
          setErrorMessage('Some coach data could not be refreshed. Cached data is shown where available.')
        }
      } finally {
        if (isMounted) {
          setIsLoading(false)
        }
      }
    }

    if (user) {
      void loadCoachHome()
    }

    return () => {
      isMounted = false
    }
  }, [cacheKey, cachedValue, isClubWideAdminHome, user])

  if (isClubWideAdminHome) {
    return (
      <ClubAdminHomeView
        errorMessage={errorMessage}
        isLoading={isLoading}
        pendingInvites={pendingInvites}
        players={players}
        staffUsers={clubStaffUsers}
        teams={clubTeams}
        user={user}
      />
    )
  }

  return (
    <div data-testid="manager-home" className="manager-home-theme space-y-5">
      <section
        data-testid="manager-home-header"
        className="rounded-xl bg-[var(--shell-card)] px-5 py-5 shadow-sm shadow-black/10 sm:px-6 lg:flex lg:items-center lg:justify-between lg:gap-8 lg:px-8"
      >
          <div className="min-w-0">
            <p className={eyebrowClass}>{homeCopy.title}</p>
            <h1 className="mt-2 max-w-4xl text-3xl font-black tracking-tight text-[var(--text-primary)] sm:text-4xl">
              {greeting}
            </h1>
            <p className="mt-2 max-w-3xl text-sm font-semibold leading-6 text-[var(--text-muted)] sm:text-base">
              {homeCopy.description}
            </p>
          </div>
          <aside className="mt-5 w-full max-w-md lg:mt-0 lg:shrink-0">
            <div className="mb-3 flex min-w-0 items-center justify-between gap-4">
              <div className="min-w-0">
                <p className="text-[11px] font-black uppercase tracking-[0.16em] text-[var(--text-secondary)]">Current team</p>
                <p className="mt-1 truncate text-sm font-black text-[var(--text-primary)]">
                  {user?.activeTeamName || user?.clubName || 'Team not selected'}
                </p>
              </div>
              <p className="shrink-0 text-xs font-semibold text-[var(--text-muted)]">{user?.roleLabel || 'Coach'}</p>
            </div>
              <CoachModeToggle
                isCoachMode={isCoachMode}
                onChange={(value) => {
                  setIsCoachMode(value)
                  saveCoachModePreference(value)
                }}
              />
          </aside>
      </section>

      {errorMessage ? (
        <div className="rounded-lg border border-[#fedf89] bg-[#fffaeb] px-4 py-3 text-sm font-bold text-[#93370d] shadow-sm">
          {errorMessage}
        </div>
      ) : null}

      <section data-testid="manager-home-next-session" className={surfaceClass}>
        <div className={sectionHeaderClass}>
          <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
            <div>
              <p className={eyebrowClass}>Next up</p>
              <h2 className="mt-2 text-2xl font-black tracking-tight text-[var(--text-primary)]">
                {nextUpEvent?.title || (isLoading ? 'Loading next item' : 'No upcoming event scheduled')}
              </h2>
              <p className={`mt-2 ${bodyTextClass}`}>
                {getManagerHomeNextUpContext(nextUpEvent)}
              </p>
            </div>
            <Link
              to={getManagerHomeNextUpHref(nextUpEvent)}
              className={primaryButtonClass}
            >
              {nextUpEvent ? 'Open next event' : 'Add event'}
            </Link>
          </div>
        </div>
      </section>

      {!isCoachMode ? <section data-testid="manager-home-quick-actions" aria-labelledby="manager-home-quick-actions-title" className={surfaceClass}>
        <div className="flex items-center justify-between gap-4 px-5 pt-5 sm:px-6">
          <div>
            <p className={eyebrowClass}>Work shortcuts</p>
            <h2 id="manager-home-quick-actions-title" className="mt-1 text-lg font-black tracking-tight text-[var(--text-primary)]">Quick actions</h2>
          </div>
          <p className="hidden text-xs font-semibold text-[var(--text-muted)] sm:block">Current team</p>
        </div>
        <div className="grid gap-1 px-3 py-3 sm:grid-cols-2 sm:px-4 xl:grid-cols-4">
          {secondaryActions.map((action) => (
            <Link
              key={`${action.path}:${action.label}`}
              to={action.path}
              className="flex min-h-14 items-center justify-between gap-3 rounded-lg px-3 py-3 transition hover:bg-[var(--sidebar-active-bg)] focus:outline-none focus:ring-2 focus:ring-[var(--focus-ring)]"
            >
              <span className="min-w-0">
                <span className="block text-sm font-black text-[var(--text-primary)]">{action.label}</span>
                <span className="mt-1 block truncate text-xs font-semibold text-[var(--text-muted)]">{action.description}</span>
              </span>
              <span aria-hidden="true" className="shrink-0 text-lg font-black text-[var(--text-secondary)]">›</span>
            </Link>
          ))}
        </div>
      </section> : null}

      {!isCoachMode ? <section
        data-testid="manager-home-metrics"
        aria-label="Team metrics"
        className="grid grid-cols-2 overflow-hidden rounded-xl border border-[var(--border-color)] bg-[var(--panel-bg)] divide-x divide-y divide-[var(--border-color)] md:grid-cols-4 md:divide-y-0"
      >
        {snapshotItems.map((item) => (
          <CoachMetric key={item.label} label={item.label} value={item.value} isLoading={isLoading} />
        ))}
      </section> : null}

      {unassignedVoiceNotes.length > 0 || voiceNotePanelMessage ? (
        <section className={surfaceClass}>
          <div className={sectionHeaderClass}>
            <div>
              <p className={eyebrowClass}>Coach voice notes</p>
              <h2 className="mt-2 text-2xl font-black tracking-tight text-[var(--text-primary)]">Unassigned voice notes</h2>
              <p className={`mt-2 ${bodyTextClass}`}>
                Assign saved Coach notes to a player when you are ready.
              </p>
            </div>
          </div>
          {voiceNotePanelMessage ? (
            <div className="mx-5 mt-5 rounded-lg border border-[var(--border-color)] bg-[var(--panel-alt)] px-4 py-3 text-sm font-black text-[var(--text-secondary)] sm:mx-6">
              {voiceNotePanelMessage}
            </div>
          ) : null}
          {unassignedVoiceNotes.length > 0 ? (
            <div className="grid gap-3 px-5 py-5 sm:px-6 lg:grid-cols-2">
              {unassignedVoiceNotes.map((note) => (
              <div key={note.id} className="rounded-lg border border-[var(--border-color)] bg-[var(--panel-alt)] p-4">
                <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
                  <div>
                    <p className="text-sm font-black text-[var(--text-primary)]">{note.note || 'Coach voice note'}</p>
                    <p className="mt-1 text-xs font-bold text-[var(--text-muted)]">
                      {formatVoiceNoteDate(note.createdAt)} | {formatVoiceNoteDuration(note.audioDurationSeconds)}
                    </p>
                  </div>
                  <span className="inline-flex w-fit rounded-full border border-[var(--border-color)] bg-[var(--panel-bg)] px-2.5 py-1 text-xs font-black uppercase tracking-[0.12em] text-[var(--text-secondary)]">
                    Coaches only
                  </span>
                </div>
                {note.audioUrl ? (
                  <audio controls src={note.audioUrl} className="mt-4 w-full" />
                ) : (
                  <p className="mt-4 rounded-lg border border-[var(--border-color)] bg-[var(--panel-bg)] px-3 py-3 text-sm font-bold text-[var(--text-muted)]">
                    Audio preview is unavailable. Try refreshing the page.
                  </p>
                )}
                <div className="mt-4 grid gap-2 sm:grid-cols-2">
                  <button
                    type="button"
                    onClick={() => openVoiceNoteAssignment(note)}
                    className={primaryButtonClass}
                  >
                    Assign to player
                  </button>
                  <button
                    type="button"
                    onClick={() => deleteRecoveredVoiceNote(note)}
                    disabled={deletingVoiceNoteId === note.id}
                    className="inline-flex min-h-11 items-center justify-center rounded-lg border border-[var(--border-color)] bg-[var(--panel-bg)] px-4 py-3 text-sm font-black text-[var(--text-primary)] transition hover:border-[var(--danger-text)] hover:bg-[var(--danger-soft)] disabled:cursor-not-allowed disabled:opacity-60"
                  >
                    {deletingVoiceNoteId === note.id ? 'Deleting...' : 'Delete'}
                  </button>
                </div>
              </div>
              ))}
            </div>
          ) : null}
        </section>
      ) : null}

      {!isCoachMode ? <section data-testid="manager-home-latest-notes" className={surfaceClass}>
        <div className={sectionHeaderClass}>
          <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <div>
              <p className={eyebrowClass}>Development</p>
              <h2 className="mt-2 text-2xl font-black tracking-tight text-[var(--text-primary)]">Latest player notes</h2>
            </div>
            <Link
              to="/assess-player/completed"
              className={secondaryButtonClass}
            >
              View all
            </Link>
          </div>
        </div>
        <div className="divide-y divide-[var(--border-color)]">
          {recentEvaluations.map((evaluation) => (
            <Link
              key={evaluation.id || `${evaluation.playerName}-${evaluation.createdAt}`}
              to={`/player/${encodeURIComponent(evaluation.playerName)}`}
              className="group grid gap-3 px-5 py-4 transition hover:bg-[var(--sidebar-active-bg)] focus:outline-none focus:ring-2 focus:ring-inset focus:ring-[var(--focus-ring)] sm:grid-cols-[minmax(0,0.8fr)_minmax(0,1.4fr)_auto] sm:items-center sm:px-6"
            >
              <span className="min-w-0">
                <span className="block truncate text-sm font-black text-[var(--text-primary)]">{evaluation.playerName}</span>
                <span className="mt-1 block text-xs font-semibold text-[var(--text-muted)]">{getEvaluationContextLabel(evaluation, user)}</span>
              </span>
              <span className="line-clamp-2 text-sm font-semibold leading-6 text-[var(--text-muted)]">
                {getEvaluationSummary(evaluation)}
              </span>
              <span className="inline-flex text-xs font-black uppercase tracking-[0.14em] text-[var(--text-secondary)]">
                Open player profile
              </span>
            </Link>
          ))}
          {!isLoading && recentEvaluations.length === 0 ? (
            <div className="px-5 py-6 text-sm font-bold text-[var(--text-muted)] sm:px-6">
              Coach notes and assessments will appear here after the first session.
            </div>
          ) : null}
        </div>
      </section> : null}

      {voiceNotePickerNote ? (
        <div className="fixed inset-0 z-[80] flex items-end justify-center bg-[#00150b]/70 px-3 py-4 backdrop-blur-sm sm:items-center">
          <div className="max-h-[calc(100vh-2rem)] w-full max-w-xl overflow-y-auto rounded-lg border border-[#d7e5dc] bg-white p-4 shadow-2xl shadow-black/30 sm:p-5">
            <div className="flex items-start justify-between gap-4">
              <div>
                <p className={eyebrowClass}>Assign voice note</p>
                <h2 className="mt-2 text-2xl font-black tracking-tight text-[#101828]">Choose a player</h2>
                <p className={`mt-2 ${bodyTextClass}`}>Squad and trial players from the current team are available.</p>
              </div>
              <button
                type="button"
                onClick={closeVoiceNoteAssignment}
                className="inline-flex min-h-10 min-w-10 items-center justify-center rounded-lg border border-[#d7e5dc] bg-[#f7faf8] text-sm font-black text-[#101828] transition hover:border-[#047857] hover:bg-[#ecfdf5]"
              >
                X
              </button>
            </div>

            <input
              type="search"
              value={voiceNotePickerSearch}
              onChange={(event) => setVoiceNotePickerSearch(event.target.value)}
              placeholder="Search players"
              className="mt-5 min-h-12 w-full rounded-lg border border-[#d7e5dc] bg-white px-3 py-2 text-sm font-bold text-[#101828] outline-none transition placeholder:text-[#6d8076] focus:border-[#047857]"
            />

            {voiceNotePickerError ? (
              <div className="mt-4 rounded-lg border border-[#f4b6b6] bg-[#fff5f5] px-4 py-3 text-sm font-bold text-[#b42318]">
                {voiceNotePickerError}
              </div>
            ) : null}

            <div className="mt-4 grid max-h-80 gap-2 overflow-y-auto pr-1">
              {isVoiceNotePickerLoading ? (
                <p className="rounded-lg border border-[#d7e5dc] bg-[#f7faf8] px-3 py-4 text-sm font-bold text-[#4b5f55]">
                  Loading players...
                </p>
              ) : null}

              {!isVoiceNotePickerLoading && filteredVoiceNotePlayers.map((player) => (
                <button
                  key={player.id}
                  type="button"
                  onClick={() => assignRecoveredVoiceNote(player)}
                  disabled={isVoiceNoteAssigning}
                  className="flex min-h-14 items-center justify-between gap-3 rounded-lg border border-[#d7e5dc] bg-[#f7faf8] px-3 py-2 text-left transition hover:border-[#047857] hover:bg-[#ecfdf5] disabled:cursor-not-allowed disabled:opacity-60"
                >
                  <span>
                    <span className="block text-sm font-black text-[#101828]">{player.playerName}</span>
                    <span className="mt-1 block text-xs font-bold text-[#4b5f55]">{player.section || 'Squad'} | {player.team || user?.activeTeamName || 'Current team'}</span>
                  </span>
                  <span className="text-xs font-black uppercase tracking-[0.12em] text-[#047857]">
                    {isVoiceNoteAssigning ? 'Saving' : 'Assign'}
                  </span>
                </button>
              ))}

              {!isVoiceNotePickerLoading && filteredVoiceNotePlayers.length === 0 ? (
                <p className="rounded-lg border border-[#d7e5dc] bg-[#f7faf8] px-3 py-4 text-sm font-bold text-[#4b5f55]">
                  No players found for this team.
                </p>
              ) : null}
            </div>
          </div>
        </div>
      ) : null}
    </div>
  )
}

function CoachMetric({ actionLabel = 'Open', compact = false, isLoading, label, to, value }) {
  const content = (
    <>
      <span className="text-xs font-black uppercase tracking-[0.16em] text-[var(--text-muted)]">{label}</span>
      <span className={['mt-2 block font-black text-[var(--text-primary)]', compact ? 'text-2xl' : 'text-3xl'].join(' ')}>
        {isLoading ? '...' : value}
      </span>
      {to ? (
        <span className={['inline-flex items-center justify-center rounded-lg bg-[var(--button-primary)] px-3 py-2 text-xs font-black text-[var(--button-primary-text)]', compact ? 'mt-3 min-h-8' : 'mt-4 min-h-9'].join(' ')}>
          {actionLabel}
        </span>
      ) : null}
    </>
  )

  if (to) {
    return (
      <Link
        to={to}
        aria-label={`${actionLabel} ${label.toLowerCase()}`}
        className={['block text-left transition hover:bg-[var(--sidebar-active-bg)] focus:outline-none focus:ring-2 focus:ring-inset focus:ring-[var(--focus-ring)]', compact ? 'px-3 py-3' : 'px-5 py-4 sm:px-6'].join(' ')}
      >
        {content}
      </Link>
    )
  }

  return (
    <div className={compact ? 'px-3 py-3' : 'px-5 py-4 sm:px-6'}>
      {content}
    </div>
  )
}
