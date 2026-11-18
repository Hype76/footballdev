import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'

const source = readFileSync('src/lib/auth.js', 'utf8')
const start = source.indexOf('  const signInWithPassword = async ('), end = source.indexOf('  const selectClub = async', start)
assert.ok(start >= 0 && end > start)

function harness({ reject = false } = {}) {
  const storage = new Map([['club', 'child-club'], ['team', 'child-team'], ['mode', 'parent']])
  const calls = []
  const window = { sessionStorage: { setItem: (key, value) => storage.set(key, value), removeItem: key => storage.delete(key) } }
  const dependencies = {
    window, SELECTED_ACCESS_MODE_STORAGE_KEY: 'mode', SELECTED_ACCESS_MODE_EXPLICIT_KEY: 'explicit',
    SELECTED_CLUB_STORAGE_KEY: 'club', SELECTED_TEAM_STORAGE_KEY: 'team', STAFF_SWITCH_PENDING_STORAGE_KEY: 'pending',
    setAuthError() {}, rememberLoginAccessIntent: mode => storage.set('intent', mode), clearLoginAccessIntent: () => storage.delete('intent'),
    createPublicSignInError: error => new Error(error.message), recordSuccessfulLoginAnalytics: async () => {},
    supabase: { auth: { signInWithPassword: async credentials => {
      calls.push(credentials)
      assert.equal(storage.get('mode'), 'player')
      assert.equal(storage.get('intent'), 'player')
      assert.equal(storage.has('club'), false); assert.equal(storage.has('team'), false)
      return reject ? { error: { code: 'invalid_credentials', message: 'Invalid credentials' } } : { data: { user: { id: 'shared-account' } } }
    } } },
  }
  const signIn = new Function(...Object.keys(dependencies), source.slice(start, end) + ';return signInWithPassword')(...Object.values(dependencies))
  return { signIn, storage, calls }
}

test('actual runtime password sign-in accepts Player intent before authenticating and clears failed intent', async () => {
  const valid = harness()
  const result = await valid.signIn({ email: 'self@example.test', password: 'ExistingPassword1!', preferredAccessMode: 'player' })
  assert.equal(result.user.id, 'shared-account')
  assert.equal(valid.storage.get('mode'), 'player')
  assert.equal(valid.storage.get('explicit'), 'true')
  const invalid = harness({ reject: true })
  await assert.rejects(invalid.signIn({ email: 'self@example.test', password: 'incorrect', preferredAccessMode: 'player' }), /Invalid credentials/)
  for (const key of ['mode', 'explicit', 'intent', 'club', 'team']) assert.equal(invalid.storage.has(key), false)
  const unknown = harness()
  await assert.rejects(unknown.signIn({ email: 'self@example.test', password: 'irrelevant', preferredAccessMode: 'owner' }), /Choose Player/)
  assert.equal(unknown.calls.length, 0)
})

test('actual Player sign-in form passes Player intent to runtime and opens the Player route', async () => {
  const pageSource = readFileSync('src/pages/LoginPage.jsx', 'utf8')
  const submitStart = pageSource.indexOf('  const handleSubmit = async (event) => {')
  const submitEnd = pageSource.indexOf('  const parentAccess =', submitStart)
  assert.ok(submitStart >= 0 && submitEnd > submitStart)
  const runtime = harness()
  const destinations = []
  const deps = { submitLockRef: { current: false }, setIsSubmitting() {}, setLocalError() {}, setLocalMessage() {},
    mode: 'login', formData: { email: ' self@example.test ', password: 'ExistingPassword1!' }, parentInviteToken: '', playerAccess: true,
    isDemoEmail: () => false, signInWithPassword: runtime.signIn,
    window: { location: { assign: path => destinations.push(path) } }, getFriendlyAuthErrorMessage: error => error.message,
  }
  const submit = new Function(...Object.keys(deps), pageSource.slice(submitStart, submitEnd) + ';return handleSubmit')(...Object.values(deps))
  await submit({ preventDefault() {} })
  assert.equal(runtime.calls.length, 1)
  assert.equal(runtime.calls[0].email, 'self@example.test')
  assert.equal(runtime.storage.get('mode'), 'player')
  assert.deepEqual(destinations, ['/player'])
})
