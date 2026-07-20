import process from 'node:process'
import { createHash, randomBytes } from 'node:crypto'
import { createFromAddress, getPublicEmailErrorMessage, sendEmail } from './lib/_email-provider.js'
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

function getPlayerContacts({ parentLinks = [], player }) {
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

  const contactType = normalizeText(player.contact_type || 'parent').toLowerCase()

  if (contactType === 'self') {
    return []
  }

  const parentEmail = normalizeEmail(player.parent_email)

  return isValidEmail(parentEmail)
    ? [{
        email: parentEmail,
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

async function createRecipient({ contact, player, request, supabase }) {
  const existing = await findExistingRecipient({
    requestId: request.id,
    playerId: player.id,
    recipientEmail: contact.email,
    supabase,
  })

  if (existing?.id) {
    return { row: existing, token: '' }
  }

  const token = randomBytes(32).toString('hex')
  const { data, error } = await supabase
    .from('training_availability_request_players')
    .insert({
      request_id: request.id,
      club_id: request.club_id,
      team_id: request.team_id,
      calendar_event_id: request.calendar_event_id,
      player_id: player.id,
      player_name: normalizeText(player.player_name),
      parent_link_id: contact.parentLinkId,
      recipient_email: contact.email,
      recipient_name: contact.name,
      recipient_type: 'parent',
      token_hash: hashToken(token),
      status: 'queued',
    })
    .select('*')
    .single()

  if (error) {
    throw error
  }

  return { row: data, token }
}

async function sendRecipientEmail({ appOrigin, event, occurrence, occurrences, player, recipient, requestPlayer, supabase, teamName, token }) {
  if (!token || ['sent', 'responded'].includes(normalizeText(requestPlayer.status))) {
    return 'skipped'
  }

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

  await sendEmail({
    from: createFromAddress('Football Player'),
    to: [recipient.email],
    subject: email.subject,
    html: email.html,
  }, {
    context: {
      emailType: 'training_availability',
      userRole: 'system',
      clubId: requestPlayer.club_id,
      teamId: requestPlayer.team_id,
      targetEntityType: 'training_availability_request_player',
      targetEntityId: requestPlayer.id,
    },
    publicMessage: 'Training availability email could not be sent.',
  })

  const { error } = await supabase
    .from('training_availability_request_players')
    .update({
      status: 'sent',
      email_sent_at: new Date().toISOString(),
      last_error: null,
    })
    .eq('id', requestPlayer.id)

  if (error) {
    throw error
  }

  return 'sent'
}

async function processDueRequest({ appOrigin, event, occurrence, occurrences, request, supabase }) {
  const { data: players, error: playersError } = await supabase
    .from('players')
    .select('id, club_id, team_id, player_name, parent_name, parent_email, contact_type, status')
    .eq('club_id', request.club_id)
    .eq('team_id', request.team_id)
    .neq('status', 'archived')

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

  const summary = { sent: 0, skipped: 0, failed: 0, missingParents: 0 }
  const teamName = event.teams?.name || ''

  for (const player of players ?? []) {
    const contacts = getPlayerContacts({ parentLinks: parentLinks ?? [], player })

    if (contacts.length === 0) {
      summary.missingParents += 1
      continue
    }

    for (const contact of contacts) {
      try {
        const recipient = await createRecipient({ contact, player, request, supabase })
        const status = await sendRecipientEmail({
          appOrigin,
          event,
          occurrence,
          occurrences,
          player,
          recipient: contact,
          requestPlayer: recipient.row,
          supabase,
          teamName,
          token: recipient.token,
        })
        summary[status] += 1
      } catch (error) {
        console.error('Training availability recipient failed', error)
        summary.failed += 1
      }
    }
  }

  const nextStatus = summary.failed > 0 ? 'partial_failed' : 'sent'
  const { error: updateError } = await supabase
    .from('training_availability_requests')
    .update({
      status: nextStatus,
      sent_at: new Date().toISOString(),
      last_error: summary.failed > 0 ? 'Some Training Availability emails could not be sent.' : null,
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
    sent: 0,
    skipped: 0,
    failed: 0,
    missingParents: 0,
  }

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

      if (sendAt.getTime() > now.getTime()) {
        continue
      }

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

      summary.sent += requestSummary.sent
      summary.skipped += requestSummary.skipped
      summary.failed += requestSummary.failed
      summary.missingParents += requestSummary.missingParents
    }
  }

  return { success: true, ...summary }
}

export const config = {
  schedule: '*/15 * * * *',
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
