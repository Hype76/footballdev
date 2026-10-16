import assert from 'node:assert/strict'
import test from 'node:test'

process.env.VITE_SUPABASE_URL ||= 'https://example.supabase.co'
process.env.SUPABASE_SERVICE_ROLE_KEY ||= 'test-service-role-key'
process.env.STRIPE_PRICE_CLUB_20_MONTHLY = 'price_club_20_signup_test'

const { handleCheckoutCompleted } = await import('../netlify/functions/stripe-webhook.js')

function createFixture({ clubSignup = 'true' } = {}) {
  const subscription = {
    id: 'sub_signup_test',
    status: 'trialing',
    current_period_end: 1792185600,
    items: { data: [{ price: { id: 'price_club_20_signup_test' }, quantity: 1 }] },
  }
  const checkoutSession = {
    id: 'cs_signup_test',
    amount_total: 0,
    created: 1792166400,
    customer: 'cus_signup_test',
    customer_details: { email: 'owner@example.com', name: 'Club Owner' },
    metadata: {
      billingCycle: 'monthly',
      clubId: 'club-signup-test',
      clubName: 'New Club FC',
      clubSignup,
      existingWorkspace: 'true',
      offerKey: 'club_20',
      originalPlanKey: 'matchday',
      planKey: 'club',
      sourceWorkspaceScope: 'team',
      targetWorkspaceScope: 'club',
      teamCapacity: '20',
    },
    status: 'complete',
    subscription: subscription.id,
    total_details: { amount_discount: 0 },
  }
  return {
    checkoutSession,
    stripe: { subscriptions: { retrieve: async () => subscription } },
  }
}

test('completed Club signup checkout sends the authoritative plan notification', async () => {
  const { checkoutSession, stripe } = createFixture()
  let notification = null
  let storedRecord = null
  const rawPayload = { id: 'evt_signup_test', data: { object: checkoutSession } }

  const result = await handleCheckoutCompleted(stripe, checkoutSession, rawPayload, {
    event: { headers: { host: 'footballplayer.online' } },
    sendSignupNotificationImpl: async details => { notification = details },
    upsertCheckoutRecordImpl: async record => {
      storedRecord = record
      return { ...record, club_id: 'club-signup-test', club_name: 'New Club FC', customer_email: 'owner@example.com' }
    },
  })

  assert.equal(result.club_id, 'club-signup-test')
  assert.equal(storedRecord.planKey, 'club')
  assert.equal(storedRecord.billingCycle, 'monthly')
  assert.equal(storedRecord.subscriptionTeamCapacity, 20)
  assert.equal(notification.planKey, 'club')
  assert.equal(notification.teamCapacity, 20)
  assert.equal(notification.offerKey, 'club_20')
  assert.equal(notification.notificationKey, 'stripe-checkout:cs_signup_test')
  assert.equal(notification.source, 'club_signup_checkout')
})

test('ordinary existing workspace plan changes do not report a new signup', async () => {
  const { checkoutSession, stripe } = createFixture({ clubSignup: 'false' })
  let notificationCount = 0

  await handleCheckoutCompleted(stripe, checkoutSession, { id: 'evt_upgrade_test' }, {
    sendSignupNotificationImpl: async () => { notificationCount += 1 },
    upsertCheckoutRecordImpl: async record => ({ ...record, club_id: 'club-signup-test' }),
  })

  assert.equal(notificationCount, 0)
})
