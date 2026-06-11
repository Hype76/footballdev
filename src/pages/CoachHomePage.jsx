import { useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { canCreateEvaluation, getWorkspaceHomeCopy, useAuth } from '../lib/auth.js'
import {
  assignPlayerStaffNote,
  deletePlayerStaffNote,
  getAssessmentSessionPlayers,
  getAssessmentSessions,
  getEvaluations,
  getPlayers,
  getUnassignedStaffVoiceNotes,
  readViewCache,
  withRequestTimeout,
  writeViewCache,
} from '../lib/supabase.js'
import {
  formatSessionDate,
  formatSessionType,
  getCompletedPlayerNamesFromEvaluations,
  normalizeProgressName,
} from '../lib/session-page-utils.js'
import { isRecoveryPathVisible } from '../lib/recovery-phase.js'

const surfaceClass = 'overflow-hidden rounded-lg border border-[#d7e5dc] bg-white shadow-sm shadow-[#047857]/10'
const sectionHeaderClass = 'border-b border-[#d7e5dc] bg-[#ecfdf5] px-5 py-5 sm:px-6'
const eyebrowClass = 'text-xs font-black uppercase tracking-[0.18em] text-[#065f46]'
const bodyTextClass = 'text-sm font-semibold leading-6 text-[#4b5f55]'
const primaryButtonClass = 'inline-flex min-h-11 items-center justify-center rounded-lg bg-[#047857] px-4 py-3 text-sm font-black text-white shadow-sm shadow-[#047857]/20 transition hover:bg-[#065f46] focus:outline-none focus:ring-2 focus:ring-[#93c5fd] focus:ring-offset-2 focus:ring-offset-white'
const secondaryButtonClass = 'inline-flex min-h-11 items-center justify-center rounded-lg border border-[#d7e5dc] bg-white px-4 py-3 text-sm font-black text-[#101828] shadow-sm shadow-[#047857]/10 transition hover:border-[#047857] hover:bg-[#ecfdf5] focus:outline-none focus:ring-2 focus:ring-[#93c5fd] focus:ring-offset-2 focus:ring-offset-white'

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

function getSessionContextLabel(session) {
  if (!session) {
    return 'Create or open a session to start coach work.'
  }

  return `Type: ${formatSessionType(session.sessionType)}, Date: ${formatSessionDate(session.sessionDate)}`
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

export function CoachHomePage() {
  const { user } = useAuth()
  const activeTeamScope = user?.activeTeamId || user?.activeTeamName || 'assigned'
  const cacheKey = user?.clubId ? `coach-home:${user.clubId}:${user.id}:${user.roleRank}:${activeTeamScope}` : ''
  const cachedValue = useMemo(() => readViewCache(cacheKey), [cacheKey])
  const [sessions, setSessions] = useState(() => cachedValue?.sessions || [])
  const [players, setPlayers] = useState(() => cachedValue?.players || [])
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
  const activeSession = useMemo(() => getActiveSession(sessions), [sessions])
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
        const [sessionsResult, playersResult, evaluationsResult, voiceNotesResult] = await Promise.allSettled([
          withRequestTimeout(() => getAssessmentSessions({ user }), 'Could not load sessions.'),
          withRequestTimeout(() => getPlayers({ user }), 'Could not load players.'),
          withRequestTimeout(() => getEvaluations({ user }), 'Could not load development records.'),
          withRequestTimeout(() => getUnassignedStaffVoiceNotes({ user, limit: 5 }), 'Could not load voice notes.'),
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
        writeViewCache(cacheKey, {
          sessions: nextSessions,
          players: nextPlayers,
          evaluations: nextEvaluations,
          sessionPlayers: nextSessionPlayers,
          unassignedVoiceNotes: nextUnassignedVoiceNotes,
        })

        if ([sessionsResult, playersResult, evaluationsResult, voiceNotesResult].some((result) => result.status === 'rejected')) {
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
  }, [cacheKey, cachedValue, user])

  return (
    <div className="space-y-5">
      <section className={surfaceClass}>
        <div className="grid gap-0 xl:grid-cols-[minmax(0,1fr)_24rem]">
          <div className="px-5 py-6 sm:px-6 lg:px-8">
            <p className={eyebrowClass}>{homeCopy.title}</p>
            <h1 className="mt-3 max-w-4xl text-3xl font-black tracking-tight text-[#101828] sm:text-4xl">
              {greeting}
            </h1>
            <p className="mt-4 max-w-3xl text-base font-semibold leading-7 text-[#4b5f55]">
              {homeCopy.description}
            </p>
          </div>
          <aside className="border-t border-[#d7e5dc] bg-[#ecfdf5] p-5 sm:p-6 xl:border-l xl:border-t-0">
            <p className="text-xs font-black uppercase tracking-[0.16em] text-[#065f46]">Current team</p>
            <p className="mt-2 text-xl font-black tracking-tight text-[#101828]">
              {user?.activeTeamName || user?.clubName || 'Team not selected'}
            </p>
            <p className="mt-2 text-sm font-semibold leading-6 text-[#4b5f55]">
              {user?.roleLabel || 'Coach'} access for {user?.clubName || 'this club'}.
            </p>
          </aside>
        </div>
      </section>

      {errorMessage ? (
        <div className="rounded-lg border border-[#fedf89] bg-[#fffaeb] px-4 py-3 text-sm font-bold text-[#93370d] shadow-sm">
          {errorMessage}
        </div>
      ) : null}

      <section className={surfaceClass}>
        <div className={sectionHeaderClass}>
          <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
            <div>
              <p className={eyebrowClass}>Next up</p>
              <h2 className="mt-2 text-2xl font-black tracking-tight text-[#101828]">
                {activeSession?.title || activeSession?.team || (isLoading ? 'Loading next item' : 'No session scheduled yet')}
              </h2>
              <p className={`mt-2 ${bodyTextClass}`}>
                {activeSession ? getSessionContextLabel(activeSession) : 'Add a session or open the calendar when the next team activity is ready.'}
              </p>
            </div>
            <Link
              to={activeSession ? '/sessions/start' : '/calendar?action=add-event'}
              className={primaryButtonClass}
            >
              {activeSession ? 'Open next session' : 'Add event'}
            </Link>
          </div>
        </div>

        <div className="grid gap-3 px-5 py-5 sm:px-6 md:grid-cols-2 xl:grid-cols-4">
          {secondaryActions.map((action) => (
            <Link
              key={action.path}
              to={action.path}
              className="rounded-lg border border-[#d7e5dc] bg-white p-4 shadow-sm shadow-[#047857]/10 transition hover:-translate-y-0.5 hover:border-[#047857] hover:bg-[#ecfdf5] focus:outline-none focus:ring-2 focus:ring-[#93c5fd]"
            >
              <span className="block text-sm font-black text-[#101828]">{action.label}</span>
              <span className="mt-2 block text-sm font-semibold leading-6 text-[#4b5f55]">{action.description}</span>
            </Link>
          ))}
        </div>
      </section>

      <section className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
        {snapshotItems.map((item) => (
          <CoachMetric key={item.label} label={item.label} value={item.value} isLoading={isLoading} />
        ))}
      </section>

      {unassignedVoiceNotes.length > 0 || voiceNotePanelMessage ? (
        <section className={surfaceClass}>
          <div className={sectionHeaderClass}>
            <div>
              <p className={eyebrowClass}>Staff voice notes</p>
              <h2 className="mt-2 text-2xl font-black tracking-tight text-[#101828]">Unassigned voice notes</h2>
              <p className={`mt-2 ${bodyTextClass}`}>
                Assign saved staff notes to a player when you are ready.
              </p>
            </div>
          </div>
          {voiceNotePanelMessage ? (
            <div className="mx-5 mt-5 rounded-lg border border-[#bbf7d0] bg-[#ecfdf5] px-4 py-3 text-sm font-black text-[#047857] sm:mx-6">
              {voiceNotePanelMessage}
            </div>
          ) : null}
          {unassignedVoiceNotes.length > 0 ? (
            <div className="grid gap-3 px-5 py-5 sm:px-6 lg:grid-cols-2">
              {unassignedVoiceNotes.map((note) => (
              <div key={note.id} className="rounded-lg border border-[#d7e5dc] bg-[#ecfdf5] p-4 shadow-sm shadow-[#047857]/10">
                <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
                  <div>
                    <p className="text-sm font-black text-[#101828]">{note.note || 'Staff voice note'}</p>
                    <p className="mt-1 text-xs font-bold text-[#4b5f55]">
                      {formatVoiceNoteDate(note.createdAt)} | {formatVoiceNoteDuration(note.audioDurationSeconds)}
                    </p>
                  </div>
                  <span className="inline-flex w-fit rounded-full border border-[#b6d8c5] bg-white px-2.5 py-1 text-xs font-black uppercase tracking-[0.12em] text-[#065f46]">
                    Staff only
                  </span>
                </div>
                {note.audioUrl ? (
                  <audio controls src={note.audioUrl} className="mt-4 w-full" />
                ) : (
                  <p className="mt-4 rounded-lg border border-[#d7e5dc] bg-white px-3 py-3 text-sm font-bold text-[#4b5f55]">
                    Audio preview is unavailable. Try refreshing the page.
                  </p>
                )}
                <div className="mt-4 grid gap-2 sm:grid-cols-2">
                  <button
                    type="button"
                    onClick={() => openVoiceNoteAssignment(note)}
                    className="inline-flex min-h-11 items-center justify-center rounded-lg bg-[#047857] px-4 py-3 text-sm font-black text-white shadow-sm shadow-[#047857]/20 transition hover:bg-[#065f46] focus:outline-none focus:ring-2 focus:ring-[#93c5fd] focus:ring-offset-2 focus:ring-offset-white"
                  >
                    Assign to player
                  </button>
                  <button
                    type="button"
                    onClick={() => deleteRecoveredVoiceNote(note)}
                    disabled={deletingVoiceNoteId === note.id}
                    className="inline-flex min-h-11 items-center justify-center rounded-lg border border-[#d7e5dc] bg-white px-4 py-3 text-sm font-black text-[#101828] shadow-sm shadow-[#047857]/10 transition hover:border-[#8b4b4b] hover:bg-[#fff5f5] disabled:cursor-not-allowed disabled:opacity-60"
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

      <section className={surfaceClass}>
        <div className={sectionHeaderClass}>
          <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <div>
              <p className={eyebrowClass}>Development</p>
              <h2 className="mt-2 text-2xl font-black tracking-tight text-[#101828]">Latest player notes</h2>
            </div>
            <Link
              to="/assess-player/completed"
              className={secondaryButtonClass}
            >
              View all
            </Link>
          </div>
        </div>
        <div className="grid gap-3 px-5 py-5 sm:px-6 lg:grid-cols-3">
          {recentEvaluations.map((evaluation) => (
            <div key={evaluation.id || `${evaluation.playerName}-${evaluation.createdAt}`} className="rounded-lg border border-[#d7e5dc] bg-[#ecfdf5] p-4 shadow-sm shadow-[#047857]/10">
              <p className="truncate text-sm font-black text-[#101828]">{evaluation.playerName}</p>
              <p className="mt-2 text-xs font-semibold text-[#4b5f55]">{getEvaluationContextLabel(evaluation, user)}</p>
              <p className="mt-3 line-clamp-3 text-sm font-semibold leading-6 text-[#4b5f55]">
                {getEvaluationSummary(evaluation)}
              </p>
            </div>
          ))}
          {!isLoading && recentEvaluations.length === 0 ? (
            <div className="rounded-lg border border-[#d7e5dc] bg-[#ecfdf5] px-4 py-5 text-sm font-bold text-[#4b5f55] lg:col-span-3">
              Coach notes and assessments will appear here after the first session.
            </div>
          ) : null}
        </div>
      </section>

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
      <span className="text-xs font-black uppercase tracking-[0.16em] text-[#065f46]">{label}</span>
      <span className={['mt-2 block font-black text-[#101828]', compact ? 'text-2xl' : 'text-3xl'].join(' ')}>
        {isLoading ? '...' : value}
      </span>
      {to ? (
        <span className={['inline-flex items-center justify-center rounded-lg bg-[#047857] px-3 py-2 text-xs font-black text-white shadow-sm shadow-[#047857]/20', compact ? 'mt-3 min-h-8' : 'mt-4 min-h-9'].join(' ')}>
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
        className={['block rounded-lg border border-[#d7e5dc] bg-white text-left shadow-sm shadow-[#047857]/10 transition hover:-translate-y-0.5 hover:border-[#047857] hover:bg-[#ecfdf5] focus:outline-none focus:ring-2 focus:ring-[#93c5fd]', compact ? 'px-3 py-3' : 'px-4 py-4'].join(' ')}
      >
        {content}
      </Link>
    )
  }

  return (
    <div className={['rounded-lg border border-[#d7e5dc] bg-white shadow-sm shadow-[#047857]/10', compact ? 'px-3 py-3' : 'px-4 py-4'].join(' ')}>
      {content}
    </div>
  )
}
