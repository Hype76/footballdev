const FINAL_RESPONSE_CATEGORIES = new Set(['available', 'maybe', 'unavailable'])

export const EVENT_RESPONSE_FILTERS = Object.freeze({
  all: 'all',
  available: 'available',
  maybe: 'maybe',
  unavailable: 'unavailable',
  awaitingResponse: 'awaiting_response',
  invitationNotSent: 'invitation_not_sent',
  deliveryIssue: 'delivery_issue',
  notRequested: 'not_requested',
})

const CATEGORY_ORDER = [
  EVENT_RESPONSE_FILTERS.available,
  EVENT_RESPONSE_FILTERS.maybe,
  EVENT_RESPONSE_FILTERS.awaitingResponse,
  EVENT_RESPONSE_FILTERS.unavailable,
  EVENT_RESPONSE_FILTERS.invitationNotSent,
  EVENT_RESPONSE_FILTERS.deliveryIssue,
  EVENT_RESPONSE_FILTERS.notRequested,
]

function normalizeText(value) {
  return String(value ?? '').trim()
}

function normalizeStatus(value) {
  return normalizeText(value).toLowerCase()
}

function isTrainingEvent(eventType) {
  return normalizeStatus(eventType) === 'training'
}

function isMatchEvent(eventType) {
  return normalizeStatus(eventType) === 'match'
}

export function getEventResponseCategory(row = {}) {
  const invitationState = normalizeStatus(row.invitationState)
  const responseState = normalizeStatus(row.responseState)
  const deliveryState = normalizeStatus(row.deliveryState)

  if (invitationState === 'not_sent' || responseState === 'not_invited') {
    return EVENT_RESPONSE_FILTERS.invitationNotSent
  }

  if (deliveryState === 'failed' || deliveryState === 'partial_failure') {
    return EVENT_RESPONSE_FILTERS.deliveryIssue
  }

  if (FINAL_RESPONSE_CATEGORIES.has(responseState)) {
    return responseState
  }

  if (responseState === 'not_requested') {
    return EVENT_RESPONSE_FILTERS.notRequested
  }

  return EVENT_RESPONSE_FILTERS.awaitingResponse
}

export function getEventResponseCategoryLabel(category, eventType) {
  const training = isTrainingEvent(eventType)

  return {
    [EVENT_RESPONSE_FILTERS.available]: training ? 'Attending' : 'Available',
    [EVENT_RESPONSE_FILTERS.maybe]: 'Maybe',
    [EVENT_RESPONSE_FILTERS.unavailable]: training ? 'Not attending' : 'Unavailable',
    [EVENT_RESPONSE_FILTERS.awaitingResponse]: 'Awaiting response',
    [EVENT_RESPONSE_FILTERS.invitationNotSent]: 'Invitation not sent',
    [EVENT_RESPONSE_FILTERS.deliveryIssue]: 'Delivery issue',
    [EVENT_RESPONSE_FILTERS.notRequested]: 'Response not requested',
  }[category] || 'Awaiting response'
}

function getDeliveryLabel(row = {}) {
  if (normalizeStatus(row.invitationState) === 'not_sent') {
    return 'Not sent'
  }

  return {
    delivered: 'Delivered',
    failed: 'Delivery issue',
    not_requested: 'Not requested',
    partial_failure: 'Delivery issue',
    queued: 'Queued',
    requested: 'Requested',
  }[normalizeStatus(row.deliveryState)] || 'Not recorded'
}

function getResponseSourceLabel(value) {
  return {
    adult_player: 'Adult player',
    parent: 'Parent',
    staff_on_behalf: 'Staff on behalf',
    token: 'Secure response link',
  }[normalizeStatus(value)] || 'Not recorded'
}

function getPlayerName(row = {}) {
  return normalizeText(row?.player?.playerName ?? row.playerName) || 'Player'
}

export function getPlayerInitials(playerName) {
  const words = normalizeText(playerName).split(/\s+/).filter(Boolean)

  if (words.length === 0) {
    return 'P'
  }

  return words.slice(0, 2).map((word) => word.charAt(0).toUpperCase()).join('')
}

function normalizeManagerRow(row, eventType) {
  const playerName = getPlayerName(row)
  const category = getEventResponseCategory(row)
  const match = isMatchEvent(eventType)
  const selected = match && normalizeStatus(row.matchSelectionState) === 'selected'
  const invitationAction = row?.staffActions?.invitationAction || ''

  return {
    id: normalizeText(row.id) || `${normalizeText(row.playerId)}:${category}`,
    playerId: normalizeText(row.playerId),
    playerName,
    initials: getPlayerInitials(playerName),
    category,
    responseLabel: getEventResponseCategoryLabel(category, eventType),
    selectionLabel: match ? (selected ? 'Selected' : 'Not selected') : '',
    deliveryLabel: getDeliveryLabel(row),
    responseSourceLabel: getResponseSourceLabel(row.responseSource),
    respondedAt: row.respondedAt || '',
    warningLabel: category === EVENT_RESPONSE_FILTERS.deliveryIssue
      ? normalizeText(row.deliveryError) || 'Delivery needs attention'
      : '',
    canAcceptOnBehalf: row?.staffActions?.canAcceptOnBehalf === true,
    canMarkUnavailable: row?.staffActions?.canMarkUnavailable === true,
    canSelectForSquad: row?.staffActions?.canSelectForSquad === true,
    invitationAction,
    invitationActionLabel: {
      retry: 'Retry invitation',
      resend: 'Resend invitation',
      send: 'Send invitation',
    }[invitationAction] || '',
    sourceRow: row,
  }
}

function createEmptyCategoryCounts() {
  return {
    [EVENT_RESPONSE_FILTERS.available]: 0,
    [EVENT_RESPONSE_FILTERS.maybe]: 0,
    [EVENT_RESPONSE_FILTERS.unavailable]: 0,
    [EVENT_RESPONSE_FILTERS.awaitingResponse]: 0,
    [EVENT_RESPONSE_FILTERS.invitationNotSent]: 0,
    [EVENT_RESPONSE_FILTERS.deliveryIssue]: 0,
    [EVENT_RESPONSE_FILTERS.notRequested]: 0,
  }
}

function getFilterCategories(eventType, categoryCounts) {
  if (isMatchEvent(eventType) || isTrainingEvent(eventType)) {
    return CATEGORY_ORDER.filter((category) => category !== EVENT_RESPONSE_FILTERS.notRequested)
  }

  return CATEGORY_ORDER.filter((category) => categoryCounts[category] > 0)
}

export function buildEventResponseManagerModel({
  eventType = 'general',
  participants = [],
} = {}) {
  const normalizedEventType = normalizeStatus(eventType) || 'general'
  const rows = (Array.isArray(participants) ? participants : [])
    .map((row) => normalizeManagerRow(row, normalizedEventType))
    .sort((left, right) => left.playerName.localeCompare(
      right.playerName,
      undefined,
      { sensitivity: 'base' },
    ))
  const categoryCounts = rows.reduce((counts, row) => {
    counts[row.category] += 1
    return counts
  }, createEmptyCategoryCounts())
  const total = rows.length
  const exclusiveTotal = Object.values(categoryCounts).reduce((sum, count) => sum + count, 0)
  const selected = isMatchEvent(normalizedEventType)
    ? rows.filter((row) => row.selectionLabel === 'Selected').length
    : 0
  const filterCategories = getFilterCategories(normalizedEventType, categoryCounts)
  const filters = [
    {
      count: total,
      key: EVENT_RESPONSE_FILTERS.all,
      label: 'All',
    },
    ...filterCategories.map((category) => ({
      count: categoryCounts[category],
      key: category,
      label: getEventResponseCategoryLabel(category, normalizedEventType),
    })),
  ]
  const groups = CATEGORY_ORDER
    .map((category) => ({
      count: categoryCounts[category],
      key: category,
      label: getEventResponseCategoryLabel(category, normalizedEventType),
      rows: rows.filter((row) => row.category === category),
    }))
    .filter((group) => group.count > 0)
  const summary = groups.map((group) => ({
    count: group.count,
    key: group.key,
    label: group.label,
  }))

  return {
    categoryCounts,
    counts: {
      total,
      exclusiveTotal,
      selected,
      notSelected: isMatchEvent(normalizedEventType) ? total - selected : 0,
    },
    eventType: normalizedEventType,
    filters,
    groups,
    invariant: {
      reconciles: exclusiveTotal === total,
    },
    rows,
    summary,
  }
}

export function getEventResponseManagerView({
  activeFilter = EVENT_RESPONSE_FILTERS.all,
  model,
  searchTerm = '',
} = {}) {
  const safeModel = model || buildEventResponseManagerModel()
  const normalizedFilter = safeModel.filters.some((filter) => filter.key === activeFilter)
    ? activeFilter
    : EVENT_RESPONSE_FILTERS.all
  const normalizedSearch = normalizeText(searchTerm).toLocaleLowerCase()
  const filteredRows = safeModel.rows.filter((row) => (
    (normalizedFilter === EVENT_RESPONSE_FILTERS.all || row.category === normalizedFilter)
    && (
      !normalizedSearch
      || row.playerName.toLocaleLowerCase().includes(normalizedSearch)
    )
  ))
  const visibleIds = new Set(filteredRows.map((row) => row.id))
  const groups = safeModel.groups
    .filter((group) => (
      normalizedFilter === EVENT_RESPONSE_FILTERS.all
      || group.key === normalizedFilter
    ))
    .map((group) => ({
      ...group,
      rows: group.rows.filter((row) => visibleIds.has(row.id)),
    }))
    .filter((group) => group.rows.length > 0)

  return {
    activeFilter: normalizedFilter,
    groups,
    hasSearch: Boolean(normalizedSearch),
    visibleCount: filteredRows.length,
  }
}
