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
  assert.doesNotMatch(free.resendPayload.html, /Checkout total/)

  const paid = buildSignupNotificationEmail({ ...baseDetails, billingMode: 'paid', planKey: 'club' }, emailEnv)
  assert.equal(paid.workspaceType, 'Club')
  assert.match(paid.subject, /club signup \| Cambourne Town FC \| Club/)
  assert.match(paid.resendPayload.html, /GBP 59\.99\/month/)
  assert.match(paid.resendPayload.html, /<td[^>]*>Paid<\/td>/)
  assert.doesNotMatch(paid.resendPayload.html, /Checkout total/)

  const legacyClubInvite = buildSignupNotificationEmail({
    ...baseDetails,
    billingMode: 'paid',
    planKey: 'small_club',
    source: 'workspace_invite_acceptance',
  }, emailEnv)
  assert.match(legacyClubInvite.resendPayload.html, /Small Club/)
  assert.match(legacyClubInvite.resendPayload.html, /5 teams/)
  assert.doesNotMatch(legacyClubInvite.resendPayload.html, /Checkout total/)

  const annual = buildSignupNotificationEmail({
    ...baseDetails,
    billingCycle: 'annual',
    checkoutAmountPence: 59990,
    discountAmountPence: 10000,
    planKey: 'club',
    teamCapacity: 10,
  }, emailEnv)
  assert.match(annual.resendPayload.html, /GBP 599\.90\/year/)
  assert.match(annual.resendPayload.html, /10 teams/)
  assert.match(annual.resendPayload.html, /Checkout total<\/th><td[^>]*>GBP 599\.90/)
  assert.match(annual.resendPayload.html, /Discount applied<\/th><td[^>]*>GBP 100\.00/)

  const coachOffer = buildSignupNotificationEmail({
    ...baseDetails,
    billingCycle: 'monthly',
    offerKey: 'club_20',
    offerLabel: '50% off the first 3 monthly payments, then the normal monthly price.',
    planKey: 'club',
    teamCapacity: 20,
  }, emailEnv)
  assert.match(coachOffer.resendPayload.html, /GBP 59\.99\/month/)
  assert.match(coachOffer.resendPayload.html, /20 teams/)
  assert.match(coachOffer.resendPayload.html, /50% off the first 3 monthly payments/)
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
    sendEmailImpl: async (payload, options) => { calls.push(['provider', payload, options]); return { data: { id: 'provider-1' } } },
  })
  assert.deepEqual(sent, { status: 'sent', providerMessageId: 'provider-1' })
  assert.equal(calls.filter(([type]) => type === 'provider').length, 1)
  assert.match(calls[0][1].payload.resendPayload.html, /GBP 7\.99\/month/)
  assert.match(calls.find(([type]) => type === 'provider')[2].idempotencyKey, /^fp-signup-[a-f0-9]{64}$/)
  assert.equal(calls[0][1].payload.providerIdempotencyKey, calls.find(([type]) => type === 'provider')[2].idempotencyKey)

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

test('idempotency remains stable when a repeated request renders at a later time', async () => {
  const idempotencyKeys = []
  const options = {
    createPendingEmailLogImpl: async payload => {
      idempotencyKeys.push(payload.idempotencyKey)
      return { record: { id: 'email-log-repeat', attempts: 0 }, skipped: idempotencyKeys.length > 1 }
    },
    env: emailEnv,
    markEmailLogSentImpl: async () => {},
    sendEmailImpl: async () => ({ data: { id: 'provider-repeat' } }),
  }

  await sendNewWorkspaceSignupNotification({ ...baseDetails, createdAt: undefined, notificationKey: 'workspace-invite:invite-1', planKey: 'team' }, options)
  await new Promise(resolve => setTimeout(resolve, 10))
  const repeated = await sendNewWorkspaceSignupNotification({ ...baseDetails, createdAt: undefined, notificationKey: 'workspace-invite:invite-1', planKey: 'team' }, options)

  assert.equal(repeated.status, 'duplicate')
  assert.equal(idempotencyKeys[0], idempotencyKeys[1])
})

test('notification infrastructure failure never blocks the completed signup', async () => {
  const result = await sendNewWorkspaceSignupNotification({ ...baseDetails, planKey: 'matchday' }, {
    createPendingEmailLogImpl: async () => { throw new Error('Email log unavailable') },
    env: emailEnv,
  })

  assert.equal(result.status, 'failed')
})
