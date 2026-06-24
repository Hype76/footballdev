import { useEffect, useMemo, useState } from 'react'
import { Navigate } from 'react-router-dom'
import { PreviousGameCard, PreviousGameDetailModal } from '../components/match-day/PreviousGameCard.jsx'
import { NoticeBanner } from '../components/ui/NoticeBanner.jsx'
import { useToast } from '../components/ui/toast-context.js'
import { canManageMatchDay, useAuth } from '../lib/auth.js'
import {
  shouldSendMatchdayAvailabilityRequests,
  shouldSendMatchdayPushNotification,
} from '../lib/matchday-communication-safety.js'
import { sendMatchDayPushNotification } from '../lib/push-notifications.js'
import {
  addStaffMatchDayGoal,
  calculateArrivalTime,
  createMatchDay,
  getTodayMatchDayDateValue,
  getMatchDays,
  getMatchLocations,
  getPlayers,
  getTeams,
  isPastMatchDayDate,
  MATCH_DAY_ARRIVAL_OPTIONS,
  MATCH_DAY_HOME_AWAY_OPTIONS,
  MATCH_DAY_STATUS_OPTIONS,
  resetPreviousMatchDayResults,
  selectMatchDayScorer,
  updateMatchDay,
  withRequestTimeout,
} from '../lib/supabase.js'
import {
  consumeFixtureSetupIntent,
  FIXTURE_SETUP_EVENT,
} from '../lib/matchday-workflow.js'

const EMPTY_MATCH_FORM = {
  opponent: '',
  matchDate: '',
  kickoffTime: '',
  arrivalTime: '',
  arrivalPreset: '30',
  homeAway: 'home',
  teamId: '',
  venueName: '',
  venueAddress: '',
  notes: '',
  parentAudience: 'none',
  parentVisible: false,
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

const EMPTY_SQUAD_SELECTION = {
  isOpen: false,
  selectedPlayerIds: [],
  mode: 'full',
}

const labelClass = 'mb-2 block text-sm font-black text-[#101828]'
const smallLabelClass = 'mb-1 block text-xs font-black uppercase tracking-[0.14em] text-[#4b5f55]'
const inputClass = 'min-h-11 w-full rounded-lg border border-[#d7e5dc] bg-[#f7faf8] px-4 py-3 text-sm font-semibold text-[#101828] outline-none transition placeholder:text-[#94a3b8] focus:border-[#0f9f6e] focus:bg-white focus:ring-2 focus:ring-[#d1fae5] disabled:cursor-not-allowed disabled:opacity-60'
const compactInputClass = 'min-h-10 w-full rounded-lg border border-[#d7e5dc] bg-[#f7faf8] px-3 py-2 text-sm font-semibold text-[#101828] outline-none transition focus:border-[#0f9f6e] focus:bg-white focus:ring-2 focus:ring-[#d1fae5] disabled:cursor-not-allowed disabled:opacity-60'
const primaryButtonClass = 'inline-flex min-h-11 items-center justify-center rounded-lg bg-[#047857] px-5 py-3 text-sm font-black text-white transition hover:bg-[#065f46] disabled:cursor-not-allowed disabled:opacity-60'
const secondaryButtonClass = 'inline-flex min-h-10 items-center justify-center rounded-lg border border-[#d7e5dc] bg-white px-4 py-2 text-sm font-black text-[#101828] shadow-sm shadow-[#047857]/10 transition hover:border-[#0f9f6e] hover:bg-[#ecfdf5] disabled:cursor-not-allowed disabled:opacity-60'
const panelClass = 'rounded-lg border border-[#d7e5dc] bg-[#f7faf8] p-4 shadow-sm shadow-[#047857]/10'
const sectionHeaderClass = 'border-b border-[#d7e5dc] bg-[#f7faf8] px-5 py-5 sm:px-6'
const eyebrowClass = 'text-xs font-black uppercase tracking-[0.18em] text-[#047857]'
const bodyTextClass = 'text-sm font-semibold leading-6 text-[#4b5f55]'
const modalValidationClass = 'mx-4 mb-3 rounded-lg border border-[#fedf89] bg-[#fffaeb] px-4 py-3 text-sm font-bold leading-6 text-[#92400e] sm:mx-6'
const fixtureModalViewportBaseStyle = {
  '--fixture-modal-viewport-height': '100dvh',
  '--fixture-modal-viewport-top': '0px',
}
const fixtureModalViewportBaseState = {
  viewportStyle: fixtureModalViewportBaseStyle,
  isKeyboardOpen: false,
}

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

function useModalPageScrollLock(isLocked) {
  useEffect(() => {
    if (!isLocked || typeof document === 'undefined' || typeof window === 'undefined') {
      return undefined
    }

    const scrollY = window.scrollY || 0
    const { body, documentElement } = document
    const previousBodyStyle = {
      overflow: body.style.overflow,
      position: body.style.position,
      top: body.style.top,
      width: body.style.width,
    }
    const previousOverscrollBehavior = documentElement.style.overscrollBehavior

    body.style.overflow = 'hidden'
    body.style.position = 'fixed'
    body.style.top = `-${scrollY}px`
    body.style.width = '100%'
    documentElement.style.overscrollBehavior = 'none'

    return () => {
      body.style.overflow = previousBodyStyle.overflow
      body.style.position = previousBodyStyle.position
      body.style.top = previousBodyStyle.top
      body.style.width = previousBodyStyle.width
      documentElement.style.overscrollBehavior = previousOverscrollBehavior
      window.scrollTo(0, scrollY)
    }
  }, [isLocked])
}

function useFixtureModalViewportStyle() {
  const [viewportState, setViewportState] = useState(fixtureModalViewportBaseState)

  useEffect(() => {
    if (typeof window === 'undefined') {
      return undefined
    }

    const updateViewportStyle = () => {
      const visualViewport = window.visualViewport
      const viewportHeight = Math.max(320, Math.round(visualViewport?.height || window.innerHeight || 0))
      const viewportTop = Math.max(0, Math.round(visualViewport?.offsetTop || 0))
      const layoutViewportHeight = Math.max(viewportHeight, Math.round(window.innerHeight || viewportHeight))
      const keyboardInset = Math.max(0, layoutViewportHeight - viewportHeight - viewportTop)
      const isKeyboardOpen = keyboardInset > 120

      setViewportState({
        viewportStyle: {
          '--fixture-modal-viewport-height': `${viewportHeight}px`,
          '--fixture-modal-viewport-top': `${viewportTop}px`,
        },
        isKeyboardOpen,
      })
    }

    updateViewportStyle()
    window.addEventListener('resize', updateViewportStyle)
    window.visualViewport?.addEventListener('resize', updateViewportStyle)
    window.visualViewport?.addEventListener('scroll', updateViewportStyle)

    return () => {
      window.removeEventListener('resize', updateViewportStyle)
      window.visualViewport?.removeEventListener('resize', updateViewportStyle)
      window.visualViewport?.removeEventListener('scroll', updateViewportStyle)
    }
  }, [])

  return viewportState
}

function isFixtureEditableElement(element) {
  return ['INPUT', 'SELECT', 'TEXTAREA'].includes(element?.tagName)
}

function blurActiveFixtureControl() {
  if (typeof document === 'undefined') {
    return
  }

  const activeElement = document.activeElement

  if (isFixtureEditableElement(activeElement) && typeof activeElement.blur === 'function') {
    activeElement.blur()
  }
}

function scrollFixtureControlIntoView(element) {
  if (!isFixtureEditableElement(element) || typeof element.scrollIntoView !== 'function') {
    return
  }

  const scrollControl = () => element.scrollIntoView({ block: 'center', inline: 'nearest' })
  window.setTimeout(scrollControl, 80)
  window.setTimeout(scrollControl, 320)
}

function useFixtureKeyboardFocusState() {
  const [isFixtureControlFocused, setIsFixtureControlFocused] = useState(false)

  const handleFocusCapture = (event) => {
    setIsFixtureControlFocused(isFixtureEditableElement(event.target))
    scrollFixtureControlIntoView(event.target)
  }

  const handleBlurCapture = (event) => {
    const currentTarget = event.currentTarget

    window.setTimeout(() => {
      if (currentTarget?.contains?.(document.activeElement) && isFixtureEditableElement(document.activeElement)) {
        return
      }

      setIsFixtureControlFocused(false)
    }, 40)
  }

  return {
    isFixtureControlFocused,
    handleFocusCapture,
    handleBlurCapture,
  }
}

function getFixtureSetupValidationMessage({ availablePlayerIds, form }) {
  if (!String(form.opponent ?? '').trim()) {
    return 'Add an opponent before continuing to squad selection.'
  }

  if (isPastMatchDayDate(form.matchDate)) {
    return 'Match Day date must be today or in the future.'
  }

  if (availablePlayerIds.length === 0) {
    return 'Add active squad players to this team before continuing to squad selection.'
  }

  return ''
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

function getMatchEventTitle(event) {
  return `${event.eventType === 'goal' ? 'Goal' : 'Update'}, Score: ${event.homeScore} - ${event.awayScore}`
}

function getMatchEventDetail(event) {
  const detailParts = [
    event.minute !== null ? `Minute: ${event.minute}` : '',
    `Player: ${event.scorerInitials || event.scorerName || 'Score update'}${event.scorerShirtNumber ? ` #${event.scorerShirtNumber}` : ''}`,
    event.assistInitials || event.assistName
      ? `Assist: ${event.assistInitials || event.assistName}${event.assistShirtNumber ? ` #${event.assistShirtNumber}` : ''}`
      : '',
  ]

  return detailParts.filter(Boolean).join(', ')
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
  const { session, user } = useAuth()
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
  const [isFixtureFormOpen, setIsFixtureFormOpen] = useState(false)
  const [selectedPreviousMatch, setSelectedPreviousMatch] = useState(null)
  const [squadSelection, setSquadSelection] = useState(EMPTY_SQUAD_SELECTION)

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
  const selectedFixtureTeamId = form.teamId || user.activeTeamId || ''
  const isTeamScopedFixture = Boolean(user.activeTeamId) || Number(user.roleRank ?? 0) < 50
  const selectedFixtureTeamName = user.activeTeamName || teams.find((team) => String(team.id) === String(selectedFixtureTeamId))?.name || ''
  const fixturePlayers = useMemo(
    () =>
      squadPlayers.filter((player) => {
        if (!selectedFixtureTeamId && !selectedFixtureTeamName) {
          return true
        }

        return String(player.teamId || '') === String(selectedFixtureTeamId)
          || String(player.team || '').trim().toLowerCase() === String(selectedFixtureTeamName || '').trim().toLowerCase()
      }),
    [selectedFixtureTeamId, selectedFixtureTeamName, squadPlayers],
  )

  useModalPageScrollLock(isFixtureFormOpen || squadSelection.isOpen)

  useEffect(() => {
    const openFixtureSetup = (setupIntent = consumeFixtureSetupIntent()) => {
      if (setupIntent) {
        setForm((currentForm) => ({
          ...currentForm,
          ...setupIntent,
          arrivalPreset: setupIntent.arrivalTime ? 'custom' : currentForm.arrivalPreset,
          parentAudience: setupIntent.parentVisible ? setupIntent.parentAudience : 'none',
        }))
      }

      setIsFixtureFormOpen(true)
    }

    const storedSetupIntent = consumeFixtureSetupIntent()

    if (storedSetupIntent) {
      window.setTimeout(() => openFixtureSetup(storedSetupIntent), 120)
    }

    const handleFixtureSetupEvent = () => openFixtureSetup()

    window.addEventListener(FIXTURE_SETUP_EVENT, handleFixtureSetupEvent)

    return () => {
      window.removeEventListener(FIXTURE_SETUP_EVENT, handleFixtureSetupEvent)
    }
  }, [])

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

  const updateArrivalFromPreset = (arrivalPreset, kickoffTime = form.kickoffTime) => {
    const nextArrivalTime = arrivalPreset === 'custom' ? form.arrivalTime : calculateArrivalTime(kickoffTime, arrivalPreset)
    updateForm({
      arrivalPreset,
      arrivalTime: nextArrivalTime,
    })
  }

  const updateKickoffTime = (kickoffTime) => {
    updateForm({
      kickoffTime,
      arrivalTime: form.arrivalPreset === 'custom' ? form.arrivalTime : calculateArrivalTime(kickoffTime, form.arrivalPreset),
    })
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
    blurActiveFixtureControl()

    const availablePlayerIds = fixturePlayers.map((player) => player.id)
    const validationMessage = getFixtureSetupValidationMessage({ availablePlayerIds, form })

    if (validationMessage) {
      setErrorMessage(validationMessage)
      return
    }

    setErrorMessage('')
    setSquadSelection({
      isOpen: true,
      mode: 'full',
      selectedPlayerIds: availablePlayerIds,
    })
  }

  const handleConfirmCreateMatch = async () => {
    const selectedPlayerIds = squadSelection.selectedPlayerIds

    if (selectedPlayerIds.length === 0) {
      setErrorMessage('Select at least one player before creating the fixture.')
      return
    }

    setIsSaving(true)
    setErrorMessage('')

    try {
      const createdMatch = await createMatchDay({ user, match: form })
      const communicationRuntime = {
        env: import.meta.env,
        location: window.location,
      }
      const canSendAvailabilityRequests = shouldSendMatchdayAvailabilityRequests({
        parentVisible: form.parentVisible,
        runtime: communicationRuntime,
      })
      let result = {
        missingContactCount: 0,
        sentCount: 0,
      }

      if (canSendAvailabilityRequests) {
        const response = await fetch('/.netlify/functions/send-match-day-availability-requests', {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${session?.access_token || ''}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            matchDayId: createdMatch.id,
            playerIds: selectedPlayerIds,
          }),
        })
        result = await response.json().catch(() => ({}))

        if (!response.ok || result.success === false) {
          throw new Error(result.message || 'Fixture availability requests could not be sent.')
        }
      }

      if (shouldSendMatchdayPushNotification({
        parentVisible: form.parentVisible,
        runtime: communicationRuntime,
      })) {
        void sendMatchDayPushNotification({
          matchDayId: createdMatch.id,
          type: 'scorer_request',
        })
      }
      setForm(EMPTY_MATCH_FORM)
      setIsFixtureFormOpen(false)
      setSquadSelection(EMPTY_SQUAD_SELECTION)
      await loadData()
      showToast({
        title: 'Fixture created',
        message: canSendAvailabilityRequests
          ? `${result.sentCount ?? 0} availability requests sent. ${result.missingContactCount ?? 0} players need contact details.`
          : 'The fixture was saved. Availability sending is gated in this environment.',
      })
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

    if (!confirmMatchDayAction(`Save this score as ${draft.homeScore || 0} - ${draft.awayScore || 0} for the family portal?`)) {
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
      showToast({ title: 'Score updated', message: 'The family portal score has been updated.' })
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

    if (!confirmMatchDayAction('Add this goal to the live feed and update the family portal score?')) {
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
    const confirmed = confirmMatchDayAction('Reset previous games for the season? This hides full time results from the family portal previous games list.')

    if (!confirmed) {
      return
    }

    setIsSaving(true)
    setErrorMessage('')

    try {
      await resetPreviousMatchDayResults({ user })
      await loadData()
      showToast({ title: 'Previous games reset', message: 'Old full time results have been hidden from the family portal.' })
    } catch (error) {
      console.error(error)
      setErrorMessage(error.message || 'Previous games could not be reset.')
    } finally {
      setIsSaving(false)
    }
  }

  return (
    <div className="space-y-5">
      <section className="overflow-hidden rounded-lg border border-[#d7e5dc] bg-white shadow-sm shadow-[#047857]/10">
        <div className="grid gap-0 xl:grid-cols-[minmax(0,1fr)_25rem]">
          <div>
            <div className="px-5 py-6 sm:px-6 lg:px-8">
              <p className={eyebrowClass}>Match day control</p>
              <h1 className="mt-3 max-w-5xl text-3xl font-black leading-[1.02] tracking-tight text-[#101828] sm:text-4xl">
                Run the fixture from scorer request to full time.
              </h1>
              <p className="mt-4 max-w-3xl text-base font-semibold leading-7 text-[#4b5f55]">
                Create the fixture, control who can update it, run the live score, and keep the final result in one club record.
              </p>
              <div className="mt-5 grid gap-3 md:grid-cols-3">
                {matchRuleCards.map((item) => (
                  <article key={item.label} className="rounded-lg border border-[#d7e5dc] bg-[#f7faf8] p-4 shadow-sm shadow-[#047857]/10">
                    <p className="text-xs font-black uppercase tracking-[0.16em] text-[#047857]">{item.label}</p>
                    <p className="mt-2 text-sm font-semibold leading-6 text-[#4b5f55]">{item.body}</p>
                  </article>
                ))}
              </div>
            </div>
          </div>
          <div className="grid content-between border-t border-[#d7e5dc] bg-[#ecfdf5] p-5 sm:p-6 xl:border-l xl:border-t-0">
            <div>
              <p className="text-xs font-black uppercase tracking-[0.16em] text-[#4b5f55]">Next fixture</p>
              <p className="mt-2 text-2xl font-black tracking-tight text-[#101828]">
                {nextMatch ? `${nextMatch.teamName || 'Our team'} v ${nextMatch.opponent}` : 'No fixture created'}
              </p>
              <p className="mt-2 text-sm font-semibold leading-6 text-[#4b5f55]">
                {nextMatch ? formatMatchDate(nextMatch) : 'Create a fixture to request a scorer and prepare the live board.'}
              </p>
            </div>
            <div className="mt-5 grid grid-cols-2 gap-2">
              <MatchMetric label="Live" value={liveMatches} isLoading={isLoading} />
              <MatchMetric label="Requests" value={scorerRequests} isLoading={isLoading} />
              <MatchMetric label="Upcoming" value={upcomingMatches} isLoading={isLoading} />
              <MatchMetric label="Goals" value={goalCount} isLoading={isLoading} />
            </div>
            <p className="mt-4 text-sm font-semibold leading-6 text-[#4b5f55]">
              Keep one active fixture visible so staff actions, scorer access, and parent updates stay aligned.
            </p>
          </div>
        </div>
      </section>

      {errorMessage ? <NoticeBanner title="Match Day action failed" message={errorMessage} /> : null}

      <section className="grid gap-3 md:grid-cols-4">
        {matchDaySummary.map((item) => (
          <article key={item.label} className="rounded-lg border border-[#d7e5dc] bg-white p-5 shadow-sm shadow-[#047857]/10">
            <p className="text-xs font-black uppercase tracking-[0.16em] text-[#047857]">{item.label}</p>
            <p className="mt-3 text-4xl font-black tracking-tight text-[#101828]">{isLoading ? '...' : item.value}</p>
            <p className="mt-2 text-sm font-semibold leading-6 text-[#4b5f55]">{item.caption}</p>
          </article>
        ))}
      </section>

      <section className="overflow-hidden rounded-lg border border-[#d7e5dc] bg-white shadow-sm shadow-[#047857]/10">
        <div className={sectionHeaderClass}>
          <p className={eyebrowClass}>Fixture setup</p>
          <h2 className="mt-2 text-2xl font-black tracking-tight text-[#101828]">Create fixture</h2>
          <p className={`mt-2 max-w-3xl ${bodyTextClass}`}>
            Set the opponent, arrival, venue, and parent-facing scorer request before choosing the players who need availability requests.
          </p>
        </div>
        <div className="grid gap-4 px-5 py-5 sm:px-6 lg:grid-cols-[minmax(0,1fr)_auto] lg:items-center">
          <div className="grid gap-3 sm:grid-cols-3">
            <div className={panelClass}>
              <p className={smallLabelClass}>Team</p>
              <p className="text-sm font-black text-[#101828]">{selectedFixtureTeamName || user.activeTeamName || 'Choose in setup'}</p>
            </div>
            <div className={panelClass}>
              <p className={smallLabelClass}>Squad</p>
              <p className="text-sm font-black text-[#101828]">{fixturePlayers.length} active players</p>
            </div>
            <div className={panelClass}>
              <p className={smallLabelClass}>Next step</p>
              <p className="text-sm font-black text-[#101828]">Open setup, then pick who gets asked.</p>
            </div>
          </div>
          <button
            type="button"
            onClick={() => setIsFixtureFormOpen(true)}
            className={`${primaryButtonClass} w-full lg:w-auto`}
          >
            Create fixture
          </button>
        </div>
      </section>

      {isFixtureFormOpen ? (
        <FixtureSetupModal
          applyLocation={applyLocation}
          form={form}
          handleCreateMatch={handleCreateMatch}
          isFixtureDataLoading={isLoading}
          isSaving={isSaving}
          isTeamScopedFixture={isTeamScopedFixture}
          locations={locations}
          selectedFixtureTeamName={selectedFixtureTeamName}
          teams={teams}
          updateArrivalFromPreset={updateArrivalFromPreset}
          updateForm={updateForm}
          updateKickoffTime={updateKickoffTime}
          user={user}
          validationMessage={errorMessage}
          onClose={() => setIsFixtureFormOpen(false)}
        />
      ) : null}

      {squadSelection.isOpen ? (
        <FixtureSquadSelectionModal
          isSaving={isSaving}
          parentVisible={form.parentVisible}
          players={fixturePlayers}
          selectedPlayerIds={squadSelection.selectedPlayerIds}
          selectionMode={squadSelection.mode}
          teamName={selectedFixtureTeamName || user.activeTeamName || 'this team'}
          validationMessage={errorMessage}
          onCancel={() => setSquadSelection(EMPTY_SQUAD_SELECTION)}
          onConfirm={handleConfirmCreateMatch}
          onSelectionModeChange={(mode) => {
            setSquadSelection((current) => ({
              ...current,
              mode,
              selectedPlayerIds: mode === 'full' ? fixturePlayers.map((player) => player.id) : current.selectedPlayerIds,
            }))
          }}
          onTogglePlayer={(playerId) => {
            setSquadSelection((current) => {
              const selectedIds = new Set(current.selectedPlayerIds)

              if (selectedIds.has(playerId)) {
                selectedIds.delete(playerId)
              } else {
                selectedIds.add(playerId)
              }

              return {
                ...current,
                mode: 'individual',
                selectedPlayerIds: [...selectedIds],
              }
            })
          }}
          onSelectAll={() => setSquadSelection((current) => ({
            ...current,
            mode: 'full',
            selectedPlayerIds: fixturePlayers.map((player) => player.id),
          }))}
          onClearAll={() => setSquadSelection((current) => ({
            ...current,
            mode: 'individual',
            selectedPlayerIds: [],
          }))}
        />
      ) : null}

      <section className="overflow-hidden rounded-lg border border-[#d7e5dc] bg-white shadow-sm shadow-[#047857]/10">
        <div className={sectionHeaderClass}>
          <p className={eyebrowClass}>Live board</p>
          <h2 className="mt-2 text-2xl font-black tracking-tight text-[#101828]">Run live and upcoming matches</h2>
          <p className={`mt-2 max-w-3xl ${bodyTextClass}`}>
            Start the match, update the score, select parent scorers, and record goals with scorer and assist detail.
          </p>
        </div>
        <div className="px-5 py-5 sm:px-6">
        {isLoading ? (
          <p className="rounded-lg border border-[#d7e5dc] bg-[#f7faf8] px-4 py-5 text-sm font-bold text-[#4b5f55] shadow-sm shadow-[#047857]/10">
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
          <div className="rounded-lg border border-[#d7e5dc] bg-[#f7faf8] px-4 py-5 shadow-sm shadow-[#047857]/10">
            <p className="text-base font-black text-[#101828]">No live or upcoming matches yet.</p>
            <p className="mt-2 text-sm font-semibold leading-6 text-[#4b5f55]">
              Create the fixture above before requesting a scorer or publishing parent updates.
            </p>
          </div>
        )}
        </div>
      </section>

      <section className="overflow-hidden rounded-lg border border-[#d7e5dc] bg-white shadow-sm shadow-[#047857]/10">
        <div className="grid gap-4 border-b border-[#d7e5dc] bg-[#f7faf8] px-5 py-5 sm:px-6 lg:grid-cols-[minmax(0,1fr)_auto] lg:items-start">
          <div>
            <p className={eyebrowClass}>Results archive</p>
            <h2 className="mt-2 text-2xl font-black tracking-tight text-[#101828]">Previous games</h2>
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
          <div className="rounded-lg border border-[#d7e5dc] bg-[#f7faf8] px-4 py-5 shadow-sm shadow-[#047857]/10">
            <p className="text-base font-black text-[#101828]">No previous games are showing.</p>
            <p className="mt-2 text-sm font-semibold leading-6 text-[#4b5f55]">
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
    <article className="rounded-lg border border-[#d7e5dc] bg-white p-5 shadow-sm shadow-[#047857]/10">
      <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
        <div className="min-w-0">
          <div className="flex flex-wrap gap-2">
            <span className="inline-flex w-fit rounded-lg border border-[#bbf7d0] bg-[#ecfdf5] px-3 py-1 text-xs font-black text-[#047857]">
              {match.status.replace(/_/g, ' ')}
            </span>
            <span className="inline-flex w-fit rounded-lg border border-[#d7e5dc] bg-[#f7faf8] px-3 py-1 text-xs font-black text-[#4b5f55]">
              {match.homeAway}
            </span>
            {match.teamName ? (
              <span className="inline-flex w-fit rounded-lg border border-[#d7e5dc] bg-[#f7faf8] px-3 py-1 text-xs font-black text-[#4b5f55]">
                {match.teamName}
              </span>
            ) : null}
          </div>
          <h4 className="mt-3 text-lg font-black text-[#101828]">{match.teamName || 'Our team'} v {match.opponent}</h4>
          <p className="mt-1 text-sm font-semibold text-[#4b5f55]">{formatMatchDate(match)}</p>
          {match.arrivalTime ? <p className="mt-1 text-sm font-semibold text-[#4b5f55]">Arrival {match.arrivalTime}</p> : null}
          {match.venueName ? <p className="mt-1 text-sm font-semibold text-[#4b5f55]">{match.venueName}</p> : null}
          {match.notes ? <p className="mt-2 whitespace-pre-wrap text-sm font-semibold leading-6 text-[#4b5f55]">{match.notes}</p> : null}
        </div>

        <div className="rounded-lg border border-[#d7e5dc] bg-[#ecfdf5] p-4 text-center shadow-sm shadow-[#047857]/10">
          <p className="text-xs font-black uppercase tracking-[0.16em] text-[#4b5f55]">Live score</p>
          <p className="mt-2 text-4xl font-black text-[#101828]">
            {getClubScore(match)} - {getOpponentScore(match)}
          </p>
          {currentMinute ? (
            <p className="mt-2 text-sm font-black text-[#4b5f55]">{currentMinute} min</p>
          ) : null}
        </div>
      </div>

      <div className="mt-5 grid gap-4 lg:grid-cols-2">
        <div className={panelClass}>
          <h5 className="text-sm font-black text-[#101828]">Score and status</h5>
          {match.status === 'scheduled' || match.status === 'scorer_request' ? (
            <button
              type="button"
              onClick={() => onStatusChange(match, 'live')}
              disabled={isBusy}
              className="mt-3 inline-flex min-h-10 w-full items-center justify-center rounded-lg bg-[#047857] px-4 py-2 text-sm font-black text-white transition hover:bg-[#065f46] disabled:cursor-not-allowed disabled:opacity-60 sm:w-auto"
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
              className="mt-auto inline-flex min-h-10 items-center justify-center rounded-lg bg-[#047857] px-4 py-2 text-sm font-black text-white transition hover:bg-[#065f46] disabled:cursor-not-allowed disabled:opacity-60"
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
                    ? 'border-[#047857] bg-[#047857] text-white'
                    : 'border-[#d7e5dc] bg-white text-[#101828] hover:border-[#0f9f6e] hover:bg-[#ecfdf5]'
                }`}
              >
                {option.label}
              </button>
            ))}
          </div>
        </div>

        <div className={panelClass}>
          <h5 className="text-sm font-black text-[#101828]">Parent scorer requests</h5>
          {match.scorerInterests.length > 0 ? (
            <div className="mt-3 space-y-2">
              {match.scorerInterests.map((interest) => {
                const isSelected = selectedParentLinkIds.has(String(interest.parentLinkId))

                return (
                  <div key={interest.id} className="rounded-lg border border-[#d7e5dc] bg-white p-3 shadow-sm shadow-[#047857]/10">
                    <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                      <div className="min-w-0">
                        <p className="text-sm font-black text-[#101828]">{interest.parentEmail || interest.parentName || 'Parent'}</p>
                        <p className="mt-1 text-xs font-semibold text-[#4b5f55]">
                          {interest.playerName ? `Linked to ${interest.playerName}` : 'Family portal volunteer'}
                        </p>
                        {interest.message ? <p className="mt-2 text-sm font-semibold text-[#4b5f55]">{interest.message}</p> : null}
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
            <div className="mt-3 rounded-lg border border-[#d7e5dc] bg-white px-4 py-5">
              <p className="text-sm font-black text-[#101828]">No parents have volunteered yet.</p>
              <p className="mt-2 text-sm font-semibold leading-6 text-[#4b5f55]">
                Keep the scorer request open or select a staff member to run the score from the touchline.
              </p>
            </div>
          )}
        </div>
      </div>

      <form className="mt-4 rounded-lg border border-[#d7e5dc] bg-[#f7faf8] p-4 shadow-sm shadow-[#047857]/10" onSubmit={(event) => onAddGoal(event, match)}>
        <h5 className="text-sm font-black text-[#101828]">Add goal</h5>
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
            className="mt-auto inline-flex min-h-10 items-center justify-center rounded-lg bg-[#047857] px-4 py-2 text-sm font-black text-white transition hover:bg-[#065f46] disabled:cursor-not-allowed disabled:opacity-60"
          >
            Add goal
          </button>
        </div>
      </form>

      {match.events.length > 0 ? (
        <div className="mt-4 space-y-2">
          {match.events.slice(0, 6).map((event) => (
            <div key={event.id} className="rounded-lg border border-[#d7e5dc] bg-[#f7faf8] px-4 py-3 shadow-sm shadow-[#047857]/10">
              <p className="text-sm font-black text-[#101828]">
                {getMatchEventTitle(event)}
              </p>
              <p className="mt-1 text-xs font-semibold text-[#4b5f55]">
                {getMatchEventDetail(event)}
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
    <div className="rounded-lg border border-[#d7e5dc] bg-white px-3 py-3 shadow-sm">
      <p className="text-[11px] font-black uppercase tracking-[0.14em] text-[#047857]">{label}</p>
      <p className="mt-2 text-2xl font-black text-[#101828]">{isLoading ? '...' : value}</p>
    </div>
  )
}

function FixtureSetupModal({
  applyLocation,
  form,
  handleCreateMatch,
  isFixtureDataLoading,
  isSaving,
  isTeamScopedFixture,
  locations,
  onClose,
  selectedFixtureTeamName,
  teams,
  updateArrivalFromPreset,
  updateForm,
  updateKickoffTime,
  user,
  validationMessage,
}) {
  const todayMatchDayDate = getTodayMatchDayDateValue()
  const { viewportStyle, isKeyboardOpen } = useFixtureModalViewportStyle()
  const {
    isFixtureControlFocused,
    handleFocusCapture,
    handleBlurCapture,
  } = useFixtureKeyboardFocusState()
  const shouldPrioritizeFixtureFields = isFixtureControlFocused || isKeyboardOpen

  return (
    <div
      className="fixed inset-x-0 top-[var(--fixture-modal-viewport-top)] z-50 box-border flex h-[var(--fixture-modal-viewport-height)] items-stretch justify-center overflow-hidden bg-[#101828]/55 px-3 pb-[max(0.75rem,env(safe-area-inset-bottom))] pt-[max(0.75rem,env(safe-area-inset-top))] sm:inset-0 sm:h-auto sm:items-center sm:px-4 sm:py-6"
      style={viewportStyle}
    >
      <section
        role="dialog"
        aria-modal="true"
        aria-labelledby="fixture-setup-title"
        className="flex max-h-full w-full max-w-5xl flex-col overflow-hidden rounded-lg border border-[#d7e5dc] bg-white shadow-xl sm:max-h-[92vh]"
      >
        <div className="hidden shrink-0 flex-col gap-4 border-b border-[#d7e5dc] bg-[#f7faf8] px-4 py-4 sm:flex sm:flex-row sm:items-start sm:justify-between sm:px-6 sm:py-5">
          <div>
            <p className={eyebrowClass}>Fixture setup</p>
            <h3 id="fixture-setup-title" className="mt-2 text-2xl font-black tracking-tight text-[#101828]">Create fixture</h3>
            <p className={`mt-2 max-w-3xl ${bodyTextClass}`}>
              Set the opponent, arrival, and venue. The squad selector opens after this step.
            </p>
          </div>
          <button type="button" onClick={onClose} disabled={isSaving} className={secondaryButtonClass}>
            Close
          </button>
        </div>
        <div className={`${shouldPrioritizeFixtureFields ? 'hidden' : 'flex'} shrink-0 items-center justify-between gap-3 border-b border-[#d7e5dc] bg-[#f7faf8] px-4 py-3 sm:hidden`}>
          <p className="text-sm font-black text-[#101828]">Fixture setup</p>
          <button type="button" onClick={onClose} disabled={isSaving} className="text-sm font-black text-[#047857] disabled:opacity-60">
            Close
          </button>
        </div>

        <form className="flex min-h-0 flex-1 flex-col overflow-hidden" onSubmit={handleCreateMatch} noValidate>
          <div
            className={`${shouldPrioritizeFixtureFields ? 'scroll-pb-8 scroll-pt-4' : 'scroll-pb-40 scroll-pt-28'} min-h-0 flex-1 overflow-y-auto overscroll-contain space-y-4 px-4 py-4 sm:scroll-pb-40 sm:scroll-pt-28 sm:px-6 sm:py-5`}
            onFocusCapture={handleFocusCapture}
            onBlurCapture={handleBlurCapture}
          >
            <div className="grid gap-4 md:grid-cols-2">
              <label className="block">
                <span className={labelClass}>Opponent</span>
                <input value={form.opponent} onChange={(event) => updateForm({ opponent: event.target.value })} className={inputClass} required />
              </label>

              {isTeamScopedFixture ? (
                <div className="block">
                  <span className={labelClass}>Team</span>
                  <div className={`${inputClass} flex items-center`}>{selectedFixtureTeamName || user.activeTeamName || user.team || 'Current team'}</div>
                </div>
              ) : (
                <label className="block">
                  <span className={labelClass}>Team</span>
                  <select value={form.teamId} onChange={(event) => updateForm({ teamId: event.target.value })} className={inputClass}>
                    <option value="">Club-wide fixture</option>
                    {teams.map((team) => <option key={team.id} value={team.id}>{team.name}</option>)}
                  </select>
                </label>
              )}

              <label className="block">
                <span className={labelClass}>Date</span>
                <input type="date" min={todayMatchDayDate} value={form.matchDate} onChange={(event) => updateForm({ matchDate: event.target.value })} className={inputClass} />
              </label>

              <label className="block">
                <span className={labelClass}>Kick off</span>
                <input type="time" value={form.kickoffTime} onChange={(event) => updateKickoffTime(event.target.value)} className={inputClass} />
              </label>

              <label className="block">
                <span className={labelClass}>Arrival</span>
                <select value={form.arrivalPreset} onChange={(event) => updateArrivalFromPreset(event.target.value)} className={inputClass}>
                  {MATCH_DAY_ARRIVAL_OPTIONS.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
                </select>
              </label>

              {form.arrivalPreset === 'custom' ? (
                <label className="block">
                  <span className={labelClass}>Custom arrival time</span>
                  <input type="time" value={form.arrivalTime} onChange={(event) => updateForm({ arrivalTime: event.target.value })} className={inputClass} />
                </label>
              ) : (
                <div className="block">
                  <span className={labelClass}>Arrival time</span>
                  <div className={`${inputClass} flex items-center`}>{form.arrivalTime || 'Set kick off to calculate arrival'}</div>
                </div>
              )}

              <label className="block">
                <span className={labelClass}>Home or away</span>
                <select value={form.homeAway} onChange={(event) => updateForm({ homeAway: event.target.value })} className={inputClass}>
                  {MATCH_DAY_HOME_AWAY_OPTIONS.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
                </select>
              </label>

              <label className="block">
                <span className={labelClass}>Reuse location</span>
                <select value="" onChange={(event) => applyLocation(event.target.value)} className={inputClass}>
                  <option value="">Choose saved location</option>
                  {locations.map((location) => <option key={location.id} value={location.id}>{location.name}</option>)}
                </select>
              </label>

              <label className="block">
                <span className={labelClass}>Venue</span>
                <input value={form.venueName} onChange={(event) => updateForm({ venueName: event.target.value })} className={inputClass} />
              </label>

              <label className="block">
                <span className={labelClass}>Address</span>
                <input value={form.venueAddress} onChange={(event) => updateForm({ venueAddress: event.target.value })} className={inputClass} />
              </label>
            </div>

            <label className="block">
              <span className={labelClass}>Scorer request message</span>
              <textarea value={form.scorerRequestMessage} onChange={(event) => updateForm({ scorerRequestMessage: event.target.value })} className={`${inputClass} min-h-24`} />
            </label>

            <label className="block">
              <span className={labelClass}>Match notes</span>
              <textarea value={form.notes} onChange={(event) => updateForm({ notes: event.target.value })} className={`${inputClass} min-h-24`} />
            </label>

            <div className="rounded-lg border border-[#d7e5dc] bg-[#f7faf8] p-4">
              <div className="grid gap-4 md:grid-cols-2">
                <label className="block">
                  <span className={labelClass}>Share with parents?</span>
                  <select
                    value={form.parentVisible ? 'yes' : 'no'}
                    onChange={(event) => updateForm({
                      parentVisible: event.target.value === 'yes',
                      parentAudience: event.target.value === 'yes' && form.parentAudience !== 'none'
                        ? form.parentAudience
                        : event.target.value === 'yes'
                          ? 'involved_players'
                          : 'none',
                    })}
                    className={inputClass}
                  >
                    <option value="no">No</option>
                    <option value="yes">Yes</option>
                  </select>
                </label>

                <label className="block">
                  <span className={labelClass}>Parent audience</span>
                  <select
                    value={form.parentVisible ? form.parentAudience : 'none'}
                    onChange={(event) => updateForm({ parentAudience: event.target.value })}
                    disabled={!form.parentVisible}
                    className={inputClass}
                  >
                    <option value="none">Not shared</option>
                    <option value="involved_players">Only parents of involved players</option>
                    <option value="all_team_parents">All parents in the team</option>
                    {!isTeamScopedFixture ? <option value="all_club_parents">All parents in the club</option> : null}
                  </select>
                </label>
              </div>
              {form.parentVisible && form.parentAudience === 'involved_players' ? (
                <p className="mt-3 rounded-lg border border-[#fedf89] bg-white px-3 py-3 text-xs font-bold leading-5 text-[#92400e]">
                  Only involved players uses the squad availability records selected in the next step.
                </p>
              ) : null}
            </div>

            <div className="grid gap-4 md:grid-cols-2">
              <label className="flex min-h-11 items-center gap-3 rounded-lg border border-[#d7e5dc] bg-[#f7faf8] px-4 py-3">
                <input type="checkbox" checked={form.enableMotmPoll} onChange={(event) => updateForm({ enableMotmPoll: event.target.checked })} className="h-4 w-4 accent-[#047857]" />
                <span className="text-sm font-black text-[#101828]">Create Player of the Match vote at full time</span>
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
          </div>

          {validationMessage ? (
            <p className={modalValidationClass} role="alert">
              {validationMessage}
            </p>
          ) : null}

          <div className={`${shouldPrioritizeFixtureFields ? 'hidden sm:flex' : 'flex'} shrink-0 flex-col-reverse gap-3 border-t border-[#d7e5dc] bg-white px-4 pb-[max(1rem,env(safe-area-inset-bottom))] pt-4 sm:flex-row sm:justify-end sm:px-6`}>
            <button type="button" onClick={onClose} disabled={isSaving} className={secondaryButtonClass}>Cancel</button>
            <button type="submit" onPointerDown={blurActiveFixtureControl} disabled={isSaving || isFixtureDataLoading} className={primaryButtonClass}>
              {isSaving ? 'Creating...' : isFixtureDataLoading ? 'Loading squad...' : 'Continue to squad'}
            </button>
          </div>
        </form>
      </section>
    </div>
  )
}

function FixtureSquadSelectionModal({
  isSaving,
  onCancel,
  onClearAll,
  onConfirm,
  onSelectAll,
  onSelectionModeChange,
  onTogglePlayer,
  parentVisible,
  players,
  selectedPlayerIds,
  selectionMode,
  teamName,
  validationMessage,
}) {
  const selectedIds = new Set(selectedPlayerIds)
  const selectedCount = selectedIds.size
  const { viewportStyle } = useFixtureModalViewportStyle()

  return (
    <div
      className="fixed inset-x-0 top-[var(--fixture-modal-viewport-top)] z-50 box-border flex h-[var(--fixture-modal-viewport-height)] items-stretch justify-center overflow-hidden bg-[#101828]/55 px-3 pb-[max(0.75rem,env(safe-area-inset-bottom))] pt-[max(0.75rem,env(safe-area-inset-top))] sm:inset-0 sm:h-auto sm:items-center sm:px-4 sm:py-6"
      style={viewportStyle}
    >
      <section
        role="dialog"
        aria-modal="true"
        aria-labelledby="fixture-squad-title"
        className="flex max-h-full w-full max-w-4xl flex-col overflow-hidden rounded-lg border border-[#d7e5dc] bg-white shadow-xl sm:max-h-[90vh]"
      >
        <div className="hidden shrink-0 border-b border-[#d7e5dc] bg-[#ecfdf5] px-4 py-4 sm:block sm:px-6 sm:py-5">
          <p className={eyebrowClass}>Squad availability</p>
          <h3 id="fixture-squad-title" className="mt-2 text-2xl font-black tracking-tight text-[#101828]">
            Choose who should be asked.
          </h3>
          <p className="mt-2 text-sm font-semibold leading-6 text-[#4b5f55]">
            Requests go to parent contacts for parent-managed players and directly to player contacts for adult player records. Mobile push can use these same request records later.
          </p>
        </div>
        <div className="shrink-0 border-b border-[#d7e5dc] bg-[#ecfdf5] px-4 py-3 sm:hidden">
          <p className="text-xs font-black uppercase tracking-[0.14em] text-[#047857]">Squad availability</p>
          <p className="mt-1 text-sm font-black text-[#101828]">{selectedCount} of {players.length} selected</p>
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain scroll-pb-32 scroll-pt-4 px-4 py-3 sm:scroll-pb-40 sm:scroll-pt-24 sm:px-6 sm:py-5">
          <div className="mb-3 flex flex-wrap items-center justify-between gap-2 sm:hidden">
            <div className="flex flex-wrap gap-2">
              <button type="button" onClick={onSelectAll} className={secondaryButtonClass}>Select full squad</button>
              <button type="button" onClick={onClearAll} className={secondaryButtonClass}>Clear</button>
            </div>
          </div>

          <div className="grid gap-3 sm:grid-cols-2">
            <button
              type="button"
              onClick={() => onSelectionModeChange('full')}
              className={`rounded-lg border px-3 py-3 text-left shadow-sm transition sm:px-4 sm:py-4 ${
                selectionMode === 'full'
                  ? 'border-[#047857] bg-[#ecfdf5]'
                  : 'border-[#d7e5dc] bg-white hover:border-[#0f9f6e]'
              }`}
            >
              <span className="block text-sm font-black text-[#101828]">Full squad</span>
              <span className="mt-1 hidden text-sm font-semibold leading-6 text-[#4b5f55] sm:block">Ask every active squad player in {teamName}.</span>
            </button>
            <button
              type="button"
              onClick={() => onSelectionModeChange('individual')}
              className={`rounded-lg border px-3 py-3 text-left shadow-sm transition sm:px-4 sm:py-4 ${
                selectionMode === 'individual'
                  ? 'border-[#047857] bg-[#ecfdf5]'
                  : 'border-[#d7e5dc] bg-white hover:border-[#0f9f6e]'
              }`}
            >
              <span className="block text-sm font-black text-[#101828]">Individual players</span>
              <span className="mt-1 hidden text-sm font-semibold leading-6 text-[#4b5f55] sm:block">Pick only the players needed for this fixture.</span>
            </button>
          </div>

          <div className="mt-4 hidden flex-wrap items-center justify-between gap-3 sm:flex">
            <p className="text-sm font-black text-[#101828]">{selectedCount} of {players.length} selected</p>
            <div className="flex flex-wrap gap-2">
              <button type="button" onClick={onSelectAll} className={secondaryButtonClass}>Select full squad</button>
              <button type="button" onClick={onClearAll} className={secondaryButtonClass}>Clear</button>
            </div>
          </div>

          <div className="mt-4 grid gap-2 md:grid-cols-2">
            {players.map((player) => (
              <label
                key={player.id}
                className="flex min-h-16 items-start gap-3 rounded-lg border border-[#d7e5dc] bg-[#f7faf8] px-4 py-3 shadow-sm shadow-[#047857]/10"
              >
                <input
                  type="checkbox"
                  checked={selectedIds.has(player.id)}
                  onChange={() => onTogglePlayer(player.id)}
                  className="mt-1 h-4 w-4 accent-[#047857]"
                />
                <span className="min-w-0">
                  <span className="block text-sm font-black text-[#101828]">{player.playerName}</span>
                  <span className="mt-1 block text-xs font-semibold text-[#4b5f55]">
                    {player.section || 'Squad'} | {player.contactType === 'self' ? 'Player contact' : 'Parent contact'}
                  </span>
                </span>
              </label>
            ))}
          </div>
        </div>

        {validationMessage ? (
          <p className={modalValidationClass} role="alert">
            {validationMessage}
          </p>
        ) : null}

        <div className="shrink-0 flex flex-col-reverse gap-3 border-t border-[#d7e5dc] bg-white px-4 pb-[max(1rem,env(safe-area-inset-bottom))] pt-4 sm:flex-row sm:justify-end sm:px-6">
          <button type="button" onClick={onCancel} disabled={isSaving} className={secondaryButtonClass}>
            Cancel
          </button>
          <button type="button" onPointerDown={blurActiveFixtureControl} onClick={onConfirm} disabled={isSaving || selectedCount === 0} className={primaryButtonClass}>
            {isSaving ? 'Creating...' : parentVisible ? 'Create fixture and request availability' : 'Create fixture'}
          </button>
        </div>
      </section>
    </div>
  )
}
