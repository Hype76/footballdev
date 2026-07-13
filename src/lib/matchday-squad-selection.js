export const MATCH_DAY_SQUAD_DECISIONS = Object.freeze({
  undecided: 'undecided',
  waiting: 'waiting',
  selected: 'selected',
  notSelected: 'not_selected',
})

export const MATCH_DAY_SQUAD_DECISION_OPTIONS = Object.freeze([
  { value: MATCH_DAY_SQUAD_DECISIONS.selected, label: 'Selected' },
  { value: MATCH_DAY_SQUAD_DECISIONS.waiting, label: 'Waiting' },
  { value: MATCH_DAY_SQUAD_DECISIONS.notSelected, label: 'Not selected' },
  { value: MATCH_DAY_SQUAD_DECISIONS.undecided, label: 'Undecided' },
])

const EDITABLE_MATCH_STATUSES = new Set(['scheduled', 'scorer_request'])
const SQUAD_DECISION_VALUES = new Set(MATCH_DAY_SQUAD_DECISION_OPTIONS.map((option) => option.value))

function normalizeText(value) {
  return String(value ?? '').trim().toLowerCase()
}

export function normalizeMatchDaySquadDecision(value) {
  const normalized = normalizeText(value)
  return SQUAD_DECISION_VALUES.has(normalized) ? normalized : MATCH_DAY_SQUAD_DECISIONS.undecided
}

export function getMatchDaySquadDecisionLabel(value, { parent = false } = {}) {
  switch (normalizeMatchDaySquadDecision(value)) {
    case MATCH_DAY_SQUAD_DECISIONS.selected:
      return 'Selected'
    case MATCH_DAY_SQUAD_DECISIONS.waiting:
      return parent ? 'Waiting for squad decision' : 'Waiting'
    case MATCH_DAY_SQUAD_DECISIONS.notSelected:
      return 'Not selected'
    default:
      return parent ? 'Squad not yet decided' : 'Undecided'
  }
}

export function getMatchDayAvailabilityLabel(value) {
  const labels = {
    available: 'Available',
    unavailable: 'Unavailable',
    maybe: 'Maybe',
    pending: 'Awaiting response',
    awaiting_response: 'Awaiting response',
    no_response: 'Awaiting response',
  }

  return labels[normalizeText(value)] || 'Awaiting response'
}

export function getSquadDecisionChangeBlockReason({
  availabilityStatus,
  decision,
  matchStatus,
} = {}) {
  if (!EDITABLE_MATCH_STATUSES.has(normalizeText(matchStatus))) {
    return 'Squad decisions are locked once the fixture is live, postponed, cancelled, Full Time, or concluded.'
  }

  if (
    normalizeMatchDaySquadDecision(decision) === MATCH_DAY_SQUAD_DECISIONS.selected
    && normalizeText(availabilityStatus) !== 'available'
  ) {
    return 'Only a player with an Available response can be selected.'
  }

  return ''
}

export function summarizeMatchDaySquadDecisions(decisions = []) {
  const summary = {
    undecided: 0,
    waiting: 0,
    selected: 0,
    notSelected: 0,
    total: 0,
  }

  decisions.forEach((decision) => {
    const state = normalizeMatchDaySquadDecision(decision?.status ?? decision)
    summary.total += 1

    if (state === MATCH_DAY_SQUAD_DECISIONS.notSelected) {
      summary.notSelected += 1
    } else {
      summary[state] += 1
    }
  })

  return summary
}
