import process from 'node:process'
import { createHash, randomBytes, randomUUID } from 'node:crypto'
import { createFromAddress } from './lib/_email-provider.js'
import { assertTrustedSystemPlanFeature, getClubPlanProfile } from './lib/_plan-gate.js'
import { createSupabaseAdminClient } from './lib/_supabase.js'
import { getTrainingAvailabilitySendGate } from './lib/_training-availability-send-gate.js'
import { authorizeNativeScheduledRequest } from './lib/_processor-auth.js'
import { resolveEligibleEventInvitationContacts } from './lib/_match-day-actionable-invitation.js'
import { buildEmailLogoMarkup, buildEventMapLinksMarkup } from '../../src/lib/email-branding.js'
import { resolveTeamNotificationDisplayName } from '../../src/lib/team-notification-display.js'
import {
  buildOccurrences,
  formatLondonDateLabel,
  getTrainingCalendarSummary,
} from './lib/_training-calendar.js'

export {
  buildOccurrences,
  buildTrainingAvailabilityCalendarIcs,
} from './lib/_training-calendar.js'

export const TRAINING_AVAILABILITY_PROCESSOR_DEFAULTS = Object.freeze({
  batchSize: 8,
  leaseSeconds: 45,
  minimumStartBudgetMs: 1500,
  recurrenceMutationLimit: 8,
  retryDelayMs: 60_000,
  runtimeBudgetMs: 20_000,
  sendGateRetryDelayMs: 300_000,
})

function normalizeText(value) {
  return String(value ?? '').trim()
}

function isOccurrenceExcluded(exclusions = [], occurrenceDate = '', playerId = '') {
  const normalizedOccurrenceDate = normalizeText(occurrenceDate)
  const normalizedPlayerId = normalizeText(playerId)

  return (exclusions ?? []).some((exclusion) => {
    if (normalizeText(exclusion.player_id) !== normalizedPlayerId) {
      return false
    }

    const effectiveFromDate = normalizeText(exclusion.effective_from_date)
    return exclusion.scope === 'occurrence'
      ? effectiveFromDate === normalizedOccurrenceDate
      : exclusion.scope === 'this_and_future' && effectiveFromDate <= normalizedOccurrenceDate
  })
}

function normalizeSafeCode(value, fallback = 'TRAINING_AVAILABILITY_PROCESSOR_FAILED') {
  const code = normalizeText(value || fallback)
    .toUpperCase()
    .replace(/[^A-Z0-9_:-]+/g, '_')
    .slice(0, 120)

  return code || fallback
}

function addMilliseconds(value, milliseconds) {
  return new Date(new Date(value).getTime() + Number(milliseconds || 0))
}

function timestampsMatch(left, right) {
  const leftTime = new Date(left || '').getTime()
  const rightTime = new Date(right || '').getTime()
  return Number.isNaN(leftTime) && Number.isNaN(rightTime)
    ? normalizeText(left) === normalizeText(right)
    : leftTime === rightTime
}

export function hasTrainingAvailabilityRuntimeBudget({
  nowMs = Date.now(),
  startedAtMs,
  minimumStartBudgetMs = TRAINING_AVAILABILITY_PROCESSOR_DEFAULTS.minimumStartBudgetMs,
  runtimeBudgetMs = TRAINING_AVAILABILITY_PROCESSOR_DEFAULTS.runtimeBudgetMs,
} = {}) {
  return Number(nowMs) - Number(startedAtMs) + Number(minimumStartBudgetMs) < Number(runtimeBudgetMs)
}

function normalizeEmail(value) {
  return normalizeText(value).toLowerCase()
}

function isValidEmail(value) {
  return /^[^\s@<>]+@[^\s@<>]+\.[^\s@<>]+$/.test(normalizeText(value))
}

function hashToken(token) {
  return createHash('sha256').update(token).digest('hex')
}

export function getReusableTrainingResponseToken(existing, existingQueue) {
  const token = normalizeText(existingQueue?.payload?.trainingInvitation?.rawToken).toLowerCase()
  const expectedHash = normalizeText(existing?.token_hash).toLowerCase()

  if (
    existing?.token_revoked_at
    || !/^[a-f0-9]{64}$/.test(token)
    || !/^[a-f0-9]{64}$/.test(expectedHash)
    || hashToken(token) !== expectedHash
  ) {
    return ''
  }

  return token
}

function createDeterministicUuid(value) {
  const hash = createHash('sha256').update(String(value ?? '')).digest('hex')
  return `${hash.slice(0, 8)}-${hash.slice(8, 12)}-5${hash.slice(13, 16)}-a${hash.slice(17, 20)}-${hash.slice(20, 32)}`
}

function escapeHtml(value) {
  return normalizeText(value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')
}

function getAppOrigin(event = {}) {
  const host = event.headers?.['x-forwarded-host'] || event.headers?.host || 'footballplayer.online'
  const protocol = event.headers?.['x-forwarded-proto'] || 'https'
  return `${protocol}://${host}`.replace(/\/$/, '') || normalizeText(process.env.VITE_APP_URL || process.env.URL).replace(/\/$/, '')
}

function addDays(date, days) {
  const nextDate = new Date(date)
  nextDate.setDate(date.getDate() + days)
  return nextDate
}

function getSendAt(occurrence, setting) {
  return addDays(occurrence.occurrenceStartsAt, -Number(setting.send_days_before ?? 2))
}

export function getPlayerContacts({ parentLinks = [], player }) {
  const contactType = normalizeText(player.contact_type || 'parent').toLowerCase()
  const directEmail = normalizeEmail(player.parent_email)

  if (contactType === 'self') {
    return isValidEmail(directEmail)
      ? [{
          email: directEmail,
          name: normalizeText(player.player_name),
          parentLinkId: null,
          type: 'player',
        }]
      : []
  }

  const linkedContacts = parentLinks
    .filter((link) => String(link.player_id) === String(player.id))
    .map((link) => ({
      email: normalizeEmail(link.email),
      name: normalizeText(link.parent_name || link.display_name || link.email),
      parentLinkId: link.id,
      type: 'parent',
    }))
    .filter((contact) => isValidEmail(contact.email))

  if (linkedContacts.length > 0) {
    return linkedContacts
  }

  return isValidEmail(directEmail)
    ? [{
        email: directEmail,
        name: normalizeText(player.parent_name || player.player_name),
        parentLinkId: null,
        type: 'parent',
      }]
    : []
}

function formatDateTime(value) {
  const parsedDate = new Date(value)

  if (Number.isNaN(parsedDate.getTime())) {
    return 'Time to be confirmed'
  }

  return new Intl.DateTimeFormat('en-GB', {
    dateStyle: 'medium',
    timeStyle: 'short',
    timeZone: 'Europe/London',
  }).format(parsedDate)
}

function buildCalendarDownloadUrl(responseUrl) {
  try {
    const calendarUrl = new URL(responseUrl)
    calendarUrl.searchParams.set('download', 'calendar')
    return calendarUrl.toString()
  } catch {
    return ''
  }
}

function buildCalendarActionHtml({ calendarUrl, event, occurrences = [], showScheduleSummary, teamName }) {
  if (!calendarUrl) {
    return ''
  }

  const summary = getTrainingCalendarSummary({ event, occurrences })
  const showOccurrences = showScheduleSummary && (
    summary.occurrenceCount > 1
    || normalizeText(event.recurrence_frequency ?? event.recurrenceFrequency) !== 'none'
  )
  const occurrenceMarkup = showOccurrences
    ? `
      <p style="margin:0 0 8px;color:#047857;font-size:12px;font-weight:900;letter-spacing:0.14em;text-transform:uppercase;">Upcoming sessions</p>
      <p style="margin:0 0 10px;color:#4b5f55;font-size:14px;line-height:1.5;font-weight:700;">Add the complete approved schedule to your calendar, then answer this availability request for this session only.</p>
      <ul style="margin:0 0 8px 18px;padding:0;color:#101828;font-size:14px;line-height:1.6;font-weight:800;">
        ${summary.displayedOccurrences.map((item) => `<li>${escapeHtml(formatLondonDateLabel(item.occurrenceStartsAt))}</li>`).join('')}
      </ul>
      ${summary.continuation ? `<p style="margin:0 0 12px;color:#4b5f55;font-size:14px;line-height:1.5;font-weight:800;">${escapeHtml(summary.continuation)}</p>` : ''}
    `
    : `<p style="margin:0 0 10px;color:#4b5f55;font-size:14px;line-height:1.5;font-weight:700;">Add ${escapeHtml(event.title || teamName || 'this training event')} to your calendar.</p>`

  return `
    <div style="border:1px solid #d7e5dc;border-radius:12px;background:#f7faf8;padding:14px 16px;margin:0 0 22px;">
      ${occurrenceMarkup}
      <a href="${escapeHtml(calendarUrl)}" target="_blank" rel="noopener noreferrer" style="display:inline-block;margin:0 0 4px;padding:10px 12px;border:1px solid #047857;color:#047857;text-decoration:none;border-radius:8px;font-weight:900;">${escapeHtml(summary.actionLabel)}</a>
    </div>
  `
}

export function shouldIncludeRecurringSchedule({ occurrence, occurrences = [] } = {}) {
  const firstOccurrence = occurrences[0]
  return Boolean(
    firstOccurrence
      && occurrences.length > 1
      && occurrence?.occurrenceDate
      && firstOccurrence.occurrenceDate === occurrence.occurrenceDate,
  )
}

export function buildAvailabilityEmail({ appOrigin, event, includeRecurringSchedule = false, occurrence, occurrences = [], player, recipient, responseUrl, teamName }) {
  const subject = `Training availability: ${event.title || teamName || 'Training session'}`
  const calendarHtml = buildCalendarActionHtml({
    calendarUrl: buildCalendarDownloadUrl(responseUrl),
    event,
    occurrences,
    showScheduleSummary: includeRecurringSchedule,
    teamName,
  })
  const club = Array.isArray(event.clubs) ? event.clubs[0] : event.clubs
  const clubName = normalizeText(club?.name || 'Football Player')
  const logoMarkup = buildEmailLogoMarkup({
    altText: clubName,
    clubLogoUrl: normalizeText(club?.logo_url),
    origin: appOrigin,
  })
  const mapLinksMarkup = buildEventMapLinksMarkup(event.location)

  return {
    subject,
    html: `
      <div style="font-family:Arial,sans-serif;max-width:620px;margin:0 auto;padding:24px;color:#101828;">
        ${logoMarkup}
        <p style="margin:0 0 8px;color:#047857;font-size:12px;font-weight:900;letter-spacing:0.16em;text-transform:uppercase;">Training availability</p>
        <h1 style="margin:0 0 12px;font-size:26px;line-height:1.15;">Can ${escapeHtml(player.player_name || 'your child')} attend?</h1>
        <p style="margin:0 0 20px;color:#4b5f55;font-size:15px;line-height:1.6;">
          Please confirm availability for this training session.
        </p>
        <p style="margin:0 0 20px;color:#4b5f55;font-size:14px;line-height:1.5;font-weight:700;">
          This availability response is for this session only.
        </p>
        <table style="width:100%;border-collapse:collapse;margin:0 0 22px;">
          <tr><td style="padding:8px 0;color:#4b5f55;font-weight:700;">Team</td><td style="padding:8px 0;color:#101828;font-weight:800;">${escapeHtml(teamName || 'Team')}</td></tr>
          <tr><td style="padding:8px 0;color:#4b5f55;font-weight:700;">Session</td><td style="padding:8px 0;color:#101828;font-weight:800;">${escapeHtml(event.title || 'Training session')}</td></tr>
          <tr><td style="padding:8px 0;color:#4b5f55;font-weight:700;">When</td><td style="padding:8px 0;color:#101828;font-weight:800;">${escapeHtml(formatDateTime(occurrence.occurrenceStartsAt))}</td></tr>
          <tr><td style="padding:8px 0;color:#4b5f55;font-weight:700;">Location</td><td style="padding:8px 0;color:#101828;font-weight:800;">${escapeHtml(event.location || 'Not set')}</td></tr>
        </table>
        ${mapLinksMarkup}
        ${calendarHtml}
        <a href="${escapeHtml(responseUrl)}" style="display:inline-block;margin:0 8px 8px 0;padding:12px 16px;background:#047857;color:#ffffff;text-decoration:none;border-radius:8px;font-weight:900;">Open response form</a>
        <p style="margin:12px 0 0;color:#4b5f55;font-size:13px;line-height:1.5;font-weight:700;">
          Please respond before ${escapeHtml(formatDateTime(occurrence.occurrenceStartsAt))}.
        </p>
        <p style="margin:20px 0 0;color:#64748b;font-size:12px;line-height:1.5;">
          This link is unique to ${escapeHtml(recipient.email)}. Do not forward it.
        </p>
      </div>
    `,
  }
}

async function loadRecurrenceSetting({ supabase, work }) {
  const { data, error } = await supabase
    .from('training_availability_settings')
    .select('*, calendar_events:calendar_event_id(id, club_id, team_id, event_type, title, starts_at, ends_at, recurrence_frequency, recurrence_until, location, notes, cancelled_at, teams:team_id(name,notification_display_name), clubs:club_id(name, logo_url))')
    .eq('id', work.setting_id)
    .maybeSingle()

  if (error) {
    throw error
  }

  return data
}

export function getReconciledRequestSendAt({
  existingRequest,
  now = new Date(),
  scheduledSendAt,
}) {
  const existingSendAt = new Date(existingRequest?.send_at || '')
  const currentTime = now instanceof Date ? now : new Date(now)
  const automaticSendAt = scheduledSendAt instanceof Date ? scheduledSendAt : new Date(scheduledSendAt)
  const preserveEligibleQueue = normalizeText(existingRequest?.status) === 'queued'
    && !Number.isNaN(existingSendAt.getTime())
    && !Number.isNaN(currentTime.getTime())
    && existingSendAt.getTime() <= currentTime.getTime()

  return preserveEligibleQueue ? existingSendAt : automaticSendAt
}

async function upsertDueRequest({ existingRequest: providedRequest, occurrence, sendAt, setting, supabase }) {
  const event = Array.isArray(setting.calendar_events) ? setting.calendar_events[0] : setting.calendar_events
  let existingRequest = providedRequest

  if (providedRequest === undefined) {
    const { data, error } = await supabase
      .from('training_availability_requests')
      .select('*')
      .eq('calendar_event_id', setting.calendar_event_id)
      .eq('occurrence_date', occurrence.occurrenceDate)
      .maybeSingle()

    if (error) {
      throw error
    }

    existingRequest = data
  }

  if (existingRequest?.id) {
    if (['pending', 'queued', 'partial_failed'].includes(normalizeText(existingRequest.status))) {
      const reconciledSendAt = getReconciledRequestSendAt({
        existingRequest,
        scheduledSendAt: sendAt,
      })
      const intended = {
        setting_id: setting.id,
        club_id: setting.club_id,
        team_id: setting.team_id,
        occurrence_starts_at: occurrence.occurrenceStartsAt.toISOString(),
        occurrence_ends_at: occurrence.occurrenceEndsAt?.toISOString() || null,
        send_at: reconciledSendAt.toISOString(),
      }
      const unchanged = Object.entries(intended).every(([key, value]) => (
        ['occurrence_starts_at', 'occurrence_ends_at', 'send_at'].includes(key)
          ? timestampsMatch(existingRequest[key], value)
          : normalizeText(existingRequest[key]) === normalizeText(value)
      ))

      if (unchanged) {
        return {
          event,
          mutation: 'no-op',
          request: existingRequest,
          sendAt: new Date(existingRequest.send_at || reconciledSendAt),
        }
      }

      const { data: reconciledRequest, error: reconcileError } = await supabase
        .from('training_availability_requests')
        .update(intended)
        .eq('id', existingRequest.id)
        .select('*')
        .single()

      if (reconcileError) {
        throw reconcileError
      }

      return {
        event,
        mutation: 'updated',
        request: reconciledRequest,
        sendAt: new Date(reconciledRequest.send_at || reconciledSendAt),
      }
    }

    return {
      event,
      mutation: 'no-op',
      request: existingRequest,
      sendAt: new Date(existingRequest.send_at || sendAt),
    }
  }

  const { data, error } = await supabase
    .from('training_availability_requests')
    .insert({
      setting_id: setting.id,
      club_id: setting.club_id,
      team_id: setting.team_id,
      calendar_event_id: setting.calendar_event_id,
      occurrence_date: occurrence.occurrenceDate,
      occurrence_starts_at: occurrence.occurrenceStartsAt.toISOString(),
      occurrence_ends_at: occurrence.occurrenceEndsAt?.toISOString() || null,
      send_at: sendAt.toISOString(),
      status: 'pending',
      generated_at: new Date().toISOString(),
    })
    .select('*')
    .single()

  if (error) {
    throw error
  }

  return {
    event,
    mutation: 'created',
    request: data,
    sendAt,
  }
}

async function findExistingRecipient({ requestId, playerId, recipientEmail, supabase }) {
  const { data, error } = await supabase
    .from('training_availability_request_players')
    .select('*')
    .eq('request_id', requestId)
    .eq('player_id', playerId)
    .eq('recipient_email', recipientEmail)
    .maybeSingle()

  if (error) {
    throw error
  }

  return data
}

async function createUnavailableRecipient({ player, request, supabase }) {
  const existing = await findExistingRecipient({
    requestId: request.id,
    playerId: player.id,
    recipientEmail: '',
    supabase,
  })

  if (existing?.id) {
    return { created: false, requestPlayer: existing }
  }

  const { data, error } = await supabase
    .from('training_availability_request_players')
    .insert({
      request_id: request.id,
      club_id: request.club_id,
      team_id: request.team_id,
      calendar_event_id: request.calendar_event_id,
      player_id: player.id,
      player_name: normalizeText(player.player_name),
      parent_link_id: null,
      recipient_email: '',
      recipient_name: '',
      recipient_type: 'unavailable',
      token_hash: hashToken(randomBytes(32).toString('hex')),
      status: 'failed',
      last_error: 'No eligible parent or adult-player recipient is available.',
      invitation_type: 'training_rsvp',
      response_deadline_at: request.occurrence_starts_at,
    })
    .select('*')
    .single()

  if (error) {
    throw error
  }

  return { created: true, requestPlayer: data }
}

export function getTrainingInvitationQueueId({
  deliveryAttempt,
  eventId,
  invitationType = 'training_rsvp',
  occurrenceDate,
  playerId,
  recipientEmail,
}) {
  return createDeterministicUuid([
    'training-availability',
    eventId,
    occurrenceDate,
    playerId,
    normalizeEmail(recipientEmail),
    invitationType,
    Number(deliveryAttempt || 1),
  ].join(':'))
}

export function buildTrainingInvitationQueuePayload({
  appOrigin,
  deliveryAttempt,
  event,
  invitationType = 'training_rsvp',
  occurrence,
  occurrences,
  player,
  recipient,
  request,
  requestPlayerId = null,
  teamName,
  token,
}) {
  const responseUrl = `${appOrigin}/.netlify/functions/training-availability-response?token=${token}`
  const email = buildAvailabilityEmail({
    appOrigin,
    event,
    includeRecurringSchedule: shouldIncludeRecurringSchedule({ occurrence, occurrences }),
    occurrence,
    occurrences,
    player,
    recipient,
    responseUrl,
    teamName,
  })
  const enqueuedAt = new Date().toISOString()

  return {
    displayName: 'Football Player',
    teamName,
    clubName: normalizeText((Array.isArray(event.clubs) ? event.clubs[0] : event.clubs)?.name),
    actorRole: 'system',
    clubId: request.club_id,
    teamId: request.team_id,
    playerId: player.id,
    playerName: normalizeText(player.player_name),
    deliveryTelemetry: {
      originActionAt: request.generated_at || request.created_at || enqueuedAt,
      eligibleAt: request.send_at,
      enqueuedAt,
      scheduledAt: request.send_at,
    },
    requiredFeature: 'parentEmails',
    resendPayload: {
      from: createFromAddress('Football Player'),
      to: [recipient.email],
      subject: email.subject,
      html: email.html,
    },
    trainingInvitation: {
      version: 1,
      requestId: request.id,
      requestPlayerId,
      eventId: request.calendar_event_id,
      occurrenceDate: occurrence.occurrenceDate,
      playerId: player.id,
      recipientEmail: recipient.email,
      parentLinkId: recipient.parentLinkId,
      recipientType: recipient.type,
      rawToken: token,
      tokenHash: hashToken(token),
      invitationType,
      deliveryAttempt,
      responseDeadlineAt: occurrence.occurrenceStartsAt.toISOString(),
    },
  }
}

export async function queueTrainingInvitationRecipient({
  action = 'automatic',
  appOrigin,
  event,
  occurrence,
  occurrences,
  player,
  recipient,
  request,
  supabase,
  teamName,
}) {
  const existing = await findExistingRecipient({
    requestId: request.id,
    playerId: player.id,
    recipientEmail: recipient.email,
    supabase,
  })
  const currentStatus = normalizeText(existing?.status)

  if (action === 'automatic' && ['sent', 'responded'].includes(currentStatus)) {
    return { status: 'skipped', mutation: 'no-op', terminal: true, requestPlayer: existing }
  }

  if (action === 'automatic' && currentStatus === 'failed') {
    return { status: 'failed', mutation: 'no-op', terminal: true, requestPlayer: existing }
  }

  let existingQueue = null

  if (existing?.email_queue_id) {
    const { data, error } = await supabase
      .from('scheduled_email_queue')
      .select('*')
      .eq('id', existing.email_queue_id)
      .maybeSingle()

    if (error) {
      throw error
    }

    existingQueue = data

    if (existingQueue?.status === 'sending') {
      if (action === 'automatic') {
        return { status: 'skipped', mutation: 'no-op', requestPlayer: existing, queue: existingQueue }
      }

      throw Object.assign(new Error('This Training invitation is already being delivered.'), {
        code: 'TRAINING_INVITATION_DELIVERY_IN_PROGRESS',
        statusCode: 409,
      })
    }
  }

  if (
    action === 'automatic'
    && currentStatus === 'queued'
    && existingQueue?.status === 'scheduled'
  ) {
    if (timestampsMatch(existingQueue.scheduled_at, request.send_at)) {
      return {
        status: 'skipped',
        mutation: 'no-op',
        requestPlayer: existing,
        queue: existingQueue,
      }
    }

    const { data: rescheduledQueue, error: rescheduleError } = await supabase
      .from('scheduled_email_queue')
      .update({ scheduled_at: request.send_at })
      .eq('id', existingQueue.id)
      .eq('status', 'scheduled')
      .select('*')
      .maybeSingle()

    if (rescheduleError) {
      throw rescheduleError
    }

    if (!rescheduledQueue?.id) {
      throw Object.assign(new Error('Training invitation queue changed before it could be rescheduled.'), {
        code: 'TRAINING_INVITATION_QUEUE_RACE',
      })
    }

    return {
      status: 'queued',
      mutation: 'updated',
      requestPlayer: existing,
      queue: rescheduledQueue,
    }
  }

  const reusableToken = getReusableTrainingResponseToken(existing, existingQueue)

  if (existing?.id && !reusableToken) {
    if (action === 'automatic') {
      return {
        status: 'failed',
        mutation: 'no-op',
        terminal: true,
        requestPlayer: existing,
        queue: existingQueue,
        errorCode: 'TRAINING_RESPONSE_TOKEN_NOT_REUSABLE',
      }
    }

    throw Object.assign(new Error('The existing Training availability link cannot be reused safely. Revoke it explicitly before issuing a security replacement.'), {
      code: 'TRAINING_RESPONSE_TOKEN_NOT_REUSABLE',
      statusCode: 409,
    })
  }

  const deliveryAttempt = reusableToken
    ? Number(existing?.delivery_attempt || 1)
    : Number(existing?.delivery_attempt || 0) + 1
  const token = reusableToken || randomBytes(32).toString('hex')
  const invitationType = normalizeText(existing?.invitation_type) || 'training_rsvp'
  const queueId = reusableToken
    ? existingQueue.id
    : getTrainingInvitationQueueId({
        deliveryAttempt,
        eventId: event.id,
        invitationType,
        occurrenceDate: occurrence.occurrenceDate,
        playerId: player.id,
        recipientEmail: recipient.email,
      })
  const payload = buildTrainingInvitationQueuePayload({
    appOrigin,
    deliveryAttempt,
    event,
    invitationType,
    occurrence,
    occurrences,
    player,
    recipient,
    request,
    requestPlayerId: existing?.id || null,
    teamName,
    token,
  })
  const queueRecord = {
    id: queueId,
    club_id: request.club_id,
    team_id: request.team_id,
    created_by: null,
    created_by_email: '',
    to_email: recipient.email,
    subject: payload.resendPayload.subject,
    status: 'scheduled',
    scheduled_at: request.send_at,
    payload,
    last_error: null,
    attempts: 0,
  }
  const { error: queueError } = await supabase
    .from('scheduled_email_queue')
    .upsert(queueRecord, { onConflict: 'id' })

  if (queueError) {
    throw queueError
  }

  const requestPlayerRecord = {
    request_id: request.id,
    club_id: request.club_id,
    team_id: request.team_id,
    calendar_event_id: request.calendar_event_id,
    player_id: player.id,
    player_name: normalizeText(player.player_name),
    parent_link_id: normalizeText(recipient.parentLinkId) || null,
    recipient_email: recipient.email,
    recipient_name: recipient.name,
    recipient_type: recipient.type,
    token_hash: hashToken(token),
    status: 'queued',
    last_error: null,
    email_queue_id: queueId,
    delivery_attempt: deliveryAttempt,
    invitation_type: invitationType,
    response_deadline_at: occurrence.occurrenceStartsAt.toISOString(),
    updated_at: new Date().toISOString(),
  }
  const { data: requestPlayer, error: requestPlayerError } = await supabase
    .from('training_availability_request_players')
    .upsert(requestPlayerRecord, {
      onConflict: 'request_id,player_id,recipient_email',
    })
    .select('*')
    .single()

  if (requestPlayerError) {
    throw requestPlayerError
  }

  const finalPayload = {
    ...payload,
    deliveryTelemetry: {
      ...payload.deliveryTelemetry,
      logicalKey: `training_availability_request_player:${requestPlayer.id}:delivery:${deliveryAttempt}`,
      sourceType: 'training_availability_request_player',
      sourceId: requestPlayer.id,
    },
    trainingInvitation: {
      ...payload.trainingInvitation,
      requestPlayerId: requestPlayer.id,
    },
  }
  const { data: finalQueue, error: queueLinkError } = await supabase
    .from('scheduled_email_queue')
    .update({ payload: finalPayload })
    .eq('id', queueId)
    .eq('status', 'scheduled')
    .select('*')
    .maybeSingle()

  if (queueLinkError) {
    throw queueLinkError
  }

  if (!finalQueue?.id) {
    throw Object.assign(new Error('Training invitation queue changed before it could be linked.'), {
      code: 'TRAINING_INVITATION_QUEUE_RACE',
    })
  }

  if (
    existingQueue?.id
    && existingQueue.id !== finalQueue.id
    && existingQueue.status === 'scheduled'
  ) {
    const { error: supersededQueueError } = await supabase
      .from('scheduled_email_queue')
      .delete()
      .eq('id', existingQueue.id)
      .eq('status', 'scheduled')

    if (supersededQueueError) {
      throw supersededQueueError
    }
  }

  return {
    status: 'queued',
    mutation: existing?.id ? 'updated' : 'created',
    requestPlayer,
    queue: finalQueue,
    tokenReplaced: Boolean(existing?.id && !reusableToken),
  }
}

export function isTrainingInvitationQueueRow(row = {}) {
  return normalizeText(row?.payload?.trainingInvitation?.invitationType) === 'training_rsvp'
}

export async function prepareScheduledTrainingInvitationRow(row, {
  appOrigin = 'https://footballplayer.online',
  supabaseClient,
} = {}) {
  if (!isTrainingInvitationQueueRow(row)) {
    return { row, skipped: false, skipReason: '' }
  }

  const invitation = row.payload.trainingInvitation
  const requestId = normalizeText(invitation.requestId)
  const requestPlayerId = normalizeText(invitation.requestPlayerId)
  const eventId = normalizeText(invitation.eventId)
  const playerId = normalizeText(invitation.playerId)
  const recipientEmail = normalizeEmail(invitation.recipientEmail)
  const rawToken = normalizeText(invitation.rawToken)

  if (
    !supabaseClient
    || !requestId
    || !requestPlayerId
    || !eventId
    || !playerId
    || !isValidEmail(recipientEmail)
    || !rawToken
    || invitation.tokenHash !== hashToken(rawToken)
  ) {
    return {
      row,
      skipped: true,
      skipReason: 'Training invitation queue metadata is incomplete or invalid.',
    }
  }

  const [
    { data: requestPlayer, error: requestPlayerError },
    { data: request, error: requestError },
    { data: event, error: eventError },
    { data: player, error: playerError },
    { data: invite, error: inviteError },
    { data: setting, error: settingError },
    { data: exclusions, error: exclusionsError },
  ] = await Promise.all([
    supabaseClient
      .from('training_availability_request_players')
      .select('*')
      .eq('id', requestPlayerId)
      .maybeSingle(),
    supabaseClient
      .from('training_availability_requests')
      .select('*')
      .eq('id', requestId)
      .maybeSingle(),
    supabaseClient
      .from('calendar_events')
      .select('id, club_id, team_id, event_type, title, starts_at, ends_at, recurrence_frequency, recurrence_until, location, notes, cancelled_at, teams:team_id(name,notification_display_name), clubs:club_id(name, logo_url)')
      .eq('id', eventId)
      .maybeSingle(),
    supabaseClient
      .from('players')
      .select('id, club_id, team_id, player_name, parent_name, parent_email, contact_type, status')
      .eq('id', playerId)
      .maybeSingle(),
    supabaseClient
      .from('calendar_event_invites')
      .select('id, invite_status, cancelled_at, notify_requested, response_requirement, training_availability_requested')
      .eq('calendar_event_id', eventId)
      .eq('player_id', playerId)
      .maybeSingle(),
    supabaseClient
      .from('training_availability_settings')
      .select('id, enabled')
      .eq('calendar_event_id', eventId)
      .maybeSingle(),
    supabaseClient
      .from('event_player_occurrence_exclusions')
      .select('player_id, scope, effective_from_date')
      .eq('calendar_event_id', eventId)
      .eq('player_id', playerId),
  ])

  const loadError = requestPlayerError || requestError || eventError || playerError || inviteError || settingError || exclusionsError

  if (loadError) {
    throw loadError
  }

  const occurrences = event?.id ? buildOccurrences(event) : []
  const occurrence = occurrences.find((candidate) => candidate.occurrenceDate === invitation.occurrenceDate)
  const baseIsCurrent = Boolean(
    requestPlayer?.id
      && request?.id
      && event?.id
      && player?.id
      && invite?.id
      && setting?.enabled === true
      && requestPlayer.request_id === request.id
      && requestPlayer.email_queue_id === row.id
      && requestPlayer.token_hash === hashToken(rawToken)
      && requestPlayer.status === 'queued'
      && request.status !== 'cancelled'
      && event.event_type === 'training'
      && !event.cancelled_at
      && event.club_id === request.club_id
      && event.team_id === request.team_id
      && player.club_id === request.club_id
      && player.status !== 'archived'
      && invite.invite_status !== 'cancelled'
      && !invite.cancelled_at
      && invite.notify_requested === true
      && invite.training_availability_requested === true
      && normalizeText(invite.response_requirement) === 'response_required'
      && occurrence
      && !isOccurrenceExcluded(exclusions, invitation.occurrenceDate, playerId)
      && occurrence.occurrenceStartsAt.getTime() > Date.now()
  )

  if (!baseIsCurrent) {
    return {
      row,
      skipped: true,
      skipReason: 'Training invitation is no longer valid for the current event occurrence.',
    }
  }

  let recipientIsCurrent = false
  let recipient = {
    email: recipientEmail,
    name: normalizeText(requestPlayer.recipient_name),
    parentLinkId: requestPlayer.parent_link_id,
    type: requestPlayer.recipient_type,
  }

  if (requestPlayer.recipient_type === 'player') {
    recipientIsCurrent = normalizeText(player.contact_type).toLowerCase() === 'self'
      && normalizeEmail(player.parent_email) === recipientEmail
    recipient = {
      ...recipient,
      name: normalizeText(player.player_name),
      parentLinkId: null,
      type: 'player',
    }
  } else if (requestPlayer.recipient_type === 'parent' && requestPlayer.parent_link_id) {
    const { data: parentLink, error: parentLinkError } = await supabaseClient
      .from('parent_player_links')
      .select('id, player_id, club_id, team_id, email, status')
      .eq('id', requestPlayer.parent_link_id)
      .maybeSingle()

    if (parentLinkError) {
      throw parentLinkError
    }

    recipientIsCurrent = Boolean(
      parentLink?.id
        && parentLink.player_id === player.id
        && parentLink.club_id === request.club_id
        && parentLink.team_id === request.team_id
        && parentLink.status === 'active'
        && normalizeEmail(parentLink.email) === recipientEmail,
    )
  } else {
    const eligibleContacts = requestPlayer.recipient_type === 'parent'
      ? await resolveEligibleEventInvitationContacts(supabaseClient, {
          clubId: request.club_id,
          playerIds: [player.id],
          teamId: request.team_id,
        })
      : []
    recipientIsCurrent = eligibleContacts.some((contact) => (
      contact.playerId === player.id
      && contact.type === 'parent'
      && normalizeEmail(contact.email) === recipientEmail
    ))
  }

  if (!recipientIsCurrent) {
    return {
      row,
      skipped: true,
      skipReason: 'Training invitation recipient authority changed before delivery.',
    }
  }

  const currentRequest = {
    ...request,
    occurrence_starts_at: occurrence.occurrenceStartsAt.toISOString(),
    occurrence_ends_at: occurrence.occurrenceEndsAt?.toISOString() || null,
    send_at: row.scheduled_at,
  }
  const refreshedPayload = buildTrainingInvitationQueuePayload({
    appOrigin,
    deliveryAttempt: requestPlayer.delivery_attempt,
    event,
    invitationType: requestPlayer.invitation_type,
    occurrence,
    occurrences,
    player,
    recipient,
    request: currentRequest,
    requestPlayerId: requestPlayer.id,
    teamName: resolveTeamNotificationDisplayName(event.teams || {}, event.teams?.name || ''),
    token: rawToken,
  })

  return {
    row: {
      ...row,
      subject: refreshedPayload.resendPayload.subject,
      payload: {
        ...row.payload,
        ...refreshedPayload,
        deliveryTelemetry: {
          ...refreshedPayload.deliveryTelemetry,
          ...(row.payload.deliveryTelemetry || {}),
          eligibleAt: row.scheduled_at,
          scheduledAt: row.scheduled_at,
          logicalKey: `training_availability_request_player:${requestPlayer.id}:delivery:${requestPlayer.delivery_attempt}`,
          sourceType: 'training_availability_request_player',
          sourceId: requestPlayer.id,
        },
        trainingInvitation: {
          ...refreshedPayload.trainingInvitation,
          requestPlayerId: requestPlayer.id,
        },
      },
    },
    skipped: false,
    skipReason: '',
  }
}

export async function updateTrainingInvitationDelivery({
  lastError = null,
  queueId,
  status,
  supabase,
}) {
  const { data: requestPlayer, error: requestPlayerError } = await supabase
    .from('training_availability_request_players')
    .select('id, request_id')
    .eq('email_queue_id', queueId)
    .maybeSingle()

  if (requestPlayerError) {
    throw requestPlayerError
  }

  if (!requestPlayer?.id) {
    return
  }

  const recipientStatus = status === 'sent'
    ? 'sent'
    : status === 'failed'
      ? 'failed'
      : status === 'cancelled'
        ? 'cancelled'
        : 'queued'
  const { error: updateError } = await supabase
    .from('training_availability_request_players')
    .update({
      status: recipientStatus,
      last_error: lastError,
      ...(status === 'sent' ? { email_sent_at: new Date().toISOString() } : {}),
    })
    .eq('id', requestPlayer.id)

  if (updateError) {
    throw updateError
  }

  const { data: recipients, error: recipientsError } = await supabase
    .from('training_availability_request_players')
    .select('status')
    .eq('request_id', requestPlayer.request_id)

  if (recipientsError) {
    throw recipientsError
  }

  const statuses = (recipients ?? []).map((recipientRow) => recipientRow.status)
  const requestStatus = statuses.some((value) => value === 'failed')
    ? 'partial_failed'
    : statuses.some((value) => value === 'queued' || value === 'pending')
      ? 'queued'
      : statuses.length > 0 && statuses.every((value) => value === 'cancelled')
        ? 'cancelled'
        : 'sent'
  const { error: requestUpdateError } = await supabase
    .from('training_availability_requests')
    .update({
      status: requestStatus,
      last_error: requestStatus === 'partial_failed'
        ? 'Some Training Availability emails could not be sent.'
        : null,
      ...(requestStatus === 'sent' ? { sent_at: new Date().toISOString() } : {}),
    })
    .eq('id', requestPlayer.request_id)

  if (requestUpdateError) {
    throw requestUpdateError
  }
}

async function claimTrainingAvailabilityProcessorWork({ supabase, workerId }) {
  const { data, error } = await supabase.rpc('claim_training_availability_processor_work_v1', {
    worker_id_value: workerId,
    batch_size_value: 1,
    lease_seconds_value: TRAINING_AVAILABILITY_PROCESSOR_DEFAULTS.leaseSeconds,
  })

  if (error) {
    throw error
  }

  return data?.[0] ?? null
}

async function completeTrainingAvailabilityProcessorWork({
  cursorDate = null,
  errorCode = null,
  nextDueAt = null,
  outcome,
  supabase,
  work,
  workerId,
}) {
  const { data, error } = await supabase.rpc('complete_training_availability_processor_work_v1', {
    work_id_value: work.id,
    worker_id_value: workerId,
    revision_value: work.revision,
    outcome_value: outcome,
    cursor_date_value: cursorDate,
    next_due_at_value: nextDueAt?.toISOString?.() || nextDueAt || null,
    error_code_value: errorCode,
  })

  if (error) {
    throw error
  }

  return normalizeText(data)
}

async function getTrainingAvailabilityProcessorBacklog(supabase) {
  const { data, error } = await supabase.rpc('get_training_availability_processor_backlog_v1')

  if (error) {
    throw error
  }

  const row = data?.[0] ?? {}
  return {
    activeClaims: Math.max(0, Number(row.active_claim_count || 0)),
    candidateDue: Math.max(0, Number(row.candidate_due_count || 0)),
    oldestDueAt: normalizeText(row.oldest_due_at) || null,
    remainingDue: Math.max(0, Number(row.remaining_due_count || 0)),
  }
}

function emptyWorkSummary(overrides = {}) {
  return {
    created: 0,
    updated: 0,
    noOp: 0,
    terminal: 0,
    retryableFailures: 0,
    outcome: 'completed',
    cursorDate: null,
    nextDueAt: null,
    errorCode: null,
    ...overrides,
  }
}

export async function processRecurrenceWork({ now, supabase, work }) {
  const setting = await loadRecurrenceSetting({ supabase, work })
  const event = Array.isArray(setting?.calendar_events)
    ? setting.calendar_events[0]
    : setting?.calendar_events
  const scopeIsCurrent = Boolean(
    setting?.id
      && setting.enabled === true
      && event?.id
      && event.event_type === 'training'
      && !event.cancelled_at
      && event.team_id
      && setting.club_id === work.club_id
      && setting.team_id === work.team_id
      && event.club_id === work.club_id
      && event.team_id === work.team_id,
  )

  if (!scopeIsCurrent) {
    return emptyWorkSummary({
      terminal: 1,
      outcome: 'terminal',
      errorCode: 'RECURRENCE_SCOPE_TERMINAL',
    })
  }

  const occurrences = buildOccurrences(event)
    .filter((occurrence) => occurrence.occurrenceStartsAt.getTime() > now.getTime())
    .filter((occurrence) => !work.cursor_date || occurrence.occurrenceDate > work.cursor_date)

  if (occurrences.length === 0) {
    return emptyWorkSummary()
  }

  const { data: existingRequests, error: existingRequestsError } = await supabase
    .from('training_availability_requests')
    .select('*')
    .eq('calendar_event_id', setting.calendar_event_id)

  if (existingRequestsError) {
    throw existingRequestsError
  }

  const existingByOccurrenceDate = new Map(
    (existingRequests ?? []).map((request) => [request.occurrence_date, request]),
  )
  const result = emptyWorkSummary()
  let cursorDate = work.cursor_date || null
  let mutationCount = 0

  for (const occurrence of occurrences) {
    const requestResult = await upsertDueRequest({
      existingRequest: existingByOccurrenceDate.get(occurrence.occurrenceDate) ?? null,
      occurrence,
      sendAt: getSendAt(occurrence, setting),
      setting,
      supabase,
    })

    result.created += requestResult.mutation === 'created' ? 1 : 0
    result.updated += requestResult.mutation === 'updated' ? 1 : 0
    result.noOp += requestResult.mutation === 'no-op' ? 1 : 0
    cursorDate = occurrence.occurrenceDate

    if (requestResult.mutation !== 'no-op') {
      mutationCount += 1
    }
    if (mutationCount >= TRAINING_AVAILABILITY_PROCESSOR_DEFAULTS.recurrenceMutationLimit) {
      break
    }
  }

  const hasMore = occurrences.some((occurrence) => occurrence.occurrenceDate > cursorDate)

  return {
    ...result,
    outcome: hasMore ? 'pending' : 'completed',
    cursorDate,
    nextDueAt: hasMore ? now : null,
  }
}

export async function loadRequestWork({ supabase, work }) {
  const { data: request, error: requestError } = await supabase
    .from('training_availability_requests')
    .select('*')
    .eq('id', work.request_id)
    .maybeSingle()

  if (requestError) {
    throw requestError
  }

  if (!request) {
    return null
  }

  const { data: setting, error: settingError } = await supabase
    .from('training_availability_settings')
    .select('*')
    .eq('id', request.setting_id)
    .maybeSingle()

  if (settingError) {
    throw settingError
  }

  const { data: event, error: eventError } = await supabase
    .from('calendar_events')
    .select('id, club_id, team_id, event_type, title, starts_at, ends_at, recurrence_frequency, recurrence_until, location, notes, cancelled_at, teams:team_id(name,notification_display_name), clubs:club_id(name, logo_url)')
    .eq('id', request.calendar_event_id)
    .maybeSingle()

  if (eventError) {
    throw eventError
  }

  return {
    ...request,
    training_availability_settings: setting,
    calendar_events: event,
  }
}

async function processRequestWork({ appOrigin, now, supabase, work }) {
  const request = await loadRequestWork({ supabase, work })
  const setting = Array.isArray(request?.training_availability_settings)
    ? request.training_availability_settings[0]
    : request?.training_availability_settings
  const event = Array.isArray(request?.calendar_events)
    ? request.calendar_events[0]
    : request?.calendar_events
  const requestStatus = normalizeText(request?.status)
  const scopeIsCurrent = Boolean(
    request?.id
      && ['pending', 'queued', 'partial_failed'].includes(requestStatus)
      && setting?.id
      && setting.enabled === true
      && event?.id
      && event.event_type === 'training'
      && !event.cancelled_at
      && event.team_id
      && setting.calendar_event_id === request.calendar_event_id
      && event.id === request.calendar_event_id
      && request.club_id === work.club_id
      && request.team_id === work.team_id
      && setting.club_id === work.club_id
      && setting.team_id === work.team_id
      && event.club_id === work.club_id
      && event.team_id === work.team_id,
  )

  if (!scopeIsCurrent) {
    return emptyWorkSummary({
      terminal: 1,
      outcome: 'terminal',
      errorCode: 'REQUEST_SCOPE_TERMINAL',
    })
  }

  const sendAt = new Date(request.send_at)

  if (requestStatus === 'pending' && sendAt.getTime() > now.getTime()) {
    return emptyWorkSummary({
      outcome: 'pending',
      nextDueAt: sendAt,
    })
  }

  const occurrences = buildOccurrences(event)
  const occurrence = occurrences.find((candidate) => candidate.occurrenceDate === request.occurrence_date)

  if (!occurrence || occurrence.occurrenceStartsAt.getTime() <= now.getTime()) {
    return emptyWorkSummary({
      terminal: 1,
      outcome: 'terminal',
      errorCode: 'REQUEST_OCCURRENCE_TERMINAL',
    })
  }

  const sendGate = getTrainingAvailabilitySendGate(setting)

  if (requestStatus === 'pending' && !sendGate.allowed) {
    return emptyWorkSummary({
      outcome: 'retryable',
      retryableFailures: 1,
      nextDueAt: addMilliseconds(now, TRAINING_AVAILABILITY_PROCESSOR_DEFAULTS.sendGateRetryDelayMs),
      errorCode: `SEND_GATE_${normalizeSafeCode(sendGate.mode, 'DISABLED')}`,
    })
  }

  assertTrustedSystemPlanFeature({
    ...await getClubPlanProfile(request.club_id),
    role: 'system',
    roleRank: 100,
  }, 'parentEmails')
  const requestSummary = await processDueRequest({
    appOrigin,
    event,
    occurrence,
    occurrences,
    request,
    supabase,
  })
  const retryable = requestSummary.retryableFailures > 0

  return emptyWorkSummary({
    created: requestSummary.created,
    updated: requestSummary.updated,
    noOp: requestSummary.noOp,
    terminal: requestSummary.terminal,
    retryableFailures: requestSummary.retryableFailures,
    outcome: retryable ? 'retryable' : 'completed',
    nextDueAt: retryable
      ? addMilliseconds(now, TRAINING_AVAILABILITY_PROCESSOR_DEFAULTS.retryDelayMs)
      : null,
    errorCode: retryable ? 'REQUEST_RECIPIENT_RETRYABLE' : null,
  })
}

async function executeTrainingAvailabilityProcessorWork({ appOrigin, now, supabase, work }) {
  if (work.work_type === 'recurrence') {
    return processRecurrenceWork({ now, supabase, work })
  }

  if (work.work_type === 'request') {
    return processRequestWork({ appOrigin, now, supabase, work })
  }

  return emptyWorkSummary({
    terminal: 1,
    outcome: 'terminal',
    errorCode: 'UNKNOWN_WORK_TYPE',
  })
}

async function processDueRequest({ appOrigin, event, occurrence, occurrences, request, supabase }) {
  const [
    { data: scopedInvites, error: scopedInvitesError },
    { data: exclusions, error: exclusionsError },
  ] = await Promise.all([
    supabase
      .from('calendar_event_invites')
      .select('player_id, notify_requested, response_requirement, training_availability_requested')
      .eq('club_id', request.club_id)
      .eq('team_id', request.team_id)
      .eq('calendar_event_id', request.calendar_event_id)
      .neq('invite_status', 'cancelled'),
    supabase
      .from('event_player_occurrence_exclusions')
      .select('player_id, scope, effective_from_date')
      .eq('club_id', request.club_id)
      .eq('team_id', request.team_id)
      .eq('calendar_event_id', request.calendar_event_id),
  ])

  if (scopedInvitesError || exclusionsError) {
    throw scopedInvitesError || exclusionsError
  }

  const scopedPlayerIds = [...new Set(
    (scopedInvites ?? [])
      .filter((invite) => (
        invite.training_availability_requested === true
        && invite.notify_requested === true
        && normalizeText(invite.response_requirement) === 'response_required'
      ))
      .map((invite) => String(invite.player_id ?? '').trim())
      .filter(Boolean),
  )].filter((playerId) => !isOccurrenceExcluded(exclusions, occurrence.occurrenceDate, playerId))
  const playersQuery = supabase
    .from('players')
    .select('id, club_id, team_id, player_name, parent_name, parent_email, contact_type, status')
    .eq('club_id', request.club_id)
    .neq('status', 'archived')
    .in('id', scopedPlayerIds)

  const { data: players, error: playersError } = scopedPlayerIds.length > 0
    ? await playersQuery
    : { data: [], error: null }

  if (playersError) {
    throw playersError
  }

  const playerIds = (players ?? []).map((player) => player.id)
  const eligibleContacts = await resolveEligibleEventInvitationContacts(supabase, {
    clubId: request.club_id,
    playerIds,
    teamId: request.team_id,
  })

  const summary = {
    queued: 0,
    skipped: 0,
    failed: 0,
    missingParents: 0,
    created: 0,
    updated: 0,
    noOp: 0,
    terminal: 0,
    retryableFailures: 0,
  }
  const teamName = resolveTeamNotificationDisplayName(event.teams || {}, event.teams?.name || '')

  for (const player of players ?? []) {
    const contacts = eligibleContacts.filter((contact) => String(contact.playerId) === String(player.id))

    if (contacts.length === 0) {
      const unavailable = await createUnavailableRecipient({
        player,
        request,
        supabase,
      })
      summary[unavailable.created ? 'created' : 'noOp'] += 1
      summary.missingParents += 1
      summary.failed += 1
      summary.terminal += 1
      continue
    }

    for (const contact of contacts) {
      try {
        const result = await queueTrainingInvitationRecipient({
          appOrigin,
          event,
          occurrence,
          occurrences,
          player,
          recipient: contact,
          request,
          supabase,
          teamName,
        })
        summary[result.status] += 1
        summary[result.mutation === 'created' ? 'created' : result.mutation === 'updated' ? 'updated' : 'noOp'] += 1
        summary.terminal += result.terminal ? 1 : 0
      } catch (error) {
        console.error('Training availability recipient queue failed', {
          code: normalizeText(error?.code || error?.name || 'TRAINING_INVITATION_QUEUE_FAILED'),
        })
        summary.failed += 1
        summary.retryableFailures += 1
      }
    }
  }

  const nextStatus = summary.failed > 0 ? 'partial_failed' : 'queued'
  const nextLastError = summary.failed > 0
    ? 'Some Training Availability invitations could not be queued.'
    : null
  const requestChanged = normalizeText(request.status) !== nextStatus
    || normalizeText(request.last_error) !== normalizeText(nextLastError)
    || Boolean(request.sent_at)

  if (requestChanged) {
    const { error: updateError } = await supabase
      .from('training_availability_requests')
      .update({
        status: nextStatus,
        sent_at: null,
        last_error: nextLastError,
      })
      .eq('id', request.id)

    if (updateError) {
      throw updateError
    }

    summary.updated += 1
  } else {
    summary.noOp += 1
  }

  return summary
}

export async function processTrainingAvailabilityRequests(event = {}) {
  const supabase = event.supabaseClient || createSupabaseAdminClient(event)
  const clock = typeof event.now === 'function' ? event.now : () => new Date()
  const startedAt = clock()
  const startedAtMs = startedAt.getTime()
  const workerId = normalizeText(event.workerId) || randomUUID()
  const batchSize = Math.min(20, Math.max(
    1,
    Number(event.batchSize || TRAINING_AVAILABILITY_PROCESSOR_DEFAULTS.batchSize),
  ))
  const runtimeBudgetMs = Math.min(25_000, Math.max(
    1_000,
    Number(event.runtimeBudgetMs || TRAINING_AVAILABILITY_PROCESSOR_DEFAULTS.runtimeBudgetMs),
  ))
  const appOrigin = getAppOrigin(event)
  const initialBacklog = await getTrainingAvailabilityProcessorBacklog(supabase)
  const summary = {
    invocationId: randomUUID(),
    startTime: startedAt.toISOString(),
    endTime: null,
    elapsedMs: 0,
    runtimeBudgetMs,
    candidateDueCount: initialBacklog.candidateDue,
    claimedCount: 0,
    processedCount: 0,
    createdCount: 0,
    updatedCount: 0,
    noOpCount: 0,
    terminalCount: 0,
    retryableFailureCount: 0,
    leaseConflictCount: 0,
    remainingDueCount: initialBacklog.remainingDue,
    budgetExhausted: false,
    oldestDueAgeMs: initialBacklog.oldestDueAt
      ? Math.max(0, startedAtMs - new Date(initialBacklog.oldestDueAt).getTime())
      : 0,
    workerId,
    outcome: 'success',
  }

  console.info('Training availability processor invocation started', {
    invocationId: summary.invocationId,
    workerId: summary.workerId,
    startTime: summary.startTime,
    runtimeBudgetMs: summary.runtimeBudgetMs,
    candidateDueCount: summary.candidateDueCount,
  })

  while (summary.claimedCount < batchSize) {
    const now = clock()
    if (!hasTrainingAvailabilityRuntimeBudget({
      nowMs: now.getTime(),
      startedAtMs,
      runtimeBudgetMs,
    })) {
      summary.budgetExhausted = true
      break
    }

    const work = await claimTrainingAvailabilityProcessorWork({ supabase, workerId })
    if (!work) {
      break
    }

    summary.claimedCount += 1

    try {
      const result = await executeTrainingAvailabilityProcessorWork({
        appOrigin,
        now,
        supabase,
        work,
      })
      const completion = await completeTrainingAvailabilityProcessorWork({
        cursorDate: result.cursorDate,
        errorCode: result.errorCode,
        nextDueAt: result.nextDueAt,
        outcome: result.outcome,
        supabase,
        work,
        workerId,
      })

      if (completion === 'claim_lost') {
        summary.leaseConflictCount += 1
        continue
      }

      summary.processedCount += 1
      summary.createdCount += result.created
      summary.updatedCount += result.updated
      summary.noOpCount += result.noOp
      summary.terminalCount += result.terminal
      summary.retryableFailureCount += result.retryableFailures
    } catch (error) {
      const errorCode = normalizeSafeCode(error?.code || error?.name)
      summary.retryableFailureCount += 1
      console.warn('Training availability processor work retryable failure', {
        invocationId: summary.invocationId,
        workType: normalizeSafeCode(work.work_type, 'UNKNOWN'),
        code: errorCode,
      })

      try {
        const completion = await completeTrainingAvailabilityProcessorWork({
          errorCode,
          nextDueAt: addMilliseconds(now, TRAINING_AVAILABILITY_PROCESSOR_DEFAULTS.retryDelayMs),
          outcome: 'retryable',
          supabase,
          work,
          workerId,
        })
        if (completion === 'claim_lost') {
          summary.leaseConflictCount += 1
        } else {
          summary.processedCount += 1
        }
      } catch (completionError) {
        summary.leaseConflictCount += 1
        console.warn('Training availability processor completion failed', {
          invocationId: summary.invocationId,
          workType: normalizeSafeCode(work.work_type, 'UNKNOWN'),
          code: normalizeSafeCode(completionError?.code || completionError?.name),
        })
      }
    }
  }

  const finalBacklog = await getTrainingAvailabilityProcessorBacklog(supabase)
  const endedAt = clock()
  summary.endTime = endedAt.toISOString()
  summary.elapsedMs = Math.max(0, endedAt.getTime() - startedAtMs)
  summary.remainingDueCount = finalBacklog.remainingDue
  summary.oldestDueAgeMs = finalBacklog.oldestDueAt
    ? Math.max(0, endedAt.getTime() - new Date(finalBacklog.oldestDueAt).getTime())
    : 0
  summary.budgetExhausted = summary.budgetExhausted && summary.remainingDueCount > 0
  summary.outcome = summary.retryableFailureCount > 0
    ? 'success_with_retryable_failures'
    : summary.budgetExhausted
      ? 'success_budget_exhausted'
      : 'success'

  console.info('Training availability processor invocation completed', summary)
  return { success: true, ...summary }
}

export const config = {
  schedule: '* * * * *',
}

export default async function handler(request) {
  const authorization = await authorizeNativeScheduledRequest(request)

  if (!authorization.ok) {
    console.warn('Training availability scheduled authorization rejected', {
      code: 'SCHEDULED_REQUEST_UNAUTHORIZED',
    })
    return
  }

  try {
    await processTrainingAvailabilityRequests()
  } catch (error) {
    console.error('Training availability processor invocation failed', {
      code: normalizeSafeCode(error?.code || error?.name),
    })
    throw error
  }
}
