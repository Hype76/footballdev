import { supabase } from '../supabase-client.js'
import { createAuditLog } from './audit.js'
import { blockDemoMutation } from './demo-guards.js'

function normalizeText(value) {
  return String(value ?? '').trim()
}

export const TRAINING_AVAILABILITY_CHIP_STATES = {
  available: {
    label: 'Attending',
    tone: 'green',
  },
  unavailable: {
    label: 'Not attending',
    tone: 'red',
  },
  pending: {
    label: 'No response',
    tone: 'blue',
  },
  maybe: {
    label: 'Maybe',
    tone: 'orange',
  },
}

export function getTrainingAvailabilityChipState(value) {
  const status = normalizeText(value).toLowerCase().replaceAll('-', '_').replace(/\s+/g, '_')

  if (['available', 'accepted', 'accept', 'yes'].includes(status)) {
    return TRAINING_AVAILABILITY_CHIP_STATES.available
  }

  if (['unavailable', 'not_available', 'not_accepted', 'declined', 'no'].includes(status)) {
    return TRAINING_AVAILABILITY_CHIP_STATES.unavailable
  }

  if (['maybe', 'unsure'].includes(status)) {
    return TRAINING_AVAILABILITY_CHIP_STATES.maybe
  }

  return TRAINING_AVAILABILITY_CHIP_STATES.pending
}

function normalizeInteger(value, fallback = 2) {
  const parsedValue = Number.parseInt(String(value ?? ''), 10)
  return Number.isFinite(parsedValue) ? parsedValue : fallback
}

function clampSendDaysBefore(value) {
  return Math.min(30, Math.max(0, normalizeInteger(value, 2)))
}

function normalizeSetting(row = {}) {
  return {
    id: row.id ?? '',
    calendarEventId: row.calendar_event_id ?? row.calendarEventId ?? '',
    clubId: row.club_id ?? row.clubId ?? '',
    teamId: row.team_id ?? row.teamId ?? '',
    enabled: row.enabled !== false,
    sendDaysBefore: clampSendDaysBefore(row.send_days_before ?? row.sendDaysBefore),
    createdAt: row.created_at ?? row.createdAt ?? '',
    updatedAt: row.updated_at ?? row.updatedAt ?? '',
  }
}

function requireStaffUser(user) {
  if (!user?.clubId || user.role === 'parent_portal' || user.role === 'super_admin' || Number(user.roleRank ?? 0) < 20) {
    throw new Error('Coach or manager access is required for Training Availability.')
  }
}

function requireManagerUser(user) {
  requireStaffUser(user)
}

export function getDefaultTrainingAvailabilityForm() {
  return {
    requestTrainingAvailability: false,
    trainingAvailabilitySendDaysBefore: 2,
  }
}

export function buildTrainingAvailabilityPayload(form = {}) {
  return {
    enabled: form.requestTrainingAvailability === true,
    sendDaysBefore: clampSendDaysBefore(form.trainingAvailabilitySendDaysBefore),
  }
}

export function summarizeTrainingAvailabilityRows(rows = []) {
  const summary = {
    pending: 0,
    sent: 0,
    failed: 0,
    responded: 0,
    available: 0,
    unavailable: 0,
    maybe: 0,
    details: [],
  }
  const sharedResponses = new Map()

  for (const row of rows) {
    const status = normalizeText(row.status).toLowerCase()

    if (status === 'responded') {
      summary.responded += 1
    } else if (status === 'sent') {
      summary.sent += 1
    } else if (status === 'failed') {
      summary.failed += 1
    } else if (status !== 'cancelled' && status !== 'expired') {
      summary.pending += 1
    }

    const detail = normalizeTrainingAvailabilityDetail(row)
    const sharedKey = `${detail.requestId}:${detail.playerId}`
    const existingDetail = sharedResponses.get(sharedKey)

    if (!existingDetail || (
      detail.respondedAt
      && (!existingDetail.respondedAt || detail.respondedAt >= existingDetail.respondedAt)
    )) {
      sharedResponses.set(sharedKey, detail)
    }
  }

  for (const detail of sharedResponses.values()) {
    const responseStatus = normalizeText(detail.responseStatus).toLowerCase()

    if (responseStatus === 'available') {
      summary.available += 1
    } else if (responseStatus === 'unavailable') {
      summary.unavailable += 1
    } else if (responseStatus === 'maybe') {
      summary.maybe += 1
    }

    if (detail.playerId) {
      summary.details.push(detail)
    }
  }

  return summary
}

export function normalizeTrainingAvailabilityDetail(row = {}) {
  const response = Array.isArray(row.training_availability_responses)
    ? row.training_availability_responses[0]
    : row.training_availability_responses
  const request = Array.isArray(row.training_availability_requests)
    ? row.training_availability_requests[0]
    : row.training_availability_requests
  const responseStatus = normalizeText(response?.status).toLowerCase()
  const state = getTrainingAvailabilityChipState(responseStatus)

  return {
    requestId: row.request_id ?? row.requestId ?? request?.id ?? '',
    requestPlayerId: row.id ?? row.requestPlayerId ?? '',
    calendarEventId: row.calendar_event_id ?? row.calendarEventId ?? '',
    occurrenceDate: request?.occurrence_date ?? row.occurrence_date ?? row.occurrenceDate ?? '',
    occurrenceStartsAt: request?.occurrence_starts_at ?? row.occurrence_starts_at ?? row.occurrenceStartsAt ?? '',
    playerId: row.player_id ?? row.playerId ?? '',
    playerName: normalizeText(row.player_name ?? row.playerName),
    recipientStatus: normalizeText(row.status ?? row.recipientStatus),
    recipientType: normalizeText(row.recipient_type ?? row.recipientType),
    parentLinkId: row.parent_link_id ?? row.parentLinkId ?? '',
    emailSentAt: row.email_sent_at ?? row.emailSentAt ?? '',
    lastError: normalizeText(row.last_error ?? row.lastError),
    createdAt: row.created_at ?? row.createdAt ?? '',
    responseStatus: responseStatus || 'pending',
    responseLabel: state.label,
    responseTone: state.tone,
    note: normalizeText(response?.note ?? row.note),
    respondedAt: response?.responded_at ?? row.responded_at ?? row.respondedAt ?? '',
    respondedByName: normalizeText(response?.responded_by_name ?? row.responded_by_name ?? row.respondedByName),
    responseSource: normalizeText(response?.response_source ?? row.response_source ?? row.responseSource),
  }
}

export async function getTrainingAvailabilitySettingsForEvents({ user, eventIds = [] } = {}) {
  requireStaffUser(user)

  const normalizedEventIds = [...new Set(
    (Array.isArray(eventIds) ? eventIds : [])
      .map(normalizeText)
      .filter(Boolean),
  )]

  if (normalizedEventIds.length === 0) {
    return {}
  }

  const { data, error } = await supabase
    .from('training_availability_settings')
    .select('*')
    .eq('club_id', user.clubId)
    .in('calendar_event_id', normalizedEventIds)

  if (error) {
    console.error(error)
    throw error
  }

  return Object.fromEntries((data ?? []).map((row) => [row.calendar_event_id, normalizeSetting(row)]))
}

export async function getTrainingAvailabilitySummaryForEvents({ user, eventIds = [] } = {}) {
  requireStaffUser(user)

  const normalizedEventIds = [...new Set(
    (Array.isArray(eventIds) ? eventIds : [])
      .map(normalizeText)
      .filter(Boolean),
  )]

  if (normalizedEventIds.length === 0) {
    return {}
  }

  const [
    { data: requestPlayers, error: requestPlayersError },
    { data: responses, error: responsesError },
  ] = await Promise.all([
    supabase
      .from('training_availability_request_players')
      .select('id, request_id, calendar_event_id, player_id, player_name, parent_link_id, recipient_type, status, email_sent_at, last_error, created_at, training_availability_requests(id, occurrence_date, occurrence_starts_at)')
      .eq('club_id', user.clubId)
      .in('calendar_event_id', normalizedEventIds),
    supabase
      .from('training_availability_responses')
      .select('request_id, calendar_event_id, player_id, status, note, responded_at, responded_by_name, response_source')
      .eq('club_id', user.clubId)
      .in('calendar_event_id', normalizedEventIds),
  ])

  if (requestPlayersError || responsesError) {
    const error = requestPlayersError || responsesError
    console.error(error)
    throw error
  }

  const responseByRequestPlayer = new Map(
    (responses ?? []).map((response) => [
      `${normalizeText(response.request_id)}:${normalizeText(response.player_id)}`,
      response,
    ]),
  )
  const rowsByEventId = new Map()

  for (const requestPlayer of requestPlayers ?? []) {
    const row = {
      ...requestPlayer,
      training_availability_responses: responseByRequestPlayer.get(
        `${normalizeText(requestPlayer.request_id)}:${normalizeText(requestPlayer.player_id)}`,
      ) ?? null,
    }
    const eventId = normalizeText(row.calendar_event_id)

    if (!eventId) {
      continue
    }

    if (!rowsByEventId.has(eventId)) {
      rowsByEventId.set(eventId, [])
    }

    rowsByEventId.get(eventId).push(row)
  }

  return Object.fromEntries(
    [...rowsByEventId.entries()].map(([eventId, rows]) => [eventId, summarizeTrainingAvailabilityRows(rows)]),
  )
}

export async function saveTrainingAvailabilitySettings({ user, event, settings }) {
  await blockDemoMutation(user)
  requireManagerUser(user)

  const eventId = normalizeText(event?.id)
  const teamId = normalizeText(event?.teamId)

  if (!eventId || !teamId || normalizeText(event?.eventType) !== 'training') {
    throw new Error('Training Availability can only be saved for team training calendar events.')
  }

  const payload = buildTrainingAvailabilityPayload(settings)
  const notifyInvitedFamilies = payload.enabled || settings?.notifyInvitedFamilies === true
  const { data, error } = await supabase
    .rpc('save_training_availability_setting_v3', {
      event_id_value: eventId,
      enabled_value: payload.enabled,
      notify_invited_families_value: notifyInvitedFamilies,
      send_days_before_value: payload.sendDaysBefore,
    })
    .single()

  if (error) {
    console.error(error)
    throw error
  }

  await createAuditLog({
    user,
    action: 'training_availability_settings_saved',
    entityType: 'calendar_event',
    entityId: eventId,
    metadata: {
      enabled: payload.enabled,
      notifyInvitedFamilies,
      sendDaysBefore: payload.sendDaysBefore,
      teamId,
    },
  })

  return normalizeSetting(data)
}

export async function cancelPendingTrainingAvailabilityRequests({ user, calendarEventId }) {
  await blockDemoMutation(user)
  requireManagerUser(user)

  const eventId = normalizeText(calendarEventId)

  if (!eventId) {
    return { cancelled: 0 }
  }

  const { data, error } = await supabase
    .from('training_availability_requests')
    .update({ status: 'cancelled' })
    .eq('club_id', user.clubId)
    .eq('calendar_event_id', eventId)
    .in('status', ['pending', 'queued'])
    .select('id')

  if (error) {
    console.error(error)
    throw error
  }

  await createAuditLog({
    user,
    action: 'training_availability_requests_cancelled',
    entityType: 'calendar_event',
    entityId: eventId,
    metadata: {
      cancelledCount: data?.length ?? 0,
    },
  })

  return { cancelled: data?.length ?? 0 }
}
