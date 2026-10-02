import assert from 'node:assert/strict'
import test from 'node:test'

process.env.VITE_SUPABASE_URL = 'https://theme.example.test'
process.env.VITE_SUPABASE_PUBLISHABLE_KEY = 'test-publishable-key'
const { updateOwnThemeSettings, supabase } = await import('../src/lib/domain/core.js')
const { blockDemoMutation } = await import('../src/lib/domain/demo-guards.js')
const authUser = { id: '10000000-0000-4000-8000-000000000001', email: 'theme@example.test', role: 'authenticated' }
const activeUser = { id: authUser.id, email: authUser.email, role: 'coach', planStatus: 'active', planKey: 'matchday' }

test('normal Auth identity fails the staff guard; matching loaded profile lets theme save reach the self RPC', async () => {
  await assert.rejects(blockDemoMutation(authUser), { code: 'payment_required' })
  const originalRpc = supabase.rpc
  const calls = []
  supabase.rpc = async (name, args) => {
    calls.push({ name, args })
    return { data: { id: authUser.id, email: authUser.email, role: 'coach', theme_mode: args.profile_mode }, error: null }
  }
  try {
    const result = await updateOwnThemeSettings({ authUser, user: activeUser, mode: 'dark' })
    assert.equal(result.themeMode, 'dark')
    assert.deepEqual(calls, [{ name: 'update_own_theme_settings', args: { profile_mode: 'dark' } }])
  } finally { supabase.rpc = originalRpc }
})

test('missing, mismatched, unknown, unpaid and demo profiles cannot reach the RPC', async () => {
  const originalRpc = supabase.rpc
  let calls = 0
  supabase.rpc = async () => { calls++; throw new Error('unexpected RPC') }
  try {
    for (const user of [undefined, { ...activeUser, id: 'another-account' }, { ...activeUser, role: 'unknown' }, { ...activeUser, planKey: 'team', billingArrangement: 'immediate', planStatus: 'past_due' }, { ...activeUser, isDemoAccount: true }]) {
      await assert.rejects(updateOwnThemeSettings({ authUser, user, mode: 'dark' }))
      assert.equal(calls, 0)
    }
    await assert.rejects(updateOwnThemeSettings({ authUser: { ...authUser, email: 'demo@playerfeedback.online' }, user: activeUser, mode: 'dark' }))
    await assert.rejects(updateOwnThemeSettings({ authUser: { ...authUser, user_metadata: { role: 'super_admin' } }, user: { ...activeUser, role: 'unknown' }, mode: 'dark' }))
    assert.equal(calls, 0)
  } finally { supabase.rpc = originalRpc }
})

test('existing paid staff, free staff, Parent and Platform Admin guard decisions are preserved', async () => {
  const originalRpc = supabase.rpc
  let calls = 0
  supabase.rpc = async (name, args) => {
    calls++
    return { data: { id: authUser.id, role: 'coach', theme_mode: args.profile_mode }, error: null }
  }
  try {
    for (const user of [activeUser, { ...activeUser, planKey: 'team', billingArrangement: 'immediate' }, { ...activeUser, role: 'parent' }, { ...activeUser, role: 'super_admin' }]) {
      assert.equal((await updateOwnThemeSettings({ authUser, user, mode: 'invalid' })).themeMode, 'system')
    }
    assert.equal(calls, 4)
  } finally { supabase.rpc = originalRpc }
})

test('RPC refusal remains an error and all valid modes retain their persistence contract', async () => {
  const originalRpc = supabase.rpc
  const refusal = { code: '42501', message: 'profile_update_not_permitted' }
  try {
    supabase.rpc = async () => ({ data: null, error: refusal })
    await assert.rejects(updateOwnThemeSettings({ authUser, user: activeUser, mode: 'dark' }), error => error === refusal)
    for (const mode of ['system', 'light', 'dark']) {
      supabase.rpc = async (name, args) => ({ data: { id: authUser.id, role: 'coach', theme_mode: args.profile_mode }, error: null })
      assert.equal((await updateOwnThemeSettings({ authUser, user: activeUser, mode })).themeMode, mode)
    }
  } finally { supabase.rpc = originalRpc }
})
