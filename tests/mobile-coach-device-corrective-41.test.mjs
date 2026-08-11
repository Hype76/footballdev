import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'

import { getCoachBottomNavigationPadding } from '../apps/coach-mobile/src/coachNavigationCore.js'

test('Coach invite reads match the live Calendar schema and use an explicit event lookup', async () => {
  const source = await readFile(new URL('../apps/mobile-core/src/coachPhase31EData.js', import.meta.url), 'utf8')
  const invites = source.slice(source.indexOf('export async function getCoachInvitesAndAvailability'))

  assert.doesNotMatch(invites, /calendar_events:calendar_event_id\(title,team_id,cancelled_at,deleted_at\)/)
  assert.doesNotMatch(invites, /training_availability_requests:request_id\(\*,calendar_events:/)
  assert.match(invites, /training_availability_requests:request_id\(\*\)/)
  assert.match(invites, /from\('calendar_events'\)\.select\('id,title,team_id,cancelled_at'\)/)
  assert.match(invites, /new Map\(\(trainingEventResult\.data \|\| \[\]\)/)
  assert.match(invites, /trainingEvents\.get\(normalize\(request\?\.calendar_event_id\)\)/)
})

test('Coach bottom navigation uses measured insets with a three-button Android fallback', async () => {
  assert.equal(getCoachBottomNavigationPadding(34, 'ios'), 42)
  assert.equal(getCoachBottomNavigationPadding(24, 'android'), 32)
  assert.equal(getCoachBottomNavigationPadding(0, 'android'), 56)
  assert.equal(getCoachBottomNavigationPadding(undefined, 'ios'), 8)

  const app = await readFile(new URL('../apps/coach-mobile/App.js', import.meta.url), 'utf8')
  assert.match(app, /useSafeAreaInsets\(\)/)
  assert.match(app, /edges=\{\['top', 'right', 'left'\]\}/)
  assert.match(app, /bottomInset=\{safeAreaInsets\.bottom\}/)
  assert.match(app, /platform=\{Platform\.OS\}/)
  assert.match(app, /paddingBottom: getCoachBottomNavigationPadding\(bottomInset, platform\)/)
})

test('Corrective 41 remains limited to the guarded Coach Android and iOS production paths', async () => {
  const [buildGuard, submitGuard] = await Promise.all([
    readFile(new URL('../apps/scripts/mobile-build-guard.mjs', import.meta.url), 'utf8'),
    readFile(new URL('../apps/scripts/mobile-submit-guard.mjs', import.meta.url), 'utf8'),
  ])

  assert.match(buildGuard, /authorisedCoachProductionReferences[\s\S]+FP-MOBILE-COACH-DEVICE-CORRECTIVE-41/)
  assert.match(buildGuard, /'internal-live:android'/)
  assert.match(buildGuard, /'store-live:ios'/)
  assert.match(submitGuard, /platform === 'ios' && appRole === 'coach'[\s\S]+FP-MOBILE-COACH-DEVICE-CORRECTIVE-41/)
})
