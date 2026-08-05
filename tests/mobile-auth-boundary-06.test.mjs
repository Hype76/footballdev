import assert from 'node:assert/strict'
import path from 'node:path'
import test from 'node:test'
import { fileURLToPath } from 'node:url'

import {
  SECURITY_PHASE_REQUIREMENT,
  formatMobileAuthFailures,
  scanMobileAuthBoundary,
  scanMobileAuthSource,
} from '../apps/scripts/mobile-auth-boundary-check.mjs'

const repositoryRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')

test('current Coach, Parent and mobile-core source preserves password-only Auth', async () => {
  const result = await scanMobileAuthBoundary({ repositoryRoot })
  assert.deepEqual(result.failures, [])
  assert.ok(result.filesScanned > 0)
  assert.equal(result.passwordSignInCalls, 1)
  assert.equal(result.detectSessionInUrlFalse, 1)
})

const hostileCases = [
  ['redirectTo', `const options = { redirectTo: 'footballplayercoach://auth/callback' }`, 'redirect-based Auth options'],
  ['emailRedirectTo', `const options = { emailRedirectTo: 'footballplayerparents://auth/callback' }`, 'redirect-based Auth options'],
  ['password recovery', 'supabase.auth.resetPasswordForEmail(email)', 'password recovery Auth API'],
  ['OTP sign-in', 'supabase.auth.signInWithOtp({ email })', 'OTP or magic-link Auth API'],
  ['OTP verification', `supabase.auth.verifyOtp({ token_hash, type: 'recovery' })`, 'OTP or magic-link Auth API'],
  ['mobile signup', 'supabase.auth.signUp({ email, password })', 'mobile Auth signup API'],
  ['code exchange', 'supabase.auth.exchangeCodeForSession(code)', 'Auth code exchange'],
  ['URL session authority', 'supabase.auth.setSession(sessionFromLink)', 'URL-provided session authority'],
  ['URL-session detection', 'const auth = { detectSessionInUrl: true }', 'URL-session detection enabled'],
  ['URL token parsing', `const query = new URLSearchParams(url.split('#')[1]); query.get('access_token')`, 'Auth token parsing from URL'],
  ['recovery deep link', `Linking.addEventListener('url', handleRecoveryLink)`, 'Auth callback deep-link handling'],
  ['Auth callback route', `<Stack.Screen name="AuthCallback" component={AuthCallback} />`, 'Auth callback navigation'],
  ['raw recovery endpoint', `fetch('/auth/v1/recover')`, 'raw redirect-based Auth endpoint'],
  ['Expo Auth session', `import { makeRedirectUri } from 'expo-auth-session'`, 'Expo Auth callback requirement'],
  ['Expo loopback callback', `const callback = 'exp://127.0.0.1:8081'`, 'Expo Go loopback Auth callback'],
  ['secure Expo loopback callback', `const callback = 'exps://127.0.0.1:8081'`, 'Expo Go loopback Auth callback'],
]

for (const [name, content, category] of hostileCases) {
  test(`guard rejects ${name}`, () => {
    const failures = scanMobileAuthSource({
      content,
      file: `apps/coach-mobile/hostile-${name.replaceAll(' ', '-')}.js`,
      module: 'Coach app',
    })

    assert.ok(failures.some((failure) => failure.category === category))
    const output = formatMobileAuthFailures(failures).join('\n')
    assert.match(output, /Coach app/)
    assert.match(output, /apps\/coach-mobile/)
    assert.ok(output.includes(SECURITY_PHASE_REQUIREMENT))
  })
}

test('ordinary application deep links and password session restoration remain allowed', () => {
  const safeSource = `
    const scheme = 'footballplayercoach'
    const notificationRoute = Linking.createURL('/match-day/fixture-123')
    const { data } = await supabase.auth.getSession()
    await supabase.auth.signInWithPassword({ email, password })
    const auth = { detectSessionInUrl: false, persistSession: true }
  `

  assert.deepEqual(scanMobileAuthSource({ content: safeSource }), [])
})
