import { supabase } from '../supabase-client.js'
import { createAuditLog } from './audit.js'
import { blockDemoMutation } from './demo-guards.js'

function normalizeText(value) {
  return String(value ?? '').trim()
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

export function getDefaultTrainingAvailabilityForm(eventType = 'training') {
  return {
    requestTrainingAvailability: normalizeText(eventType) === 'training',
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
  }

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

    const response = Array.isArray(row.training_availability_responses)
      ? row.training_availability_responses[0]
      : row.training_availability_responses
    const responseStatus = normalizeText(response?.status).toLowerCase()

    if (responseStatus === 'available') {
      summary.available += 1
    } else if (responseStatus === 'unavailable') {
      summary.unavailable += 1
    } else if (responseStatus === 'maybe') {
      summary.maybe += 1
    }
  }

  return summary
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

  const { data, error } = await supabase
    .from('training_availability_request_players')
    .select('calendar_event_id, status, training_availability_responses(status)')
    .eq('club_id', user.clubId)
    .in('calendar_event_id', normalizedEventIds)

  if (error) {
    console.error(error)
    throw error
  }

  const rowsByEventId = new Map()

  for (const row of data ?? []) {
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
  const row = {
    calendar_event_id: eventId,
    club_id: user.clubId,
    team_id: teamId,
    enabled: payload.enabled,
    send_days_before: payload.sendDaysBefore,
    created_by: user.id || null,
    updated_by: user.id || null,
  }

  const { data, error } = await supabase
    .from('training_availability_settings')
    .upsert(row, { onConflict: 'calendar_event_id' })
    .select('*')
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
