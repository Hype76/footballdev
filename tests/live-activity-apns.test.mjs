import test from 'node:test'
import assert from 'node:assert/strict'
import { generateKeyPairSync, verify } from 'node:crypto'
import { EventEmitter } from 'node:events'
import { createLiveActivityApnsRequest, createLiveActivityProviderToken, sendLiveActivityApns } from '../netlify/functions/lib/_live-activity-apns.js'
import { createLiveMatchState } from '../apps/mobile-core/src/liveMatchState.js'

test('provider token uses Apple ES256 raw signature and the requested provider identity', () => {
  const keys = generateKeyPairSync('ec', { namedCurve: 'prime256v1' })
  const privateKey = keys.privateKey.export({ format: 'pem', type: 'pkcs8' })
  const token = createLiveActivityProviderToken({ teamId: 'ABCDEFGHIJ', keyId: '1234567890', privateKey, nowSeconds: 1000 })
  const [header, claims, signature] = token.split('.')
  assert.deepEqual(JSON.parse(Buffer.from(header, 'base64url')), { alg: 'ES256', kid: '1234567890' })
  assert.deepEqual(JSON.parse(Buffer.from(claims, 'base64url')), { iss: 'ABCDEFGHIJ', iat: 1000 })
  assert.equal(verify('sha256', Buffer.from(`${header}.${claims}`), { key: keys.publicKey, dsaEncoding: 'ieee-p1363' }, Buffer.from(signature, 'base64url')), true)
  assert.throws(() => createLiveActivityProviderToken({ teamId: 'bad', keyId: '1234567890', privateKey, nowSeconds: 1000 }), /configuration_invalid/)
})

test('APNs delivery distinguishes accepted, rejected and timed-out requests', async () => {
  const calls = []
  const fakeConnect = status => host => {
    const client = new EventEmitter()
    client.close = () => { calls.push('closed') }
    client.destroy = () => { calls.push('destroyed') }
    client.request = () => {
      const stream = new EventEmitter()
      stream.setEncoding = () => {}
      stream.close = () => {}
      stream.end = () => {
        if (!status) return
        queueMicrotask(() => {
          stream.emit('response', { ':status': status })
          if (status !== 200) stream.emit('data', '{"reason":"Unregistered"}')
          stream.emit('end')
        })
      }
      calls.push(host)
      return stream
    }
    return client
  }
  const request = { headers: {}, body: '{}' }
  assert.deepEqual(await sendLiveActivityApns(request, { connect: fakeConnect(200) }), { accepted: true, status: 200, reason: '' })
  assert.deepEqual(await sendLiveActivityApns(request, { connect: fakeConnect(410), production: false }), { accepted: false, status: 410, reason: 'Unregistered' })
  await assert.rejects(sendLiveActivityApns(request, { connect: fakeConnect(0), timeoutMs: 2 }), /apns_timeout/)
  assert.ok(calls.includes('https://api.push.apple.com'))
  assert.ok(calls.includes('https://api.sandbox.push.apple.com'))
  assert.ok(calls.includes('destroyed'))
})

test('request uses the correct activity topic and excludes unrelated private fields', () => {
  const state = createLiveMatchState({ teamName: 'Rovers', opponent: 'City', homeScore: 1, awayScore: 0, status: 'half_time', timerStatus: 'half_time', timerElapsedSeconds: 2700 }, 1000000)
  const args = { bundleId: 'com.footballplayer.parents', activityToken: 'ab'.repeat(32), providerToken: 'provider', contentState: { ...state, secret: 'private' }, timestamp: 1000, staleDate: 1060 }
  const request = createLiveActivityApnsRequest(args)
  assert.equal(request.headers['apns-push-type'], 'liveactivity')
  assert.equal(request.headers['apns-topic'], 'com.footballplayer.parents.push-type.liveactivity')
  assert.equal(JSON.parse(request.body).aps.event, 'update')
  assert.equal(request.body.includes('private'), false)
  assert.equal(JSON.parse(createLiveActivityApnsRequest({ ...args, end: true }).body).aps.event, 'end')
  assert.throws(() => createLiveActivityApnsRequest({ ...args, bundleId: 'unrelated.app' }), /destination_invalid/)
  assert.throws(() => createLiveActivityApnsRequest({ ...args, staleDate: 999 }), /payload_invalid/)
  assert.throws(() => createLiveActivityApnsRequest({ ...args, contentState: { ...state, homeName: { private: 'data' } } }), /payload_invalid/)
})
