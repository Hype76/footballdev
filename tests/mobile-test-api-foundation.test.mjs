import assert from 'node:assert/strict'
import test from 'node:test'

const TEST_REF = 'ndohkecigwlwayghsopw'

async function loadEnvironmentModule(values) {
  globalThis.Netlify = {
    env: {
      get(name) {
        return values[name]
      },
    },
  }
  return import(`../mobile-test-api/netlify/functions/_shared/environment.mjs?case=${Math.random()}`)
}

function validEnvironment(overrides = {}) {
  return {
    FP_MOBILE_ENV: 'test',
    SUPABASE_PROJECT_REF: TEST_REF,
    SUPABASE_URL: `https://${TEST_REF}.supabase.co`,
    SUPABASE_PUBLISHABLE_KEY: 'test-only-placeholder',
    FP_PRODUCTION_ACCESS: 'false',
    FP_COMMUNICATIONS_ENABLED: 'false',
    FP_SCHEDULES_ENABLED: 'false',
    ...overrides,
  }
}

test('accepts the dedicated test project boundary', async () => {
  const { requireMobileTestEnvironment } = await loadEnvironmentModule(validEnvironment())
  const result = requireMobileTestEnvironment()
  assert.equal(result.projectRef, TEST_REF)
  assert.equal(result.productionAccess, false)
})

test('rejects the live Supabase project', async () => {
  const liveRef = 'hvapkizujvsahvgspser'
  const { requireMobileTestEnvironment } = await loadEnvironmentModule(
    validEnvironment({
      SUPABASE_PROJECT_REF: liveRef,
      SUPABASE_URL: `https://${liveRef}.supabase.co`,
    }),
  )
  assert.throws(() => requireMobileTestEnvironment(), /boundary_failed/)
})

test('rejects the retired Supabase project', async () => {
  const retiredRef = 'llpufwzvgxyczxcjwupu'
  const { requireMobileTestEnvironment } = await loadEnvironmentModule(
    validEnvironment({
      SUPABASE_PROJECT_REF: retiredRef,
      SUPABASE_URL: `https://${retiredRef}.supabase.co`,
    }),
  )
  assert.throws(() => requireMobileTestEnvironment(), /boundary_failed/)
})

test('rejects production, communication, schedules, URL mismatch, and unknown target', async () => {
  for (const overrides of [
    { FP_MOBILE_ENV: 'live' },
    { FP_PRODUCTION_ACCESS: 'true' },
    { FP_COMMUNICATIONS_ENABLED: 'true' },
    { FP_SCHEDULES_ENABLED: 'true' },
    { SUPABASE_URL: 'https://example.test' },
    { SUPABASE_PROJECT_REF: 'unknown', SUPABASE_URL: 'https://unknown.supabase.co' },
  ]) {
    const { requireMobileTestEnvironment } = await loadEnvironmentModule(validEnvironment(overrides))
    assert.throws(() => requireMobileTestEnvironment())
  }
})
