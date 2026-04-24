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
  createAssessmentSession,
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

export function SessionsPage() {
  const { user } = useAuth()
  const navigate = useNavigate()
  const [searchParams, setSearchParams] = useSearchParams()
  const { showToast } = useToast()
  const cacheKey = user?.clubId ? `sessions:${user.clubId}:${user.id}:${user.roleRank}` : ''
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
  const [sessionPlayers, setSessionPlayers] = useState([])
  const [sessionForm, setSessionForm] = useState(createInitialSessionForm)
  const [selectedSessionId, setSelectedSessionId] = useState('')
  const [selectedPlayerIds, setSelectedPlayerIds] = useState([])
  const [notesDrafts, setNotesDrafts] = useState({})
  const [isLoading, setIsLoading] = useState(() => sessions.length === 0 && players.length === 0 && teams.length === 0)
  const [isSessionPlayersLoading, setIsSessionPlayersLoading] = useState(false)
  const [isSaving, setIsSaving] = useState(false)
  const [errorMessage, setErrorMessage] = useState('')
  const userScopeKey = user ? `${user.id}:${user.clubId || ''}:${user.role}:${user.roleRank}` : ''
  const completedSessionId = String(searchParams.get('completedSessionId') ?? '').trim()
  const completedCount = Number(searchParams.get('completedCount') ?? 0)

  useEffect(() => {
    let isMounted = true
    const cachedValue = readViewCache(cacheKey)

    const loadData = async () => {
      setErrorMessage('')

      try {
        const [sessionsResult, playersResult, teamsResult] = await Promise.allSettled([
          withRequestTimeout(() => getAssessmentSessions({ user }), 'Could not load sessions.'),
          withRequestTimeout(() => getPlayers({ user }), 'Could not load players.'),
          withRequestTimeout(() => getAvailableTeamsForUser(user), 'Could not load teams.'),
        ])

        if (!isMounted) {
          return
        }

        const nextSessions = sessionsResult.status === 'fulfilled' ? sessionsResult.value : cachedValue?.sessions || []
        const nextPlayers = playersResult.status === 'fulfilled' ? playersResult.value : cachedValue?.players || []
        const nextTeams = teamsResult.status === 'fulfilled' ? teamsResult.value : cachedValue?.teams || []

        if (sessionsResult.status === 'rejected') {
          console.error(sessionsResult.reason)
        }

        if (playersResult.status === 'rejected') {
          console.error(playersResult.reason)
        }

        if (teamsResult.status === 'rejected') {
          console.error(teamsResult.reason)
        }

        setSessions(nextSessions)
        setPlayers(nextPlayers)
        setTeams(nextTeams)
        setSelectedSessionId((current) => current || nextSessions[0]?.id || '')
        setSessionForm((current) => ({
          ...current,
          teamId: current.teamId || nextTeams[0]?.id || '',
          team: current.team || nextTeams[0]?.name || '',
        }))
        writeViewCache(cacheKey, {
          sessions: nextSessions,
          players: nextPlayers,
          teams: nextTeams,
        })

        if (
          sessionsResult.status === 'rejected' ||
          playersResult.status === 'rejected' ||
          teamsResult.status === 'rejected'
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
  }, [cacheKey, user, userScopeKey])

  useEffect(() => {
    let isMounted = true

    const loadSessionPlayers = async () => {
      if (!selectedSessionId) {
        setSessionPlayers([])
        setNotesDrafts({})
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
        setNotesDrafts(Object.fromEntries(nextSessionPlayers.map((player) => [player.id, player.notes || ''])))
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
  }, [selectedSessionId, user])

  const selectedSession = sessions.find((session) => session.id === selectedSessionId)
  const filteredPlayers = useMemo(
    () =>
      players.filter(
        (player) =>
          player.section === sessionForm.section &&
          (!sessionForm.team || player.team === sessionForm.team),
      ),
    [players, sessionForm.section, sessionForm.team],
  )

  if (!canCreateEvaluation(user)) {
    return <Navigate to="/" replace />
  }

  const writeSessionCache = (nextState = {}) => {
    writeViewCache(cacheKey, {
      sessions,
      players,
      teams,
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
      setNotesDrafts(Object.fromEntries(nextSessionPlayers.map((player) => [player.id, player.notes || ''])))
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
    const queue = sessionPlayers.map((player) => player.playerName).filter(Boolean)

    if (queue.length === 0) {
      setErrorMessage('Add players to the session before using Assess All.')
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
          <form className="grid gap-4 md:grid-cols-2 xl:grid-cols-5" onSubmit={handleCreateSession}>
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
                onChange={(event) => setSelectedSessionId(event.target.value)}
                className="min-h-11 w-full rounded-2xl border border-[var(--border-color)] bg-[var(--panel-alt)] px-4 py-3 text-sm text-[var(--text-primary)] outline-none transition focus:border-[var(--accent)]"
              >
                {sessions.map((session) => (
                  <option key={session.id} value={session.id}>
                    {(session.sessionType === 'match' ? 'Match' : 'Training')} | {session.title || session.team} | {formatSessionDate(session.sessionDate)}
                  </option>
                ))}
              </select>
            </label>

            <div className="grid gap-3 md:grid-cols-2">
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
            <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
              <div>
                <p className="text-sm font-semibold text-[var(--text-primary)]">
                  {selectedSession?.title || selectedSession?.team || 'Session'}
                </p>
                <p className="mt-1 text-sm text-[var(--text-muted)]">
                  {(selectedSession?.sessionType === 'match' ? 'Match' : 'Training')} | {formatSessionDate(selectedSession?.sessionDate)}
                </p>
              </div>
              <button
                type="button"
                onClick={handleAssessAll}
                className="inline-flex min-h-11 items-center justify-center rounded-2xl bg-[var(--button-primary)] px-5 py-3 text-sm font-semibold text-[var(--button-primary-text)] transition hover:opacity-90"
              >
                Assess All
              </button>
            </div>

            {sessionPlayers.map((player) => (
              <div key={player.id} className="rounded-[24px] border border-[var(--border-color)] bg-[var(--panel-alt)] p-4">
                <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
                  <div className="min-w-0">
                    <p className="text-base font-semibold text-[var(--text-primary)]">{player.playerName}</p>
                    <p className="mt-1 text-sm text-[var(--text-muted)]">{player.section} | {player.team || 'No team'}</p>
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
