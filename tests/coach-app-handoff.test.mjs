import assert from 'node:assert/strict'
import test from 'node:test'
import { createCoachWebHandoffHandler } from '../netlify/functions/lib/_coach-web-handoff.js'
import { buildCoachWebHandoffUrl, exchangeCoachWebHandoff } from '../src/lib/coach-web-handoff.js'
import { buildMobileConfirmationEmail } from '../scripts/mobile-confirmation-email-template.mjs'
import { createPasswordRecoveryHandler } from '../netlify/functions/send-password-reset.js'

const actorId = '20000000-0000-4000-8000-000000000001'
const teamId = '30000000-0000-4000-8000-000000000001'
const clubId = '10000000-0000-4000-8000-000000000001'
const tokenHash = 'a'.repeat(56)
function service({ management = { enabled: true, logoAllowed: true }, teamClub = clubId, confirmed = true, limited = false, active = true, billing = true } = {}) {
  const minted = [], authorisations = []
  const client = {
    auth: { getUser: async token => { assert.equal(token, 'native-session'); return { data: { user: { id: actorId, email: 'coach@example.test', email_confirmed_at: confirmed ? '2026-10-07' : '' } } } },
      admin: { generateLink: async value => { minted.push(value); return { data: { user: { id: actorId }, properties: { hashed_token: tokenHash, action_link: 'private-action-link' } } } } } },
    from: () => ({ select() { return this }, eq() { return this }, maybeSingle: async () => ({ data: { id: teamId, club_id: teamClub } }) }),
    rpc: async (name, params) => { authorisations.push({ name, params }); return { data: name === 'read_first_250_team_branding_management' ? management : { allowed: !limited } } },
  }
  return { minted, authorisations, run: createCoachWebHandoffHandler({ client, secret: 'synthetic-only',
    loadProfile: async () => { if (!active) throw Error('Inactive'); return { club_id: clubId } },
    assertUpgrade: async () => { if (!billing) throw Error('Denied') }, clientIp: () => 'synthetic-client' }) }
}
const event = body => ({ httpMethod: 'POST', headers: { authorization: 'Bearer native-session' }, body: JSON.stringify(body) })
test('badge handoff rechecks trusted team authority and mints only a single-use credential', async () => {
  const api = service(), result = await api.run(event({ purpose: 'badge', teamId }))
  assert.equal(result.statusCode, 200)
  assert.deepEqual(JSON.parse(result.body), { actorId, teamId, purpose: 'badge', tokenHash })
  assert.deepEqual(api.minted, [{ type: 'magiclink', email: 'coach@example.test' }])
  assert.equal(result.headers['Cache-Control'], 'no-store')
  assert.doesNotMatch(result.body, /native-session|private-action-link|refresh_token/)
  const limiter = api.authorisations.find(value => value.name === 'consume_password_recovery_rate_limit')
  assert.equal(limiter.params.p_email_digest.length, 64)
})
test('unconfirmed, inactive, wrong club, revoked badge, denied payer and rate limits fail before minting', async () => {
  for (const settings of [{ confirmed: false }, { active: false }, { teamClub: teamId }, { management: { enabled: true, logoAllowed: false } }, { limited: true }]) {
    const api = service(settings), result = await api.run(event({ purpose: 'badge', teamId }))
    assert.ok(result.statusCode >= 400); assert.equal(api.minted.length, 0)
  }
  const denied = service({ billing: false })
  assert.equal((await denied.run(event({ purpose: 'upgrade' }))).statusCode, 403)
  assert.equal(denied.minted.length, 0)
  for (const body of [{ purpose: 'badge', teamId, redirect: 'https://evil.test' }, { purpose: 'badge', teamId: 'invalid' }, { purpose: 'other' }]) {
    const api = service(); assert.equal((await api.run(event(body))).statusCode, 400); assert.equal(api.minted.length, 0)
  }
})
test('browser exchange clears fragment before verification and keeps destinations fixed', async () => {
  const url = new URL(buildCoachWebHandoffUrl('https://footballplayer.online', { actorId, teamId, purpose: 'badge', tokenHash }))
  assert.equal(url.search, ''); let cleared = false
  const client = { auth: { verifyOtp: async args => { assert.ok(cleared); assert.deepEqual(args, { token_hash: tokenHash, type: 'magiclink' }); return { data: { session: { user: { id: actorId } } } } } } }
  const result = await exchangeCoachWebHandoff({ client, fragment: url.hash, clearFragment: () => { cleared = true } })
  assert.equal(result.destination, `/team-branding?teamId=${teamId}&from=coach&uploadOnly=1`)
  for (const origin of ['https://evil.test', 'https://footballplayer.online/other', 'https://user@footballplayer.online']) {
    assert.throws(() => buildCoachWebHandoffUrl(origin, { actorId, teamId, purpose: 'badge', tokenHash }))
  }
})
test('expired and wrong-actor handoffs cannot proceed or retain a newly minted wrong session', async () => {
  let signedOut = false
  const client = { auth: { verifyOtp: async () => ({ data: { session: { user: { id: teamId } } } }), signOut: async () => { signedOut = true } } }
  const fragment = new URL(buildCoachWebHandoffUrl('https://footballplayer.online', { actorId, purpose: 'upgrade', tokenHash })).hash
  await assert.rejects(exchangeCoachWebHandoff({ client, fragment, clearFragment() {} }), /expired/)
  assert.ok(signedOut)
})
test('mobile confirmation selects an app code while preserving the complete web template', () => {
  const existing = '<html><body><a href="{{ .ConfirmationURL }}">Verify email</a></body></html>'
  const next = buildMobileConfirmationEmail(existing)
  assert.ok(next.includes(existing)); assert.match(next, /verification_mode/); assert.match(next, /{{ \.Token }}/)
  assert.equal(buildMobileConfirmationEmail(next), next)
})
test('mobile recovery sends a code without the web reset link or revealing account existence', async () => {
  process.env.SUPABASE_SERVICE_ROLE_KEY ||= 'synthetic-only'
  const sent = []
  const client = { rpc: async () => ({ data: { allowed: true } }), auth: { admin: { generateLink: async () => ({ data: { properties: { action_link: 'https://private.example.test', email_otp: '123456' } } }) } } }
  const handler = createPasswordRecoveryHandler({ createAdminClient: () => client, sendRecoveryEmail: async payload => sent.push(payload), sleep: async () => {} })
  const result = await handler({ httpMethod: 'POST', headers: { origin: 'https://footballplayer.online' }, body: JSON.stringify({ email: 'coach@example.test', appRole: 'coach', appOnly: true }) })
  assert.equal(result.statusCode, 200); assert.equal(sent.length, 1)
  assert.match(sent[0].html, /123456/); assert.doesNotMatch(sent[0].html, /private\.example|>Reset password<|href=/)
  assert.doesNotMatch(result.body, /123456|coach@example/)
})
