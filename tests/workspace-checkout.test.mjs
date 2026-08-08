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
