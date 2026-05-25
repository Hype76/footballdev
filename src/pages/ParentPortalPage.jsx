import { useEffect, useMemo, useState } from 'react'
import { PreviousGameCard, PreviousGameDetailModal } from '../components/match-day/PreviousGameCard.jsx'
import { NoticeBanner } from '../components/ui/NoticeBanner.jsx'
import { PageHeader } from '../components/ui/PageHeader.jsx'
import { SectionCard } from '../components/ui/SectionCard.jsx'
import { useToast } from '../components/ui/toast-context.js'
import { useAuth } from '../lib/auth.js'
import {
  getCurrentPushSubscription,
  getPushSupportState,
  sendMatchDayPushNotification,
  subscribeToParentPush,
  unsubscribeFromParentPush,
} from '../lib/push-notifications.js'
import {
  addMatchDayGoalAsScorer,
  expressMatchDayScorerInterest,
  getParentPortalMatchDays,
  getParentPortalMatchDayPlayers,
  updateMatchDayScoreAsScorer,
} from '../lib/supabase.js'
import { THEME_CHANGED_EVENT } from '../lib/theme.js'

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

function getClubScore(match) {
  return match.homeAway === 'away' ? match.awayScore : match.homeScore
}

function getOpponentScore(match) {
  return match.homeAway === 'away' ? match.homeScore : match.awayScore
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

function getPlayerSortName(player) {
  return String(player.playerName ?? '').trim().toLowerCase()
}

function orderPlayersWithRecentScorers(players, match) {
  const recentScorerNames = new Map()

  ;(match.events ?? [])
    .filter((event) => event.eventType === 'goal')
    .forEach((event) => {
      const scorerName = String(event.scorerName ?? '').trim().toLowerCase()

      if (scorerName && !recentScorerNames.has(scorerName)) {
        recentScorerNames.set(scorerName, recentScorerNames.size)
      }
    })

  return [...players].sort((left, right) => {
    const leftRecentRank = recentScorerNames.get(getPlayerSortName(left))
    const rightRecentRank = recentScorerNames.get(getPlayerSortName(right))

    if (leftRecentRank !== undefined || rightRecentRank !== undefined) {
      if (leftRecentRank === undefined) return 1
      if (rightRecentRank === undefined) return -1
      return leftRecentRank - rightRecentRank
    }

    return getPlayerSortName(left).localeCompare(getPlayerSortName(right))
  })
}

export function ParentPortalPage() {
  const { user } = useAuth()
  const { showToast } = useToast()
  const links = Array.isArray(user?.parentPortalLinks) ? user.parentPortalLinks : []
  const [selectedLinkId, setSelectedLinkId] = useState('')
  const [matches, setMatches] = useState([])
  const [players, setPlayers] = useState([])
  const [goalForms, setGoalForms] = useState({})
  const [scoreDrafts, setScoreDrafts] = useState({})
  const [clockNow, setClockNow] = useState(() => Date.now())
  const [activeMatchId, setActiveMatchId] = useState('')
  const [isLoadingMatches, setIsLoadingMatches] = useState(false)
  const [pushState, setPushState] = useState(() => getPushSupportState())
  const [hasPushSubscription, setHasPushSubscription] = useState(false)
  const [isUpdatingPush, setIsUpdatingPush] = useState(false)
  const [matchError, setMatchError] = useState('')
  const [selectedPreviousMatch, setSelectedPreviousMatch] = useState(null)
  const selectedLink = links.find((link) => link.id === selectedLinkId)
    ?? links.find((link) => link.id === user?.selectedParentLinkId)
    ?? links[0]
  const otherLinks = links.filter((link) => link.id !== selectedLink?.id)
  const activeMatches = useMemo(() => matches.filter((match) => !isPreviousMatch(match)), [matches])
  const previousMatches = useMemo(() => matches.filter(isPreviousMatch), [matches])
  const squadPlayers = useMemo(
    () =>
      players
        .filter((player) => String(player.status ?? 'active') !== 'archived')
        .sort((left, right) => String(left.playerName ?? '').localeCompare(String(right.playerName ?? ''))),
    [players],
  )
  const parentPortalSummary = [
    {
      label: 'Linked children',
      value: links.length,
      caption: 'Children this parent account can open.',
    },
    {
      label: 'Live or upcoming',
      value: activeMatches.length,
      caption: 'Match day cards currently active.',
    },
    {
      label: 'Previous games',
      value: previousMatches.length,
      caption: 'Completed fixtures shared by the club.',
    },
  ]

  useEffect(() => {
    if (!selectedLink?.id) {
      return
    }

    window.dispatchEvent(
      new CustomEvent(THEME_CHANGED_EVENT, {
        detail: {
          mode: selectedLink.themeMode || user?.themeMode || 'system',
          accent: selectedLink.themeAccent || user?.themeAccent || 'yellow',
          buttonStyle: selectedLink.themeButtonStyle || user?.themeButtonStyle || 'solid',
        },
      }),
    )
  }, [selectedLink, user?.themeAccent, user?.themeButtonStyle, user?.themeMode])

  async function loadMatches() {
    if (!selectedLink?.id) {
      setMatches([])
      return
    }

    const nextMatches = await getParentPortalMatchDays({ parentLinkId: selectedLink.id })
    setMatches(nextMatches)
  }

  useEffect(() => {
    let isCurrent = true

    async function runLoad({ showLoading = false } = {}) {
      if (!selectedLink?.id) {
        setMatches([])
        setPlayers([])
        return
      }

      if (showLoading) {
        setIsLoadingMatches(true)
        setMatchError('')
      }

      try {
        const [nextMatches, nextPlayers] = await Promise.all([
          getParentPortalMatchDays({ parentLinkId: selectedLink.id }),
          getParentPortalMatchDayPlayers({ parentLinkId: selectedLink.id }),
        ])

        if (isCurrent) {
          setMatches(nextMatches)
          setPlayers(nextPlayers)
        }
      } catch (error) {
        console.error(error)

        if (isCurrent) {
          if (showLoading) {
            setMatches([])
            setPlayers([])
          }
          setMatchError(error.message || 'Match Day could not be loaded.')
        }
      } finally {
        if (isCurrent && showLoading) {
          setIsLoadingMatches(false)
        }
      }
    }

    void runLoad({ showLoading: true })
    const intervalId = window.setInterval(() => {
      void runLoad()
    }, 60000)

    return () => {
      isCurrent = false
      window.clearInterval(intervalId)
    }
  }, [selectedLink?.id])

  useEffect(() => {
    const intervalId = window.setInterval(() => {
      setClockNow(Date.now())
    }, 60000)

    return () => window.clearInterval(intervalId)
  }, [])

  useEffect(() => {
    let isCurrent = true

    async function loadPushState() {
      const nextSupportState = getPushSupportState()
      setPushState(nextSupportState)

      if (!nextSupportState.isSupported) {
        setHasPushSubscription(false)
        return
      }

      try {
        const subscription = await getCurrentPushSubscription()

        if (isCurrent) {
          setHasPushSubscription(Boolean(subscription))
        }
      } catch (error) {
        console.error(error)

        if (isCurrent) {
          setHasPushSubscription(false)
        }
      }
    }

    void loadPushState()

    return () => {
      isCurrent = false
    }
  }, [selectedLink?.id])

  const handleVolunteer = async (match) => {
    if (!selectedLink?.id) {
      return
    }

    if (!confirmMatchDayAction('Send your interest to become the Match Day scorer for this game?')) {
      return
    }

    setActiveMatchId(match.id)
    setMatchError('')

    try {
      await expressMatchDayScorerInterest({
        parentLinkId: selectedLink.id,
        matchDayId: match.id,
      })
      await loadMatches()
      showToast({ title: 'Interest sent', message: 'The coach or manager can now select you as scorer.' })
    } catch (error) {
      console.error(error)
      setMatchError(error.message || 'Your scorer interest could not be saved.')
    } finally {
      setActiveMatchId('')
    }
  }

  const handleEnableNotifications = async () => {
    if (!selectedLink?.id) {
      return
    }

    if (!confirmMatchDayAction('Enable Match Day notifications on this device?')) {
      return
    }

    setIsUpdatingPush(true)
    setMatchError('')

    try {
      await subscribeToParentPush({ parentLinkId: selectedLink.id })
      setHasPushSubscription(true)
      setPushState(getPushSupportState())
      showToast({ title: 'Notifications enabled', message: 'Match Day updates can now appear on this device.' })
    } catch (error) {
      console.error(error)
      setMatchError(error.message || 'Notifications could not be enabled.')
      setPushState(getPushSupportState())
    } finally {
      setIsUpdatingPush(false)
    }
  }

  const handleDisableNotifications = async () => {
    if (!selectedLink?.id) {
      return
    }

    if (!confirmMatchDayAction('Disable Match Day notifications on this device?')) {
      return
    }

    setIsUpdatingPush(true)
    setMatchError('')

    try {
      await unsubscribeFromParentPush({ parentLinkId: selectedLink.id })
      setHasPushSubscription(false)
      showToast({ title: 'Notifications disabled', message: 'This device will no longer receive Match Day push notifications.' })
    } catch (error) {
      console.error(error)
      setMatchError(error.message || 'Notifications could not be disabled.')
    } finally {
      setIsUpdatingPush(false)
    }
  }

  const handleScoreSave = async (match) => {
    if (!selectedLink?.id) {
      return
    }

    const draft = scoreDrafts[match.id] ?? {
      homeScore: match.homeScore,
      awayScore: match.awayScore,
      status: match.status,
    }

    if (!confirmMatchDayAction(`Save this score as ${draft.homeScore || 0} - ${draft.awayScore || 0} for everyone following the match?`)) {
      return
    }

    setActiveMatchId(match.id)
    setMatchError('')

    try {
      await updateMatchDayScoreAsScorer({
        parentLinkId: selectedLink.id,
        matchDayId: match.id,
        homeScore: draft.homeScore,
        awayScore: draft.awayScore,
        status: draft.status,
      })
      if (draft.status === 'half_time' || draft.status === 'second_half' || draft.status === 'extra_time' || draft.status === 'penalties' || draft.status === 'full_time') {
        void sendMatchDayPushNotification({
          matchDayId: match.id,
          type: draft.status,
          parentLinkId: selectedLink.id,
        })
      }
      await loadMatches()
      showToast({ title: 'Score updated', message: 'The live score has been updated.' })
    } catch (error) {
      console.error(error)
      setMatchError(error.message || 'Score could not be updated.')
    } finally {
      setActiveMatchId('')
    }
  }

  const handleStartMatch = async (match) => {
    if (!selectedLink?.id) {
      return
    }

    if (!confirmMatchDayAction('Start this match and begin the live match clock?')) {
      return
    }

    setActiveMatchId(match.id)
    setMatchError('')

    try {
      await updateMatchDayScoreAsScorer({
        parentLinkId: selectedLink.id,
        matchDayId: match.id,
        homeScore: match.homeScore,
        awayScore: match.awayScore,
        status: 'live',
      })
      void sendMatchDayPushNotification({
        matchDayId: match.id,
        type: 'live',
        parentLinkId: selectedLink.id,
      })
      await loadMatches()
      showToast({ title: 'Match started', message: 'The live match clock has started.' })
    } catch (error) {
      console.error(error)
      setMatchError(error.message || 'Match could not be started.')
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

    if (!selectedLink?.id) {
      return
    }

    if (!confirmMatchDayAction('Add this goal to the live Match Day feed?')) {
      return
    }

    setActiveMatchId(match.id)
    setMatchError('')

    try {
      const eventId = await addMatchDayGoalAsScorer({
        parentLinkId: selectedLink.id,
        matchDayId: match.id,
        goal: {
          ...(goalForms[match.id] ?? EMPTY_GOAL_FORM),
          minute: getCurrentMatchMinute(match, Date.now()) ?? '',
        },
      })
      void sendMatchDayPushNotification({
        matchDayId: match.id,
        type: 'goal',
        eventId,
        parentLinkId: selectedLink.id,
      })
      setGoalForms((currentForms) => ({
        ...currentForms,
        [match.id]: EMPTY_GOAL_FORM,
      }))
      await loadMatches()
      showToast({ title: 'Goal added', message: 'The live feed has been updated.' })
    } catch (error) {
      console.error(error)
      setMatchError(error.message || 'Goal could not be added.')
    } finally {
      setActiveMatchId('')
    }
  }

  return (
    <div className="space-y-5 sm:space-y-6">
      <PageHeader
        eyebrow="Parent Portal"
        title="Match Day"
        description="Follow live scores, volunteer as a scorer, and review previous game results for your linked child."
      />

      <section className="grid gap-4 md:grid-cols-3">
        {parentPortalSummary.map((item) => (
          <article key={item.label} className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm shadow-slate-200/80">
            <p className="text-xs font-black uppercase tracking-[0.16em] text-slate-500">{item.label}</p>
            <p className="mt-3 text-4xl font-black tracking-tight text-slate-950">{isLoadingMatches ? '...' : item.value}</p>
            <p className="mt-2 text-sm leading-6 text-slate-600">{item.caption}</p>
          </article>
        ))}
      </section>

      <section className="rounded-2xl border border-emerald-200 bg-emerald-50 p-5 shadow-sm shadow-slate-200/80">
        <p className="text-xs font-black uppercase tracking-[0.16em] text-emerald-700">Parent portal rule</p>
        <p className="mt-2 text-sm leading-6 text-slate-700">
          Parents can view club-shared updates and respond where invited. Team selection, scores, reports, and match day controls remain owned by club staff.
        </p>
      </section>

      {matchError ? <NoticeBanner title="Match Day action failed" message={matchError} /> : null}

      {otherLinks.length > 0 ? (
        <SectionCard title="Child links" description="If this account is linked to more than one child or team, select the child to view.">
          <div className="mb-4">
            <label htmlFor="parent-portal-child" className="mb-2 block text-sm font-bold text-slate-950">
              Current child
            </label>
            <select
              id="parent-portal-child"
              value={selectedLink?.id || ''}
              onChange={(event) => setSelectedLinkId(event.target.value)}
              className="min-h-11 w-full rounded-xl border border-slate-200 bg-slate-50 px-3 py-2 text-sm text-slate-950 outline-none transition focus:border-emerald-500 focus:bg-white"
            >
              {links.map((link) => (
                <option key={link.id} value={link.id}>
                  {link.playerName} | {link.teamName || 'No team'} | {link.clubName || 'No club'}
                </option>
              ))}
            </select>
          </div>
          <div className="space-y-2">
            {otherLinks.map((link) => (
              <button
                key={link.id}
                type="button"
                onClick={() => setSelectedLinkId(link.id)}
                className="block w-full rounded-xl border border-slate-200 bg-slate-50 px-4 py-3 text-left transition hover:border-emerald-300 hover:bg-white"
              >
                <p className="text-sm font-bold text-slate-950">{link.playerName}</p>
                <p className="mt-1 text-xs text-slate-500">{link.teamName || 'No team'} | {link.clubName || 'No club'}</p>
              </button>
            ))}
          </div>
        </SectionCard>
      ) : null}

      <SectionCard title="Match Day notifications" description="Enable phone notifications for goals, scorer updates, half time, and full time.">
        <PushNotificationPanel
          hasPushSubscription={hasPushSubscription}
          isUpdatingPush={isUpdatingPush}
          onDisable={handleDisableNotifications}
          onEnable={handleEnableNotifications}
          pushState={pushState}
        />
      </SectionCard>

      <SectionCard title="Live and upcoming" description="Live score updates appear here during the match.">
        {!selectedLink ? (
          <p className="rounded-xl border border-dashed border-slate-300 bg-slate-50 px-4 py-5 text-sm text-slate-600">
            No child links are active for this parent account.
          </p>
        ) : isLoadingMatches ? (
          <p className="rounded-xl border border-slate-200 bg-slate-50 px-4 py-5 text-sm text-slate-600">
            Loading Match Day...
          </p>
        ) : activeMatches.length > 0 ? (
          <div className="space-y-4">
            {activeMatches.map((match) => (
              <ParentMatchCard
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
                    status: match.status,
                    ...(currentDrafts[match.id] ?? {}),
                    ...updates,
                  },
                }))}
                onScoreSave={handleScoreSave}
                onStartMatch={handleStartMatch}
                onVolunteer={handleVolunteer}
                now={clockNow}
                players={squadPlayers}
                scoreDraft={scoreDrafts[match.id] ?? { homeScore: match.homeScore, awayScore: match.awayScore, status: match.status }}
              />
            ))}
          </div>
        ) : (
          <p className="rounded-xl border border-dashed border-slate-300 bg-slate-50 px-4 py-5 text-sm text-slate-600">
            No Match Day updates are available for this child right now.
          </p>
        )}
      </SectionCard>

      <SectionCard title="Previous games" description="Completed results from earlier Match Day fixtures.">
        {previousMatches.length > 0 ? (
          <div className="grid gap-3 md:grid-cols-2">
            {previousMatches.map((match) => (
              <PreviousGameCard key={match.id} match={match} onOpen={setSelectedPreviousMatch} />
            ))}
          </div>
        ) : (
          <p className="rounded-xl border border-dashed border-slate-300 bg-slate-50 px-4 py-5 text-sm text-slate-600">
            No previous games have been shared yet.
          </p>
        )}
      </SectionCard>

      <PreviousGameDetailModal match={selectedPreviousMatch} onClose={() => setSelectedPreviousMatch(null)} />
    </div>
  )
}

function PushNotificationPanel({
  hasPushSubscription,
  isUpdatingPush,
  onDisable,
  onEnable,
  pushState,
}) {
  if (!pushState.isSupported) {
    return (
      <div className="rounded-xl border border-slate-200 bg-slate-50 px-4 py-4">
        <p className="text-sm font-bold text-slate-950">Notifications are not available on this device yet.</p>
        <p className="mt-2 text-sm leading-6 text-slate-600">{pushState.reason}</p>
      </div>
    )
  }

  return (
    <div className="flex flex-col gap-4 rounded-2xl border border-slate-200 bg-slate-50 px-4 py-4 sm:flex-row sm:items-center sm:justify-between">
      <div className="min-w-0">
        <p className="text-sm font-bold text-slate-950">
          {hasPushSubscription ? 'Notifications are enabled on this device.' : 'Enable Match Day notifications on this device.'}
        </p>
        <p className="mt-2 text-sm leading-6 text-slate-600">
          {pushState.permission === 'denied'
            ? 'Notifications are blocked in your browser settings.'
            : 'You can receive native phone notifications for goals and match status updates.'}
        </p>
      </div>
      {hasPushSubscription ? (
        <button
          type="button"
          onClick={onDisable}
          disabled={isUpdatingPush}
          className="inline-flex min-h-11 items-center justify-center rounded-xl border border-slate-200 bg-white px-5 py-3 text-sm font-bold text-slate-900 transition hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-60"
        >
          {isUpdatingPush ? 'Disabling...' : 'Disable'}
        </button>
      ) : (
        <button
          type="button"
          onClick={onEnable}
          disabled={isUpdatingPush || pushState.permission === 'denied'}
          className="inline-flex min-h-11 items-center justify-center rounded-xl bg-emerald-700 px-5 py-3 text-sm font-bold text-white transition hover:bg-emerald-800 disabled:cursor-not-allowed disabled:opacity-60"
        >
          {isUpdatingPush ? 'Enabling...' : 'Enable notifications'}
        </button>
      )}
    </div>
  )
}

function ParentMatchCard({
  activeMatchId,
  goalForm,
  match,
  onAddGoal,
  onGoalFormChange,
  onPlayerPick,
  onScoreDraftChange,
  onScoreSave,
  onStartMatch,
  onVolunteer,
  now,
  players,
  scoreDraft,
}) {
  const isBusy = activeMatchId === match.id
  const orderedPlayers = useMemo(() => orderPlayersWithRecentScorers(players, match), [match, players])
  const currentMinute = getCurrentMatchMinute(match, now)

  return (
    <article className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm shadow-slate-200/80">
      <div className="flex flex-col gap-4 md:flex-row md:items-start md:justify-between">
        <div className="min-w-0">
          <div className="flex flex-wrap gap-2">
            <span className="inline-flex w-fit rounded-full border border-slate-200 bg-slate-50 px-3 py-1 text-xs font-black text-slate-600">
              {match.status.replace(/_/g, ' ')}
            </span>
            {match.isScorer ? (
              <span className="inline-flex w-fit rounded-full border border-emerald-200 bg-emerald-50 px-3 py-1 text-xs font-black text-emerald-800">
                Selected scorer
              </span>
            ) : null}
          </div>
          <h4 className="mt-3 text-lg font-black text-slate-950">{match.teamName || 'Our team'} v {match.opponent}</h4>
          <p className="mt-1 text-sm text-slate-600">{formatMatchDate(match)}</p>
          {match.venueName ? <p className="mt-1 text-sm text-slate-600">{match.venueName}</p> : null}
          {match.scorerRequestMessage && !match.isScorer ? (
            <p className="mt-3 whitespace-pre-wrap text-sm leading-6 text-slate-600">{match.scorerRequestMessage}</p>
          ) : null}
        </div>

        <div className="rounded-2xl border border-slate-200 bg-slate-50 p-4 text-center">
          <p className="text-xs font-black uppercase tracking-[0.16em] text-slate-500">Live score</p>
          <p className="mt-2 text-4xl font-black text-slate-950">
            {getClubScore(match)} - {getOpponentScore(match)}
          </p>
          {currentMinute ? (
            <p className="mt-2 text-sm font-bold text-slate-500">{currentMinute} min</p>
          ) : null}
        </div>
      </div>

      {!match.isScorer ? (
        <div className="mt-4">
          <button
            type="button"
            onClick={() => onVolunteer(match)}
            disabled={isBusy || match.hasInterest}
            className="inline-flex min-h-11 w-full items-center justify-center rounded-xl bg-emerald-700 px-5 py-3 text-sm font-bold text-white transition hover:bg-emerald-800 disabled:cursor-not-allowed disabled:opacity-60 sm:w-auto"
          >
            {match.hasInterest ? 'Interest sent' : 'Volunteer as scorer'}
          </button>
        </div>
      ) : (
        <div className="mt-5 space-y-4">
          {match.status === 'scheduled' || match.status === 'scorer_request' ? (
            <button
              type="button"
              onClick={() => onStartMatch(match)}
              disabled={isBusy}
              className="inline-flex min-h-11 w-full items-center justify-center rounded-xl bg-emerald-700 px-5 py-3 text-sm font-bold text-white transition hover:bg-emerald-800 disabled:cursor-not-allowed disabled:opacity-60 sm:w-auto"
            >
              Start match
            </button>
          ) : null}

          <div className="rounded-2xl border border-slate-200 bg-slate-50 p-4">
            <h5 className="text-sm font-black text-slate-950">Update score</h5>
            <div className="mt-3 grid gap-3 sm:grid-cols-4">
              <label className="block">
                <span className="mb-1 block text-xs font-bold text-slate-500">Home</span>
                <input
                  type="number"
                  min="0"
                  value={scoreDraft.homeScore}
                  onChange={(event) => onScoreDraftChange({ homeScore: event.target.value })}
                  className="min-h-10 rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm text-slate-950"
                />
              </label>
              <label className="block">
                <span className="mb-1 block text-xs font-bold text-slate-500">Away</span>
                <input
                  type="number"
                  min="0"
                  value={scoreDraft.awayScore}
                  onChange={(event) => onScoreDraftChange({ awayScore: event.target.value })}
                  className="min-h-10 rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm text-slate-950"
                />
              </label>
              <label className="block">
                <span className="mb-1 block text-xs font-bold text-slate-500">Status</span>
                <select
                  value={scoreDraft.status}
                  onChange={(event) => onScoreDraftChange({ status: event.target.value })}
                  className="min-h-10 rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm text-slate-950"
                >
                  <option value="live">Live</option>
                  <option value="half_time">Half time</option>
                  <option value="second_half">Second half</option>
                  <option value="extra_time">Extra time</option>
                  <option value="penalties">Penalties</option>
                  <option value="full_time">Full time</option>
                </select>
              </label>
              <button
                type="button"
                onClick={() => onScoreSave(match)}
                disabled={isBusy}
                className="mt-auto inline-flex min-h-10 items-center justify-center rounded-xl bg-emerald-700 px-4 py-2 text-sm font-bold text-white transition hover:bg-emerald-800 disabled:cursor-not-allowed disabled:opacity-60"
              >
                Save
              </button>
            </div>
          </div>

          <form className="rounded-lg border border-[var(--border-color)] bg-[var(--panel-bg)] p-4" onSubmit={(event) => onAddGoal(event, match)}>
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
                  {orderedPlayers.map((player) => (
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
                  {orderedPlayers.map((player) => (
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
                className="inline-flex min-h-10 items-center justify-center rounded-lg bg-[var(--button-primary)] px-4 py-2 text-sm font-semibold text-[var(--button-primary-text)] transition hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-60"
              >
                Add goal
              </button>
            </div>
          </form>
        </div>
      )}

      {match.events.length > 0 ? (
        <div className="mt-4 space-y-2">
          {match.events.slice(0, 8).map((event) => (
            <div key={event.id} className="rounded-lg border border-[var(--border-color)] bg-[var(--panel-bg)] px-4 py-3">
              <p className="text-sm font-semibold text-[var(--text-primary)]">
                {event.eventType === 'goal' ? 'Goal' : 'Score update'} | {event.homeScore} - {event.awayScore}
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
