import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'

import {
  getAdminAssignablePlanOptions,
  getPlan,
  getPlanLimit,
  getPublicPlanOptions,
  hasPlanFeature,
  isInternalPlanKey,
  isPlanAccessActive,
  isPlanPaymentRequired,
  isPublicPlanKey,
  PLAN_KEYS,
  PLAN_OPTIONS,
} from '../src/lib/plans.js'
import { pricingPlans } from '../src/lib/login-pricing.js'
import {
  normalizePlanKey as normalizeCheckoutPlanKey,
  SELF_SERVICE_CHECKOUT_PLAN_KEYS,
} from '../netlify/functions/lib/_stripe-billing.js'
import { handler as createCheckoutSession } from '../netlify/functions/create-checkout-session.js'

function readSource(path) {
  return readFileSync(path, 'utf8')
}

function checkoutEvent(body) {
  return {
    httpMethod: 'POST',
    headers: {},
    body: JSON.stringify(body),
  }
}

test('Pilot stays canonical, internal, admin assignable, and public hidden', () => {
  assert.equal(PLAN_KEYS.pilot, 'pilot')
  assert.equal(normalizeCheckoutPlanKey('Pilot'), PLAN_KEYS.pilot)
  assert.equal(PLAN_OPTIONS.some((plan) => plan.key === PLAN_KEYS.pilot), true)
  assert.equal(getAdminAssignablePlanOptions().some((plan) => plan.key === PLAN_KEYS.pilot), true)
  assert.equal(getPublicPlanOptions().some((plan) => plan.key === PLAN_KEYS.pilot), false)
  assert.equal(pricingPlans.some((plan) => plan.planKey === PLAN_KEYS.pilot), false)
  assert.equal(isPublicPlanKey(PLAN_KEYS.pilot), false)
  assert.equal(isInternalPlanKey(PLAN_KEYS.pilot), true)
  assert.equal(isPlanPaymentRequired(PLAN_KEYS.pilot), false)
})

test('Pilot mirrors Large Club entitlements without paid access requirements', () => {
  const pilot = {
    planKey: PLAN_KEYS.pilot,
    planStatus: 'past_due',
    isPlanComped: false,
  }

  assert.equal(isPlanAccessActive(pilot), true)
  assert.equal(hasPlanFeature(pilot, 'auditLogs'), true)
  assert.equal(hasPlanFeature(pilot, 'approvalWorkflow'), true)
  assert.equal(getPlanLimit(pilot, 'teams'), 10)
  assert.deepEqual(getPlan(PLAN_KEYS.pilot).features, getPlan(PLAN_KEYS.largeClub).features)
})

test('Pilot is blocked from self-service checkout on the server path', async () => {
  const previousSecret = process.env.STRIPE_SECRET_KEY
  const previousPaymentsDisabled = process.env.VITE_PAYMENTS_DISABLED

  process.env.STRIPE_SECRET_KEY = 'sk_test_placeholder'
  process.env.VITE_PAYMENTS_DISABLED = 'false'

  try {
    assert.equal(SELF_SERVICE_CHECKOUT_PLAN_KEYS.has(PLAN_KEYS.pilot), false)
    const response = await createCheckoutSession(checkoutEvent({
      planKey: PLAN_KEYS.pilot,
      billingCycle: 'monthly',
    }))

    assert.equal(response.statusCode, 400)
    assert.match(JSON.parse(response.body).message, /not available for self-service checkout/)
  } finally {
    if (previousSecret === undefined) {
      delete process.env.STRIPE_SECRET_KEY
    } else {
      process.env.STRIPE_SECRET_KEY = previousSecret
    }

    if (previousPaymentsDisabled === undefined) {
      delete process.env.VITE_PAYMENTS_DISABLED
    } else {
      process.env.VITE_PAYMENTS_DISABLED = previousPaymentsDisabled
    }
  }
})

test('Platform Admin flows preserve Pilot as forced free access', () => {
  const manageClubsSection = readSource('src/components/platform/ManageClubsSection.jsx')
  const platformSection = readSource('src/components/platform/PlatformAccountManagementSection.jsx')
  const platformPage = readSource('src/pages/PlatformAdminPage.jsx')
  const createClubFunction = readSource('netlify/functions/platform-create-club.js')
  const updateBillingFunction = readSource('netlify/functions/update-platform-club-billing.js')

  assert.match(manageClubsSection, /getAdminAssignablePlanOptions/)
  assert.match(platformSection, /getAdminAssignablePlanOptions/)
  assert.match(manageClubsSection, /form\.planKey === PLAN_KEYS\.pilot/)
  assert.match(platformPage, /fieldName === 'planKey' && value === PLAN_KEYS\.pilot[\s\S]*billingMode: 'unpaid'/)
  assert.match(platformPage, /fieldName === 'planKey' && value === PLAN_KEYS\.pilot[\s\S]*isPlanComped: true[\s\S]*planStatus: 'active'/)
  assert.match(createClubFunction, /billingMode === 'paid' && planKey === 'pilot'/)
  assert.match(createClubFunction, /billingMode === 'unpaid' \|\| planKey === 'pilot'/)
  assert.match(updateBillingFunction, /const nextPlanStatus = nextPlanKey === 'pilot' \? 'active' : requestedPlanStatus/)
  assert.match(updateBillingFunction, /const nextIsPlanComped = nextPlanKey === 'pilot'/)
})

test('Pilot database preservation record remains present in migrations', () => {
  const migration = readSource('supabase/migrations/20260629153000_add_internal_pilot_tier.sql')

  assert.match(migration, /then 'pilot'/)
  assert.match(migration, /plan_key in \('individual', 'single_team', 'small_club', 'development_club', 'large_club', 'pilot'\)/)
  assert.match(migration, /when target_plan_key = 'pilot' then 'large_club'/)
  assert.match(migration, /target_plan_key <> 'pilot'[\s\S]*public\.is_club_plan_access_active/)
})
