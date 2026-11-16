import test from 'node:test'
import assert from 'node:assert/strict'
import { createMatchDayOutbox } from '../apps/mobile-core/src/matchDayOutboxCore.js'

test('a confirmed conflict remains saved and automatic retries pause until review', async () => {
  const at = '2026-11-16T09:00:00Z'
  let journal = { baseMatch: { id: 'match', updatedAt: at }, verifiedAt: at, pending: [] }
  let sends = 0
  const box = createMatchDayOutbox({ read: async () => journal, update: async change => (journal = change(journal)),
    send: async () => { sends += 1; throw Object.assign(new Error('Changed on another device'), { code: '40001' }) } })
  await box.enqueue({ id: 'start', kind: 'timer', payload: { action: 'start' }, capturedAt: at })
  await box.sync()
  await box.sync()
  assert.equal(sends, 1)
  assert.equal(journal.pending[0].id, 'start')
  assert.equal(journal.errorCode, '40001')
})

test('a redundant rejected start can be removed without losing later saved actions', async () => {
  const at = '2026-11-16T09:00:00Z'
  let journal = { baseMatch: { id: 'match', updatedAt: at }, verifiedAt: at, pending: [] }
  const box = createMatchDayOutbox({ read: async () => journal, update: async change => (journal = change(journal)),
    send: async () => { throw Object.assign(new Error('Changed on another device'), { code: '40001' }) } })
  await box.enqueue({ id: 'start', kind: 'timer', payload: { action: 'start' }, capturedAt: at })
  await box.enqueue({ id: 'goal', kind: 'event', payload: { eventType: 'goal', minute: 4 }, capturedAt: '2026-11-16T09:04:00Z' })
  await box.sync()
  const original = structuredClone(journal.pending[1])
  const latest = { id: 'match', status: 'live', currentMatchPhase: 'first_half', timerStatus: 'running', updatedAt: '2026-11-16T09:01:00Z' }
  await assert.rejects(box.reviewAgainstLatest(latest), /already running/)
  await box.reviewAgainstLatest(latest, { removeRedundantStart: true, expectedIds: ['start', 'goal'] })
  assert.equal(journal.pending[0].id, original.id)
  assert.deepEqual(journal.pending[0].payload, original.payload)
  assert.equal(journal.pending[0].capturedAt, original.capturedAt)
  assert.equal(journal.pending[0].expectedUpdatedAt, latest.updatedAt)
  assert.equal(journal.pending[0].previousCommandId, null)
})
