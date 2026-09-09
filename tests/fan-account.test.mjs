import assert from 'node:assert/strict'
import { test } from 'node:test'
import { createFanAccountHandler } from '../netlify/functions/lib/_fan-account.js'
import { fetchFansJson } from '../src/lib/fans-fetch.js'

const token = '20000000-0000-4000-8000-000000000099'
const invite = { id: 'fan-invite', name: 'Test Fan', email: 'fan@example.test', expires_at: new Date(Date.now() + 86400000).toISOString() }
const body = { token, email: 'FAN@example.test ', password: 'Test-River-729!' }
function setup({ signupError, missingLink = false, missingUser = false, inviteRow = invite, emailError = false, suspended = false } = {}) {
  const calls = { queries: [], signup: [], emails: [] }
  const client = {
    from(table) {
      const query = { table, filters: [] }
      calls.queries.push(query)
      return {
        select() { return this },
        eq(...args) { query.filters.push(args); return this },
        maybeSingle: async () => ({ data: table === 'fan_connections' ? inviteRow : table === 'clubs' ? { name: 'Test Club' } : { id: 'parent', status: 'active' } }),
        then(resolve) { resolve({ data: suspended ? [{ role: 'parent_portal' }] : [] }) },
      }
    },
    auth: { admin: { generateLink: async (args) => {
      calls.signup.push(args)
      return { error: signupError, data: { user: missingUser ? null : { id: 'fan-user' }, properties: { hashed_token: missingLink ? null : 'synthetic-confirmation-hash', action_link: 'https://auth.example.test/verify?redirect_to=https://footballplayer.online' } } }
    } } },
  }
  const handler = createFanAccountHandler({
    createClient: () => client,
    createFromAddress: () => 'Football Player <test@example.test>',
    sendEmail: async (...args) => { calls.emails.push(args); if (emailError) throw new Error('private provider failure') },
  })
  return { calls, run: async (payload = body) => {
    const result = await handler({ httpMethod: 'POST', body: JSON.stringify(payload) })
    return { status: result.statusCode, ...JSON.parse(result.body) }
  } }
}

test('signup binds the invited identity, sends confirmation and does not activate Fan access', async () => {
  const { run, calls } = setup()
  assert.equal((await run()).needsEmailVerification, true)
  assert.equal(calls.signup.length, 1)
  assert.equal(calls.signup[0].email, invite.email)
  assert.equal(calls.signup[0].options.data.account_type, 'fan')
  assert.equal(calls.signup[0].options.redirectTo, `https://parent.footballplayer.online/fan-invite/${token}`)
  assert.deepEqual(calls.queries[0].filters, [['invite_token', token], ['email', invite.email], ['status', 'pending'], ['relationship_type', 'fan']])
  assert.equal(calls.emails.length, 1)
  assert.match(calls.emails[0][0].html, /Confirm email/)
  assert.ok(calls.emails[0][0].html.includes(`https://parent.footballplayer.online/fan-invite/${token}#fan_confirmation=synthetic-confirmation-hash`))
  assert.ok(!calls.emails[0][0].html.includes('https://auth.example.test'))
  assert.deepEqual(calls.emails[0][0].to, [invite.email])
})

for (const signupError of [{ code: 'unexpected_failure', message: 'private auth error' }, { status: 503 }]) {
  test(`unknown signup failure ${signupError.code || signupError.status} never claims an existing account`, async () => {
    const { run, calls } = setup({ signupError })
    const result = await run()
    assert.equal(result.status, 502)
    assert.equal(result.code, 'signup_failed')
    assert.doesNotMatch(result.message, /already|recovery|private/)
    assert.equal(calls.emails.length, 0)
  })
}
for (const code of ['email_exists', 'user_already_exists']) {
  test(`${code} directs an existing user to confirmation or sign in`, async () => {
    const { run, calls } = setup({ signupError: { code } })
    assert.equal((await run()).code, 'account_exists')
    assert.equal(calls.emails.length, 0)
  })
}
test('weak passwords are rejected before any auth or email call', async () => {
  const { run, calls } = setup()
  assert.equal((await run({ ...body, password: 'short' })).code, 'weak_password')
  assert.equal(calls.queries.length, 0)
  assert.equal(calls.signup.length, 0)
})
test('provider password rejection and throttling give an appropriate next step', async () => {
  assert.equal((await setup({ signupError: { code: 'weak_password' } }).run()).status, 400)
  assert.equal((await setup({ signupError: { status: 429 } }).run()).code, 'signup_rate_limited')
})

test('a valid eight-character password reaches signup without a twelve-character requirement', async () => {
  const { run, calls } = setup()
  const result = await run({ ...body, password: 'N7!vQ2az' })
  assert.equal(result.status, 200)
  assert.equal(calls.signup.length, 1)
  assert.equal(calls.signup[0].password.length, 8)
})

for (const [reasons, message, expected] of [
  [['pwned'], 'private provider details', /known data breach/],
  [['length'], 'Password should be at least 8 characters.', /at least 8 characters/],
  [['length'], 'private provider details', /too short/],
  [['characters'], 'private provider details', /uppercase letter, a lowercase letter, a number, and a symbol/],
  [['pwned', 'length', 'characters'], 'Password should be at least 8 characters.', /known data breach.*at least 8 characters.*uppercase letter/],
  [[], 'private provider details', /without giving a specific reason/],
  [['future_reason'], 'private provider details', /without giving a specific reason/],
  ['pwned', 'private provider details', /without giving a specific reason/],
]) {
  test(`password rejection explains ${JSON.stringify(reasons)} and reaches the Fan client`, async () => {
    const { run, calls } = setup({ signupError: { code: 'weak_password', reasons, message } })
    const result = await run()
    assert.equal(result.status, 400)
    assert.equal(result.code, 'weak_password')
    assert.match(result.message, expected)
    assert.doesNotMatch(result.message, /private provider details/)
    assert.equal(result.needsEmailVerification, undefined)
    assert.equal(calls.emails.length, 0)
    await assert.rejects(fetchFansJson('/signup', {}, async () => ({ ok: false, status: 400, json: async () => result })), expected)
  })
}

test('password rejection never returns or logs provider messages, passwords or tokens', async (t) => {
  const logged = []
  t.mock.method(console, 'error', (...args) => logged.push(args))
  const secret = 'synthetic-private-token'
  const result = await setup({ signupError: { code: 'weak_password', reasons: ['pwned', secret], message: `${body.password} ${secret}`, status: 422 } }).run()
  const output = JSON.stringify({ result, logged })
  assert.equal(output.includes(body.password), false)
  assert.equal(output.includes(secret), false)
  assert.equal(logged.length, 1)
})
test('expired, missing and malformed invitations never create accounts', async () => {
  for (const inviteRow of [null, { ...invite, expires_at: 'invalid' }, { ...invite, expires_at: '2020-01-01' }]) {
    const { run, calls } = setup({ inviteRow })
    assert.equal((await run()).status, 403)
    assert.equal(calls.signup.length, 0)
  }
  assert.equal((await setup().run(null)).status, 400)
})
test('suspended inviting parent cannot create a Fan account', async () => {
  const { run, calls } = setup({ suspended: true })
  assert.equal((await run()).status, 403)
  assert.equal(calls.signup.length, 0)
})
test('partial signup results and email delivery failures never show confirmation success', async () => {
  for (const options of [{ missingUser: true }, { missingLink: true }, { emailError: true }]) {
    const result = await setup(options).run()
    assert.equal(result.status, 502)
    assert.equal(result.needsEmailVerification, undefined)
    if (options.emailError) assert.equal(result.code, 'confirmation_email_failed')
  }
})
