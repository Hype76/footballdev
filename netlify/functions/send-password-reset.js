import { createHmac } from 'node:crypto'
import process from 'node:process'
import { createFromAddress, sendEmail } from './lib/_email-provider.js'
import { buildEmailLogoMarkup } from '../../src/lib/email-branding.js'

const ALLOWED_BODY_KEYS = new Set(['email'])
const APPROVED_PRODUCTION_ORIGINS = new Set([
  'https://footballplayer.online',
  'https://parent.footballplayer.online',
])
const APPROVED_LOCAL_ORIGINS = new Set([
  'http://127.0.0.1:5173',
  'http://localhost:5173',
])
const GENERIC_RESPONSE = Object.freeze({
  success: true,
  message: 'If that account exists, password recovery instructions will be sent.',
})

function jsonResponse(statusCode, payload) {
  return {
    statusCode,
    headers: {
      'Cache-Control': 'no-store, max-age=0',
      'Content-Type': 'application/json; charset=utf-8',
      'X-Content-Type-Options': 'nosniff',
    },
    body: JSON.stringify(payload),
  }
}

function normalizeText(value) {
  return String(value ?? '').trim()
}

function normalizeEmail(value) {
  return normalizeText(value).toLowerCase()
}

function isValidEmail(value) {
  return /^[^\s@<>]+@[^\s@<>]+\.[^\s@<>]+$/.test(normalizeText(value))
}

function escapeHtml(value) {
  return String(value ?? '')
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#039;')
}

function safeLog(level, event, details = {}) {
  const logger = console[level] || console.info
  logger(JSON.stringify({ event, ...details }))
}

function parseBody(event) {
  let body

  try {
    body = JSON.parse(event.body || '{}')
  } catch {
    return null
  }

  if (!body || Array.isArray(body) || typeof body !== 'object') {
    return null
  }

  if (Object.keys(body).some((key) => !ALLOWED_BODY_KEYS.has(key))) {
    return null
  }

  return body
}

function parseExactOrigin(value) {
  const normalizedValue = normalizeText(value)

  if (!normalizedValue || /[%\\]/.test(normalizedValue)) {
    return ''
  }

  try {
    const url = new URL(normalizedValue)

    if (
      url.origin !== normalizedValue ||
      url.username ||
      url.password ||
      url.hash ||
      url.search ||
      url.pathname !== '/'
    ) {
      return ''
    }

    return url.origin
  } catch {
    return ''
  }
}

export function resolveRecoveryRedirect({ isProduction = false, requestOrigin = '' } = {}) {
  const origin = parseExactOrigin(requestOrigin)

  if (APPROVED_PRODUCTION_ORIGINS.has(origin)) {
    return 'https://footballplayer.online/reset-password'
  }

  if (!isProduction && APPROVED_LOCAL_ORIGINS.has(origin)) {
    return `${origin}/reset-password`
  }

  return ''
}

function createPrivacyDigest(value, secret, purpose) {
  return createHmac('sha256', secret)
    .update(`${purpose}\0${normalizeText(value)}`)
    .digest('hex')
}

function getTrustedClientIp(event, context) {
  const contextIp = normalizeText(context?.ip || context?.clientIp)

  if (contextIp) {
    return contextIp
  }

  if (String(process.env.NETLIFY ?? '').toLowerCase() === 'true') {
    return normalizeText(event.headers?.['x-nf-client-connection-ip']) || 'netlify-unknown'
  }

  return 'local-development'
}

function buildResetEmail({ actionLink }) {
  return `
    <div style="font-family:Arial,sans-serif;max-width:620px;margin:0 auto;padding:24px;color:#101828;">
      ${buildEmailLogoMarkup({ altText: 'Football Player', origin: 'https://footballplayer.online' })}
      <p style="margin:0 0 8px;color:#047857;font-size:12px;font-weight:900;letter-spacing:0.16em;text-transform:uppercase;">Football Player</p>
      <h1 style="margin:0 0 12px;font-size:26px;line-height:1.15;">Reset your password</h1>
      <p style="margin:0 0 20px;color:#4b5f55;font-size:15px;line-height:1.6;font-weight:700;">Use this secure link to choose a new password.</p>
      <p style="margin:0 0 22px;">
        <a href="${escapeHtml(actionLink)}" style="display:inline-block;padding:12px 16px;background:#047857;color:#ffffff;text-decoration:none;border-radius:8px;font-weight:900;">Reset password</a>
      </p>
      <p style="margin:20px 0 0;color:#64748b;font-size:12px;line-height:1.5;">If you did not request this, ignore this email.</p>
    </div>
  `
}

async function waitForMinimumDuration(startedAt, minimumMs, sleep) {
  const remaining = minimumMs - (Date.now() - startedAt)

  if (remaining > 0) {
    await sleep(remaining)
  }
}

export function createPasswordRecoveryHandler({
  createAdminClient = null,
  sendRecoveryEmail = sendEmail,
  sleep = (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds)),
} = {}) {
  return async function passwordRecoveryHandler(event = {}, context = {}) {
    if (event.httpMethod !== 'POST') {
      return jsonResponse(405, { success: false, message: 'Method not allowed.' })
    }

    const startedAt = Date.now()
    const body = parseBody(event)
    const email = normalizeEmail(body?.email)
    const requestOrigin = normalizeText(event.headers?.origin || event.headers?.Origin)
    const isProduction = normalizeText(process.env.CONTEXT).toLowerCase() === 'production'
    const redirectTo = resolveRecoveryRedirect({ isProduction, requestOrigin })

    if (!body || !isValidEmail(email) || !redirectTo) {
      return jsonResponse(400, {
        success: false,
        message: 'Password recovery request could not be accepted.',
      })
    }

    try {
      const adminClientFactory = createAdminClient || (await import('./lib/_supabase.js')).createSupabaseAdminClient
      const supabaseAdmin = adminClientFactory(event)
      const digestSecret = normalizeText(process.env.SUPABASE_SERVICE_ROLE_KEY)

      if (!digestSecret) {
        safeLog('error', 'password_recovery_configuration_unavailable')
        await waitForMinimumDuration(startedAt, 250, sleep)
        return jsonResponse(200, GENERIC_RESPONSE)
      }

      const emailDigest = createPrivacyDigest(email, digestSecret, 'password-recovery-email')
      const ipDigest = createPrivacyDigest(
        getTrustedClientIp(event, context),
        digestSecret,
        'password-recovery-ip',
      )
      const { data: rateLimitResult, error: rateLimitError } = await supabaseAdmin.rpc(
        'consume_password_recovery_rate_limit',
        {
          p_email_digest: emailDigest,
          p_email_limit: 3,
          p_ip_digest: ipDigest,
          p_ip_limit: 20,
          p_window_seconds: 900,
        },
      )

      if (rateLimitError || rateLimitResult?.allowed !== true) {
        safeLog(rateLimitError ? 'error' : 'warn', 'password_recovery_request_suppressed', {
          reason: rateLimitError ? 'rate_limit_unavailable' : 'rate_limited',
        })
        await waitForMinimumDuration(startedAt, 250, sleep)
        return jsonResponse(200, GENERIC_RESPONSE)
      }

      const { data, error } = await supabaseAdmin.auth.admin.generateLink({
        type: 'recovery',
        email,
        options: { redirectTo },
      })
      const actionLink = data?.properties?.action_link

      if (!error && actionLink) {
        try {
          await sendRecoveryEmail({
            from: createFromAddress('Football Player'),
            to: [email],
            subject: 'Reset your Football Player password',
            html: buildResetEmail({ actionLink }),
          }, {
            context: {
              emailType: 'password_reset',
              targetEntityType: 'auth_user',
            },
            publicMessage: GENERIC_RESPONSE.message,
          })
        } catch {
          safeLog('error', 'password_recovery_delivery_failed')
        }
      } else {
        safeLog('info', 'password_recovery_account_not_actionable')
      }
    } catch {
      safeLog('error', 'password_recovery_request_failed')
    }

    await waitForMinimumDuration(startedAt, 250, sleep)
    return jsonResponse(200, GENERIC_RESPONSE)
  }
}

export const handler = createPasswordRecoveryHandler()
