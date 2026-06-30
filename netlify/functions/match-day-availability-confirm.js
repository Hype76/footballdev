import { createHash } from 'node:crypto'
import { Buffer } from 'node:buffer'
import { createPublicSupabaseClient } from './lib/_supabase.js'

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
  `).join('')}</div>`
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

function responseForm({ token, response }) {
  return `
    ${detailRows(response)}
    <form method="post" action="/.netlify/functions/match-day-availability-confirm">
      <input type="hidden" name="token" value="${escapeHtml(token)}">
      ${availabilityFieldset(response)}
      ${volunteerFields(response)}
      <button type="submit">Save response</button>
    </form>
  `
}

function normalizeVolunteerParam(value) {
  const normalizedValue = normalizeText(value).toLowerCase()
  return VALID_VOLUNTEER_RESPONSES.has(normalizedValue) ? normalizedValue : null
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
  const hasVolunteerResponse = ['volunteerScorerResponse', 'volunteerLinesmanResponse', 'volunteerRefereeResponse']
    .some((key) => normalizeVolunteerParam(params.get(key)))

  if (!VALID_STATUSES.has(status) && !hasVolunteerResponse) {
    return null
  }

  const { data, error } = await supabase.rpc('submit_match_day_availability_response', {
    token_hash_value: hashToken(token),
    status_value: VALID_STATUSES.has(status) ? status : null,
    volunteer_scorer_response_value: normalizeVolunteerParam(params.get('volunteerScorerResponse')),
    volunteer_linesman_response_value: normalizeVolunteerParam(params.get('volunteerLinesmanResponse')),
    volunteer_referee_response_value: normalizeVolunteerParam(params.get('volunteerRefereeResponse')),
  })

  if (error) {
    throw error
  }

  return data?.[0] ?? null
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

    return htmlResponse(200, page({
      title: 'Response saved',
      message: VALID_STATUSES.has(normalizeText(params.get('status')).toLowerCase())
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
