import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'
import { join } from 'node:path'
import { sendExpoPushMessages } from '../netlify/functions/lib/_expo-push.js'
import {
  expoPushCallerPaths,
  expoPushHelperPath,
  validateExpoPushHelperContract,
} from '../apps/scripts/mobile-push-helper-contract.mjs'

const repoRoot = process.cwd()
const read = (relativePath) => readFileSync(join(repoRoot, relativePath), 'utf8')
const helperSource = read(expoPushHelperPath)
const callerSources = Object.fromEntries(expoPushCallerPaths.map((callerPath) => [callerPath, read(callerPath)]))

test('current shared Expo push helper and every legitimate caller match the canonical lib architecture', () => {
  assert.deepEqual(validateExpoPushHelperContract({ helperSource, callerSources }), [])
})

test('contract rejects a missing helper and invalid exports', () => {
  assert.match(validateExpoPushHelperContract({ helperSource: '', callerSources })[0], /is missing/)

  const failures = validateExpoPushHelperContract({
    helperSource: helperSource.replace('export async function sendExpoPushMessages', 'async function renamedPushMessages'),
    callerSources,
  })

  assert.ok(failures.some((failure) => failure.includes('must export async function sendExpoPushMessages')))
})

test('contract rejects an unsafe transport and an environment-selected production fallback', () => {
  const unsafeTransportFailures = validateExpoPushHelperContract({
    helperSource: helperSource.replace('https://exp.host/--/api/v2/push/send', 'http://push.example.invalid/send'),
    callerSources,
  })
  assert.ok(unsafeTransportFailures.some((failure) => failure.includes('canonical Expo transport')))
  assert.ok(unsafeTransportFailures.some((failure) => failure.includes('alternate or insecure transport URL')))

  const fallbackFailures = validateExpoPushHelperContract({
    helperSource: helperSource.replace(
      "const EXPO_PUSH_URL = 'https://exp.host/--/api/v2/push/send'",
      "const EXPO_PUSH_URL = process.env.EXPO_PUSH_URL || 'https://exp.host/--/api/v2/push/send'",
    ),
    callerSources,
  })
  assert.ok(fallbackFailures.some((failure) => failure.includes('environment fallback')))
})

test('contract rejects caller drift back to the obsolete root helper path', () => {
  const driftedCallers = {
    ...callerSources,
    [expoPushCallerPaths[0]]: callerSources[expoPushCallerPaths[0]].replace('./lib/_expo-push.js', './_expo-push.js'),
  }
  const failures = validateExpoPushHelperContract({ helperSource, callerSources: driftedCallers })

  assert.ok(failures.some((failure) => failure.includes('must import the canonical shared helper')))
})

test('build guard preserves the normal release-check before EAS and exposes no skip path', () => {
  const buildGuardSource = read('apps/scripts/mobile-build-guard.mjs')
  const releaseCheckIndex = buildGuardSource.indexOf("execFileSync('npm', ['run', 'mobile:release-check']")
  const easBuildIndex = buildGuardSource.indexOf("execFileSync('npx', ['eas-cli', 'build'")

  assert.ok(releaseCheckIndex >= 0)
  assert.ok(easBuildIndex > releaseCheckIndex)
  assert.match(buildGuardSource, /MOBILE_NATIVE_BUILD_CONFIRMED/)
  assert.doesNotMatch(buildGuardSource, /SKIP|BYPASS/i)
})

test('invalid synthetic tokens are rejected without any network request', async () => {
  const originalFetch = globalThis.fetch
  let fetchCalls = 0
  globalThis.fetch = async () => {
    fetchCalls += 1
    throw new Error('Network must remain mocked')
  }

  try {
    assert.deepEqual(await sendExpoPushMessages([
      { to: 'not-an-expo-token', title: 'Synthetic test' },
      { to: '', title: 'Synthetic test' },
    ]), {
      sent: 0,
      failed: 0,
      invalidTokens: [],
    })
    assert.equal(fetchCalls, 0)
  } finally {
    globalThis.fetch = originalFetch
  }
})

test('synthetic messages are batched and delivery responses are classified through mocked fetch only', async () => {
  const originalFetch = globalThis.fetch
  const requests = []
  globalThis.fetch = async (url, options) => {
    const batch = JSON.parse(options.body)
    const requestIndex = requests.length
    requests.push({ url, batch })
    return {
      ok: true,
      json: async () => ({
        data: batch.map((message, index) => {
          if (requestIndex === 0 && index === 0) {
            return { status: 'error', details: { error: 'DeviceNotRegistered' } }
          }
          if (requestIndex === 0 && index === 1) {
            return { status: 'error', details: { error: 'MessageTooBig' } }
          }
          return { status: 'ok' }
        }),
      }),
    }
  }

  const messages = Array.from({ length: 101 }, (_, index) => ({
    to: `ExponentPushToken[synthetic-${index}]`,
    title: 'Synthetic test',
  }))

  try {
    const result = await sendExpoPushMessages(messages)
    assert.equal(requests.length, 2)
    assert.equal(requests[0].url, 'https://exp.host/--/api/v2/push/send')
    assert.equal(requests[0].batch.length, 100)
    assert.equal(requests[1].batch.length, 1)
    assert.deepEqual(result, {
      sent: 99,
      failed: 2,
      invalidTokens: ['ExponentPushToken[synthetic-0]'],
    })
  } finally {
    globalThis.fetch = originalFetch
  }
})

test('mocked non-success transport fails the synthetic batch without exposing token values', async () => {
  const originalFetch = globalThis.fetch
  globalThis.fetch = async () => ({
    ok: false,
    json: async () => ({ error: 'synthetic_failure' }),
  })

  try {
    const result = await sendExpoPushMessages([
      { to: 'ExponentPushToken[synthetic-failed]', title: 'Synthetic test' },
    ])
    assert.deepEqual(result, {
      sent: 0,
      failed: 1,
      invalidTokens: [],
    })
  } finally {
    globalThis.fetch = originalFetch
  }
})
