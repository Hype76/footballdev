import assert from 'node:assert/strict'
import test from 'node:test'
import { runMobileStartup } from '../apps/mobile-core/src/startupStateCore.js'
import { editLocalDevelopmentDraft, prepareDevelopmentAttempt, acknowledgeDevelopmentAttempt, sameDevelopmentSave } from '../apps/mobile-core/src/developmentOfflineCore.js'
import { createBoundedMobileFetch, getMobileRequestTimeout, getMobileConnectionErrorMessage } from '../apps/mobile-core/src/mobileFetchCore.js'
import { readFile } from 'node:fs/promises'

test('a slow password response can complete after the normal read deadline', async (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] })
  let aborted = false
  let complete
  const response = { status: 200 }
  const pending = createBoundedMobileFetch((_url, { signal }) => new Promise((resolve, reject) => {
    complete = () => resolve(response)
    signal.addEventListener('abort', () => { aborted = true; reject(new Error('aborted')) })
  }))('https://example.test/auth/v1/token?grant_type=password', { method: 'POST' })
  t.mock.timers.tick(10000)
  assert.equal(aborted, false)
  complete()
  assert.equal(await pending, response)
  assert.equal(getMobileRequestTimeout('https://example.test/auth/v1/token?grant_type=refresh_token', { method: 'POST' }), 8000)
  assert.equal(getMobileRequestTimeout('https://example.test/rest/v1/profile'), 8000)
})

test('password requests still abort at a finite deadline without retrying a timeout', async (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] })
  let calls = 0
  const pending = createBoundedMobileFetch((_url, { signal }) => new Promise((_resolve, reject) => {
    calls++
    signal.addEventListener('abort', () => reject(new Error('aborted')))
  }))('https://example.test/auth/v1/token?grant_type=password', { method: 'POST' })
  const rejected = assert.rejects(pending, { code: 'MOBILE_REQUEST_TIMEOUT' })
  t.mock.timers.tick(20000)
  await rejected
  assert.equal(calls, 1)
})

test('an immediate password transport failure retries once and preserves the original request', async (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] })
  const calls = []
  const body = JSON.stringify({ email: 'synthetic@example.test', password: 'synthetic' })
  const pending = createBoundedMobileFetch(async (url, options) => {
    calls.push({ url, options })
    if (calls.length === 1) throw new TypeError('Network request failed')
    return { status: 200 }
  })('https://example.test/auth/v1/token?grant_type=password', { method: 'POST', body })
  await Promise.resolve()
  assert.equal(calls.length, 1)
  t.mock.timers.tick(350)
  assert.equal((await pending).status, 200)
  assert.equal(calls.length, 2)
  assert.equal(calls[1].options.body, body)
  assert.equal(calls[1].options.signal, calls[0].options.signal)
})

test('password retry remains bounded and never retries credential failures, refresh tokens or match writes', async (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] })
  const passwordUrl = 'https://example.test/auth/v1/token?grant_type=password'
  let calls = 0
  assert.equal((await createBoundedMobileFetch(async () => { calls++; return { status: 401 } })(passwordUrl, { method: 'POST' })).status, 401)
  assert.equal(calls, 1)
  for (const url of ['https://example.test/auth/v1/token?grant_type=refresh_token', 'https://example.test/rest/v1/rpc/apply_coach_match_day_command']) {
    calls = 0
    await assert.rejects(createBoundedMobileFetch(async () => { calls++; throw new TypeError('Network request failed') })(url, { method: 'POST' }))
    assert.equal(calls, 1)
  }
  calls = 0
  const failed = createBoundedMobileFetch(async () => { calls++; throw new TypeError('Network request failed') })(passwordUrl, { method: 'POST' })
  const rejection = assert.rejects(failed, /Network request failed/)
  await Promise.resolve()
  t.mock.timers.tick(350)
  await rejection
  assert.equal(calls, 2)
  calls = 0
  const controller = new AbortController()
  const cancelled = createBoundedMobileFetch(async () => { calls++; throw new TypeError('Network request failed') })(passwordUrl, { method: 'POST', signal: controller.signal })
  const cancellation = assert.rejects(cancelled, { name: 'AbortError' })
  await Promise.resolve()
  controller.abort()
  await cancellation
  t.mock.timers.tick(350)
  assert.equal(calls, 1)
})

test('a password transport retry uses the remaining original deadline', async (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] })
  let calls = 0
  const pending = createBoundedMobileFetch((_url, { signal }) => {
    calls++
    if (calls === 1) return Promise.reject(new TypeError('Network request failed'))
    return new Promise((_resolve, reject) => signal.addEventListener('abort', () => reject(new Error('aborted'))))
  })('https://example.test/auth/v1/token?grant_type=password', { method: 'POST' })
  const rejection = assert.rejects(pending, { code: 'MOBILE_REQUEST_TIMEOUT' })
  await Promise.resolve()
  t.mock.timers.tick(350)
  await Promise.resolve()
  assert.equal(calls, 2)
  t.mock.timers.tick(19650)
  await rejection
  assert.equal(calls, 2)
})

test('Parent login preserves the shared auth error and distinguishes timeouts from credentials', async () => {
  for (const error of [new Error('The request timed out.'), { code: 'LOGIN_CONNECTION_TIMEOUT' }]) {
    const message = getMobileConnectionErrorMessage(error)
    assert.match(message, /service is taking too long/)
    assert.equal(getMobileConnectionErrorMessage(message), message)
  }
  assert.match(getMobileConnectionErrorMessage('Network request failed'), /Unable to reach Football Player/)
  assert.equal(getMobileConnectionErrorMessage('Invalid login credentials'), '')
  const app = await readFile(new URL('../apps/parent-mobile/App.js', import.meta.url), 'utf8')
  assert.match(app, /authError=\{authError\}/)
  assert.doesNotMatch(app, /getParentFriendlyError\(authError, 'Email or password not recognised\.'/)
})

test('network timeout aborts the real request and honours caller cancellation', async () => {
  const fetcher = (_url, { signal }) => new Promise((_, reject) => {
    const rejectAbort = () => reject(new Error('aborted'))
    if (signal.aborted) rejectAbort()
    else signal.addEventListener('abort', rejectAbort, { once: true })
  })
  await assert.rejects(createBoundedMobileFetch(fetcher, 10)('synthetic'), /timed out/)
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
