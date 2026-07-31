import process from 'node:process'
import { createHash, randomBytes } from 'node:crypto'
import { createFromAddress, getPublicEmailErrorMessage } from './lib/_email-provider.js'
import { assertPlanFeature, getClubPlanProfile } from './lib/_plan-gate.js'
import { createSupabaseAdminClient } from './lib/_supabase.js'
import { getTrainingAvailabilitySendGate } from './lib/_training-availability-send-gate.js'
import { authorizeNativeScheduledRequest } from './lib/_processor-auth.js'
import { buildEmailLogoMarkup, buildEventMapLinksMarkup } from '../../src/lib/email-branding.js'

function normalizeText(value) {
  return String(value ?? '').trim()
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

function addMonths(date, months) {
  const nextDate = new Date(date)
  nextDate.setMonth(date.getMonth() + months)
  return nextDate
}

function toDateOnly(value) {
  const parsedDate = value instanceof Date ? value : new Date(String(value ?? ''))
  return Number.isNaN(parsedDate.getTime()) ? '' : parsedDate.toISOString().slice(0, 10)
}

function toTimeOnly(value) {
  const normalizedValue = normalizeText(value)

  if (/^\d{2}:\d{2}/.test(normalizedValue)) {
    return normalizedValue.slice(0, 5)
  }

  const parsedDate = new Date(normalizedValue)
  return Number.isNaN(parsedDate.getTime()) ? '' : parsedDate.toISOString().slice(11, 16)
}

function buildDateTime(dateValue, timeValue) {
  const date = toDateOnly(dateValue)
  const time = toTimeOnly(timeValue) || '09:00'
  return date ? new Date(`${date}T${time}:00`) : null
}

function getOccurrenceEndDate(event, occurrenceDate) {
  const sourceStart = new Date(event.starts_at)
  const sourceEnd = new Date(event.ends_at || event.starts_at)

  if (Number.isNaN(sourceStart.getTime()) || Number.isNaN(sourceEnd.getTime())) {
    return buildDateTime(occurrenceDate, event.ends_at || event.starts_at)
  }

  const dayOffset = Math.round((sourceEnd.getTime() - sourceStart.getTime()) / 86400000)
  return addDays(new Date(`${toDateOnly(occurrenceDate)}T00:00:00`), dayOffset)
}

export function buildOccurrences(event) {
  const startsAt = new Date(event.starts_at)

  if (Number.isNaN(startsAt.getTime())) {
    return []
  }

  const frequency = normalizeText(event.recurrence_frequency || 'none')
  const until = event.recurrence_until ? new Date(`${event.recurrence_until}T23:59:59`) : addMonths(new Date(), 3)
  const maxDate = frequency === 'none' || Number.isNaN(until.getTime()) ? startsAt : until
  const occurrences = []
  let cursor = new Date(startsAt)

  while (occurrences.length < 80 && cursor.getTime() <= maxDate.getTime()) {
    const date = toDateOnly(cursor)
    const occurrenceStartsAt = buildDateTime(date, event.starts_at)
    const occurrenceEndsAt = buildDateTime(getOccurrenceEndDate(event, date), event.ends_at || event.starts_at)

    if (occurrenceStartsAt) {
      occurrences.push({
        occurrenceDate: date,
        occurrenceStartsAt,
        occurrenceEndsAt,
      })
    }

    if (frequency === 'weekly') {
      cursor = addDays(cursor, 7)
    } else if (frequency === 'fortnightly') {
      cursor = addDays(cursor, 14)
    } else if (frequency === 'monthly') {
      cursor = addMonths(cursor, 1)
    } else {
      break
    }
  }

  return occurrences
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
  }).format(parsedDate)
}

function formatDateLabel(value) {
  const parsedDate = new Date(value)

  if (Number.isNaN(parsedDate.getTime())) {
    return 'Date to be confirmed'
  }

  return new Intl.DateTimeFormat('en-GB', {
    dateStyle: 'full',
    timeStyle: 'short',
  }).format(parsedDate)
}

function formatIcsDate(value) {
  const parsedDate = new Date(value)

  if (Number.isNaN(parsedDate.getTime())) {
    return ''
  }

  return parsedDate.toISOString().replace(/[-:]/g, '').replace(/\.\d{3}Z$/, 'Z')
}

function escapeIcsText(value) {
  return normalizeText(value)
    .replace(/\\/g, '\\\\')
    .replace(/\n/g, '\\n')
    .replace(/,/g, '\\,')
    .replace(/;/g, '\\;')
}

export function buildTrainingAvailabilityCalendarIcs({ event = {}, occurrences = [], teamName = '' } = {}) {
  const validOccurrences = occurrences
    .filter((occurrence) => formatIcsDate(occurrence.occurrenceStartsAt))
    .slice(0, 52)

  if (validOccurrences.length === 0) {
    return ''
  }

  const calendarName = `${event.title || teamName || 'Training sessions'}`
  const location = escapeIcsText(event.location || '')
  const description = escapeIcsText('Training schedule from Football Player. Availability responses still apply to one session at a time.')
  const events = validOccurrences.map((occurrence) => {
    const startsAt = formatIcsDate(occurrence.occurrenceStartsAt)
    const endsAt = formatIcsDate(occurrence.occurrenceEndsAt || occurrence.occurrenceStartsAt)
    const uid = `training-availability-${event.id || 'event'}-${occurrence.occurrenceDate}@footballplayer.online`

    return [
      'BEGIN:VEVENT',
      `UID:${uid}`,
      `DTSTAMP:${formatIcsDate(new Date())}`,
      `DTSTART:${startsAt}`,
      endsAt ? `DTEND:${endsAt}` : '',
      `SUMMARY:${escapeIcsText(event.title || 'Training session')}`,
      location ? `LOCATION:${location}` : '',
      `DESCRIPTION:${description}`,
      'END:VEVENT',
    ].filter(Boolean).join('\r\n')
  }).join('\r\n')

  return [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    'PRODID:-//Football Player//Training Availability//EN',
    'CALSCALE:GREGORIAN',
    `X-WR-CALNAME:${escapeIcsText(calendarName)}`,
    events,
    'END:VCALENDAR',
  ].join('\r\n')
}

function buildSeriesScheduleHtml({ event, occurrences = [], teamName }) {
  const upcomingOccurrences = occurrences
    .filter((occurrence) => occurrence?.occurrenceStartsAt instanceof Date && !Number.isNaN(occurrence.occurrenceStartsAt.getTime()))
    .slice(0, 12)

  if (upcomingOccurrences.length <= 1) {
    return ''
  }

  const ics = buildTrainingAvailabilityCalendarIcs({ event, occurrences: upcomingOccurrences, teamName })
  const calendarHref = ics ? `data:text/calendar;charset=utf-8,${encodeURIComponent(ics)}` : ''

  return `
    <div style="border:1px solid #d7e5dc;border-radius:12px;background:#f7faf8;padding:14px 16px;margin:0 0 22px;">
      <p style="margin:0 0 8px;color:#047857;font-size:12px;font-weight:900;letter-spacing:0.14em;text-transform:uppercase;">Upcoming dates</p>
      <p style="margin:0 0 10px;color:#4b5f55;font-size:14px;line-height:1.5;font-weight:700;">Add the full recurring schedule to your calendar, then answer this availability request for this session only.</p>
      <ul style="margin:0 0 12px 18px;padding:0;color:#101828;font-size:14px;line-height:1.6;font-weight:800;">
        ${upcomingOccurrences.map((item) => `<li>${escapeHtml(formatDateLabel(item.occurrenceStartsAt))}</li>`).join('')}
      </ul>
      ${calendarHref ? `<a href="${escapeHtml(calendarHref)}" style="display:inline-block;margin:0 0 4px;padding:10px 12px;border:1px solid #047857;color:#047857;text-decoration:none;border-radius:8px;font-weight:900;">Add schedule to calendar</a>` : ''}
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
  const scheduleHtml = includeRecurringSchedule
    ? buildSeriesScheduleHtml({ event, occurrences, teamName })
    : ''
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
        ${scheduleHtml}
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

async function loadSettings(supabase) {
  const { data, error } = await supabase
    .from('training_availability_settings')
    .select('*, calendar_events:calendar_event_id(id, club_id, team_id, event_type, title, starts_at, ends_at, recurrence_frequency, recurrence_until, location, notes, cancelled_at, teams:team_id(name), clubs:club_id(name, logo_url))')
    .eq('enabled', true)
    .limit(100)

  if (error) {
    throw error
  }

  return (data ?? []).filter((setting) => {
    const event = Array.isArray(setting.calendar_events) ? setting.calendar_events[0] : setting.calendar_events
    return event?.id && event.event_type === 'training' && !event.cancelled_at && event.team_id
  })
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

async function upsertDueRequest({ occurrence, sendAt, setting, supabase }) {
  const event = Array.isArray(setting.calendar_events) ? setting.calendar_events[0] : setting.calendar_events
  const { data: existingRequest, error: existingRequestError } = await supabase
    .from('training_availability_requests')
    .select('*')
    .eq('calendar_event_id', setting.calendar_event_id)
    .eq('occurrence_date', occurrence.occurrenceDate)
    .maybeSingle()

  if (existingRequestError) {
    throw existingRequestError
  }

  if (existingRequest?.id) {
    if (['pending', 'queued', 'partial_failed'].includes(normalizeText(existingRequest.status))) {
      const reconciledSendAt = getReconciledRequestSendAt({
        existingRequest,
        scheduledSendAt: sendAt,
      })
      const { data: reconciledRequest, error: reconcileError } = await supabase
        .from('training_availability_requests')
        .update({
          setting_id: setting.id,
          club_id: setting.club_id,
          team_id: setting.team_id,
          occurrence_starts_at: occurrence.occurrenceStartsAt.toISOString(),
          occurrence_ends_at: occurrence.occurrenceEndsAt?.toISOString() || null,
          send_at: reconciledSendAt.toISOString(),
        })
        .eq('id', existingRequest.id)
        .select('*')
        .single()

      if (reconcileError) {
        throw reconcileError
      }

      return {
        event,
        request: reconciledRequest,
        sendAt: new Date(reconciledRequest.send_at || reconciledSendAt),
      }
    }

    return {
      event,
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
    return existing
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

  return data
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
    return { status: 'skipped', requestPlayer: existing }
  }

  if (action === 'automatic' && currentStatus === 'failed') {
    return { status: 'failed', requestPlayer: existing }
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
        return { status: 'skipped', requestPlayer: existing, queue: existingQueue }
      }

      throw Object.assign(new Error('This Training invitation is already being delivered.'), {
        code: 'TRAINING_INVITATION_DELIVERY_IN_PROGRESS',
        statusCode: 409,
      })
    }
  }

  const reusableToken = action === 'automatic'
    ? normalizeText(existingQueue?.payload?.trainingInvitation?.rawToken)
    : ''
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
    parent_link_id: recipient.parentLinkId,
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
      .select('id, club_id, team_id, event_type, title, starts_at, ends_at, recurrence_frequency, recurrence_until, location, notes, cancelled_at, teams:team_id(name), clubs:club_id(name, logo_url)')
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
  ])

  const loadError = requestPlayerError || requestError || eventError || playerError || inviteError || settingError

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
      && player.team_id === request.team_id
      && player.status !== 'archived'
      && invite.invite_status !== 'cancelled'
      && !invite.cancelled_at
      && invite.notify_requested === true
      && invite.training_availability_requested === true
      && normalizeText(invite.response_requirement) === 'response_required'
      && occurrence
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
    recipientIsCurrent = requestPlayer.recipient_type === 'parent'
      && normalizeEmail(player.parent_email) === recipientEmail
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
    teamName: event.teams?.name || '',
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

async function reconcileInvalidTrainingInvitationQueues({
  appOrigin,
  supabase,
}) {
  const { data: queueRows, error } = await supabase
    .from('scheduled_email_queue')
    .select('*')
    .eq('status', 'scheduled')
    .contains('payload', { trainingInvitation: { invitationType: 'training_rsvp' } })
    .limit(250)

  if (error) {
    throw error
  }

  let cancelled = 0

  for (const row of queueRows ?? []) {
    const preparation = await prepareScheduledTrainingInvitationRow(row, {
      appOrigin,
      supabaseClient: supabase,
    })

    if (!preparation.skipped) {
      continue
    }

    await updateTrainingInvitationDelivery({
      lastError: preparation.skipReason,
      queueId: row.id,
      status: 'cancelled',
      supabase,
    })
    const { error: deleteError } = await supabase
      .from('scheduled_email_queue')
      .delete()
      .eq('id', row.id)
      .eq('status', 'scheduled')

    if (deleteError) {
      throw deleteError
    }

    cancelled += 1
  }

  return cancelled
}

async function processDueRequest({ appOrigin, event, occurrence, occurrences, request, supabase }) {
  const { data: scopedInvites, error: scopedInvitesError } = await supabase
    .from('calendar_event_invites')
    .select('player_id, notify_requested, response_requirement, training_availability_requested')
    .eq('club_id', request.club_id)
    .eq('team_id', request.team_id)
    .eq('calendar_event_id', request.calendar_event_id)
    .neq('invite_status', 'cancelled')

  if (scopedInvitesError) {
    throw scopedInvitesError
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
  )]
  const playersQuery = supabase
    .from('players')
    .select('id, club_id, team_id, player_name, parent_name, parent_email, contact_type, status')
    .eq('club_id', request.club_id)
    .eq('team_id', request.team_id)
    .neq('status', 'archived')
    .in('id', scopedPlayerIds)

  const { data: players, error: playersError } = scopedPlayerIds.length > 0
    ? await playersQuery
    : { data: [], error: null }

  if (playersError) {
    throw playersError
  }

  const playerIds = (players ?? []).map((player) => player.id)
  const { data: parentLinks, error: parentLinksError } = playerIds.length > 0
    ? await supabase
      .from('parent_player_links')
      .select('id, player_id, team_id, club_id, email, status')
      .eq('club_id', request.club_id)
      .eq('team_id', request.team_id)
      .in('player_id', playerIds)
      .eq('status', 'active')
    : { data: [], error: null }

  if (parentLinksError) {
    throw parentLinksError
  }

  const summary = { queued: 0, skipped: 0, failed: 0, missingParents: 0 }
  const teamName = event.teams?.name || ''

  for (const player of players ?? []) {
    const contacts = getPlayerContacts({ parentLinks: parentLinks ?? [], player })

    if (contacts.length === 0) {
      await createUnavailableRecipient({
        player,
        request,
        supabase,
      })
      summary.missingParents += 1
      summary.failed += 1
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
      } catch (error) {
        console.error('Training availability recipient queue failed', {
          code: normalizeText(error?.code || error?.name || 'TRAINING_INVITATION_QUEUE_FAILED'),
        })
        summary.failed += 1
      }
    }
  }

  const nextStatus = summary.failed > 0 ? 'partial_failed' : 'queued'
  const { error: updateError } = await supabase
    .from('training_availability_requests')
    .update({
      status: nextStatus,
      sent_at: null,
      last_error: summary.failed > 0 ? 'Some Training Availability invitations could not be queued.' : null,
    })
    .eq('id', request.id)

  if (updateError) {
    throw updateError
  }

  return summary
}

export async function processTrainingAvailabilityRequests(event = {}) {
  const supabase = createSupabaseAdminClient(event)
  const now = new Date()
  const appOrigin = getAppOrigin(event)
  const summary = {
    scanned: 0,
    due: 0,
    gated: 0,
    queued: 0,
    skipped: 0,
    failed: 0,
    missingParents: 0,
    reconciledCancelled: 0,
  }

  summary.reconciledCancelled = await reconcileInvalidTrainingInvitationQueues({
    appOrigin,
    supabase,
  })
  const settings = await loadSettings(supabase)

  for (const setting of settings) {
    const calendarEvent = Array.isArray(setting.calendar_events) ? setting.calendar_events[0] : setting.calendar_events
    const occurrences = buildOccurrences(calendarEvent)

    for (const occurrence of occurrences) {
      summary.scanned += 1

      if (occurrence.occurrenceStartsAt.getTime() <= now.getTime()) {
        continue
      }

      const sendAt = getSendAt(occurrence, setting)

      const sendGate = getTrainingAvailabilitySendGate(setting)

      if (!sendGate.allowed) {
        summary.gated += 1
        console.warn('Training availability send gated', {
          calendarEventId: setting.calendar_event_id,
          clubId: setting.club_id,
          gateMode: sendGate.mode,
          occurrenceDate: occurrence.occurrenceDate,
          teamId: setting.team_id,
        })
        continue
      }

      const due = await upsertDueRequest({ occurrence, sendAt, setting, supabase })

      if (!['pending', 'queued', 'partial_failed'].includes(normalizeText(due.request.status))) {
        continue
      }

      summary.due += 1
      assertPlanFeature({
        ...await getClubPlanProfile(due.request.club_id),
        role: 'system',
        roleRank: 100,
      }, 'parentEmails')
      const requestSummary = await processDueRequest({
        appOrigin,
        event: due.event,
        occurrence,
        occurrences,
        request: due.request,
        supabase,
      })

      summary.queued += requestSummary.queued
      summary.skipped += requestSummary.skipped
      summary.failed += requestSummary.failed
      summary.missingParents += requestSummary.missingParents
    }
  }

  return { success: true, ...summary }
}

export const config = {
  schedule: '* * * * *',
}

export default async function handler(request) {
  const authorization = await authorizeNativeScheduledRequest(request)

  if (!authorization.ok) {
    return authorization.response
  }

  try {
    return Response.json(await processTrainingAvailabilityRequests())
  } catch (error) {
    console.error(error)
    return Response.json({
      success: false,
      message: error.publicMessage
        ? getPublicEmailErrorMessage(error, 'Training Availability requests could not be processed.')
        : 'Training Availability requests could not be processed.',
    }, { status: error.statusCode || 500 })
  }
}
