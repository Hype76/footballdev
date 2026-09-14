import assert from 'node:assert/strict'
import test from 'node:test'
import { getMobileRequestTimeout } from '../apps/mobile-core/src/mobileFetchCore.js'

test('only match writes get a longer request window; auth and reads remain bounded', () => {
  for (const rpc of ['apply_coach_match_day_command', 'start_match_day', 'set_match_day_timer_state', 'set_match_day_extended_state']) {
    assert.equal(getMobileRequestTimeout(`https://example.test/rest/v1/rpc/${rpc}`, { method: 'POST' }), 30000)
    assert.equal(getMobileRequestTimeout(`https://example.test/rest/v1/rpc/${rpc}`, { method: 'GET' }), 8000)
  }
  assert.equal(getMobileRequestTimeout('https://example.test/auth/v1/token', { method: 'POST' }), 8000)
  assert.equal(getMobileRequestTimeout('https://example.test/rest/v1/rpc/get_match_day', { method: 'POST' }), 8000)
})
