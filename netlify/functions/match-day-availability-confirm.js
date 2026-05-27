import { createHash } from 'node:crypto'
import { supabaseAdmin } from './_supabase.js'

const VALID_STATUSES = new Set(['available', 'unavailable', 'maybe'])

function normalizeText(value) {
  return String(value ?? '').trim()
}

function hashToken(token) {
  return createHash('sha256').update(token).digest('hex')
}

function htmlResponse(statusCode, body) {
  return {
    statusCode,
    headers: { 'Content-Type': 'text/html; charset=utf-8' },
    body,
  }
}

function page({ title, message }) {
  return `<!doctype html>
    <html lang="en">
      <head>
        <meta charset="utf-8">
        <meta name="viewport" content="width=device-width,initial-scale=1">
        <title>${title}</title>
      </head>
      <body style="margin:0;background:#f7faf8;color:#101828;font-family:Arial,sans-serif;">
        <main style="min-height:100vh;display:flex;align-items:center;justify-content:center;padding:24px;">
          <section style="max-width:560px;width:100%;border:1px solid #d7e5dc;border-radius:12px;background:#ffffff;padding:28px;box-shadow:0 12px 30px rgba(4,120,87,0.12);">
            <p style="margin:0 0 10px;color:#047857;font-size:12px;font-weight:900;letter-spacing:0.18em;text-transform:uppercase;">Football Player</p>
            <h1 style="margin:0 0 12px;font-size:28px;line-height:1.15;">${title}</h1>
            <p style="margin:0;color:#4b5f55;font-size:16px;line-height:1.6;font-weight:700;">${message}</p>
          </section>
        </main>
      </body>
    </html>`
}

export async function handler(event) {
  try {
    const token = normalizeText(event.queryStringParameters?.token)
    const status = normalizeText(event.queryStringParameters?.status).toLowerCase()

    if (!/^[a-f0-9]{64}$/i.test(token) || !VALID_STATUSES.has(status)) {
      return htmlResponse(400, page({
        title: 'This response link is not valid',
        message: 'Ask the club to send a new fixture availability request.',
      }))
    }

    const { data: request, error: requestError } = await supabaseAdmin
      .from('match_day_availability_requests')
      .select('id, player_name, expires_at, status')
      .eq('token_hash', hashToken(token))
      .maybeSingle()

    if (requestError) {
      throw requestError
    }

    if (!request?.id) {
      return htmlResponse(404, page({
        title: 'This response link was not found',
        message: 'Ask the club to send a new fixture availability request.',
      }))
    }

    if (request.expires_at && new Date(request.expires_at).getTime() < Date.now()) {
      await supabaseAdmin
        .from('match_day_availability_requests')
        .update({ status: 'expired', updated_at: new Date().toISOString() })
        .eq('id', request.id)

      return htmlResponse(410, page({
        title: 'This response link has expired',
        message: 'Ask the club to send a new fixture availability request.',
      }))
    }

    const { error: updateError } = await supabaseAdmin
      .from('match_day_availability_requests')
      .update({
        status,
        responded_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      })
      .eq('id', request.id)

    if (updateError) {
      throw updateError
    }

    const statusLabel = status === 'unavailable' ? 'not available' : status

    return htmlResponse(200, page({
      title: 'Availability confirmed',
      message: `${request.player_name || 'The player'} is marked as ${statusLabel}. You can close this page.`,
    }))
  } catch (error) {
    console.error(error)
    return htmlResponse(500, page({
      title: 'Response could not be saved',
      message: 'Try the link again or ask the club to resend the request.',
    }))
  }
}
