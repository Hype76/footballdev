import assert from 'node:assert/strict'
import test from 'node:test'

process.env.VITE_SUPABASE_URL = 'https://signup.example.test'
process.env.VITE_SUPABASE_PUBLISHABLE_KEY = 'test-publishable-key'

const { createClubAndManagerProfile, supabase } = await import('../src/lib/domain/core.js')
const { blockDemoMutation } = await import('../src/lib/domain/demo-guards.js')

const authUser = {
  id: '10000000-0000-4000-8000-000000000001',
  email: 'signup@example.test',
  email_confirmed_at: '2026-09-30T05:00:00Z',
  user_metadata: { club_name: 'FP TEST Signup', signup_plan_key: 'matchday', account_type: 'coach' },
}

test('a confirmed new account can reach server-authorised signup before it has a staff role', async () => {
  const originalFetch = globalThis.fetch
  const originalSession = supabase.auth.getSession
  let requests = 0
  supabase.auth.getSession = async () => ({ data: { session: { access_token: 'test-token', user: authUser } } })
  globalThis.fetch = async (url, options) => {
    requests++
    assert.equal(url, '/.netlify/functions/ensure-signup-club-profile')
    assert.equal(options.headers.Authorization, 'Bearer test-token')
    const body = JSON.parse(options.body)
    assert.equal(body.clubName, 'FP TEST Signup')
    assert.equal(body.planKey, 'matchday')
    return Response.json({ success: true, profile: { id: authUser.id, email: authUser.email, role: 'head_manager', role_rank: 70, club_id: 'test-club' }, club: { id: 'test-club', name: 'FP TEST Signup', plan_key: 'matchday', plan_status: 'active' } })
  }
  try {
    const profile = await createClubAndManagerProfile({ authUser, clubName: 'FP TEST Signup', planKey: 'matchday' })
    assert.equal(profile.id, authUser.id)
    assert.equal(profile.role, 'head_manager')
    assert.equal(profile.clubId, 'test-club')
    assert.equal(requests, 1)
    // The signup exception must not grant ordinary staff mutation authority.
    await assert.rejects(blockDemoMutation(authUser), { code: 'payment_required' })
  } finally {
    globalThis.fetch = originalFetch
    supabase.auth.getSession = originalSession
  }
})

test('the signup request preserves server refusal of an unpaid paid plan', async () => {
  const originalFetch = globalThis.fetch
  const originalSession = supabase.auth.getSession
  let requests = 0
  supabase.auth.getSession = async () => ({ data: { session: { access_token: 'test-token', user: authUser } } })
  globalThis.fetch = async () => {
    requests++
    return Response.json({ success: false, message: 'Checkout is required.' }, { status: 403 })
  }
  try {
    await assert.rejects(createClubAndManagerProfile({ authUser, clubName: 'FP TEST Signup', planKey: 'club' }), /Checkout is required/)
    assert.equal(requests, 1)
  } finally {
    globalThis.fetch = originalFetch
    supabase.auth.getSession = originalSession
  }
})

test('demo accounts cannot provision a workspace', async () => {
  let requests = 0
  const originalFetch = globalThis.fetch
  globalThis.fetch = async () => { requests++; assert.fail('demo signup must not call the server') }
  try {
    await assert.rejects(createClubAndManagerProfile({ authUser: { ...authUser, isDemoAccount: true }, clubName: 'FP TEST Signup' }), /demo/i)
    assert.equal(requests, 0)
  } finally { globalThis.fetch = originalFetch }
})

test('unconfirmed and mismatched sessions cannot create a workspace', async () => {
  const originalFetch = globalThis.fetch
  const originalSession = supabase.auth.getSession
  let requests = 0
  globalThis.fetch = async () => { requests++; assert.fail('invalid session must not call the server') }
  try {
    await assert.rejects(createClubAndManagerProfile({ authUser: { ...authUser, email_confirmed_at: null } }), /Confirm your email/)
    for (const session of [null, { access_token: 'test-token', user: { id: 'another-account' } }]) {
      supabase.auth.getSession = async () => ({ data: { session } })
      await assert.rejects(createClubAndManagerProfile({ authUser }), /Login again/)
    }
    assert.equal(requests, 0)
  } finally {
    globalThis.fetch = originalFetch
    supabase.auth.getSession = originalSession
  }
})
