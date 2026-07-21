import assert from 'node:assert/strict'
import { access, readFile } from 'node:fs/promises'
import test from 'node:test'

import { assertBrowserCompatibleInlineCsp } from '../scripts/csp-inline-integrity.mjs'

import {
  clearOfflineDraftsForUser,
  getDrafts,
  LEGACY_OFFLINE_DRAFTS_KEY,
  OFFLINE_DRAFTS_KEY,
  removeDraft,
  saveDraft,
} from '../src/lib/offline-drafts.js'
import {
  assertPasswordPolicy,
  getPasswordPolicyErrors,
  PASSWORD_MIN_LENGTH,
} from '../src/lib/password-policy.js'

function createStorage() {
  const values = new Map()

  return {
    getItem(key) {
      return values.get(key) ?? null
    },
    removeItem(key) {
      values.delete(key)
    },
    setItem(key, value) {
      values.set(key, String(value))
    },
  }
}

const userA = Object.freeze({
  activeTeamId: 'team-a',
  clubId: 'club-a',
  id: 'account-a',
  status: 'active',
})

function draft(overrides = {}) {
  return {
    clubId: userA.clubId,
    data: {
      id: 'evaluation-a',
      playerId: 'player-a',
      playerName: 'Protected Child',
      teamId: userA.activeTeamId,
    },
    id: 'evaluation-a',
    playerId: 'player-a',
    readyToSync: true,
    teamId: userA.activeTeamId,
    ...overrides,
  }
}

test('offline drafts are account, club, team, player, status, and expiry scoped', () => {
  const storage = createStorage()
  const saved = saveDraft(draft(), { now: Date.UTC(2026, 6, 21), storage, user: userA })

  assert.ok(saved)
  assert.equal(getDrafts({ now: Date.UTC(2026, 6, 22), storage, user: userA }).length, 1)
  assert.equal(getDrafts({ storage, user: { ...userA, id: 'account-b' } }).length, 0)
  assert.equal(getDrafts({ storage, user: { ...userA, clubId: 'club-b' } }).length, 0)
  assert.equal(getDrafts({ storage, user: { ...userA, activeTeamId: 'team-b' } }).length, 0)
  assert.equal(getDrafts({ storage, user: { ...userA, status: 'disabled' } }).length, 0)
  assert.equal(getDrafts({ storage, user: { ...userA, clubId: '' } }).length, 0)
  assert.equal(getDrafts({ now: Date.UTC(2026, 7, 1), storage, user: userA }).length, 0)
  assert.doesNotMatch(OFFLINE_DRAFTS_KEY, /account-a|club-a|team-a|Protected Child|player-a/i)
})

test('legacy drafts are removed, submission deletion works, and sign-out cleanup is scoped', () => {
  const storage = createStorage()
  storage.setItem(LEGACY_OFFLINE_DRAFTS_KEY, JSON.stringify([{ id: 'legacy-sensitive' }]))

  saveDraft(draft(), { storage, user: userA })
  saveDraft(draft({ id: 'evaluation-b', data: { ...draft().data, id: 'evaluation-b' } }), {
    storage,
    user: { ...userA, id: 'account-b' },
  })

  assert.equal(storage.getItem(LEGACY_OFFLINE_DRAFTS_KEY), null)
  removeDraft('evaluation-a', { storage, user: userA })
  assert.equal(getDrafts({ storage, user: userA }).length, 0)
  assert.equal(getDrafts({ storage, user: { ...userA, id: 'account-b' } }).length, 1)

  saveDraft(draft(), { storage, user: userA })
  clearOfflineDraftsForUser(userA, { storage })
  assert.equal(getDrafts({ storage, user: userA }).length, 0)
  assert.equal(getDrafts({ storage, user: { ...userA, id: 'account-b' } }).length, 1)
})

test('password policy rejects weak values and accepts a strong value', () => {
  assert.equal(PASSWORD_MIN_LENGTH, 12)
  assert.ok(getPasswordPolicyErrors('password123!').length > 0)
  assert.throws(() => assertPasswordPolicy('Football123!'), /commonly used|at least/i)
  assert.equal(assertPasswordPolicy('Harbour-Lantern-27!'), 'Harbour-Lantern-27!')
})

test('recovery redirects fail closed and responses remain generic', async (context) => {
  const originalEnvironment = {
    CONTEXT: process.env.CONTEXT,
    NETLIFY: process.env.NETLIFY,
    RESEND_FROM_EMAIL: process.env.RESEND_FROM_EMAIL,
    SUPABASE_SERVICE_ROLE_KEY: process.env.SUPABASE_SERVICE_ROLE_KEY,
  }
  process.env.CONTEXT = 'production'
  process.env.NETLIFY = 'true'
  process.env.RESEND_FROM_EMAIL = 'security-test@footballplayer.online'
  process.env.SUPABASE_SERVICE_ROLE_KEY = 'local-test-service-role-secret'

  context.after(() => {
    for (const [key, value] of Object.entries(originalEnvironment)) {
      if (value === undefined) delete process.env[key]
      else process.env[key] = value
    }
  })

  const { createPasswordRecoveryHandler, resolveRecoveryRedirect } = await import('../netlify/functions/send-password-reset.js')
  assert.equal(resolveRecoveryRedirect({ isProduction: true, requestOrigin: 'https://footballplayer.online' }), 'https://footballplayer.online/reset-password')

  for (const rejectedOrigin of [
    'https://attacker.example',
    'https://footballplayer.online.attacker.example',
    'https://footballplayer.online%2eattacker.example',
    'https://user@footballplayer.online',
    '//footballplayer.online',
    'http://footballplayer.online',
    'https://footballplayer.online#fragment',
  ]) {
    assert.equal(resolveRecoveryRedirect({ isProduction: true, requestOrigin: rejectedOrigin }), '')
  }

  let allowed = true
  const sent = []
  const admin = {
    auth: {
      admin: {
        generateLink: async ({ email }) => email === 'known@example.test'
          ? { data: { properties: { action_link: 'https://supabase.example/recovery?token=secret-token' } }, error: null }
          : { data: null, error: { code: 'user_not_found' } },
      },
    },
    rpc: async () => ({ data: { allowed }, error: null }),
  }
  const handler = createPasswordRecoveryHandler({
    createAdminClient: () => admin,
    sendRecoveryEmail: async (payload) => sent.push(payload),
    sleep: async () => {},
  })
  const event = (email, extra = {}) => ({
    body: JSON.stringify({ email, ...extra }),
    headers: {
      origin: 'https://footballplayer.online',
      'x-nf-client-connection-ip': '192.0.2.20',
    },
    httpMethod: 'POST',
  })

  const knownResponse = await handler(event('known@example.test'))
  const unknownResponse = await handler(event('unknown@example.test'))
  assert.deepEqual(knownResponse, unknownResponse)
  assert.equal(sent.length, 1)

  allowed = false
  const limitedResponse = await handler(event('known@example.test'))
  assert.deepEqual(limitedResponse, knownResponse)
  assert.equal(sent.length, 1)

  const callerRedirect = await handler(event('known@example.test', { redirectTo: 'https://attacker.example' }))
  assert.equal(callerRedirect.statusCode, 400)
  assert.doesNotMatch(callerRedirect.body, /attacker|known@example|secret-token/)
})

test('headers, PWA caching, manifest MIME, and demo maintenance surface are hardened', async () => {
  const [indexHtml, netlifyConfig, manifestText, viteConfig] = await Promise.all([
    readFile(new URL('../index.html', import.meta.url), 'utf8'),
    readFile(new URL('../netlify.toml', import.meta.url), 'utf8'),
    readFile(new URL('../public/manifest.webmanifest', import.meta.url), 'utf8'),
    readFile(new URL('../vite.config.js', import.meta.url), 'utf8'),
  ])

  const processingSection = netlifyConfig.match(/\[build\.processing\.html\]([\s\S]*?)(?=\n\[|$)/)?.[1] || ''
  assert.match(processingSection, /^\s*pretty_urls\s*=\s*false\s*$/m)
  assert.doesNotMatch(processingSection, /pretty_urls\s*=\s*true/)

  const cspResult = assertBrowserCompatibleInlineCsp({ html: indexHtml, netlifyConfig })
  assert.equal(cspResult.inlineScripts.length, 2)
  assert.deepEqual(cspResult.configuredHashes, cspResult.browserHashes)

  assert.doesNotThrow(() => JSON.parse(manifestText))
  assert.match(netlifyConfig, /Content-Type = "application\/manifest\+json; charset=utf-8"/)
  assert.match(netlifyConfig, /Content-Security-Policy = "[^"]+"/)
  assert.match(netlifyConfig, /frame-ancestors 'none'/)
  assert.match(netlifyConfig, /X-Content-Type-Options = "nosniff"/)
  assert.match(netlifyConfig, /Referrer-Policy = "strict-origin-when-cross-origin"/)
  assert.match(netlifyConfig, /Permissions-Policy = /)
  assert.match(netlifyConfig, /Strict-Transport-Security = /)
  assert.match(netlifyConfig, /Cross-Origin-Opener-Policy = "same-origin"/)
  assert.match(netlifyConfig, /Cross-Origin-Resource-Policy = "same-origin"/)
  assert.doesNotMatch(netlifyConfig, /unsafe-eval/)
  assert.match(viteConfig, /globPatterns: \['\*\*\/\*\.\{js,css,html,ico,png,svg,webp,jpg,jpeg\}'\]/)
  assert.doesNotMatch(viteConfig, /(?:evaluation|draft|supabase).*(?:runtimeCaching|cacheName)/i)
  await assert.rejects(access(new URL('../netlify/functions/reset-demo-account.js', import.meta.url)))
})
