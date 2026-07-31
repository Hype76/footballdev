import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { test } from 'node:test'
import {
  MAX_EMAIL_DELIVERY_ATTEMPTS,
  classifyEmailFailure,
  getEmailRetryDelayMs,
  getNextEmailRetryAt,
} from '../netlify/functions/lib/_email-retry-policy.js'
import { handleResendWebhook } from '../netlify/functions/resend-webhook.js'
import {
  configureResendWebhook,
  ensureResendWebhookConfigured,
} from '../netlify/functions/configure-resend-webhook.js'

test('retry worker is registered as a native one-minute scheduled function', async () => {
  const source = await readFile(
    new URL('../netlify/functions/retry-failed-emails.js', import.meta.url),
    'utf8',
  )

  assert.match(source, /authorizeNativeScheduledRequest/)
  assert.match(source, /ensureResendWebhookConfigured/)
  assert.match(source, /schedule:\s*'\* \* \* \* \*'/)
  assert.match(source, /export default async function scheduledHandler/)
  assert.doesNotMatch(source, /attempts[^;\n]*>=\s*3/)
})

test('retry policy uses 1, 5, and 15 minute backoff before terminal failure', () => {
  assert.equal(getEmailRetryDelayMs(1), 60_000)
  assert.equal(getEmailRetryDelayMs(2), 300_000)
  assert.equal(getEmailRetryDelayMs(3), 900_000)
  assert.equal(getEmailRetryDelayMs(4), null)
  assert.equal(MAX_EMAIL_DELIVERY_ATTEMPTS, 4)
  assert.equal(
    getNextEmailRetryAt(2, Date.parse('2026-07-31T09:00:00.000Z')),
    '2026-07-31T09:05:00.000Z',
  )
})

test('failure classification separates retryable and terminal outcomes', () => {
  assert.deepEqual(
    classifyEmailFailure({ providerStatus: 503, code: 'application_error' }),
    { category: 'retryable_provider', retryable: true, safeCode: 'application_error' },
  )
  assert.equal(classifyEmailFailure({ code: 'ETIMEDOUT' }).category, 'retryable_network')
  assert.equal(classifyEmailFailure({ code: '40001' }).category, 'retryable_database')
  assert.equal(classifyEmailFailure({ statusCode: 403 }).category, 'non_retryable_authorization')
  assert.equal(classifyEmailFailure({ code: 'invalid_recipient' }).category, 'non_retryable_recipient')
  assert.equal(classifyEmailFailure({ code: 'email_to_invalid' }).category, 'non_retryable_recipient')
  assert.equal(classifyEmailFailure({ code: 'email_from_invalid' }).category, 'non_retryable_malformed_payload')
  assert.equal(classifyEmailFailure({ code: 'event_revoked' }).category, 'non_retryable_cancelled')
  assert.equal(classifyEmailFailure({ statusCode: 400 }).category, 'non_retryable_malformed_payload')
})

test('verified provider webhooks persist lifecycle state without raw recipient data', async () => {
  const calls = []
  const rawPayload = JSON.stringify({
    type: 'email.delivered',
    created_at: '2026-07-31T09:10:00.000Z',
    data: {
      email_id: 'provider_12d',
      to: ['controlled@example.invalid'],
    },
  })
  const response = await handleResendWebhook({
    httpMethod: 'POST',
    body: rawPayload,
    headers: {
      'svix-id': 'event_12d',
      'svix-signature': 'valid',
      'svix-timestamp': '1785489000',
    },
  }, {
    env: {
      RESEND_API_KEY: 're_test',
      RESEND_WEBHOOK_SECRET: 'whsec_test',
    },
    resendClient: {
      webhooks: {
        verify: ({ payload }) => JSON.parse(payload),
      },
    },
    supabase: {
      rpc: async (name, args) => {
        calls.push({ name, args })
        return { data: true, error: null }
      },
    },
  })

  assert.equal(response.statusCode, 200)
  assert.equal(calls.length, 1)
  assert.equal(calls[0].name, 'record_email_provider_event_v1')
  assert.equal(calls[0].args.provider_message_id_value, 'provider_12d')
  assert.equal(Object.values(calls[0].args).join(' ').includes('controlled@example.invalid'), false)
  assert.match(calls[0].args.payload_sha256_value, /^[a-f0-9]{64}$/)
})

test('invalid webhook signatures fail closed before persistence', async () => {
  let persisted = false
  const response = await handleResendWebhook({
    httpMethod: 'POST',
    body: '{}',
    headers: {},
  }, {
    env: {
      RESEND_API_KEY: 're_test',
      RESEND_WEBHOOK_SECRET: 'whsec_test',
    },
    resendClient: {
      webhooks: {
        verify: () => {
          throw new Error('invalid')
        },
      },
    },
    supabase: {
      rpc: async () => {
        persisted = true
        return { data: true, error: null }
      },
    },
  })

  assert.equal(response.statusCode, 400)
  assert.equal(persisted, false)
})

test('webhook configuration stores the provider signing secret without returning it', async () => {
  const stored = []
  const result = await configureResendWebhook({
    env: {
      RESEND_API_KEY: 're_test',
      URL: 'https://footballplayer.online',
    },
    resendClient: {
      webhooks: {
        create: async () => ({ data: { id: 'webhook_12d', signing_secret: 'whsec_12d' } }),
        get: async () => ({ data: { id: 'webhook_12d', signing_secret: 'whsec_12d' } }),
        list: async () => ({ data: { data: [] } }),
        update: async () => ({ data: { id: 'webhook_12d' } }),
      },
    },
    supabase: {
      rpc: async (name, args) => {
        stored.push({ name, args })
        return { error: null }
      },
    },
  })

  assert.deepEqual(result, {
    endpoint: 'https://footballplayer.online/.netlify/functions/resend-webhook',
    eventCount: 6,
    webhookId: 'webhook_12d',
  })
  assert.equal(Object.hasOwn(result, 'signingSecret'), false)
  assert.equal(stored[0].name, 'configure_email_provider_webhook_v1')
  assert.equal(stored[0].args.signing_secret_value, 'whsec_12d')
})

test('scheduled webhook bootstrap reuses private configuration without provider calls', async () => {
  let providerCalled = false
  const result = await ensureResendWebhookConfigured({
    env: {
      URL: 'https://footballplayer.online',
    },
    resendClient: {
      webhooks: {
        list: async () => {
          providerCalled = true
          throw new Error('provider should not be called')
        },
      },
    },
    supabase: {
      rpc: async (name) => {
        assert.equal(name, 'get_email_provider_webhook_secret_v1')
        return { data: 'stored-private-value', error: null }
      },
    },
  })

  assert.deepEqual(result, {
    endpoint: 'https://footballplayer.online/.netlify/functions/resend-webhook',
    eventCount: 6,
    reusedStoredConfiguration: true,
  })
  assert.equal(providerCalled, false)
  assert.equal(JSON.stringify(result).includes('stored-private-value'), false)
})
