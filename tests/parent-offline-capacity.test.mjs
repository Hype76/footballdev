import test from 'node:test'
import assert from 'node:assert/strict'
import { assertParentOfflineCapacity, PARENT_OFFLINE_MAX_BYTES } from '../apps/mobile-core/src/parentOfflineCapacity.js'

const bytes = value => new TextEncoder().encode(value).length

test('Parent saved scoring capacity is 15 MB and measures UTF-8 bytes', () => {
  assert.equal(PARENT_OFFLINE_MAX_BYTES, 15_000_000)
  assert.ok(assertParentOfflineCapacity({ note: 'é'.repeat(800_000) }, bytes) > 1_500_000)
  assert.doesNotThrow(() => assertParentOfflineCapacity({ note: 'a'.repeat(14_999_989) }, bytes))
  assert.throws(() => assertParentOfflineCapacity({ note: 'é'.repeat(7_500_000) }, bytes), /not enough offline storage/)
})
