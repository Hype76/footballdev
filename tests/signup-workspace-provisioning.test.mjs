import assert from 'node:assert/strict'
import test from 'node:test'

process.env.VITE_SUPABASE_URL = 'https://signup.example.test'
process.env.VITE_SUPABASE_PUBLISHABLE_KEY = 'test-publishable-key'

const { createClubAndManagerProfile, selectUserClub, supabase } = await import('../src/lib/domain/core.js')
const { blockDemoMutation } = await import('../src/lib/domain/demo-guards.js')

const authUser = {
  id: '10000000-0000-4000-8000-000000000001',
  email: 'signup@example.test',
  email_confirmed_at: '2026-09-30T05:00:00Z',
  user_metadata: { club_name: 'FP TEST Signup', signup_plan_key: 'matchday', account_type: 'coach' },
}

test('linked staff can select a club before workspace billing is loaded', async (t) => {
  const club = {
    id: 'billing-workspace-club',
    name: 'FP TEST Linked Club',
    plan_key: 'small_club',
    plan_status: 'past_due',
    billing_arrangement: 'immediate',
  }
  const staff = { id: authUser.id, email: authUser.email, club_id: club.id, role: 'coach', status: 'active' }
  const calls = []
  t.mock.method(supabase, 'rpc', async (name, args) => {
    calls.push(name)
    if (name === 'accept_own_club_user_invites') return { data: [] }
    assert.equal(name, 'activate_own_club_membership')
    assert.deepEqual(args, { target_club_id: club.id })
    return { data: staff }
  })
  t.mock.method(supabase, 'from', (table) => ({
    select: () => ({
      eq: (column, value) => {
        if (table === 'user_club_memberships') {
          assert.equal(column, 'auth_user_id')
          assert.equal(value, authUser.id)
          return { order: async () => ({ data: [{ ...staff, auth_user_id: authUser.id, clubs: club }] }) }
        }
        assert.equal(table, 'clubs')
        assert.equal(column, 'id')
        assert.equal(value, club.id)
        return { maybeSingle: async () => ({ data: club }) }
      },
    }),
  }))

  await assert.rejects(selectUserClub({ ...authUser, isDemoAccount: true }, club.id), /demo/i)
  assert.deepEqual(calls, [])
  await assert.rejects(selectUserClub(authUser, 'unlinked-club'), /not linked/)
  assert.deepEqual(calls, ['accept_own_club_user_invites'])

  const profile = await selectUserClub(authUser, club.id)
  assert.equal(profile.clubId, club.id)
  assert.equal(profile.planStatus, 'past_due')
  assert.deepEqual(calls.slice(1), ['accept_own_club_user_invites', 'activate_own_club_membership'])
  await assert.rejects(blockDemoMutation(profile), { code: 'payment_required' })
})

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
