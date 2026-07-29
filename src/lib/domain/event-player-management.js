import { supabase } from '../supabase-client.js'
import { clearViewCaches, invalidateMemoryCacheByPrefix } from './cache-store.js'
import { blockDemoMutation } from './demo-guards.js'

export const EVENT_PLAYER_COMMUNICATION_MODES = Object.freeze({
  none: 'none',
  notifyAdded: 'notify_added',
  notifyRemoved: 'notify_removed',
  resendAll: 'resend_all',
})

const SUPPORTED_COMMUNICATION_MODES = new Set(Object.values(EVENT_PLAYER_COMMUNICATION_MODES))
const SUPPORTED_SOURCE_TYPES = new Set(['calendar', 'match-day', 'session'])

function normalizeText(value) {
  return String(value ?? '').trim()
}

function normalizeIdList(values) {
  return [...new Set(
    (Array.isArray(values) ? values : [])
      .map((value) => normalizeText(value))
      .filter(Boolean),
  )]
}

function assertStaffAccess(user) {
  if (
    !user?.clubId
    || user.role === 'parent_portal'
    || user.role === 'super_admin'
    || Number(user.roleRank ?? 0) < 20
  ) {
    throw new Error('Coach or manager access is required to manage event players.')
  }
}

function getSourceValues({ eventId, sourceType }) {
  const normalizedEventId = normalizeText(eventId)
  const normalizedSourceType = normalizeText(sourceType).toLowerCase()

  if (!normalizedEventId || !SUPPORTED_SOURCE_TYPES.has(normalizedSourceType)) {
    throw new Error('Choose a supported saved event before managing players.')
  }

  return {
    eventId: normalizedEventId,
    sourceType: normalizedSourceType,
  }
}

function normalizePreview(data = {}) {
  return {
    eventId: normalizeText(data.eventId),
    sourceType: normalizeText(data.sourceType),
    eventType: normalizeText(data.eventType),
    teamId: normalizeText(data.teamId),
    currentPlayerIds: normalizeIdList(data.currentPlayerIds),
    selectedPlayerIds: normalizeIdList(data.selectedPlayerIds),
    addedPlayerIds: normalizeIdList(data.addedPlayerIds),
    removedPlayerIds: normalizeIdList(data.removedPlayerIds),
    unchangedPlayerIds: normalizeIdList(data.unchangedPlayerIds),
    selectedRemovalPlayerIds: normalizeIdList(data.selectedRemovalPlayerIds),
    addedRecipientCount: Number(data.addedRecipientCount ?? 0),
    removedRecipientCount: Number(data.removedRecipientCount ?? 0),
    currentRecipientCount: Number(data.currentRecipientCount ?? 0),
    addedMissingContactPlayerIds: normalizeIdList(data.addedMissingContactPlayerIds),
    removedMissingContactPlayerIds: normalizeIdList(data.removedMissingContactPlayerIds),
    currentMissingContactPlayerIds: normalizeIdList(data.currentMissingContactPlayerIds),
  }
}

function getAccessToken(sessionData) {
  return normalizeText(sessionData?.session?.access_token)
}

async function sendMatchCommunication({
  addedPlayerIds,
  eventId,
  mode,
  requestToken,
}) {
  if (
    mode !== EVENT_PLAYER_COMMUNICATION_MODES.notifyAdded
    && mode !== EVENT_PLAYER_COMMUNICATION_MODES.resendAll
  ) {
    return null
  }

  const { data: sessionData, error: sessionError } = await supabase.auth.getSession()
  const accessToken = getAccessToken(sessionData)

  if (sessionError || !accessToken) {
    throw sessionError || new Error('Sign in again before sending availability invitations.')
  }

  const response = await fetch('/.netlify/functions/send-match-day-availability-requests', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${accessToken}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(mode === EVENT_PLAYER_COMMUNICATION_MODES.resendAll
      ? {
          matchDayId: eventId,
          notificationRequestToken: requestToken,
          source: 'calendar_edit',
        }
      : {
          matchDayId: eventId,
          playerIds: addedPlayerIds,
        }),
  })
  const result = await response.json().catch(() => ({}))

  if (!response.ok || result?.success === false) {
    throw new Error(result?.message || 'Match availability invitations could not be queued.')
  }

  return {
    duplicateCount: Number(result.duplicateCount ?? result.duplicateQueueCount ?? 0),
    failedCount: Number(result.failedCount ?? 0),
    missingContactCount: Number(result.missingContactCount ?? 0),
    queuedCount: Number(result.queuedCount ?? result.sentCount ?? 0),
  }
}

export function getEventPlayerManagementLabel(eventType = '') {
  const normalizedEventType = normalizeText(eventType).toLowerCase()

  if (normalizedEventType === 'match') {
    return 'Manage invited players'
  }

  if (normalizedEventType === 'training') {
    return 'Manage players'
  }

  return 'Manage participants'
}

export function getEventPlayerCommunicationRecipientCount(preview, mode) {
  if (mode === EVENT_PLAYER_COMMUNICATION_MODES.notifyAdded) {
    return Number(preview?.addedRecipientCount ?? 0)
  }

  if (mode === EVENT_PLAYER_COMMUNICATION_MODES.notifyRemoved) {
    return Number(preview?.removedRecipientCount ?? 0)
  }

  if (mode === EVENT_PLAYER_COMMUNICATION_MODES.resendAll) {
    return Number(preview?.currentRecipientCount ?? 0)
  }

  return 0
}

export function getEventPlayerCommunicationMissingIds(preview, mode) {
  if (mode === EVENT_PLAYER_COMMUNICATION_MODES.notifyAdded) {
    return normalizeIdList(preview?.addedMissingContactPlayerIds)
  }

  if (mode === EVENT_PLAYER_COMMUNICATION_MODES.notifyRemoved) {
    return normalizeIdList(preview?.removedMissingContactPlayerIds)
  }

  if (mode === EVENT_PLAYER_COMMUNICATION_MODES.resendAll) {
    return normalizeIdList(preview?.currentMissingContactPlayerIds)
  }

  return []
}

export async function previewEventPlayerChanges({
  eventId,
  selectedPlayerIds = [],
  sourceType,
  user,
} = {}) {
  assertStaffAccess(user)
  const source = getSourceValues({ eventId, sourceType })
  const { data, error } = await supabase.rpc('preview_event_player_changes', {
    event_id_value: source.eventId,
    selected_player_ids_value: normalizeIdList(selectedPlayerIds),
    source_type_value: source.sourceType,
  })

  if (error) {
    console.error(error)
    throw error
  }

  return normalizePreview(data)
}

export async function applyEventPlayerChanges({
  communicationMode = EVENT_PLAYER_COMMUNICATION_MODES.none,
  confirmSelectedRemovals = false,
  eventId,
  requestToken,
  selectedPlayerIds = [],
  sourceType,
  user,
} = {}) {
  await blockDemoMutation(user)
  assertStaffAccess(user)
  const source = getSourceValues({ eventId, sourceType })
  const normalizedMode = normalizeText(communicationMode).toLowerCase()
  const normalizedRequestToken = normalizeText(requestToken)

  if (!SUPPORTED_COMMUNICATION_MODES.has(normalizedMode)) {
    throw new Error('Choose a supported event communication option.')
  }

  if (!normalizedRequestToken) {
    throw new Error('Start a new player-management request before saving.')
  }

  const { data, error } = await supabase.rpc('apply_event_player_changes', {
    communication_mode_value: normalizedMode,
    confirm_selected_removals_value: confirmSelectedRemovals === true,
    event_id_value: source.eventId,
    request_token_value: normalizedRequestToken,
    selected_player_ids_value: normalizeIdList(selectedPlayerIds),
    source_type_value: source.sourceType,
  })

  if (error) {
    console.error(error)
    throw error
  }

  const result = {
    ...normalizePreview(data),
    commandId: normalizeText(data?.commandId),
    communicationMode: normalizeText(data?.communicationMode) || normalizedMode,
    duplicate: data?.duplicate === true,
    failedCount: Number(data?.failedCount ?? 0),
    missingContactCount: Number(data?.missingContactCount ?? 0),
    queuedCount: Number(data?.queuedCount ?? 0),
  }

  if (source.sourceType === 'match-day') {
    const matchDelivery = await sendMatchCommunication({
      addedPlayerIds: result.addedPlayerIds,
      eventId: source.eventId,
      mode: normalizedMode,
      requestToken: normalizedRequestToken,
    })

    if (matchDelivery) {
      result.duplicateCount = matchDelivery.duplicateCount
      result.failedCount += matchDelivery.failedCount
      result.missingContactCount = Math.max(result.missingContactCount, matchDelivery.missingContactCount)
      result.queuedCount += matchDelivery.queuedCount
    }
  }

  clearViewCaches()
  invalidateMemoryCacheByPrefix(`calendar-events:${user.clubId}:`)
  invalidateMemoryCacheByPrefix(`assessment-sessions:${user.clubId}:`)
  invalidateMemoryCacheByPrefix(`match-days:${user.clubId}:`)

  return result
}
