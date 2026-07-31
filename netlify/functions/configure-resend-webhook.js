import process from 'node:process'
import { Resend } from 'resend'
import { authorizeProcessorRequest } from './lib/_processor-auth.js'

const WEBHOOK_EVENTS = Object.freeze([
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

function getWebhookEndpoint(env) {
  const origin = String(
    env.URL
    || env.VITE_APP_URL
    || 'https://footballplayer.online',
  ).trim().replace(/\/$/, '')
  return `${origin}/.netlify/functions/resend-webhook`
}

function unwrapResponse(response) {
  if (response?.error) {
    throw Object.assign(new Error('Resend webhook configuration failed.'), {
      code: String(response.error.name || response.error.code || 'resend_webhook_error'),
    })
  }

  return response?.data || null
}

export async function configureResendWebhook({
  env = process.env,
  resendClient = null,
  supabase = null,
} = {}) {
  const apiKey = String(env.RESEND_API_KEY || '').trim()

  if (!apiKey) {
    throw Object.assign(new Error('Resend is not configured.'), {
      code: 'resend_api_key_missing',
    })
  }

  const endpoint = getWebhookEndpoint(env)
  const resend = resendClient || new Resend(apiKey)
  const listed = unwrapResponse(await resend.webhooks.list())
  const existing = (listed?.data || [])
    .find((webhook) => webhook.endpoint === endpoint && webhook.status === 'enabled')
  let webhookId = existing?.id || ''

  if (!webhookId) {
    const created = unwrapResponse(await resend.webhooks.create({
      endpoint,
      events: [...WEBHOOK_EVENTS],
    }))
    webhookId = String(created?.id || '').trim()
  } else {
    const currentEvents = new Set(existing.events || [])
    const requiresUpdate = WEBHOOK_EVENTS.some((eventType) => !currentEvents.has(eventType))

    if (requiresUpdate) {
      unwrapResponse(await resend.webhooks.update(webhookId, {
        endpoint,
        events: [...WEBHOOK_EVENTS],
      }))
    }
  }

  const webhook = unwrapResponse(await resend.webhooks.get(webhookId))
  const signingSecret = String(webhook?.signing_secret || '').trim()

  if (!webhookId || !signingSecret) {
    throw Object.assign(new Error('Resend webhook signing evidence was incomplete.'), {
      code: 'resend_webhook_secret_missing',
    })
  }

  const resolvedSupabase = supabase
    || (await import('./lib/_supabase.js')).supabaseAdmin
  const { error } = await resolvedSupabase.rpc('configure_email_provider_webhook_v1', {
    provider_value: 'resend',
    webhook_id_value: webhookId,
    endpoint_value: endpoint,
    signing_secret_value: signingSecret,
  })

  if (error) {
    throw Object.assign(new Error('Resend webhook signing evidence could not be stored.'), {
      code: String(error.code || 'resend_webhook_store_failed'),
    })
  }

  return {
    endpoint,
    eventCount: WEBHOOK_EVENTS.length,
    webhookId,
  }
}

export async function handler(event) {
  const authorization = authorizeProcessorRequest(event)

  if (!authorization.ok) {
    return authorization.response
  }

  try {
    const result = await configureResendWebhook()
    return jsonResponse(200, { success: true, ...result })
  } catch (error) {
    console.error('resend_webhook_configuration_failed', {
      code: String(error?.code || error?.name || 'resend_webhook_configuration_failed'),
    })
    return jsonResponse(500, {
      success: false,
      message: 'Resend webhook configuration failed.',
    })
  }
}
