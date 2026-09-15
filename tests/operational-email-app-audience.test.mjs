import assert from 'node:assert/strict'
import test from 'node:test'
import { buildPreparedScheduledEmail } from '../netlify/functions/lib/_scheduled-email-payload.js'
process.env.VITE_SUPABASE_URL = 'https://example.supabase.co'
process.env.SUPABASE_SERVICE_ROLE_KEY = 'test-only-not-a-real-key'
const { getStoredResendPayload } = await import('../netlify/functions/lib/_email-log-store.js')

test('historical Parent queue rows receive Parent app links while preserving action tokens and attachments', () => {
  const html = '<a href="https://footballplayer.online/respond/token-original">Reply</a>'
  const attachment = { filename: 'report.pdf', content: 'synthetic-pdf' }
  const prepared = buildPreparedScheduledEmail({to_email:'parent@example.test',payload:{resendPayload:{html,text:'Original reply link',attachments:[attachment]}}},{})
  assert.equal(prepared.emailPayload.emailAppRole,'parent')
  assert.equal(prepared.emailPayload.html,html)
  assert.equal(prepared.emailPayload.text,'Original reply link')
  assert.deepEqual(prepared.emailPayload.attachments,[attachment])
  assert.deepEqual(prepared.emailPayload.to,['parent@example.test'])
})

test('Parent-purpose queue cannot be relabelled Coach by stale payload metadata, and Coach copies are explicit', () => {
  const prepared = buildPreparedScheduledEmail({payload:{resendPayload:{emailAppRole:'coach',to:['parent@example.test'],cc:['coach@example.test']}}},{})
  assert.equal(prepared.emailPayload.emailAppRole,'parent')
  assert.equal(prepared.emailPayload.emailCcAppRole,'coach')
  assert.deepEqual(prepared.emailPayload.cc,['coach@example.test'])
  assert.deepEqual(prepared.recipients,['parent@example.test'])
  const noCopy = buildPreparedScheduledEmail({payload:{resendPayload:{emailCcAppRole:'coach',to:['parent@example.test'],cc:[]}}},{})
  assert.equal(noCopy.emailPayload.emailCcAppRole,undefined,'Removing a sender copy removes its app block')
})

test('failed email replay retains audience metadata without inferring a role from the recipient address', () => {
  for (const role of ['parent','coach']) {
    const payload={emailAppRole:role,emailCcAppRole:'coach',to:['same-account@example.test'],cc:['copy@example.test'],reply_to:'reply@example.test',html:'unchanged'}
    const replay=getStoredResendPayload({payload:{resendPayload:payload}})
    assert.equal(replay.emailAppRole,role)
    assert.equal(replay.emailCcAppRole,'coach')
    assert.equal(replay.html,'unchanged')
    assert.equal(replay.replyTo,'reply@example.test')
  }
})
