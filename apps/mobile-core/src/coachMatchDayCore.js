import { buildFinalMatchReportSummary, isFinalMatchReportAvailable } from '../../../src/lib/matchday-final-report.js'
import { getMatchDayDisplayName, getMatchDayDisplayParts, getMatchDayDisplayScore } from '../../../src/lib/matchday-display.js'
import { getMatchDayPhaseLabel } from '../../../src/lib/matchday-extended-ops.js'
import { getMatchDayLifecycleState, getParentScorerTimerActions } from '../../../src/lib/matchday-lifecycle.js'
import {
  getMatchDayAvailabilityLabel,
  getMatchDaySquadDecisionLabel,
  normalizeMatchDaySquadDecision,
  summarizeMatchDaySquadDecisions,
} from '../../../src/lib/matchday-squad-selection.js'
import { formatMatchTimerClock, getMatchTimerMinute } from '../../../src/lib/matchday-timer.js'
import { getMatchDayUndoReasonOptions, isMatchDayEventUndoSupported, validateMatchDayEventUndoInput } from '../../../src/lib/matchday-event-undo.js'

const CLOSED_STATUSES = new Set(['cancelled', 'postponed'])
const LIVE_STATUSES = new Set(['live', 'half_time', 'second_half', 'extra_time', 'penalties'])
const STAFF_EVENT_TYPES = new Set(['yellow_card', 'red_card', 'substitution'])

function normalize(value) {
  return String(value ?? '').trim()
}

function timestamp(value) {
  const result = new Date(value || 0).getTime()
  return Number.isFinite(result) ? result : 0
}

function sameText(left, right) {
  return normalize(left).toLowerCase() === normalize(right).toLowerCase()
}

export function hasCoachMatchDayCommandResult(match, commandId) {
  const expected = normalize(commandId)
  return Boolean(expected && (match?.events || []).some((event) => normalize(event.requestId) === expected))
}

export function isCoachMatchDayTimerActionApplied(match, action) {
  const value = normalize(action)
  const phase = normalize(match?.currentMatchPhase)
  const status = normalize(match?.status)
  const timerStatus = normalize(match?.timerStatus)
  if (value === 'start') return timerStatus === 'running' && !['scheduled', 'scorer_request'].includes(status)
  if (value === 'pause') return timerStatus === 'paused'
  if (value === 'half_time') return timerStatus === 'half_time' || status === 'half_time' || phase === 'half_time'
  if (value === 'hydration') return timerStatus === 'hydration'
  if (value === 'resume') return timerStatus === 'running' && !['scheduled', 'scorer_request'].includes(status)
  if (value === 'full_time') return status === 'full_time' || timerStatus === 'full_time' || phase === 'full_time'
  if (value === 'conclude') return Boolean(normalize(match?.concludedAt))
  if (value === 'normal_time_complete') return phase === 'normal_time_complete'
  if (value === 'start_extra_time') return phase === 'extra_time_first_half'
  if (value === 'extra_time_half_time') return phase === 'extra_time_half_time'
  if (value === 'start_extra_time_second_half') return phase === 'extra_time_second_half'
  if (value === 'complete_extra_time') return phase === 'extra_time_complete'
  if (value === 'start_penalties') return phase === 'penalties' || status === 'penalties'
  return false
}

export function isCoachMatchDayGoalCorrectionApplied(match, eventId, goal = {}, reason = '') {
  const event = (match?.events || []).find((item) => normalize(item.id) === normalize(eventId))
  if (!event || event.eventStatus === 'voided') return false
  return sameText(event.teamSide, goal.teamSide)
    && sameText(event.scorerName, goal.scorerName)
    && sameText(event.scorerShirtNumber, goal.scorerShirtNumber)
    && sameText(event.assistName, goal.assistName)
    && Number(event.minute ?? -1) === Number(goal.minute ?? -1)
    && sameText(event.correctionReason, reason)
}

export function isCoachMatchDayEventVoided(match, eventId) {
  return (match?.events || []).some((event) => normalize(event.id) === normalize(eventId) && event.eventStatus === 'voided')
}

export function isCoachMatchDayShootoutKickApplied(match, priorKickIds = [], kick = {}) {
  const prior = new Set((priorKickIds || []).map(normalize))
  return (match?.shootoutEvents || []).some((event) => (
    !prior.has(normalize(event.id))
    && event.eventStatus !== 'voided'
    && sameText(event.teamSide, kick.teamSide)
    && sameText(event.outcome, kick.outcome)
    && sameText(event.playerName, kick.playerName)
  ))
}

export function isCoachMatchDayShootoutKickVoided(match, kickId) {
  return (match?.shootoutEvents || []).some((event) => normalize(event.id) === normalize(kickId) && event.eventStatus === 'voided')
}

export function isCoachMatchDayFinalReportApplied(match, staffNotes) {
  return Boolean(match?.finalReport) && normalize(match.finalReport.staffNotes) === normalize(staffNotes)
}

export function isCoachMatchDaySquadDecisionApplied(match, playerId, decision) {
  return (match?.squadDecisions || []).some((item) => normalize(item.playerId) === normalize(playerId) && normalizeMatchDaySquadDecision(item.status) === normalizeMatchDaySquadDecision(decision))
}

export function isCoachMatchDayVolunteerSelectionApplied(match, request, role, selected = true) {
  const assignment = (match?.roleAssignments || []).find((item) => normalize(item.role) === normalize(role))
  if (selected === false) return !assignment || normalize(assignment.parentLinkId) !== normalize(request?.parentLinkId)
  return Boolean(assignment && normalize(assignment.parentLinkId) === normalize(request?.parentLinkId))
}

export const COACH_MATCH_DAY_BACKEND_DELTAS = Object.freeze([
  Object.freeze({ category: 'A', capability: 'Fixture, squad, availability, clock, event, shootout, result, and final-report authority', decision: 'Reuse current Match Day tables, RLS, and RPCs without a mobile-only business model.' }),
  Object.freeze({ category: 'B', capability: 'Mobile scorer and volunteer coordination', decision: 'Reuse the production-authoritative selection function through the approved test API adapter.' }),
  Object.freeze({ category: 'C', capability: 'Fixture-linked lineup, captain, goalkeeper, and Formation Board', decision: 'The current Match Day model has no canonical linkage. Do not invent one. Selected squad and substitutions remain authoritative in mobile.' }),
  Object.freeze({ category: 'D', capability: 'Fixture creation and editing, fixture archive, previous-game deletion, Formation Board editing/publication, and report export', decision: 'Web-only governance and desktop composition paths remain authoritative.' }),
  Object.freeze({ category: 'E', capability: 'Automatic Parent email, push, SMS, scorer request, availability resend, and MOTM delivery in test mobile', decision: 'Unnecessary for test-only parity. No external communication or schedule is created.' }),
])

export function filterCoachMatchDays(matches, filter = 'current', now = new Date()) {
  const today = now.toLocaleDateString('en-CA', { timeZone: 'Europe/London' })
  return (Array.isArray(matches) ? matches : [])
    .filter((match) => match && typeof match === 'object')
    .filter((match) => !(match.deletedAt ?? match.deleted_at) && !(match.previousHiddenAt ?? match.previous_hidden_at))
    .filter((match) => {
      const concludedAt = match.concludedAt ?? match.concluded_at
      const matchDate = match.matchDate ?? match.match_date ?? ''
      const status = normalize(match.status) || 'scheduled'
      if (filter === 'all') return true
      if (filter === 'previous') return status === 'full_time' || Boolean(concludedAt) || (matchDate && matchDate < today)
      if (filter === 'upcoming') return !CLOSED_STATUSES.has(status) && status !== 'full_time' && !concludedAt && matchDate >= today && !LIVE_STATUSES.has(status)
      return LIVE_STATUSES.has(status) || (matchDate === today && !CLOSED_STATUSES.has(status) && status !== 'full_time')
    })
    .sort((left, right) => {
      const priority = Number(left.presentationPriority ?? left.presentation_priority ?? 99) - Number(right.presentationPriority ?? right.presentation_priority ?? 99)
      if (filter === 'current' && priority) return priority
      const direction = filter === 'previous' ? -1 : 1
      const leftDate = left.matchDate ?? left.match_date ?? ''
      const leftTime = left.kickoffTime ?? left.kickoff_time ?? '23:59'
      const rightDate = right.matchDate ?? right.match_date ?? ''
      const rightTime = right.kickoffTime ?? right.kickoff_time ?? '23:59'
      return direction * (timestamp(left.scheduledKickoffAt ?? left.scheduled_kickoff_at ?? `${leftDate}T${leftTime}`) - timestamp(right.scheduledKickoffAt ?? right.scheduled_kickoff_at ?? `${rightDate}T${rightTime}`))
    })
}

export function getCoachMatchDayPresentation(match, now = Date.now()) {
  const parts = getMatchDayDisplayParts(match)
  return Object.freeze({
    clock: formatMatchTimerClock(match, now),
    displayName: getMatchDayDisplayName(match),
    displayScore: getMatchDayDisplayScore(match),
    lifecycle: getMatchDayLifecycleState(match),
    matchMinute: getMatchTimerMinute(match, now),
    phaseLabel: getMatchDayPhaseLabel(match) || 'Pre-match',
    parts,
  })
}

export function captureCoachMatchDayAction(match, action, now = Date.now()) {
  const capturedAt = Number.isFinite(now) ? now : Date.now()
  const presentation = getCoachMatchDayPresentation(match, capturedAt)
  return Object.freeze({
    action: normalize(action),
    capturedAt: new Date(capturedAt).toISOString(),
    capturedClock: presentation.clock,
    capturedMinute: presentation.matchMinute,
  })
}

export function getCoachMatchDayActions({ context, match, reconciling = false, stale = false } = {}) {
  const roleRank = Number(context?.roleRank || 0)
  const blockedReason = !match || typeof match !== 'object'
    ? 'Select a fixture before using Match Day actions.'
    : reconciling
    ? 'Reconciling the last Match Day action with the server.'
    : stale
    ? 'Reconnect and refresh before changing Match Day.'
    : context?.paymentAccess?.canMutate !== true
      ? 'Match Day changes are blocked while payment is required.'
      : ['admin', 'parent_portal', 'adult_player', 'super_admin'].includes(context?.role) || roleRank < 20
        ? 'Coach or manager access is required.'
        : CLOSED_STATUSES.has(match?.status) || Boolean(match?.concludedAt)
          ? 'This fixture is closed.'
          : ''
  const lifecycleTimerActions = blockedReason ? [] : getParentScorerTimerActions(match)
  const startBlockedByFixtureDate = match?.hasPresentationState === true
    && match?.isToday !== true
    && lifecycleTimerActions.some((item) => item.action === 'start')
  const timerActions = startBlockedByFixtureDate
    ? lifecycleTimerActions.filter((item) => item.action !== 'start')
    : lifecycleTimerActions
  const hasStarted = !['scheduled', 'scorer_request'].includes(match?.status) || normalize(match?.timerStatus) !== 'not_started'
  return Object.freeze({
    blockedReason,
    canMutate: !blockedReason,
    canRecordEvents: !blockedReason && hasStarted,
    canSaveFinalReport: !reconciling && !stale && roleRank >= 20 && context?.paymentAccess?.canMutate === true && isFinalMatchReportAvailable(match),
    canSetSquad: !reconciling && !stale && roleRank >= 20 && context?.paymentAccess?.canMutate === true && ['scheduled', 'scorer_request'].includes(match?.status),
    canSelectVolunteers: !reconciling && !stale && roleRank >= 20 && context?.paymentAccess?.canMutate === true && ['scheduled', 'scorer_request'].includes(match?.status),
    startBlockedReason: startBlockedByFixtureDate ? 'This match can only be started on its fixture date.' : '',
    timerActions,
  })
}

export function buildCoachMatchDaySquad(players = [], match = {}) {
  const decisions = new Map((match.squadDecisions || []).map((decision) => [decision.playerId, decision]))
  const availability = new Map((match.playerAvailability || []).map((item) => [item.playerId, item]))
  const rows = (Array.isArray(players) ? players : []).map((player) => {
    const decision = decisions.get(player.id)
    const response = availability.get(player.id)
    const decisionValue = normalizeMatchDaySquadDecision(decision?.status)
    return Object.freeze({
      ...player,
      availability: response?.status || 'pending',
      availabilityLabel: getMatchDayAvailabilityLabel(response?.status),
      decision: decisionValue,
      decisionLabel: getMatchDaySquadDecisionLabel(decisionValue),
      decidedAt: decision?.decidedAt || '',
    })
  })
  return Object.freeze({ rows: Object.freeze(rows), summary: Object.freeze(summarizeMatchDaySquadDecisions(rows.map((row) => row.decision))) })
}

function normalizePlayerChoice(player = {}) {
  return Object.freeze({
    id: normalize(player.id),
    playerName: normalize(player.playerName ?? player.player_name),
    shirtNumber: normalize(player.shirtNumber ?? player.shirt_number),
  })
}

export function getCoachMatchDaySelectedPlayers(players = [], match = {}) {
  const selectedPlayerIds = new Set(
    (match?.squadDecisions || [])
      .filter((decision) => normalizeMatchDaySquadDecision(decision?.status) === 'selected')
      .map((decision) => normalize(decision?.playerId))
      .filter(Boolean),
  )
  const matchTeamId = normalize(match?.teamId)
  return Object.freeze(
    (Array.isArray(players) ? players : [])
      .filter((player) => selectedPlayerIds.has(normalize(player?.id)))
      .filter((player) => !matchTeamId || normalize(player?.teamId) === matchTeamId)
      .filter((player) => normalize(player?.status || 'active').toLowerCase() !== 'archived')
      .map(normalizePlayerChoice)
      .filter((player) => player.id && player.playerName)
      .sort((left, right) => left.playerName.localeCompare(right.playerName)),
  )
}

export function getCoachMatchDayOpponentPlayers(match = {}) {
  const choices = new Map()
  const add = (name, shirtNumber) => {
    const playerName = normalize(name)
    const normalizedShirt = normalize(shirtNumber)
    if (!playerName && !normalizedShirt) return
    const key = `${playerName.toLowerCase()}|${normalizedShirt.toLowerCase()}`
    if (!choices.has(key)) choices.set(key, normalizePlayerChoice({ id: `opponent:${key}`, playerName, shirtNumber: normalizedShirt }))
  }
  for (const event of match?.events || []) {
    if (normalize(event?.teamSide ?? event?.team_side) !== 'opponent') continue
    add(event?.scorerName ?? event?.scorer_name ?? event?.playerName ?? event?.player_name, event?.scorerShirtNumber ?? event?.scorer_shirt_number ?? event?.playerShirtNumber ?? event?.player_shirt_number)
    add(event?.assistName ?? event?.assist_name ?? event?.playerOnName ?? event?.player_on_name, event?.assistShirtNumber ?? event?.assist_shirt_number ?? event?.playerOnShirtNumber ?? event?.player_on_shirt_number)
  }
  return Object.freeze([...choices.values()].sort((left, right) => left.playerName.localeCompare(right.playerName)))
}

export function filterCoachMatchDayPlayerChoices(players = [], query = '') {
  const normalizedQuery = normalize(query).toLowerCase()
  const rows = Array.isArray(players) ? players : []
  return Object.freeze(rows
    .filter((player) => !normalizedQuery
      || normalize(player?.playerName).toLowerCase().includes(normalizedQuery)
      || normalize(player?.shirtNumber).toLowerCase().includes(normalizedQuery))
    .slice(0, 12))
}

export function pickCoachMatchDayLinkedPlayer(form = {}, fieldPrefix = 'player', player = {}) {
  return {
    ...form,
    [`${fieldPrefix}Name`]: normalize(player?.playerName ?? player?.player_name),
    [`${fieldPrefix}ShirtNumber`]: normalize(player?.shirtNumber ?? player?.shirt_number),
  }
}

export function updateCoachMatchDayLinkedPlayer(form = {}, fieldPrefix = 'player', field = 'name', value = '', players = []) {
  const valueKey = field === 'shirt' ? `${fieldPrefix}ShirtNumber` : `${fieldPrefix}Name`
  const normalizedValue = normalize(value).toLowerCase()
  const matches = normalizedValue
    ? (Array.isArray(players) ? players : []).filter((player) => (
        field === 'shirt'
          ? normalize(player?.shirtNumber).toLowerCase() === normalizedValue
          : normalize(player?.playerName).toLowerCase() === normalizedValue
      ))
    : []
  const next = { ...form, [valueKey]: value }
  return matches.length === 1 ? pickCoachMatchDayLinkedPlayer(next, fieldPrefix, matches[0]) : next
}

export function createCoachMatchDayEventForm(type = 'goal', match = {}, now = Date.now()) {
  const eventType = normalize(type) || 'goal'
  const capture = captureCoachMatchDayAction(match, eventType, now)
  return Object.freeze({
    assistName: '',
    assistShirtNumber: '',
    eventType,
    isPenaltyGoal: false,
    capturedAt: capture.capturedAt,
    capturedClock: capture.capturedClock,
    minute: String(capture.capturedMinute ?? ''),
    notes: '',
    participantType: 'player',
    playerName: '',
    playerOnName: '',
    playerOnParticipantType: 'player',
    playerOnShirtNumber: '',
    playerShirtNumber: '',
    scorerName: '',
    scorerParticipantType: 'player',
    scorerShirtNumber: '',
    teamSide: 'club',
  })
}

export function formatCoachMatchDayParticipantName(participantType, value) {
  const name = normalize(value)
  if (participantType === 'coach') return name ? `Coach: ${name}` : ''
  if (participantType === 'other') return name ? `Other: ${name}` : ''
  return name
}

export function validateCoachMatchDayEventForm(form = {}) {
  const eventType = normalize(form.eventType)
  if (eventType !== 'goal' && !STAFF_EVENT_TYPES.has(eventType)) throw new Error('Choose a supported Match Day event type.')
  const minute = normalize(form.minute)
  if (minute) {
    const number = Number(minute)
    if (!Number.isInteger(number) || number < 0 || number > 130) throw new Error('Choose a valid match minute before saving this event.')
  }
  const teamSide = form.teamSide === 'opponent' ? 'opponent' : 'club'
  const scorerParticipantType = ['coach', 'other'].includes(form.scorerParticipantType) ? form.scorerParticipantType : 'player'
  const participantType = ['coach', 'other'].includes(form.participantType) ? form.participantType : 'player'
  const playerOnParticipantType = form.playerOnParticipantType === 'other' ? 'other' : 'player'
  if (eventType === 'goal' && teamSide === 'club' && scorerParticipantType !== 'player' && !normalize(form.scorerName)) {
    throw new Error(`Enter the ${scorerParticipantType === 'coach' ? 'Coach' : 'Other participant'} name.`)
  }
  if (eventType !== 'goal' && eventType !== 'water_break' && teamSide === 'club' && participantType !== 'player' && !normalize(form.playerName)) {
    throw new Error(`Enter the ${participantType === 'coach' ? 'Coach' : 'Other participant'} name.`)
  }
  if (eventType === 'substitution' && teamSide === 'club' && (!normalize(form.playerName) || !normalize(form.playerOnName))) {
    throw new Error('Choose the Player going off and the Player coming on.')
  }
  return {
    ...form,
    eventType,
    minute: minute ? Number(minute) : null,
    participantType,
    playerName: teamSide === 'club' ? formatCoachMatchDayParticipantName(participantType, form.playerName) : normalize(form.playerName),
    playerOnName: teamSide === 'club' ? formatCoachMatchDayParticipantName(playerOnParticipantType, form.playerOnName) : normalize(form.playerOnName),
    playerOnParticipantType,
    scorerName: teamSide === 'club' ? formatCoachMatchDayParticipantName(scorerParticipantType, form.scorerName) : normalize(form.scorerName),
    scorerParticipantType,
    teamSide,
  }
}

export function getCoachMatchDayUndoModel(event, { note = '', reasonCode = '' } = {}) {
  return Object.freeze({
    canUndo: isMatchDayEventUndoSupported(event),
    options: Object.freeze(getMatchDayUndoReasonOptions(event)),
    validate: () => validateMatchDayEventUndoInput({ eventType: event?.eventType, note, reasonCode }),
  })
}

export function buildCoachFinalMatchReport(match) {
  return buildFinalMatchReportSummary(match)
}
