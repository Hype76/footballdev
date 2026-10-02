import process from 'node:process'
import { createHash } from 'node:crypto'
import { Buffer } from 'node:buffer'
import { createFromAddress, sendEmail } from './lib/_email-provider.js'
import { buildEmailLogoMarkup } from '../../src/lib/email-branding.js'

const DRAFT_ORIGIN = 'https://football-player-new-website-draft.jasonkeegansl.chatgpt.site'
const ALLOWED_ORIGINS = new Set([DRAFT_ORIGIN, 'https://footballplayer.online', 'https://www.footballplayer.online'])
const MAX_BODY_BYTES = 16 * 1024
const WINDOW_MS = 180_000
const FAILURE_MESSAGE = 'Contact request could not be sent. Please try again in a moment.'

export const config = {
  path: '/.netlify/functions/send-contact-request',
  rateLimit: { windowLimit: 12, windowSize: 180, aggregateBy: ['ip', 'domain'] },
}

function isValidEmail(value) {
  return /^[^\s@<>(),;:"\\]+@[^\s@<>(),;:"\\]+\.[^\s@<>(),;:"\\]+$/.test(value)
}

function digest(value) {
  return createHash('sha256').update(value).digest('hex')
}

// An immediate, bounded warm-instance guard complements Netlify's distributed limit.
// It is not a durable or globally strict limit. Never trust client forwarding headers.
export function createContactRateGuard({ now = Date.now, maxEntries = 4096 } = {}) {
  const entries = new Map()
  return (ip) => {
    const time = now()
    for (const [key, entry] of entries) if (entry.expires <= time) entries.delete(key)
    const key = digest(ip || 'unknown')
    let entry = entries.get(key)
    if (!entry) {
      if (entries.size >= maxEntries) return 180
      entry = { count: 0, expires: time + WINDOW_MS }
      entries.set(key, entry)
    }
    if (entry.count >= 3) return Math.max(1, Math.ceil((entry.expires - time) / 1000))
    entry.count += 1
    return 0
  }
}

async function readBoundedJson(request) {
  const declared = request.headers.get('content-length')
  if (declared && (!/^\d+$/.test(declared) || Number(declared) > MAX_BODY_BYTES)) {
    throw Object.assign(new Error('Request is too large'), { status: 413 })
  }
  const reader = request.body?.getReader()
  if (!reader) throw Object.assign(new Error('A JSON object is required'), { status: 400 })
  const chunks = []
  let size = 0
  while (true) {
    const { done, value } = await reader.read()
    if (done) break
    size += value.byteLength
    if (size > MAX_BODY_BYTES) {
      await reader.cancel()
      throw Object.assign(new Error('Request is too large'), { status: 413 })
    }
    chunks.push(Buffer.from(value))
  }
  try {
    const body = JSON.parse(Buffer.concat(chunks).toString('utf8'))
    if (!body || typeof body !== 'object' || Array.isArray(body)) throw new Error()
    return body
  } catch {
    throw Object.assign(new Error('A JSON object is required'), { status: 400 })
  }
}

function field(body, key, max, { required = false, multiline = false } = {}) {
  const raw = body[key] ?? ''
  if (typeof raw !== 'string' || raw.length > max ||
      [...raw].some((character) => {
        const code = character.charCodeAt(0)
        return (code < 32 || code === 127) && !(multiline && [9, 10, 13].includes(code))
      })) {
    throw Object.assign(new Error(`Invalid ${key}`), { status: 400 })
  }
  const value = raw.trim()
  if (required && !value) throw Object.assign(new Error(`${key} is required`), { status: 400 })
  return value
}

function escapeHtml(value) {
  return String(value ?? '')
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#039;')
}

function buildContactRequestHtml({ name, email, phone, message, sourcePath, clubTeam }) {
  const rows = [
    ['Name', name],
    ['Email', email],
    ['Phone number', phone || 'Not provided'],
    ['Page', sourcePath || 'Not recorded'],
    ...(clubTeam ? [['Club/team', clubTeam]] : []),
  ]

  return `
    <div style="font-family: Arial, sans-serif; color: #111827; line-height: 1.5; padding: 24px;">
      <div style="max-width: 640px; margin: 0 auto; border: 1px solid #e5e7eb; border-radius: 18px; overflow: hidden;">
        <div style="background: #101510; color: #ffffff; padding: 24px;">
          ${buildEmailLogoMarkup({ altText: 'Football Player' })}
          <p style="margin: 0 0 8px; color: #d8ff2f; font-size: 12px; font-weight: 700; letter-spacing: 0.18em; text-transform: uppercase;">Football Player</p>
          <h1 style="margin: 0; font-size: 24px;">New contact request</h1>
        </div>
        <div style="padding: 24px; background: #ffffff;">
          <p style="margin: 0 0 18px;">A visitor sent a message from the Football Player website.</p>
          <table style="width: 100%; border-collapse: collapse;">
            <tbody>
              ${rows
                .map(
                  ([label, value]) => `
                    <tr>
                      <td style="width: 180px; padding: 12px; border-bottom: 1px solid #e5e7eb; color: #4b5563; font-weight: 700;">${escapeHtml(label)}</td>
                      <td style="padding: 12px; border-bottom: 1px solid #e5e7eb;">${escapeHtml(value)}</td>
                    </tr>
                  `,
                )
                .join('')}
            </tbody>
          </table>
          <div style="margin-top: 20px;">
            <p style="margin: 0 0 8px; color: #4b5563; font-size: 14px; font-weight: 700;">Message</p>
            <div style="white-space: pre-line; border: 1px solid #e5e7eb; border-radius: 12px; padding: 14px;">${escapeHtml(message || 'No message entered')}</div>
          </div>
          <p style="margin: 20px 0 0; color: #4b5563; font-size: 14px;">Reply directly to this email to contact the visitor.</p>
          <div style="border-top: 1px solid #e5e7eb; margin-top: 20px; padding-top: 14px;">
            <p style="margin: 0; color: #6b7280; font-size: 11px; line-height: 1.45;">Powered by Football Player | footballplayer.online</p>
          </div>
        </div>
      </div>
    </div>
  `
}

export function createContactHandler({ send = sendEmail, env = process.env, rateGuard = createContactRateGuard() } = {}) {
  return async (request, context = {}) => {
    const origin = request.headers.get('origin')
    const headers = { 'Content-Type': 'application/json', 'Cache-Control': 'no-store', Vary: 'Origin' }
    const json = (status, payload, extra = {}) => new Response(JSON.stringify(payload), { status, headers: { ...headers, ...extra } })
    const fail = (status, message, extra) => json(status, { success: false, message }, extra)
    if (origin && !ALLOWED_ORIGINS.has(origin)) return fail(403, 'Origin is not allowed')
    if (origin) {
      headers['Access-Control-Allow-Origin'] = origin
      headers['Access-Control-Expose-Headers'] = 'Retry-After'
      headers['Cross-Origin-Resource-Policy'] = 'cross-origin'
    }
    if (request.method === 'OPTIONS') {
      const method = request.headers.get('access-control-request-method')
      const requestedHeaders = (request.headers.get('access-control-request-headers') || '')
        .split(',').map((value) => value.trim().toLowerCase()).filter(Boolean)
      if (method !== 'POST' || requestedHeaders.some((value) => value !== 'content-type')) {
        return fail(403, 'Preflight is not allowed')
      }
      return new Response(null, { status: 204, headers: { ...headers,
        'Access-Control-Allow-Methods': 'POST', 'Access-Control-Allow-Headers': 'Content-Type',
        'Access-Control-Max-Age': '600', Vary: 'Origin, Access-Control-Request-Method, Access-Control-Request-Headers' } })
    }
    if (request.method !== 'POST') return fail(405, 'Method Not Allowed', { Allow: 'POST, OPTIONS' })
    if (!/^application\/json(?:\s*;|$)/i.test(request.headers.get('content-type') || '')) return fail(415, 'Content-Type must be application/json')
    const retryAfter = rateGuard(context.ip)
    if (retryAfter) return fail(429, 'Too many contact requests. Please wait and try again.', { 'Retry-After': String(retryAfter) })
    let values
    let submissionId
    try {
      const body = await readBoundedJson(request)
      values = {
        name: field(body, 'name', 120, { required: true }),
        email: field(body, 'email', 254, { required: true }).toLowerCase(),
        phone: field(body, 'phone', 50),
        message: field(body, 'message', 5000, { multiline: true, required: origin === DRAFT_ORIGIN }),
        sourcePath: field(body, 'sourcePath', 1024),
        clubTeam: field(body, 'clubTeam', 160),
      }
      if (!isValidEmail(values.email)) return fail(400, 'A valid email is required')
      if (field(body, 'website', 200)) return fail(400, 'Contact request could not be accepted')
      submissionId = field(body, 'submissionId', 64)
      if (submissionId && !/^[a-zA-Z0-9_-]{16,64}$/.test(submissionId)) return fail(400, 'Invalid submissionId')
      if (origin === DRAFT_ORIGIN && !submissionId) return fail(400, 'submissionId is required')
    } catch (error) {
      return fail(error.status || 400, error.status ? error.message : 'Invalid request body')
    }
    const recipient = String(env.CONTACT_REQUEST_RECIPIENT || 'support@jelumalabs.com').trim()
    if (!isValidEmail(recipient)) return fail(503, 'Contact service is not configured')
    try {
      // Resend retains keys for 24 hours. Retries must retain the ID and complete payload.
      // Legacy callers without an ID deduplicate identical normalized submissions for that period.
      const idempotencyKey = `contact-${digest(JSON.stringify([recipient, submissionId, values]))}`
      const response = await send({
        emailAppRole: 'both',
        from: createFromAddress('Football Player Contact', env),
        to: [recipient],
        reply_to: values.email,
        subject: `Website Contact: ${values.name}`,
        html: buildContactRequestHtml(values),
      }, {
        env,
        idempotencyKey,
        context: { emailType: 'system_support_email', actorEmail: values.email, targetEntityType: 'public_contact_request' },
        publicMessage: FAILURE_MESSAGE,
      })
      const id = response?.data?.id || response?.id
      if (!id || response?.error) return fail(502, FAILURE_MESSAGE)
      return json(200, { success: true, id })
    } catch (error) {
      // Never echo or log provider internals or visitor content at this public boundary.
      const status = [429, 500, 502, 503, 504].includes(error.statusCode) ? error.statusCode : 502
      return fail(status, FAILURE_MESSAGE)
    }
  }
}

export default createContactHandler()
