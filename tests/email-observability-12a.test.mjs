import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'
import {
  completeEmailDeliveryAttempt,
  createEmailTelemetryDescriptor,
  normalizeOperationalMetrics,
} from '../netlify/functions/lib/_email-delivery-telemetry.js'
import { sendEmail } from '../netlify/functions/lib/_email-provider.js'

const validEnv = {
  RESEND_API_KEY: 're_test_key',
  RESEND_FROM_EMAIL: 'feedback@footballplayer.online',
}

test('telemetry descriptor records timing without storing message content or recipients', () => {
  const descriptor = createEmailTelemetryDescriptor({
    context: {
      clubId: '10000000-0000-4000-8000-000000000001',
      emailType: 'development_parent_pdf',
      targetEntityId: '10000000-0000-4000-8000-000000000002',
      targetEntityType: 'evaluation',
      deliveryTelemetry: {
        eligibleAt: '2026-07-31T05:00:00.000Z',
        enqueuedAt: '2026-07-31T05:00:01.000Z',
        pdfStartedAt: '2026-07-31T05:00:02.000Z',
        pdfFinishedAt: '2026-07-31T05:00:03.000Z',
      },
    },
    now: new Date('2026-07-31T05:00:04.000Z'),
    payload: {
      to: ['approved@example.test'],
      subject: 'Private child name',
      html: '<p>Private report content</p>',
      attachments: [{
        contentType: 'application/pdf',
        filename: 'private-report.pdf',
      }],
    },
  })

  assert.equal(descriptor.deliveryType, 'development_parent_pdf')
  assert.equal(descriptor.recipientCount, 1)
  assert.equal(descriptor.hasPdf, true)
  assert.equal(descriptor.eligibleAt, '2026-07-31T05:00:00.000Z')
  assert.equal(descriptor.providerRequestedAt, '2026-07-31T05:00:04.000Z')
  assert.equal(JSON.stringify(descriptor).includes('approved@example.test'), false)
  assert.equal(JSON.stringify(descriptor).includes('Private child name'), false)
  assert.equal(JSON.stringify(descriptor).includes('Private report content'), false)
})

test('preparation failure descriptor does not claim a provider request', async () => {
  const calls = []
  const supabaseClient = {
    rpc: async (name, input) => {
      calls.push({ input, name })
      return { data: null, error: null }
    },
  }
  const attempt = {
    attemptId: '21000000-0000-4000-8000-000000000001',
    descriptor: {
      providerRequested: false,
    },
    jobId: '21000000-0000-4000-8000-000000000002',
  }

  await completeEmailDeliveryAttempt({
    attempt,
    error: Object.assign(new Error('PDF preparation failed'), {
      code: 'PDF_ATTACHMENT_GENERATION_FAILED',
    }),
    supabaseClient,
  })

  assert.equal(calls.length, 1)
  assert.equal(calls[0].input.outcome, 'preparation_failed')
  assert.equal(calls[0].input.provider_status_value, '')
  assert.equal(calls[0].input.failure_category_value, 'pdf_failure')

  const descriptor = createEmailTelemetryDescriptor({
    context: {
      deliveryTelemetry: {
        providerRequested: false,
      },
    },
    now: new Date('2026-07-31T05:00:04.000Z'),
  })

  assert.equal(descriptor.providerRequested, false)
  assert.equal(descriptor.providerRequestedAt, null)
})

test('provider acceptance completes telemetry with the persisted provider response', async () => {
  const telemetryCalls = []
  const telemetryClient = {
    beginEmailDeliveryAttempt: async (input) => {
      telemetryCalls.push({ type: 'begin', input })
      return {
        attemptId: '20000000-0000-4000-8000-000000000001',
        jobId: '20000000-0000-4000-8000-000000000002',
      }
    },
    completeEmailDeliveryAttempt: async (input) => {
      telemetryCalls.push({ type: 'complete', input })
    },
  }
  const resendClient = {
    emails: {
      send: async () => ({ data: { id: 'resend_message_12a' } }),
    },
  }

  const response = await sendEmail({
    from: 'Football Player <feedback@footballplayer.online>',
    to: ['approved@example.test'],
    subject: 'Telemetry validation',
    html: '<p>Telemetry validation</p>',
  }, {
    context: { emailType: 'test_email' },
    env: validEnv,
    resendClient,
    telemetryClient,
  })

  assert.equal(response.data.id, 'resend_message_12a')
  assert.equal(telemetryCalls.length, 2)
  assert.equal(telemetryCalls[0].type, 'begin')
  assert.equal(telemetryCalls[1].type, 'complete')
  assert.equal(telemetryCalls[1].input.response.data.id, 'resend_message_12a')
  assert.equal(telemetryCalls[1].input.error, null)
})

test('provider failure completes telemetry and preserves the public provider error', async () => {
  const completions = []
  const telemetryClient = {
    beginEmailDeliveryAttempt: async () => ({
      attemptId: '30000000-0000-4000-8000-000000000001',
      jobId: '30000000-0000-4000-8000-000000000002',
    }),
    completeEmailDeliveryAttempt: async (input) => {
      completions.push(input)
    },
  }
  const resendClient = {
    emails: {
      send: async () => ({
        error: {
          code: 'provider_rate_limit',
          message: 'Rate limited',
          statusCode: 429,
        },
      }),
    },
  }

  await assert.rejects(
    () => sendEmail({
      from: 'Football Player <feedback@footballplayer.online>',
      to: ['approved@example.test'],
      subject: 'Telemetry validation',
      html: '<p>Telemetry validation</p>',
    }, {
      context: { emailType: 'test_email' },
      env: validEnv,
      resendClient,
      telemetryClient,
    }),
    /Rate limited/,
  )

  assert.equal(completions.length, 1)
  assert.equal(completions[0].error.code, 'provider_rate_limit')
  assert.equal(completions[0].error.providerStatus, 429)
})

test('empty and malformed metrics normalize to finite zero values', () => {
  assert.deepEqual(normalizeOperationalMetrics([]), [])

  const [metrics] = normalizeOperationalMetrics([{
    delivery_type: '',
    eligible_count: 'NaN',
    eligibility_to_claim_p50_ms: null,
    failed_count: -2,
    oldest_eligible_age_seconds: '15',
  }])

  assert.equal(metrics.deliveryType, 'all')
  assert.equal(metrics.eligibleCount, 0)
  assert.equal(metrics.eligibilityToClaimP50Ms, 0)
  assert.equal(metrics.failedCount, 0)
  assert.equal(metrics.oldestEligibleAgeSeconds, 15)
  assert.equal(Object.values(metrics).some((value) => Number.isNaN(value)), false)
})

test('Phase 1 leaves Training cadence, queue routing, and retry scheduling unchanged', async () => {
  const [trainingSource, retrySource, scheduledSource] = await Promise.all([
    readFile(new URL('../netlify/functions/process-training-availability-requests.js', import.meta.url), 'utf8'),
    readFile(new URL('../netlify/functions/retry-failed-emails.js', import.meta.url), 'utf8'),
    readFile(new URL('../netlify/functions/send-scheduled-emails.js', import.meta.url), 'utf8'),
  ])

  assert.match(trainingSource, /schedule:\s*'\*\/15 \* \* \* \*'/)
  assert.match(trainingSource, /await sendEmail\(/)
  assert.doesNotMatch(retrySource, /export const config\s*=/)
  assert.match(scheduledSource, /schedule:\s*'\* \* \* \* \*'/)
})
