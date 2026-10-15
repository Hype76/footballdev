import assert from 'node:assert/strict'
import test from 'node:test'
import { DEMO_EMAIL } from '../src/lib/demo.js'

process.env.VITE_SUPABASE_URL = 'https://theme.example.test'
process.env.VITE_SUPABASE_PUBLISHABLE_KEY = 'test-publishable-key'

const { updateOwnThemeSettings, supabase } = await import('../src/lib/domain/core.js')
const { blockDemoMutation } = await import('../src/lib/domain/demo-guards.js')
const authUser = { id: 'theme-user', email: 'theme@example.test' }

test('personal modes reach the self-only RPC with an auth identity and no staff billing context', async () => {
  const originalRpc = supabase.rpc
  const calls = []
  supabase.rpc = async (name, payload) => {
    calls.push({ name, payload })
    return { data: { id: authUser.id, theme_mode: payload.profile_mode }, error: null }
  }
  try {
    for (const mode of ['light', 'dark', 'system']) {
      const saved = await updateOwnThemeSettings({ authUser, mode })
      assert.equal(saved.themeMode, mode)
    }
    assert.deepEqual(calls, ['light', 'dark', 'system'].map(mode => ({
      name: 'update_own_theme_settings', payload: { profile_mode: mode },
    })))
    await assert.rejects(blockDemoMutation(authUser), { code: 'payment_required' })
  } finally {
    supabase.rpc = originalRpc
  }
})

test('personal saves reject missing identity and demos, and propagate server refusal', async () => {
  const originalRpc = supabase.rpc
  let calls = 0
  const refusal = new Error('profile_update_not_permitted')
  supabase.rpc = async () => { calls++; return { data: null, error: refusal } }
  try {
    await assert.rejects(updateOwnThemeSettings({ authUser: null, mode: 'dark' }), /Signed in user/)
    await assert.rejects(updateOwnThemeSettings({ authUser: { ...authUser, isDemoAccount: true }, mode: 'dark' }), /demo/i)
    await assert.rejects(updateOwnThemeSettings({ authUser: { ...authUser, email: DEMO_EMAIL }, mode: 'dark' }), /demo/i)
    assert.equal(calls, 0)
    await assert.rejects(updateOwnThemeSettings({ authUser, mode: 'dark' }), error => error === refusal)
    assert.equal(calls, 1)
  } finally {
    supabase.rpc = originalRpc
  }
})
