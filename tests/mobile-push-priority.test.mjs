import assert from 'node:assert/strict'
import test from 'node:test'
import { sendExpoPushMessages } from '../netlify/functions/lib/_expo-push.js'

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
