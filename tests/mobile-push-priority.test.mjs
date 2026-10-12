import assert from 'node:assert/strict'
import test from 'node:test'
import { sendExpoPushMessages } from '../netlify/functions/lib/_expo-push.js'
import { pollResultPushDelivery } from '../netlify/functions/lib/_poll-result-push.js'

test('visible alerts request prompt delivery on sleeping phones while explicit priorities are preserved', async () => {
  const originalFetch = globalThis.fetch
  const calls = []
  globalThis.fetch = async (url, options) => {
    const messages = JSON.parse(options.body)
    calls.push(...messages)
    return { ok: true, json: async () => ({ data: messages.map(() => ({ status: 'ok' })) }) }
  }
  try {
    const result = await sendExpoPushMessages([
      { to: 'ExpoPushToken[first]', title: 'Match invitation', body: 'Please respond' },
      { to: 'ExpoPushToken[second]', title: 'Training reminder' },
      { to: 'ExpoPushToken[third]', body: 'Low priority notice', priority: 'normal' },
      { to: 'ExpoPushToken[fourth]', data: { refresh: true } },
    ])
    assert.equal(result.sent, 4)
    assert.deepEqual(calls.map(item => item.priority), ['high', 'high', 'normal', 'normal'])
    assert.deepEqual(calls.map(item => item.to), ['ExpoPushToken[first]', 'ExpoPushToken[second]', 'ExpoPushToken[third]', 'ExpoPushToken[fourth]'])
  } finally { globalThis.fetch = originalFetch }
})

test('result pushes retain a one-hour expiry and poll-specific collapse identity through the transport', async () => {
  const originalFetch = globalThis.fetch
  const calls = []
  globalThis.fetch = async (_url, options) => {
    calls.push(...JSON.parse(options.body))
    return { ok: true, json: async () => ({ data: [{ status: 'ok' }] }) }
  }
  try {
    await sendExpoPushMessages([{ ...pollResultPushDelivery('first-poll'), to: 'ExpoPushToken[result]', title: 'Result', body: 'Voting has closed' }])
    assert.equal(calls[0].ttl, 3600)
    assert.equal(calls[0].priority, 'high')
    assert.equal(calls[0].collapseId, 'poll-result:first-poll')
    assert.notEqual(pollResultPushDelivery('second-poll').collapseId, calls[0].collapseId)
  } finally { globalThis.fetch = originalFetch }
})
