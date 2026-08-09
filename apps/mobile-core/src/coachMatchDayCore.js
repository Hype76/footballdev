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
    .filter((match) => !match.deletedAt && !match.previousHiddenAt)
    .filter((match) => {
      if (filter === 'all') return true
      if (filter === 'previous') return match.status === 'full_time' || Boolean(match.concludedAt) || (match.matchDate && match.matchDate < today)
      if (filter === 'upcoming') return !CLOSED_STATUSES.has(match.status) && match.status !== 'full_time' && !match.concludedAt && match.matchDate >= today && !LIVE_STATUSES.has(match.status)
      return LIVE_STATUSES.has(match.status) || (match.matchDate === today && !CLOSED_STATUSES.has(match.status) && match.status !== 'full_time')
    })
    .sort((left, right) => {
      const priority = Number(left.presentationPriority ?? 99) - Number(right.presentationPriority ?? 99)
      if (filter === 'current' && priority) return priority
      const direction = filter === 'previous' ? -1 : 1
      return direction * (timestamp(left.scheduledKickoffAt || `${left.matchDate}T${left.kickoffTime || '23:59'}`) - timestamp(right.scheduledKickoffAt || `${right.matchDate}T${right.kickoffTime || '23:59'}`))
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

export function getCoachMatchDayActions({ context, match, stale = false } = {}) {
  const roleRank = Number(context?.roleRank || 0)
  const blockedReason = stale
    ? 'Reconnect and refresh before changing Match Day.'
    : context?.paymentAccess?.canMutate !== true
      ? 'Match Day changes are blocked while payment is required.'
      : ['admin', 'parent_portal', 'adult_player', 'super_admin'].includes(context?.role) || roleRank < 20
        ? 'Coach or manager access is required.'
        : CLOSED_STATUSES.has(match?.status) || Boolean(match?.concludedAt)
          ? 'This fixture is closed.'
          : ''
  const timerActions = blockedReason ? [] : getParentScorerTimerActions(match)
  const hasStarted = !['scheduled', 'scorer_request'].includes(match?.status) || normalize(match?.timerStatus) !== 'not_started'
  return Object.freeze({
    blockedReason,
    canMutate: !blockedReason,
    canRecordEvents: !blockedReason && hasStarted,
    canSaveFinalReport: !stale && roleRank >= 20 && context?.paymentAccess?.canMutate === true && isFinalMatchReportAvailable(match),
    canSetSquad: !stale && roleRank >= 20 && context?.paymentAccess?.canMutate === true && ['scheduled', 'scorer_request'].includes(match?.status),
    canSelectVolunteers: !stale && roleRank >= 20 && context?.paymentAccess?.canMutate === true && ['scheduled', 'scorer_request'].includes(match?.status),
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

export function createCoachMatchDayEventForm(type = 'goal', match = {}) {
  const eventType = normalize(type) || 'goal'
  return Object.freeze({
    assistName: '',
    assistShirtNumber: '',
    eventType,
    isPenaltyGoal: false,
    minute: String(getMatchTimerMinute(match) ?? ''),
    notes: '',
    playerName: '',
    playerOnName: '',
    playerOnShirtNumber: '',
    playerShirtNumber: '',
    scorerName: '',
    scorerShirtNumber: '',
    teamSide: 'club',
  })
}

export function validateCoachMatchDayEventForm(form = {}) {
  const eventType = normalize(form.eventType)
  if (eventType !== 'goal' && !STAFF_EVENT_TYPES.has(eventType)) throw new Error('Choose a supported Match Day event type.')
  const minute = normalize(form.minute)
  if (minute) {
    const number = Number(minute)
    if (!Number.isInteger(number) || number < 0 || number > 130) throw new Error('Choose a valid match minute before saving this event.')
  }
  if (eventType === 'substitution' && (!normalize(form.playerName) || !normalize(form.playerOnName))) {
    throw new Error('Choose the Player going off and the Player coming on.')
  }
  return { ...form, eventType, minute: minute ? Number(minute) : null, teamSide: form.teamSide === 'opponent' ? 'opponent' : 'club' }
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
