import test from 'node:test'
import assert from 'node:assert/strict'
import { generateKeyPairSync } from 'node:crypto'
import { deliverLiveMatchChange } from '../netlify/functions/lib/_deliver-live-match-changes.js'

const matchId = '22222222-2222-4222-8222-222222222222'
const match = { id: matchId, status: 'live', current_match_phase: 'first_half', home_score: 2, away_score: 1,
  timer_status: 'running', timer_elapsed_seconds: 600, timer_started_at: '2026-11-03T08:30:00Z',
  teams: { name: 'Rovers' }, opponent: 'City' }
const privateKey = generateKeyPairSync('ec', { namedCurve: 'prime256v1' }).privateKey.export({ format: 'pem', type: 'pkcs8' })
const provider = { teamId: 'ABCDEFGHIJ', keyId: '1234567890', privateKey, production: false }

function clientFor(followers, fixture = match) {
  return {
    from() { return { select() { return { eq() { return { async maybeSingle() { return { data: fixture, error: null } } } } } } } },
    async rpc() { return { data: followers, error: null } },
  }
}

test('revoked iPhone access receives only a neutral end state', async () => {
  const requests = []
  const result = await deliverLiveMatchChange(matchId, {
    client: clientFor([{ app_role: 'parent', platform: 'ios', activity_token: 'ab'.repeat(32), access_allowed: false }]),
    provider, now: () => Date.parse('2026-11-03T08:40:00Z'),
    send: async request => { requests.push(request); return { accepted: true } },
  })
  assert.deepEqual(result, { delivered: 1, failed: 0 })
  const payload = JSON.parse(requests[0].body).aps
  assert.equal(payload.event, 'end')
  assert.equal(payload['content-state'].phase, 'Access ended')
  assert.equal(requests[0].body.includes('Rovers'), false)
  assert.equal(requests[0].body.includes('City'), false)
  assert.equal(requests[0].body.includes('"homeScore":2'), false)
})

test('Android refresh sends only a scoped match identifier and stop flag', async () => {
  const sent = []
  const result = await deliverLiveMatchChange(matchId, {
    client: clientFor([{ app_role: 'coach', platform: 'android', activity_token: 'ExpoPushToken[abcdefghijklmnop]', follow_id: 'follow', access_allowed: true }]),
    now: () => Date.parse('2026-11-03T08:40:00Z'),
    sendAndroid: async (...args) => { sent.push(args); return true },
  })
  assert.deepEqual(result, { delivered: 1, failed: 0 })
  assert.equal(sent[0][1], matchId)
  assert.equal(sent[0][2], false)
})
