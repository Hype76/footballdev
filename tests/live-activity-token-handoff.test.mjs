import test from 'node:test'
import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { createHandoffHandler } from '../netlify/functions/live-activity-token-handoff.js'

test('native token handoff checks input and forwards only a hash to the database', async () => {
  const calls = []
  const handler = createHandoffHandler({ rpc: async (...args) => {
    calls.push(args)
    return { data: true, error: null }
  } })
  const followId = '66666666-6666-4666-8666-666666666666'
  const handoffToken = 'ab'.repeat(32)
  const activityToken = 'cd'.repeat(32)
  const event = { httpMethod: 'POST', body: JSON.stringify({ followId, handoffToken, activityToken }) }
  assert.equal((await handler(event)).statusCode, 200)
  assert.equal(calls[0][0], 'attach_live_match_activity_from_push')
  assert.deepEqual(calls[0][1], { follow_id_value: followId,
    handoff_secret_hash_value: createHash('sha256').update(handoffToken).digest('hex'),
    activity_token_value: activityToken })
  assert.equal((await handler({ ...event, body: '{bad' })).statusCode, 400)
  assert.equal((await handler({ ...event, httpMethod: 'GET' })).statusCode, 405)
  assert.equal(calls.length, 1)
})
