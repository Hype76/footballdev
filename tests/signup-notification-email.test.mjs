import assert from 'node:assert/strict'
import test from 'node:test'

process.env.VITE_SUPABASE_URL ||= 'https://example.supabase.co'
process.env.SUPABASE_SERVICE_ROLE_KEY ||= 'test-service-role-key'

const {
  buildSignupNotificationEmail,
  resolveSignupNotificationRecipients,
  sendNewWorkspaceSignupNotification,
  shouldSendSignupNotification,
} = await import('../netlify/functions/lib/_signup-notification-email.js')

const productionEvent = { headers: { host: 'footballplayer.online' } }
const baseDetails = {
  clubId: '11111111-1111-4111-8111-111111111111',
  contactEmail: 'coach@example.com',
  contactName: 'Test Coach',
  createdAt: '2026-10-16T13:30:00.000Z',
  event: productionEvent,
  source: 'public_signup',
  workspaceName: 'Cambourne Town FC',
}
const emailEnv = { RESEND_API_KEY: 'fixture-key', RESEND_FROM_EMAIL: 'feedback@footballplayer.online' }

test('signup notification covers free Team and paid Club plans for Steve and Simon', () => {
  assert.deepEqual(resolveSignupNotificationRecipients(emailEnv), ['steve@jelumalabs.com', 'simon@jelumalabs.com'])

  const free = buildSignupNotificationEmail({ ...baseDetails, planKey: 'matchday' }, emailEnv)
  assert.equal(free.workspaceType, 'Team')
  assert.match(free.subject, /team signup \| Cambourne Town FC \| Matchday/)
  assert.match(free.resendPayload.html, /<td[^>]*>Free<\/td>/)
  assert.deepEqual(free.resendPayload.to, ['steve@jelumalabs.com', 'simon@jelumalabs.com'])

  const paid = buildSignupNotificationEmail({ ...baseDetails, billingMode: 'paid', planKey: 'club' }, emailEnv)
  assert.equal(paid.workspaceType, 'Club')
  assert.match(paid.subject, /club signup \| Cambourne Town FC \| Club/)
  assert.match(paid.resendPayload.html, /GBP 59\.99\/month/)
  assert.match(paid.resendPayload.html, /<td[^>]*>Paid<\/td>/)
})

test('production sends while previews, staging and synthetic probes stay quiet', async () => {
  assert.equal(shouldSendSignupNotification(productionEvent, emailEnv), true)
  assert.equal(shouldSendSignupNotification({ headers: { host: 'deploy-preview.example' } }, { ...emailEnv, CONTEXT: 'deploy-preview' }), false)
  assert.equal(shouldSendSignupNotification({ headers: { host: 'staging.example' } }, { ...emailEnv, BRANCH: 'staging' }), false)

  let created = 0
  const result = await sendNewWorkspaceSignupNotification({ ...baseDetails, contactEmail: 'probe@example.invalid', planKey: 'matchday' }, {
    createPendingEmailLogImpl: async () => { created += 1 },
    env: emailEnv,
  })
  assert.equal(result.status, 'skipped_synthetic')
  assert.equal(created, 0)
})

test('signup email is logged, idempotent and retained for retry after provider failure', async () => {
  const calls = []
  const record = { id: 'email-log-1', attempts: 0 }
  const sent = await sendNewWorkspaceSignupNotification({ ...baseDetails, planKey: 'team' }, {
    createPendingEmailLogImpl: async payload => { calls.push(['pending', payload]); return { record } },
    env: emailEnv,
    markEmailLogFailedImpl: async () => assert.fail('Successful send must not be marked failed'),
    markEmailLogSentImpl: async (nextRecord, response) => calls.push(['sent', nextRecord, response]),
    sendEmailImpl: async payload => { calls.push(['provider', payload]); return { data: { id: 'provider-1' } } },
  })
  assert.deepEqual(sent, { status: 'sent', providerMessageId: 'provider-1' })
  assert.equal(calls.filter(([type]) => type === 'provider').length, 1)
  assert.match(calls[0][1].payload.resendPayload.html, /GBP 7\.99\/month/)

  let providerCalls = 0
  const duplicate = await sendNewWorkspaceSignupNotification({ ...baseDetails, planKey: 'team' }, {
    createPendingEmailLogImpl: async () => ({ record, skipped: true }),
    env: emailEnv,
    sendEmailImpl: async () => { providerCalls += 1 },
  })
  assert.equal(duplicate.status, 'duplicate')
  assert.equal(providerCalls, 0)

  let failedRecord = null
  const failed = await sendNewWorkspaceSignupNotification({ ...baseDetails, planKey: 'club' }, {
    createPendingEmailLogImpl: async () => ({ record }),
    env: emailEnv,
    markEmailLogFailedImpl: async nextRecord => { failedRecord = nextRecord },
    sendEmailImpl: async () => { throw Object.assign(new Error('Provider unavailable'), { code: 'provider_down' }) },
  })
  assert.equal(failed.status, 'queued_for_retry')
  assert.equal(failedRecord, record)
})

test('notification infrastructure failure never blocks the completed signup', async () => {
  const result = await sendNewWorkspaceSignupNotification({ ...baseDetails, planKey: 'matchday' }, {
    createPendingEmailLogImpl: async () => { throw new Error('Email log unavailable') },
    env: emailEnv,
  })

  assert.equal(result.status, 'failed')
})
