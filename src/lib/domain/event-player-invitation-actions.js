import { supabase } from '../supabase-client.js'
import { clearViewCaches, invalidateMemoryCacheByPrefix } from './cache-store.js'
import { blockDemoMutation } from './demo-guards.js'

const SUPPORTED_ACTIONS = new Set(['send', 'resend', 'retry'])
const SUPPORTED_SOURCE_TYPES = new Set(['calendar', 'match-day'])

function normalizeText(value) {
  return String(value ?? '').trim()
}

export async function sendEventPlayerInvitationAction({
  accessToken = '',
  action,
  eventId,
  idempotencyKey,
  occurrenceDate = '',
  playerId,
  preview = false,
  sourceType,
  user,
} = {}) {
  await blockDemoMutation(user)

  const normalizedAction = normalizeText(action).toLowerCase()
  const normalizedEventId = normalizeText(eventId)
  const normalizedIdempotencyKey = normalizeText(idempotencyKey)
  const normalizedPlayerId = normalizeText(playerId)
  const normalizedSourceType = normalizeText(sourceType).toLowerCase()

  if (
    !user?.clubId
    || user.role === 'parent_portal'
    || user.role === 'super_admin'
    || Number(user.roleRank ?? 0) < 20
  ) {
    throw new Error('Authorised team staff access is required.')
  }

  if (!SUPPORTED_ACTIONS.has(normalizedAction)) {
    throw new Error('Choose Send, Resend, or Retry invitation.')
  }

  if (!SUPPORTED_SOURCE_TYPES.has(normalizedSourceType)) {
    throw new Error('This event does not support a direct response invitation.')
  }

  if (!normalizedEventId || !normalizedPlayerId || !normalizedIdempotencyKey) {
    throw new Error('Choose one event and player before sending an invitation.')
  }

  let resolvedAccessToken = normalizeText(accessToken)

  if (!resolvedAccessToken) {
    const { data: sessionData, error: sessionError } = await supabase.auth.getSession()
    resolvedAccessToken = normalizeText(sessionData?.session?.access_token)

    if (sessionError || !resolvedAccessToken) {
      throw sessionError || new Error('Sign in again before sending an invitation.')
    }
  }

  const response = await fetch('/.netlify/functions/send-event-player-invitation', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${resolvedAccessToken}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      action: normalizedAction,
      eventId: normalizedEventId,
      idempotencyKey: normalizedIdempotencyKey,
      occurrenceDate: normalizeText(occurrenceDate),
      playerId: normalizedPlayerId,
      preview: preview === true,
      sourceType: normalizedSourceType,
    }),
  })
  const result = await response.json().catch(() => ({}))

  if (!response.ok || result?.success === false) {
    throw new Error(result?.message || 'The invitation action could not be completed.')
  }

  clearViewCaches()
  invalidateMemoryCacheByPrefix('match-day:')
  invalidateMemoryCacheByPrefix(`calendar-events:${user.clubId}:`)

  return {
    action: normalizedAction,
    duplicate: result?.duplicate === true,
    failedCount: Number(result?.failedCount ?? 0),
    lastSentAt: normalizeText(result?.lastSentAt),
    playerId: normalizeText(result?.playerId) || normalizedPlayerId,
    preview: result?.preview === true,
    queuedAt: normalizeText(result?.queuedAt),
    recipientCount: Number(result?.recipientCount ?? result?.queuedCount ?? 0),
    recipients: Array.isArray(result?.recipients)
      ? result.recipients.map((recipient) => ({
          address: normalizeText(recipient?.address),
          type: normalizeText(recipient?.type),
        })).filter((recipient) => recipient.address)
      : [],
    requestState: normalizeText(result?.requestState),
    sourceType: normalizedSourceType,
  }
}
