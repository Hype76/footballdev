import assert from 'node:assert/strict'
import test from 'node:test'
import {
  getCheckoutLineItems,
  getSubscriptionPlanDetails,
  validateCheckoutPrices,
} from '../netlify/functions/lib/_stripe-billing.js'

const env = {
  STRIPE_TEAM_MONTHLY_PRICE_ID: 'price_team_m',
  STRIPE_TEAM_ANNUAL_PRICE_ID: 'price_team_a',
  STRIPE_CLUB_MONTHLY_PRICE_ID: 'price_club_m',
  STRIPE_CLUB_ANNUAL_PRICE_ID: 'price_club_a',
  STRIPE_CLUB_BLOCK_MONTHLY_PRICE_ID: 'price_block_m',
  STRIPE_CLUB_BLOCK_ANNUAL_PRICE_ID: 'price_block_a',
  VITE_STRIPE_SINGLE_TEAM_MONTHLY_PRICE_ID: 'price_legacy',
}

for (const [key, value] of Object.entries(env)) process.env[key] = value

test('builds modern Team and Club line items with trusted quantities', () => {
  assert.deepEqual(getCheckoutLineItems('team', 'annual', 1), [{ price: 'price_team_a', quantity: 1 }])
  assert.deepEqual(getCheckoutLineItems('club', 'monthly', 30), [
    { price: 'price_club_m', quantity: 1 },
    { price: 'price_block_m', quantity: 2 },
  ])
})

test('resolves modern subscriptions regardless of item order', () => {
  assert.deepEqual(getSubscriptionPlanDetails({ items: { data: [
    { price: { id: 'price_block_a' }, quantity: 2 },
    { price: { id: 'price_club_a' }, quantity: 1 },
  ] } }), { planKey: 'club', billingCycle: 'annual', priceId: 'price_club_a', teamCapacity: 30 })
})

test('preserves legacy single price mapping', () => {
  assert.deepEqual(getSubscriptionPlanDetails({ items: { data: [{ price: { id: 'price_legacy' }, quantity: 1 }] } }), { planKey: 'single_team', billingCycle: 'monthly', priceId: 'price_legacy', teamCapacity: 1 })
})

test('rejects tampered, duplicate, unknown, and mismatched modern items', () => {
  const cases = [
    [{ price: { id: 'price_club_m' }, quantity: 2 }],
    [{ price: { id: 'price_club_m' }, quantity: 1 }, { price: { id: 'price_block_m' }, quantity: 50 }],
    [{ price: { id: 'price_club_m' }, quantity: 1 }, { price: { id: 'price_block_a' }, quantity: 1 }],
    [{ price: { id: 'price_club_m' }, quantity: 1 }, { price: { id: 'price_block_m' }, quantity: 1 }, { price: { id: 'price_block_m' }, quantity: 1 }],
    [{ price: { id: 'price_club_m' }, quantity: 1 }, { price: { id: 'price_unknown' }, quantity: 1 }],
  ]
  for (const data of cases) assert.throws(() => getSubscriptionPlanDetails({ items: { data } }), RangeError)
})

test('rejects missing modern checkout prices', () => {
  const previous = process.env.STRIPE_CLUB_BLOCK_MONTHLY_PRICE_ID
  delete process.env.STRIPE_CLUB_BLOCK_MONTHLY_PRICE_ID
  assert.throws(() => getCheckoutLineItems('club', 'monthly', 20), RangeError)
  process.env.STRIPE_CLUB_BLOCK_MONTHLY_PRICE_ID = previous
})

test('validates provider amount, currency, interval, and active state', async () => {
  const lineItems = [{ price: 'price_team_m', quantity: 1 }]
  const good = { prices: { retrieve: async () => ({ active: true, unit_amount: 799, currency: 'gbp', recurring: { interval: 'month', interval_count: 1 } }) } }
  await assert.doesNotReject(() => validateCheckoutPrices(good, lineItems, 'team', 'monthly', 1))
  for (const price of [
    { active: false, unit_amount: 799, currency: 'gbp', recurring: { interval: 'month', interval_count: 1 } },
    { active: true, unit_amount: 800, currency: 'gbp', recurring: { interval: 'month', interval_count: 1 } },
    { active: true, unit_amount: 799, currency: 'usd', recurring: { interval: 'month', interval_count: 1 } },
    { active: true, unit_amount: 799, currency: 'gbp', recurring: { interval: 'year', interval_count: 1 } },
  ]) {
    await assert.rejects(() => validateCheckoutPrices({ prices: { retrieve: async () => price } }, lineItems, 'team', 'monthly', 1), RangeError)
  }
})
