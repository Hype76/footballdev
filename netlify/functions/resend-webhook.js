import { createHash } from 'node:crypto'
import { Buffer } from 'node:buffer'
import process from 'node:process'
import { Resend } from 'resend'

const SUPPORTED_EVENTS = new Set([
  'email.delivered',
  'email.bounced',
  'email.complained',
  'email.delivery_delayed',
  'email.failed',
  'email.suppressed',
])

function jsonResponse(statusCode, payload) {
  return {
    statusCode,
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  }
}

function getHeader(headers, name) {
  const normalizedName = name.toLowerCase()
  const entry = Object.entries(headers || {})
    .find(([key]) => key.toLowerCase() === normalizedName)
  return String(entry?.[1] || '').trim()
}

function getRawBody(event) {
  const body = String(event?.body || '')
  return event?.isBase64Encoded
    ? Buffer.from(body, 'base64').toString('utf8')
    : body
}

export async function handleResendWebhook(event, {
  env = process.env,
  resendClient = null,
  supabase = null,
} = {}) {
  if (event?.httpMethod !== 'POST') {
    return jsonResponse(405, { success: false, message: 'Method Not Allowed' })
  }

  const resolvedSupabase = supabase
    || (await import('./lib/_supabase.js')).supabaseAdmin
  let webhookSecret = String(env.RESEND_WEBHOOK_SECRET || '').trim()

  if (!webhookSecret) {
    const { data, error } = await resolvedSupabase.rpc(
      'get_email_provider_webhook_secret_v1',
      { provider_value: 'resend' },
    )

    if (error) {
      console.error('email_provider_webhook_secret_load_failed', {
        code: String(error.code || 'EMAIL_PROVIDER_WEBHOOK_SECRET_FAILED'),
      })
    } else {
      webhookSecret = String(data || '').trim()
    }
  }

  if (!webhookSecret) {
    return jsonResponse(503, { success: false, message: 'Webhook verification is not configured.' })
  }

  const rawPayload = getRawBody(event)
  const webhookEventId = getHeader(event.headers, 'svix-id')
  let verifiedEvent

  try {
    const resend = resendClient || new Resend(String(env.RESEND_API_KEY || '').trim())
    verifiedEvent = resend.webhooks.verify({
      payload: rawPayload,
      headers: {
        id: webhookEventId,
        timestamp: getHeader(event.headers, 'svix-timestamp'),
        signature: getHeader(event.headers, 'svix-signature'),
      },
      webhookSecret,
    })
  } catch {
    return jsonResponse(400, { success: false, message: 'Invalid webhook signature.' })
  }

  const eventType = String(verifiedEvent?.type || '').trim().toLowerCase()

  if (!SUPPORTED_EVENTS.has(eventType)) {
    return jsonResponse(200, { success: true, ignored: true })
  }

  const providerMessageId = String(verifiedEvent?.data?.email_id || '').trim()
  const occurredAt = String(verifiedEvent?.created_at || verifiedEvent?.data?.created_at || '').trim()

  if (!webhookEventId || !providerMessageId || !occurredAt) {
    return jsonResponse(400, { success: false, message: 'Webhook payload is incomplete.' })
  }

  const { data, error } = await resolvedSupabase.rpc('record_email_provider_event_v1', {
    webhook_event_id_value: webhookEventId,
    provider_message_id_value: providerMessageId,
    event_type_value: eventType,
    occurred_at_value: occurredAt,
    payload_sha256_value: createHash('sha256').update(rawPayload).digest('hex'),
  })

  if (error) {
    console.error('email_provider_webhook_persist_failed', {
      code: String(error.code || 'EMAIL_PROVIDER_EVENT_FAILED'),
      eventType,
    })
    return jsonResponse(500, { success: false, message: 'Webhook event could not be persisted.' })
  }

  return jsonResponse(200, {
    success: true,
    duplicate: data === false,
  })
}

export async function handler(event) {
  return handleResendWebhook(event)
}
