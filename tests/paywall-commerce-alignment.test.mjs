import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'

import {
  getPlanFromPriceId,
  getPriceMap,
  normalizePlanStatus,
  SELF_SERVICE_CHECKOUT_PLAN_KEYS,
} from '../netlify/functions/lib/_stripe-billing.js'
import { handler as createCheckoutSession } from '../netlify/functions/create-checkout-session.js'
import { formatPrice, formatPriceLabel, pricingPlans } from '../src/lib/login-pricing.js'
import { PLAN_KEYS, PLAN_PURCHASE_MODES } from '../src/lib/plans.js'

function findPricingPlan(planKey) {
  return pricingPlans.find((plan) => plan.planKey === planKey)
}

function checkoutEvent(body) {
  return {
    httpMethod: 'POST',
    headers: {},
    body: JSON.stringify(body),
  }
}

async function withCheckoutEnv(callback) {
  const previousValues = {
    STRIPE_SECRET_KEY: process.env.STRIPE_SECRET_KEY,
    VITE_PAYMENTS_DISABLED: process.env.VITE_PAYMENTS_DISABLED,
    VITE_STRIPE_DEVELOPMENT_CLUB_MONTHLY_PRICE_ID: process.env.VITE_STRIPE_DEVELOPMENT_CLUB_MONTHLY_PRICE_ID,
  }

  process.env.STRIPE_SECRET_KEY = 'sk_test_placeholder'
  process.env.VITE_PAYMENTS_DISABLED = 'false'
  delete process.env.VITE_STRIPE_DEVELOPMENT_CLUB_MONTHLY_PRICE_ID

  try {
    return await callback()
  } finally {
    for (const [key, value] of Object.entries(previousValues)) {
      if (value === undefined) {
        delete process.env[key]
      } else {
        process.env[key] = value
      }
    }
  }
}

test('public pricing exposes the approved five-tier model', () => {
  assert.deepEqual(pricingPlans.map((plan) => plan.planKey), [
    PLAN_KEYS.individual,
    PLAN_KEYS.singleTeam,
    PLAN_KEYS.smallClub,
    PLAN_KEYS.developmentClub,
    PLAN_KEYS.largeClub,
  ])

  assert.equal(formatPrice(findPricingPlan(PLAN_KEYS.individual), 'monthly'), 'Free')
  assert.equal(formatPrice(findPricingPlan(PLAN_KEYS.singleTeam), 'monthly'), '\u00a312.99')
  assert.equal(formatPrice(findPricingPlan(PLAN_KEYS.smallClub), 'monthly'), '\u00a334.99')
  assert.equal(formatPrice(findPricingPlan(PLAN_KEYS.developmentClub), 'monthly'), '\u00a359.99')
  assert.equal(formatPrice(findPricingPlan(PLAN_KEYS.largeClub), 'monthly'), '\u00a399.99+')
  assert.equal(formatPriceLabel(findPricingPlan(PLAN_KEYS.largeClub), 'monthly'), 'per month, contact sales')
})

test('public pricing copy keeps Free preview-only and Single Team complete', () => {
  const freePlan = findPricingPlan(PLAN_KEYS.individual)
  const singleTeamPlan = findPricingPlan(PLAN_KEYS.singleTeam)
  const smallClubPlan = findPricingPlan(PLAN_KEYS.smallClub)
  const developmentClubPlan = findPricingPlan(PLAN_KEYS.developmentClub)
  const largeClubPlan = findPricingPlan(PLAN_KEYS.largeClub)

  assert.equal(freePlan.purchaseMode, PLAN_PURCHASE_MODES.free)
  assert.ok(freePlan.features.includes('Family portal preview only'))
  assert.equal(freePlan.features.some((feature) => /^Family portal$/.test(feature)), false)

  assert.equal(singleTeamPlan.description, 'The complete Football Player product for one team.')
  assert.ok(singleTeamPlan.features.includes('Parent portal, parent emails, and PDF reports'))
  assert.ok(singleTeamPlan.features.includes('Calendar, training events, fixtures, match day, and polls'))

  assert.equal(smallClubPlan.features.includes('Unlimited staff logins'), false)
  assert.equal(smallClubPlan.features.includes('Unlimited players'), false)
  assert.ok(developmentClubPlan.features.includes('Scheduled parent reports'))
  assert.equal(largeClubPlan.purchaseMode, PLAN_PURCHASE_MODES.contactSales)
  assert.ok(largeClubPlan.features.includes('Integrations where available'))
})

test('checkout rejects unknown, Free, Large, and unconfigured Development Club plans', async () => {
  await withCheckoutEnv(async () => {
    const unknown = await createCheckoutSession(checkoutEvent({ planKey: 'future_enterprise_plus', billingCycle: 'monthly' }))
    assert.equal(unknown.statusCode, 400)
    assert.match(JSON.parse(unknown.body).message, /valid billing plan/)

    const free = await createCheckoutSession(checkoutEvent({ planKey: PLAN_KEYS.individual, billingCycle: 'monthly' }))
    assert.equal(free.statusCode, 400)
    assert.match(JSON.parse(free.body).message, /not available for self-service checkout/)

    const large = await createCheckoutSession(checkoutEvent({ planKey: PLAN_KEYS.largeClub, billingCycle: 'monthly' }))
    assert.equal(large.statusCode, 400)
    assert.match(JSON.parse(large.body).message, /not available for self-service checkout/)

    const development = await createCheckoutSession(checkoutEvent({ planKey: PLAN_KEYS.developmentClub, billingCycle: 'monthly' }))
    assert.equal(development.statusCode, 400)
    assert.match(JSON.parse(development.body).message, /not available for checkout yet/)
  })
})

test('Stripe price mapping supports Development Club and fails closed for unknown prices', () => {
  const previousMonthly = process.env.VITE_STRIPE_DEVELOPMENT_CLUB_MONTHLY_PRICE_ID

  process.env.VITE_STRIPE_DEVELOPMENT_CLUB_MONTHLY_PRICE_ID = 'price_dev_monthly_test'

  try {
    assert.equal(SELF_SERVICE_CHECKOUT_PLAN_KEYS.has(PLAN_KEYS.developmentClub), true)
    assert.deepEqual(getPriceMap().price_dev_monthly_test, {
      planKey: PLAN_KEYS.developmentClub,
      billingCycle: 'monthly',
    })
    assert.deepEqual(getPlanFromPriceId('price_dev_monthly_test'), {
      planKey: PLAN_KEYS.developmentClub,
      billingCycle: 'monthly',
    })
    assert.deepEqual(getPlanFromPriceId('price_unknown'), {
      planKey: '',
      billingCycle: '',
    })
  } finally {
    if (previousMonthly === undefined) {
      delete process.env.VITE_STRIPE_DEVELOPMENT_CLUB_MONTHLY_PRICE_ID
    } else {
      process.env.VITE_STRIPE_DEVELOPMENT_CLUB_MONTHLY_PRICE_ID = previousMonthly
    }
  }
})

test('webhook code rejects price tampering and keeps idempotency handling', () => {
  const source = readFileSync('netlify/functions/stripe-webhook.js', 'utf8')

  assert.doesNotMatch(source, /pricePlan\.planKey\s*\|\|\s*metadataPlanKey/)
  assert.match(source, /Checkout price did not match a configured plan/)
  assert.match(source, /Checkout metadata plan does not match the configured Stripe price/)
  assert.match(source, /Subscription price did not match a configured plan/)
  assert.match(source, /error\?\.code === '23505'/)
})

test('billing status normalization keeps canceled and expired subscriptions inactive', () => {
  assert.equal(normalizePlanStatus('canceled'), 'cancelled')
  assert.equal(normalizePlanStatus('cancelled'), 'cancelled')
  assert.equal(normalizePlanStatus('incomplete_expired'), 'past_due')
  assert.equal(normalizePlanStatus('unpaid'), 'past_due')
})
