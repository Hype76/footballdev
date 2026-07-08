import { createHash } from 'node:crypto'
import { Buffer } from 'node:buffer'
import { createPublicSupabaseClient, createSupabaseAdminClient } from './lib/_supabase.js'

const VALID_STATUSES = new Set(['available', 'unavailable', 'maybe'])
const VALID_VOLUNTEER_RESPONSES = new Set(['yes', 'no'])

function normalizeText(value) {
  return String(value ?? '').trim()
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

function getFormBody(event) {
  const body = event.isBase64Encoded
    ? Buffer.from(event.body || '', 'base64').toString('utf8')
    : event.body || ''

  return new URLSearchParams(body)
}

function htmlResponse(statusCode, body) {
  return {
    statusCode,
    headers: { 'Content-Type': 'text/html; charset=utf-8' },
    body,
  }
}

function statusLabel(value) {
  const status = normalizeText(value).toLowerCase()

  if (status === 'unavailable') {
    return 'not available'
  }

  if (status === 'no_response' || status === 'pending') {
    return 'no response'
  }

  return status || 'no response'
}

function sentenceStatusLabel(value) {
  const label = statusLabel(value)
  return label ? `${label.charAt(0).toUpperCase()}${label.slice(1)}` : 'No response'
}

function formatReadableTimestamp(value) {
  const timestamp = normalizeText(value)

  if (!timestamp) {
    return 'time not recorded'
  }

  const date = new Date(timestamp)

  if (Number.isNaN(date.getTime())) {
    return timestamp
  }

  return new Intl.DateTimeFormat('en-GB', {
    day: '2-digit',
    month: 'short',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    timeZoneName: 'short',
  }).format(date)
}

function formatTime(value) {
  const normalizedValue = normalizeText(value)
  return normalizedValue ? normalizedValue.slice(0, 5) : 'Not set'
}

function getGoogleDatePart(dateValue) {
  const match = normalizeText(dateValue).match(/^(\d{4})-(\d{2})-(\d{2})/)

  if (!match) {
    return ''
  }

  return `${match[1]}${match[2]}${match[3]}`
}

function getNextGoogleDatePart(dateValue) {
  const match = normalizeText(dateValue).match(/^(\d{4})-(\d{2})-(\d{2})/)

  if (!match) {
    return ''
  }

  const date = new Date(Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3]) + 1))
  return `${date.getUTCFullYear()}${String(date.getUTCMonth() + 1).padStart(2, '0')}${String(date.getUTCDate()).padStart(2, '0')}`
}

function addMinutesToTime(value, minutesToAdd) {
  const normalizedValue = normalizeText(value)

  if (!/^\d{2}:\d{2}/.test(normalizedValue)) {
    return ''
  }

  const [hours, minutes] = normalizedValue.slice(0, 5).split(':').map(Number)
  const totalMinutes = (hours * 60) + minutes + Number(minutesToAdd || 0)
  const wrappedMinutes = ((totalMinutes % 1440) + 1440) % 1440
  const nextHours = Math.floor(wrappedMinutes / 60)
  const nextMinutes = wrappedMinutes % 60
  return `${String(nextHours).padStart(2, '0')}:${String(nextMinutes).padStart(2, '0')}`
}

function buildFixtureResponseCalendarUrl(response) {
  const datePart = getGoogleDatePart(response.match_date)

  if (!datePart) {
    return ''
  }

  const teamName = normalizeText(response.team_name || 'Team')
  const opponent = normalizeText(response.opponent || 'Opponent')
  const startTime = normalizeText(response.arrival_time || response.kickoff_time).slice(0, 5)
  const kickoffTime = normalizeText(response.kickoff_time).slice(0, 5)
  const endTime = kickoffTime
    ? addMinutesToTime(kickoffTime, 120)
    : addMinutesToTime(startTime, 120)
  const dates = startTime
    ? `${datePart}T${startTime.replace(':', '')}00/${datePart}T${(endTime || addMinutesToTime(startTime, 120)).replace(':', '')}00`
    : `${datePart}/${getNextGoogleDatePart(response.match_date) || datePart}`
  const details = [
    `Player: ${normalizeText(response.player_name || 'Player')}`,
    `Team: ${teamName}`,
    `Opponent: ${opponent}`,
    `Kick-off: ${formatTime(response.kickoff_time)}`,
    response.arrival_time ? `Arrival: ${formatTime(response.arrival_time)}` : '',
    response.venue_name ? `Venue: ${response.venue_name}` : '',
  ].filter(Boolean).join('\n')
  const params = new URLSearchParams({
    action: 'TEMPLATE',
    text: `Fixture: ${teamName} v ${opponent}`,
    dates,
    details,
    location: normalizeText(response.venue_address || response.venue_name),
    ctz: 'Europe/London',
  })

  return `https://calendar.google.com/calendar/render?${params.toString()}`
}

function page({ title, message, content = '' }) {
  return `<!doctype html>
    <html lang="en">
      <head>
        <meta charset="utf-8">
        <meta name="viewport" content="width=device-width,initial-scale=1">
        <title>${escapeHtml(title)}</title>
        <style>
          body { margin: 0; background: #f7faf8; color: #101828; font-family: Arial, sans-serif; }
          main { min-height: 100vh; display: flex; align-items: center; justify-content: center; padding: 24px; }
          section { max-width: 640px; width: 100%; border: 1px solid #d7e5dc; border-radius: 12px; background: #ffffff; padding: 28px; box-shadow: 0 12px 30px rgba(4,120,87,0.12); }
          .eyebrow { margin: 0 0 10px; color: #047857; font-size: 12px; font-weight: 900; letter-spacing: 0.18em; text-transform: uppercase; }
          h1 { margin: 0 0 12px; font-size: 28px; line-height: 1.15; }
          p { margin: 0; color: #4b5f55; font-size: 16px; line-height: 1.6; font-weight: 700; }
          form { margin-top: 22px; display: grid; gap: 16px; }
          fieldset { border: 1px solid #d7e5dc; border-radius: 10px; padding: 14px; }
          legend { color: #101828; font-weight: 900; }
          label { display: flex; gap: 10px; align-items: center; margin-top: 10px; color: #101828; font-weight: 800; }
          input[type="radio"] { width: 18px; height: 18px; accent-color: #047857; }
          button { min-height: 44px; border: 0; border-radius: 8px; background: #047857; color: #ffffff; font-weight: 900; font-size: 15px; cursor: pointer; }
          .availability-summary { margin: 10px 0 2px; color: #101828; font-size: 14px; line-height: 1.5; font-weight: 800; }
          .details { margin-top: 16px; display: grid; gap: 8px; border: 1px solid #d7e5dc; border-radius: 10px; background: #f7faf8; padding: 14px; }
          .detail { display: flex; justify-content: space-between; gap: 14px; color: #4b5f55; font-size: 14px; font-weight: 800; }
          .detail strong { color: #101828; text-align: right; }
          .calendar-action { margin-top: 12px; }
          .calendar-action a { display: inline-flex; min-height: 44px; align-items: center; justify-content: center; border-radius: 8px; background: #101828; color: #ffffff; padding: 0 16px; text-decoration: none; font-size: 15px; font-weight: 900; }
        </style>
      </head>
      <body>
        <main>
          <section>
            <p class="eyebrow">Football Player</p>
            <h1>${escapeHtml(title)}</h1>
            <p>${escapeHtml(message)}</p>
            ${content}
          </section>
        </main>
      </body>
    </html>`
}

function detailRows(response) {
  const calendarUrl = buildFixtureResponseCalendarUrl(response)
  const rows = [
    ['Player', response.player_name || 'Player'],
    ['Fixture', `${response.team_name || 'Team'} v ${response.opponent || 'Opponent'}`],
    ['Date', response.match_date || 'Date not set'],
    ['Kick off', response.kickoff_time ? String(response.kickoff_time).slice(0, 5) : 'Not set'],
    ['Arrival', response.arrival_time ? String(response.arrival_time).slice(0, 5) : 'Not set'],
    ['Venue', response.venue_name || 'Not set'],
  ]

  return `<div class="details">${rows.map(([label, value]) => `
    <div class="detail"><span>${escapeHtml(label)}</span><strong>${escapeHtml(value)}</strong></div>
  `).join('')}</div>
  ${calendarUrl ? `<p class="calendar-action"><a href="${escapeHtml(calendarUrl)}" target="_blank" rel="noopener noreferrer">Add to calendar</a></p>` : ''}`
}

function currentAvailabilityAttribution(response, currentStatus) {
  const selectedBy = normalizeText(response.current_availability_selected_by_name)
    || normalizeText(response.current_availability_selected_by_email)
    || 'the latest responder'
  const selectedAt = formatReadableTimestamp(response.current_availability_selected_at)

  return `<p class="availability-summary">Current answer: ${escapeHtml(sentenceStatusLabel(currentStatus))}, chosen by ${escapeHtml(selectedBy)} at ${escapeHtml(selectedAt)}. If this has changed, you can update it below.</p>`
}

function availabilityFieldset(response) {
  const currentStatus = normalizeText(response.current_availability_status || response.response_status).toLowerCase()
  const hasCurrentStatus = VALID_STATUSES.has(currentStatus)
  const choices = [
    ['available', 'Available'],
    ['unavailable', 'Not available'],
    ['maybe', 'Maybe'],
  ]

  return `<fieldset>
    <legend>Player availability</legend>
    ${hasCurrentStatus ? currentAvailabilityAttribution(response, currentStatus) : ''}
    ${hasCurrentStatus ? `
      <label>
        <input type="radio" name="status" value="" checked>
        <span>Keep ${statusLabel(currentStatus)}</span>
      </label>
    ` : ''}
    ${choices.map(([value, label]) => `
      <label>
        <input type="radio" name="status" value="${value}" ${!hasCurrentStatus && currentStatus === value ? 'checked' : ''} ${hasCurrentStatus ? '' : 'required'}>
        <span>${label}</span>
      </label>
    `).join('')}
  </fieldset>`
}

function roleFieldset(name, label, currentValue) {
  const normalizedValue = normalizeText(currentValue).toLowerCase()

  return `<fieldset>
    <legend>Can you help as ${escapeHtml(label)}?</legend>
    <label>
      <input type="radio" name="${escapeHtml(name)}" value="yes" ${normalizedValue === 'yes' ? 'checked' : ''}>
      <span>Yes</span>
    </label>
    <label>
      <input type="radio" name="${escapeHtml(name)}" value="no" ${normalizedValue === 'no' ? 'checked' : ''}>
      <span>No</span>
    </label>
  </fieldset>`
}

function volunteerFields(response) {
  return [
    response.request_scorer === true ? roleFieldset('volunteerScorerResponse', 'scorer', response.volunteer_scorer_response) : '',
    response.request_linesman === true ? roleFieldset('volunteerLinesmanResponse', 'linesman', response.volunteer_linesman_response) : '',
    response.request_referee === true ? roleFieldset('volunteerRefereeResponse', 'referee', response.volunteer_referee_response) : '',
  ].filter(Boolean).join('')
}

function yesNoFieldset({ name, legend, currentValue }) {
  const normalizedValue = currentValue === true ? 'yes' : 'no'

  return `<fieldset>
    <legend>${escapeHtml(legend)}</legend>
    <label>
      <input type="radio" name="${escapeHtml(name)}" value="yes" ${normalizedValue === 'yes' ? 'checked' : ''}>
      <span>Yes</span>
    </label>
    <label>
      <input type="radio" name="${escapeHtml(name)}" value="no" ${normalizedValue === 'no' ? 'checked' : ''}>
      <span>No</span>
    </label>
  </fieldset>`
}

function transportFields(response) {
  const seatsOffered = Math.max(0, Number.parseInt(response.transport_seats_offered ?? 0, 10) || 0)

  return `<fieldset>
    <legend>Transport help</legend>
    <p class="availability-summary">Staff coordinate transport manually. These answers are not shared with other parents.</p>
    ${yesNoFieldset({
      name: 'transportNeedsLift',
      legend: 'Does this player need a lift?',
      currentValue: response.transport_needs_lift === true,
    })}
    ${yesNoFieldset({
      name: 'transportCanOfferLift',
      legend: 'Can you offer a lift?',
      currentValue: response.transport_can_offer_lift === true,
    })}
    <label>
      <span>Seats offered</span>
      <input type="number" name="transportSeatsOffered" min="0" step="1" value="${escapeHtml(String(seatsOffered))}">
    </label>
  </fieldset>`
}

function responseForm({ token, response }) {
  return `
    ${detailRows(response)}
    <form method="post" action="/.netlify/functions/match-day-availability-confirm">
      <input type="hidden" name="token" value="${escapeHtml(token)}">
      ${availabilityFieldset(response)}
      ${volunteerFields(response)}
      ${transportFields(response)}
      <button type="submit">Save response</button>
    </form>
  `
}

function normalizeVolunteerParam(value) {
  const normalizedValue = normalizeText(value).toLowerCase()
  return VALID_VOLUNTEER_RESPONSES.has(normalizedValue) ? normalizedValue : null
}

function normalizeBooleanParam(value) {
  const normalizedValue = normalizeText(value).toLowerCase()

  if (normalizedValue === 'yes' || normalizedValue === 'true') {
    return true
  }

  if (normalizedValue === 'no' || normalizedValue === 'false') {
    return false
  }

  return null
}

function normalizeSeatsParam(value, canOfferLift) {
  if (canOfferLift !== true) {
    return 0
  }

  const parsedValue = Number.parseInt(String(value ?? ''), 10)

  if (!Number.isFinite(parsedValue) || parsedValue < 0) {
    return 0
  }

  return parsedValue
}

async function getTokenResponse(supabase, token) {
  const { data, error } = await supabase.rpc('get_match_day_availability_response_v2', {
    token_hash_value: hashToken(token),
  })

  if (error) {
    throw error
  }

  return data?.[0] ?? null
}

async function submitTokenResponse(supabase, token, params) {
  const status = normalizeText(params.get('status')).toLowerCase()
  const transportNeedsLift = normalizeBooleanParam(params.get('transportNeedsLift'))
  const transportCanOfferLift = normalizeBooleanParam(params.get('transportCanOfferLift'))
  const transportSeatsOffered = normalizeSeatsParam(params.get('transportSeatsOffered'), transportCanOfferLift)
  const hasVolunteerResponse = ['volunteerScorerResponse', 'volunteerLinesmanResponse', 'volunteerRefereeResponse']
    .some((key) => normalizeVolunteerParam(params.get(key)))
  const hasTransportResponse = transportNeedsLift !== null || transportCanOfferLift !== null || params.has('transportSeatsOffered')

  if (!VALID_STATUSES.has(status) && !hasVolunteerResponse && !hasTransportResponse) {
    return null
  }

  const { data, error } = await supabase.rpc('submit_match_day_availability_response', {
    token_hash_value: hashToken(token),
    status_value: VALID_STATUSES.has(status) ? status : null,
    volunteer_scorer_response_value: normalizeVolunteerParam(params.get('volunteerScorerResponse')),
    volunteer_linesman_response_value: normalizeVolunteerParam(params.get('volunteerLinesmanResponse')),
    volunteer_referee_response_value: normalizeVolunteerParam(params.get('volunteerRefereeResponse')),
    transport_needs_lift_value: transportNeedsLift,
    transport_can_offer_lift_value: transportCanOfferLift,
    transport_seats_offered_value: transportSeatsOffered,
  })

  if (error) {
    throw error
  }

  return data?.[0] ?? null
}

async function createAvailabilityEventLogEntry(event, { previousResponse, response } = {}) {
  if (!response?.request_id) {
    return
  }

  try {
    const adminSupabase = createSupabaseAdminClient(event)
    const { data: request, error: requestError } = await adminSupabase
      .from('match_day_availability_requests')
      .select('id, match_day_id, club_id, team_id, player_id, player_name, status, parent_link_id, parent_player_links:parent_link_id (auth_user_id)')
      .eq('id', response.request_id)
      .maybeSingle()

    if (requestError || !request?.id || !request.team_id) {
      if (requestError) {
        console.warn('Match Day event log request lookup failed', requestError)
      }
      return
    }

    const previousStatus = normalizeText(previousResponse?.current_availability_status || previousResponse?.response_status || '').toLowerCase()
    const nextStatus = normalizeText(response.response_status || request.status).toLowerCase()
    const parentLink = Array.isArray(request.parent_player_links)
      ? request.parent_player_links[0]
      : request.parent_player_links
    const actorUserId = normalizeText(parentLink?.auth_user_id) || null
    const { error } = await adminSupabase
      .from('match_day_event_log')
      .insert({
        club_id: request.club_id,
        team_id: request.team_id,
        match_day_id: request.match_day_id,
        player_id: request.player_id || null,
        actor_user_id: actorUserId,
        actor_display_name: actorUserId ? 'Parent response' : 'Public response link',
        actor_role: actorUserId ? 'parent_portal' : 'public_token',
        event_type: 'player_availability_changed',
        event_label: `${request.player_name || 'Player'} availability changed`,
        previous_value: previousStatus
          ? {
              status: previousStatus,
            }
          : null,
        new_value: {
          status: nextStatus,
        },
        metadata: {
          hasAuthenticatedParent: Boolean(actorUserId),
          requestId: request.id,
          source: 'match_day_availability_confirm',
          volunteerRefereeResponse: normalizeText(response.volunteer_referee_response),
          volunteerScorerResponse: normalizeText(response.volunteer_scorer_response),
          volunteerLinesmanResponse: normalizeText(response.volunteer_linesman_response),
        },
      })

    if (error) {
      console.warn('Match Day event log write failed', error)
    }
  } catch (error) {
    console.warn('Match Day event log write failed', error)
  }
}

function invalidTokenPage() {
  return htmlResponse(400, page({
    title: 'This response link is not valid',
    message: 'Ask the club to send a new fixture availability request.',
  }))
}

export async function handler(event) {
  try {
    const params = event.httpMethod === 'POST' ? getFormBody(event) : new URLSearchParams(event.queryStringParameters || {})
    const token = normalizeText(params.get('token'))

    if (!/^[a-f0-9]{64}$/i.test(token)) {
      return invalidTokenPage()
    }

    const supabase = createPublicSupabaseClient(event)

    if (event.httpMethod === 'GET') {
      const legacyStatus = normalizeText(params.get('status')).toLowerCase()

      if (legacyStatus) {
        if (!VALID_STATUSES.has(legacyStatus)) {
          return invalidTokenPage()
        }

        const previousResponse = await getTokenResponse(supabase, token)
        const response = await submitTokenResponse(supabase, token, new URLSearchParams({ status: legacyStatus }))

        if (!response?.request_id) {
          return htmlResponse(404, page({
            title: 'This response link was not found',
            message: 'Ask the club to send a new fixture availability request.',
          }))
        }

        if (normalizeText(response.response_status).toLowerCase() === 'expired') {
          return htmlResponse(410, page({
            title: 'This response link has expired',
            message: 'Ask the club to send a new fixture availability request.',
          }))
        }

        await createAvailabilityEventLogEntry(event, { previousResponse, response })

        return htmlResponse(200, page({
          title: 'Availability confirmed',
          message: `${response.player_name || 'The player'} is marked as ${statusLabel(response.response_status)}. You can close this page.`,
        }))
      }

      const response = await getTokenResponse(supabase, token)

      if (!response?.request_id) {
        return htmlResponse(404, page({
          title: 'This response link was not found',
          message: 'Ask the club to send a new fixture availability request.',
        }))
      }

      if (normalizeText(response.response_status).toLowerCase() === 'expired') {
        return htmlResponse(410, page({
          title: 'This response link has expired',
          message: 'Ask the club to send a new fixture availability request.',
        }))
      }

      return htmlResponse(200, page({
        title: 'Fixture response',
        message: 'Confirm player availability and any volunteer help requested by the team.',
        content: responseForm({ token, response }),
      }))
    }

    if (event.httpMethod !== 'POST') {
      return htmlResponse(405, page({
        title: 'Method not allowed',
        message: 'Open the fixture response link from the email.',
      }))
    }

    const previousResponse = await getTokenResponse(supabase, token)
    const submittedStatus = normalizeText(params.get('status')).toLowerCase()
    const response = await submitTokenResponse(supabase, token, params)

    if (!response?.request_id) {
      return htmlResponse(404, page({
        title: 'This response could not be saved',
        message: 'Choose an availability response or ask the club to resend the request.',
      }))
    }

    if (normalizeText(response.response_status).toLowerCase() === 'expired') {
      return htmlResponse(410, page({
        title: 'This response link has expired',
        message: 'Ask the club to send a new fixture availability request.',
      }))
    }

    if (VALID_STATUSES.has(submittedStatus)) {
      await createAvailabilityEventLogEntry(event, { previousResponse, response })
    }

    return htmlResponse(200, page({
      title: 'Response saved',
      message: VALID_STATUSES.has(submittedStatus)
        ? `${response.player_name || 'The player'} is marked as ${statusLabel(response.response_status)}. Thank you for replying.`
        : 'Your fixture response has been saved. Thank you for replying.',
    }))
  } catch (error) {
    console.error(error)
    return htmlResponse(500, page({
      title: 'Response could not be saved',
      message: 'Try the link again or ask the club to resend the request.',
    }))
  }
}
