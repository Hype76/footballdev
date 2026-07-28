import { Buffer } from 'node:buffer'
import { createHash } from 'node:crypto'
import { createSupabaseAdminClient } from './lib/_supabase.js'
import { getSafeEmailImageUrl } from '../../src/lib/email-branding.js'
import { resolveCalendarEmailAccent } from '../../src/lib/calendar-notification-email.js'

const VALID_RESPONSES = new Set(['attending', 'not_attending', 'maybe'])

function normalizeText(value) {
  return String(value ?? '').trim()
}

function hashToken(value) {
  return createHash('sha256').update(normalizeText(value)).digest('hex')
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

function responseHeaders() {
  return {
    'Cache-Control': 'no-store',
    'Content-Security-Policy': "default-src 'none'; img-src https:; style-src 'unsafe-inline'; form-action 'self'; base-uri 'none'; frame-ancestors 'none'",
    'Content-Type': 'text/html; charset=utf-8',
    'Referrer-Policy': 'no-referrer',
    'X-Content-Type-Options': 'nosniff',
    'X-Frame-Options': 'DENY',
  }
}

function htmlResponse(statusCode, body) {
  return {
    statusCode,
    headers: responseHeaders(),
    body,
  }
}

function formatDateTime(value) {
  const parsedDate = new Date(normalizeText(value))

  if (Number.isNaN(parsedDate.getTime())) {
    return 'Date and time to be confirmed'
  }

  return new Intl.DateTimeFormat('en-GB', {
    dateStyle: 'full',
    timeStyle: 'short',
    timeZone: 'Europe/London',
  }).format(parsedDate)
}

function page({
  accent = '#047857',
  clubLogoUrl = '',
  clubName = 'Your club',
  content = '',
  message,
  title,
}) {
  const safeLogoUrl = getSafeEmailImageUrl(clubLogoUrl)
  const logo = safeLogoUrl
    ? `<img src="${escapeHtml(safeLogoUrl)}" alt="${escapeHtml(clubName)} logo">`
    : `<p class="club-name">${escapeHtml(clubName)}</p>`

  return `<!doctype html>
    <html lang="en">
      <head>
        <meta charset="utf-8">
        <meta name="viewport" content="width=device-width,initial-scale=1">
        <meta name="robots" content="noindex,nofollow">
        <title>${escapeHtml(title)}</title>
        <style>
          :root { --accent: ${escapeHtml(resolveCalendarEmailAccent(accent))}; }
          * { box-sizing: border-box; }
          body { margin: 0; background: #f7faf8; color: #101828; font-family: Arial, sans-serif; }
          main { min-height: 100vh; display: flex; align-items: center; justify-content: center; padding: 20px; }
          section { max-width: 640px; width: 100%; border: 1px solid #d7e5dc; border-radius: 14px; background: #ffffff; padding: 26px; box-shadow: 0 12px 30px rgba(15, 23, 42, 0.09); }
          img { display: block; max-width: 180px; max-height: 72px; width: auto; height: auto; margin: 0 0 16px; }
          .club-name { margin: 0 0 10px; color: var(--accent); font-size: 13px; font-weight: 900; letter-spacing: 0.12em; text-transform: uppercase; }
          h1 { margin: 0 0 12px; font-size: 28px; line-height: 1.2; }
          p { color: #4b5f55; font-size: 15px; line-height: 1.6; font-weight: 700; }
          .details { margin: 20px 0; display: grid; gap: 9px; border: 1px solid #d7e5dc; border-radius: 11px; background: #f7faf8; padding: 15px; }
          .detail { display: flex; justify-content: space-between; gap: 14px; color: #4b5f55; font-size: 14px; font-weight: 800; }
          .detail strong { color: #101828; text-align: right; }
          form { margin-top: 20px; display: grid; gap: 12px; }
          label { display: flex; min-height: 48px; align-items: center; gap: 10px; border: 1px solid #d7e5dc; border-radius: 9px; padding: 11px 13px; color: #101828; font-weight: 800; }
          input { width: 19px; height: 19px; accent-color: var(--accent); }
          button { min-height: 48px; border: 0; border-radius: 9px; background: var(--accent); color: #ffffff; font-size: 15px; font-weight: 900; cursor: pointer; }
          .privacy { margin-top: 18px; font-size: 12px; }
          @media (max-width: 520px) { section { padding: 20px; } .detail { display: block; } .detail strong { display: block; margin-top: 2px; text-align: left; } }
        </style>
      </head>
      <body>
        <main>
          <section>
            ${logo}
            <h1>${escapeHtml(title)}</h1>
            <p>${escapeHtml(message)}</p>
            ${content}
          </section>
        </main>
      </body>
    </html>`
}

function unavailablePage(state = 'invalid') {
  const expired = state === 'expired'
  const revoked = state === 'revoked'
  const message = expired
    ? 'This response link has expired. Contact the club if you still need to respond.'
    : revoked
      ? 'This response link is no longer active. Contact the club for the latest event details.'
      : 'This response link is invalid or no longer available.'

  return page({
    message,
    title: 'Invitation unavailable',
  })
}

function responseForm(token, response) {
  const choices = [
    ['attending', 'Attending'],
    ['not_attending', 'Not attending'],
    ['maybe', 'Maybe'],
  ]
  const details = [
    ['Player', response.player_name],
    ['Event', response.event_title],
    ['When', formatDateTime(response.starts_at)],
    ['Location', response.location || 'To be confirmed'],
    ['Team', response.team_name || response.club_name],
  ]

  return `
    <div class="details">
      ${details.map(([label, value]) => `<div class="detail"><span>${escapeHtml(label)}</span><strong>${escapeHtml(value)}</strong></div>`).join('')}
    </div>
    <form method="post" action="/.netlify/functions/calendar-trial-rsvp">
      <input type="hidden" name="token" value="${escapeHtml(token)}">
      ${choices.map(([value, label]) => `
        <label>
          <input type="radio" name="response" value="${value}" ${response.current_response === value ? 'checked' : ''} required>
          <span>${escapeHtml(label)}</span>
        </label>
      `).join('')}
      <button type="submit">Save response</button>
    </form>
    <p class="privacy">This link only opens this event response. It does not create a Parent Portal account or provide access to player history.</p>
  `
}

async function getInvitation(supabase, token) {
  const { data, error } = await supabase.rpc('get_calendar_trial_event_response', {
    token_hash_value: hashToken(token),
  })

  if (error) {
    throw error
  }

  return data?.[0] || { response_state: 'invalid' }
}

async function submitInvitation(supabase, token, responseValue) {
  const { data, error } = await supabase.rpc('submit_calendar_trial_event_response', {
    response_value: responseValue,
    token_hash_value: hashToken(token),
  })

  if (error) {
    throw error
  }

  return data?.[0] || { response_state: 'invalid' }
}

export async function handler(event) {
  if (!['GET', 'POST'].includes(event.httpMethod)) {
    return htmlResponse(405, unavailablePage('invalid'))
  }

  try {
    const params = event.httpMethod === 'POST'
      ? getFormBody(event)
      : new URLSearchParams(event.queryStringParameters || {})
    const token = normalizeText(params.get('token'))

    if (!/^[0-9a-f]{64}$/i.test(token)) {
      return htmlResponse(404, unavailablePage('invalid'))
    }

    const supabase = createSupabaseAdminClient(event)
    let invitation

    if (event.httpMethod === 'POST') {
      const responseValue = normalizeText(params.get('response')).toLowerCase()

      if (!VALID_RESPONSES.has(responseValue)) {
        return htmlResponse(400, unavailablePage('invalid'))
      }

      invitation = await submitInvitation(supabase, token, responseValue)
    } else {
      invitation = await getInvitation(supabase, token)
    }

    if (!['available', 'responded'].includes(invitation.response_state)) {
      return htmlResponse(410, unavailablePage(invitation.response_state))
    }

    const savedMessage = event.httpMethod === 'POST'
      ? 'Your response has been saved. You can safely use this link again if the answer changes.'
      : 'Confirm whether the trial player can attend this event.'

    return htmlResponse(200, page({
      accent: invitation.theme_accent,
      clubLogoUrl: invitation.club_logo_url,
      clubName: invitation.club_name,
      content: responseForm(token, invitation),
      message: savedMessage,
      title: event.httpMethod === 'POST' ? 'Response saved' : 'Event invitation',
    }))
  } catch (error) {
    console.error('Trial Calendar RSVP failed', {
      code: normalizeText(error?.code).slice(0, 80),
      message: normalizeText(error?.message).slice(0, 300),
    })
    return htmlResponse(500, page({
      message: 'The response could not be loaded. Please try again later.',
      title: 'Invitation unavailable',
    }))
  }
}
