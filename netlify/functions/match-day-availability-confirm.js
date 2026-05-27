import { createHash } from 'node:crypto'
import process from 'node:process'
import { createClient } from '@supabase/supabase-js'

const VALID_STATUSES = new Set(['available', 'unavailable', 'maybe'])
const STAGING_SUPABASE_URL = 'https://llpufwzvgxyczxcjwupu.supabase.co'
const STAGING_SUPABASE_PUBLISHABLE_KEY = 'sb_publishable_4b2Gtqn6MFrPBrrxwnXzQA_cFfnd8BZ'

function normalizeText(value) {
  return String(value ?? '').trim()
}

function hashToken(token) {
  return createHash('sha256').update(token).digest('hex')
}

function isStagingHost(event) {
  const host = normalizeText(event.headers['x-forwarded-host'] || event.headers.host).toLowerCase()
  return host.includes('staging.footballplayer.online') || host.includes('football-os-staging')
}

function createPublicSupabaseClient(event) {
  const useStaging = isStagingHost(event)
  const supabaseUrl = useStaging ? STAGING_SUPABASE_URL : process.env.VITE_SUPABASE_URL
  const publishableKey = useStaging ? STAGING_SUPABASE_PUBLISHABLE_KEY : process.env.VITE_SUPABASE_PUBLISHABLE_KEY

  if (!supabaseUrl || !publishableKey) {
    throw new Error('Supabase environment is not configured.')
  }

  return createClient(supabaseUrl, publishableKey, {
    auth: {
      persistSession: false,
      autoRefreshToken: false,
    },
  })
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

    const supabase = createPublicSupabaseClient(event)
    const { data: responseRows, error: responseError } = await supabase.rpc('confirm_match_day_availability', {
      token_hash_value: hashToken(token),
      status_value: status,
    })

    if (responseError) {
      throw responseError
    }

    const response = responseRows?.[0] ?? null

    if (!response?.request_id) {
      return htmlResponse(404, page({
        title: 'This response link was not found',
        message: 'Ask the club to send a new fixture availability request.',
      }))
    }

    if (response.response_status === 'expired') {
      return htmlResponse(410, page({
        title: 'This response link has expired',
        message: 'Ask the club to send a new fixture availability request.',
      }))
    }

    const statusLabel = status === 'unavailable' ? 'not available' : status

    return htmlResponse(200, page({
      title: 'Availability confirmed',
      message: `${response.player_name || 'The player'} is marked as ${statusLabel}. You can close this page.`,
    }))
  } catch (error) {
    console.error(error)
    return htmlResponse(500, page({
      title: 'Response could not be saved',
      message: 'Try the link again or ask the club to resend the request.',
    }))
  }
}
