import { supabase } from '../supabase-client.js'
import { clearViewCaches, invalidateMemoryCacheByPrefix } from './cache-store.js'
import { blockDemoMutation } from './demo-guards.js'

export const EVENT_PLAYER_REMOVAL_SCOPES = Object.freeze({
  event: 'event',
  occurrence: 'occurrence',
  thisAndFuture: 'this_and_future',
})

const SUPPORTED_SOURCE_TYPES = new Set(['calendar', 'match-day'])
const SUPPORTED_SCOPES = new Set(Object.values(EVENT_PLAYER_REMOVAL_SCOPES))

function normalizeText(value) {
  return String(value ?? '').trim()
}

function normalizeCount(value) {
  const count = Number(value ?? 0)
  return Number.isFinite(count) && count >= 0 ? Math.trunc(count) : 0
}

function assertStaffAccess(user) {
  if (
    !user?.clubId
    || user.role === 'parent_portal'
    || user.role === 'super_admin'
    || Number(user.roleRank ?? 0) < 20
  ) {
    throw new Error('Coach or manager access is required to remove a Player from an event.')
  }
}

function normalizeRequest({
  eventId,
  occurrenceDate,
  playerId,
  scope,
  sourceType,
} = {}) {
  const normalized = {
    eventId: normalizeText(eventId),
    occurrenceDate: normalizeText(occurrenceDate) || null,
    playerId: normalizeText(playerId),
    scope: normalizeText(scope).toLowerCase(),
    sourceType: normalizeText(sourceType).toLowerCase(),
  }

  if (!normalized.eventId || !normalized.playerId || !SUPPORTED_SOURCE_TYPES.has(normalized.sourceType)) {
    throw new Error('Choose a supported saved event and Player before removing participation.')
  }

  if (!SUPPORTED_SCOPES.has(normalized.scope)) {
    throw new Error('Choose a supported event removal scope.')
  }

  if (
    normalized.sourceType === 'calendar'
    && normalized.scope !== EVENT_PLAYER_REMOVAL_SCOPES.event
    && !/^\d{4}-\d{2}-\d{2}$/.test(normalized.occurrenceDate || '')
  ) {
    throw new Error('Choose the recurring event occurrence to remove.')
  }

  return normalized
}

function normalizeResult(data = {}) {
  return {
    ...data,
    affectedOccurrenceCount: normalizeCount(data.affectedOccurrenceCount),
    suppressedInvitationCount: normalizeCount(data.suppressedInvitationCount),
    revokedTokenCount: normalizeCount(data.revokedTokenCount),
    alreadyRemoved: data.alreadyRemoved === true,
    communicationSent: data.communicationSent === true,
    communicationWillBeSent: data.communicationWillBeSent === true,
    duplicate: data.duplicate === true,
    historyPreserved: data.historyPreserved === true,
    playerRecordPreserved: data.playerRecordPreserved === true,
    recurring: data.recurring === true,
    requiresInProgressConfirmation: data.requiresInProgressConfirmation === true,
    teamMembershipUnchanged: data.teamMembershipUnchanged === true,
  }
}

export async function previewEventPlayerRemoval({ user, ...values } = {}) {
  assertStaffAccess(user)
  const request = normalizeRequest(values)
  const { data, error } = await supabase.rpc('preview_event_player_removal', {
    event_id_value: request.eventId,
    occurrence_date_value: request.occurrenceDate,
    player_id_value: request.playerId,
    scope_value: request.scope,
    source_type_value: request.sourceType,
  })

  if (error) {
    console.error(error)
    throw error
  }

  return normalizeResult(data)
}

export async function removePlayerFromEvent({
  confirmInProgress = false,
  requestToken,
  user,
  ...values
} = {}) {
  await blockDemoMutation(user)
  assertStaffAccess(user)
  const request = normalizeRequest(values)
  const normalizedRequestToken = normalizeText(requestToken)

  if (!normalizedRequestToken) {
    throw new Error('Start a new event removal request before confirming.')
  }

  const { data, error } = await supabase.rpc('remove_player_from_event', {
    confirm_in_progress_value: confirmInProgress === true,
    event_id_value: request.eventId,
    occurrence_date_value: request.occurrenceDate,
    player_id_value: request.playerId,
    request_token_value: normalizedRequestToken,
    scope_value: request.scope,
    source_type_value: request.sourceType,
  })

  if (error) {
    console.error(error)
    throw error
  }

  clearViewCaches()
  invalidateMemoryCacheByPrefix(`calendar-events:${user.clubId}:`)
  invalidateMemoryCacheByPrefix(`assessment-sessions:${user.clubId}:`)
  invalidateMemoryCacheByPrefix(`match-days:${user.clubId}:`)

  return normalizeResult(data)
}
