import assert from 'node:assert/strict'
import { test } from 'node:test'
import { handleContactRequest } from '../netlify/functions/send-contact-request.js'

const valid = { enquiryType: 'club_quote', clubName: 'Rovers & Athletic', name: 'Sam Smith', email: 'sam@example.test', teamCount: 25, message: 'U18 & senior teams', sourcePath: '/pricing/' }
const event = body => ({ httpMethod: 'POST', body: JSON.stringify(body) })

test('club quote uses fixed accounts recipient, escaped details and accepted provider ID', async () => {
  let sent
  const response = await handleContactRequest(event({ ...valid, recipient: 'attacker@example.test' }), async payload => { sent = payload; return { data: { id: 'mock-accepted' } } })
  assert.equal(response.statusCode, 200)
  assert.deepEqual(sent.to, ['accounts@jelumalabs.com'])
  assert.equal(sent.reply_to, valid.email)
  assert.match(sent.html, /Rovers &amp; Athletic/)
  assert.match(sent.html, /Teams requested: 25/)
  assert.match(sent.html, /U18 &amp; senior teams/)
  assert.equal(JSON.parse(response.body).id, 'mock-accepted')
})

test('invalid and oversized quote fields fail before sending', async () => {
  let calls = 0
  for (const patch of [{ teamCount: 20 }, { teamCount: 10001 }, { teamCount: 21.5 }, { teamCount: '25' }, { clubName: '' }, { clubName: 'x'.repeat(161) }, { name: '' }, { email: 'bad' }, { message: 'x'.repeat(5001) }, { website: 'spam' }, { enquiryType: 'arbitrary' }]) {
    const response = await handleContactRequest(event({ ...valid, ...patch }), async () => { calls++; return { id: 'never' } })
    assert.equal(response.statusCode, 400, JSON.stringify(patch).slice(0, 100))
  }
  assert.equal(calls, 0)
})

test('missing provider ID never confirms success', async () => {
  const response = await handleContactRequest(event(valid), async () => ({}))
  assert.equal(response.statusCode, 502)
  assert.equal(JSON.parse(response.body).success, false)
})

test('custom quotes may exceed product capacity without promising a subscription', async () => {
  let sent
  const response = await handleContactRequest(event({ ...valid, teamCount: 10000 }), async payload => { sent = payload; return { id: 'custom-quote-accepted' } })
  assert.equal(response.statusCode, 200)
  assert.match(sent.html, /Teams requested: 10000/)
})

test('ordinary contact keeps existing support routing', async () => {
  let sent
  const response = await handleContactRequest(event({ name: 'Sam', email: valid.email, message: 'Help' }), async payload => { sent = payload; return { id: 'contact-accepted' } })
  assert.equal(response.statusCode, 200)
  assert.deepEqual(sent.to, [process.env.CONTACT_REQUEST_RECIPIENT || 'support@jelumalabs.com'])
  assert.equal(sent.subject, 'Website Contact: Sam')
})
