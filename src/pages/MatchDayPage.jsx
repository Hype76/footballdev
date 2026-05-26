import { useEffect, useMemo, useState } from 'react'
import { Navigate } from 'react-router-dom'
import { PreviousGameCard, PreviousGameDetailModal } from '../components/match-day/PreviousGameCard.jsx'
import { NoticeBanner } from '../components/ui/NoticeBanner.jsx'
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

const labelClass = 'mb-2 block text-sm font-black text-[#10231a]'
const smallLabelClass = 'mb-1 block text-xs font-black uppercase tracking-[0.14em] text-[#475569]'
const inputClass = 'min-h-11 w-full rounded-lg border border-[#cbd5e1] bg-[#f8fafc] px-4 py-3 text-sm font-semibold text-[#10231a] outline-none transition placeholder:text-[#94a3b8] focus:border-[#3b82f6] focus:bg-white focus:ring-2 focus:ring-[#dbeafe] disabled:cursor-not-allowed disabled:opacity-60'
const compactInputClass = 'min-h-10 w-full rounded-lg border border-[#cbd5e1] bg-[#f8fafc] px-3 py-2 text-sm font-semibold text-[#10231a] outline-none transition focus:border-[#3b82f6] focus:bg-white focus:ring-2 focus:ring-[#dbeafe] disabled:cursor-not-allowed disabled:opacity-60'
const primaryButtonClass = 'inline-flex min-h-11 items-center justify-center rounded-lg bg-[#2563eb] px-5 py-3 text-sm font-black text-white transition hover:bg-[#1d4ed8] disabled:cursor-not-allowed disabled:opacity-60'
const secondaryButtonClass = 'inline-flex min-h-10 items-center justify-center rounded-lg border border-[#cbd5e1] bg-white px-4 py-2 text-sm font-black text-[#10231a] shadow-sm shadow-[#2563eb]/10 transition hover:border-[#3b82f6] hover:bg-[#eff6ff] disabled:cursor-not-allowed disabled:opacity-60'
const panelClass = 'rounded-lg border border-[#cbd5e1] bg-[#f8fafc] p-4 shadow-sm shadow-[#2563eb]/10'
const sectionHeaderClass = 'border-b border-[#cbd5e1] bg-[#f8fafc] px-5 py-5 sm:px-6'
const eyebrowClass = 'text-xs font-black uppercase tracking-[0.18em] text-[#2563eb]'
const bodyTextClass = 'text-sm font-semibold leading-6 text-[#475569]'

const matchRuleCards = [
  {
    label: 'Create one match record',
    body: 'Set the opponent, team, venue, scorer request, and match status before parent updates begin.',
  },
  {
    label: 'Control live access',
    body: 'Parent volunteers can help only after staff select them for that fixture.',
  },
  {
    label: 'Finish with the result',
    body: 'Score, goals, assists, venue, and notes stay attached to the same club fixture.',
  },
]

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
  const [selectedPreviousMatch, setSelectedPreviousMatch] = useState(null)

  const activeMatches = useMemo(() => sortMatches(matches.filter((match) => !isPreviousMatch(match))), [matches])
  const previousMatches = useMemo(() => sortMatches(matches.filter(isPreviousMatch)).reverse(), [matches])
  const liveMatches = useMemo(
    () => activeMatches.filter((match) => !['scheduled', 'scorer_request'].includes(match.status)).length,
    [activeMatches],
  )
  const scorerRequests = useMemo(
    () => activeMatches.filter((match) => match.status === 'scorer_request').length,
    [activeMatches],
  )
  const upcomingMatches = useMemo(
    () => activeMatches.filter((match) => ['scheduled', 'scorer_request'].includes(match.status)).length,
    [activeMatches],
  )
  const goalCount = useMemo(
    () => matches.reduce((total, match) => total + (Array.isArray(match.events) ? match.events.filter((event) => event.eventType === 'goal').length : 0), 0),
    [matches],
  )
  const matchDaySummary = [
    {
      label: 'Live now',
      value: liveMatches,
      caption: 'Matches currently being updated for parents.',
    },
    {
      label: 'Scorer requests',
      value: scorerRequests,
      caption: 'Fixtures waiting for parent volunteers.',
    },
    {
      label: 'Upcoming',
      value: upcomingMatches,
      caption: 'Fixtures created but not live yet.',
    },
    {
      label: 'Previous games',
      value: previousMatches.length,
      caption: 'Completed results retained for review.',
    },
  ]
  const nextMatch = activeMatches[0] || null
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
    <div className="space-y-5">
      <section className="overflow-hidden rounded-lg border border-[#cbd5e1] bg-white shadow-sm shadow-[#2563eb]/10">
        <div className="grid gap-0 xl:grid-cols-[minmax(0,1fr)_25rem]">
          <div>
            <div className="px-5 py-6 sm:px-6 lg:px-8">
              <p className={eyebrowClass}>Match day control</p>
              <h1 className="mt-3 max-w-5xl text-4xl font-black leading-[1.02] tracking-tight text-[#10231a] sm:text-5xl">
                Run the fixture from scorer request to full time.
              </h1>
              <p className="mt-4 max-w-3xl text-base font-semibold leading-7 text-[#475569]">
                Create the fixture, control who can update it, run the live score, and keep the final result in one club record.
              </p>
              <div className="mt-5 grid gap-3 md:grid-cols-3">
                {matchRuleCards.map((item) => (
                  <article key={item.label} className="rounded-lg border border-[#cbd5e1] bg-[#f8fafc] p-4 shadow-sm shadow-[#2563eb]/10">
                    <p className="text-xs font-black uppercase tracking-[0.16em] text-[#2563eb]">{item.label}</p>
                    <p className="mt-2 text-sm font-semibold leading-6 text-[#475569]">{item.body}</p>
                  </article>
                ))}
              </div>
            </div>
          </div>
          <div className="grid content-between border-t border-[#cbd5e1] bg-[#eff6ff] p-5 sm:p-6 xl:border-l xl:border-t-0">
            <div>
              <p className="text-xs font-black uppercase tracking-[0.16em] text-[#475569]">Next fixture</p>
              <p className="mt-2 text-2xl font-black tracking-tight text-[#10231a]">
                {nextMatch ? `${nextMatch.teamName || 'Our team'} v ${nextMatch.opponent}` : 'No fixture created'}
              </p>
              <p className="mt-2 text-sm font-semibold leading-6 text-[#475569]">
                {nextMatch ? formatMatchDate(nextMatch) : 'Create a fixture to request a scorer and prepare the live board.'}
              </p>
            </div>
            <div className="mt-5 grid grid-cols-2 gap-2">
              <MatchMetric label="Live" value={liveMatches} isLoading={isLoading} />
              <MatchMetric label="Requests" value={scorerRequests} isLoading={isLoading} />
              <MatchMetric label="Upcoming" value={upcomingMatches} isLoading={isLoading} />
              <MatchMetric label="Goals" value={goalCount} isLoading={isLoading} />
            </div>
            <p className="mt-4 text-sm font-semibold leading-6 text-[#475569]">
              Keep one active fixture visible so staff actions, scorer access, and parent updates stay aligned.
            </p>
          </div>
        </div>
      </section>

      {errorMessage ? <NoticeBanner title="Match Day action failed" message={errorMessage} /> : null}

      <section className="grid gap-3 md:grid-cols-4">
        {matchDaySummary.map((item) => (
          <article key={item.label} className="rounded-lg border border-[#cbd5e1] bg-white p-5 shadow-sm shadow-[#2563eb]/10">
            <p className="text-xs font-black uppercase tracking-[0.16em] text-[#2563eb]">{item.label}</p>
            <p className="mt-3 text-4xl font-black tracking-tight text-[#10231a]">{isLoading ? '...' : item.value}</p>
            <p className="mt-2 text-sm font-semibold leading-6 text-[#475569]">{item.caption}</p>
          </article>
        ))}
      </section>

      <section className="overflow-hidden rounded-lg border border-[#cbd5e1] bg-white shadow-sm shadow-[#2563eb]/10">
        <div className={sectionHeaderClass}>
          <p className={eyebrowClass}>Fixture setup</p>
          <h2 className="mt-2 text-2xl font-black tracking-tight text-[#10231a]">Create fixture</h2>
          <p className={`mt-2 max-w-3xl ${bodyTextClass}`}>
            Set the opponent, team, venue, and parent-facing scorer request before the fixture appears on the live board.
          </p>
        </div>
        <form className="space-y-4" onSubmit={handleCreateMatch}>
          <div className="space-y-4 px-5 py-5 sm:px-6">
          <div className="grid gap-4 md:grid-cols-2">
            <label className="block">
              <span className={labelClass}>Opponent</span>
              <input
                value={form.opponent}
                onChange={(event) => updateForm({ opponent: event.target.value })}
                className={inputClass}
                required
              />
            </label>

            <label className="block">
              <span className={labelClass}>Team</span>
              <select
                value={form.teamId}
                onChange={(event) => updateForm({ teamId: event.target.value })}
                className={inputClass}
              >
                <option value="">Current or all teams</option>
                {teams.map((team) => (
                  <option key={team.id} value={team.id}>{team.name}</option>
                ))}
              </select>
            </label>

            <label className="block">
              <span className={labelClass}>Date</span>
              <input
                type="date"
                value={form.matchDate}
                onChange={(event) => updateForm({ matchDate: event.target.value })}
                className={inputClass}
              />
            </label>

            <label className="block">
              <span className={labelClass}>Kick off</span>
              <input
                type="time"
                value={form.kickoffTime}
                onChange={(event) => updateForm({ kickoffTime: event.target.value })}
                className={inputClass}
              />
            </label>

            <label className="block">
              <span className={labelClass}>Home or away</span>
              <select
                value={form.homeAway}
                onChange={(event) => updateForm({ homeAway: event.target.value })}
                className={inputClass}
              >
                {MATCH_DAY_HOME_AWAY_OPTIONS.map((option) => (
                  <option key={option.value} value={option.value}>{option.label}</option>
                ))}
              </select>
            </label>

            <label className="block">
              <span className={labelClass}>Reuse location</span>
              <select
                value=""
                onChange={(event) => applyLocation(event.target.value)}
                className={inputClass}
              >
                <option value="">Choose saved location</option>
                {locations.map((location) => (
                  <option key={location.id} value={location.id}>{location.name}</option>
                ))}
              </select>
            </label>

            <label className="block">
              <span className={labelClass}>Venue</span>
              <input
                value={form.venueName}
                onChange={(event) => updateForm({ venueName: event.target.value })}
                className={inputClass}
              />
            </label>

            <label className="block">
              <span className={labelClass}>Address</span>
              <input
                value={form.venueAddress}
                onChange={(event) => updateForm({ venueAddress: event.target.value })}
                className={inputClass}
              />
            </label>
          </div>

          <label className="block">
            <span className={labelClass}>Scorer request message</span>
            <textarea
              value={form.scorerRequestMessage}
              onChange={(event) => updateForm({ scorerRequestMessage: event.target.value })}
              className={`${inputClass} min-h-24`}
            />
          </label>

          <label className="block">
            <span className={labelClass}>Match notes</span>
            <textarea
              value={form.notes}
              onChange={(event) => updateForm({ notes: event.target.value })}
              className={`${inputClass} min-h-24`}
            />
          </label>

          <div className="grid gap-4 md:grid-cols-2">
            <label className="flex min-h-11 items-center gap-3 rounded-lg border border-[#cbd5e1] bg-[#f8fafc] px-4 py-3">
              <input
                type="checkbox"
                checked={form.enableMotmPoll}
                onChange={(event) => updateForm({ enableMotmPoll: event.target.checked })}
                className="h-4 w-4 accent-[#2563eb]"
              />
              <span className="text-sm font-black text-[#10231a]">Create Player of the Match vote at full time</span>
            </label>

            <label className="block">
              <span className={labelClass}>Vote expiry hours</span>
              <input
                type="number"
                min="1"
                max="72"
                value={form.motmPollExpiryHours}
                onChange={(event) => updateForm({ motmPollExpiryHours: event.target.value })}
                disabled={!form.enableMotmPoll}
                className={inputClass}
              />
            </label>
          </div>

          <button
            type="submit"
            disabled={isSaving}
            className={`${primaryButtonClass} w-full sm:w-auto`}
          >
            {isSaving ? 'Creating...' : 'Create fixture'}
          </button>
          </div>
        </form>
      </section>

      <section className="overflow-hidden rounded-lg border border-[#cbd5e1] bg-white shadow-sm shadow-[#2563eb]/10">
        <div className={sectionHeaderClass}>
          <p className={eyebrowClass}>Live board</p>
          <h2 className="mt-2 text-2xl font-black tracking-tight text-[#10231a]">Run live and upcoming matches</h2>
          <p className={`mt-2 max-w-3xl ${bodyTextClass}`}>
            Start the match, update the score, select parent scorers, and record goals with scorer and assist detail.
          </p>
        </div>
        <div className="px-5 py-5 sm:px-6">
        {isLoading ? (
          <p className="rounded-lg border border-[#cbd5e1] bg-[#f8fafc] px-4 py-5 text-sm font-bold text-[#475569] shadow-sm shadow-[#2563eb]/10">
            Loading match day...
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
          <div className="rounded-lg border border-[#cbd5e1] bg-[#f8fafc] px-4 py-5 shadow-sm shadow-[#2563eb]/10">
            <p className="text-base font-black text-[#10231a]">No live or upcoming matches yet.</p>
            <p className="mt-2 text-sm font-semibold leading-6 text-[#475569]">
              Create the fixture above before requesting a scorer or publishing parent updates.
            </p>
          </div>
        )}
        </div>
      </section>

      <section className="overflow-hidden rounded-lg border border-[#cbd5e1] bg-white shadow-sm shadow-[#2563eb]/10">
        <div className="grid gap-4 border-b border-[#cbd5e1] bg-[#f8fafc] px-5 py-5 sm:px-6 lg:grid-cols-[minmax(0,1fr)_auto] lg:items-start">
          <div>
            <p className={eyebrowClass}>Results archive</p>
            <h2 className="mt-2 text-2xl font-black tracking-tight text-[#10231a]">Previous games</h2>
            <p className={`mt-2 max-w-3xl ${bodyTextClass}`}>
              Review completed results. Reset the list when a new season starts.
            </p>
          </div>
          <button
            type="button"
            onClick={handleResetPrevious}
            disabled={isSaving || previousMatches.length === 0}
            className={`${secondaryButtonClass} w-full sm:w-auto`}
          >
            Reset previous games
          </button>
        </div>
        <div className="px-5 py-5 sm:px-6">
        {previousMatches.length > 0 ? (
          <div className="grid gap-3 md:grid-cols-2">
            {previousMatches.map((match) => (
              <PreviousGameCard key={match.id} match={match} onOpen={setSelectedPreviousMatch} />
            ))}
          </div>
        ) : (
          <div className="rounded-lg border border-[#cbd5e1] bg-[#f8fafc] px-4 py-5 shadow-sm shadow-[#2563eb]/10">
            <p className="text-base font-black text-[#10231a]">No previous games are showing.</p>
            <p className="mt-2 text-sm font-semibold leading-6 text-[#475569]">
              Completed fixtures appear here after full time so staff can review goals and results.
            </p>
          </div>
        )}
        </div>
      </section>

      <PreviousGameDetailModal match={selectedPreviousMatch} onClose={() => setSelectedPreviousMatch(null)} />
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
  const currentMinute = getCurrentMatchMinute(match)

  return (
    <article className="rounded-lg border border-[#cbd5e1] bg-white p-5 shadow-sm shadow-[#2563eb]/10">
      <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
        <div className="min-w-0">
          <div className="flex flex-wrap gap-2">
            <span className="inline-flex w-fit rounded-lg border border-[#bfdbfe] bg-[#eff6ff] px-3 py-1 text-xs font-black text-[#2563eb]">
              {match.status.replace(/_/g, ' ')}
            </span>
            <span className="inline-flex w-fit rounded-lg border border-[#cbd5e1] bg-[#f8fafc] px-3 py-1 text-xs font-black text-[#475569]">
              {match.homeAway}
            </span>
            {match.teamName ? (
              <span className="inline-flex w-fit rounded-lg border border-[#cbd5e1] bg-[#f8fafc] px-3 py-1 text-xs font-black text-[#475569]">
                {match.teamName}
              </span>
            ) : null}
          </div>
          <h4 className="mt-3 text-lg font-black text-[#10231a]">{match.teamName || 'Our team'} v {match.opponent}</h4>
          <p className="mt-1 text-sm font-semibold text-[#475569]">{formatMatchDate(match)}</p>
          {match.venueName ? <p className="mt-1 text-sm font-semibold text-[#475569]">{match.venueName}</p> : null}
          {match.notes ? <p className="mt-2 whitespace-pre-wrap text-sm font-semibold leading-6 text-[#475569]">{match.notes}</p> : null}
        </div>

        <div className="rounded-lg border border-[#cbd5e1] bg-[#eff6ff] p-4 text-center shadow-sm shadow-[#2563eb]/10">
          <p className="text-xs font-black uppercase tracking-[0.16em] text-[#475569]">Live score</p>
          <p className="mt-2 text-4xl font-black text-[#10231a]">
            {getClubScore(match)} - {getOpponentScore(match)}
          </p>
          {currentMinute ? (
            <p className="mt-2 text-sm font-black text-[#475569]">{currentMinute} min</p>
          ) : null}
        </div>
      </div>

      <div className="mt-5 grid gap-4 lg:grid-cols-2">
        <div className={panelClass}>
          <h5 className="text-sm font-black text-[#10231a]">Score and status</h5>
          {match.status === 'scheduled' || match.status === 'scorer_request' ? (
            <button
              type="button"
              onClick={() => onStatusChange(match, 'live')}
              disabled={isBusy}
              className="mt-3 inline-flex min-h-10 w-full items-center justify-center rounded-lg bg-[#2563eb] px-4 py-2 text-sm font-black text-white transition hover:bg-[#1d4ed8] disabled:cursor-not-allowed disabled:opacity-60 sm:w-auto"
            >
              Start match
            </button>
          ) : null}
          <div className="mt-3 grid gap-3 sm:grid-cols-3">
            <label className="block">
              <span className={smallLabelClass}>Home</span>
              <input
                type="number"
                min="0"
                value={scoreDraft.homeScore}
                onChange={(event) => onScoreDraftChange({ homeScore: event.target.value })}
                className={compactInputClass}
              />
            </label>
            <label className="block">
              <span className={smallLabelClass}>Away</span>
              <input
                type="number"
                min="0"
                value={scoreDraft.awayScore}
                onChange={(event) => onScoreDraftChange({ awayScore: event.target.value })}
                className={compactInputClass}
              />
            </label>
            <button
              type="button"
              onClick={() => onScoreSave(match)}
              disabled={isBusy}
              className="mt-auto inline-flex min-h-10 items-center justify-center rounded-lg bg-[#2563eb] px-4 py-2 text-sm font-black text-white transition hover:bg-[#1d4ed8] disabled:cursor-not-allowed disabled:opacity-60"
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
                className={`inline-flex min-h-10 items-center justify-center rounded-lg border px-3 py-2 text-sm font-black transition disabled:cursor-not-allowed disabled:opacity-60 ${
                  match.status === option.value
                    ? 'border-[#2563eb] bg-[#2563eb] text-white'
                    : 'border-[#cbd5e1] bg-white text-[#10231a] hover:border-[#3b82f6] hover:bg-[#eff6ff]'
                }`}
              >
                {option.label}
              </button>
            ))}
          </div>
        </div>

        <div className={panelClass}>
          <h5 className="text-sm font-black text-[#10231a]">Parent scorer requests</h5>
          {match.scorerInterests.length > 0 ? (
            <div className="mt-3 space-y-2">
              {match.scorerInterests.map((interest) => {
                const isSelected = selectedParentLinkIds.has(String(interest.parentLinkId))

                return (
                  <div key={interest.id} className="rounded-lg border border-[#cbd5e1] bg-white p-3 shadow-sm shadow-[#2563eb]/10">
                    <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                      <div className="min-w-0">
                        <p className="text-sm font-black text-[#10231a]">{interest.parentEmail || interest.parentName || 'Parent'}</p>
                        <p className="mt-1 text-xs font-semibold text-[#475569]">
                          {interest.playerName ? `Linked to ${interest.playerName}` : 'Parent portal volunteer'}
                        </p>
                        {interest.message ? <p className="mt-2 text-sm font-semibold text-[#475569]">{interest.message}</p> : null}
                      </div>
                      <button
                        type="button"
                        onClick={() => onSelectScorer(match, interest)}
                        disabled={isBusy || isSelected}
                        className={secondaryButtonClass}
                      >
                        {isSelected ? 'Selected' : 'Select scorer'}
                      </button>
                    </div>
                  </div>
                )
              })}
            </div>
          ) : (
            <div className="mt-3 rounded-lg border border-[#cbd5e1] bg-white px-4 py-5">
              <p className="text-sm font-black text-[#10231a]">No parents have volunteered yet.</p>
              <p className="mt-2 text-sm font-semibold leading-6 text-[#475569]">
                Keep the scorer request open or select a staff member to run the score from the touchline.
              </p>
            </div>
          )}
        </div>
      </div>

      <form className="mt-4 rounded-lg border border-[#cbd5e1] bg-[#f8fafc] p-4 shadow-sm shadow-[#2563eb]/10" onSubmit={(event) => onAddGoal(event, match)}>
        <h5 className="text-sm font-black text-[#10231a]">Add goal</h5>
        <div className="mt-3 grid gap-3 md:grid-cols-3">
          <label className="block">
            <span className={smallLabelClass}>Team</span>
            <select
              value={goalForm.teamSide}
              onChange={(event) => onGoalFormChange(match.id, { teamSide: event.target.value })}
              className={compactInputClass}
            >
              <option value="club">Our team</option>
              <option value="opponent">Opponent</option>
            </select>
          </label>
          <label className="block">
            <span className={smallLabelClass}>Scorer player</span>
            <select
              value=""
              onChange={(event) => onPlayerPick(match.id, 'scorer', event.target.value)}
              className={compactInputClass}
            >
              <option value="">Choose player</option>
              {players.map((player) => (
                <option key={player.id} value={player.id}>{player.playerName}</option>
              ))}
            </select>
          </label>
          <label className="block">
            <span className={smallLabelClass}>Scorer name</span>
            <input
              value={goalForm.scorerName}
              onChange={(event) => onGoalFormChange(match.id, { scorerName: event.target.value })}
              className={compactInputClass}
            />
          </label>
          <label className="block">
            <span className={smallLabelClass}>Scorer shirt</span>
            <input
              value={goalForm.scorerShirtNumber}
              onChange={(event) => onGoalFormChange(match.id, { scorerShirtNumber: event.target.value })}
              className={compactInputClass}
            />
          </label>
          <label className="block">
            <span className={smallLabelClass}>Assist player</span>
            <select
              value=""
              onChange={(event) => onPlayerPick(match.id, 'assist', event.target.value)}
              className={compactInputClass}
            >
              <option value="">Choose player</option>
              {players.map((player) => (
                <option key={player.id} value={player.id}>{player.playerName}</option>
              ))}
            </select>
          </label>
          <label className="block">
            <span className={smallLabelClass}>Assist name</span>
            <input
              value={goalForm.assistName}
              onChange={(event) => onGoalFormChange(match.id, { assistName: event.target.value })}
              className={compactInputClass}
            />
          </label>
          <label className="block">
            <span className={smallLabelClass}>Assist shirt</span>
            <input
              value={goalForm.assistShirtNumber}
              onChange={(event) => onGoalFormChange(match.id, { assistShirtNumber: event.target.value })}
              className={compactInputClass}
            />
          </label>
          <button
            type="submit"
            disabled={isBusy}
            className="mt-auto inline-flex min-h-10 items-center justify-center rounded-lg bg-[#2563eb] px-4 py-2 text-sm font-black text-white transition hover:bg-[#1d4ed8] disabled:cursor-not-allowed disabled:opacity-60"
          >
            Add goal
          </button>
        </div>
      </form>

      {match.events.length > 0 ? (
        <div className="mt-4 space-y-2">
          {match.events.slice(0, 6).map((event) => (
            <div key={event.id} className="rounded-lg border border-[#cbd5e1] bg-[#f8fafc] px-4 py-3 shadow-sm shadow-[#2563eb]/10">
              <p className="text-sm font-black text-[#10231a]">
                {event.eventType === 'goal' ? 'Goal' : 'Update'} / {event.homeScore} - {event.awayScore}
              </p>
              <p className="mt-1 text-xs font-semibold text-[#475569]">
                {event.minute !== null ? `${event.minute} min / ` : ''}
                {event.scorerInitials || event.scorerName || 'Score update'}
                {event.scorerShirtNumber ? ` #${event.scorerShirtNumber}` : ''}
                {event.assistInitials || event.assistName ? ` / Assist ${event.assistInitials || event.assistName}` : ''}
                {event.assistShirtNumber ? ` #${event.assistShirtNumber}` : ''}
              </p>
            </div>
          ))}
        </div>
      ) : null}
    </article>
  )
}

function MatchMetric({ isLoading, label, value }) {
  return (
    <div className="rounded-lg border border-[#cbd5e1] bg-white px-3 py-3 shadow-sm">
      <p className="text-[11px] font-black uppercase tracking-[0.14em] text-[#2563eb]">{label}</p>
      <p className="mt-2 text-2xl font-black text-[#10231a]">{isLoading ? '...' : value}</p>
    </div>
  )
}
