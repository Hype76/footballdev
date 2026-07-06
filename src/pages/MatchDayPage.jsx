import { useEffect, useMemo, useState } from 'react'
import { Navigate } from 'react-router-dom'
import { PreviousGameCard, PreviousGameDetailModal } from '../components/match-day/PreviousGameCard.jsx'
import { ConfirmModal } from '../components/ui/ConfirmModal.jsx'
import { NoticeBanner } from '../components/ui/NoticeBanner.jsx'
import { useToast } from '../components/ui/toast-context.js'
import { canManageMatchDay, useAuth } from '../lib/auth.js'
import {
  shouldSendMatchdayAvailabilityRequests,
  shouldSendMatchdayPushNotification,
} from '../lib/matchday-communication-safety.js'
import { sendMatchDayPushNotification } from '../lib/push-notifications.js'
import { getMatchDayDisplayName, getMatchDayDisplayParts, getMatchDayDisplayScore } from '../lib/matchday-display.js'
import {
  addStaffMatchDayEvent,
  addStaffMatchDayGoal,
  calculateArrivalTime,
  createMatchDay,
  createMatchDayEventLogEntry,
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
  selectMatchDayVolunteer,
  updateMatchDay,
  withRequestTimeout,
} from '../lib/supabase.js'
import {
  consumeFixtureSetupIntent,
  FIXTURE_SETUP_EVENT,
} from '../lib/matchday-workflow.js'
import {
  getMatchDayVolunteerActionKey,
  reconcileMatchDayVolunteerSelectionInList,
} from '../lib/matchday-volunteer-state.js'
import { reconcileMatchDayEventInList, reconcileMatchDayGoalInList } from '../lib/matchday-goal-state.js'
import { reconcileCreatedMatchDayInList, reconcileMatchDayUpdateInList } from '../lib/matchday-update-state.js'

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
  requestScorer: true,
  requestLinesman: false,
  requestReferee: false,
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

const availabilityStatusLabels = {
  pending: 'No response',
  available: 'Available',
  unavailable: 'Not available',
  maybe: 'Maybe',
  expired: 'Expired',
}

const volunteerResponseLabels = {
  yes: 'Yes',
  no: 'No',
  no_response: 'No response',
}

const EMPTY_MATCH_EVENT_FORM = {
  eventType: 'yellow_card',
  teamSide: 'club',
  minute: '',
  playerName: '',
  playerShirtNumber: '',
  notes: '',
}

const MATCH_EVENT_TYPE_OPTIONS = [
  { value: 'yellow_card', label: 'Yellow card', confirmLabel: 'yellow card' },
  { value: 'red_card', label: 'Red card', confirmLabel: 'red card' },
  { value: 'substitution', label: 'Substitution', confirmLabel: 'substitution' },
  { value: 'water_break', label: 'Water break', confirmLabel: 'water break' },
]

const parentAudienceLabels = {
  all_club_parents: 'All club parents',
  all_team_parents: 'All team parents',
  involved_players: 'Involved players',
  none: 'Staff only',
}

const volunteerRoleConfigs = [
  {
    key: 'scorer',
    label: 'Scorer',
    requestKey: 'requestScorer',
    responseKey: 'volunteerScorerResponse',
  },
  {
    key: 'linesman',
    label: 'Linesman',
    requestKey: 'requestLinesman',
    responseKey: 'volunteerLinesmanResponse',
  },
  {
    key: 'referee',
    label: 'Referee',
    requestKey: 'requestReferee',
    responseKey: 'volunteerRefereeResponse',
  },
]

function normalizeVolunteerText(value) {
  return String(value ?? '').trim().toLowerCase()
}

function confirmMatchDayAction(message) {
  return window.confirm(message)
}

function getVolunteerConfirmationCopy({ match, roleLabel, selected, volunteer }) {
  const parentName = volunteer.parentEmail || volunteer.parentName || 'this parent'
  const currentAssignment = getSelectedRoleAssignment(match, roleLabel.key)
  const isReplacing = Boolean(selected && currentAssignment && !isSelectedRoleVolunteer(currentAssignment, volunteer))
  const title = selected
    ? isReplacing
      ? `Replace ${roleLabel.label.toLowerCase()}`
      : `Select ${roleLabel.label.toLowerCase()}`
    : `Deselect ${roleLabel.label.toLowerCase()}`
  const message = selected
    ? isReplacing
      ? `Replace the selected ${roleLabel.label.toLowerCase()} with ${parentName}?`
      : `Select ${parentName} as ${roleLabel.label.toLowerCase()}?`
    : `Deselect ${parentName} as ${roleLabel.label.toLowerCase()}?`

  return {
    title,
    message,
    confirmLabel: selected ? 'Confirm selection' : 'Confirm deselect',
  }
}

function formatResponseDateTime(value) {
  if (!value) {
    return 'Not replied yet'
  }

  const date = new Date(value)

  if (Number.isNaN(date.getTime())) {
    return value
  }

  return date.toLocaleString([], {
    day: '2-digit',
    month: 'short',
    hour: '2-digit',
    minute: '2-digit',
  })
}

function getAvailabilityStatusLabel(status) {
  return availabilityStatusLabels[String(status || 'pending').toLowerCase()] || 'No response'
}

function getVolunteerResponseLabel(response) {
  return volunteerResponseLabels[String(response || 'no_response').toLowerCase()] || 'No response'
}

function getRequestedVolunteerRoles(match) {
  return volunteerRoleConfigs.filter((role) => match?.[role.requestKey] === true)
}

function getRoleResponseRows(match, role) {
  return (match.availabilityRequests || [])
    .filter((request) => ['yes', 'no'].includes(String(request[role.responseKey] || '').toLowerCase()))
    .map((request) => ({
      id: `${role.key}:${request.id}`,
      requestId: request.id,
      parentLinkId: request.parentLinkId,
      authUserId: request.authUserId,
      playerName: request.playerName || 'Player',
      parentName: request.recipientName,
      parentEmail: request.recipientEmail,
      parentLabel: request.recipientEmail || request.recipientName || 'Parent',
      response: request[role.responseKey],
      respondedAt: request.volunteerRespondedAt || request.respondedAt,
    }))
}

function hasTransportResponse(row) {
  return row?.transportNeedsLift === true
    || row?.transportCanOfferLift === true
    || Number(row?.transportSeatsOffered || 0) > 0
    || Boolean(row?.transportRespondedAt)
}

function getLatestTransportResponseForPlayer(match, row) {
  const playerKey = getAvailabilityPlayerKey(row)

  return (match.availabilityRequests || [])
    .filter((request) => getAvailabilityPlayerKey(request) === playerKey && hasTransportResponse(request))
    .sort((first, second) => {
      const firstTime = first.transportRespondedAt || first.updatedAt || first.respondedAt || first.createdAt || ''
      const secondTime = second.transportRespondedAt || second.updatedAt || second.respondedAt || second.createdAt || ''
      return String(secondTime).localeCompare(String(firstTime))
    })[0] || null
}

function mergeTransportResponse(match, row) {
  const transportResponse = hasTransportResponse(row) ? row : getLatestTransportResponseForPlayer(match, row)
  const canOfferLift = transportResponse?.transportCanOfferLift === true

  return {
    ...row,
    transportNeedsLift: transportResponse?.transportNeedsLift === true,
    transportCanOfferLift: canOfferLift,
    transportSeatsOffered: canOfferLift ? Number(transportResponse?.transportSeatsOffered || 0) : 0,
    transportRespondedAt: transportResponse?.transportRespondedAt || '',
  }
}

function getCurrentAvailabilityRows(match) {
  if (match.playerAvailability?.length > 0) {
    return match.playerAvailability.map((row) => mergeTransportResponse(match, row))
  }

  const latestByPlayer = new Map()

  for (const request of match.availabilityRequests || []) {
    const key = request.playerId || request.playerName || request.id
    const current = latestByPlayer.get(key)
    const currentTime = current?.respondedAt || current?.createdAt || ''
    const requestTime = request.respondedAt || request.createdAt || ''

    if (!current || String(requestTime) > String(currentTime)) {
      latestByPlayer.set(key, {
        id: request.id,
        playerId: request.playerId,
        playerName: request.playerName,
        status: request.status,
        selectedByName: request.recipientName,
        selectedByEmail: request.recipientEmail,
        selectedAt: request.respondedAt,
        transportNeedsLift: request.transportNeedsLift,
        transportCanOfferLift: request.transportCanOfferLift,
        transportSeatsOffered: request.transportSeatsOffered,
        transportRespondedAt: request.transportRespondedAt,
      })
    }
  }

  return Array.from(latestByPlayer.values()).map((row) => mergeTransportResponse(match, row))
}

function getAvailabilityHistoryForPlayer(match, row) {
  return (match.availabilityHistory || [])
    .filter((entry) => String(entry.playerId || '') === String(row.playerId || ''))
    .slice(0, 3)
}

function getSelectedRoleAssignment(match, roleKey) {
  return (match.roleAssignments || []).find((assignment) => assignment.role === roleKey) || null
}

function isSelectedRoleVolunteer(selectedAssignment, row) {
  if (!selectedAssignment || !row) {
    return false
  }

  if (selectedAssignment.parentLinkId && row.parentLinkId) {
    return String(selectedAssignment.parentLinkId) === String(row.parentLinkId)
  }

  const selectedEmail = normalizeVolunteerText(selectedAssignment.parentEmail)
  const rowEmail = normalizeVolunteerText(row.parentEmail)
  const selectedPlayerName = normalizeVolunteerText(selectedAssignment.playerName)
  const rowPlayerName = normalizeVolunteerText(row.playerName)
  return Boolean(
    selectedEmail
      && rowEmail
      && selectedEmail === rowEmail
      && selectedPlayerName
      && rowPlayerName
      && selectedPlayerName === rowPlayerName,
  )
}

function getVolunteerSelectionReason(row) {
  const isYesReply = normalizeVolunteerText(row?.response) === 'yes'

  if (!isYesReply) {
    return 'Only parents who replied Yes can be selected.'
  }

  if (!row?.requestId) {
    return 'This response cannot be assigned because the request record is missing.'
  }

  return ''
}

function getVolunteerRowStatus({ isSelected, response, selectedAssignment }) {
  const normalizedResponse = normalizeVolunteerText(response)

  if (isSelected) {
    return 'Selected'
  }

  if (normalizedResponse === 'yes') {
    return selectedAssignment ? 'Not selected, another volunteer selected' : 'Available volunteer'
  }

  if (normalizedResponse === 'no') {
    return 'Not available'
  }

  return 'No response'
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

function formatMatchEventTimestamp(value) {
  if (!value) {
    return 'Time not recorded'
  }

  const date = new Date(value)

  if (Number.isNaN(date.getTime())) {
    return value
  }

  return date.toLocaleString([], {
    day: '2-digit',
    month: 'short',
    hour: '2-digit',
    minute: '2-digit',
  })
}

function getMatchEventTypeLabel(event) {
  if (event.eventType === 'goal') {
    return event.teamSide === 'opponent' ? 'Opponent goal' : 'Our goal'
  }

  if (event.eventType === 'score_correction') {
    return 'Score correction'
  }

  if (event.eventType === 'status_change') {
    return 'Status update'
  }

  if (event.eventType === 'note') {
    return 'Match note'
  }

  if (event.eventType === 'yellow_card') {
    return 'Yellow card'
  }

  if (event.eventType === 'red_card') {
    return 'Red card'
  }

  if (event.eventType === 'substitution') {
    return 'Substitution'
  }

  if (event.eventType === 'water_break') {
    return 'Water break'
  }

  return 'Match update'
}

function getMatchEventToneClass(event) {
  if (event.eventType === 'yellow_card') {
    return 'border-[#facc15] bg-[#fefce8] text-[#854d0e]'
  }

  if (event.eventType === 'red_card') {
    return 'border-[#fecaca] bg-[#fef2f2] text-[#991b1b]'
  }

  if (event.eventType === 'substitution') {
    return 'border-[#bfdbfe] bg-[#eff6ff] text-[#1d4ed8]'
  }

  if (event.eventType === 'water_break') {
    return 'border-[#bae6fd] bg-[#f0f9ff] text-[#0369a1]'
  }

  if (event.eventType === 'score_correction') {
    return 'border-[#facc15] bg-[#fefce8] text-[#854d0e]'
  }

  if (event.eventType === 'goal' && event.teamSide === 'opponent') {
    return 'border-[#fed7aa] bg-[#fff7ed] text-[#92400e]'
  }

  if (event.eventType === 'goal') {
    return 'border-[#bbf7d0] bg-[#ecfdf5] text-[#047857]'
  }

  return 'border-[#d7e5dc] bg-[#f7faf8] text-[#101828]'
}

function getMatchEventBadge(event) {
  const badges = {
    yellow_card: { label: 'Yellow card', text: '', className: 'border-[#ca8a04] bg-[#facc15]' },
    red_card: { label: 'Red card', text: '', className: 'border-[#b91c1c] bg-[#dc2626]' },
    substitution: { label: 'Substitution', text: 'Swap', className: 'border-[#1d4ed8] bg-[#dbeafe] text-[#1d4ed8]' },
    water_break: { label: 'Water break', text: 'Water', className: 'border-[#0284c7] bg-[#e0f2fe] text-[#0369a1]' },
  }

  return badges[event.eventType] || null
}

function getMatchEventScoreLabel(event) {
  const homeScore = Number(event.homeScore)
  const awayScore = Number(event.awayScore)

  if (!Number.isFinite(homeScore) || !Number.isFinite(awayScore)) {
    return 'Score not recorded'
  }

  return `${homeScore} - ${awayScore}`
}

function getMatchEventDetailItems(event) {
  const scorerLabel = event.scorerInitials || event.scorerName
  const assistLabel = event.assistInitials || event.assistName
  const playerLabel = scorerLabel ? `${scorerLabel}${event.scorerShirtNumber ? ` #${event.scorerShirtNumber}` : ''}` : ''
  const items = [
    event.minute !== null && event.minute !== undefined ? { label: 'Minute', value: `${event.minute}` } : null,
    scorerLabel ? { label: event.eventType === 'goal' ? 'Scorer' : 'Player', value: playerLabel } : null,
    event.assistInitials || event.assistName
      ? { label: 'Assist', value: `${assistLabel}${event.assistShirtNumber ? ` #${event.assistShirtNumber}` : ''}` }
      : null,
    event.notes ? { label: 'Note', value: event.notes } : null,
    event.createdByName ? { label: 'Recorded by', value: event.createdByName } : null,
    { label: 'Time', value: formatMatchEventTimestamp(event.createdAt) },
  ]

  return items.filter(Boolean)
}

function normalizeStaffGoalText(value) {
  return String(value ?? '').trim()
}

function normalizeStaffGoalScore(value) {
  const score = Number(value ?? 0)
  return Number.isFinite(score) ? score : 0
}

function getStaffGoalScoreImpact(match = {}, teamSide = 'club') {
  const normalizedTeamSide = normalizeStaffGoalText(teamSide) === 'opponent' ? 'opponent' : 'club'
  let nextHomeScore = normalizeStaffGoalScore(match.homeScore ?? match.home_score)
  let nextAwayScore = normalizeStaffGoalScore(match.awayScore ?? match.away_score)
  const homeAway = normalizeStaffGoalText(match.homeAway ?? match.home_away)

  if (normalizedTeamSide === 'club') {
    if (homeAway === 'away') {
      nextAwayScore += 1
    } else {
      nextHomeScore += 1
    }
  } else if (homeAway === 'away') {
    nextHomeScore += 1
  } else {
    nextAwayScore += 1
  }

  return {
    homeScore: nextHomeScore,
    awayScore: nextAwayScore,
    teamSide: normalizedTeamSide,
  }
}

function formatStaffGoalPersonPreview(name, shirtNumber, fallback) {
  const normalizedName = normalizeStaffGoalText(name)
  const normalizedShirtNumber = normalizeStaffGoalText(shirtNumber)

  if (normalizedName && normalizedShirtNumber) {
    return `${normalizedName} #${normalizedShirtNumber}`
  }

  if (normalizedName) {
    return normalizedName
  }

  if (normalizedShirtNumber) {
    return `Shirt #${normalizedShirtNumber}`
  }

  return fallback
}

function buildStaffGoalPreview(match = {}, goalForm = {}) {
  const scoreImpact = getStaffGoalScoreImpact(match, goalForm.teamSide)
  const previewMatch = {
    ...match,
    homeScore: scoreImpact.homeScore,
    awayScore: scoreImpact.awayScore,
  }
  const goalSideName = scoreImpact.teamSide === 'opponent'
    ? normalizeStaffGoalText(match.opponent) || 'Opponent'
    : normalizeStaffGoalText(match.teamName ?? match.team_name) || 'Our team'

  return {
    assistPreview: formatStaffGoalPersonPreview(goalForm.assistName, goalForm.assistShirtNumber, 'No assist recorded'),
    goalSideLabel: scoreImpact.teamSide === 'opponent' ? 'Opponent' : 'Our team',
    goalSideName,
    homeScore: scoreImpact.homeScore,
    awayScore: scoreImpact.awayScore,
    minutePreview: normalizeStaffGoalText(goalForm.minute) || 'Auto from match clock',
    notePreview: normalizeStaffGoalText(goalForm.notes) || 'No note entered',
    scoreAfter: getMatchDayDisplayScore(previewMatch),
    scoreBefore: getMatchDayDisplayScore(match),
    scorerPreview: formatStaffGoalPersonPreview(goalForm.scorerName, goalForm.scorerShirtNumber, 'No scorer selected'),
    teamSide: scoreImpact.teamSide,
  }
}

function formatEventLogTimestamp(value) {
  if (!value) {
    return 'Time not recorded'
  }

  const date = new Date(value)

  if (Number.isNaN(date.getTime())) {
    return value
  }

  return date.toLocaleString([], {
    day: '2-digit',
    month: 'short',
    hour: '2-digit',
    minute: '2-digit',
  })
}

function getEventLogActorLabel(entry) {
  return entry.actorDisplayName || entry.actorRole || 'System'
}

function getEventLogTypeLabel(entry) {
  const eventType = String(entry.eventType || 'update')
  const labels = {
    invite_prepared: 'invite prepared',
    invite_queued: 'invite queued',
    linesman_updated: 'linesman',
    player_availability_changed: 'availability',
    player_deselected: 'player deselected',
    player_selected: 'player selected',
    red_card: 'red card',
    substitution: 'substitution',
    water_break: 'water break',
    yellow_card: 'yellow card',
  }

  return labels[eventType] || eventType.replace(/_/g, ' ')
}

const EVENT_LOG_FILTERS = [
  { key: 'all', label: 'All' },
  { key: 'squad', label: 'Squad' },
  { key: 'availability', label: 'Availability' },
  { key: 'roles', label: 'Roles' },
  { key: 'invites', label: 'Invites' },
  { key: 'match', label: 'Match' },
]

const EVENT_LOG_TYPE_FILTERS = {
  invite_prepared: 'invites',
  invite_queued: 'invites',
  linesman_updated: 'roles',
  match_day_created: 'match',
  match_day_updated: 'match',
  match_role_assigned: 'roles',
  match_role_removed: 'roles',
  note_updated: 'match',
  player_availability_changed: 'availability',
  player_deselected: 'squad',
  player_selected: 'squad',
  red_card: 'match',
  scorer_updated: 'match',
  substitution: 'match',
  water_break: 'match',
  yellow_card: 'match',
}

function getEventLogFilterKey(entry) {
  const eventType = String(entry?.eventType || '')
  const directFilter = EVENT_LOG_TYPE_FILTERS[eventType]

  if (directFilter) {
    return directFilter
  }

  if (
    eventType.includes('fixture')
    || eventType.includes('match')
    || eventType.includes('note')
    || eventType.includes('score')
    || eventType.includes('scorer')
  ) {
    return 'match'
  }

  return 'other'
}

function getEventLogDetail(entry) {
  const previousStatus = entry.previousValue?.status
  const nextStatus = entry.newValue?.status
  const selectionState = entry.eventType === 'player_selected'
    ? 'Selected for this fixture'
    : entry.eventType === 'player_deselected'
      ? 'Deselected from this fixture'
      : ''
  const inviteState = entry.eventType === 'invite_prepared'
    ? 'Availability invite prepared'
    : entry.eventType === 'invite_queued'
      ? 'Availability invite queued'
      : ''
  const details = [
    entry.playerName ? `Player: ${entry.playerName}` : '',
    entry.metadata?.role ? `Role: ${String(entry.metadata.role).replace(/_/g, ' ')}` : '',
    entry.metadata?.playerName ? `Player: ${entry.metadata.playerName}` : '',
    entry.metadata?.minute !== null && entry.metadata?.minute !== undefined ? `Minute: ${entry.metadata.minute}` : '',
    entry.metadata?.action ? `Action: ${String(entry.metadata.action).replace(/_/g, ' ')}` : '',
    previousStatus || nextStatus
      ? `Availability: ${previousStatus || 'not recorded'} to ${nextStatus || 'not recorded'}`
      : '',
    selectionState,
    inviteState,
    Number.isFinite(Number(entry.metadata?.notificationQueuedCount))
      ? `Notifications queued: ${Number(entry.metadata.notificationQueuedCount)}`
      : '',
    entry.metadata?.fields?.length ? `Changed: ${entry.metadata.fields.join(', ')}` : '',
  ]

  return details.filter(Boolean).join(', ')
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

function getMatchStatusLabel(status) {
  return MATCH_DAY_STATUS_OPTIONS.find((option) => option.value === status)?.label || String(status || 'scheduled').replace(/_/g, ' ')
}

function getHomeAwayLabel(homeAway) {
  return MATCH_DAY_HOME_AWAY_OPTIONS.find((option) => option.value === homeAway)?.label || String(homeAway || 'Home')
}

function getAvailabilityPlayerKey(row) {
  return String(row?.playerId || row?.playerName || row?.id || '').trim()
}

function getAvailabilityConflictKeys(requests) {
  const statusesByPlayer = new Map()

  requests.forEach((request) => {
    const playerKey = getAvailabilityPlayerKey(request)
    const status = String(request.status || 'pending').toLowerCase()

    if (!playerKey || status === 'pending' || status === 'expired') {
      return
    }

    const statuses = statusesByPlayer.get(playerKey) || new Set()
    statuses.add(status)
    statusesByPlayer.set(playerKey, statuses)
  })

  return new Set(
    [...statusesByPlayer.entries()]
      .filter(([, statuses]) => statuses.size > 1)
      .map(([playerKey]) => playerKey),
  )
}

function getAvailabilityConflictCount(requests) {
  return getAvailabilityConflictKeys(requests).size
}

function getTransportRiskRows(match) {
  const currentRows = getCurrentAvailabilityRows(match)
  const requests = Array.isArray(match.availabilityRequests) ? match.availabilityRequests : []
  const conflictKeys = getAvailabilityConflictKeys(requests)
  const riskRows = []

  currentRows.forEach((row) => {
    const playerKey = getAvailabilityPlayerKey(row)
    const status = String(row.status || 'pending').toLowerCase()
    const reasons = []

    if (status === 'unavailable') {
      reasons.push({
        key: 'unavailable',
        label: 'Unavailable',
        detail: 'Selected player does not have a clear available response.',
      })
    } else if (status === 'maybe') {
      reasons.push({
        key: 'maybe',
        label: 'Maybe',
        detail: 'Selected player does not have a clear available response.',
      })
    } else if (status !== 'available') {
      reasons.push({
        key: 'no_response',
        label: 'No response yet',
        detail: 'Selected player does not have a clear available response.',
      })
    }

    if (playerKey && conflictKeys.has(playerKey)) {
      reasons.push({
        key: 'conflict',
        label: 'Conflicting response',
        detail: 'More than one availability status exists for this player.',
      })
    }

    if (row.transportNeedsLift === true) {
      reasons.push({
        key: 'needs_lift',
        label: 'Needs lift',
        detail: 'Parent says this player needs transport help. Staff coordinate manually.',
      })
    }

    if (row.transportCanOfferLift === true) {
      reasons.push({
        key: 'lift_offer',
        label: row.transportSeatsOffered > 0 ? `Lift offered (${row.transportSeatsOffered})` : 'Lift offered',
        detail: 'Parent can offer transport help. Staff coordinate manually.',
      })
    }

    if (reasons.length > 0) {
      riskRows.push({
        id: row.id || row.playerId || row.playerName,
        playerKey,
        playerName: row.playerName || 'Player',
        status,
        transportNeedsLift: row.transportNeedsLift,
        transportCanOfferLift: row.transportCanOfferLift,
        transportSeatsOffered: row.transportSeatsOffered,
        transportRespondedAt: row.transportRespondedAt,
        reasons,
      })
    }
  })

  return riskRows
}

function getTransportRiskSummary(rows) {
  const summary = {
    conflicts: 0,
    liftOffers: 0,
    maybe: 0,
    needsFollowUp: rows.length,
    needsLift: 0,
    noResponse: 0,
    seatsOffered: 0,
    unavailable: 0,
  }

  rows.forEach((row) => {
    const reasonKeys = new Set(row.reasons.map((reason) => reason.key))

    if (reasonKeys.has('conflict')) {
      summary.conflicts += 1
    }

    if (reasonKeys.has('lift_offer')) {
      summary.liftOffers += 1
      summary.seatsOffered += Number(row.transportSeatsOffered || 0)
    }

    if (reasonKeys.has('maybe')) {
      summary.maybe += 1
    }

    if (reasonKeys.has('needs_lift')) {
      summary.needsLift += 1
    }

    if (reasonKeys.has('no_response')) {
      summary.noResponse += 1
    }

    if (reasonKeys.has('unavailable')) {
      summary.unavailable += 1
    }
  })

  return summary
}

function createTransportCoordinationGroup(label, rows) {
  return {
    label,
    rows,
    count: rows.length,
  }
}

function getTransportCoordinationSummary(rows = []) {
  const coordinationRows = rows.map((row) => {
    const status = String(row.status || 'pending').toLowerCase()
    const transportSeatsOffered = row.transportCanOfferLift === true ? Number(row.transportSeatsOffered || 0) : 0

    return {
      id: row.id || row.playerId || row.playerName,
      playerName: row.playerName || 'Player',
      status,
      transportNeedsLift: row.transportNeedsLift === true,
      transportCanOfferLift: row.transportCanOfferLift === true,
      transportSeatsOffered,
      transportRespondedAt: row.transportRespondedAt || '',
    }
  })
  const needsLift = coordinationRows.filter((row) => row.transportNeedsLift === true)
  const canOfferSeats = coordinationRows.filter((row) => row.transportCanOfferLift === true)
  const noResponse = coordinationRows.filter((row) => !['available', 'maybe', 'unavailable'].includes(row.status))
  const maybe = coordinationRows.filter((row) => row.status === 'maybe')
  const unavailable = coordinationRows.filter((row) => row.status === 'unavailable')
  const chaseKeys = new Set([
    ...needsLift.map((row) => row.id),
    ...noResponse.map((row) => row.id),
    ...maybe.map((row) => row.id),
    ...unavailable.map((row) => row.id),
  ])
  const seatsOffered = canOfferSeats.reduce((total, row) => total + row.transportSeatsOffered, 0)
  const liftNeeds = needsLift.length
  const seatBalance = seatsOffered - liftNeeds

  return {
    groups: [
      createTransportCoordinationGroup('Needs lift', needsLift),
      createTransportCoordinationGroup('Can offer seats', canOfferSeats),
      createTransportCoordinationGroup('No response', noResponse),
      createTransportCoordinationGroup('Maybe', maybe),
      createTransportCoordinationGroup('Unavailable', unavailable),
    ],
    chaseList: coordinationRows.filter((row) => chaseKeys.has(row.id)),
    liftNeeds,
    seatBalance,
    seatsOffered,
  }
}

function getAvailabilityStats(match) {
  const rows = getCurrentAvailabilityRows(match)
  const requests = Array.isArray(match.availabilityRequests) ? match.availabilityRequests : []
  const counts = {
    available: 0,
    expired: 0,
    maybe: 0,
    pending: 0,
    unavailable: 0,
  }

  rows.forEach((row) => {
    const status = String(row.status || 'pending').toLowerCase()
    counts[status] = (counts[status] ?? 0) + 1
  })

  return {
    ...counts,
    total: rows.length,
    conflictCount: getAvailabilityConflictCount(requests),
  }
}

async function logFixtureSquadSelectionEvents({
  availablePlayerIds,
  match,
  players,
  selectedPlayerIds,
  selectionMode,
  user,
}) {
  const selectedIds = new Set(selectedPlayerIds.map(String))
  const availableIds = new Set(availablePlayerIds.map(String))
  const selectedPlayers = players.filter((player) => selectedIds.has(String(player.id)))
  const deselectedPlayers = selectionMode === 'individual'
    ? players.filter((player) => availableIds.has(String(player.id)) && !selectedIds.has(String(player.id)))
    : []

  const logEvents = [
    ...selectedPlayers.map((player) => ({
      eventLabel: `${player.playerName || 'Player'} selected`,
      eventType: 'player_selected',
      newValue: {
        selected: true,
      },
      player,
    })),
    ...deselectedPlayers.map((player) => ({
      eventLabel: `${player.playerName || 'Player'} deselected`,
      eventType: 'player_deselected',
      newValue: {
        selected: false,
      },
      previousValue: {
        selected: true,
      },
      player,
    })),
  ]

  for (const logEvent of logEvents) {
    await createMatchDayEventLogEntry({
      user,
      match,
      eventType: logEvent.eventType,
      eventLabel: logEvent.eventLabel,
      playerId: logEvent.player.id,
      previousValue: logEvent.previousValue,
      newValue: logEvent.newValue,
      metadata: {
        selectionMode,
        source: 'staff_fixture_squad_selection',
      },
    })
  }
}

function getAvailabilitySummary(match) {
  const stats = getAvailabilityStats(match)

  if (stats.total === 0) {
    return match.parentVisible ? 'Awaiting availability' : 'Staff only'
  }

  return `${stats.available} available, ${stats.pending} no response, ${stats.maybe} maybe, ${stats.unavailable} unavailable`
}

function getRoleStatus(match, roleKey) {
  const role = volunteerRoleConfigs.find((item) => item.key === roleKey)
  const selectedAssignment = getSelectedRoleAssignment(match, roleKey)

  if (selectedAssignment) {
    return 'Assigned'
  }

  if (!role || match[role.requestKey] !== true) {
    return 'Not requested'
  }

  const yesReplies = getRoleResponseRows(match, role).filter((row) => String(row.response || '').toLowerCase() === 'yes')

  if (yesReplies.length > 0) {
    return `${yesReplies.length} volunteered`
  }

  return 'Needed'
}

function getLatestEventLogEntry(match) {
  const eventLog = Array.isArray(match.eventLog) ? match.eventLog : []

  return eventLog[0] || null
}

function getLatestInviteLogEntry(match) {
  const eventLog = Array.isArray(match.eventLog) ? match.eventLog : []

  return eventLog.find((entry) => ['invite_queued', 'invite_prepared'].includes(entry.eventType)) || null
}

function getAvailabilityRequestStateLabel({ latestInvite, requestCount }) {
  if (latestInvite?.eventType === 'invite_queued') {
    return 'Invite queued'
  }

  if (latestInvite?.eventType === 'invite_prepared') {
    return 'Invite prepared'
  }

  if (requestCount > 0) {
    return 'Request linked'
  }

  return 'No availability request queued'
}

function getMatchDaySetupReadiness(match) {
  const missingFields = []

  if (!match.opponent) {
    missingFields.push('opponent')
  }

  if (!match.matchDate) {
    missingFields.push('date')
  }

  if (!match.kickoffTime) {
    missingFields.push('kickoff')
  }

  if (!match.venueName && !match.homeAway) {
    missingFields.push('venue')
  }

  if (missingFields.length > 0) {
    return {
      detail: `Missing ${missingFields.join(', ')}`,
      label: 'Setup',
      status: 'Needs attention',
      tone: 'warning',
    }
  }

  return {
    detail: 'Fixture details present',
    label: 'Setup',
    status: 'Ready',
    tone: 'success',
  }
}

function getMatchDayVisibilityReadiness(match) {
  if (match.parentVisible === true) {
    return {
      detail: parentAudienceLabels[match.parentAudience] || 'Selected parent audience',
      label: 'Parent visibility',
      status: 'Visible to parents',
      tone: 'success',
    }
  }

  return {
    detail: 'Staff view only',
    label: 'Parent visibility',
    status: 'Not visible to parents',
    tone: 'neutral',
  }
}

function getMatchDayAvailabilityReadiness(match) {
  const stats = getAvailabilityStats(match)
  const requests = Array.isArray(match.availabilityRequests) ? match.availabilityRequests : []
  const latestInvite = getLatestInviteLogEntry(match)
  const requestState = getAvailabilityRequestStateLabel({
    latestInvite,
    requestCount: requests.length,
  })
  const responseDetail = stats.total > 0
    ? `${stats.available} available, ${stats.pending} no response, ${stats.maybe} maybe, ${stats.unavailable} unavailable`
    : 'No responses yet'

  if (requests.length === 0 && !latestInvite) {
    return {
      detail: responseDetail,
      label: 'Availability',
      status: requestState,
      tone: 'neutral',
    }
  }

  return {
    detail: responseDetail,
    label: 'Availability',
    status: stats.pending > 0 || latestInvite ? requestState : 'Ready',
    tone: stats.pending > 0 ? 'warning' : 'success',
  }
}

function getMatchDayRoleReadiness(match) {
  const roleStatuses = volunteerRoleConfigs.map((role) => ({
    label: role.label,
    status: getRoleStatus(match, role.key),
  }))
  const requestedRoles = roleStatuses.filter((role) => role.status !== 'Not requested')
  const neededRoles = roleStatuses.filter((role) => role.status === 'Needed')
  const pendingRoles = roleStatuses.filter((role) => role.status.includes('volunteered'))

  if (requestedRoles.length === 0) {
    return {
      detail: roleStatuses.map((role) => `${role.label}: ${role.status}`).join(', '),
      label: 'Roles',
      status: 'Not requested',
      tone: 'neutral',
    }
  }

  if (neededRoles.length > 0) {
    return {
      detail: roleStatuses.map((role) => `${role.label}: ${role.status}`).join(', '),
      label: 'Roles',
      status: 'Needs attention',
      tone: 'warning',
    }
  }

  if (pendingRoles.length > 0) {
    return {
      detail: roleStatuses.map((role) => `${role.label}: ${role.status}`).join(', '),
      label: 'Roles',
      status: 'Pending',
      tone: 'warning',
    }
  }

  return {
    detail: roleStatuses.map((role) => `${role.label}: ${role.status}`).join(', '),
    label: 'Roles',
    status: 'Ready',
    tone: 'success',
  }
}

function getMatchDayLatestSignalReadiness(match) {
  const latestEntry = getLatestEventLogEntry(match)

  if (!latestEntry) {
    return {
      detail: 'No logged activity for this fixture.',
      label: 'Latest change',
      status: 'No event log entries yet',
      tone: 'neutral',
    }
  }

  return {
    detail: `${latestEntry.eventLabel || 'Match Day update'} at ${formatEventLogTimestamp(latestEntry.createdAt)}`,
    label: 'Latest change',
    status: getEventLogTypeLabel(latestEntry),
    tone: 'success',
  }
}

function getMatchDayReadinessSummary(match) {
  const items = [
    getMatchDaySetupReadiness(match),
    getMatchDayVisibilityReadiness(match),
    getMatchDayAvailabilityReadiness(match),
    getMatchDayRoleReadiness(match),
    getMatchDayLatestSignalReadiness(match),
  ]
  const hasNeedsAttention = items.some((item) => item.status === 'Needs attention')
  const hasPending = items.some((item) => item.tone === 'warning')

  return {
    items,
    status: hasNeedsAttention ? 'Needs attention' : hasPending ? 'Pending' : 'Ready',
    tone: hasNeedsAttention || hasPending ? 'warning' : 'success',
  }
}

function getNeedsAttentionItems(activeMatches) {
  const availabilityStats = activeMatches.map(getAvailabilityStats)

  return [
    {
      label: 'Needs scorer',
      value: activeMatches.filter((match) => getRoleStatus(match, 'scorer') === 'Needed').length,
      caption: 'Fixtures waiting for a scorer reply or selection.',
    },
    {
      label: 'Needs referee',
      value: activeMatches.filter((match) => getRoleStatus(match, 'referee') === 'Needed').length,
      caption: 'Referee requests without an assigned volunteer.',
    },
    {
      label: 'Needs linesman',
      value: activeMatches.filter((match) => getRoleStatus(match, 'linesman') === 'Needed').length,
      caption: 'Linesman requests without an assigned volunteer.',
    },
    {
      label: 'Conflicts',
      value: availabilityStats.reduce((total, stats) => total + stats.conflictCount, 0),
      caption: 'Players with conflicting parent availability replies.',
    },
    {
      label: 'Awaiting replies',
      value: availabilityStats.reduce((total, stats) => total + stats.pending, 0),
      caption: 'Availability requests with no parent response yet.',
    },
  ]
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
  const [matchEventForms, setMatchEventForms] = useState({})
  const [scoreDrafts, setScoreDrafts] = useState({})
  const [isLoading, setIsLoading] = useState(true)
  const [isSaving, setIsSaving] = useState(false)
  const [activeMatchId, setActiveMatchId] = useState('')
  const [errorMessage, setErrorMessage] = useState('')
  const [expandedMatchId, setExpandedMatchId] = useState('')
  const [isFixtureFormOpen, setIsFixtureFormOpen] = useState(false)
  const [selectedPreviousMatch, setSelectedPreviousMatch] = useState(null)
  const [squadSelection, setSquadSelection] = useState(EMPTY_SQUAD_SELECTION)
  const [isPreviousGamesOpen, setIsPreviousGamesOpen] = useState(false)
  const [volunteerSelectionPrompt, setVolunteerSelectionPrompt] = useState(null)
  const [activeVolunteerSelectionKey, setActiveVolunteerSelectionKey] = useState('')
  const [volunteerSelectionStatus, setVolunteerSelectionStatus] = useState(null)

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
  const needsAttentionItems = useMemo(() => getNeedsAttentionItems(activeMatches), [activeMatches])
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
    setForm((currentForm) => {
      const nextForm = {
        ...currentForm,
        ...updates,
      }

      if (updates.requestScorer === false && currentForm.status === 'scorer_request') {
        nextForm.status = 'scheduled'
      } else if (updates.requestScorer === true && currentForm.status === 'scheduled') {
        nextForm.status = 'scorer_request'
      }

      return nextForm
    })
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
    const selectionMode = squadSelection.mode
    const availablePlayerIds = fixturePlayers.map((player) => player.id)

    if (selectedPlayerIds.length === 0) {
      setErrorMessage('Select at least one player before creating the fixture.')
      return
    }

    setIsSaving(true)
    setErrorMessage('')

    try {
      const createdMatch = await createMatchDay({ user, match: form })
      const reconcileCreatedMatch = (currentMatches) => reconcileCreatedMatchDayInList(currentMatches, {
        match: createdMatch,
      })

      setMatches(reconcileCreatedMatch)
      await logFixtureSquadSelectionEvents({
        availablePlayerIds,
        match: createdMatch,
        players: fixturePlayers,
        selectedPlayerIds,
        selectionMode,
        user,
      })
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
      let availabilityWarning = ''

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
          availabilityWarning = result.message || 'Fixture availability requests could not be sent.'
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
      try {
        await loadData()
        setMatches(reconcileCreatedMatch)
      } catch (loadError) {
        console.error(loadError)
        setMatches(reconcileCreatedMatch)
        setErrorMessage(loadError.message || 'Fixture was saved, but Match Day could not be refreshed. Refresh the page before creating another fixture.')
      }
      showToast({
        title: 'Fixture created',
        message: availabilityWarning
          ? `The fixture was saved, but availability requests could not be sent: ${availabilityWarning}`
          : canSendAvailabilityRequests
            ? `${result.queuedCount ?? result.sentCount ?? 0} availability request notification${(result.queuedCount ?? result.sentCount ?? 0) === 1 ? '' : 's'} scheduled. ${result.missingContactCount ?? 0} players need contact details.`
            : 'The fixture was saved. Availability sending is enabled only on production or approved live runtimes.',
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

      const savedMatch = await updateMatchDay({ user, matchId: match.id, updates })
      const reconcileSavedMatch = (currentMatches) => reconcileMatchDayUpdateInList(currentMatches, {
        match: savedMatch,
        matchId: match.id,
      })

      setMatches(reconcileSavedMatch)
      if (status === 'half_time' || status === 'second_half' || status === 'extra_time' || status === 'penalties' || status === 'full_time') {
        void sendMatchDayPushNotification({
          matchDayId: match.id,
          type: status,
        })
      }
      try {
        await loadData()
        setMatches(reconcileSavedMatch)
      } catch (loadError) {
        console.error(loadError)
        setMatches(reconcileSavedMatch)
        setErrorMessage(loadError.message || 'Match status was saved, but Match Day could not be refreshed. Refresh the page before making another status change.')
      }
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
      const savedMatch = await updateMatchDay({
        user,
        matchId: match.id,
        updates: {
          homeScore: draft.homeScore,
          awayScore: draft.awayScore,
        },
      })
      const reconcileSavedMatch = (currentMatches) => reconcileMatchDayUpdateInList(currentMatches, {
        match: savedMatch,
        matchId: match.id,
      })

      setMatches(reconcileSavedMatch)
      try {
        await loadData()
        setMatches(reconcileSavedMatch)
      } catch (loadError) {
        console.error(loadError)
        setMatches(reconcileSavedMatch)
        setErrorMessage(loadError.message || 'Score was saved, but Match Day could not be refreshed. Refresh the page before making another score change.')
      }
      showToast({ title: 'Score updated', message: 'The family portal score has been updated.' })
    } catch (error) {
      console.error(error)
      setErrorMessage(error.message || 'Score could not be updated.')
    } finally {
      setActiveMatchId('')
    }
  }

  const openVolunteerSelectionPrompt = (match, volunteer, role, selected = true) => {
    const roleLabel = volunteerRoleConfigs.find((candidate) => candidate.key === role)

    if (!roleLabel) {
      return
    }

    setVolunteerSelectionPrompt({
      ...getVolunteerConfirmationCopy({ match, roleLabel, selected, volunteer }),
      match,
      role,
      roleLabel: roleLabel.label,
      selected,
      volunteer,
    })
  }

  const handleVolunteerSelection = async () => {
    const prompt = volunteerSelectionPrompt

    if (!prompt) {
      return
    }

    const { match, volunteer, role, roleLabel, selected } = prompt
    const actionKey = getMatchDayVolunteerActionKey({ matchId: match.id, requestId: volunteer.requestId, role })

    setActiveMatchId(match.id)
    setActiveVolunteerSelectionKey(actionKey)
    setVolunteerSelectionStatus({
      key: actionKey,
      tone: 'loading',
      message: selected ? `Saving ${roleLabel.toLowerCase()} selection...` : `Saving ${roleLabel.toLowerCase()} deselection...`,
    })
    setErrorMessage('')

    try {
      const result = await selectMatchDayVolunteer({ user, match, volunteer, role, selected })
      let refreshWarning = ''
      const targetParentLinkId = result?.parentLinkId || volunteer.parentLinkId
      const savedAt = new Date().toISOString()
      const reconcileSavedSelection = (currentMatches) => reconcileMatchDayVolunteerSelectionInList(currentMatches, {
        matchId: match.id,
        now: savedAt,
        result,
        role,
        selected,
        user,
        volunteer,
      })

      setMatches(reconcileSavedSelection)

      setVolunteerSelectionStatus({
        key: actionKey,
        tone: 'success',
        message: selected ? `${roleLabel} selected.` : `${roleLabel} deselected.`,
      })

      if (selected && role === 'scorer' && targetParentLinkId) {
        void sendMatchDayPushNotification({
          matchDayId: match.id,
          type: 'scorer_selected',
          targetParentLinkIds: [targetParentLinkId],
        })
      }
      try {
        await loadData()
        setMatches(reconcileSavedSelection)
      } catch (refreshError) {
        console.error(refreshError)
        refreshWarning = 'Volunteer selection was saved, but Match Day could not be refreshed. Refresh the page before making another role change.'
        setErrorMessage(refreshWarning)
        setVolunteerSelectionStatus({
          key: actionKey,
          tone: 'warning',
          message: 'Saved. Refresh the page before making another role change.',
        })
      }
      showToast({
        title: selected ? `${roleLabel} selected` : `${roleLabel} deselected`,
        message: result?.warning
          || refreshWarning
          || (selected && role === 'scorer'
            ? 'This parent can now update the live score.'
            : 'The Match Day volunteer selection has been updated.'),
        tone: result?.warning || refreshWarning ? 'warning' : 'success',
      })
      setVolunteerSelectionPrompt(null)
    } catch (error) {
      console.error(error)
      const message = error.message || 'Volunteer selection could not be updated.'
      setVolunteerSelectionStatus({
        key: actionKey,
        tone: 'error',
        message,
      })
      throw error
    } finally {
      setActiveMatchId('')
      setActiveVolunteerSelectionKey('')
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

  const updateMatchEventForm = (matchId, updates) => {
    setMatchEventForms((currentForms) => ({
      ...currentForms,
      [matchId]: {
        ...EMPTY_MATCH_EVENT_FORM,
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

  const handleMatchEventPlayerPick = (matchId, playerId) => {
    const player = squadPlayers.find((candidate) => String(candidate.id) === String(playerId))

    if (!player) {
      return
    }

    updateMatchEventForm(matchId, {
      playerName: player.playerName,
      playerShirtNumber: player.shirtNumber || '',
    })
  }

  const handleAddGoal = async (event, match) => {
    event.preventDefault()
    const formGoal = goalForms[match.id] ?? EMPTY_GOAL_FORM
    const goal = {
      ...formGoal,
      minute: normalizeStaffGoalText(formGoal.minute) || (getCurrentMatchMinute(match, Date.now()) ?? ''),
    }
    const goalPreview = buildStaffGoalPreview(match, goal)

    if (!confirmMatchDayAction(`Add this ${goalPreview.goalSideLabel.toLowerCase()} goal and change the score from ${goalPreview.scoreBefore} to ${goalPreview.scoreAfter}?`)) {
      return
    }

    setActiveMatchId(match.id)
    setErrorMessage('')

    try {
      const savedEvent = await addStaffMatchDayGoal({ user, match, goal })
      const reconcileSavedGoal = (currentMatches) => reconcileMatchDayGoalInList(currentMatches, {
        event: savedEvent,
        matchId: match.id,
        user,
      })

      setMatches(reconcileSavedGoal)
      void sendMatchDayPushNotification({
        matchDayId: match.id,
        type: 'goal',
        eventId: savedEvent.id,
      })
      setGoalForms((currentForms) => ({
        ...currentForms,
        [match.id]: EMPTY_GOAL_FORM,
      }))
      try {
        await loadData()
        setMatches(reconcileSavedGoal)
      } catch (loadError) {
        console.error(loadError)
        setMatches(reconcileSavedGoal)
        setErrorMessage(loadError.message || 'Goal was added, but the latest Match Day data could not be refreshed.')
      }
      showToast({ title: 'Goal added', message: 'The live feed has been updated.' })
    } catch (error) {
      console.error(error)
      setErrorMessage(error.message || 'Goal could not be added.')
    } finally {
      setActiveMatchId('')
    }
  }

  const handleAddMatchEvent = async (event, match) => {
    event.preventDefault()
    const formEvent = matchEventForms[match.id] ?? EMPTY_MATCH_EVENT_FORM
    const eventTypeOption = MATCH_EVENT_TYPE_OPTIONS.find((option) => option.value === formEvent.eventType) || MATCH_EVENT_TYPE_OPTIONS[0]
    const matchEvent = {
      ...formEvent,
      minute: normalizeStaffGoalText(formEvent.minute) || (getCurrentMatchMinute(match, Date.now()) ?? ''),
    }

    if (!confirmMatchDayAction(`Add this ${eventTypeOption.confirmLabel} to the match timeline?`)) {
      return
    }

    setActiveMatchId(match.id)
    setErrorMessage('')

    try {
      const savedEvent = await addStaffMatchDayEvent({ user, match, event: matchEvent })
      const reconcileSavedEvent = (currentMatches) => reconcileMatchDayEventInList(currentMatches, {
        event: savedEvent,
        matchId: match.id,
        user,
      })

      setMatches(reconcileSavedEvent)
      setMatchEventForms((currentForms) => ({
        ...currentForms,
        [match.id]: EMPTY_MATCH_EVENT_FORM,
      }))
      try {
        await loadData()
        setMatches(reconcileSavedEvent)
      } catch (loadError) {
        console.error(loadError)
        setMatches(reconcileSavedEvent)
        setErrorMessage(loadError.message || 'Match event was added, but the latest Match Day data could not be refreshed.')
      }
      showToast({ title: 'Match event added', message: `${eventTypeOption.label} has been added to the timeline.` })
    } catch (error) {
      console.error(error)
      setErrorMessage(error.message || 'Match event could not be added.')
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
      <section className="matchday-control-panel overflow-hidden rounded-lg border shadow-sm">
        <div className="grid gap-5 px-5 py-5 sm:px-6 lg:grid-cols-[minmax(0,1fr)_auto] lg:items-center">
          <div>
            <p className="matchday-control-eyebrow text-xs font-black uppercase tracking-[0.18em]">Match day control</p>
            <h1 className="mt-2 text-2xl font-black tracking-tight sm:text-3xl">Match Day</h1>
            <p className="matchday-control-copy mt-2 max-w-3xl text-sm font-semibold leading-6">
              Scan fixtures, open one when needed, and keep scorer, score, availability, roles, and notes attached to the same record.
            </p>
          </div>
          <div className="grid gap-3 sm:grid-cols-[minmax(0,1fr)_auto] lg:min-w-[26rem] lg:grid-cols-1">
            <div className="matchday-control-next rounded-lg border px-4 py-3">
              <p className="matchday-control-eyebrow text-xs font-black uppercase tracking-[0.16em]">Next fixture</p>
              <p className="mt-1 text-lg font-black tracking-tight">
                {nextMatch ? getMatchDayDisplayName(nextMatch) : 'No fixture created'}
              </p>
              <p className="matchday-control-copy mt-1 text-sm font-semibold leading-6">
                {nextMatch ? formatMatchDate(nextMatch) : 'Create a fixture to request volunteers and prepare the live board.'}
              </p>
            </div>
            <button
              type="button"
              onClick={() => setIsFixtureFormOpen(true)}
              className="inline-flex min-h-11 items-center justify-center rounded-lg bg-[#86efac] px-5 py-3 text-sm font-black text-[#101828] transition hover:bg-[#bbf7d0]"
            >
              Create fixture
            </button>
          </div>
        </div>
        <div className="matchday-control-metrics grid gap-2 border-t px-5 py-4 sm:grid-cols-2 lg:grid-cols-4 lg:px-6">
          <MatchMetric label="Live" value={liveMatches} isLoading={isLoading} tone="control" />
          <MatchMetric label="Requests" value={scorerRequests} isLoading={isLoading} tone="control" />
          <MatchMetric label="Upcoming" value={upcomingMatches} isLoading={isLoading} tone="control" />
          <MatchMetric label="Goals" value={goalCount} isLoading={isLoading} tone="control" />
        </div>
      </section>

      {errorMessage ? <NoticeBanner title="Match Day action failed" message={errorMessage} /> : null}

      <section className="grid gap-3 md:grid-cols-4">
        {matchDaySummary.map((item) => (
          <article key={item.label} className="rounded-lg border border-[#d7e5dc] bg-white p-4 shadow-sm shadow-[#047857]/10">
            <p className="text-xs font-black uppercase tracking-[0.16em] text-[#047857]">{item.label}</p>
            <p className="mt-2 text-3xl font-black tracking-tight text-[#101828]">{isLoading ? '...' : item.value}</p>
            <p className="mt-2 text-sm font-semibold leading-6 text-[#4b5f55]">{item.caption}</p>
          </article>
        ))}
      </section>

      <section className="overflow-hidden rounded-lg border border-[#d7e5dc] bg-white shadow-sm shadow-[#047857]/10">
        <div className="border-b border-[#d7e5dc] bg-[#f7faf8] px-5 py-4 sm:px-6">
          <p className={eyebrowClass}>Needs attention</p>
        </div>
        <div className="grid gap-2 px-5 py-4 sm:grid-cols-2 lg:grid-cols-5 lg:px-6">
          {needsAttentionItems.map((item) => (
            <article key={item.label} className="rounded-lg border border-[#d7e5dc] bg-[#f7faf8] px-3 py-3">
              <p className="text-[11px] font-black uppercase tracking-[0.14em] text-[#047857]">{item.label}</p>
              <p className="mt-2 text-2xl font-black text-[#101828]">{isLoading ? '...' : item.value}</p>
              <p className="mt-1 text-xs font-semibold leading-5 text-[#4b5f55]">{item.caption}</p>
            </article>
          ))}
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
        <div className="grid gap-3 border-b border-[#d7e5dc] bg-[#f7faf8] px-5 py-4 sm:px-6 lg:grid-cols-[minmax(0,1fr)_auto] lg:items-center">
          <div>
            <p className={eyebrowClass}>Fixture list</p>
            <h2 className="mt-1 text-xl font-black tracking-tight text-[#101828]">Active fixtures</h2>
            <p className={`mt-1 max-w-3xl ${bodyTextClass}`}>
              Keep the list compact. Open one fixture to manage score, roles, availability detail, and notes.
            </p>
          </div>
          <button
            type="button"
            onClick={() => setIsFixtureFormOpen(true)}
            className={`${secondaryButtonClass} w-full sm:w-auto`}
          >
            Create fixture
          </button>
        </div>
        <div className="px-5 py-5 sm:px-6">
        {isLoading ? (
          <p className="rounded-lg border border-[#d7e5dc] bg-[#f7faf8] px-4 py-5 text-sm font-bold text-[#4b5f55] shadow-sm shadow-[#047857]/10">
            Loading match day...
          </p>
        ) : activeMatches.length > 0 ? (
          <div className="space-y-3">
            {activeMatches.map((match) => (
              <MatchDayCard
                key={match.id}
                activeMatchId={activeMatchId}
                goalForm={goalForms[match.id] ?? EMPTY_GOAL_FORM}
                isExpanded={expandedMatchId === match.id}
                match={match}
                matchEventForm={matchEventForms[match.id] ?? EMPTY_MATCH_EVENT_FORM}
                onAddGoal={handleAddGoal}
                onAddMatchEvent={handleAddMatchEvent}
                onGoalFormChange={updateGoalForm}
                onMatchEventFormChange={updateMatchEventForm}
                onMatchEventPlayerPick={handleMatchEventPlayerPick}
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
                activeVolunteerSelectionKey={activeVolunteerSelectionKey}
                onVolunteerSelection={openVolunteerSelectionPrompt}
                onStatusChange={handleStatusChange}
                onToggle={() => setExpandedMatchId((currentId) => (currentId === match.id ? '' : match.id))}
                players={squadPlayers}
                scoreDraft={scoreDrafts[match.id] ?? { homeScore: match.homeScore, awayScore: match.awayScore }}
                volunteerSelectionStatus={volunteerSelectionStatus}
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
        <div className="grid gap-4 bg-[#f7faf8] px-5 py-4 sm:px-6 lg:grid-cols-[minmax(0,1fr)_auto] lg:items-center">
          <div>
            <p className={eyebrowClass}>Results archive</p>
            <h2 className="mt-1 text-xl font-black tracking-tight text-[#101828]">Previous games</h2>
            <p className="mt-1 text-sm font-semibold leading-6 text-[#4b5f55]">
              {previousMatches.length} archived result{previousMatches.length === 1 ? '' : 's'}.
            </p>
          </div>
          <div className="flex flex-col gap-2 sm:flex-row sm:justify-end">
            <button
              type="button"
              onClick={() => setIsPreviousGamesOpen((isOpen) => !isOpen)}
              className={`${secondaryButtonClass} w-full sm:w-auto`}
              aria-expanded={isPreviousGamesOpen}
            >
              {isPreviousGamesOpen ? 'Hide archive' : 'Show archive'}
            </button>
          </div>
        </div>
        {isPreviousGamesOpen ? (
          <div className="border-t border-[#d7e5dc] px-5 py-5 sm:px-6">
            <div className="mb-4 flex flex-col gap-3 rounded-lg border border-[#fed7aa] bg-[#fff7ed] px-4 py-3 sm:flex-row sm:items-center sm:justify-between">
              <p className="text-sm font-bold leading-6 text-[#92400e]">
                Reset only when starting a new season. Full time results will be hidden from the parent results list.
              </p>
              <button
                type="button"
                onClick={handleResetPrevious}
                disabled={isSaving || previousMatches.length === 0}
                className="inline-flex min-h-10 items-center justify-center rounded-lg border border-[#fdba74] bg-white px-4 py-2 text-sm font-black text-[#9a3412] transition hover:bg-[#ffedd5] disabled:cursor-not-allowed disabled:opacity-60"
              >
                Reset previous games
              </button>
            </div>
          {previousMatches.length > 0 ? (
            <div className="grid gap-2 md:grid-cols-2">
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
        ) : null}
      </section>

      <PreviousGameDetailModal match={selectedPreviousMatch} onClose={() => setSelectedPreviousMatch(null)} />
      <ConfirmModal
        confirmLabel={volunteerSelectionPrompt?.confirmLabel || 'Confirm selection'}
        isBusy={Boolean(activeVolunteerSelectionKey)}
        isOpen={Boolean(volunteerSelectionPrompt)}
        message={volunteerSelectionPrompt?.message || ''}
        title={volunteerSelectionPrompt?.title || 'Confirm volunteer selection'}
        onCancel={() => setVolunteerSelectionPrompt(null)}
        onConfirm={handleVolunteerSelection}
      />
    </div>
  )
}
function MatchDayCard({
  activeMatchId,
  activeVolunteerSelectionKey,
  goalForm,
  isExpanded,
  match,
  matchEventForm,
  onAddGoal,
  onAddMatchEvent,
  onGoalFormChange,
  onMatchEventFormChange,
  onMatchEventPlayerPick,
  onPlayerPick,
  onScoreDraftChange,
  onScoreSave,
  onVolunteerSelection,
  onStatusChange,
  onToggle,
  players,
  scoreDraft,
  volunteerSelectionStatus,
}) {
  const isBusy = activeMatchId === match.id
  const requestedVolunteerRoles = getRequestedVolunteerRoles(match)
  const currentAvailabilityRows = getCurrentAvailabilityRows(match)
  const currentMinute = getCurrentMatchMinute(match)
  const availabilityStats = getAvailabilityStats(match)
  const transportRiskRows = getTransportRiskRows(match)
  const transportRiskSummary = getTransportRiskSummary(transportRiskRows)
  const transportCoordination = getTransportCoordinationSummary(currentAvailabilityRows)
  const events = Array.isArray(match.events) ? match.events : []
  const eventLog = Array.isArray(match.eventLog) ? match.eventLog : []
  const displayParts = getMatchDayDisplayParts(match)
  const scoreSummary = getMatchDayDisplayScore(match)
  const goalPreview = buildStaffGoalPreview(match, goalForm)

  return (
    <article className="overflow-hidden rounded-lg border border-[#d7e5dc] bg-white shadow-sm shadow-[#047857]/10">
      <div className="grid gap-4 px-4 py-4 sm:px-5 lg:grid-cols-[minmax(0,1fr)_auto] lg:items-center">
        <div className="min-w-0">
          <div className="flex flex-wrap gap-2">
            <span className="inline-flex w-fit rounded-lg border border-[#bbf7d0] bg-[#ecfdf5] px-3 py-1 text-xs font-black text-[#047857]">
              {getMatchStatusLabel(match.status)}
            </span>
            <span className="inline-flex w-fit rounded-lg border border-[#d7e5dc] bg-[#f7faf8] px-3 py-1 text-xs font-black text-[#4b5f55]">
              {getHomeAwayLabel(match.homeAway)}
            </span>
            {match.teamName ? (
              <span className="inline-flex w-fit rounded-lg border border-[#d7e5dc] bg-[#f7faf8] px-3 py-1 text-xs font-black text-[#4b5f55]">
                {match.teamName}
              </span>
            ) : null}
          </div>
          <h4 className="mt-2 text-lg font-black leading-tight text-[#101828]">{getMatchDayDisplayName(match)}</h4>
          <p className="mt-1 text-sm font-semibold text-[#4b5f55]">
            {formatMatchDate(match)}
            {match.venueName ? ` at ${match.venueName}` : ''}
          </p>
        </div>

        <div className="grid gap-3 sm:grid-cols-[auto_auto] sm:items-center">
          <div className="rounded-lg border border-[#d7e5dc] bg-[#ecfdf5] px-4 py-3 text-center">
            <p className="text-[11px] font-black uppercase tracking-[0.14em] text-[#4b5f55]">Score</p>
            <p className="mt-1 text-3xl font-black text-[#101828]">{scoreSummary}</p>
            {currentMinute ? <p className="mt-1 text-xs font-black text-[#4b5f55]">{currentMinute} min</p> : null}
          </div>
          <button
            type="button"
            onClick={onToggle}
            className={`${primaryButtonClass} w-full sm:w-auto`}
            aria-expanded={isExpanded}
          >
            {isExpanded ? 'Close' : 'Manage'}
          </button>
        </div>
      </div>

      <div className="grid gap-2 border-t border-[#d7e5dc] bg-[#f7faf8] px-4 py-3 sm:grid-cols-2 sm:px-5 lg:grid-cols-5">
        <CompactFact label="Availability" value={getAvailabilitySummary(match)} />
        <CompactFact label="Scorer" value={getRoleStatus(match, 'scorer')} />
        <CompactFact label="Referee" value={getRoleStatus(match, 'referee')} />
        <CompactFact label="Linesman" value={getRoleStatus(match, 'linesman')} />
        <CompactFact label="Status" value={getMatchStatusLabel(match.status)} />
      </div>

      {isExpanded ? (
        <div className="space-y-4 border-t border-[#d7e5dc] bg-white px-4 py-4 sm:px-5">
          <MatchDayReadinessPanel match={match} />

          <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
            <section className={panelClass}>
              <h5 className="text-sm font-black text-[#101828]">Overview</h5>
              <dl className="mt-3 grid gap-3 sm:grid-cols-2">
                <DetailItem label="Team" value={match.teamName || 'Our team'} />
                <DetailItem label="Opponent" value={match.opponent || 'Opponent'} />
                <DetailItem label="Date and time" value={formatMatchDate(match)} />
                <DetailItem label="Venue" value={match.venueName || getHomeAwayLabel(match.homeAway)} />
                <DetailItem label="Arrival" value={match.arrivalTime || 'Not set'} />
                <DetailItem label="Status" value={getMatchStatusLabel(match.status)} />
              </dl>
            </section>

            <section className={panelClass}>
              <h5 className="text-sm font-black text-[#101828]">Notes</h5>
              {match.notes ? (
                <p className="mt-3 whitespace-pre-wrap text-sm font-semibold leading-6 text-[#4b5f55]">{match.notes}</p>
              ) : (
                <p className="mt-3 text-sm font-semibold leading-6 text-[#4b5f55]">No staff notes saved for this fixture.</p>
              )}
              {match.scorerRequestMessage ? (
                <p className="mt-3 rounded-lg border border-[#d7e5dc] bg-white px-3 py-2 text-sm font-semibold leading-6 text-[#4b5f55]">
                  {match.scorerRequestMessage}
                </p>
              ) : null}
            </section>

            <MatchDayEventLogPanel entries={eventLog} />
          </div>

          <section className={panelClass}>
            <h5 className="text-sm font-black text-[#101828]">Availability</h5>
            <div className="mt-3 grid gap-2 sm:grid-cols-5">
              <AvailabilityCount label="Available" value={availabilityStats.available} />
              <AvailabilityCount label="No response" value={availabilityStats.pending} />
              <AvailabilityCount label="Maybe" value={availabilityStats.maybe} />
              <AvailabilityCount label="Unavailable" value={availabilityStats.unavailable} />
              <AvailabilityCount label="Conflicts" value={availabilityStats.conflictCount} />
            </div>
            {currentAvailabilityRows.length > 0 ? (
              <div className="mt-3 grid gap-2 lg:grid-cols-2">
                {currentAvailabilityRows.map((row) => {
                  const historyRows = getAvailabilityHistoryForPlayer(match, row)

                  return (
                    <div key={row.id || row.playerId || row.playerName} className="rounded-lg border border-[#d7e5dc] bg-white p-3 shadow-sm shadow-[#047857]/10">
                      <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
                        <div className="min-w-0">
                          <p className="text-sm font-black text-[#101828]">{row.playerName || 'Player'}</p>
                          <p className="mt-1 text-xs font-semibold text-[#4b5f55]">
                            {row.selectedByEmail || row.selectedByName || 'No parent response yet'}
                          </p>
                        </div>
                        <span className="inline-flex w-fit rounded-lg border border-[#d7e5dc] bg-[#f7faf8] px-3 py-1 text-xs font-black text-[#101828]">
                          {getAvailabilityStatusLabel(row.status)}
                        </span>
                      </div>
                      <p className="mt-2 text-xs font-semibold text-[#4b5f55]">
                        {formatResponseDateTime(row.selectedAt)}
                      </p>
                      {hasTransportResponse(row) ? (
                        <div className="mt-3 rounded-lg border border-[#d7e5dc] bg-[#f7faf8] p-3">
                          <p className="text-xs font-black uppercase tracking-[0.14em] text-[#4b5f55]">Transport response</p>
                          <div className="mt-2 flex flex-wrap gap-2">
                            <span className="inline-flex w-fit rounded-lg border border-[#d7e5dc] bg-white px-3 py-1 text-xs font-black text-[#101828]">
                              {row.transportNeedsLift ? 'Needs lift' : 'No lift needed'}
                            </span>
                            <span className="inline-flex w-fit rounded-lg border border-[#d7e5dc] bg-white px-3 py-1 text-xs font-black text-[#101828]">
                              {row.transportCanOfferLift ? 'Can offer lift' : 'No lift offered'}
                            </span>
                            {row.transportCanOfferLift ? (
                              <span className="inline-flex w-fit rounded-lg border border-[#d7e5dc] bg-white px-3 py-1 text-xs font-black text-[#101828]">
                                {Number(row.transportSeatsOffered || 0)} seats
                              </span>
                            ) : null}
                          </div>
                          <p className="mt-2 text-xs font-semibold text-[#4b5f55]">
                            Staff coordinate transport manually. {formatResponseDateTime(row.transportRespondedAt)}
                          </p>
                        </div>
                      ) : null}
                      {historyRows.length > 0 ? (
                        <div className="mt-3 space-y-1 border-t border-[#d7e5dc] pt-3">
                          {historyRows.map((history) => (
                            <p key={history.id} className="text-xs font-semibold text-[#4b5f55]">
                              {getAvailabilityStatusLabel(history.previousStatus)} to {getAvailabilityStatusLabel(history.status)} by {history.selectedByEmail || history.selectedByName || 'Parent'} at {formatResponseDateTime(history.createdAt)}
                            </p>
                          ))}
                        </div>
                      ) : null}
                    </div>
                  )
                })}
              </div>
            ) : (
              <div className="mt-3 rounded-lg border border-[#d7e5dc] bg-white px-4 py-5">
                <p className="text-sm font-black text-[#101828]">No availability requests are linked to this fixture yet.</p>
                <p className="mt-2 text-sm font-semibold leading-6 text-[#4b5f55]">
                  Request selected players to collect availability and parent volunteer replies.
                </p>
              </div>
            )}
          </section>

          <TransportRiskPanel rows={transportRiskRows} summary={transportRiskSummary} />

          <TransportCoordinationPanel summary={transportCoordination} />

          <section className={panelClass}>
            <h5 className="text-sm font-black text-[#101828]">Roles</h5>
            <div className="mt-3 grid gap-2 sm:grid-cols-3">
              <CompactFact label="Scorer" value={getRoleStatus(match, 'scorer')} />
              <CompactFact label="Referee" value={getRoleStatus(match, 'referee')} />
              <CompactFact label="Linesman" value={getRoleStatus(match, 'linesman')} />
            </div>
            {requestedVolunteerRoles.length > 0 ? (
              <div className="mt-3 space-y-3">
                {requestedVolunteerRoles.map((role) => {
                  const roleRows = getRoleResponseRows(match, role)
                  const selectedAssignment = getSelectedRoleAssignment(match, role.key)

                  return (
                    <div key={role.key} className="rounded-lg border border-[#d7e5dc] bg-white p-3 shadow-sm shadow-[#047857]/10">
                      <div className="flex flex-col gap-1 sm:flex-row sm:items-start sm:justify-between">
                        <p className="text-sm font-black text-[#101828]">{role.label}</p>
                        {selectedAssignment ? (
                          <p className="text-xs font-black text-[#047857]">
                            Selected: {selectedAssignment.parentEmail || selectedAssignment.playerName || 'Parent'}
                          </p>
                        ) : null}
                      </div>
                      {roleRows.length > 0 ? (
                        <div className="mt-2 space-y-2">
                          {roleRows.map((row) => {
                            const selectionReason = getVolunteerSelectionReason(row)
                            const isSelected = isSelectedRoleVolunteer(selectedAssignment, row)
                            const canSelect = !selectionReason
                            const rowStatus = getVolunteerRowStatus({ isSelected, response: row.response, selectedAssignment })
                            const actionKey = getMatchDayVolunteerActionKey({ matchId: match.id, requestId: row.requestId, role: role.key })
                            const isVolunteerActionBusy = activeVolunteerSelectionKey === actionKey
                            const rowActionStatus = volunteerSelectionStatus?.key === actionKey ? volunteerSelectionStatus : null

                            return (
                              <div key={row.id} className="flex flex-col gap-2 rounded-lg border border-[#d7e5dc] bg-[#f7faf8] px-3 py-2 sm:flex-row sm:items-start sm:justify-between">
                                <div className="min-w-0">
                                  <p className="text-xs font-black text-[#101828]">{row.parentLabel}</p>
                                  <p className="mt-1 text-xs font-semibold text-[#4b5f55]">Linked to {row.playerName}</p>
                                  <p className="mt-1 text-xs font-semibold text-[#4b5f55]">{formatResponseDateTime(row.respondedAt)}</p>
                                </div>
                                <div className="flex flex-wrap items-center gap-2">
                                  <span className="inline-flex w-fit rounded-lg border border-[#d7e5dc] bg-white px-3 py-1 text-xs font-black text-[#101828]">
                                    Response: {getVolunteerResponseLabel(row.response)}
                                  </span>
                                  <span className={`inline-flex w-fit rounded-lg border px-3 py-1 text-xs font-black ${
                                    isSelected
                                      ? 'border-[#bbf7d0] bg-[#ecfdf5] text-[#047857]'
                                      : normalizeVolunteerText(row.response) === 'yes'
                                        ? 'border-[#d7e5dc] bg-white text-[#101828]'
                                        : 'border-[#fed7aa] bg-[#fff7ed] text-[#92400e]'
                                  }`}
                                  >
                                    {rowStatus}
                                  </span>
                                  {canSelect ? (
                                    <button
                                      type="button"
                                      onClick={() => onVolunteerSelection(match, row, role.key, !isSelected)}
                                      disabled={isBusy}
                                      className={secondaryButtonClass}
                                    >
                                      {isVolunteerActionBusy ? 'Saving...' : isSelected ? 'Deselect' : selectedAssignment ? 'Replace selected volunteer' : 'Select'}
                                    </button>
                                  ) : (
                                    <span className="max-w-56 text-xs font-semibold leading-5 text-[#92400e]">
                                      {selectionReason}
                                    </span>
                                  )}
                                  {rowActionStatus ? (
                                    <span
                                      role={rowActionStatus.tone === 'error' ? 'alert' : 'status'}
                                      className={`max-w-64 text-xs font-bold leading-5 ${
                                        rowActionStatus.tone === 'error'
                                          ? 'text-red-700'
                                          : rowActionStatus.tone === 'warning'
                                            ? 'text-[#92400e]'
                                            : 'text-[#047857]'
                                      }`}
                                    >
                                      {rowActionStatus.message}
                                    </span>
                                  ) : null}
                                </div>
                              </div>
                            )
                          })}
                        </div>
                      ) : (
                        <p className="mt-2 text-sm font-semibold leading-6 text-[#4b5f55]">No replies for this role yet.</p>
                      )}
                    </div>
                  )
                })}
              </div>
            ) : (
              <div className="mt-3 rounded-lg border border-[#d7e5dc] bg-white px-4 py-5">
                <p className="text-sm font-black text-[#101828]">No volunteer roles requested.</p>
                <p className="mt-2 text-sm font-semibold leading-6 text-[#4b5f55]">
                  Enable scorer, linesman, or referee requests when creating the fixture to collect volunteer replies.
                </p>
              </div>
            )}
          </section>

          <section className={panelClass}>
            <h5 className="text-sm font-black text-[#101828]">Score</h5>
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
              <span className={smallLabelClass}>Home ({displayParts.firstSide === 'home' ? displayParts.firstTeam : 'home team'})</span>
              <input
                type="number"
                min="0"
                value={scoreDraft.homeScore}
                onChange={(event) => onScoreDraftChange({ homeScore: event.target.value })}
                className={compactInputClass}
              />
            </label>
            <label className="block">
              <span className={smallLabelClass}>Away ({displayParts.secondSide === 'away' ? displayParts.secondTeam : 'away team'})</span>
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
          </section>

          <form className={panelClass} onSubmit={(event) => onAddGoal(event, match)}>
            <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
              <div>
                <h5 className="text-sm font-black text-[#101828]">Add goal</h5>
                <p className="mt-1 text-xs font-semibold leading-5 text-[#4b5f55]">
                  {goalPreview.goalSideLabel} goal for {goalPreview.goalSideName}
                </p>
              </div>
              <span className="inline-flex w-fit rounded-lg border border-[#d7e5dc] bg-white px-3 py-1 text-xs font-black text-[#101828]">
                Result if saved: {goalPreview.scoreAfter}
              </span>
            </div>

            <div className="mt-3 border-t border-[#d7e5dc] pt-3">
              <p className={smallLabelClass}>Goal side</p>
              <div className="grid gap-2 sm:grid-cols-2">
                {[
                  { label: 'Our team', value: 'club' },
                  { label: 'Opponent', value: 'opponent' },
                ].map((option) => {
                  const isSelected = goalPreview.teamSide === option.value

                  return (
                    <button
                      key={option.value}
                      type="button"
                      aria-pressed={isSelected}
                      onClick={() => onGoalFormChange(match.id, { teamSide: option.value })}
                      className={`min-h-10 rounded-lg border px-3 py-2 text-left text-sm font-black transition ${
                        isSelected
                          ? 'border-[#047857] bg-[#ecfdf5] text-[#047857]'
                          : 'border-[#d7e5dc] bg-white text-[#101828] hover:border-[#0f9f6e] hover:bg-[#f7faf8]'
                      }`}
                    >
                      {option.label}
                    </button>
                  )
                })}
              </div>
            </div>

            <div className="mt-3 grid gap-3 border-t border-[#d7e5dc] pt-3 md:grid-cols-3">
              <label className="block">
                <span className={smallLabelClass}>Scorer player</span>
                <select
                  value=""
                  onChange={(event) => onPlayerPick(match.id, 'scorer', event.target.value)}
                  className={compactInputClass}
                >
                  <option value="">Choose player</option>
                  {players.map((player) => (
                    <option key={player.id} value={player.id}>
                      {player.playerName}{player.shirtNumber ? ` #${player.shirtNumber}` : ''}
                    </option>
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
                    <option key={player.id} value={player.id}>
                      {player.playerName}{player.shirtNumber ? ` #${player.shirtNumber}` : ''}
                    </option>
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
              <label className="block">
                <span className={smallLabelClass}>Minute</span>
                <input
                  type="number"
                  min="0"
                  max="130"
                  value={goalForm.minute}
                  onChange={(event) => onGoalFormChange(match.id, { minute: event.target.value })}
                  placeholder="Auto"
                  className={compactInputClass}
                />
              </label>
              <label className="block md:col-span-2">
                <span className={smallLabelClass}>Note</span>
                <textarea
                  value={goalForm.notes}
                  onChange={(event) => onGoalFormChange(match.id, { notes: event.target.value })}
                  className={`${compactInputClass} min-h-20`}
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

            <div className="mt-3 grid gap-3 border-t border-[#d7e5dc] pt-3 lg:grid-cols-[0.9fr_1.1fr]">
              <div>
                <p className={smallLabelClass}>Score preview</p>
                <p className="text-2xl font-black text-[#101828]">{goalPreview.scoreBefore} to {goalPreview.scoreAfter}</p>
                <p className="mt-1 text-xs font-semibold leading-5 text-[#4b5f55]">
                  Home after save: {goalPreview.homeScore}. Away after save: {goalPreview.awayScore}.
                </p>
              </div>
              <dl className="grid gap-2 sm:grid-cols-2">
                {[
                  ['Scorer', goalPreview.scorerPreview],
                  ['Assist', goalPreview.assistPreview],
                  ['Minute', goalPreview.minutePreview],
                  ['Note', goalPreview.notePreview],
                ].map(([label, value]) => (
                  <div key={label} className="border-l-2 border-[#d7e5dc] pl-3">
                    <dt className="text-[11px] font-black uppercase tracking-[0.12em] text-[#047857]">{label}</dt>
                    <dd className="mt-1 text-xs font-semibold leading-5 text-[#4b5f55]">{value}</dd>
                  </div>
                ))}
              </dl>
            </div>
          </form>

          <form className={panelClass} onSubmit={(event) => onAddMatchEvent(event, match)}>
            <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
              <div>
                <h5 className="text-sm font-black text-[#101828]">Add match event</h5>
                <p className="mt-1 text-xs font-semibold leading-5 text-[#4b5f55]">
                  Cards, substitutions, and water breaks are timeline-only entries.
                </p>
              </div>
              <span className="inline-flex w-fit rounded-lg border border-[#d7e5dc] bg-white px-3 py-1 text-xs font-black text-[#101828]">
                Score unchanged
              </span>
            </div>

            <div className="mt-3 grid gap-3 border-t border-[#d7e5dc] pt-3 md:grid-cols-4">
              <label className="block">
                <span className={smallLabelClass}>Event type</span>
                <select
                  value={matchEventForm.eventType}
                  onChange={(event) => onMatchEventFormChange(match.id, { eventType: event.target.value })}
                  className={compactInputClass}
                >
                  {MATCH_EVENT_TYPE_OPTIONS.map((option) => (
                    <option key={option.value} value={option.value}>{option.label}</option>
                  ))}
                </select>
              </label>
              <label className="block">
                <span className={smallLabelClass}>Player</span>
                <select
                  value=""
                  onChange={(event) => onMatchEventPlayerPick(match.id, event.target.value)}
                  className={compactInputClass}
                >
                  <option value="">Choose player</option>
                  {players.map((player) => (
                    <option key={player.id} value={player.id}>
                      {player.playerName}{player.shirtNumber ? ` #${player.shirtNumber}` : ''}
                    </option>
                  ))}
                </select>
              </label>
              <label className="block">
                <span className={smallLabelClass}>Player name</span>
                <input
                  value={matchEventForm.playerName}
                  onChange={(event) => onMatchEventFormChange(match.id, { playerName: event.target.value })}
                  className={compactInputClass}
                />
              </label>
              <label className="block">
                <span className={smallLabelClass}>Player shirt</span>
                <input
                  value={matchEventForm.playerShirtNumber}
                  onChange={(event) => onMatchEventFormChange(match.id, { playerShirtNumber: event.target.value })}
                  className={compactInputClass}
                />
              </label>
              <label className="block">
                <span className={smallLabelClass}>Minute</span>
                <input
                  type="number"
                  min="0"
                  max="130"
                  value={matchEventForm.minute}
                  onChange={(event) => onMatchEventFormChange(match.id, { minute: event.target.value })}
                  placeholder="Auto"
                  className={compactInputClass}
                />
              </label>
              <label className="block md:col-span-2">
                <span className={smallLabelClass}>Note</span>
                <textarea
                  value={matchEventForm.notes}
                  onChange={(event) => onMatchEventFormChange(match.id, { notes: event.target.value })}
                  className={`${compactInputClass} min-h-20`}
                />
              </label>
              <button
                type="submit"
                disabled={isBusy}
                className="mt-auto inline-flex min-h-10 items-center justify-center rounded-lg bg-[#101828] px-4 py-2 text-sm font-black text-white transition hover:bg-[#24324a] disabled:cursor-not-allowed disabled:opacity-60"
              >
                Add event
              </button>
            </div>
          </form>

          <MatchTimelinePanel events={events} />
        </div>
      ) : null}
    </article>
  )
}

function MatchTimelinePanel({ events }) {
  const timelineEvents = Array.isArray(events) ? events : []
  const recentEvents = timelineEvents.slice(0, 8)

  return (
    <section className={panelClass}>
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h5 className="text-sm font-black text-[#101828]">Match Timeline</h5>
          <p className="mt-1 text-xs font-semibold text-[#4b5f55]">
            {timelineEvents.length} recorded match {timelineEvents.length === 1 ? 'event' : 'events'}
          </p>
        </div>
        <span className="inline-flex w-fit rounded-lg border border-[#d7e5dc] bg-white px-3 py-1 text-xs font-black text-[#101828]">
          Staff view
        </span>
      </div>

      {timelineEvents.length === 0 ? (
        <div className="mt-3 rounded-lg border border-[#d7e5dc] bg-white px-4 py-5">
          <p className="text-sm font-black text-[#101828]">No match timeline events yet.</p>
          <p className="mt-2 text-sm font-semibold leading-6 text-[#4b5f55]">
            Goals and score corrections will appear here when they are recorded.
          </p>
        </div>
      ) : (
        <div className="mt-3 space-y-2">
          {recentEvents.map((event) => {
            const detailItems = getMatchEventDetailItems(event)
            const badge = getMatchEventBadge(event)

            return (
              <div key={event.id} className="rounded-lg border border-[#d7e5dc] bg-white px-4 py-3 shadow-sm shadow-[#047857]/10">
                <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
                  <div className="min-w-0">
                    <p className="flex min-w-0 items-center gap-2 text-sm font-black text-[#101828]">
                      {badge ? (
                        <span
                          className={`inline-flex h-5 min-w-4 shrink-0 items-center justify-center rounded-sm border px-1 text-[10px] font-black leading-none ${badge.className}`}
                          title={badge.label}
                          aria-label={badge.label}
                        >
                          {badge.text}
                        </span>
                      ) : null}
                      <span className="min-w-0 truncate">{getMatchEventTypeLabel(event)}</span>
                    </p>
                    <p className="mt-1 text-xs font-semibold text-[#4b5f55]">Score after event: {getMatchEventScoreLabel(event)}</p>
                  </div>
                  <span className={`inline-flex w-fit rounded-lg border px-3 py-1 text-xs font-black ${getMatchEventToneClass(event)}`}>
                    {event.eventType === 'goal' && event.teamSide === 'opponent' ? 'Opponent' : event.eventType === 'goal' ? 'Our team' : getMatchEventTypeLabel(event)}
                  </span>
                </div>
                {detailItems.length > 0 ? (
                  <dl className="mt-3 grid gap-2 sm:grid-cols-2">
                    {detailItems.map((item) => (
                      <div key={`${event.id}-${item.label}`} className="rounded-lg border border-[#d7e5dc] bg-[#f7faf8] px-3 py-2">
                        <dt className="text-[11px] font-black uppercase tracking-[0.12em] text-[#047857]">{item.label}</dt>
                        <dd className="mt-1 text-xs font-semibold leading-5 text-[#4b5f55]">{item.value}</dd>
                      </div>
                    ))}
                  </dl>
                ) : null}
              </div>
            )
          })}
        </div>
      )}
    </section>
  )
}

function MatchDayReadinessPanel({ match }) {
  const readiness = getMatchDayReadinessSummary(match)

  return (
    <section className={panelClass}>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h5 className="text-sm font-black text-[#101828]">Match readiness</h5>
        <span className={`inline-flex w-fit rounded-lg border px-3 py-1 text-xs font-black ${
          readiness.tone === 'success'
            ? 'border-[#bbf7d0] bg-[#ecfdf5] text-[#047857]'
            : 'border-[#fed7aa] bg-[#fff7ed] text-[#92400e]'
        }`}
        >
          {readiness.status}
        </span>
      </div>
      <div className="mt-3 grid gap-2 md:grid-cols-2 xl:grid-cols-5">
        {readiness.items.map((item) => (
          <ReadinessItem key={item.label} item={item} />
        ))}
      </div>
    </section>
  )
}

function TransportRiskPanel({ rows, summary }) {
  return (
    <section className={panelClass}>
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h5 className="text-sm font-black text-[#101828]">Transport risk</h5>
          <p className="mt-1 text-xs font-semibold leading-5 text-[#4b5f55]">
            Derived from availability responses and structured transport replies. Staff coordinate manually.
          </p>
        </div>
        <span className={`inline-flex w-fit rounded-lg border px-3 py-1 text-xs font-black ${
          summary.needsFollowUp > 0
            ? 'border-[#fed7aa] bg-[#fff7ed] text-[#92400e]'
            : 'border-[#bbf7d0] bg-[#ecfdf5] text-[#047857]'
        }`}
        >
          {summary.needsFollowUp > 0 ? 'Needs staff follow-up' : 'No risk detected'}
        </span>
      </div>

      <div className="mt-3 grid gap-2 sm:grid-cols-7">
        <AvailabilityCount label="Follow-up" value={summary.needsFollowUp} />
        <AvailabilityCount label="No response" value={summary.noResponse} />
        <AvailabilityCount label="Maybe" value={summary.maybe} />
        <AvailabilityCount label="Unavailable" value={summary.unavailable} />
        <AvailabilityCount label="Conflicts" value={summary.conflicts} />
        <AvailabilityCount label="Needs lift" value={summary.needsLift} />
        <AvailabilityCount label="Lift offers" value={summary.liftOffers} />
      </div>
      <p className="mt-2 text-xs font-semibold text-[#4b5f55]">
        Seats offered: {summary.seatsOffered}
      </p>

      {rows.length > 0 ? (
        <div className="mt-3 grid gap-2 lg:grid-cols-2">
          {rows.map((row) => (
            <article key={row.id || row.playerKey || row.playerName} className="rounded-lg border border-[#fed7aa] bg-[#fff7ed] p-3">
              <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
                <div className="min-w-0">
                  <p className="text-sm font-black text-[#101828]">{row.playerName}</p>
                  <p className="mt-1 text-xs font-semibold leading-5 text-[#4b5f55]">
                    Staff transport follow-up signal.
                  </p>
                </div>
                <span className="inline-flex w-fit rounded-lg border border-[#fed7aa] bg-white px-3 py-1 text-xs font-black text-[#92400e]">
                  {getAvailabilityStatusLabel(row.status)}
                </span>
              </div>
              <div className="mt-3 flex flex-wrap gap-2">
                {row.reasons.map((reason) => (
                  <span key={reason.key} title={reason.detail} className="inline-flex w-fit rounded-lg border border-[#fed7aa] bg-white px-3 py-1 text-xs font-black text-[#92400e]">
                    {reason.label}
                  </span>
                ))}
              </div>
              {hasTransportResponse(row) ? (
                <p className="mt-3 text-xs font-semibold leading-5 text-[#4b5f55]">
                  Transport response recorded {formatResponseDateTime(row.transportRespondedAt)}.
                </p>
              ) : null}
            </article>
          ))}
        </div>
      ) : (
        <div className="mt-3 rounded-lg border border-[#d7e5dc] bg-white px-4 py-5">
          <p className="text-sm font-black text-[#101828]">No transport risk detected from availability responses.</p>
          <p className="mt-2 text-sm font-semibold leading-6 text-[#4b5f55]">
            Staff should still use normal safeguarding checks before match day.
          </p>
        </div>
      )}
    </section>
  )
}

function getTransportCapacityLabel(seatBalance) {
  if (seatBalance < 0) {
    return 'Potential shortfall'
  }

  if (seatBalance > 0) {
    return 'Potential surplus'
  }

  return 'Capacity balanced'
}

function TransportCoordinationPanel({ summary }) {
  const capacityLabel = getTransportCapacityLabel(summary.seatBalance)

  return (
    <section className={panelClass}>
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <div className="flex flex-wrap items-center gap-2">
            <h5 className="text-sm font-black text-[#101828]">Transport coordination</h5>
            <span className="inline-flex w-fit rounded-lg border border-[#d7e5dc] bg-[#f7faf8] px-3 py-1 text-xs font-black text-[#4b5f55]">
              Staff-only
            </span>
          </div>
          <p className="mt-1 text-xs font-semibold leading-5 text-[#4b5f55]">
            Manual coordination only. No matching has been created.
          </p>
        </div>
        <span className={`inline-flex w-fit rounded-lg border px-3 py-1 text-xs font-black ${
          summary.seatBalance < 0
            ? 'border-[#fed7aa] bg-[#fff7ed] text-[#92400e]'
            : 'border-[#bbf7d0] bg-[#ecfdf5] text-[#047857]'
        }`}
        >
          {capacityLabel}
        </span>
      </div>

      <div className="mt-3 grid gap-2 sm:grid-cols-3">
        <AvailabilityCount label="Lift needs" value={summary.liftNeeds} />
        <AvailabilityCount label="Seats offered" value={summary.seatsOffered} />
        <AvailabilityCount label="Balance" value={summary.seatBalance} />
      </div>

      <div className="mt-3 grid gap-3 lg:grid-cols-2">
        {summary.groups.map((group) => (
          <TransportCoordinationGroup key={group.label} group={group} />
        ))}
      </div>

      <div className="mt-3 rounded-lg border border-[#d7e5dc] bg-white p-3">
        <p className="text-xs font-black uppercase tracking-[0.14em] text-[#4b5f55]">Staff chase list</p>
        {summary.chaseList.length > 0 ? (
          <div className="mt-2 flex flex-wrap gap-2">
            {summary.chaseList.map((row) => (
              <span key={row.id || row.playerName} className="inline-flex w-fit rounded-lg border border-[#d7e5dc] bg-[#f7faf8] px-3 py-1 text-xs font-black text-[#101828]">
                {row.playerName}
              </span>
            ))}
          </div>
        ) : (
          <p className="mt-2 text-sm font-semibold leading-6 text-[#4b5f55]">
            No transport or availability chase items from current responses.
          </p>
        )}
      </div>
    </section>
  )
}

function TransportCoordinationGroup({ group }) {
  return (
    <article className="rounded-lg border border-[#d7e5dc] bg-white p-3 shadow-sm shadow-[#047857]/10">
      <div className="flex items-center justify-between gap-2">
        <p className="text-sm font-black text-[#101828]">{group.label}</p>
        <span className="inline-flex w-fit rounded-lg border border-[#d7e5dc] bg-[#f7faf8] px-3 py-1 text-xs font-black text-[#4b5f55]">
          {group.count}
        </span>
      </div>
      {group.rows.length > 0 ? (
        <div className="mt-2 space-y-2">
          {group.rows.map((row) => (
            <div key={row.id || row.playerName} className="rounded-lg border border-[#e8f1ec] bg-[#f7faf8] px-3 py-2">
              <div className="flex flex-col gap-1 sm:flex-row sm:items-center sm:justify-between">
                <p className="text-xs font-black text-[#101828]">{row.playerName}</p>
                <span className="text-xs font-black text-[#4b5f55]">{getAvailabilityStatusLabel(row.status)}</span>
              </div>
              {row.transportCanOfferLift ? (
                <p className="mt-1 text-xs font-semibold text-[#4b5f55]">
                  Seats offered: {row.transportSeatsOffered}
                </p>
              ) : null}
            </div>
          ))}
        </div>
      ) : (
        <p className="mt-2 text-sm font-semibold leading-6 text-[#4b5f55]">No players in this group.</p>
      )}
    </article>
  )
}

function ReadinessItem({ item }) {
  const toneClass = item.tone === 'success'
    ? 'border-[#bbf7d0] bg-white text-[#047857]'
    : item.tone === 'warning'
      ? 'border-[#fed7aa] bg-white text-[#92400e]'
      : 'border-[#d7e5dc] bg-white text-[#4b5f55]'

  return (
    <article className="rounded-lg border border-[#d7e5dc] bg-white px-3 py-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-[11px] font-black uppercase tracking-[0.12em] text-[#047857]">{item.label}</p>
        <span className={`inline-flex w-fit rounded-lg border px-2 py-1 text-[11px] font-black ${toneClass}`}>
          {item.status}
        </span>
      </div>
      <p className="mt-2 text-xs font-semibold leading-5 text-[#4b5f55]">{item.detail}</p>
    </article>
  )
}

function MatchDayEventLogPanel({ entries }) {
  const [selectedFilterKey, setSelectedFilterKey] = useState('all')
  const eventEntries = Array.isArray(entries) ? entries : []
  const filters = EVENT_LOG_FILTERS.map((filter) => ({
    ...filter,
    count: filter.key === 'all'
      ? eventEntries.length
      : eventEntries.filter((entry) => getEventLogFilterKey(entry) === filter.key).length,
  }))
  const activeFilter = filters.find((filter) => filter.key === selectedFilterKey) || filters[0]
  const filteredEntries = activeFilter.key === 'all'
    ? eventEntries
    : eventEntries.filter((entry) => getEventLogFilterKey(entry) === activeFilter.key)
  const recentEntries = filteredEntries.slice(0, 8)
  const emptyFilterLabel = activeFilter.label.toLowerCase()

  return (
    <section className={panelClass}>
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h5 className="text-sm font-black text-[#101828]">Event Log</h5>
          <p className="mt-1 text-xs font-semibold text-[#4b5f55]">
            {activeFilter.key === 'all'
              ? `${eventEntries.length} recent entries`
              : `${recentEntries.length} of ${eventEntries.length} recent entries`}
          </p>
        </div>
      </div>

      <div className="mt-3 flex flex-wrap gap-2" aria-label="Event log filters">
        {filters.map((filter) => {
          const isActive = filter.key === activeFilter.key

          return (
            <button
              key={filter.key}
              type="button"
              aria-pressed={isActive}
              onClick={() => setSelectedFilterKey(filter.key)}
              className={`inline-flex items-center gap-2 rounded-lg border px-3 py-1.5 text-xs font-black transition ${
                isActive
                  ? 'border-[#047857] bg-[#ecfdf5] text-[#047857]'
                  : 'border-[#d7e5dc] bg-white text-[#101828] hover:border-[#9ac7b4] hover:bg-[#f7faf8]'
              }`}
            >
              <span>{filter.label}</span>
              <span className="rounded-md bg-[#f7faf8] px-1.5 py-0.5 text-[11px] text-[#4b5f55]">{filter.count}</span>
            </button>
          )
        })}
      </div>

      {eventEntries.length === 0 ? (
        <div className="mt-3 rounded-lg border border-[#d7e5dc] bg-white px-4 py-5">
          <p className="text-sm font-black text-[#101828]">No event log entries yet.</p>
          <p className="mt-2 text-sm font-semibold leading-6 text-[#4b5f55]">New Match Day changes will appear here.</p>
        </div>
      ) : recentEntries.length > 0 ? (
        <div className="mt-3 space-y-2">
          {recentEntries.map((entry) => {
            const detail = getEventLogDetail(entry)

            return (
              <div key={entry.id} className="rounded-lg border border-[#d7e5dc] bg-white px-4 py-3 shadow-sm shadow-[#047857]/10">
                <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
                  <div className="min-w-0">
                    <p className="text-sm font-black text-[#101828]">{entry.eventLabel || 'Match Day update'}</p>
                    <p className="mt-1 text-xs font-semibold text-[#4b5f55]">
                      {getEventLogActorLabel(entry)} at {formatEventLogTimestamp(entry.createdAt)}
                    </p>
                  </div>
                  <span className="inline-flex w-fit rounded-lg border border-[#d7e5dc] bg-[#f7faf8] px-3 py-1 text-xs font-black text-[#101828]">
                    {getEventLogTypeLabel(entry)}
                  </span>
                </div>
                {detail ? (
                  <p className="mt-2 text-xs font-semibold leading-5 text-[#4b5f55]">{detail}</p>
                ) : null}
              </div>
            )
          })}
        </div>
      ) : (
        <div className="mt-3 rounded-lg border border-[#d7e5dc] bg-white px-4 py-5">
          <p className="text-sm font-black text-[#101828]">No {emptyFilterLabel} entries yet.</p>
          <p className="mt-2 text-sm font-semibold leading-6 text-[#4b5f55]">Use All to see the full Match Day event log.</p>
        </div>
      )}
    </section>
  )
}

function CompactFact({ label, value }) {
  return (
    <div className="rounded-lg border border-[#d7e5dc] bg-white px-3 py-2">
      <p className="text-[11px] font-black uppercase tracking-[0.12em] text-[#047857]">{label}</p>
      <p className="mt-1 text-sm font-black leading-5 text-[#101828]">{value}</p>
    </div>
  )
}

function DetailItem({ label, value }) {
  return (
    <div>
      <dt className={smallLabelClass}>{label}</dt>
      <dd className="font-black leading-6 text-[#101828]">{value}</dd>
    </div>
  )
}

function AvailabilityCount({ label, value }) {
  return (
    <div className="rounded-lg border border-[#d7e5dc] bg-white px-3 py-2 text-center">
      <p className="text-xl font-black text-[#101828]">{value}</p>
      <p className="mt-1 text-[11px] font-black uppercase tracking-[0.12em] text-[#4b5f55]">{label}</p>
    </div>
  )
}

function MatchMetric({ isLoading, label, tone = 'light', value }) {
  if (tone === 'control') {
    return (
      <div className="matchday-control-metric rounded-lg border px-3 py-3 shadow-sm">
        <p className="matchday-control-metric-label text-[11px] font-black uppercase tracking-[0.14em]">{label}</p>
        <p className="matchday-control-metric-value mt-2 text-2xl font-black">{isLoading ? '...' : value}</p>
      </div>
    )
  }

  const isDark = tone === 'dark'

  return (
    <div className={`rounded-lg border px-3 py-3 shadow-sm ${isDark ? 'border-white/10 bg-white/10' : 'border-[#d7e5dc] bg-white'}`}>
      <p className={`text-[11px] font-black uppercase tracking-[0.14em] ${isDark ? 'text-[#86efac]' : 'text-[#047857]'}`}>{label}</p>
      <p className={`mt-2 text-2xl font-black ${isDark ? 'text-white' : 'text-[#101828]'}`}>{isLoading ? '...' : value}</p>
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

            <div className="rounded-lg border border-[#d7e5dc] bg-[#f7faf8] p-4">
              <p className="text-sm font-black text-[#101828]">Parent volunteer requests</p>
              <div className="mt-3 grid gap-3 md:grid-cols-3">
                <label className="flex min-h-12 items-center gap-3 rounded-lg border border-[#d7e5dc] bg-white px-3 py-3 text-sm font-black text-[#101828]">
                  <input
                    type="checkbox"
                    checked={form.requestScorer}
                    onChange={(event) => updateForm({ requestScorer: event.target.checked })}
                    className="h-5 w-5 accent-[#047857]"
                  />
                  Request scorer
                </label>
                <label className="flex min-h-12 items-center gap-3 rounded-lg border border-[#d7e5dc] bg-white px-3 py-3 text-sm font-black text-[#101828]">
                  <input
                    type="checkbox"
                    checked={form.requestLinesman}
                    onChange={(event) => updateForm({ requestLinesman: event.target.checked })}
                    className="h-5 w-5 accent-[#047857]"
                  />
                  Request linesman
                </label>
                <label className="flex min-h-12 items-center gap-3 rounded-lg border border-[#d7e5dc] bg-white px-3 py-3 text-sm font-black text-[#101828]">
                  <input
                    type="checkbox"
                    checked={form.requestReferee}
                    onChange={(event) => updateForm({ requestReferee: event.target.checked })}
                    className="h-5 w-5 accent-[#047857]"
                  />
                  Request referee
                </label>
              </div>
            </div>

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
