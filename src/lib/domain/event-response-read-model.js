import { supabase } from '../supabase-client.js'
import { normalizeCalendarEventInvite } from './calendar-event-invites.js'
import { buildEventResponseManagerModel } from './event-response-manager.js'

const FINAL_RESPONSE_STATES = new Set(['available', 'maybe', 'unavailable'])
const DELIVERY_FAILURE_STATES = new Set(['failed', 'delivery_failed'])
const DELIVERY_NOT_SENT_STATES = new Set(['not_sent'])
const DELIVERY_SUCCESS_STATES = new Set(['delivered', 'responded', 'sent'])
const DELIVERY_QUEUE_STATES = new Set(['pending', 'processing', 'queued'])
const INACTIVE_MATCH_AVAILABILITY_REQUEST_STATES = new Set(['cancelled', 'expired'])
const RESPONSE_AUDIT_ACTIONS = [
  'adult_player_match_response_saved',
  'adult_player_training_response_saved',
  'event_player_availability_accepted_on_behalf',
  'event_player_availability_marked_unavailable_on_behalf',
]

function normalizeText(value) {
  return String(value ?? '').trim()
}

function normalizeStatus(value) {
  return normalizeText(value).toLowerCase()
}

function normalizeDateOnly(value) {
  const normalizedValue = normalizeText(value)

  if (/^\d{4}-\d{2}-\d{2}$/.test(normalizedValue)) {
    return normalizedValue
  }

  const parsedDate = new Date(normalizedValue)
  return Number.isNaN(parsedDate.getTime()) ? '' : parsedDate.toISOString().slice(0, 10)
}

export function isActiveMatchDayAvailabilityRequest(request = {}, referenceTime = new Date()) {
  const status = normalizeStatus(request.status) || 'pending'
  const sentAt = normalizeText(request.sentAt)
  const expiresAt = normalizeText(request.expiresAt)
  const tokenRevokedAt = normalizeText(request.tokenRevokedAt)
  const referenceTimestamp = new Date(referenceTime).getTime()
  const expiryTimestamp = new Date(expiresAt).getTime()

  return !INACTIVE_MATCH_AVAILABILITY_REQUEST_STATES.has(status)
    && Boolean(sentAt)
    && !tokenRevokedAt
    && Number.isFinite(referenceTimestamp)
    && Number.isFinite(expiryTimestamp)
    && expiryTimestamp >= referenceTimestamp
}

function getEventSource(event = {}) {
  const safeEvent = event && typeof event === 'object' ? event : {}
  const sourceType = normalizeStatus(safeEvent.sourceType)
  const sourceId = normalizeText(safeEvent.sourceId)
  const eventType = sourceType === 'match-day'
    ? 'match'
    : normalizeStatus(safeEvent?.data?.eventType ?? safeEvent?.data?.sessionType ?? safeEvent.eventType) || 'general'

  return {
    eventType: eventType === 'match' ? 'match' : eventType,
    sourceId,
    sourceType,
  }
}

function inviteMatchesEvent(invite, source) {
  if (!source.sourceId) {
    return false
  }

  if (source.sourceType === 'calendar') {
    return normalizeText(invite.calendarEventId) === source.sourceId
  }

  if (source.sourceType === 'session') {
    return normalizeText(invite.assessmentSessionId) === source.sourceId
  }

  if (source.sourceType === 'match-day') {
    return normalizeText(invite.matchDayId) === source.sourceId
  }

  return false
}

function getPlayerName(...values) {
  return values.map(normalizeText).find(Boolean) || 'Player'
}

function getLatestRow(rows = []) {
  return [...rows].sort((left, right) => {
    const leftDate = normalizeText(
      left.updatedAt
      ?? left.respondedAt
      ?? left.requestedAt
      ?? left.createdAt,
    )
    const rightDate = normalizeText(
      right.updatedAt
      ?? right.respondedAt
      ?? right.requestedAt
      ?? right.createdAt,
    )
    return rightDate.localeCompare(leftDate)
  })[0] || null
}

function getDeliveryStateFromRows(rows = [], fallback = '') {
  const states = rows.map((row) => normalizeStatus(row.status)).filter(Boolean)
  const hasFailure = states.some((status) => DELIVERY_FAILURE_STATES.has(status))
  const hasSuccess = states.some((status) => DELIVERY_SUCCESS_STATES.has(status))

  if (hasFailure && hasSuccess) {
    return 'partial_failure'
  }

  if (hasFailure) {
    return 'failed'
  }

  if (hasSuccess) {
    return 'delivered'
  }

  if (states.some((status) => DELIVERY_NOT_SENT_STATES.has(status))) {
    return 'not_sent'
  }

  if (states.some((status) => DELIVERY_QUEUE_STATES.has(status))) {
    return 'queued'
  }

  return fallback
}

function getResponseLabel(eventType, responseState) {
  const normalizedResponse = normalizeStatus(responseState)

  if (eventType === 'training') {
    return {
      available: 'Attending',
      maybe: 'Maybe',
      unavailable: 'Not attending',
    }[normalizedResponse] || 'Awaiting response'
  }

  return {
    available: 'Available',
    maybe: 'Maybe',
    unavailable: 'Unavailable',
  }[normalizedResponse] || 'Awaiting response'
}

function getDeliveryLabel(deliveryState) {
  return {
    delivered: 'Delivered',
    failed: 'Delivery issue',
    not_requested: '',
    partial_failure: 'Delivery issue',
    queued: 'Queued',
    requested: 'Requested',
  }[normalizeStatus(deliveryState)] || ''
}

export function getEventResponseDisplayState(row = {}) {
  const eventType = normalizeStatus(row.eventType) || 'general'
  const invitationState = normalizeStatus(row.invitationState)
  const deliveryState = normalizeStatus(row.deliveryState)
  const responseState = normalizeStatus(row.responseState)
  const matchSelectionState = normalizeStatus(row.matchSelectionState)
  const responseLabel = getResponseLabel(eventType, responseState)
  const deliveryLabel = getDeliveryLabel(deliveryState)

  if (invitationState === 'not_sent') {
    return {
      accessibleLabel: 'Invitation not sent',
      availabilityLabel: 'Invitation not sent',
      availabilityStatus: 'not_invited',
      canAcceptOnBehalf: false,
      matchSelectionLabel: eventType === 'match' && matchSelectionState === 'selected' ? 'Selected' : '',
      matchSelectionStatus: eventType === 'match' ? matchSelectionState || 'undecided' : '',
      primaryLabel: 'Invitation not sent',
      secondaryLabel: eventType === 'match' && matchSelectionState === 'selected' ? 'Selected' : '',
      tone: 'blue',
    }
  }

  if (responseState === 'not_requested') {
    const primaryLabel = deliveryLabel || 'Information attached'
    return {
      accessibleLabel: primaryLabel,
      availabilityLabel: primaryLabel,
      availabilityStatus: 'not_requested',
      canAcceptOnBehalf: false,
      matchSelectionLabel: '',
      matchSelectionStatus: '',
      primaryLabel,
      secondaryLabel: '',
      tone: deliveryState === 'failed' || deliveryState === 'partial_failure' ? 'red' : 'blue',
    }
  }

  const selected = eventType === 'match' && matchSelectionState === 'selected'
  const responseIsFinal = FINAL_RESPONSE_STATES.has(responseState)
  const primaryLabel = selected ? 'Selected' : responseLabel
  const secondaryParts = [
    ...(selected ? [responseLabel] : []),
    ...(!selected && eventType === 'match' && matchSelectionState === 'not_selected' ? ['Not selected'] : []),
    ...(deliveryLabel ? [deliveryLabel] : []),
  ]
  const accessibleParts = [primaryLabel, ...secondaryParts]
  const tone = deliveryState === 'failed' || deliveryState === 'partial_failure'
    ? 'red'
    : selected
      ? 'purple'
      : responseState === 'available'
        ? 'green'
        : responseState === 'maybe'
          ? 'orange'
          : responseState === 'unavailable'
            ? 'red'
            : 'blue'

  return {
    accessibleLabel: accessibleParts.join(', '),
    availabilityLabel: responseLabel,
    availabilityStatus: responseIsFinal ? responseState : 'pending',
    canAcceptOnBehalf: ['match', 'training'].includes(eventType) && responseState !== 'available',
    matchSelectionLabel: eventType === 'match'
      ? selected
        ? 'Selected'
        : matchSelectionState === 'not_selected'
          ? 'Not selected'
          : ''
      : '',
    matchSelectionStatus: eventType === 'match' ? matchSelectionState || 'undecided' : '',
    primaryLabel,
    secondaryLabel: secondaryParts.join(', '),
    tone,
  }
}

function getAuditSource(audits = [], playerId = '') {
  const matchingAudits = audits.filter((audit) => (
    normalizeText(audit?.metadata?.playerId) === normalizeText(playerId)
    && normalizeStatus(audit?.metadata?.outcome ?? audit.outcome) !== 'denied'
  ))
  const audit = getLatestRow(matchingAudits)
  return normalizeStatus(audit?.metadata?.responseSource ?? audit?.metadata?.source)
}

function getEventLogResponseSource(matchDay = {}, playerId = '') {
  const rows = (Array.isArray(matchDay.eventLog) ? matchDay.eventLog : [])
    .filter((entry) => (
      normalizeText(entry.playerId) === normalizeText(playerId)
      && normalizeStatus(entry.eventType) === 'player_availability_changed'
    ))
  return normalizeStatus(getLatestRow(rows)?.metadata?.responseSource ?? getLatestRow(rows)?.metadata?.source)
}

function getSelectionSource(matchDay = {}, playerId = '', decision = null) {
  const automaticSelection = (Array.isArray(matchDay.eventLog) ? matchDay.eventLog : [])
    .filter((entry) => (
      normalizeText(entry.playerId) === normalizeText(playerId)
      && normalizeStatus(entry?.metadata?.source) === 'availability_auto_selection'
    ))

  if (automaticSelection.length > 0) {
    return 'automatic'
  }

  return decision?.decidedBy || decision?.decidedByName ? 'manual' : ''
}

function createParticipantRow({
  eventType,
  invite = null,
  playerId,
  playerName,
  source,
}) {
  const notifyRequested = invite?.notifyRequested === true
  const responseRequirement = normalizeStatus(invite?.responseRequirement)
  const responseRequired = responseRequirement === 'response_required' || eventType === 'match'
  const invitationState = notifyRequested ? 'created' : 'not_sent'
  const responseState = invitationState === 'not_sent'
    ? 'not_invited'
    : responseRequired
      ? 'awaiting_response'
      : 'not_requested'

  return {
    ...(invite || {}),
    id: invite?.id || `${source.sourceType}:${source.sourceId}:${playerId}`,
    calendarEventId: invite?.calendarEventId || (source.sourceType === 'calendar' ? source.sourceId : ''),
    matchDayId: invite?.matchDayId || (source.sourceType === 'match-day' ? source.sourceId : ''),
    assessmentSessionId: invite?.assessmentSessionId || (source.sourceType === 'session' ? source.sourceId : ''),
    playerId,
    player: invite?.player || {
      id: playerId,
      playerName: getPlayerName(playerName),
    },
    participantAttachedAt: invite?.createdAt || invite?.invitedAt || '',
    participantState: 'attached',
    invitationCreatedAt: invite?.invitedAt || '',
    invitationState,
    deliveryState: notifyRequested ? 'requested' : 'not_requested',
    responseState,
    responseLabel: responseState === 'not_invited'
      ? 'Invitation not sent'
      : responseState === 'not_requested'
        ? 'Response not requested'
        : getResponseLabel(eventType, responseState),
    responseSource: '',
    respondedAt: invite?.respondedAt || '',
    matchSelectionState: eventType === 'match' ? 'undecided' : '',
    selectionSource: '',
    attendanceState: 'not_recorded',
    staffActions: {
      canAcceptOnBehalf: false,
      canMarkUnavailable: false,
      canSelectForSquad: false,
      invitationAction: '',
    },
    warningState: '',
    eventType,
    sourceType: source.sourceType,
    sourceId: source.sourceId,
  }
}

function mergeInviteRows(current, invite) {
  if (!current) {
    return invite
  }

  return {
    ...current,
    ...invite,
    player: {
      ...(current.player || {}),
      ...(invite.player || {}),
      playerName: getPlayerName(invite?.player?.playerName, current?.player?.playerName),
    },
  }
}

function applyDeliveryEvidence(row, deliveryRows) {
  if (FINAL_RESPONSE_STATES.has(normalizeStatus(row.responseState))) {
    return {
      ...row,
      deliveryState: 'delivered',
      deliveryError: '',
      warningState: '',
    }
  }

  const playerDeliveryRows = deliveryRows.filter((delivery) => (
    normalizeText(delivery.playerId) === normalizeText(row.playerId)
  ))

  if (playerDeliveryRows.length === 0) {
    return row
  }

  const deliveryState = getDeliveryStateFromRows(playerDeliveryRows, row.deliveryState)
  const invitationNotSent = deliveryState === 'not_sent'
  const latestDelivery = getLatestRow(playerDeliveryRows)
  const legacyDeliveryUpdatedAt = normalizeText(
    latestDelivery?.updatedAt || latestDelivery?.requestedAt || latestDelivery?.createdAt,
  )
  const canonicalDeliveryUpdatedAt = normalizeText(row.deliveryUpdatedAt)

  if (
    row.requestPlayerId
    && canonicalDeliveryUpdatedAt
    && legacyDeliveryUpdatedAt
    && canonicalDeliveryUpdatedAt > legacyDeliveryUpdatedAt
  ) {
    return row
  }

  return {
    ...row,
    invitationState: invitationNotSent ? 'not_sent' : 'created',
    deliveryState,
    deliveryError: normalizeText(latestDelivery?.lastError),
    deliveryUpdatedAt: legacyDeliveryUpdatedAt,
    responseState: invitationNotSent
      ? row.eventType === 'general'
        ? 'not_requested'
        : 'not_invited'
      : row.responseState === 'not_invited'
      ? row.eventType === 'general'
        ? 'not_requested'
        : 'awaiting_response'
      : row.responseState,
    warningState: ['failed', 'partial_failure'].includes(deliveryState) ? 'delivery_issue' : row.warningState,
  }
}

export function buildEventResponseReadModel({
  auditEvents = [],
  calendarInvites = [],
  deliveryEvents = [],
  event = {},
  occurrenceDate = '',
  participationRemovals = [],
  sessionParticipants = [],
  trainingAvailabilitySummary = null,
} = {}) {
  const source = getEventSource(event)
  const eventType = source.eventType
  const participantsByPlayerId = new Map()
  const requestedOccurrenceDate = normalizeDateOnly(occurrenceDate || event?.occurrenceDate || event?.date)
  const relevantInvites = (Array.isArray(calendarInvites) ? calendarInvites : [])
    .filter((invite) => inviteMatchesEvent(invite, source))

  relevantInvites.forEach((invite) => {
    const playerId = normalizeText(invite.playerId)

    if (!playerId) {
      return
    }

    const nextRow = createParticipantRow({
      eventType,
      invite,
      playerId,
      playerName: invite?.player?.playerName,
      source,
    })
    participantsByPlayerId.set(playerId, mergeInviteRows(participantsByPlayerId.get(playerId), nextRow))
  })

  if (source.sourceType === 'session') {
    const relevantSessionParticipants = (Array.isArray(sessionParticipants) ? sessionParticipants : [])
      .filter((participant) => (
        !normalizeText(participant.sessionId)
        || normalizeText(participant.sessionId) === source.sourceId
      ))

    relevantSessionParticipants.forEach((participant) => {
      const playerId = normalizeText(participant.playerId)

      if (!playerId) {
        return
      }

      const current = participantsByPlayerId.get(playerId)
      const next = current || createParticipantRow({
        eventType,
        playerId,
        playerName: getPlayerName(participant.playerName, participant?.player?.playerName),
        source,
      })

      participantsByPlayerId.set(playerId, {
        ...next,
        participantAttachedAt: next.participantAttachedAt || participant.createdAt || '',
        player: {
          ...(next.player || {}),
          ...(participant.player || {}),
          id: playerId,
          playerName: getPlayerName(
            next?.player?.playerName,
            participant.playerName,
            participant?.player?.playerName,
          ),
          section: normalizeText(next?.player?.section ?? participant.section ?? participant?.player?.section),
        },
      })
    })
  }

  if (source.sourceType === 'match-day') {
    const matchDay = event.data || {}
    const requests = Array.isArray(matchDay.availabilityRequests) ? matchDay.availabilityRequests : []
    const availabilityRows = Array.isArray(matchDay.playerAvailability) ? matchDay.playerAvailability : []
    const decisions = Array.isArray(matchDay.squadDecisions) ? matchDay.squadDecisions : []
    const playerIds = new Set([
      ...requests.map((row) => normalizeText(row.playerId)),
      ...availabilityRows.map((row) => normalizeText(row.playerId)),
      ...decisions.map((row) => normalizeText(row.playerId)),
      ...participantsByPlayerId.keys(),
    ])

    playerIds.forEach((playerId) => {
      if (!playerId) {
        return
      }

      const playerRequests = requests.filter((row) => normalizeText(row.playerId) === playerId)
      const activeRequest = getLatestRow(playerRequests.filter((row) => (
        isActiveMatchDayAvailabilityRequest(row)
      )))
      const historicalRequest = getLatestRow(playerRequests)
      const request = activeRequest || historicalRequest
      const hasActiveAvailabilityRequest = Boolean(activeRequest)
      const availability = getLatestRow(
        availabilityRows.filter((row) => normalizeText(row.playerId) === playerId),
      )
      const decision = getLatestRow(
        decisions.filter((row) => normalizeText(row.playerId) === playerId),
      )
      const current = participantsByPlayerId.get(playerId)
      const next = current || createParticipantRow({
        eventType,
        playerId,
        playerName: getPlayerName(request?.playerName, availability?.playerName),
        source,
      })
      const requestStatus = normalizeStatus(request?.status)
      const availabilityStatus = normalizeStatus(availability?.status)
      const hasFinalResponse = FINAL_RESPONSE_STATES.has(availabilityStatus)
        || FINAL_RESPONSE_STATES.has(requestStatus)
      const responseState = FINAL_RESPONSE_STATES.has(availabilityStatus)
        ? availabilityStatus
        : FINAL_RESPONSE_STATES.has(requestStatus)
          ? requestStatus
          : hasActiveAvailabilityRequest
            ? 'awaiting_response'
            : 'not_invited'
      const responseSource = getAuditSource(auditEvents, playerId)
        || getEventLogResponseSource(matchDay, playerId)
        || (availability?.selectedByParentLinkId ? 'parent' : '')
        || (request?.respondedAt && normalizeStatus(request?.recipientType) === 'player' ? 'adult_player' : '')
        || (request?.respondedAt ? 'parent' : '')
      const matchSelectionState = normalizeStatus(decision?.status) || 'undecided'
      const deliveryState = hasFinalResponse
        ? 'delivered'
        : hasActiveAvailabilityRequest
        ? request.sentAt || FINAL_RESPONSE_STATES.has(requestStatus)
          ? 'delivered'
          : 'queued'
        : request
          ? 'not_sent'
          : 'not_requested'

      participantsByPlayerId.set(playerId, {
        ...next,
        availabilityRequestCount: playerRequests.length,
        hasAvailabilityRequest: Boolean(request),
        hasActiveAvailabilityRequest,
        parentLinkId: next.parentLinkId || request?.parentLinkId || '',
        recipientType: next.recipientType || request?.recipientType || '',
        invitationCreatedAt: request?.createdAt || '',
        invitationState: hasFinalResponse || hasActiveAvailabilityRequest ? 'created' : 'not_sent',
        notifyRequested: hasActiveAvailabilityRequest,
        deliveryState,
        responseState,
        responseLabel: responseState === 'not_invited'
          ? 'Invitation not sent'
          : getResponseLabel(eventType, responseState),
        responseSource,
        respondedAt: availability?.selectedAt || request?.respondedAt || next.respondedAt,
        matchSelectionState,
        selectionSource: getSelectionSource(matchDay, playerId, decision),
        player: {
          ...(next.player || {}),
          id: playerId,
          playerName: getPlayerName(
            next?.player?.playerName,
            request?.playerName,
            availability?.playerName,
          ),
        },
      })
    })
  }

  if (eventType === 'training') {
    const details = Array.isArray(trainingAvailabilitySummary?.details)
      ? trainingAvailabilitySummary.details.filter((detail) => (
          !requestedOccurrenceDate
          || normalizeDateOnly(detail.occurrenceDate || detail.occurrenceStartsAt) === requestedOccurrenceDate
        ))
      : []

    details.forEach((detail) => {
      const playerId = normalizeText(detail.playerId)

      if (!playerId) {
        return
      }

      const current = participantsByPlayerId.get(playerId)
      const next = current || createParticipantRow({
        eventType,
        playerId,
        playerName: detail.playerName,
        source,
      })
      const responseState = FINAL_RESPONSE_STATES.has(normalizeStatus(detail.responseStatus))
        ? normalizeStatus(detail.responseStatus)
        : 'awaiting_response'
      const recipientStatus = normalizeStatus(detail.recipientStatus)
      const deliveryState = FINAL_RESPONSE_STATES.has(responseState)
        ? 'delivered'
        : detail.emailSentAt || recipientStatus === 'sent' || recipientStatus === 'responded'
        ? 'delivered'
        : recipientStatus === 'failed' || normalizeText(detail.lastError)
          ? 'failed'
          : recipientStatus === 'cancelled' || recipientStatus === 'expired'
            ? 'not_sent'
            : 'queued'
      const responseSource = getAuditSource(auditEvents, playerId)
        || normalizeStatus(detail.responseSource)
        || (detail.parentLinkId ? 'parent' : '')
        || (detail.respondedAt && normalizeStatus(detail.recipientType) === 'player' ? 'adult_player' : '')

      participantsByPlayerId.set(playerId, {
        ...next,
        id: next.id || detail.requestPlayerId,
        requestId: detail.requestId,
        requestPlayerId: detail.requestPlayerId,
        parentLinkId: next.parentLinkId || detail.parentLinkId || '',
        recipientType: next.recipientType || detail.recipientType || '',
        invitationCreatedAt: next.invitationCreatedAt || detail.createdAt || '',
        invitationState: 'created',
        notifyRequested: true,
        deliveryState,
        deliveryError: deliveryState === 'delivered' ? '' : normalizeText(detail.lastError),
        deliveryUpdatedAt: detail.updatedAt || detail.createdAt || '',
        responseState,
        responseLabel: getResponseLabel(eventType, responseState),
        responseSource,
        respondedAt: detail.respondedAt || next.respondedAt,
        warningState: deliveryState === 'failed' ? 'delivery_issue' : '',
        player: {
          ...(next.player || {}),
          id: playerId,
          playerName: getPlayerName(next?.player?.playerName, detail.playerName),
        },
      })
    })
  }

  const effectiveRemovedPlayerIds = new Set(
    (Array.isArray(participationRemovals) ? participationRemovals : [])
      .filter((removal) => {
        if (normalizeText(removal.sourceId) !== source.sourceId) {
          return false
        }

        const scope = normalizeStatus(removal.scope)
        const effectiveFromDate = normalizeDateOnly(removal.effectiveFromDate || removal.occurrenceDate)

        if (source.sourceType === 'match-day') {
          return normalizeStatus(removal.sourceType) === 'match-day' && scope === 'event'
        }

        if (source.sourceType !== 'calendar' || normalizeStatus(removal.sourceType) !== 'calendar') {
          return false
        }

        if (scope === 'event') {
          return true
        }

        if (!requestedOccurrenceDate || !effectiveFromDate) {
          return false
        }

        return scope === 'occurrence'
          ? effectiveFromDate === requestedOccurrenceDate
          : scope === 'this_and_future' && effectiveFromDate <= requestedOccurrenceDate
      })
      .map((removal) => normalizeText(removal.playerId))
      .filter(Boolean),
  )

  const participants = [...participantsByPlayerId.values()]
    .filter((row) => !effectiveRemovedPlayerIds.has(normalizeText(row.playerId)))
    .map((row) => {
      const withDelivery = source.sourceType === 'match-day' && row.hasActiveAvailabilityRequest !== true
        ? row
        : applyDeliveryEvidence(row, deliveryEvents)
      const display = getEventResponseDisplayState(withDelivery)
      const responseState = normalizeStatus(withDelivery.responseState)
      const matchSelectionState = normalizeStatus(withDelivery.matchSelectionState)
      const invitationAction = source.sourceType === 'match-day'
        ? withDelivery.hasActiveAvailabilityRequest !== true
          || normalizeStatus(withDelivery.invitationState) === 'not_sent'
          ? 'send'
          : ['failed', 'partial_failure'].includes(normalizeStatus(withDelivery.deliveryState))
            ? 'retry'
            : 'resend'
        : normalizeStatus(withDelivery.invitationState) === 'not_sent'
          ? 'send'
          : ['failed', 'partial_failure'].includes(normalizeStatus(withDelivery.deliveryState))
            ? 'retry'
            : normalizeStatus(withDelivery.invitationState) === 'created'
              ? 'resend'
              : ''
      return {
        ...withDelivery,
        responseLabel: withDelivery.responseState === 'not_invited'
          ? 'Invitation not sent'
          : withDelivery.responseState === 'not_requested'
            ? 'Response not requested'
            : getResponseLabel(eventType, withDelivery.responseState),
        staffActions: {
          canAcceptOnBehalf: display.canAcceptOnBehalf
            && (source.sourceType === 'match-day'
              ? withDelivery.hasActiveAvailabilityRequest === true
              : normalizeStatus(withDelivery.invitationState) !== 'not_sent'),
          canMarkUnavailable: ['match', 'training'].includes(eventType)
            && responseState !== 'unavailable'
            && (source.sourceType === 'match-day'
              ? withDelivery.hasActiveAvailabilityRequest === true
              : normalizeStatus(withDelivery.invitationState) !== 'not_sent'),
          canSelectForSquad: eventType === 'match'
            && matchSelectionState !== 'selected',
          invitationAction,
        },
        display,
      }
    })
    .sort((left, right) => (
      getPlayerName(left?.player?.playerName)
        .localeCompare(getPlayerName(right?.player?.playerName), undefined, { sensitivity: 'base' })
    ))

  const counts = participants.reduce((result, row) => {
    result.total += 1

    if (row.invitationState === 'not_sent') {
      result.invitationNotSent += 1
    }

    if (row.deliveryState === 'failed' || row.deliveryState === 'partial_failure') {
      result.deliveryIssues += 1
    }

    if (row.responseState === 'awaiting_response') {
      result.awaitingResponse += 1
    }

    if (FINAL_RESPONSE_STATES.has(row.responseState)) {
      result[row.responseState] += 1
    }

    if (row.matchSelectionState === 'selected') {
      result.selected += 1
    }

    return result
  }, {
    available: 0,
    awaitingResponse: 0,
    deliveryIssues: 0,
    invitationNotSent: 0,
    maybe: 0,
    selected: 0,
    total: 0,
    unavailable: 0,
  })

  return {
    counts,
    event: {
      eventType,
      sourceId: source.sourceId,
      sourceType: source.sourceType,
    },
    participationRemovals: (Array.isArray(participationRemovals) ? participationRemovals : []),
    participants,
    responseManager: buildEventResponseManagerModel({
      eventType,
      participants,
    }),
  }
}

function normalizeDeliveryEvent(row = {}) {
  return {
    id: row.id ?? '',
    playerId: row.player_id ?? '',
    status: normalizeStatus(row.status),
    lastError: normalizeText(row.last_error),
    requestedAt: row.requested_at ?? '',
    createdAt: row.created_at ?? '',
    updatedAt: row.updated_at ?? '',
  }
}

function normalizeAuditEvent(row = {}) {
  return {
    id: row.id ?? '',
    action: normalizeStatus(row.action),
    entityId: row.entity_id ?? '',
    metadata: row.metadata && typeof row.metadata === 'object' ? row.metadata : {},
    outcome: normalizeStatus(row.outcome),
    createdAt: row.created_at ?? '',
  }
}

function normalizeSessionParticipant(row = {}) {
  return {
    id: row.id ?? '',
    sessionId: row.session_id ?? '',
    playerId: row.player_id ?? '',
    playerName: normalizeText(row.player_name ?? row?.players?.player_name),
    section: normalizeText(row.section ?? row?.players?.section),
    createdAt: row.created_at ?? '',
    updatedAt: row.updated_at ?? '',
    player: {
      id: row.player_id ?? '',
      playerName: normalizeText(row.player_name ?? row?.players?.player_name),
      section: normalizeText(row.section ?? row?.players?.section),
      team: normalizeText(row.team ?? row?.players?.team),
    },
  }
}

function normalizeParticipationRemoval(row = {}) {
  const sourceType = normalizeStatus(row.source_type || (row.calendar_event_id ? 'calendar' : 'match-day'))

  return {
    id: row.id ?? '',
    affectedOccurrenceCount: Number(row.affected_occurrence_count ?? 0),
    createdAt: row.created_at ?? '',
    effectiveFromDate: normalizeDateOnly(row.effective_from_date),
    occurrenceDate: normalizeDateOnly(row.occurrence_date),
    playerId: row.player_id ?? '',
    scope: normalizeStatus(row.scope),
    sourceId: row.calendar_event_id ?? row.match_day_id ?? '',
    sourceType,
    suppressedInvitationCount: Number(row.suppressed_invitation_count ?? 0),
  }
}

function applyEventFilter(query, sourceType, sourceId) {
  if (sourceType === 'calendar') {
    return query.eq('calendar_event_id', sourceId)
  }

  if (sourceType === 'match-day') {
    return query.eq('match_day_id', sourceId)
  }

  if (sourceType === 'session') {
    return query.eq('assessment_session_id', sourceId)
  }

  return query
}

export async function getEventResponseEvidenceForEvent({ event, user } = {}) {
  const source = getEventSource(event)

  if (
    !user?.clubId
    || user.role === 'parent_portal'
    || user.role === 'super_admin'
    || Number(user.roleRank ?? 0) < 20
    || !source.sourceId
    || !['calendar', 'match-day', 'session'].includes(source.sourceType)
  ) {
    return {
      auditEvents: [],
      calendarInvites: [],
      deliveryEvents: [],
      participationRemovals: [],
      sessionParticipants: [],
    }
  }

  let inviteQuery = supabase
    .from('calendar_event_invites')
    .select('*, players:player_id (id, player_name, section, team, parent_name, parent_email, parent_contacts)')
    .eq('club_id', user.clubId)
    .neq('invite_status', 'cancelled')
    .order('created_at', { ascending: false })

  inviteQuery = applyEventFilter(inviteQuery, source.sourceType, source.sourceId)

  const calendarDeliveryQuery = supabase.rpc('get_event_response_delivery_evidence', {
    source_id_value: source.sourceId,
    source_type_value: source.sourceType,
  })

  let eventPlayerCommandQuery = supabase
    .from('event_player_change_commands')
    .select('id')
    .eq('club_id', user.clubId)
    .order('created_at', { ascending: false })
    .limit(500)

  eventPlayerCommandQuery = applyEventFilter(
    eventPlayerCommandQuery,
    source.sourceType,
    source.sourceId,
  )

  const auditQuery = supabase
    .from('audit_logs')
    .select('id, action, entity_id, metadata, outcome, created_at')
    .eq('club_id', user.clubId)
    .in('action', RESPONSE_AUDIT_ACTIONS)
    .eq('metadata->>eventId', source.sourceId)
    .order('created_at', { ascending: false })
    .limit(500)

  const sessionParticipantQuery = source.sourceType === 'session'
    ? supabase
      .from('assessment_session_players')
      .select('id, session_id, player_id, player_name, section, team, created_at, updated_at, players:player_id (id, player_name, section, team), assessment_sessions!inner(club_id)')
      .eq('session_id', source.sourceId)
      .eq('assessment_sessions.club_id', user.clubId)
      .order('player_name', { ascending: true })
    : Promise.resolve({ data: [], error: null })

  const exclusionQuery = source.sourceType === 'calendar'
    ? supabase
      .from('event_player_occurrence_exclusions')
      .select('id, calendar_event_id, player_id, scope, effective_from_date, created_at')
      .eq('club_id', user.clubId)
      .eq('calendar_event_id', source.sourceId)
      .order('created_at', { ascending: false })
    : Promise.resolve({ data: [], error: null })

  let removalCommandQuery = ['calendar', 'match-day'].includes(source.sourceType)
    ? supabase
      .from('event_player_removal_commands')
      .select('id, source_type, calendar_event_id, match_day_id, player_id, scope, occurrence_date, affected_occurrence_count, suppressed_invitation_count, created_at')
      .eq('club_id', user.clubId)
      .eq('source_type', source.sourceType)
      .order('created_at', { ascending: false })
      .limit(500)
    : null

  if (removalCommandQuery) {
    removalCommandQuery = source.sourceType === 'calendar'
      ? removalCommandQuery.eq('calendar_event_id', source.sourceId)
      : removalCommandQuery.eq('match_day_id', source.sourceId)
  }

  const [
    inviteResult,
    auditResult,
    commandResult,
    calendarDeliveryResult,
    exclusionResult,
    removalCommandResult,
    sessionParticipantResult,
  ] = await Promise.all([
    inviteQuery,
    auditQuery,
    eventPlayerCommandQuery,
    calendarDeliveryQuery || Promise.resolve({ data: [], error: null }),
    exclusionQuery,
    removalCommandQuery || Promise.resolve({ data: [], error: null }),
    sessionParticipantQuery,
  ])

  if (inviteResult.error) {
    console.error(inviteResult.error)
    throw inviteResult.error
  }

  if (sessionParticipantResult.error) {
    console.error(sessionParticipantResult.error)
    throw sessionParticipantResult.error
  }

  const auditEvents = auditResult.error
    ? []
    : (auditResult.data ?? [])
      .map(normalizeAuditEvent)
      .filter((audit) => (
        normalizeText(audit.entityId) === source.sourceId
        || normalizeText(audit?.metadata?.eventId) === source.sourceId
      ))

  if (auditResult.error) {
    console.error(auditResult.error)
  }

  if (commandResult.error) {
    console.error(commandResult.error)
  }

  if (exclusionResult.error) {
    console.error(exclusionResult.error)
  }

  if (removalCommandResult.error) {
    console.error(removalCommandResult.error)
  }

  const commandIds = commandResult.error
    ? []
    : (commandResult.data ?? []).map((command) => command.id).filter(Boolean)
  const eventPlayerDeliveryResult = commandIds.length > 0
    ? await supabase
      .from('event_player_notification_events')
      .select('id, player_id, status, last_error, requested_at')
      .eq('club_id', user.clubId)
      .in('command_id', commandIds)
      .order('requested_at', { ascending: false })
    : { data: [], error: null }
  const deliveryEvents = [calendarDeliveryResult, eventPlayerDeliveryResult].flatMap((result) => {
    if (result.error) {
      console.error(result.error)
      return []
    }

    return (result.data ?? []).map(normalizeDeliveryEvent)
  })

  return {
    auditEvents,
    calendarInvites: (inviteResult.data ?? []).map(normalizeCalendarEventInvite),
    deliveryEvents,
    participationRemovals: [
      ...(exclusionResult.error ? [] : exclusionResult.data ?? []),
      ...(removalCommandResult.error ? [] : removalCommandResult.data ?? []),
    ].map(normalizeParticipationRemoval),
    sessionParticipants: (sessionParticipantResult.data ?? []).map(normalizeSessionParticipant),
  }
}
