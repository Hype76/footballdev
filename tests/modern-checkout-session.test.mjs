import assert from 'node:assert/strict'
import test from 'node:test'

test('new checkout session preserves modern line items and capacity metadata', async () => {
  const { createCheckoutSession } = await import('../netlify/functions/create-checkout-session.js')
  let request
  const stripe = { checkout: { sessions: { create: async (value) => { request = value; return { url: 'https://checkout.stripe.test/session' } } } } }
  await createCheckoutSession(stripe, {
    appUrl: 'https://footballplayer.online',
    billingCycle: 'annual',
    clubName: 'FP Club',
    customerEmail: 'owner@example.test',
    planKey: 'club',
    planName: 'Club',
    priceId: '',
    lineItems: [{ price: 'price_club_annual', quantity: 1 }, { price: 'price_block_annual', quantity: 3 }],
    teamCapacity: 40,
    workspaceScope: 'club',
  })
  assert.deepEqual(request.line_items, [{ price: 'price_club_annual', quantity: 1 }, { price: 'price_block_annual', quantity: 3 }])
  assert.equal(request.metadata.planKey, 'club')
  assert.equal(request.metadata.billingCycle, 'annual')
  assert.equal(request.metadata.teamCapacity, 40)
  assert.equal(request.subscription_data.metadata.teamCapacity, 40)
  assert.equal(request.subscription_data.trial_period_days, 14)
})
