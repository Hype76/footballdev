import process from 'node:process'
import { timingSafeEqual } from 'node:crypto'

const JSON_HEADERS = {
  'Content-Type': 'application/json',
  'Cache-Control': 'no-store',
}

function normalizeText(value) {
  return String(value ?? '').trim()
}

function envValue(name) {
  return globalThis.Netlify?.env?.get?.(name) || process.env[name]
}

function jsonResponse(statusCode, payload) {
  return {
    statusCode,
    headers: JSON_HEADERS,
    body: JSON.stringify(payload),
  }
}

function constantTimeEqual(left, right) {
  const encoder = new TextEncoder()
  const leftBuffer = encoder.encode(left)
  const rightBuffer = encoder.encode(right)

  return leftBuffer.length === rightBuffer.length && timingSafeEqual(leftBuffer, rightBuffer)
}

function getBearerToken(event = {}) {
  const header = normalizeText(event.headers?.authorization || event.headers?.Authorization)
  return header.startsWith('Bearer ') ? normalizeText(header.slice(7)) : ''
}

export function authorizeProcessorRequest(event = {}, {
  secretName = 'FOOTBALL_PLAYER_SCHEDULER_SECRET',
} = {}) {
  if (event.httpMethod !== 'POST') {
    return {
      ok: false,
      response: jsonResponse(405, { success: false, message: 'Method Not Allowed' }),
    }
  }

  const contentType = normalizeText(event.headers?.['content-type'] || event.headers?.['Content-Type']).toLowerCase()

  if (!contentType.startsWith('application/json')) {
    return {
      ok: false,
      response: jsonResponse(415, { success: false, message: 'Unsupported Media Type' }),
    }
  }

  const configuredSecret = normalizeText(envValue(secretName))
  const providedSecret = getBearerToken(event)

  if (!configuredSecret) {
    console.warn('Processor request rejected', { reason: 'scheduler_configuration_missing' })
    return {
      ok: false,
      response: jsonResponse(503, { success: false, message: 'Processor unavailable.' }),
    }
  }

  if (!providedSecret || !constantTimeEqual(configuredSecret, providedSecret)) {
    console.warn('Processor request rejected', { reason: 'scheduler_authentication_failed' })
    return {
      ok: false,
      response: jsonResponse(401, { success: false, message: 'Unauthorized' }),
    }
  }

  let body = {}

  try {
    body = event.body ? JSON.parse(event.body) : {}
  } catch {
    return {
      ok: false,
      response: jsonResponse(400, { success: false, message: 'Invalid request.' }),
    }
  }

  if (body && typeof body === 'object' && Object.keys(body).length > 0) {
    return {
      ok: false,
      response: jsonResponse(400, { success: false, message: 'Request parameters are not accepted.' }),
    }
  }

  return { ok: true, body }
}

export function rejectDirectScheduledFunctionRequest(event = {}) {
  if (!event.httpMethod) {
    return null
  }

  console.warn('Scheduled function HTTP request rejected', { reason: 'platform_schedule_required' })
  return jsonResponse(404, { success: false, message: 'Not Found' })
}
