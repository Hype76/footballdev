import assert from 'node:assert/strict'
import test from 'node:test'
import { runMobileStartup } from '../apps/mobile-core/src/startupStateCore.js'
import { editLocalDevelopmentDraft, prepareDevelopmentAttempt, acknowledgeDevelopmentAttempt, sameDevelopmentSave } from '../apps/mobile-core/src/developmentOfflineCore.js'
import { createBoundedMobileFetch } from '../apps/mobile-core/src/mobileFetchCore.js'

test('network timeout aborts the real request and honours caller cancellation', async () => {
  const fetcher = (_url, { signal }) => new Promise((_, reject) => {
    const rejectAbort = () => reject(new Error('aborted'))
    if (signal.aborted) rejectAbort()
    else signal.addEventListener('abort', rejectAbort, { once: true })
  })
  await assert.rejects(createBoundedMobileFetch(fetcher, 10)('synthetic'), /aborted/)
  const controller = new AbortController()
  controller.abort()
  await assert.rejects(createBoundedMobileFetch(fetcher)('synthetic', { signal: controller.signal }), /aborted/)
})

test('cold start uses an expired secure session without waiting for renewal and preserves biometric lock', async () => {
  for (const appRole of ['coach', 'parent']) {
    let requests = 0
    let locked = false
    const result = await runMobileStartup({ appRole, config: { isUsable: true },
      getSavedSession: async () => ({ user: { id: 'saved-account' }, expires_at: 1 }),
      getSession: () => { requests++; return new Promise(() => {}) },
      getBiometricEnabled: async () => true, onLock: value => { locked = value },
      loadProfile: async session => { assert.equal(session.user.id, 'saved-account') }, timeoutMs: 50,
    })
    assert.equal(result.state, 'READY_SIGNED_IN')
    assert.equal(requests, 0)
    assert.equal(locked, true)
  }
})

test('a clean phone does not gain offline account access', async () => {
  const result = await runMobileStartup({ config: { isUsable: true }, getSavedSession: async () => null,
    getSession: async () => ({ data: { session: null } }), getBiometricEnabled: async () => false,
    loadProfile: () => assert.fail('must not open another saved profile') })
  assert.equal(result.state, 'READY_SIGNED_OUT')
})

test('draft retry keeps the original attempt while further editing remains safely pending', () => {
  const first = editLocalDevelopmentDraft(null, { id: 'stable-id', playerId: 'player', formId: 'form', values: { score: '4' }, notes: 'First note' })
  const prepared = prepareDevelopmentAttempt(first)
  const reopened = JSON.parse(JSON.stringify(prepared))
  const edited = editLocalDevelopmentDraft(reopened, { playerId: 'player', formId: 'form', values: { score: '5' }, notes: 'Second note' })
  assert.equal(edited.id, 'stable-id')
  assert.deepEqual(prepareDevelopmentAttempt(edited).attempt, prepared.attempt)
  const acknowledged = acknowledgeDevelopmentAttempt(edited, prepared.attempt, { clientSaveVersion: 1, lastSavedAt: 'now' })
  assert.equal(acknowledged.status, 'pending')
  assert.equal(acknowledged.notes, 'Second note')
  const next = prepareDevelopmentAttempt(acknowledged)
  assert.equal(next.attempt.baseVersion, 1)
  assert.equal(next.attempt.version, 2)
  assert.equal(acknowledgeDevelopmentAttempt(next, next.attempt, { clientSaveVersion: 2 }).status, 'synced')
})

test('an uncertain save is acknowledged only for the same Player, form, version, values and note', () => {
  const attempt = { playerId: 'player', formId: 'form', version: 2, values: { a: 1, b: 2 }, notes: 'Saved note' }
  const row = { player_id: 'player', status: 'draft', client_save_version: 2,
    draft_data: { selectedFeedbackFormId: 'form', responseValues: { b: 2, a: 1 }, notes: 'Saved note' } }
  assert.equal(sameDevelopmentSave(row, attempt), true)
  for (const override of [{ playerId: 'other' }, { formId: 'other' }, { version: 3 }, { notes: '' }, { values: { a: 2, b: 2 } }]) {
    assert.equal(sameDevelopmentSave(row, { ...attempt, ...override }), false)
  }
  assert.equal(sameDevelopmentSave({ ...row, status: 'submitted' }, attempt), false)
})
