import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import test from 'node:test'
import { fileURLToPath } from 'node:url'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const read = (file) => fs.readFileSync(path.join(root, file), 'utf8')

test('ordinary web session restoration does not call the Stripe claim endpoint', () => {
  const source = read('src/lib/auth-session-utils.js')
  const guard = source.indexOf('if (!hasCheckoutReturn)')
  const request = source.indexOf("fetch('/.netlify/functions/claim-stripe-checkout'")
  assert.ok(guard > -1 && request > guard)
})

test('mobile startup avoids update-check contention and parallelises independent secure reads', () => {
  const updates = read('apps/mobile-core/src/updates.js')
  const startup = read('apps/mobile-core/src/startupStateCore.js')
  assert.match(updates, /INITIAL_CHECK_DELAY_MS = 20 \* 1000/)
  assert.match(updates, /setTimeout\(\(\) => \{\s*void check\(\)/)
  assert.doesNotMatch(updates, /check\(\{ force: true \}\)/)
  const biometricStart = startup.indexOf('const biometricResultPromise = withStartupTimeout')
  const sessionStart = startup.indexOf('const result = await withStartupTimeout(() => getSession()')
  assert.ok(biometricStart > -1 && sessionStart > biometricStart)
  assert.match(startup, /biometricResultPromise[\s\S]*getBiometricEnabled\(\)/)
})

test('mobile home refreshes are progressive, parallel, and resume-throttled', () => {
  const coach = read('apps/coach-mobile/App.js')
  const parent = read('apps/parent-mobile/App.js')
  assert.match(coach, /getCoachPhase31GAttentionSnapshot\(selectedMobileUser\)[\s\S]*getCoachPhase31GPrimaryHomeSnapshot\(selectedMobileUser\)/)
  assert.match(coach, /HOME_REFRESH_MIN_INTERVAL_MS/)
  assert.match(parent, /const settleResource = async \(name\)/)
  assert.match(parent, /PARENT_REFRESH_MIN_INTERVAL_MS/)
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
