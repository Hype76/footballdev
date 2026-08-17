import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import test from 'node:test'
import { fileURLToPath } from 'node:url'

import { withMobileAsyncTimeout } from '../apps/mobile-core/src/http.js'
import { getParentChatRoomTitle, getParentChatRoomTypeLabel } from '../apps/parent-mobile/src/parentPresentationCore.js'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const read = (relativePath) => fs.readFileSync(path.join(root, relativePath), 'utf8')

test('mobile async timeout ends an unresponsive read', async () => {
  await assert.rejects(
    withMobileAsyncTimeout(() => new Promise(() => {}), { timeoutMs: 5 }),
    /request timed out/i,
  )
})

test('Coach Match Day uses bounded reads and preserves the exact fixture target', () => {
  const source = read('apps/coach-mobile/src/CoachMatchDayScreen.js')
  assert.match(source, /withMobileAsyncTimeout\(\(\) => getCoachMatchDayList/)
  assert.match(source, /withMobileAsyncTimeout\(\(\) => getCoachMatchDayDetail\(currentUser, activeSelectionId\)\)/)
  assert.match(source, /cachedMatch\?\.id === activeSelectionId/)
  assert.match(source, /selectedMatchId\.current = requestedFixtureId/)
})

test('Coach Sessions degrades optional reads without replacing fresh Sessions with an offline warning', () => {
  const source = read('apps/coach-mobile/src/CoachOperationalScreens.js')
  assert.match(source, /Promise\.allSettled\(\[/)
  assert.match(source, /if \(sessionResult\.status === 'rejected'\) throw sessionResult\.reason/)
  assert.match(source, /playerResult\.status === 'fulfilled'/)
  assert.match(source, /calendarResult\.status === 'fulfilled'/)
})

test('Parent attention opens the exact live poll and refreshes a closed target', () => {
  const source = read('apps/parent-mobile/App.js')
  assert.match(source, /visiblePolls\.find\(\(poll\) => poll\.id === item\.entityId\)/)
  assert.match(source, /That poll has closed\. The attention list has been refreshed\./)
  assert.match(source, /targetPollId=\{selectedPollId\}/)
  assert.match(source, /const visibleItems = targetPoll \? \[targetPoll\] : resource\.items/)
})

test('Parent Chat presents Coach wording for the internal parent_staff room type', () => {
  const room = { title: 'Chat with Staff', type: 'parent_staff' }
  assert.equal(getParentChatRoomTypeLabel(room.type), 'Parent coach')
  assert.equal(getParentChatRoomTitle(room), 'Chat with Coach')
})

test('corrective 64 is explicitly authorised for both production builds and submissions', () => {
  const buildGuard = read('apps/scripts/mobile-build-guard.mjs')
  const submitGuard = read('apps/scripts/mobile-submit-guard.mjs')
  assert.match(buildGuard, /authorisedParentProductionReferences[\s\S]*FP-MOBILE-FEEDBACK-CORRECTIVE-64/)
  assert.match(buildGuard, /authorisedCoachProductionReferences[\s\S]*FP-MOBILE-FEEDBACK-CORRECTIVE-64/)
  assert.match(submitGuard, /promotionReference === 'FP-MOBILE-FEEDBACK-CORRECTIVE-64'/)
})
