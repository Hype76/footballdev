import assert from 'node:assert/strict'
import test from 'node:test'
import { readFile } from 'node:fs/promises'
import { createPasswordRecoveryHandler, resolveRecoveryEmailAppRole } from '../netlify/functions/send-password-reset.js'

test('Recovery footer role uses explicit app context, keeps older Parent/Fan accounts on Parent and leaves unknown accounts a choice', () => {
  for (const accountType of ['parent', 'fan', 'family', 'player']) assert.equal(resolveRecoveryEmailAppRole({ accountType }), 'parent')
  for (const accountType of ['coach', 'staff', 'coach_owner', 'team_admin', 'club_admin', 'workspace_user']) assert.equal(resolveRecoveryEmailAppRole({ accountType }), 'coach')
  for (const accountType of ['', 'unknown', null, {}, ['parent']]) assert.equal(resolveRecoveryEmailAppRole({ accountType }), 'both')
  assert.equal(resolveRecoveryEmailAppRole({ appRole: 'parent', accountType: 'coach' }), 'parent')
  assert.equal(resolveRecoveryEmailAppRole({ appRole: 'coach', accountType: 'parent' }), 'coach')
  assert.equal(resolveRecoveryEmailAppRole({ requestOrigin: 'https://parent.footballplayer.online' }), 'parent')
  assert.equal(resolveRecoveryEmailAppRole({ requestOrigin: 'https://parent.footballplayer.online.attacker.test' }), 'both')
})

test('Explicit recovery app choice changes presentation only, never the recipient, confirmation link, authority or redirect', async context => {
  const previous = { RESEND_API_KEY: process.env.RESEND_API_KEY, RESEND_FROM_EMAIL: process.env.RESEND_FROM_EMAIL, SUPABASE_SERVICE_ROLE_KEY: process.env.SUPABASE_SERVICE_ROLE_KEY }
  Object.assign(process.env, { RESEND_API_KEY: 're_synthetic', RESEND_FROM_EMAIL: 'test@footballplayer.online', SUPABASE_SERVICE_ROLE_KEY: 'synthetic-secret' })
  context.after(() => { for (const [key, value] of Object.entries(previous)) { if (value === undefined) delete process.env[key]; else process.env[key] = value } })
  const links = []; const sent = []
  const actionLink = 'https://auth.example.test/verify?token=synthetic-secret&type=recovery'
  const admin = { rpc: async () => ({ data: { allowed: true } }), auth: { admin: { generateLink: async args => { links.push(args); return { data: { properties: { action_link: actionLink }, user: { user_metadata: { account_type: 'fan' } } } } } } } }
  const handler = createPasswordRecoveryHandler({ createAdminClient: () => admin, sendRecoveryEmail: async payload => sent.push(payload), sleep: async () => {} })
  const invoke = extra => handler({ httpMethod: 'POST', headers: { origin: 'https://footballplayer.online' }, body: JSON.stringify({ email: 'account@example.test', ...extra }) })
  const results = []
  for (const appRole of ['coach', 'parent', undefined]) results.push(await invoke(appRole ? { appRole } : {}))
  assert.deepEqual(results[0], results[1]); assert.deepEqual(results[0], results[2])
  assert.deepEqual(sent.map(payload => payload.emailAppRole), ['coach', 'parent', 'parent'])
  for (const payload of sent) {
    assert.deepEqual(payload.to, ['account@example.test'])
    assert.ok(payload.html.includes('https://auth.example.test/verify?token=synthetic-secret&amp;type=recovery'))
    assert.match(payload.html, /Reset password/)
  }
  assert.deepEqual(links, Array.from({ length: 3 }, () => ({ type: 'recovery', email: 'account@example.test', options: { redirectTo: 'https://footballplayer.online/reset-password' } })))
  for (const appRole of ['admin', 'https://attacker.test', [], null]) assert.equal((await invoke({ appRole })).statusCode, 400)
  assert.equal(sent.length, 3)
})

test('Actual mobile recovery request carries the configured app role without changing the endpoint or exposing more account data', async () => {
  const source = await readFile(new URL('../apps/mobile-core/src/auth.js', import.meta.url), 'utf8')
  const body = source.slice(source.indexOf('const requestPasswordReset = useCallback(async (email) => {') + 'const requestPasswordReset = useCallback(async (email) => {'.length, source.indexOf('\n  }, [appRole])', source.indexOf('const requestPasswordReset = useCallback')))
  assert.ok(body.includes('return payload?.message'))
  for (const appRole of ['parent', 'coach']) {
    const requests = []
    const fn = new Function('setAuthError', 'getMobileRuntimeConfig', 'appRole', 'fetch', `return async function(email) { ${body} }`)(() => {}, () => ({ apiBaseUrl: 'https://footballplayer.online', appRole }), appRole, async (url, options) => { requests.push({ url, options }); return { ok: true, json: async () => ({ message: 'Recovery requested' }) } })
    assert.equal(await fn(' FAMILY@example.test '), 'Recovery requested')
    assert.equal(requests[0].url, 'https://footballplayer.online/.netlify/functions/send-password-reset')
    assert.deepEqual(JSON.parse(requests[0].options.body), { email: 'family@example.test', appRole })
  }
})
