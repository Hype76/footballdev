import assert from 'node:assert/strict'
import test from 'node:test'
import { quoteSubscription } from '../src/lib/subscription-pricing.js'
import { PLAN_OPTIONS, PUBLIC_PLAN_OPTIONS, getPlanLimit } from '../src/lib/plans.js'
import { getCheckoutLineItems, getCheckoutSubscriptionPlanDetails, getSubscriptionPlanDetails, validateCheckoutPrices } from '../netlify/functions/lib/_stripe-billing.js'
import { createCheckoutSession } from '../netlify/functions/create-checkout-session.js'

const bindings = {
  STRIPE_TEAM_MONTHLY_PRICE_ID: 'price_team_m',
  STRIPE_TEAM_ANNUAL_PRICE_ID: 'price_team_a',
  STRIPE_CLUB_MONTHLY_PRICE_ID: 'price_club_m',
  STRIPE_CLUB_ANNUAL_PRICE_ID: 'price_club_a',
  STRIPE_CLUB_BLOCK_MONTHLY_PRICE_ID: 'price_block_m',
  STRIPE_CLUB_BLOCK_ANNUAL_PRICE_ID: 'price_block_a',
  STRIPE_PRICE_CLUB_20_MONTHLY: 'price_club20_m',
  STRIPE_PRICE_CLUB_20_ANNUAL: 'price_club20_a',
}
Object.assign(process.env, bindings)
const subscription = (id, metadata = {}) => ({ metadata, items: { data: [{ price: { id }, quantity: 1 }] } })

test('new public offer includes twenty teams at the existing base amount without changing legacy pricing', () => {
  for (const [billingCycle, amount] of [['monthly', 5999], ['annual', 59990]]) {
    const quote = quoteSubscription({ planKey: 'club', offerKey: 'club_20', teamCapacity: 20, billingCycle })
    assert.equal(quote.chargePence, amount)
    assert.equal(quote.includedTeams, 20)
    assert.equal(quote.additionalTeamBlocks, 0)
  }
  assert.equal(quoteSubscription({ planKey: 'club', teamCapacity: 10, billingCycle: 'monthly' }).chargePence, 5999)
  assert.equal(quoteSubscription({ planKey: 'club', teamCapacity: 20, billingCycle: 'monthly' }).chargePence, 10989)
  assert.equal(quoteSubscription({ planKey: 'club', teamCapacity: 30, billingCycle: 'annual' }).chargePence, 159790)
  assert.equal(PLAN_OPTIONS.find(plan => plan.key === 'club').limits.teams, 10)
  assert.equal(PUBLIC_PLAN_OPTIONS.find(plan => plan.key === 'club').limits.teams, 20)
  assert.equal(PUBLIC_PLAN_OPTIONS.find(plan => plan.key === 'club').offerKey, 'club_20')
})

test('public offer rejects arbitrary capacity and unknown or mismatched offer selections', () => {
  for (const input of [
    { planKey: 'club', offerKey: 'club_20', teamCapacity: 10 },
    { planKey: 'club', offerKey: 'club_20', teamCapacity: 30 },
    { planKey: 'team', offerKey: 'club_20', teamCapacity: 1 },
    { planKey: 'club', offerKey: 'club_30', teamCapacity: 20 },
    { planKey: 'club', offerKey: {}, teamCapacity: 20 },
  ]) assert.throws(() => quoteSubscription({ ...input, billingCycle: 'monthly' }), RangeError)
})

test('offer checkout uses only its distinct server-configured base price and quantity', () => {
  assert.deepEqual(getCheckoutLineItems('club', 'monthly', 20, 'club_20'), [{ price: 'price_club20_m', quantity: 1 }])
  assert.deepEqual(getCheckoutLineItems('club', 'annual', 20, 'club_20'), [{ price: 'price_club20_a', quantity: 1 }])
  assert.deepEqual(getCheckoutLineItems('club', 'monthly', 20), [{ price: 'price_club_m', quantity: 1 }, { price: 'price_block_m', quantity: 1 }])
})

test('new price identity fulfils twenty teams and existing subscriptions retain ten plus paid blocks', () => {
  for (const [cycle, id] of [['monthly', 'price_club20_m'], ['annual', 'price_club20_a']]) {
    const details = getCheckoutSubscriptionPlanDetails(subscription(id), { planKey: 'club', offerKey: 'club_20', teamCapacity: '20' })
    assert.deepEqual(details, { planKey: 'club', billingCycle: cycle, priceId: id, teamCapacity: 20, offerKey: 'club_20' })
    assert.equal(getPlanLimit({ planKey: details.planKey, planStatus: 'trialing', subscriptionTeamCapacity: details.teamCapacity }, 'teams'), 20)
  }
  const old = getSubscriptionPlanDetails(subscription('price_club_m', { offerKey: 'club_20', teamCapacity: '20' }))
  assert.equal(old.teamCapacity, 10)
  assert.equal(getPlanLimit({ planKey: 'club', planStatus: 'active', subscriptionTeamCapacity: old.teamCapacity }, 'teams'), 10)
  assert.equal(getSubscriptionPlanDetails({ items: { data: [{ price: { id: 'price_block_a' }, quantity: 2 }, { price: { id: 'price_club_a' }, quantity: 1 }] } }).teamCapacity, 30)
})

test('checkout fulfilment rejects forged offer, capacity and plan metadata instead of elevating entitlement', () => {
  assert.throws(() => getCheckoutSubscriptionPlanDetails(subscription('price_club_m'), { offerKey: 'club_20', teamCapacity: '20' }), RangeError)
  assert.throws(() => getCheckoutSubscriptionPlanDetails(subscription('price_club20_m'), { offerKey: 'club_30' }), RangeError)
  assert.throws(() => getCheckoutSubscriptionPlanDetails(subscription('price_club20_m'), { teamCapacity: '500' }), RangeError)
  assert.throws(() => getCheckoutSubscriptionPlanDetails(subscription('price_club20_m'), { planKey: 'team' }), RangeError)
  assert.equal(getCheckoutSubscriptionPlanDetails(subscription('price_club20_m'), {}).teamCapacity, 20)
})

test('new offer rejects blocks, duplicate or mixed bases and unrecognised price identities', () => {
  for (const data of [
    [{ price: { id: 'price_club20_m' }, quantity: 2 }],
    [{ price: { id: 'price_club20_m' }, quantity: 1 }, { price: { id: 'price_block_m' }, quantity: 1 }],
    [{ price: { id: 'price_club20_m' }, quantity: 1 }, { price: { id: 'price_club_m' }, quantity: 1 }],
    [{ price: { id: 'price_club20_m' }, quantity: 1 }, { price: { id: 'price_club20_a' }, quantity: 1 }],
    [{ price: { id: 'price_unknown' }, quantity: 1 }],
  ]) assert.throws(() => getSubscriptionPlanDetails({ metadata: { offerKey: 'club_20' }, items: { data } }), RangeError)
})

test('missing or colliding offer price bindings fail closed', () => {
  const previous = process.env.STRIPE_PRICE_CLUB_20_MONTHLY
  try {
    delete process.env.STRIPE_PRICE_CLUB_20_MONTHLY
    assert.throws(() => getCheckoutLineItems('club', 'monthly', 20, 'club_20'), RangeError)
    for (const id of ['price_club_m', 'price_block_m', 'price_club20_a']) {
      process.env.STRIPE_PRICE_CLUB_20_MONTHLY = id
      assert.throws(() => getCheckoutLineItems('club', 'monthly', 20, 'club_20'), RangeError)
      assert.throws(() => getSubscriptionPlanDetails(subscription(id)), RangeError)
    }
  } finally { process.env.STRIPE_PRICE_CLUB_20_MONTHLY = previous }
})

test('offer validates provider amount, currency, interval, status and authoritative line items', async () => {
  const goodPrice = { active: true, unit_amount: 5999, currency: 'gbp', recurring: { interval: 'month', interval_count: 1 } }
  const items = getCheckoutLineItems('club', 'monthly', 20, 'club_20')
  await assert.doesNotReject(() => validateCheckoutPrices({ prices: { retrieve: async () => goodPrice } }, items, 'club', 'monthly', 20, 'club_20'))
  for (const price of [{ ...goodPrice, active: false }, { ...goodPrice, unit_amount: 10989 }, { ...goodPrice, currency: 'usd' }, { ...goodPrice, recurring: { interval: 'year', interval_count: 1 } }]) {
    await assert.rejects(() => validateCheckoutPrices({ prices: { retrieve: async () => price } }, items, 'club', 'monthly', 20, 'club_20'), RangeError)
  }
  await assert.rejects(() => validateCheckoutPrices({ prices: { retrieve: async () => goodPrice } }, [{ price: 'price_club_m', quantity: 1 }], 'club', 'monthly', 20, 'club_20'), RangeError)
})

test('fresh twenty-team checkout retains fourteen-day trial and carries offer for cross-checking', async () => {
  let request
  await createCheckoutSession({ checkout: { sessions: { create: async value => { request = value; return { url: 'https://checkout.example.test' } } } } }, {
    appUrl: 'https://footballplayer.online', planKey: 'club', planName: 'Club', offerKey: 'club_20', billingCycle: 'monthly', teamCapacity: 20,
    lineItems: getCheckoutLineItems('club', 'monthly', 20, 'club_20'), workspaceScope: 'club',
  })
  assert.equal(request.subscription_data.trial_period_days, 14)
  assert.equal(request.metadata.offerKey, 'club_20')
  assert.equal(request.subscription_data.metadata.offerKey, 'club_20')
  assert.deepEqual(request.line_items, [{ price: 'price_club20_m', quantity: 1 }])
})
