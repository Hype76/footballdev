import test from 'node:test'
import assert from 'node:assert/strict'
test('existing workspace checkout is bound to workspace authority and has no second trial', async () => {
  process.env.VITE_SUPABASE_URL = 'https://example.supabase.co'
  process.env.SUPABASE_SERVICE_ROLE_KEY = 'test-service-role-key'
  const { createExistingWorkspaceCheckout } = await import('../netlify/functions/create-workspace-checkout-session.js')
  let request
  const stripe = { checkout: { sessions: { create: async (value) => { request = value; return { id: 'cs_test', url: 'https://checkout.stripe.test/session' } } } } }
  await createExistingWorkspaceCheckout(stripe, {
    appUrl: 'https://footballplayer.online',
    billingCycle: 'monthly',
    caller: { id: 'owner-1', email: 'owner@example.test' },
    priceId: 'price_team_monthly',
    workspace: { id: 'club-1', name: 'FP TEST Team', plan_key: 'single_team', stripe_customer_id: '' },
  })
  assert.equal(request.metadata.existingWorkspace, 'true')
  assert.equal(request.metadata.clubId, 'club-1')
  assert.equal(request.metadata.workspaceScope, 'team')
  assert.equal(request.metadata.billingOwnerUserId, 'owner-1')
  assert.equal(request.subscription_data.metadata.clubId, 'club-1')
  assert.equal('trial_period_days' in request.subscription_data, false)
  assert.equal(request.customer_email, 'owner@example.test')
})

test('modern Club workspace checkout carries paid capacity items and source metadata', async () => {
  process.env.STRIPE_CLUB_MONTHLY_PRICE_ID = 'price_club_monthly'
  process.env.STRIPE_CLUB_BLOCK_MONTHLY_PRICE_ID = 'price_club_block_monthly'
  const { createExistingWorkspaceCheckout } = await import('../netlify/functions/create-workspace-checkout-session.js')
  let request
  const stripe = { checkout: { sessions: { create: async (value) => { request = value; return { id: 'cs_test', url: 'https://checkout.stripe.test/session' } } } } }
  await createExistingWorkspaceCheckout(stripe, {
    appUrl: 'https://footballplayer.online',
    billingCycle: 'monthly',
    caller: { id: 'owner-1', email: 'owner@example.test' },
    lineItems: [{ price: 'price_club_monthly', quantity: 1 }, { price: 'price_club_block_monthly', quantity: 2 }],
    targetPlanKey: 'club',
    teamCapacity: 30,
    workspace: { id: 'club-1', name: 'FP TEST Club', plan_key: 'team', stripe_customer_id: 'cus_test' },
  })
  assert.deepEqual(request.line_items, [{ price: 'price_club_monthly', quantity: 1 }, { price: 'price_club_block_monthly', quantity: 2 }])
  assert.equal(request.metadata.originalPlanKey, 'team')
  assert.equal(request.metadata.sourceWorkspaceScope, 'team')
  assert.equal(request.metadata.targetWorkspaceScope, 'club')
  assert.equal(request.metadata.teamCapacity, 30)
  assert.equal(request.subscription_data.metadata.targetWorkspaceScope, 'club')
})
