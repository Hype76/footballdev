import { createHash } from 'node:crypto'
import { Buffer } from 'node:buffer'
import { createPublicSupabaseClient } from './lib/_supabase.js'

const VALID_STATUSES = new Set(['available', 'unavailable', 'maybe'])

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

  return status || 'no response'
}

function formatReadableDateTime(value) {
  const parsedDate = new Date(value)

  if (Number.isNaN(parsedDate.getTime())) {
    return 'Time to be confirmed'
  }

  return new Intl.DateTimeFormat('en-GB', {
    dateStyle: 'full',
    timeStyle: 'short',
  }).format(parsedDate)
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
          textarea { min-height: 96px; border: 1px solid #d7e5dc; border-radius: 10px; padding: 12px; color: #101828; font: inherit; font-weight: 700; resize: vertical; }
          input[type="radio"] { width: 18px; height: 18px; accent-color: #047857; }
          button { min-height: 44px; border: 0; border-radius: 8px; background: #047857; color: #ffffff; font-weight: 900; font-size: 15px; cursor: pointer; }
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
    ['Team', response.team_name || 'Team'],
    ['Training', response.event_title || 'Training session'],
    ['When', formatReadableDateTime(response.occurrence_starts_at)],
    ['Location', response.location || 'Not set'],
  ]

  return `<div class="details">${rows.map(([label, value]) => `
    <div class="detail"><span>${escapeHtml(label)}</span><strong>${escapeHtml(value)}</strong></div>
  `).join('')}</div>`
}

function availabilityFieldset(response) {
  const currentStatus = normalizeText(response.response_status).toLowerCase()
  const choices = [
    ['available', 'Available'],
    ['unavailable', 'Not available'],
    ['maybe', 'Maybe'],
  ]

  return `<fieldset>
    <legend>Player availability</legend>
    ${choices.map(([value, label]) => `
      <label>
        <input type="radio" name="status" value="${value}" ${currentStatus === value ? 'checked' : ''} required>
        <span>${label}</span>
      </label>
    `).join('')}
  </fieldset>`
}

function responseForm({ token, response }) {
  return `
    ${detailRows(response)}
    <p style="margin-top:16px;color:#4b5f55;font-size:14px;line-height:1.5;font-weight:700;">This availability response is for this session only.</p>
    <form method="post" action="/.netlify/functions/training-availability-response">
      <input type="hidden" name="token" value="${escapeHtml(token)}">
      ${availabilityFieldset(response)}
      <label style="display:grid;gap:8px;">
        <span>Optional note</span>
        <textarea name="note" maxlength="1000">${escapeHtml(response.response_note || '')}</textarea>
      </label>
      <button type="submit">Save response</button>
    </form>
  `
}

function invalidTokenPage() {
  return htmlResponse(400, page({
    title: 'This response link is not valid',
    message: 'Ask the club to send a new training availability request.',
  }))
}

function staleLinkPage() {
  return htmlResponse(410, page({
    title: 'This response link has expired',
    message: 'This training session is no longer available or has been removed. Ask the club to send a new training availability request if they still need a reply.',
  }))
}

function isMissingCalendarEventError(error) {
  const errorText = `${normalizeText(error?.message)} ${normalizeText(error?.details)} ${normalizeText(error?.constraint)}`

  return error?.code === '23503'
    && errorText.includes('training_availability_responses_calendar_event_id_fkey')
}

function logStaleResponseLink(reason, event) {
  console.warn('Training availability stale response link', {
    reason,
    method: normalizeText(event?.httpMethod || 'GET'),
    statusCode: 410,
  })
}

async function getTokenResponse(supabase, token) {
  const { data, error } = await supabase.rpc('get_training_availability_response', {
    token_hash_value: hashToken(token),
  })

  if (error) {
    throw error
  }

  return data?.[0] ?? null
}

async function submitTokenResponse(supabase, token, params) {
  const status = normalizeText(params.get('status')).toLowerCase()

  if (!VALID_STATUSES.has(status)) {
    return null
  }

  const { data, error } = await supabase.rpc('submit_training_availability_response', {
    token_hash_value: hashToken(token),
    status_value: status,
    note_value: normalizeText(params.get('note')),
  })

  if (error) {
    throw error
  }

  return data?.[0] ?? null
}

export async function handler(event, { supabaseClient = null } = {}) {
  try {
    const params = event.httpMethod === 'POST' ? getFormBody(event) : new URLSearchParams(event.queryStringParameters || {})
    const token = normalizeText(params.get('token'))

    if (!/^[a-f0-9]{64}$/i.test(token)) {
      return invalidTokenPage()
    }

    const supabase = supabaseClient || createPublicSupabaseClient(event)

    if (event.httpMethod === 'GET') {
      const response = await getTokenResponse(supabase, token)

      if (!response?.request_player_id) {
        logStaleResponseLink('response_lookup_empty', event)
        return staleLinkPage()
      }

      return htmlResponse(200, page({
        title: 'Training response',
        message: 'Confirm player availability for this training session.',
        content: responseForm({ token, response }),
      }))
    }

    if (event.httpMethod !== 'POST') {
      return htmlResponse(405, page({
        title: 'Method not allowed',
        message: 'Open the training availability link from the email.',
      }))
    }

    const existingResponse = await getTokenResponse(supabase, token)

    if (!existingResponse?.request_player_id) {
      logStaleResponseLink('response_preflight_empty', event)
      return staleLinkPage()
    }

    const response = await submitTokenResponse(supabase, token, params)

    if (!response?.request_player_id) {
      logStaleResponseLink('response_submit_empty', event)
      return staleLinkPage()
    }

    return htmlResponse(200, page({
      title: 'Response saved',
      message: `${response.player_name || 'The player'} is marked as ${statusLabel(response.response_status)}. Thank you for replying.`,
    }))
  } catch (error) {
    if (isMissingCalendarEventError(error)) {
      logStaleResponseLink('missing_calendar_event_fk', event)
      return staleLinkPage()
    }

    console.error(error)
    return htmlResponse(500, page({
      title: 'Response could not be saved',
      message: 'Try the link again or ask the club to resend the request.',
    }))
  }
}
