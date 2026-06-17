import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { test } from 'node:test'

import {
  getRecoveryModuleForPath,
  isRecoveryPathVisible,
} from '../src/lib/recovery-phase.js'

const parentPortalPageUrl = new URL('../src/pages/ParentPortalPage.jsx', import.meta.url)
const parentLoginPageUrl = new URL('../src/pages/ParentLoginPage.jsx', import.meta.url)
const publicParentLoginBoxUrl = new URL('../src/components/login/ParentPortalLoginBox.jsx', import.meta.url)
const layoutUrl = new URL('../src/components/layout/Layout.jsx', import.meta.url)
const footballCalendarUrl = new URL('../src/components/sessions/FootballCalendar.jsx', import.meta.url)

test('parent dashboard explains no linked child state in plain English', async () => {
  const source = await readFile(parentPortalPageUrl, 'utf8')

  assert.match(source, /No child is linked to this parent account yet/)
  assert.match(source, /Ask your club or team contact to send a parent invite/)
  assert.match(source, /Your family portal is waiting for a linked child/)
  assert.match(source, /No linked child yet/)
  assert.doesNotMatch(source, /No child links are active for this parent account\./)
})

test('parent dashboard explains linked child and multiple child selection', async () => {
  const source = await readFile(parentPortalPageUrl, 'utf8')

  assert.match(source, /Viewing updates for \$\{selectedLink\.playerName\}/)
  assert.match(source, /Child being viewed/)
  assert.match(source, /Other linked children/)
  assert.match(source, /You are only viewing information the club has shared for this child/)
  assert.match(source, /Choose a linked child, then check the calendar, invites, and match cards/)
})

test('parent dashboard uses section navigation instead of one long page', async () => {
  const source = await readFile(parentPortalPageUrl, 'utf8')

  assert.match(source, /const parentPortalSections = \[/)
  assert.match(source, /id: 'overview', label: 'Overview'/)
  assert.match(source, /id: 'calendar', label: 'Calendar'/)
  assert.match(source, /id: 'invites', label: 'Invites'/)
  assert.match(source, /id: 'matches', label: 'Match cards'/)
  assert.match(source, /id: 'results', label: 'Results'/)
  assert.match(source, /id: 'account', label: 'Account'/)
  assert.match(source, /aria-label="Parent portal sections"/)
  assert.match(source, /activeSection === 'calendar'/)
  assert.match(source, /activeSection === 'matches'/)
  assert.match(source, /activeSection === 'results'/)
})

test('parent calendar wording is plain and does not repeat football context', async () => {
  const [parentSource, calendarSource] = await Promise.all([
    readFile(parentPortalPageUrl, 'utf8'),
    readFile(footballCalendarUrl, 'utf8'),
  ])
  const combinedSource = `${parentSource}\n${calendarSource}`

  assert.doesNotMatch(combinedSource, /Football activity/)
  assert.match(calendarSource, /title = 'Activity'/)
  assert.match(calendarSource, /Sessions, match days, response deadlines, and shared development updates\./)
  assert.doesNotMatch(calendarSource, /parent response cut offs/)
})

test('calendar controls are grouped and month grid rows are not hard-coded to six weeks', async () => {
  const source = await readFile(footballCalendarUrl, 'utf8')

  assert.match(source, /visibleDayCount = Math\.ceil\(\(startOffset \+ daysInMonth\) \/ 7\) \* 7/)
  assert.doesNotMatch(source, /Array\.from\(\{ length: 42 \}/)
  assert.match(source, /grid gap-3 sm:grid-cols-\[auto_minmax\(0,1fr\)\]/)
  assert.match(source, /grid grid-cols-2 gap-1\.5 rounded-lg/)
  assert.match(source, /grid grid-cols-3 gap-2/)
})

test('parent dashboard no data states are helpful and not errors', async () => {
  const source = await readFile(parentPortalPageUrl, 'utf8')

  assert.match(source, /No shared calendar activity is available for this child yet/)
  assert.match(source, /When the club shares a parent-visible date, it will appear here/)
  assert.match(source, /No event invites are waiting for this child/)
  assert.match(source, /No match cards are shared for this child right now/)
  assert.match(source, /Previous shared results will appear here/)
  assert.doesNotMatch(source, /No Match Day updates are available for this child right now/)
})

test('parent dashboard does not expose unavailable parent feature clutter', async () => {
  const source = await readFile(parentPortalPageUrl, 'utf8')

  assert.doesNotMatch(source, /Messages/)
  assert.doesNotMatch(source, /Polls/)
  assert.doesNotMatch(source, /Friends/)
  assert.doesNotMatch(source, /coming soon/i)
})

test('parent copy avoids internal implementation language', async () => {
  const sources = await Promise.all([
    readFile(parentPortalPageUrl, 'utf8'),
    readFile(parentLoginPageUrl, 'utf8'),
    readFile(publicParentLoginBoxUrl, 'utf8'),
  ])
  const combinedSource = sources.join('\n')

  assert.doesNotMatch(combinedSource, /recovery phase|platform setup|seeded data|debug mode|\brpc\b|\brls\b/i)
})

test('parent login gives a clear invite and access support path', async () => {
  const [parentLoginSource, publicLoginBoxSource] = await Promise.all([
    readFile(parentLoginPageUrl, 'utf8'),
    readFile(publicParentLoginBoxUrl, 'utf8'),
  ])

  for (const source of [parentLoginSource, publicLoginBoxSource]) {
    assert.match(source, /No invite or cannot get in\?/)
    assert.match(source, /Ask your club or team contact to send a parent invite to this email/)
    assert.match(source, /ask the club to resend the link/)
  }
})

test('unavailable parent routes stay hidden by recovery gates', () => {
  const parentUser = {
    role: 'parent_portal',
    roleRank: 0,
  }

  assert.equal(getRecoveryModuleForPath('/parent-messages'), 'emailMessages')
  assert.equal(getRecoveryModuleForPath('/parent-polls'), 'pollsAvailability')
  assert.equal(getRecoveryModuleForPath('/friends-family'), 'parentInvites')
  assert.equal(isRecoveryPathVisible('/parent-messages', { user: parentUser }), false)
  assert.equal(isRecoveryPathVisible('/parent-polls', { user: parentUser }), false)
  assert.equal(isRecoveryPathVisible('/friends-family', { user: parentUser }), false)
})

test('parent host shell remains isolated from main app chrome', async () => {
  const source = await readFile(layoutUrl, 'utf8')
  const branchStart = source.indexOf('if (isParentShellHost) {')
  const sidebarStart = source.indexOf('<Sidebar', branchStart)
  const parentHostBranch = source.slice(branchStart, sidebarStart)

  assert.notEqual(branchStart, -1)
  assert.notEqual(sidebarStart, -1)
  assert.match(parentHostBranch, /<Outlet \/>/)
  assert.doesNotMatch(parentHostBranch, /<Topbar/)
  assert.doesNotMatch(parentHostBranch, /OnboardingProvider/)
  assert.doesNotMatch(parentHostBranch, /QuickActionHotbar/)
})
