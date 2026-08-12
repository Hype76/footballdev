import assert from 'node:assert/strict'
import test from 'node:test'

process.env.VITE_SUPABASE_URL = 'https://example.supabase.co'
process.env.SUPABASE_SERVICE_ROLE_KEY = 'test-service-role-key'

const {
  assertPlanFeature,
  assertTrustedSystemPlanFeature,
} = await import('../netlify/functions/lib/_plan-gate.js')

const activeCompedSystemProfile = {
  planKey: 'pilot',
  planStatus: 'active',
  isPlanComped: true,
  role: 'system',
  roleRank: 100,
  clubId: 'demo-club',
}

test('scheduled email plan gate only permits an explicitly trusted system worker', () => {
  assert.throws(
    () => assertPlanFeature(activeCompedSystemProfile, 'parentEmails'),
    { code: 'payment_required', statusCode: 402 },
  )
  assert.doesNotThrow(
    () => assertTrustedSystemPlanFeature(activeCompedSystemProfile, 'parentEmails'),
  )
})

test('trusted system worker still fails closed for an unpaid workspace', () => {
  const unpaidSystemProfile = {
    ...activeCompedSystemProfile,
    planKey: 'small_club',
    planStatus: 'past_due',
    isPlanComped: false,
    billingArrangement: 'immediate',
  }

  assert.throws(
    () => assertTrustedSystemPlanFeature(unpaidSystemProfile, 'parentEmails'),
    { code: 'payment_required', statusCode: 402 },
  )
})

test('trusted system worker cannot bypass plan capability entitlement', () => {
  assert.throws(
    () => assertTrustedSystemPlanFeature({
      ...activeCompedSystemProfile,
      planKey: 'free',
      planStatus: 'active',
      isPlanComped: false,
    }, 'parentEmails'),
    { statusCode: 403 },
  )
})
