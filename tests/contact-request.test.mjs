import assert from 'node:assert/strict'
import test from 'node:test'
import { createContactHandler, createContactRateGuard, config } from '../netlify/functions/send-contact-request.js'
const origin = 'https://football-player-new-website-draft.jasonkeegansl.chatgpt.site'
const valid = { name: 'Club Secretary', email: 'SECRETARY@example.test', message: 'Please contact our club.', sourcePath: '/clubs/#contact', clubTeam: 'Example FC', website: '', submissionId: '12345678-1234-1234-1234-123456789012' }
const env = { RESEND_FROM_EMAIL: 'feedback@footballplayer.online' }
function setup(options = {}) {
  const calls = []
  const handler = createContactHandler({ env, send: async (...args) => { calls.push(args); return { data: { id: 'synthetic-id' } } }, ...options })
  return { handler, calls }
}
function request(body = valid, headers = {}, method = 'POST') {
  return new Request('https://footballplayer.online/.netlify/functions/send-contact-request', { method, headers: { origin, 'Content-Type': 'application/json', ...headers }, ...(method === 'POST' ? { body: typeof body === 'string' ? body : JSON.stringify(body) } : {}) })
}
async function invoke(options = {}, body = valid, headers = {}) {
  const s = setup(options)
  const result = await s.handler(request(body, headers), { ip: '192.0.2.1' })
  return { ...s, result, json: await result.json() }
}

test('draft POST uses server-owned recipient, reply address, audience and optional club/team', async () => {
  const { result, json, calls } = await invoke({}, { ...valid, to: 'attacker@example.test', recipient: 'attacker@example.test' })
  assert.equal(result.status, 200)
  assert.equal(result.headers.get('access-control-allow-origin'), origin)
  assert.equal(result.headers.get('cache-control'), 'no-store')
  assert.equal(result.headers.get('access-control-allow-credentials'), null)
  assert.deepEqual(json, { success: true, id: 'synthetic-id' })
  const [payload, options] = calls[0]
  assert.deepEqual(payload.to, ['support@jelumalabs.com'])
  assert.equal(payload.reply_to, 'secretary@example.test')
  assert.equal(payload.emailAppRole, 'both')
  assert.equal(options.context.emailType, 'system_support_email')
  assert.match(payload.html, /Example FC/)
  assert.match(options.idempotencyKey, /^contact-[a-f0-9]{64}$/)
})
test('first party and originless existing callers retain optional message and no submission ID', async () => {
  for (const firstParty of ['https://footballplayer.online', 'https://www.footballplayer.online', '']) {
    const { handler, calls } = setup()
    const req = request({ name: 'Visitor', email: 'visitor@example.test' }, { origin: firstParty })
    const result = await handler(req, { ip: '192.0.2.2' })
    assert.equal(result.status, 200)
    assert.equal(calls.length, 1)
  }
})
test('exact origin allowlist rejects lookalikes, null, subdomains and arbitrary caller origins', async () => {
  for (const bad of ['null', 'https://evil.example', origin + '.evil.example', origin + '/', 'http://footballplayer.online', 'https://sub.footballplayer.online']) {
    const { result, calls } = await invoke({}, valid, { origin: bad })
    assert.equal(result.status, 403)
    assert.equal(result.headers.get('access-control-allow-origin'), null)
    assert.equal(calls.length, 0)
  }
})
test('preflight supports only POST and content-type without consuming local send limit', async () => {
  const { handler, calls } = setup({ rateGuard: () => { throw new Error('must not consume') } })
  for (let i = 0; i < 4; i++) {
    const response = await handler(request(undefined, { 'access-control-request-method': 'POST', 'access-control-request-headers': 'Content-Type' }, 'OPTIONS'))
    assert.equal(response.status, 204)
    assert.equal(await response.text(), '')
    assert.equal(response.headers.get('access-control-allow-methods'), 'POST')
    assert.match(response.headers.get('vary'), /Origin/)
  }
  for (const headers of [{ 'access-control-request-method': 'DELETE' }, { 'access-control-request-method': 'POST', 'access-control-request-headers': 'authorization' }]) {
    assert.equal((await handler(request(undefined, headers, 'OPTIONS'))).status, 403)
  }
  assert.equal((await handler(request(undefined, {}, 'GET'))).status, 405)
  assert.equal(calls.length, 0)
})
test('rejects malformed JSON, non-object values, wrong media type and oversize bytes', async () => {
  for (const [body, headers, status] of [
    ['{', {}, 400], ['null', {}, 400], ['[]', {}, 400], ['42', {}, 400],
    [valid, { 'content-type': 'text/plain' }, 415],
    [' '.repeat(16385), {}, 413], [valid, { 'content-length': '16385' }, 413],
    [{ ...valid, message: '\u20ac'.repeat(5500) }, {}, 413],
  ]) {
    const { result, calls } = await invoke({}, body, headers)
    assert.equal(result.status, status)
    assert.equal(calls.length, 0)
  }
})
test('field validation rejects types, lengths, missing draft requirements and header injection', async () => {
  for (const change of [
    { name: '' }, { name: {} }, { email: [] }, { message: '' }, { submissionId: '' },
    { name: 'a'.repeat(121) }, { email: 'a'.repeat(255) }, { message: 'a'.repeat(5001) },
    { phone: 'a'.repeat(51) }, { clubTeam: 'a'.repeat(161) }, { sourcePath: 'a'.repeat(1025) },
    { name: 'Name\r\nBcc: attacker@example.test' }, { email: 'valid@example.test\r\nBcc: evil@example.test' },
    { email: 'two@example.test,evil@example.test' }, { email: 'bad' }, { phone: '123\u0000' },
    { message: 'Bad\u0000message' }, { submissionId: '../invalid' }, { website: 'spam.example' },
  ]) {
    const { result, calls } = await invoke({}, { ...valid, ...change })
    assert.equal(result.status, 400, JSON.stringify(change))
    assert.equal(calls.length, 0)
  }
})
test('HTML content is escaped while message line breaks survive', async () => {
  const { calls, result } = await invoke({}, { ...valid, name: '<img src=x>', message: '<script>alert("x")</script>\nSecond & line', clubTeam: '<b>FC</b>' })
  assert.equal(result.status, 200)
  const html = calls[0][0].html
  assert.doesNotMatch(html, /<script>|<img src=x>|<b>FC/)
  assert.match(html, /&lt;script&gt;alert\(&quot;x&quot;\)&lt;\/script&gt;\nSecond &amp; line/)
})
test('recipient override stays server-owned and invalid config fails closed', async () => {
  const good = await invoke({ env: { ...env, CONTACT_REQUEST_RECIPIENT: 'support@jelumalabs.com' } })
  assert.deepEqual(good.calls[0][0].to, ['support@jelumalabs.com'])
  const bad = await invoke({ env: { ...env, CONTACT_REQUEST_RECIPIENT: 'support@example.test\r\nBcc:evil@example.test' } })
  assert.equal(bad.result.status, 503)
  assert.equal(bad.calls.length, 0)
})
test('same ID and normalized payload retain retry key; different submission IDs get distinct keys', async () => {
  const { handler, calls } = setup({ rateGuard: () => 0 })
  for (const body of [valid, { ...valid, email: valid.email.toLowerCase() }, { ...valid, submissionId: 'different-id-1234567890' }]) await handler(request(body))
  assert.equal(calls[0][1].idempotencyKey, calls[1][1].idempotencyKey)
  assert.notEqual(calls[1][1].idempotencyKey, calls[2][1].idempotencyKey)
})
test('provider failures and missing acceptance IDs never claim success or expose internals', async () => {
  for (const send of [async () => { throw Object.assign(new Error('secret provider detail'), { publicMessage: 'secret detail', statusCode: 502 }) }, async () => ({}), async () => ({ error: { message: 'secret' }, data: { id: 'fake' } })]) {
    const { result, json } = await invoke({ send })
    assert.equal(result.status, 502)
    assert.equal(json.success, false)
    assert.doesNotMatch(JSON.stringify(json), /secret/)
  }
})
test('failed provider attempt retries with unchanged key and can then succeed', async () => {
  const keys = []
  const { handler } = setup({ send: async (_, options) => { keys.push(options.idempotencyKey); if (keys.length === 1) throw new Error('timeout'); return { id: 'retry-id' } } })
  assert.equal((await handler(request())).status, 502)
  assert.equal((await handler(request())).status, 200)
  assert.equal(keys[0], keys[1])
})
test('immediate guard enforces per trusted IP limit, expiry and bounded capacity', () => {
  let time = 0
  const guard = createContactRateGuard({ now: () => time, maxEntries: 2 })
  assert.equal(guard('one'), 0)
  assert.equal(guard('one'), 0)
  assert.equal(guard('one'), 0)
  assert.equal(guard('one'), 180)
  assert.equal(guard('two'), 0)
  assert.equal(guard('three'), 180)
  time = 180000
  assert.equal(guard('three'), 0)
})
test('endpoint returns CORS-visible 429 with Retry-After, ignoring spoofed forwarding header', async () => {
  const { handler, calls } = setup()
  for (let i = 0; i < 3; i++) assert.equal((await handler(request(), { ip: 'trusted' })).status, 200)
  const result = await handler(request(valid, { 'x-forwarded-for': 'other', 'x-nf-client-connection-ip': 'other' }), { ip: 'trusted' })
  assert.equal(result.status, 429)
  assert.equal(result.headers.get('retry-after'), '180')
  assert.equal(result.headers.get('access-control-allow-origin'), origin)
  assert.equal(calls.length, 3)
})
test('distributed Netlify guard is scoped to unchanged contact path and supported all-plan aggregation', () => {
  assert.equal(config.path, '/.netlify/functions/send-contact-request')
  assert.deepEqual(config.rateLimit, { windowLimit: 12, windowSize: 180, aggregateBy: ['ip', 'domain'] })
})
