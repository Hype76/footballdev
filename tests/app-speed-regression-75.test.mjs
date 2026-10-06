import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import test from 'node:test'
import { fileURLToPath } from 'node:url'
import { MOBILE_STARTUP_STATES, runMobileStartup } from '../apps/mobile-core/src/startupStateCore.js'
import { runPrioritizedMobileLoads } from '../apps/mobile-core/src/mobileLoadCoordinator.js'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const read = (file) => fs.readFileSync(path.join(root, file), 'utf8')

test('ordinary web session restoration does not call the Stripe claim endpoint', () => {
  const source = read('src/lib/auth-session-utils.js')
  const guard = source.indexOf('if (!hasCheckoutReturn)')
  const request = source.indexOf("fetch('/.netlify/functions/claim-stripe-checkout'")
  assert.ok(guard > -1 && request > guard)
})

test('mobile startup avoids update-check contention and parallelises independent secure reads', async () => {
  const updates = read('apps/mobile-core/src/updates.js')
  assert.match(updates, /INITIAL_CHECK_DELAY_MS = 5 \* 1000/)
  assert.match(updates, /setTimeout\(\(\) => \{\s*void check\(\)/)
  assert.doesNotMatch(updates, /check\(\{ force: true \}\)/)
  const reads = []
  let resolveBiometric
  const biometric = new Promise(resolve => { resolveBiometric = resolve })
  const session = { user: { id: 'startup-user' } }
  const result = runMobileStartup({
    config: { isUsable: true },
    getBiometricEnabled: () => { reads.push('biometric'); return biometric },
    getSession: async () => { reads.push('session'); return { data: { session } } },
    loadProfile: async value => { assert.equal(value, session); reads.push('profile') },
    onLock: locked => { assert.equal(locked, true); reads.push('lock') },
  })
  await new Promise(resolve => setImmediate(resolve))
  assert.deepEqual(reads, ['biometric', 'session'], 'session restoration must start while secure biometric read is pending')
  resolveBiometric(true)
  assert.equal((await result).state, MOBILE_STARTUP_STATES.READY_SIGNED_IN)
  assert.deepEqual(reads, ['biometric', 'session', 'lock', 'profile'])
})

test('mobile home refreshes are progressive, parallel, and resume-throttled', async () => {
  const coach = read('apps/coach-mobile/App.js')
  const parent = read('apps/parent-mobile/App.js')
  assert.match(coach, /getCoachPhase31GPrimaryHomeSnapshot\(selectedMobileUser, partial =>/)
  assert.match(coach, /getCoachPhase31GAttentionSnapshot\(selectedMobileUser, \{ force: refresh \}\)/)
  assert.match(coach, /HOME_REFRESH_MIN_INTERVAL_MS/)
  assert.match(parent, /runPrioritizedMobileLoads\(loaders, \{/)
  assert.match(parent, /onSettled\(name, result, settled\)/)
  assert.match(parent, /PARENT_REFRESH_MIN_INTERVAL_MS/)
  const started = [], published = []
  const pending = new Map()
  const loaders = Object.fromEntries(['calendar', 'invitations', 'matches', 'notifications', 'resources'].map(name => [name, () => {
    started.push(name)
    return new Promise(resolve => pending.set(name, resolve))
  }]))
  const loading = runPrioritizedMobileLoads(loaders, {
    priority: ['calendar', 'invitations', 'matches', 'notifications'],
    concurrency: 4,
    onSettled: name => published.push(name),
  })
  await new Promise(resolve => setImmediate(resolve))
  assert.deepEqual(started, ['calendar', 'invitations', 'matches', 'notifications'])
  pending.get('notifications')('ready')
  await new Promise(resolve => setImmediate(resolve))
  assert.deepEqual(published, ['notifications'], 'a ready resource must publish before slower Calendar dependencies')
  assert.deepEqual(started, ['calendar', 'invitations', 'matches', 'notifications', 'resources'])
  for (const [name, resolve] of pending) if (name !== 'notifications') resolve(name)
  const results = await loading
  assert.equal(Object.values(results).every(result => result.status === 'fulfilled'), true)
})

test('Chat and Match Day use bounded fast paths', () => {
  const parentData = read('apps/parent-mobile/src/parentPortalData.js')
  const matchDay = read('src/lib/domain/match-day.js')
  const mobileMatchDay = read('apps/mobile-core/src/coachMatchDayData.js')
  assert.match(parentData, /PARENT_CHAT_LOAD_RETRY_DELAYS_MS = \[0, 500, 1500\]/)
  assert.match(matchDay, /rpc\('get_staff_match_day_detail'/)
  assert.match(mobileMatchDay, /rpc\('get_staff_match_day_detail'/)
})

test('notification delivery has bounded concurrency and an authenticated immediate wake path', () => {
  const worker = read('netlify/functions/process-chat-mobile-notifications.js')
  const endpoint = read('netlify/functions/process-chat-mobile-notifications-now.js')
  const wake = read('src/lib/chat-notification-wake.js')
  assert.match(worker, /DELIVERY_CONCURRENCY = 8/)
  assert.match(worker, /mapWithConcurrency/)
  assert.match(endpoint, /client\.auth\.getUser\(token\)/)
  assert.match(endpoint, /processChatMobileNotifications\(\{ client \}\)/)
  assert.match(wake, /process-chat-mobile-notifications-now/)
})

test('public shell uses visually verified compact assets', () => {
  const heroPath = path.join(root, 'src/assets/landing-hero-football-club.webp')
  const logoPath = path.join(root, 'src/assets/football-player-logo.webp')
  assert.ok(fs.statSync(heroPath).size < 150_000)
  assert.ok(fs.statSync(logoPath).size < 30_000)
  assert.match(read('src/pages/PublicLandingPage.jsx'), /landing-hero-football-club\.webp/)
  assert.match(read('src/components/layout/Sidebar.jsx'), /football-player-logo\.webp/)
})
