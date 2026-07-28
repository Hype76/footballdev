import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { test } from 'node:test'

import {
  createStripeServerClient,
  getExpectedStripeMode,
  inspectStripeServerKey,
} from '../netlify/functions/lib/_stripe-runtime.js'
import {
  getApprovedInternalSmokeRecipientCount,
  isApprovedInternalSmokeRecipient,
} from '../netlify/functions/lib/_internal-smoke-recipients.js'

const sourcePaths = {
  billingPage: new URL('../src/pages/PlatformBillingOptionsPage.jsx', import.meta.url),
  checkout: new URL('../netlify/functions/create-checkout-session.js', import.meta.url),
  coupons: new URL('../netlify/functions/manage-stripe-coupons.js', import.meta.url),
  diagnostics: new URL('../netlify/functions/email-diagnostics.js', import.meta.url),
  livePromotion: new URL('../netlify/functions/get-live-promotion.js', import.meta.url),
  stripeRuntime: new URL('../netlify/functions/lib/_stripe-runtime.js', import.meta.url),
  summary: new URL('../netlify/functions/get-billing-summary.js', import.meta.url),
  updateBilling: new URL('../netlify/functions/update-platform-club-billing.js', import.meta.url),
  webhook: new URL('../netlify/functions/stripe-webhook.js', import.meta.url),
}

async function readSources() {
  return Object.fromEntries(
    await Promise.all(Object.entries(sourcePaths).map(async ([key, url]) => [key, await readFile(url, 'utf8')])),
  )
}

test('server key inspection accepts live secret and restricted keys without returning their value', () => {
  for (const key of ['sk_live_fixture_value', 'rk_live_fixture_value']) {
    const inspection = inspectStripeServerKey(key, { expectedMode: 'live' })

    assert.equal(inspection.valid, true)
    assert.equal(inspection.mode, 'live')
    assert.equal(Object.values(inspection).includes(key), false)
  }
})

test('server key inspection fails closed for missing, publishable, wrong-mode, malformed and unsupported keys', () => {
  assert.equal(inspectStripeServerKey('', { expectedMode: 'live' }).code, 'missing')
  assert.equal(inspectStripeServerKey('pk_live_fixture', { expectedMode: 'live' }).code, 'publishable_key')
  assert.equal(inspectStripeServerKey('sk_test_fixture', { expectedMode: 'live' }).code, 'wrong_mode')
  assert.equal(inspectStripeServerKey(' sk_live_fixture ', { expectedMode: 'live' }).code, 'malformed')
  assert.equal(inspectStripeServerKey('"sk_live_fixture"', { expectedMode: 'live' }).code, 'malformed')
  assert.equal(inspectStripeServerKey('future_live_fixture', { expectedMode: 'live' }).code, 'unsupported_key')
})

test('production expects live mode while preview and development expect test mode', () => {
  assert.equal(getExpectedStripeMode({ CONTEXT: 'production' }), 'live')
  assert.equal(getExpectedStripeMode({ CONTEXT: 'deploy-preview' }), 'test')
  assert.equal(getExpectedStripeMode({ CONTEXT: 'branch-deploy' }), 'test')
  assert.equal(getExpectedStripeMode({ CONTEXT: 'dev' }), 'test')
  assert.equal(getExpectedStripeMode({}), '')
})

test('Stripe client construction validates mode and keeps the key server-side', () => {
  const constructorCalls = []

  class FakeStripe {
    constructor(key, options) {
      constructorCalls.push({ key, options })
    }
  }

  createStripeServerClient({
    env: {
      CONTEXT: 'production',
      STRIPE_SECRET_KEY: 'rk_live_fixture_value',
    },
    StripeConstructor: FakeStripe,
  })

  assert.equal(constructorCalls.length, 1)
  assert.equal(constructorCalls[0].key, 'rk_live_fixture_value')
  assert.equal(typeof constructorCalls[0].options.apiVersion, 'string')

  assert.throws(
    () => createStripeServerClient({
      env: {
        CONTEXT: 'production',
        STRIPE_SECRET_KEY: 'sk_test_fixture_value',
      },
      StripeConstructor: FakeStripe,
    }),
    (error) => error?.isStripeConfigurationError === true && error?.code === 'wrong_mode',
  )
})

test('billing functions use the shared server-only Stripe client and no browser Stripe secret', async () => {
  const sources = await readSources()

  for (const key of ['checkout', 'coupons', 'livePromotion', 'summary', 'updateBilling', 'webhook']) {
    assert.match(sources[key], /createStripeServerClient/)
    assert.doesNotMatch(sources[key], /import Stripe from 'stripe'/)
  }

  assert.match(sources.stripeRuntime, /process\.env/)
  assert.doesNotMatch(sources.billingPage, /STRIPE_SECRET_KEY|sk_live_|rk_live_|sk_test_|rk_test_/)
})

test('coupon management preserves platform authority and returns a generic provider failure', async () => {
  const { coupons } = await readSources()

  assert.match(coupons, /loadActiveAuthorityProfile/)
  assert.match(coupons, /profile\.role !== 'super_admin'/)
  assert.match(coupons, /Platform admin access is required/)
  assert.match(coupons, /Stripe coupon data is temporarily unavailable\./)
  assert.match(coupons, /json\(503/)
  assert.doesNotMatch(coupons, /message:\s*error\.message\s*\|\|/)
})

test('Billing Options keeps Stripe and tester partial-load failures separate', async () => {
  const { billingPage } = await readSources()

  assert.match(billingPage, /couponErrorMessage/)
  assert.match(billingPage, /testerCodeErrorMessage/)
  assert.match(billingPage, /title="Stripe coupon data unavailable"/)
  assert.match(billingPage, /title="Tester access data unavailable"/)
  assert.match(billingPage, /hasStripeDataError=\{Boolean\(couponErrorMessage\)\}/)
})

test('Billing Options shares concurrent coupon and tester load promises', async () => {
  const { billingPage } = await readSources()

  assert.match(billingPage, /couponLoadRequestRef = useRef\(null\)/)
  assert.match(billingPage, /testerCodeLoadRequestRef = useRef\(null\)/)
  assert.match(billingPage, /sharedBillingLoadRequests = new Map\(\)/)
  assert.match(billingPage, /getSharedBillingLoadRequest\(`coupons:/)
  assert.match(billingPage, /getSharedBillingLoadRequest\(`tester-codes:/)
  assert.match(billingPage, /existingRequest\?\.key === requestKey/)
  assert.match(billingPage, /couponLoadRequestRef\.current = \{[\s\S]*promise: request/)
  assert.match(billingPage, /testerCodeLoadRequestRef\.current = \{[\s\S]*promise: request/)
})

test('checkout, subscription reads, plan changes and webhooks retain their safety boundaries', async () => {
  const sources = await readSources()

  assert.match(sources.checkout, /mode: 'subscription'/)
  assert.match(sources.checkout, /trial_period_days: 14/)
  assert.match(sources.checkout, /allow_promotion_codes = true/)
  assert.match(sources.summary, /stripe\.invoices\.list/)
  assert.match(sources.updateBilling, /stripe\.subscriptions\.update/)
  assert.match(sources.webhook, /stripe\.webhooks\.constructEvent/)
  assert.match(sources.webhook, /process\.env\.STRIPE_WEBHOOK_SECRET/)
  assert.doesNotMatch(sources.webhook, /message:\s*error\.message/)
})

test('customer portal remains an external read-only configuration check, not an unsafe application mutation', async () => {
  const sources = await readSources()
  const billingSources = [
    sources.checkout,
    sources.coupons,
    sources.livePromotion,
    sources.summary,
    sources.updateBilling,
    sources.webhook,
  ].join('\n')

  assert.doesNotMatch(billingSources, /billingPortal\.configurations\.(?:create|update)|billing_portal\/configurations/)
  assert.doesNotMatch(billingSources, /billingPortal\.sessions\.create/)
})

test('approved post-deployment smoke recipients include Steve and remain internal-only', () => {
  assert.equal(isApprovedInternalSmokeRecipient('support@jelumalabs.com'), true)
  assert.equal(isApprovedInternalSmokeRecipient('STEVE@JELUMALABS.COM'), true)
  assert.equal(isApprovedInternalSmokeRecipient('parent@example.com'), false)
  assert.equal(getApprovedInternalSmokeRecipientCount(), 2)
})

test('email diagnostics enforce the approved internal smoke-recipient policy before provider submission', async () => {
  const { diagnostics } = await readSources()

  assert.match(diagnostics, /isApprovedInternalSmokeRecipient\(toEmail\)/)
  assert.match(diagnostics, /Email diagnostics are limited to approved internal smoke recipients\./)
  assert.ok(
    diagnostics.indexOf('isApprovedInternalSmokeRecipient(toEmail)') <
    diagnostics.indexOf('const response = await sendEmail'),
  )
})
