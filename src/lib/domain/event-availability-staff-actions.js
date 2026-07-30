import { supabase } from '../supabase-client.js'
import { clearViewCaches, invalidateMemoryCacheByPrefix } from './cache-store.js'
import { blockDemoMutation } from './demo-guards.js'

function normalizeText(value) {
  return String(value ?? '').trim()
}

function requireStaffUser(user) {
  if (
    !user?.clubId
    || user.role === 'parent_portal'
    || Number(user.roleRank ?? 0) < 20
  ) {
    throw new Error('Authorised team staff access is required.')
  }
}

export async function acceptEventPlayerAvailabilityOnBehalf({
  user,
  eventType,
  eventId,
  playerId,
  occurrenceDate = '',
} = {}) {
  await blockDemoMutation(user)
  requireStaffUser(user)

  const normalizedEventType = normalizeText(eventType).toLowerCase()
  const normalizedEventId = normalizeText(eventId)
  const normalizedPlayerId = normalizeText(playerId)
  const normalizedOccurrenceDate = normalizeText(occurrenceDate)

  if (!['match', 'training'].includes(normalizedEventType)) {
    throw new Error('Accept on behalf supports Match Day and training invitations only.')
  }

  if (!normalizedEventId || !normalizedPlayerId) {
    throw new Error('Choose an invited player and event before accepting on their behalf.')
  }

  if (normalizedEventType === 'training' && !normalizedOccurrenceDate) {
    throw new Error('Choose a training occurrence before accepting on behalf of a player.')
  }

  const { data, error } = await supabase.rpc('accept_event_player_availability_on_behalf', {
    event_id_value: normalizedEventId,
    event_type_value: normalizedEventType,
    occurrence_date_value: normalizedEventType === 'training' ? normalizedOccurrenceDate : null,
    player_id_value: normalizedPlayerId,
  })

  if (error) {
    console.error(error)
    throw error
  }

  clearViewCaches()
  invalidateMemoryCacheByPrefix('match-day:')
  invalidateMemoryCacheByPrefix(`calendar-events:${user.clubId}:`)

  return {
    changed: data?.changed === true,
    eventId: normalizeText(data?.eventId) || normalizedEventId,
    eventType: normalizeText(data?.eventType) || normalizedEventType,
    occurrenceDate: normalizeText(data?.occurrenceDate) || normalizedOccurrenceDate,
    playerId: normalizeText(data?.playerId) || normalizedPlayerId,
    previousStatus: normalizeText(data?.previousStatus) || 'pending',
    respondedAt: data?.respondedAt ?? '',
    responseStatus: normalizeText(data?.responseStatus) || 'available',
    source: normalizeText(data?.source) || 'staff_on_behalf',
  }
}

export async function markEventPlayerUnavailableOnBehalf({
  user,
  eventType,
  eventId,
  playerId,
  occurrenceDate = '',
} = {}) {
  await blockDemoMutation(user)
  requireStaffUser(user)

  const normalizedEventType = normalizeText(eventType).toLowerCase()
  const normalizedEventId = normalizeText(eventId)
  const normalizedPlayerId = normalizeText(playerId)
  const normalizedOccurrenceDate = normalizeText(occurrenceDate)

  if (!['match', 'training'].includes(normalizedEventType)) {
    throw new Error('Mark unavailable supports Match Day and training invitations only.')
  }

  if (!normalizedEventId || !normalizedPlayerId) {
    throw new Error('Choose an invited player and event before marking them unavailable.')
  }

  if (normalizedEventType === 'training' && !normalizedOccurrenceDate) {
    throw new Error('Choose a training occurrence before marking a player unavailable.')
  }

  const { data, error } = await supabase.rpc('mark_event_player_unavailable_on_behalf', {
    event_id_value: normalizedEventId,
    event_type_value: normalizedEventType,
    occurrence_date_value: normalizedEventType === 'training' ? normalizedOccurrenceDate : null,
    player_id_value: normalizedPlayerId,
  })

  if (error) {
    console.error(error)
    throw error
  }

  clearViewCaches()
  invalidateMemoryCacheByPrefix('match-day:')
  invalidateMemoryCacheByPrefix(`calendar-events:${user.clubId}:`)

  return {
    changed: data?.changed === true,
    eventId: normalizeText(data?.eventId) || normalizedEventId,
    eventType: normalizeText(data?.eventType) || normalizedEventType,
    occurrenceDate: normalizeText(data?.occurrenceDate) || normalizedOccurrenceDate,
    playerId: normalizeText(data?.playerId) || normalizedPlayerId,
    previousStatus: normalizeText(data?.previousStatus) || 'pending',
    respondedAt: data?.respondedAt ?? '',
    responseStatus: normalizeText(data?.responseStatus) || 'unavailable',
    source: normalizeText(data?.source) || 'staff_on_behalf',
  }
}
