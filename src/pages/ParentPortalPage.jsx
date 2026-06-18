import { useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { PreviousGameCard, PreviousGameDetailModal } from '../components/match-day/PreviousGameCard.jsx'
import { FootballCalendar } from '../components/sessions/FootballCalendar.jsx'
import { NoticeBanner } from '../components/ui/NoticeBanner.jsx'
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
  getParentPortalEventInvites,
  getParentPortalMatchDays,
  getParentPortalMatchDayPlayers,
  getParentPortalSharedCalendarEvents,
  updateMatchDayScoreAsScorer,
} from '../lib/supabase.js'
import { THEME_CHANGED_EVENT } from '../lib/theme.js'
import { resolveParentPortalBranding } from '../lib/parent-portal-branding.js'
import {
  getParentMatchDayErrorMessage,
  parentMatchDayActionErrorTitle,
  parentMatchDayLoadErrorMessage,
  parentMatchDayLoadErrorTitle,
} from '../lib/parent-matchday-errors.js'
import { isRecoveryPathVisible } from '../lib/recovery-phase.js'

const EMPTY_GOAL_FORM = {
  teamSide: 'club',
  minute: '',
  scorerName: '',
  scorerShirtNumber: '',
  assistName: '',
  assistShirtNumber: '',
  notes: '',
}

const eyebrowClass = 'text-xs font-black uppercase tracking-[0.18em] text-[#047857]'
const bodyTextClass = 'text-sm font-semibold leading-6 text-[#4b5f55]'
const panelClass = 'rounded-lg border border-[#d7e5dc] bg-white p-4 shadow-sm shadow-[#047857]/10'
const softPanelClass = 'rounded-lg border border-[#d7e5dc] bg-[#f7faf8] p-4 shadow-sm shadow-[#047857]/10'
const primaryButtonClass = 'inline-flex min-h-11 items-center justify-center rounded-lg bg-[#047857] px-5 py-3 text-sm font-black text-white transition hover:bg-[#065f46] disabled:cursor-not-allowed disabled:opacity-60'
const secondaryButtonClass = 'inline-flex min-h-11 items-center justify-center rounded-lg border border-[#d7e5dc] bg-white px-5 py-3 text-sm font-black text-[#101828] transition hover:border-[#047857] hover:bg-[#ecfdf5] disabled:cursor-not-allowed disabled:opacity-60'
const fieldClass = 'min-h-10 w-full rounded-lg border border-[#d7e5dc] bg-[#f7faf8] px-3 py-2 text-sm font-semibold text-[#101828] outline-none transition focus:border-[#047857] focus:bg-white focus:ring-2 focus:ring-[#bbf7d0]'
const emptyClass = 'rounded-lg border border-[#d7e5dc] bg-white px-4 py-5 text-sm font-semibold text-[#4b5f55] shadow-sm shadow-[#047857]/10'
const noChildMessage = 'No child is linked to this parent account yet. Ask your club or team contact to send a parent invite to the email you use for this portal.'
const parentPortalSections = [
  { id: 'overview', label: 'Overview', description: 'Start here' },
  { id: 'calendar', label: 'Calendar', description: 'Shared dates' },
  { id: 'invites', label: 'Invites', description: 'Sessions and events' },
  { id: 'matches', label: 'Match cards', description: 'Live and upcoming' },
  { id: 'results', label: 'Results', description: 'Previous games' },
  { id: 'messages', label: 'Messages', description: 'Club messages', path: '/parent-messages' },
  { id: 'polls', label: 'Polls', description: 'Questions to answer', path: '/parent-polls' },
  { id: 'family', label: 'Family', description: 'Shared access', path: '/friends-family' },
  { id: 'account', label: 'Account', description: 'Notifications' },
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

function formatParentEventDate(invite) {
  if (!invite.startsAt) {
    return 'Date not set'
  }

  const date = new Date(invite.startsAt)

  if (Number.isNaN(date.getTime())) {
    return invite.startsAt
  }

  return date.toLocaleString([], {
    weekday: 'short',
    day: '2-digit',
    month: 'short',
    hour: '2-digit',
    minute: '2-digit',
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

function getParentMatchEventTitle(event) {
  return `${event.eventType === 'goal' ? 'Goal' : 'Score update'}, Score: ${event.homeScore} - ${event.awayScore}`
}

function getParentMatchEventDetail(event) {
  const detailParts = [
    event.minute !== null ? `Minute: ${event.minute}` : '',
    `Player: ${event.scorerInitials || event.scorerName || 'Score update'}${event.scorerShirtNumber ? ` #${event.scorerShirtNumber}` : ''}`,
    event.assistInitials || event.assistName
      ? `Assist: ${event.assistInitials || event.assistName}${event.assistShirtNumber ? ` #${event.assistShirtNumber}` : ''}`
      : '',
  ]

  return detailParts.filter(Boolean).join(', ')
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
  const [calendarCursor, setCalendarCursor] = useState(() => new Date())
  const [calendarView, setCalendarView] = useState('month')
  const [selectedCalendarEvent, setSelectedCalendarEvent] = useState(null)
  const [eventInvites, setEventInvites] = useState([])
  const [matches, setMatches] = useState([])
  const [players, setPlayers] = useState([])
  const [sharedCalendarEvents, setSharedCalendarEvents] = useState([])
  const [goalForms, setGoalForms] = useState({})
  const [scoreDrafts, setScoreDrafts] = useState({})
  const [clockNow, setClockNow] = useState(() => Date.now())
  const [activeMatchId, setActiveMatchId] = useState('')
  const [isLoadingMatches, setIsLoadingMatches] = useState(false)
  const [pushState, setPushState] = useState(() => getPushSupportState())
  const [hasPushSubscription, setHasPushSubscription] = useState(false)
  const [isUpdatingPush, setIsUpdatingPush] = useState(false)
  const [matchError, setMatchError] = useState('')
  const [matchErrorTitle, setMatchErrorTitle] = useState(parentMatchDayActionErrorTitle)
  const [selectedPreviousMatch, setSelectedPreviousMatch] = useState(null)
  const [activeSection, setActiveSection] = useState('overview')
  const selectedLink = links.find((link) => link.id === selectedLinkId)
    ?? links.find((link) => link.id === user?.selectedParentLinkId)
    ?? links[0]
  const otherLinks = links.filter((link) => link.id !== selectedLink?.id)
  const activeMatches = useMemo(() => matches.filter((match) => !isPreviousMatch(match)), [matches])
  const previousMatches = useMemo(() => matches.filter(isPreviousMatch), [matches])
  const parentCalendarEvents = useMemo(
    () => buildParentCalendarEvents({ eventInvites, matches, sharedCalendarEvents }),
    [eventInvites, matches, sharedCalendarEvents],
  )
  const squadPlayers = useMemo(
    () =>
      players
        .filter((player) => String(player.status ?? 'active') !== 'archived')
        .sort((left, right) => String(left.playerName ?? '').localeCompare(String(right.playerName ?? ''))),
    [players],
  )
  useEffect(() => {
    if (!selectedLink?.id) {
      return
    }

    const branding = resolveParentPortalBranding({ selectedLink, links })

    window.dispatchEvent(
      new CustomEvent(THEME_CHANGED_EVENT, {
        detail: {
          mode: branding.mode,
          accent: branding.accent,
          buttonStyle: branding.buttonStyle,
        },
      }),
    )
  }, [links, selectedLink])

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
        setEventInvites([])
        setPlayers([])
        setSharedCalendarEvents([])
        setMatchError('')
        setMatchErrorTitle(parentMatchDayLoadErrorTitle)
        return
      }

      if (showLoading) {
        setIsLoadingMatches(true)
        setMatchError('')
        setMatchErrorTitle(parentMatchDayLoadErrorTitle)
      }

      try {
        const [nextMatches, nextPlayers, nextEventInvites, nextSharedCalendarEvents] = await Promise.all([
          getParentPortalMatchDays({ parentLinkId: selectedLink.id }),
          getParentPortalMatchDayPlayers({ parentLinkId: selectedLink.id }),
          getParentPortalEventInvites({ parentLinkId: selectedLink.id }),
          getParentPortalSharedCalendarEvents({ parentLinkId: selectedLink.id }),
        ])

        if (isCurrent) {
          setMatches(nextMatches)
          setPlayers(nextPlayers)
          setEventInvites(nextEventInvites)
          setSharedCalendarEvents(nextSharedCalendarEvents)
        }
      } catch (error) {
        console.error(error)

        if (isCurrent) {
          if (showLoading) {
            setMatches([])
            setEventInvites([])
            setPlayers([])
            setSharedCalendarEvents([])
          }
          setMatchErrorTitle(parentMatchDayLoadErrorTitle)
          setMatchError(getParentMatchDayErrorMessage(error, parentMatchDayLoadErrorMessage))
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
    setMatchErrorTitle(parentMatchDayActionErrorTitle)

    try {
      await expressMatchDayScorerInterest({
        parentLinkId: selectedLink.id,
        matchDayId: match.id,
      })
      await loadMatches()
      showToast({ title: 'Interest sent', message: 'The coach or manager can now select you as scorer.' })
    } catch (error) {
      console.error(error)
      setMatchError(getParentMatchDayErrorMessage(error, 'Your scorer interest could not be saved. Please refresh or try again.'))
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
    setMatchErrorTitle(parentMatchDayActionErrorTitle)

    try {
      await subscribeToParentPush({ parentLinkId: selectedLink.id })
      setHasPushSubscription(true)
      setPushState(getPushSupportState())
      showToast({ title: 'Notifications enabled', message: 'Match Day updates can now appear on this device.' })
    } catch (error) {
      console.error(error)
      setMatchError(getParentMatchDayErrorMessage(error, 'Notifications could not be enabled. Please refresh or try again.'))
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
    setMatchErrorTitle(parentMatchDayActionErrorTitle)

    try {
      await unsubscribeFromParentPush({ parentLinkId: selectedLink.id })
      setHasPushSubscription(false)
      showToast({ title: 'Notifications disabled', message: 'This device will no longer receive Match Day push notifications.' })
    } catch (error) {
      console.error(error)
      setMatchError(getParentMatchDayErrorMessage(error, 'Notifications could not be disabled. Please refresh or try again.'))
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
    setMatchErrorTitle(parentMatchDayActionErrorTitle)

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
      setMatchError(getParentMatchDayErrorMessage(error, 'Score could not be updated. Please refresh or try again.'))
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
    setMatchErrorTitle(parentMatchDayActionErrorTitle)

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
      setMatchError(getParentMatchDayErrorMessage(error, 'Match could not be started. Please refresh or try again.'))
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
    setMatchErrorTitle(parentMatchDayActionErrorTitle)

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
      setMatchError(getParentMatchDayErrorMessage(error, 'Goal could not be added. Please refresh or try again.'))
    } finally {
      setActiveMatchId('')
    }
  }

  return (
    <div className="space-y-4 sm:space-y-5">
      <section className="rounded-lg border border-[#d7e5dc] bg-white p-4 shadow-sm shadow-[#047857]/10 sm:p-5">
        <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_minmax(18rem,24rem)] lg:items-start">
          <div className="min-w-0">
            <p className={eyebrowClass}>Family portal</p>
            <h1 className="mt-2 truncate text-3xl font-black tracking-tight text-[#101828] sm:text-4xl">
              {selectedLink?.playerName || 'Parent portal'}
            </h1>
            <p className="mt-2 text-sm font-semibold leading-6 text-[#4b5f55]">
              Updates shared by the club
            </p>
            <p className="mt-3 rounded-lg border border-[#d7e5dc] bg-[#f7faf8] px-3 py-2 text-sm font-semibold leading-6 text-[#4b5f55]">
              You only see updates the club has shared for this child.
            </p>
          </div>

          <ParentChildSelector
            links={links}
            onSelect={setSelectedLinkId}
            otherLinks={otherLinks}
            selectedLink={selectedLink}
          />
        </div>
      </section>

      <ParentPortalSectionNav
        activeSection={activeSection}
        eventInvites={eventInvites}
        matchCount={activeMatches.length}
        onSelect={setActiveSection}
        previousCount={previousMatches.length}
        sharedDateCount={parentCalendarEvents.length}
        user={user}
      />

      {matchError ? <NoticeBanner title={matchErrorTitle} message={matchError} /> : null}

      <section className="min-w-0">
        {activeSection === 'overview' ? (
          <ParentOverviewPanel
            activeMatches={activeMatches}
            calendarEvents={parentCalendarEvents}
            eventInvites={eventInvites}
            isLoading={isLoadingMatches}
            onSelectSection={setActiveSection}
            previousMatches={previousMatches}
            selectedLink={selectedLink}
          />
        ) : null}

        {activeSection === 'calendar' ? (
          <ParentCalendarPanel
            calendarCursor={calendarCursor}
            calendarEvents={parentCalendarEvents}
            calendarView={calendarView}
            isLoading={isLoadingMatches}
            onCursorChange={setCalendarCursor}
            onOpenEvent={setSelectedCalendarEvent}
            onViewChange={setCalendarView}
            selectedLink={selectedLink}
          />
        ) : null}

        {activeSection === 'invites' ? (
          <ParentUpcomingEvents
            eventInvites={eventInvites}
            isLoading={isLoadingMatches}
            selectedLink={selectedLink}
          />
        ) : null}

        {activeSection === 'matches' ? (
          <ParentMatchCardsPanel
            activeMatchId={activeMatchId}
            activeMatches={activeMatches}
            clockNow={clockNow}
            goalForms={goalForms}
            handleAddGoal={handleAddGoal}
            handlePlayerPick={handlePlayerPick}
            handleScoreSave={handleScoreSave}
            handleStartMatch={handleStartMatch}
            handleVolunteer={handleVolunteer}
            isLoading={isLoadingMatches}
            selectedLink={selectedLink}
            setScoreDrafts={setScoreDrafts}
            scoreDrafts={scoreDrafts}
            squadPlayers={squadPlayers}
            updateGoalForm={updateGoalForm}
          />
        ) : null}

        {activeSection === 'results' ? (
          <ParentResultsPanel
            previousMatches={previousMatches}
            onOpen={setSelectedPreviousMatch}
          />
        ) : null}

        {activeSection === 'account' ? (
          <section className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_20rem]">
            <div className="rounded-lg border border-[#d7e5dc] bg-white p-4 shadow-sm shadow-[#047857]/10 sm:p-5">
              <p className={eyebrowClass}>Account</p>
              <h3 className="mt-2 text-2xl font-black tracking-tight text-[#101828]">Parent settings</h3>
              <p className={`mt-3 ${bodyTextClass}`}>
                Manage the selected child view and device notifications. More account tools will stay hidden until they are ready for parent testing.
              </p>
            </div>
            <PushNotificationPanel
              hasPushSubscription={hasPushSubscription}
              isUpdatingPush={isUpdatingPush}
              onDisable={handleDisableNotifications}
              onEnable={handleEnableNotifications}
              pushState={pushState}
            />
          </section>
        ) : null}
      </section>

      <PreviousGameDetailModal match={selectedPreviousMatch} onClose={() => setSelectedPreviousMatch(null)} />
      <ParentCalendarEventModal event={selectedCalendarEvent} onClose={() => setSelectedCalendarEvent(null)} />
    </div>
  )
}

function toDateOnly(value) {
  const parsedDate = new Date(value)
  return Number.isNaN(parsedDate.getTime()) ? '' : parsedDate.toISOString().slice(0, 10)
}

function toTimeOnly(value) {
  const normalizedValue = String(value ?? '').trim()
  return /^\d{2}:\d{2}/.test(normalizedValue) ? normalizedValue.slice(0, 5) : ''
}

function buildParentCalendarEvents({ eventInvites = [], matches = [], sharedCalendarEvents = [] }) {
  const sharedEvents = sharedCalendarEvents
    .map((event) => ({
      id: `shared:${event.id}`,
      sourceId: event.id,
      sourceType: 'parent-calendar-event',
      date: toDateOnly(event.startsAt),
      time: toTimeOnly(event.startsAt),
      type: event.eventType === 'general' ? 'club-event' : 'deadline',
      title: event.title || 'Shared event',
      description: [event.location, event.notes].filter(Boolean).join(', '),
      location: event.location,
      editable: false,
      data: event,
    }))
    .filter((event) => event.date)

  const inviteEvents = eventInvites
    .map((invite) => ({
      id: `invite:${invite.id}`,
      sourceId: invite.id,
      sourceType: 'parent-invite',
      date: toDateOnly(invite.startsAt),
      time: toTimeOnly(invite.startsAt),
      type: invite.sourceType === 'training' ? 'training' : 'club-event',
      title: invite.title || 'Invited event',
      description: [invite.arrivalTime ? `Meet ${invite.arrivalTime}` : '', invite.location, invite.notes].filter(Boolean).join(', '),
      location: invite.location,
      editable: false,
      data: invite,
    }))
    .filter((event) => event.date)

  const matchEvents = matches
    .map((match) => ({
      id: `match:${match.id}`,
      sourceId: match.id,
      sourceType: 'parent-match-day',
      date: match.matchDate || '',
      time: toTimeOnly(match.kickoffTime),
      type: 'match-day',
      title: `${match.teamName || 'Team'} v ${match.opponent || 'Opponent'}`,
      description: [match.arrivalTime ? `Meet ${match.arrivalTime}` : '', match.kickoffTime ? `Kick-off ${match.kickoffTime}` : '', match.venueName].filter(Boolean).join(', '),
      location: match.venueName,
      editable: false,
      data: match,
    }))
    .filter((event) => event.date)

  const uniqueEvents = new Map()
  ;[...sharedEvents, ...inviteEvents, ...matchEvents].forEach((event) => {
    uniqueEvents.set(event.id, event)
  })

  return Array.from(uniqueEvents.values()).sort((left, right) =>
    left.date.localeCompare(right.date) ||
    String(left.time || '').localeCompare(String(right.time || '')) ||
    left.title.localeCompare(right.title),
  )
}

function ParentPortalSectionNav({
  activeSection,
  eventInvites,
  matchCount,
  onSelect,
  previousCount,
  sharedDateCount,
  user,
}) {
  const counts = {
    calendar: sharedDateCount,
    invites: eventInvites.length,
    matches: matchCount,
    results: previousCount,
  }
  const visibleSections = parentPortalSections.filter((section) => !section.path || isRecoveryPathVisible(section.path, { user }))
  const itemClass = (isActive) => [
    'flex min-h-12 w-full items-center justify-between gap-3 rounded-lg border px-3 py-2 text-left transition',
    isActive
      ? 'border-[#047857] bg-[#ecfdf5] text-[#101828]'
      : 'border-[#d7e5dc] bg-[#f7faf8] text-[#101828] hover:border-[#047857] hover:bg-white',
  ].join(' ')

  return (
    <nav aria-label="Parent portal sections" className="rounded-lg border border-[#d7e5dc] bg-white p-3 shadow-sm shadow-[#047857]/10">
      <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-5">
        {visibleSections.map((section) => {
          const isActive = activeSection === section.id
          const count = counts[section.id]
          const content = (
            <>
              <span className="min-w-0">
                <span className="block text-sm font-black">{section.label}</span>
                <span className="mt-0.5 block text-xs font-semibold text-[#4b5f55]">{section.description}</span>
              </span>
              {typeof count === 'number' ? (
                <span className="shrink-0 rounded-full border border-[#d7e5dc] bg-white px-2 py-1 text-xs font-black text-[#047857]">
                  {count}
                </span>
              ) : null}
            </>
          )

          if (section.path) {
            return (
              <Link key={section.id} to={section.path} className={itemClass(false)}>
                {content}
              </Link>
            )
          }

          return (
            <button
              key={section.id}
              type="button"
              onClick={() => onSelect(section.id)}
              className={itemClass(isActive)}
              aria-current={isActive ? 'page' : undefined}
            >
              {content}
            </button>
          )
        })}
      </div>
    </nav>
  )
}

function ParentOverviewPanel({
  activeMatches,
  calendarEvents,
  eventInvites,
  isLoading,
  onSelectSection,
  previousMatches,
  selectedLink,
}) {
  const nextMatch = activeMatches[0]
  const nextCalendarEvent = calendarEvents[0]
  const sharedItemCount = calendarEvents.length + eventInvites.length + activeMatches.length + previousMatches.length
  const overviewItems = [
    {
      id: 'calendar',
      label: 'Calendar',
      count: calendarEvents.length,
      title: nextCalendarEvent ? nextCalendarEvent.title : 'No shared dates yet',
      detail: nextCalendarEvent ? [nextCalendarEvent.date, nextCalendarEvent.time].filter(Boolean).join(', ') : 'Shared dates will appear when the club opens them to parents.',
    },
    {
      id: 'invites',
      label: 'Invites',
      count: eventInvites.length,
      title: eventInvites.length > 0 ? `${eventInvites.length} invite${eventInvites.length === 1 ? '' : 's'} available` : 'No invites waiting',
      detail: eventInvites.length > 0 ? 'Open invites to review session and event details.' : 'Invites stay quiet until the club shares one.',
    },
    {
      id: 'matches',
      label: 'Match cards',
      count: activeMatches.length,
      title: nextMatch ? `${nextMatch.teamName || 'Our team'} v ${nextMatch.opponent}` : 'No active match card',
      detail: nextMatch ? formatMatchDate(nextMatch) : 'Live and upcoming match cards appear only when shared.',
    },
    {
      id: 'results',
      label: 'Results',
      count: previousMatches.length,
      title: previousMatches.length > 0 ? `${previousMatches.length} previous result${previousMatches.length === 1 ? '' : 's'}` : 'No shared results yet',
      detail: previousMatches.length > 0 ? 'Open results to review completed match cards.' : 'Completed shared match cards will appear here.',
    },
  ]
  const visibleOverviewItems = isLoading ? overviewItems : overviewItems.filter((item) => item.count > 0)

  return (
    <section className="rounded-lg border border-[#d7e5dc] bg-white p-4 shadow-sm shadow-[#047857]/10 sm:p-5">
      <div className="flex flex-col gap-3 lg:flex-row lg:items-end lg:justify-between">
        <div>
          <p className={eyebrowClass}>Overview</p>
          <h3 className="mt-2 text-2xl font-black tracking-tight text-[#101828]">What's shared</h3>
          <p className={`mt-3 ${bodyTextClass}`}>
            {selectedLink
              ? 'Dates, invites, match cards, and results appear here when the club shares them.'
              : noChildMessage}
          </p>
        </div>
        <p className="rounded-lg border border-[#d7e5dc] bg-[#f7faf8] px-3 py-2 text-sm font-black text-[#4b5f55]">
          {isLoading ? 'Loading...' : `${sharedItemCount} shared items`}
        </p>
      </div>

      {!isLoading && selectedLink && sharedItemCount === 0 ? (
        <div className="mt-5 rounded-lg border border-dashed border-[#b8cbc0] bg-[#f7faf8] p-4">
          <p className="text-base font-black text-[#101828]">Nothing has been shared yet.</p>
          <p className={`mt-2 ${bodyTextClass}`}>
            When the club shares dates, invites, match cards, messages, or results, they'll appear here.
          </p>
        </div>
      ) : null}

      {visibleOverviewItems.length > 0 ? (
        <div className="mt-5 grid gap-2">
          {visibleOverviewItems.map((item) => (
            <button
              key={item.id}
              type="button"
              onClick={() => onSelectSection(item.id)}
              className="flex w-full items-start justify-between gap-3 rounded-lg border border-[#d7e5dc] bg-[#f7faf8] p-3 text-left transition hover:border-[#047857] hover:bg-white"
            >
              <span className="min-w-0">
                <span className="block text-sm font-black text-[#101828]">{item.label}</span>
                <span className="mt-1 block text-sm font-semibold leading-6 text-[#4b5f55]">{item.title}</span>
                <span className="mt-1 block text-xs font-semibold leading-5 text-[#60756a]">{item.detail}</span>
              </span>
              <span className="shrink-0 rounded-full border border-[#d7e5dc] bg-white px-2 py-1 text-xs font-black text-[#047857]">
                {isLoading ? '...' : item.count}
              </span>
            </button>
          ))}
        </div>
      ) : null}
    </section>
  )
}

function ParentCalendarPanel({
  calendarCursor,
  calendarEvents,
  calendarView,
  isLoading,
  onCursorChange,
  onOpenEvent,
  onViewChange,
  selectedLink,
}) {
  if (!selectedLink) {
    return (
      <section className="rounded-lg border border-[#d7e5dc] bg-white p-4 shadow-sm shadow-[#047857]/10 sm:p-5">
        <p className={eyebrowClass}>Calendar</p>
        <h3 className="mt-2 text-2xl font-black tracking-tight text-[#101828]">Family calendar</h3>
        <p className={`mt-4 ${emptyClass}`}>{noChildMessage}</p>
      </section>
    )
  }

  return (
    <section className="space-y-3">
      <FootballCalendar
        cursor={calendarCursor}
        description="Sessions, match days, response deadlines, and shared development updates."
        events={calendarEvents}
        isLoading={isLoading}
        onCursorChange={onCursorChange}
        onOpenEvent={onOpenEvent}
        onViewChange={onViewChange}
        title="Activity"
        view={calendarView}
      />
      {!isLoading && calendarEvents.length === 0 ? (
        <p className={emptyClass}>No shared calendar activity is available for this child yet. When the club shares a parent-visible date, it will appear here.</p>
      ) : null}
    </section>
  )
}

function ParentMatchCardsPanel({
  activeMatchId,
  activeMatches,
  clockNow,
  goalForms,
  handleAddGoal,
  handlePlayerPick,
  handleScoreSave,
  handleStartMatch,
  handleVolunteer,
  isLoading,
  selectedLink,
  setScoreDrafts,
  scoreDrafts,
  squadPlayers,
  updateGoalForm,
}) {
  return (
    <section className="rounded-lg border border-[#d7e5dc] bg-white p-4 shadow-sm shadow-[#047857]/10 sm:p-5">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <p className={eyebrowClass}>Live and upcoming</p>
          <h3 className="mt-2 text-2xl font-black tracking-tight text-[#101828]">Match cards</h3>
        </div>
        <p className="text-sm font-black text-[#4b5f55]">{activeMatches.length} active</p>
      </div>

      <div className="mt-4">
        {!selectedLink ? (
          <p className={emptyClass}>{noChildMessage}</p>
        ) : isLoading ? (
          <p className="rounded-lg border border-[#d7e5dc] bg-white px-4 py-5 text-sm font-semibold text-[#4b5f55] shadow-sm shadow-[#047857]/10">
            Loading match cards...
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
          <p className={emptyClass}>
            No match cards are shared for this child right now. When staff open a match card for parents, it will appear here.
          </p>
        )}
      </div>
    </section>
  )
}

function ParentResultsPanel({ onOpen, previousMatches }) {
  return (
    <section className="rounded-lg border border-[#d7e5dc] bg-white p-4 shadow-sm shadow-[#047857]/10 sm:p-5">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <p className={eyebrowClass}>Previous games</p>
          <h3 className="mt-2 text-2xl font-black tracking-tight text-[#101828]">Shared results</h3>
        </div>
        <p className="text-sm font-black text-[#4b5f55]">{previousMatches.length} complete</p>
      </div>

      {previousMatches.length > 0 ? (
        <div className="mt-4 grid gap-3 md:grid-cols-2">
          {previousMatches.map((match) => (
            <PreviousGameCard key={match.id} match={match} onOpen={onOpen} />
          ))}
        </div>
      ) : (
        <p className={`mt-4 ${emptyClass}`}>
          Previous shared results will appear here after the club completes and shares match cards.
        </p>
      )}
    </section>
  )
}

function ParentCalendarEventModal({ event, onClose }) {
  if (!event) {
    return null
  }

  const data = event.data || {}
  const isMatch = event.sourceType === 'parent-match-day'
  const startLabel = event.time || data.kickoffTime || ''
  const meetLabel = data.arrivalTime ? `Meet time: ${data.arrivalTime}` : ''
  const typeLabel = isMatch
    ? 'Match day'
    : event.type === 'training'
      ? 'Training'
      : event.type === 'deadline'
        ? 'Deadline'
        : 'Club event'

  return (
    <div className="fixed inset-0 z-[90] flex items-end justify-center bg-[#101828]/45 px-4 py-4 sm:items-center">
      <div
        role="dialog"
        aria-modal="true"
        className="max-h-[calc(100vh-2rem)] w-full max-w-lg overflow-y-auto rounded-lg border border-[#d7e5dc] bg-white p-5 shadow-xl shadow-[#047857]/15"
      >
        <div className="flex items-start justify-between gap-4">
          <div>
            <p className={eyebrowClass}>{typeLabel}</p>
            <h3 className="mt-2 text-xl font-black tracking-tight text-[#101828]">{event.title}</h3>
          </div>
          <button
            type="button"
            onClick={onClose}
            className={secondaryButtonClass}
          >
            Close
          </button>
        </div>

        <div className="mt-5 space-y-3 rounded-lg border border-[#d7e5dc] bg-[#f7faf8] p-4">
          <p className="text-sm font-black text-[#101828]">
            {[event.date, startLabel ? `Time: ${startLabel}` : '', meetLabel].filter(Boolean).join(', ')}
          </p>
          {event.location ? <p className="text-sm font-semibold text-[#4b5f55]">{event.location}</p> : null}
          {event.description ? <p className="text-sm font-semibold leading-6 text-[#4b5f55]">{event.description}</p> : null}
          {isMatch && data.opponent ? (
            <p className="text-sm font-semibold leading-6 text-[#4b5f55]">
              Opponent: {data.opponent}
            </p>
          ) : null}
        </div>
      </div>
    </div>
  )
}

function ParentUpcomingEvents({ eventInvites, isLoading, selectedLink }) {
  return (
    <section className="rounded-lg border border-[#d7e5dc] bg-white p-4 shadow-sm shadow-[#047857]/10 sm:p-5">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <p className={eyebrowClass}>Upcoming events</p>
          <h3 className="mt-2 text-2xl font-black tracking-tight text-[#101828]">Invites from the club</h3>
        </div>
        <p className="text-sm font-black text-[#4b5f55]">{eventInvites.length} active</p>
      </div>

      <div className="mt-4">
        {!selectedLink ? (
          <p className={emptyClass}>{noChildMessage}</p>
        ) : isLoading ? (
          <p className="rounded-lg border border-[#d7e5dc] bg-white px-4 py-5 text-sm font-semibold text-[#4b5f55] shadow-sm shadow-[#047857]/10">
            Loading event invites...
          </p>
        ) : eventInvites.length > 0 ? (
          <div className="grid gap-3 md:grid-cols-2">
            {eventInvites.map((invite) => (
              <article key={invite.id} className="rounded-lg border border-[#d7e5dc] bg-[#f7faf8] p-4">
                <p className="text-xs font-black uppercase tracking-[0.14em] text-[#047857]">
                  {invite.sourceType === 'training' ? 'Training' : 'Club event'}
                </p>
                <h4 className="mt-2 text-lg font-black text-[#101828]">{invite.title}</h4>
                <p className="mt-2 text-sm font-semibold text-[#4b5f55]">{formatParentEventDate(invite)}</p>
                {invite.location ? <p className="mt-1 text-sm font-semibold text-[#4b5f55]">{invite.location}</p> : null}
                {invite.notes ? <p className="mt-3 text-sm font-semibold leading-6 text-[#4b5f55]">{invite.notes}</p> : null}
              </article>
            ))}
          </div>
        ) : (
          <p className={emptyClass}>No event invites are waiting for this child. If the club invites them to a session or event, it will appear here.</p>
        )}
      </div>
    </section>
  )
}

function ParentChildSelector({ links, onSelect, otherLinks, selectedLink }) {
  if (!selectedLink) {
    return (
      <div className={panelClass}>
        <p className="text-xs font-black uppercase tracking-[0.16em] text-[#4b5f55]">Child being viewed</p>
        <p className="mt-2 text-lg font-black text-[#101828]">No linked child yet</p>
        <p className={`mt-2 ${bodyTextClass}`}>{noChildMessage}</p>
      </div>
    )
  }

  return (
    <div className={panelClass}>
      <label htmlFor="parent-portal-child" className="mb-2 block text-xs font-black uppercase tracking-[0.16em] text-[#4b5f55]">
        Child being viewed
      </label>
      <select
        id="parent-portal-child"
        value={selectedLink?.id || ''}
        onChange={(event) => onSelect(event.target.value)}
        className="min-h-11 w-full rounded-lg border border-[#d7e5dc] bg-[#f7faf8] px-3 py-2 text-sm font-black text-[#101828] outline-none transition focus:border-[#047857] focus:bg-white focus:ring-2 focus:ring-[#bbf7d0]"
      >
        {links.map((link) => (
          <option key={link.id} value={link.id}>
            {link.playerName || 'Linked child'}
          </option>
        ))}
      </select>
      <p className="mt-2 text-xs font-semibold leading-5 text-[#4b5f55]">
        Team: {selectedLink.teamName || 'No team assigned'}, Club: {selectedLink.clubName || 'No club assigned'}
      </p>
      <p className={`mt-3 ${bodyTextClass}`}>
        You are only viewing information the club has shared for this child.
      </p>

      {otherLinks.length > 0 ? (
        <div className="mt-4 space-y-2">
          <p className="text-xs font-black uppercase tracking-[0.16em] text-[#4b5f55]">Other linked children</p>
          {otherLinks.map((link) => (
            <button
              key={link.id}
              type="button"
              onClick={() => onSelect(link.id)}
              className="block w-full rounded-lg border border-[#d7e5dc] bg-[#f7faf8] px-4 py-3 text-left transition hover:border-[#047857] hover:bg-white"
            >
              <p className="text-sm font-black text-[#101828]">{link.playerName || 'Linked child'}</p>
              <p className="mt-1 text-xs font-semibold text-[#4b5f55]">Team: {link.teamName || 'No team assigned'}, Club: {link.clubName || 'No club assigned'}</p>
            </button>
          ))}
        </div>
      ) : null}
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
      <div className="rounded-lg border border-[#d7e5dc] bg-white px-4 py-4 shadow-sm shadow-[#047857]/10">
        <p className="text-xs font-black uppercase tracking-[0.16em] text-[#4b5f55]">Notifications</p>
        <p className="mt-2 text-sm font-black text-[#101828]">Not available on this device yet.</p>
        <p className={`mt-2 ${bodyTextClass}`}>{pushState.reason}</p>
      </div>
    )
  }

  return (
    <div className="rounded-lg border border-[#d7e5dc] bg-white px-4 py-4 shadow-sm shadow-[#047857]/10">
      <div className="min-w-0">
        <p className="text-xs font-black uppercase tracking-[0.16em] text-[#4b5f55]">Notifications</p>
        <p className="mt-2 text-sm font-black text-[#101828]">
          {hasPushSubscription ? 'Notifications are enabled on this device.' : 'Enable Match Day notifications on this device.'}
        </p>
        <p className={`mt-2 ${bodyTextClass}`}>
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
          className={`mt-4 w-full ${secondaryButtonClass}`}
        >
          {isUpdatingPush ? 'Disabling...' : 'Disable'}
        </button>
      ) : (
        <button
          type="button"
          onClick={onEnable}
          disabled={isUpdatingPush || pushState.permission === 'denied'}
          className={`mt-4 w-full ${primaryButtonClass}`}
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
    <article className="rounded-lg border border-[#d7e5dc] bg-white p-4 shadow-sm shadow-[#047857]/10">
      <div className="flex flex-col gap-4 md:flex-row md:items-start md:justify-between">
        <div className="min-w-0">
          <div className="flex flex-wrap gap-2">
            <span className="inline-flex w-fit whitespace-nowrap rounded-lg border border-[#d7e5dc] bg-[#f7faf8] px-3 py-1 text-xs font-black text-[#4b5f55]">
              {match.status.replace(/_/g, ' ')}
            </span>
            {match.isScorer ? (
              <span className="inline-flex w-fit whitespace-nowrap rounded-lg border border-[#d7e5dc] bg-[#ecfdf5] px-3 py-1 text-xs font-black text-[#047857]">
                Selected scorer
              </span>
            ) : null}
          </div>
          <h4 className="mt-3 text-lg font-black text-[#101828]">{match.teamName || 'Our team'} v {match.opponent}</h4>
          <p className="mt-1 text-sm font-semibold text-[#4b5f55]">{formatMatchDate(match)}</p>
          {match.venueName ? <p className="mt-1 text-sm font-semibold text-[#4b5f55]">{match.venueName}</p> : null}
          {match.scorerRequestMessage && !match.isScorer ? (
            <p className={`mt-3 whitespace-pre-wrap ${bodyTextClass}`}>{match.scorerRequestMessage}</p>
          ) : null}
        </div>

        <div className="rounded-lg border border-[#d7e5dc] bg-[#f7faf8] p-4 text-center shadow-sm shadow-[#047857]/10">
          <p className="text-xs font-black uppercase tracking-[0.16em] text-[#4b5f55]">Live score</p>
          <p className="mt-2 text-4xl font-black text-[#101828]">
            {getClubScore(match)} - {getOpponentScore(match)}
          </p>
          {currentMinute ? (
            <p className="mt-2 text-sm font-bold text-[#4b5f55]">{currentMinute} min</p>
          ) : null}
        </div>
      </div>

      {!match.isScorer ? (
        <div className="mt-4">
          <button
            type="button"
            onClick={() => onVolunteer(match)}
            disabled={isBusy || match.hasInterest}
            className={`w-full sm:w-auto ${primaryButtonClass}`}
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
              className={`w-full sm:w-auto ${primaryButtonClass}`}
            >
              Start match
            </button>
          ) : null}

          <div className={softPanelClass}>
            <h5 className="text-sm font-black text-[#101828]">Update score</h5>
            <div className="mt-3 grid gap-3 sm:grid-cols-4">
              <label className="block">
                <span className="mb-1 block text-xs font-black text-[#4b5f55]">Home</span>
                <input
                  type="number"
                  min="0"
                  value={scoreDraft.homeScore}
                  onChange={(event) => onScoreDraftChange({ homeScore: event.target.value })}
                  className={fieldClass}
                />
              </label>
              <label className="block">
                <span className="mb-1 block text-xs font-black text-[#4b5f55]">Away</span>
                <input
                  type="number"
                  min="0"
                  value={scoreDraft.awayScore}
                  onChange={(event) => onScoreDraftChange({ awayScore: event.target.value })}
                  className={fieldClass}
                />
              </label>
              <label className="block">
                <span className="mb-1 block text-xs font-black text-[#4b5f55]">Status</span>
                <select
                  value={scoreDraft.status}
                  onChange={(event) => onScoreDraftChange({ status: event.target.value })}
                  className={fieldClass}
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
                className="mt-auto inline-flex min-h-10 items-center justify-center rounded-lg bg-[#047857] px-4 py-2 text-sm font-black text-white transition hover:bg-[#065f46] disabled:cursor-not-allowed disabled:opacity-60"
              >
                Save
              </button>
            </div>
          </div>

          <form className="rounded-lg border border-[#d7e5dc] bg-white p-4 shadow-sm shadow-[#047857]/10" onSubmit={(event) => onAddGoal(event, match)}>
            <h5 className="text-sm font-black text-[#101828]">Add goal</h5>
            <div className="mt-3 grid gap-3 md:grid-cols-3">
              <label className="block">
                <span className="mb-1 block text-xs font-black text-[#047857]">Team</span>
                <select
                  value={goalForm.teamSide}
                  onChange={(event) => onGoalFormChange(match.id, { teamSide: event.target.value })}
                  className={fieldClass}
                >
                  <option value="club">Our team</option>
                  <option value="opponent">Opponent</option>
                </select>
              </label>
              <label className="block">
                <span className="mb-1 block text-xs font-black text-[#047857]">Scorer player</span>
                <select
                  value=""
                  onChange={(event) => onPlayerPick(match.id, 'scorer', event.target.value)}
                  className={fieldClass}
                >
                  <option value="">Choose player</option>
                  {orderedPlayers.map((player) => (
                    <option key={player.id} value={player.id}>{player.playerName}</option>
                  ))}
                </select>
              </label>
              <label className="block">
                <span className="mb-1 block text-xs font-black text-[#047857]">Scorer name</span>
                <input
                  value={goalForm.scorerName}
                  onChange={(event) => onGoalFormChange(match.id, { scorerName: event.target.value })}
                  className={fieldClass}
                />
              </label>
              <label className="block">
                <span className="mb-1 block text-xs font-black text-[#047857]">Scorer shirt</span>
                <input
                  value={goalForm.scorerShirtNumber}
                  onChange={(event) => onGoalFormChange(match.id, { scorerShirtNumber: event.target.value })}
                  className={fieldClass}
                />
              </label>
              <label className="block">
                <span className="mb-1 block text-xs font-black text-[#047857]">Assist player</span>
                <select
                  value=""
                  onChange={(event) => onPlayerPick(match.id, 'assist', event.target.value)}
                  className={fieldClass}
                >
                  <option value="">Choose player</option>
                  {orderedPlayers.map((player) => (
                    <option key={player.id} value={player.id}>{player.playerName}</option>
                  ))}
                </select>
              </label>
              <label className="block">
                <span className="mb-1 block text-xs font-black text-[#047857]">Assist name</span>
                <input
                  value={goalForm.assistName}
                  onChange={(event) => onGoalFormChange(match.id, { assistName: event.target.value })}
                  className={fieldClass}
                />
              </label>
              <label className="block">
                <span className="mb-1 block text-xs font-black text-[#047857]">Assist shirt</span>
                <input
                  value={goalForm.assistShirtNumber}
                  onChange={(event) => onGoalFormChange(match.id, { assistShirtNumber: event.target.value })}
                  className={fieldClass}
                />
              </label>
              <button
                type="submit"
                disabled={isBusy}
                className="inline-flex min-h-10 items-center justify-center rounded-lg bg-[#047857] px-4 py-2 text-sm font-black text-white transition hover:bg-[#065f46] disabled:cursor-not-allowed disabled:opacity-60"
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
            <div key={event.id} className="rounded-lg border border-[#d7e5dc] bg-[#f7faf8] px-4 py-3">
              <p className="text-sm font-semibold text-[#101828]">
                {getParentMatchEventTitle(event)}
              </p>
              <p className="mt-1 text-xs font-semibold text-[#4b5f55]">
                {getParentMatchEventDetail(event)}
              </p>
            </div>
          ))}
        </div>
      ) : null}
    </article>
  )
}
