import { useEffect, useMemo, useState } from 'react'
import { Navigate } from 'react-router-dom'
import { NoticeBanner } from '../components/ui/NoticeBanner.jsx'
import { PageHeader } from '../components/ui/PageHeader.jsx'
import { SectionCard } from '../components/ui/SectionCard.jsx'
import { useToast } from '../components/ui/toast-context.js'
import { canManageMatchDay, useAuth } from '../lib/auth.js'
import { sendMatchDayPushNotification } from '../lib/push-notifications.js'
import {
  addStaffMatchDayGoal,
  createMatchDay,
  getMatchDays,
  getMatchLocations,
  getPlayers,
  getTeams,
  MATCH_DAY_HOME_AWAY_OPTIONS,
  MATCH_DAY_STATUS_OPTIONS,
  resetPreviousMatchDayResults,
  selectMatchDayScorer,
  updateMatchDay,
  withRequestTimeout,
} from '../lib/supabase.js'

const EMPTY_MATCH_FORM = {
  opponent: '',
  matchDate: '',
  kickoffTime: '',
  homeAway: 'home',
  teamId: '',
  venueName: '',
  venueAddress: '',
  notes: '',
  scorerRequestMessage: 'Can anyone help as live scorer for this match?',
  status: 'scorer_request',
  enableMotmPoll: true,
  motmPollExpiryHours: 2,
}

const EMPTY_GOAL_FORM = {
  teamSide: 'club',
  minute: '',
  scorerName: '',
  scorerShirtNumber: '',
  assistName: '',
  assistShirtNumber: '',
  notes: '',
}

function confirmMatchDayAction(message) {
  return window.confirm(message)
}

function formatMatchDate(match) {
  if (!match.matchDate) {
    return 'Date not set'
  }

  const date = new Date(`${match.matchDate}T${match.kickoffTime || '00:00'}`)

  if (Number.isNaN(date.getTime())) {
    return match.matchDate
  }

  return date.toLocaleString([], {
    weekday: 'short',
    day: '2-digit',
    month: 'short',
    hour: match.kickoffTime ? '2-digit' : undefined,
    minute: match.kickoffTime ? '2-digit' : undefined,
  })
}

function getClubScore(match) {
  return match.homeAway === 'away' ? match.awayScore : match.homeScore
}

function getOpponentScore(match) {
  return match.homeAway === 'away' ? match.homeScore : match.awayScore
}

function getCurrentMatchMinute(match, now = Date.now()) {
  if (match.status === 'scheduled' || match.status === 'scorer_request') {
    return null
  }

  if (match.status === 'full_time' || match.status === 'postponed' || match.status === 'cancelled') {
    return null
  }

  const startedAt = new Date(match.phaseStartedAt || match.updatedAt || now)
  const startedAtTime = Number.isNaN(startedAt.getTime()) ? now : startedAt.getTime()

  if (startedAtTime > now) {
    return null
  }

  return Math.max(Math.floor((now - startedAtTime) / 60000) + 1, 1)
}

function isPreviousMatch(match) {
  if (match.status === 'full_time') {
    return true
  }

  if (!match.matchDate) {
    return false
  }

  return new Date(`${match.matchDate}T23:59:59`).getTime() < Date.now()
}

function sortMatches(matches) {
  return [...matches].sort((left, right) => {
    const leftValue = `${left.matchDate || '9999-99-99'} ${left.kickoffTime || '99:99'}`
    const rightValue = `${right.matchDate || '9999-99-99'} ${right.kickoffTime || '99:99'}`
    return leftValue.localeCompare(rightValue)
  })
}

export function MatchDayPage() {
  const { user } = useAuth()
  const { showToast } = useToast()
  const [matches, setMatches] = useState([])
  const [teams, setTeams] = useState([])
  const [players, setPlayers] = useState([])
  const [locations, setLocations] = useState([])
  const [form, setForm] = useState(EMPTY_MATCH_FORM)
  const [goalForms, setGoalForms] = useState({})
  const [scoreDrafts, setScoreDrafts] = useState({})
  const [isLoading, setIsLoading] = useState(true)
  const [isSaving, setIsSaving] = useState(false)
  const [activeMatchId, setActiveMatchId] = useState('')
  const [errorMessage, setErrorMessage] = useState('')

  const activeMatches = useMemo(() => sortMatches(matches.filter((match) => !isPreviousMatch(match))), [matches])
  const previousMatches = useMemo(() => sortMatches(matches.filter(isPreviousMatch)).reverse(), [matches])
  const squadPlayers = useMemo(
    () =>
      players
        .filter((player) => String(player.status ?? 'active') !== 'archived')
        .sort((left, right) => String(left.playerName ?? '').localeCompare(String(right.playerName ?? ''))),
    [players],
  )

  async function loadData() {
    const [nextMatches, nextTeams, nextPlayers, nextLocations] = await Promise.all([
      withRequestTimeout(() => getMatchDays({ user }), 'Match Day could not be loaded.'),
      withRequestTimeout(() => getTeams(user), 'Teams could not be loaded.'),
      withRequestTimeout(() => getPlayers({ user }), 'Players could not be loaded.'),
      withRequestTimeout(() => getMatchLocations({ user }), 'Locations could not be loaded.'),
    ])

    setMatches(nextMatches)
    setTeams(nextTeams)
    setPlayers(nextPlayers)
    setLocations(nextLocations)
  }

  useEffect(() => {
    let isMounted = true

    async function runLoad() {
      if (!canManageMatchDay(user)) {
        setIsLoading(false)
        return
      }

      setErrorMessage('')

      try {
        const [nextMatches, nextTeams, nextPlayers, nextLocations] = await Promise.all([
          withRequestTimeout(() => getMatchDays({ user }), 'Match Day could not be loaded.'),
          withRequestTimeout(() => getTeams(user), 'Teams could not be loaded.'),
          withRequestTimeout(() => getPlayers({ user }), 'Players could not be loaded.'),
          withRequestTimeout(() => getMatchLocations({ user }), 'Locations could not be loaded.'),
        ])

        if (isMounted) {
          setMatches(nextMatches)
          setTeams(nextTeams)
          setPlayers(nextPlayers)
          setLocations(nextLocations)
        }
      } catch (error) {
        console.error(error)

        if (isMounted) {
          setErrorMessage(error.message || 'Match Day could not be loaded.')
        }
      } finally {
        if (isMounted) {
          setIsLoading(false)
        }
      }
    }

    void runLoad()

    return () => {
      isMounted = false
    }
  }, [user])

  if (!canManageMatchDay(user)) {
    return <Navigate to="/" replace />
  }

  const updateForm = (updates) => {
    setForm((currentForm) => ({
      ...currentForm,
      ...updates,
    }))
    setErrorMessage('')
  }

  const applyLocation = (locationId) => {
    const location = locations.find((candidate) => String(candidate.id) === String(locationId))

    if (!location) {
      return
    }

    updateForm({
      venueName: location.name,
      venueAddress: location.address,
    })
  }

  const handleCreateMatch = async (event) => {
    event.preventDefault()

    if (!confirmMatchDayAction('Create this Match Day and publish the scorer request to the parent portal?')) {
      return
    }

    setIsSaving(true)
    setErrorMessage('')

    try {
      const createdMatch = await createMatchDay({ user, match: form })
      void sendMatchDayPushNotification({
        matchDayId: createdMatch.id,
        type: 'scorer_request',
      })
      setForm(EMPTY_MATCH_FORM)
      await loadData()
      showToast({ title: 'Match Day created', message: 'The scorer request is available in the parent portal.' })
    } catch (error) {
      console.error(error)
      setErrorMessage(error.message || 'Match Day could not be created.')
    } finally {
      setIsSaving(false)
    }
  }

  const handleStatusChange = async (match, status) => {
    if (!confirmMatchDayAction(`Change this match status to ${status.replace(/_/g, ' ')}? Parents may receive a live update.`)) {
      return
    }

    setActiveMatchId(match.id)
    setErrorMessage('')

    try {
      const updates = { status }
      if (status === 'live' && !match.phaseStartedAt) {
        updates.phaseStartedAt = new Date().toISOString()
      }

      await updateMatchDay({ user, matchId: match.id, updates })
      if (status === 'half_time' || status === 'second_half' || status === 'extra_time' || status === 'penalties' || status === 'full_time') {
        void sendMatchDayPushNotification({
          matchDayId: match.id,
          type: status,
        })
      }
      await loadData()
      showToast({ title: 'Match updated', message: 'The match status has been updated.' })
    } catch (error) {
      console.error(error)
      setErrorMessage(error.message || 'Match status could not be updated.')
    } finally {
      setActiveMatchId('')
    }
  }

  const handleScoreSave = async (match) => {
    const draft = scoreDrafts[match.id] ?? {
      homeScore: match.homeScore,
      awayScore: match.awayScore,
    }

    if (!confirmMatchDayAction(`Save this score as ${draft.homeScore || 0} - ${draft.awayScore || 0} for the parent portal?`)) {
      return
    }

    setActiveMatchId(match.id)
    setErrorMessage('')

    try {
      await updateMatchDay({
        user,
        matchId: match.id,
        updates: {
          homeScore: draft.homeScore,
          awayScore: draft.awayScore,
        },
      })
      await loadData()
      showToast({ title: 'Score updated', message: 'The parent portal score has been updated.' })
    } catch (error) {
      console.error(error)
      setErrorMessage(error.message || 'Score could not be updated.')
    } finally {
      setActiveMatchId('')
    }
  }

  const handleSelectScorer = async (match, interest) => {
    const parentName = interest.parentEmail || interest.parentName || 'this parent'

    if (!confirmMatchDayAction(`Select ${parentName} as a Match Day scorer? They will be able to update the live score.`)) {
      return
    }

    setActiveMatchId(match.id)
    setErrorMessage('')

    try {
      await selectMatchDayScorer({ user, match, interest })
      void sendMatchDayPushNotification({
        matchDayId: match.id,
        type: 'scorer_selected',
        targetParentLinkIds: [interest.parentLinkId],
      })
      await loadData()
      showToast({ title: 'Scorer selected', message: 'This parent can now update the live score.' })
    } catch (error) {
      console.error(error)
      setErrorMessage(error.message || 'Scorer could not be selected.')
    } finally {
      setActiveMatchId('')
    }
  }

  const updateGoalForm = (matchId, updates) => {
    setGoalForms((currentForms) => ({
      ...currentForms,
      [matchId]: {
        ...EMPTY_GOAL_FORM,
        ...(currentForms[matchId] ?? {}),
        ...updates,
      },
    }))
  }

  const handlePlayerPick = (matchId, fieldPrefix, playerId) => {
    const player = squadPlayers.find((candidate) => String(candidate.id) === String(playerId))

    if (!player) {
      return
    }

    updateGoalForm(matchId, {
      [`${fieldPrefix}Name`]: player.playerName,
      [`${fieldPrefix}ShirtNumber`]: player.shirtNumber || '',
    })
  }

  const handleAddGoal = async (event, match) => {
    event.preventDefault()
    const goal = {
      ...(goalForms[match.id] ?? EMPTY_GOAL_FORM),
      minute: getCurrentMatchMinute(match, Date.now()) ?? '',
    }

    if (!confirmMatchDayAction('Add this goal to the live feed and update the parent portal score?')) {
      return
    }

    setActiveMatchId(match.id)
    setErrorMessage('')

    try {
      const event = await addStaffMatchDayGoal({ user, match, goal })
      void sendMatchDayPushNotification({
        matchDayId: match.id,
        type: 'goal',
        eventId: event.id,
      })
      setGoalForms((currentForms) => ({
        ...currentForms,
        [match.id]: EMPTY_GOAL_FORM,
      }))
      await loadData()
      showToast({ title: 'Goal added', message: 'The live feed has been updated.' })
    } catch (error) {
      console.error(error)
      setErrorMessage(error.message || 'Goal could not be added.')
    } finally {
      setActiveMatchId('')
    }
  }

  const handleResetPrevious = async () => {
    const confirmed = confirmMatchDayAction('Reset previous games for the season? This hides full time results from the parent portal previous games list.')

    if (!confirmed) {
      return
    }

    setIsSaving(true)
    setErrorMessage('')

    try {
      await resetPreviousMatchDayResults({ user })
      await loadData()
      showToast({ title: 'Previous games reset', message: 'Old full time results have been hidden from the parent portal.' })
    } catch (error) {
      console.error(error)
      setErrorMessage(error.message || 'Previous games could not be reset.')
    } finally {
      setIsSaving(false)
    }
  }

  return (
    <div className="space-y-5 sm:space-y-6">
      <PageHeader
        eyebrow="Match Day"
        title="Match Day"
        description="Create fixtures, request parent scorers, select volunteers, and manage live score updates."
      />

      {errorMessage ? <NoticeBanner title="Match Day action failed" message={errorMessage} /> : null}

      <SectionCard title="Create Match Day" description="Set up the match and publish a scorer request to the parent portal.">
        <form className="space-y-4" onSubmit={handleCreateMatch}>
          <div className="grid gap-4 md:grid-cols-2">
            <label className="block">
              <span className="mb-2 block text-sm font-semibold text-[var(--text-primary)]">Opponent</span>
              <input
                value={form.opponent}
                onChange={(event) => updateForm({ opponent: event.target.value })}
                className="min-h-11 rounded-lg border border-[var(--border-color)] bg-[var(--panel-alt)] px-3 py-2 text-sm text-[var(--text-primary)]"
                required
              />
            </label>

            <label className="block">
              <span className="mb-2 block text-sm font-semibold text-[var(--text-primary)]">Team</span>
              <select
                value={form.teamId}
                onChange={(event) => updateForm({ teamId: event.target.value })}
                className="min-h-11 rounded-lg border border-[var(--border-color)] bg-[var(--panel-alt)] px-3 py-2 text-sm text-[var(--text-primary)]"
              >
                <option value="">Current or all teams</option>
                {teams.map((team) => (
                  <option key={team.id} value={team.id}>{team.name}</option>
                ))}
              </select>
            </label>

            <label className="block">
              <span className="mb-2 block text-sm font-semibold text-[var(--text-primary)]">Date</span>
              <input
                type="date"
                value={form.matchDate}
                onChange={(event) => updateForm({ matchDate: event.target.value })}
                className="min-h-11 rounded-lg border border-[var(--border-color)] bg-[var(--panel-alt)] px-3 py-2 text-sm text-[var(--text-primary)]"
              />
            </label>

            <label className="block">
              <span className="mb-2 block text-sm font-semibold text-[var(--text-primary)]">Kick off</span>
              <input
                type="time"
                value={form.kickoffTime}
                onChange={(event) => updateForm({ kickoffTime: event.target.value })}
                className="min-h-11 rounded-lg border border-[var(--border-color)] bg-[var(--panel-alt)] px-3 py-2 text-sm text-[var(--text-primary)]"
              />
            </label>

            <label className="block">
              <span className="mb-2 block text-sm font-semibold text-[var(--text-primary)]">Home or away</span>
              <select
                value={form.homeAway}
                onChange={(event) => updateForm({ homeAway: event.target.value })}
                className="min-h-11 rounded-lg border border-[var(--border-color)] bg-[var(--panel-alt)] px-3 py-2 text-sm text-[var(--text-primary)]"
              >
                {MATCH_DAY_HOME_AWAY_OPTIONS.map((option) => (
                  <option key={option.value} value={option.value}>{option.label}</option>
                ))}
              </select>
            </label>

            <label className="block">
              <span className="mb-2 block text-sm font-semibold text-[var(--text-primary)]">Reuse location</span>
              <select
                value=""
                onChange={(event) => applyLocation(event.target.value)}
                className="min-h-11 rounded-lg border border-[var(--border-color)] bg-[var(--panel-alt)] px-3 py-2 text-sm text-[var(--text-primary)]"
              >
                <option value="">Choose saved location</option>
                {locations.map((location) => (
                  <option key={location.id} value={location.id}>{location.name}</option>
                ))}
              </select>
            </label>

            <label className="block">
              <span className="mb-2 block text-sm font-semibold text-[var(--text-primary)]">Venue</span>
              <input
                value={form.venueName}
                onChange={(event) => updateForm({ venueName: event.target.value })}
                className="min-h-11 rounded-lg border border-[var(--border-color)] bg-[var(--panel-alt)] px-3 py-2 text-sm text-[var(--text-primary)]"
              />
            </label>

            <label className="block">
              <span className="mb-2 block text-sm font-semibold text-[var(--text-primary)]">Address</span>
              <input
                value={form.venueAddress}
                onChange={(event) => updateForm({ venueAddress: event.target.value })}
                className="min-h-11 rounded-lg border border-[var(--border-color)] bg-[var(--panel-alt)] px-3 py-2 text-sm text-[var(--text-primary)]"
              />
            </label>
          </div>

          <label className="block">
            <span className="mb-2 block text-sm font-semibold text-[var(--text-primary)]">Scorer request message</span>
            <textarea
              value={form.scorerRequestMessage}
              onChange={(event) => updateForm({ scorerRequestMessage: event.target.value })}
              className="min-h-24 rounded-lg border border-[var(--border-color)] bg-[var(--panel-alt)] px-3 py-2 text-sm text-[var(--text-primary)]"
            />
          </label>

          <label className="block">
            <span className="mb-2 block text-sm font-semibold text-[var(--text-primary)]">Match notes</span>
            <textarea
              value={form.notes}
              onChange={(event) => updateForm({ notes: event.target.value })}
              className="min-h-24 rounded-lg border border-[var(--border-color)] bg-[var(--panel-alt)] px-3 py-2 text-sm text-[var(--text-primary)]"
            />
          </label>

          <div className="grid gap-4 md:grid-cols-2">
            <label className="flex min-h-11 items-center gap-3 rounded-lg border border-[var(--border-color)] bg-[var(--panel-alt)] px-3 py-2">
              <input
                type="checkbox"
                checked={form.enableMotmPoll}
                onChange={(event) => updateForm({ enableMotmPoll: event.target.checked })}
                className="h-4 w-4 accent-[var(--accent)]"
              />
              <span className="text-sm font-semibold text-[var(--text-primary)]">Create Player of the Match poll at full time</span>
            </label>

            <label className="block">
              <span className="mb-2 block text-sm font-semibold text-[var(--text-primary)]">Poll expiry hours</span>
              <input
                type="number"
                min="1"
                max="72"
                value={form.motmPollExpiryHours}
                onChange={(event) => updateForm({ motmPollExpiryHours: event.target.value })}
                disabled={!form.enableMotmPoll}
                className="min-h-11 rounded-lg border border-[var(--border-color)] bg-[var(--panel-alt)] px-3 py-2 text-sm text-[var(--text-primary)] disabled:cursor-not-allowed disabled:opacity-60"
              />
            </label>
          </div>

          <button
            type="submit"
            disabled={isSaving}
            className="inline-flex min-h-11 w-full items-center justify-center rounded-lg bg-[var(--button-primary)] px-5 py-3 text-sm font-semibold text-[var(--button-primary-text)] transition hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-60 sm:w-auto"
          >
            {isSaving ? 'Creating...' : 'Create Match Day'}
          </button>
        </form>
      </SectionCard>

      <SectionCard
        title="Live and upcoming matches"
        description="Select scorers, update the score, and add goals with scorer and assist details."
      >
        {isLoading ? (
          <p className="rounded-lg border border-[var(--border-color)] bg-[var(--panel-alt)] px-4 py-5 text-sm text-[var(--text-muted)]">
            Loading Match Day...
          </p>
        ) : activeMatches.length > 0 ? (
          <div className="space-y-4">
            {activeMatches.map((match) => (
              <MatchDayCard
                key={match.id}
                activeMatchId={activeMatchId}
                goalForm={goalForms[match.id] ?? EMPTY_GOAL_FORM}
                match={match}
                onAddGoal={handleAddGoal}
                onGoalFormChange={updateGoalForm}
                onPlayerPick={handlePlayerPick}
                onScoreDraftChange={(updates) => setScoreDrafts((currentDrafts) => ({
                  ...currentDrafts,
                  [match.id]: {
                    homeScore: match.homeScore,
                    awayScore: match.awayScore,
                    ...(currentDrafts[match.id] ?? {}),
                    ...updates,
                  },
                }))}
                onScoreSave={handleScoreSave}
                onSelectScorer={handleSelectScorer}
                onStatusChange={handleStatusChange}
                players={squadPlayers}
                scoreDraft={scoreDrafts[match.id] ?? { homeScore: match.homeScore, awayScore: match.awayScore }}
              />
            ))}
          </div>
        ) : (
          <p className="rounded-lg border border-dashed border-[var(--border-color)] bg-[var(--panel-alt)] px-4 py-5 text-sm text-[var(--text-muted)]">
            No live or upcoming matches have been created yet.
          </p>
        )}
      </SectionCard>

      <SectionCard
        title="Previous games"
        description="Review completed results. Reset the list when a new season starts."
        actions={(
          <button
            type="button"
            onClick={handleResetPrevious}
            disabled={isSaving || previousMatches.length === 0}
            className="inline-flex min-h-10 w-full items-center justify-center rounded-lg border border-[var(--border-color)] bg-[var(--panel-alt)] px-4 py-2 text-sm font-semibold text-[var(--text-primary)] transition hover:bg-[var(--panel-soft)] disabled:cursor-not-allowed disabled:opacity-60 sm:w-auto"
          >
            Reset previous games
          </button>
        )}
      >
        {previousMatches.length > 0 ? (
          <div className="grid gap-3 md:grid-cols-2">
            {previousMatches.map((match) => (
              <article key={match.id} className="rounded-lg border border-[var(--border-color)] bg-[var(--panel-alt)] p-4">
                <p className="text-xs font-semibold uppercase tracking-[0.16em] text-[var(--text-secondary)]">{formatMatchDate(match)}</p>
                <h4 className="mt-2 text-base font-semibold text-[var(--text-primary)]">
                  {match.teamName || 'Our team'} v {match.opponent}
                </h4>
                <p className="mt-2 text-2xl font-semibold text-[var(--text-primary)]">
                  {getClubScore(match)} - {getOpponentScore(match)}
                </p>
                <p className="mt-1 text-xs text-[var(--text-muted)]">{match.status.replace(/_/g, ' ')}</p>
              </article>
            ))}
          </div>
        ) : (
          <p className="rounded-lg border border-dashed border-[var(--border-color)] bg-[var(--panel-alt)] px-4 py-5 text-sm text-[var(--text-muted)]">
            No previous games are showing.
          </p>
        )}
      </SectionCard>
    </div>
  )
}

function MatchDayCard({
  activeMatchId,
  goalForm,
  match,
  onAddGoal,
  onGoalFormChange,
  onPlayerPick,
  onScoreDraftChange,
  onScoreSave,
  onSelectScorer,
  onStatusChange,
  players,
  scoreDraft,
}) {
  const isBusy = activeMatchId === match.id
  const selectedParentLinkIds = new Set(match.scorerAssignments.map((assignment) => String(assignment.parentLinkId)))

  return (
    <article className="rounded-lg border border-[var(--border-color)] bg-[var(--panel-alt)] p-4">
      <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
        <div className="min-w-0">
          <div className="flex flex-wrap gap-2">
            <span className="inline-flex w-fit rounded-full border border-[var(--border-color)] px-3 py-1 text-xs font-semibold text-[var(--text-secondary)]">
              {match.status.replace(/_/g, ' ')}
            </span>
            <span className="inline-flex w-fit rounded-full border border-[var(--border-color)] px-3 py-1 text-xs font-semibold text-[var(--text-secondary)]">
              {match.homeAway}
            </span>
            {match.teamName ? (
              <span className="inline-flex w-fit rounded-full border border-[var(--border-color)] px-3 py-1 text-xs font-semibold text-[var(--text-secondary)]">
                {match.teamName}
              </span>
            ) : null}
          </div>
          <h4 className="mt-3 text-lg font-semibold text-[var(--text-primary)]">{match.teamName || 'Our team'} v {match.opponent}</h4>
          <p className="mt-1 text-sm text-[var(--text-muted)]">{formatMatchDate(match)}</p>
          {match.venueName ? <p className="mt-1 text-sm text-[var(--text-muted)]">{match.venueName}</p> : null}
          {match.notes ? <p className="mt-2 whitespace-pre-wrap text-sm leading-6 text-[var(--text-muted)]">{match.notes}</p> : null}
        </div>

        <div className="rounded-lg border border-[var(--border-color)] bg-[var(--panel-bg)] p-4 text-center">
          <p className="text-xs font-semibold uppercase tracking-[0.16em] text-[var(--text-secondary)]">Live score</p>
          <p className="mt-2 text-3xl font-semibold text-[var(--text-primary)]">
            {getClubScore(match)} - {getOpponentScore(match)}
          </p>
          {getCurrentMatchMinute(match) ? (
            <p className="mt-2 text-sm font-semibold text-[var(--text-secondary)]">{getCurrentMatchMinute(match)} min</p>
          ) : null}
        </div>
      </div>

      <div className="mt-5 grid gap-4 lg:grid-cols-2">
        <div className="rounded-lg border border-[var(--border-color)] bg-[var(--panel-bg)] p-4">
          <h5 className="text-sm font-semibold text-[var(--text-primary)]">Score and status</h5>
          {match.status === 'scheduled' || match.status === 'scorer_request' ? (
            <button
              type="button"
              onClick={() => onStatusChange(match, 'live')}
              disabled={isBusy}
              className="mt-3 inline-flex min-h-10 w-full items-center justify-center rounded-lg bg-[var(--button-primary)] px-4 py-2 text-sm font-semibold text-[var(--button-primary-text)] transition hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-60 sm:w-auto"
            >
              Start match
            </button>
          ) : null}
          <div className="mt-3 grid gap-3 sm:grid-cols-3">
            <label className="block">
              <span className="mb-1 block text-xs font-semibold text-[var(--text-secondary)]">Home</span>
              <input
                type="number"
                min="0"
                value={scoreDraft.homeScore}
                onChange={(event) => onScoreDraftChange({ homeScore: event.target.value })}
                className="min-h-10 rounded-lg border border-[var(--border-color)] bg-[var(--panel-alt)] px-3 py-2 text-sm text-[var(--text-primary)]"
              />
            </label>
            <label className="block">
              <span className="mb-1 block text-xs font-semibold text-[var(--text-secondary)]">Away</span>
              <input
                type="number"
                min="0"
                value={scoreDraft.awayScore}
                onChange={(event) => onScoreDraftChange({ awayScore: event.target.value })}
                className="min-h-10 rounded-lg border border-[var(--border-color)] bg-[var(--panel-alt)] px-3 py-2 text-sm text-[var(--text-primary)]"
              />
            </label>
            <button
              type="button"
              onClick={() => onScoreSave(match)}
              disabled={isBusy}
              className="mt-auto inline-flex min-h-10 items-center justify-center rounded-lg bg-[var(--button-primary)] px-4 py-2 text-sm font-semibold text-[var(--button-primary-text)] transition hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-60"
            >
              Save score
            </button>
          </div>

          <div className="mt-3 flex flex-wrap gap-2">
            {MATCH_DAY_STATUS_OPTIONS.map((option) => (
              <button
                key={option.value}
                type="button"
                onClick={() => onStatusChange(match, option.value)}
                disabled={isBusy}
                className={`inline-flex min-h-10 items-center justify-center rounded-lg border px-3 py-2 text-sm font-semibold transition disabled:cursor-not-allowed disabled:opacity-60 ${
                  match.status === option.value
                    ? 'border-[var(--accent)] bg-[var(--button-primary)] text-[var(--button-primary-text)]'
                    : 'border-[var(--border-color)] bg-[var(--panel-alt)] text-[var(--text-primary)] hover:bg-[var(--panel-soft)]'
                }`}
              >
                {option.label}
              </button>
            ))}
          </div>
        </div>

        <div className="rounded-lg border border-[var(--border-color)] bg-[var(--panel-bg)] p-4">
          <h5 className="text-sm font-semibold text-[var(--text-primary)]">Parent scorer requests</h5>
          {match.scorerInterests.length > 0 ? (
            <div className="mt-3 space-y-2">
              {match.scorerInterests.map((interest) => {
                const isSelected = selectedParentLinkIds.has(String(interest.parentLinkId))

                return (
                  <div key={interest.id} className="rounded-lg border border-[var(--border-color)] bg-[var(--panel-alt)] p-3">
                    <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                      <div className="min-w-0">
                        <p className="text-sm font-semibold text-[var(--text-primary)]">{interest.parentEmail || interest.parentName || 'Parent'}</p>
                        <p className="mt-1 text-xs text-[var(--text-muted)]">
                          {interest.playerName ? `Linked to ${interest.playerName}` : 'Parent portal volunteer'}
                        </p>
                        {interest.message ? <p className="mt-2 text-sm text-[var(--text-muted)]">{interest.message}</p> : null}
                      </div>
                      <button
                        type="button"
                        onClick={() => onSelectScorer(match, interest)}
                        disabled={isBusy || isSelected}
                        className="inline-flex min-h-10 items-center justify-center rounded-lg border border-[var(--border-color)] bg-[var(--panel-bg)] px-4 py-2 text-sm font-semibold text-[var(--text-primary)] transition hover:bg-[var(--panel-soft)] disabled:cursor-not-allowed disabled:opacity-60"
                      >
                        {isSelected ? 'Selected' : 'Select scorer'}
                      </button>
                    </div>
                  </div>
                )
              })}
            </div>
          ) : (
            <p className="mt-3 rounded-lg border border-dashed border-[var(--border-color)] bg-[var(--panel-alt)] px-4 py-5 text-sm text-[var(--text-muted)]">
              No parents have volunteered yet.
            </p>
          )}
        </div>
      </div>

      <form className="mt-4 rounded-lg border border-[var(--border-color)] bg-[var(--panel-bg)] p-4" onSubmit={(event) => onAddGoal(event, match)}>
        <h5 className="text-sm font-semibold text-[var(--text-primary)]">Add goal</h5>
        <div className="mt-3 grid gap-3 md:grid-cols-3">
          <label className="block">
            <span className="mb-1 block text-xs font-semibold text-[var(--text-secondary)]">Team</span>
            <select
              value={goalForm.teamSide}
              onChange={(event) => onGoalFormChange(match.id, { teamSide: event.target.value })}
              className="min-h-10 rounded-lg border border-[var(--border-color)] bg-[var(--panel-alt)] px-3 py-2 text-sm text-[var(--text-primary)]"
            >
              <option value="club">Our team</option>
              <option value="opponent">Opponent</option>
            </select>
          </label>
          <label className="block">
            <span className="mb-1 block text-xs font-semibold text-[var(--text-secondary)]">Scorer player</span>
            <select
              value=""
              onChange={(event) => onPlayerPick(match.id, 'scorer', event.target.value)}
              className="min-h-10 rounded-lg border border-[var(--border-color)] bg-[var(--panel-alt)] px-3 py-2 text-sm text-[var(--text-primary)]"
            >
              <option value="">Choose player</option>
              {players.map((player) => (
                <option key={player.id} value={player.id}>{player.playerName}</option>
              ))}
            </select>
          </label>
          <label className="block">
            <span className="mb-1 block text-xs font-semibold text-[var(--text-secondary)]">Scorer name</span>
            <input
              value={goalForm.scorerName}
              onChange={(event) => onGoalFormChange(match.id, { scorerName: event.target.value })}
              className="min-h-10 rounded-lg border border-[var(--border-color)] bg-[var(--panel-alt)] px-3 py-2 text-sm text-[var(--text-primary)]"
            />
          </label>
          <label className="block">
            <span className="mb-1 block text-xs font-semibold text-[var(--text-secondary)]">Scorer shirt</span>
            <input
              value={goalForm.scorerShirtNumber}
              onChange={(event) => onGoalFormChange(match.id, { scorerShirtNumber: event.target.value })}
              className="min-h-10 rounded-lg border border-[var(--border-color)] bg-[var(--panel-alt)] px-3 py-2 text-sm text-[var(--text-primary)]"
            />
          </label>
          <label className="block">
            <span className="mb-1 block text-xs font-semibold text-[var(--text-secondary)]">Assist player</span>
            <select
              value=""
              onChange={(event) => onPlayerPick(match.id, 'assist', event.target.value)}
              className="min-h-10 rounded-lg border border-[var(--border-color)] bg-[var(--panel-alt)] px-3 py-2 text-sm text-[var(--text-primary)]"
            >
              <option value="">Choose player</option>
              {players.map((player) => (
                <option key={player.id} value={player.id}>{player.playerName}</option>
              ))}
            </select>
          </label>
          <label className="block">
            <span className="mb-1 block text-xs font-semibold text-[var(--text-secondary)]">Assist name</span>
            <input
              value={goalForm.assistName}
              onChange={(event) => onGoalFormChange(match.id, { assistName: event.target.value })}
              className="min-h-10 rounded-lg border border-[var(--border-color)] bg-[var(--panel-alt)] px-3 py-2 text-sm text-[var(--text-primary)]"
            />
          </label>
          <label className="block">
            <span className="mb-1 block text-xs font-semibold text-[var(--text-secondary)]">Assist shirt</span>
            <input
              value={goalForm.assistShirtNumber}
              onChange={(event) => onGoalFormChange(match.id, { assistShirtNumber: event.target.value })}
              className="min-h-10 rounded-lg border border-[var(--border-color)] bg-[var(--panel-alt)] px-3 py-2 text-sm text-[var(--text-primary)]"
            />
          </label>
          <button
            type="submit"
            disabled={isBusy}
            className="mt-auto inline-flex min-h-10 items-center justify-center rounded-lg bg-[var(--button-primary)] px-4 py-2 text-sm font-semibold text-[var(--button-primary-text)] transition hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-60"
          >
            Add goal
          </button>
        </div>
      </form>

      {match.events.length > 0 ? (
        <div className="mt-4 space-y-2">
          {match.events.slice(0, 6).map((event) => (
            <div key={event.id} className="rounded-lg border border-[var(--border-color)] bg-[var(--panel-bg)] px-4 py-3">
              <p className="text-sm font-semibold text-[var(--text-primary)]">
                {event.eventType === 'goal' ? 'Goal' : 'Update'} | {event.homeScore} - {event.awayScore}
              </p>
              <p className="mt-1 text-xs text-[var(--text-muted)]">
                {event.minute !== null ? `${event.minute} min | ` : ''}
                {event.scorerInitials || event.scorerName || 'Score update'}
                {event.scorerShirtNumber ? ` #${event.scorerShirtNumber}` : ''}
                {event.assistInitials || event.assistName ? ` | Assist ${event.assistInitials || event.assistName}` : ''}
                {event.assistShirtNumber ? ` #${event.assistShirtNumber}` : ''}
              </p>
            </div>
          ))}
        </div>
      ) : null}
    </article>
  )
}
