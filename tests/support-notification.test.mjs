import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'
import {
  PRODUCTION_SUPPORT_EMAIL,
  SupportNotificationConfigError,
  buildSupportNotificationPayload,
  isTrustedProductionSupportEnvironment,
  resolveSupportRecipient,
  sendSupportNotification,
} from '../netlify/functions/_support-notification.js'

const productionEnv = {
  CONTEXT: 'production',
  RESEND_API_KEY: 're_test_key',
  RESEND_FROM_EMAIL: 'feedback@footballplayer.online',
  SUPPORT_EMAIL_TO: PRODUCTION_SUPPORT_EMAIL,
}

const report = {
  source: 'tester_feedback_report',
  reportId: 'report-123',
  type: 'bug',
  severity: 'critical',
  title: 'Broken route',
  summary: 'The route failed.',
  route: '/feedback/new',
  pageTitle: 'Report issue',
  module: 'Support',
  phase: 'production',
  reporterId: 'user-123',
  reporterName: 'Fixture Coach',
  reporterEmail: 'coach@example.test',
  clubId: 'club-123',
  clubName: 'Fixture Club',
  teamId: 'team-123',
  teamName: 'U12 Fixture',
  submittedAt: '2026-06-27T10:00:00.000Z',
  browserDevice: 'Fixture browser',
  screenshotUrl: 'https://example.test/screenshot.png',
  logReference: 'log-123',
  adminReviewUrl: 'https://footballplayer.online/platform-feedback',
}

test('support notifications send only in trusted production or explicit forced test mode', async () => {
  const calls = []
  const skipped = await sendSupportNotification(report, {
    env: {
      CONTEXT: 'deploy-preview',
      RESEND_API_KEY: 're_test_key',
      RESEND_FROM_EMAIL: 'feedback@footballplayer.online',
    },
    sendEmailImpl: async (payload) => {
      calls.push(payload)
      return { data: { id: 'email_123' } }
    },
  })

  assert.equal(skipped.sent, false)
  assert.equal(skipped.skipped, true)
  assert.equal(calls.length, 0)
  assert.equal(isTrustedProductionSupportEnvironment({ CONTEXT: 'production' }), true)
  assert.equal(isTrustedProductionSupportEnvironment({ CONTEXT: 'deploy-preview' }), false)
})

test('production support recipient is fixed to support@jelumalabs.com', async () => {
  const calls = []
  const result = await sendSupportNotification(report, {
    env: productionEnv,
    sendEmailImpl: async (payload, options) => {
      calls.push({ payload, options })
      return { data: { id: 'email_123' } }
    },
  })

  assert.equal(result.sent, true)
  assert.equal(result.recipient, PRODUCTION_SUPPORT_EMAIL)
  assert.equal(calls.length, 1)
  assert.deepEqual(calls[0].payload.to, [PRODUCTION_SUPPORT_EMAIL])
  assert.equal(calls[0].payload.replyTo, 'coach@example.test')
  assert.equal(calls[0].options.context.targetEntityType, 'tester_feedback_report')
  assert.equal(calls[0].options.context.targetEntityId, 'report-123')
})

test('wrong production support recipient is rejected instead of sending to old addresses', () => {
  assert.throws(
    () => resolveSupportRecipient({ SUPPORT_EMAIL_TO: 'old@example.test' }),
    (error) => {
      assert.equal(error instanceof SupportNotificationConfigError, true)
      assert.equal(error.code, 'support_notification_config_invalid')
      return true
    },
  )
})

test('support notification payload escapes html and neutralises header injection', () => {
  const payload = buildSupportNotificationPayload({
    ...report,
    title: 'Bad title\r\nBcc: victim@example.test',
    summary: '<script>alert(1)</script>',
    reporterEmail: 'not-an-email',
  }, {
    env: productionEnv,
  })

  assert.equal(payload.to[0], PRODUCTION_SUPPORT_EMAIL)
  assert.equal(payload.replyTo, undefined)
  assert.doesNotMatch(payload.subject, /\r|\n|Bcc:/)
  assert.match(payload.html, /&lt;script&gt;alert\(1\)&lt;\/script&gt;/)
  assert.doesNotMatch(payload.html, /<script>alert/)
})

test('support notification code and env example do not retain old support destinations', () => {
  const helperSource = readFileSync('netlify/functions/_support-notification.js', 'utf8')
  const submitSource = readFileSync('netlify/functions/submit-tester-feedback.js', 'utf8')
  const platformSource = readFileSync('netlify/functions/platform-feedback-notification.js', 'utf8')
  const envExample = readFileSync('.env.example', 'utf8')

  for (const source of [helperSource, submitSource, platformSource, envExample]) {
    assert.doesNotMatch(source, /btopenworld|gmail|pulseslabs|CONTACT_REQUEST_RECIPIENT/i)
  }

  assert.match(helperSource, /support@jelumalabs\.com/)
  assert.match(envExample, /SUPPORT_EMAIL_TO=support@jelumalabs\.com/)
})
