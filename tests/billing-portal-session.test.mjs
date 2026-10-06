import assert from 'node:assert/strict'
import test from 'node:test'

process.env.VITE_SUPABASE_URL = 'https://example.supabase.co'
process.env.SUPABASE_SERVICE_ROLE_KEY = 'test-service-role-key'
const { createBillingPortalHandler } = await import('../netlify/functions/create-billing-portal-session.mts')

function fixture(overrides = {}) {
  const caller = { id: 'owner', club_id: 'club1', role: 'admin', role_rank: 90, status: 'active', ...overrides.caller }
  const workspace = { id: 'club1', workspace_owner_user_id: 'owner', plan_key: 'club', plan_status: 'active', status: 'active', stripe_customer_id: 'cus_owner', stripe_subscription_id: 'sub_owner', ...overrides.workspace }
  const configuration = { active: true, livemode: true, features: { subscription_cancel: { enabled: true, mode: 'at_period_end', proration_behavior: 'none' }, subscription_update: { enabled: false }, customer_update: { enabled: false }, payment_method_update: { enabled: false }, invoice_history: { enabled: false } }, ...overrides.configuration }
  const subscription = { customer: 'cus_owner', livemode: true, status: 'active', ...overrides.subscription }
  const calls = []
  const handler = createBillingPortalHandler({
    getCaller: async () => caller,
    loadWorkspace: async (id) => { calls.push(['workspace', id]); return workspace },
    environment: { STRIPE_BILLING_PORTAL_CONFIGURATION: 'bpc_cancel' },
    logFailure: () => {},
    createStripe: () => ({
      subscriptions: { retrieve: async (id) => { calls.push(['subscription', id]); return subscription } },
      billingPortal: {
        configurations: { retrieve: async () => configuration },
        sessions: { create: async (payload) => { calls.push(['session', payload]); if (overrides.fail) throw Object.assign(new Error('provider secret fragment'), { statusCode: overrides.fail }); return { url: overrides.url || 'https://billing.stripe.com/p/session' } } },
      },
    }),
  })
  const request = (body = '{}', authorization = 'Bearer token') => new Request('https://example.test/portal', { method: 'POST', headers: { authorization }, body })
  return { handler, calls, request }
}

test('billing owner opens only the server-owned subscription cancellation flow', async () => {
  for (const [caller, workspace, status] of [
    [{ role: 'admin', role_rank: 90 }, { plan_key: 'club' }, 'active'],
    [{ role: 'head_manager', role_rank: 70 }, { plan_key: 'team' }, 'trialing'],
  ]) {
    const f = fixture({ caller, workspace, subscription: { status } })
    assert.equal((await f.handler(f.request())).status, 200)
    const payload = f.calls.find(([key]) => key === 'session')[1]
    assert.equal(payload.customer, 'cus_owner')
    assert.equal(payload.configuration, 'bpc_cancel')
    assert.equal(payload.flow_data.type, 'subscription_cancel')
    assert.equal(payload.flow_data.subscription_cancel.subscription, 'sub_owner')
    assert.equal(payload.return_url, 'https://footballplayer.online/billing')
  }
})

test('unauthenticated, inactive and non-owner actors cannot create a portal session', async () => {
  for (const caller of [
    { role: 'manager', role_rank: 50 }, { role: 'head_manager', role_rank: 70 },
    { role: 'parent', role_rank: 0 }, { role: 'super_admin', role_rank: 100 }, { status: 'inactive' }, { id: 'anotherAdmin' },
  ]) {
    const f = fixture({ caller })
    assert.equal((await f.handler(f.request())).status, 403)
    assert.equal(f.calls.some(([key]) => key === 'session'), false)
  }
  const f = fixture()
  assert.equal((await f.handler(f.request('{}', ''))).status, 401)
})

test('client cannot select another customer, subscription or redirect', async () => {
  for (const body of ['{"customer":"cus_other"}', '{"subscription":"sub_other"}', '{"return_url":"https://attacker.test"}', '[]', 'null', 'invalid']) {
    const f = fixture()
    assert.equal((await f.handler(f.request(body))).status, 400)
    assert.equal(f.calls.length, 0)
  }
})

test('workspace and provider ownership are both enforced', async () => {
  for (const overrides of [
    { workspace: { id: 'other' } }, { workspace: { workspace_owner_user_id: null } }, { workspace: { archived_at: '2026-10-06' } },
    { subscription: { customer: 'cus_other' } }, { subscription: { livemode: false } },
    { subscription: { status: 'canceled' } }, { configuration: { livemode: undefined } },
  ]) {
    const f = fixture(overrides)
    assert.ok([403, 409].includes((await f.handler(f.request())).status))
    assert.equal(f.calls.some(([key]) => key === 'session'), false)
  }
})

test('unverified cancellation policy blocks access instead of promising cancellation', async () => {
  for (const features of [
    { subscription_cancel: { enabled: false } },
    { subscription_cancel: { enabled: true, mode: 'immediately', proration_behavior: 'none' } },
    { subscription_cancel: { enabled: true, mode: 'at_period_end', proration_behavior: 'create_prorations' } },
    { subscription_cancel: { enabled: true, mode: 'at_period_end', proration_behavior: 'none' }, subscription_update: { enabled: true } },
  ]) {
    const f = fixture({ configuration: { features } })
    assert.equal((await f.handler(f.request())).status, 503)
    assert.equal(f.calls.some(([key]) => key === 'session'), false)
  }
  for (const feature of ['subscription_update', 'customer_update', 'payment_method_update', 'invoice_history']) {
    for (const state of [{ enabled: true }, undefined]) {
      const features = { subscription_cancel: { enabled: true, mode: 'at_period_end', proration_behavior: 'none' }, subscription_update: { enabled: false }, customer_update: { enabled: false }, payment_method_update: { enabled: false }, invoice_history: { enabled: false }, [feature]: state }
      const f = fixture({ configuration: { features } })
      assert.equal((await f.handler(f.request())).status, 503)
      assert.equal(f.calls.some(([key]) => key === 'session'), false)
    }
  }
})

test('provider failures and unexpected redirect domains produce an honest error', async () => {
  for (const overrides of [{ fail: 401 }, { fail: 403 }, { fail: 500 }, { url: 'https://attacker.test' }, { url: 'http://billing.stripe.com' }]) {
    const f = fixture(overrides)
    const response = await f.handler(f.request())
    assert.equal(response.status, 502)
    const body = await response.json()
    assert.equal(body.success, false)
    assert.equal(JSON.stringify(body).includes('secret fragment'), false)
  }
})
