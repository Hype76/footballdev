import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { test } from 'node:test'

import {
  getRecoveryModuleForPath,
  isRecoveryPathVisible,
} from '../src/lib/recovery-phase.js'
import {
  getParentMatchDayErrorMessage,
  parentMatchDayLoadErrorMessage,
} from '../src/lib/parent-matchday-errors.js'

const parentPortalPageUrl = new URL('../src/pages/ParentPortalPage.jsx', import.meta.url)
const parentLoginPageUrl = new URL('../src/pages/ParentLoginPage.jsx', import.meta.url)
const publicParentLoginBoxUrl = new URL('../src/components/login/ParentPortalLoginBox.jsx', import.meta.url)
const layoutUrl = new URL('../src/components/layout/Layout.jsx', import.meta.url)
const footballCalendarUrl = new URL('../src/components/sessions/FootballCalendar.jsx', import.meta.url)

test('parent dashboard explains no linked child state in plain English', async () => {
  const source = await readFile(parentPortalPageUrl, 'utf8')

  assert.match(source, /No child is linked to this parent account yet/)
  assert.match(source, /Ask your club or team contact to send a parent invite/)
  assert.match(source, /Parent portal/)
  assert.match(source, /No linked child yet/)
  assert.doesNotMatch(source, /No child links are active for this parent account\./)
})

test('parent dashboard explains linked child and multiple child selection', async () => {
  const source = await readFile(parentPortalPageUrl, 'utf8')

  assert.match(source, /\{selectedLink\?\.playerName \|\| 'Parent portal'\}/)
  assert.match(source, /Updates shared by the club/)
  assert.match(source, /Child being viewed/)
  assert.match(source, /Other linked children/)
  assert.match(source, /You only see updates the club has shared for this child/)
  assert.match(source, /Dates, invites, match cards, and results appear here when the club shares them/)
})

test('parent dashboard uses section navigation instead of one long page', async () => {
  const source = await readFile(parentPortalPageUrl, 'utf8')

  assert.match(source, /const parentPortalSections = \[/)
  assert.match(source, /id: 'overview', label: 'Overview'/)
  assert.match(source, /id: 'calendar', label: 'Calendar'/)
  assert.match(source, /id: 'invites', label: 'Invites'/)
  assert.match(source, /id: 'matches', label: 'Match cards'/)
  assert.match(source, /id: 'results', label: 'Results'/)
  assert.match(source, /id: 'messages', label: 'Messages'/)
  assert.match(source, /id: 'polls', label: 'Polls'/)
  assert.match(source, /id: 'family', label: 'Family'/)
  assert.match(source, /id: 'account', label: 'Account'/)
  assert.match(source, /aria-label="Parent portal sections"/)
  assert.match(source, /isRecoveryPathVisible\(section\.path, \{ user \}\)/)
  assert.match(source, /activeSection === 'calendar'/)
  assert.match(source, /activeSection === 'matches'/)
  assert.match(source, /activeSection === 'results'/)
})

test('parent child selector is placed before dashboard content', async () => {
  const source = await readFile(parentPortalPageUrl, 'utf8')

  const selectorIndex = source.indexOf('<ParentChildSelector')
  const navIndex = source.indexOf('<ParentPortalSectionNav')
  const overviewIndex = source.indexOf('<ParentOverviewPanel')

  assert.notEqual(selectorIndex, -1)
  assert.notEqual(navIndex, -1)
  assert.notEqual(overviewIndex, -1)
  assert.ok(selectorIndex < navIndex)
  assert.ok(navIndex < overviewIndex)
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

  assert.match(source, /Nothing has been shared yet/)
  assert.match(source, /When the club shares dates, invites, match cards, messages, or results, they'll appear here/)
  assert.match(source, /No shared calendar activity is available for this child yet/)
  assert.match(source, /When the club shares a parent-visible date, it will appear here/)
  assert.match(source, /No event invites are waiting for this child/)
  assert.match(source, /No match cards are shared for this child right now/)
  assert.match(source, /Previous shared results will appear here/)
  assert.doesNotMatch(source, /No Match Day updates are available for this child right now/)
  assert.doesNotMatch(source, /Follow the selected child/)
  assert.doesNotMatch(source, /What you can see/)
  assert.doesNotMatch(source, /ParentMatchDayHero/)
  assert.doesNotMatch(source, /ParentMatchMetric/)
})

test('parent match day load failures show parent-friendly copy instead of raw Safari errors', async () => {
  const source = await readFile(parentPortalPageUrl, 'utf8')

  assert.equal(getParentMatchDayErrorMessage(new TypeError('Load failed')), parentMatchDayLoadErrorMessage)
  assert.equal(getParentMatchDayErrorMessage(new TypeError('Failed to fetch')), parentMatchDayLoadErrorMessage)
  assert.equal(getParentMatchDayErrorMessage(new Error('Network request failed')), parentMatchDayLoadErrorMessage)
  assert.equal(getParentMatchDayErrorMessage(new Error('Parent link is not active.'), 'Could not load shared match day items. Please refresh or try again.'), 'Parent link is not active.')
  assert.match(source, /setMatchErrorTitle\(parentMatchDayLoadErrorTitle\)/)
  assert.match(source, /setMatchError\(getParentMatchDayErrorMessage\(error, parentMatchDayLoadErrorMessage\)\)/)
  assert.match(source, /<NoticeBanner title=\{matchErrorTitle\} message=\{matchError\} \/>/)
  assert.doesNotMatch(source, /setMatchError\(error\.message \|\| 'Match Day could not be loaded\.'\)/)
})

test('parent dashboard exposes surfaced parent links without feature clutter', async () => {
  const source = await readFile(parentPortalPageUrl, 'utf8')

  assert.match(source, /label: 'Messages'/)
  assert.match(source, /label: 'Polls'/)
  assert.match(source, /label: 'Family'/)
  assert.doesNotMatch(source, /coming soon/i)
  assert.doesNotMatch(source, /staff shell/i)
  assert.doesNotMatch(source, /admin shell/i)
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

test('batch 1 to 4 recovery routes are available while parent dashboard stays focused', () => {
  const parentUser = {
    role: 'parent_portal',
    roleRank: 0,
  }

  assert.equal(getRecoveryModuleForPath('/parent-messages'), 'parentMessages')
  assert.equal(getRecoveryModuleForPath('/parent-polls'), 'pollsAvailability')
  assert.equal(getRecoveryModuleForPath('/friends-family'), 'familySharing')
  assert.equal(getRecoveryModuleForPath('/email-queue'), 'emailMessages')
  assert.equal(getRecoveryModuleForPath('/parent-email-templates'), 'emailMessages')
  assert.equal(getRecoveryModuleForPath('/end-season-stats'), 'reports')
  assert.equal(isRecoveryPathVisible('/parent-messages', { user: parentUser }), true)
  assert.equal(isRecoveryPathVisible('/parent-polls', { user: parentUser }), true)
  assert.equal(isRecoveryPathVisible('/friends-family', { user: parentUser }), true)
  assert.equal(isRecoveryPathVisible('/email-queue', { user: parentUser }), true)
  assert.equal(isRecoveryPathVisible('/parent-email-templates', { user: parentUser }), true)
  assert.equal(isRecoveryPathVisible('/end-season-stats', { user: parentUser }), true)
})

test('parent host shell remains isolated from main app chrome', async () => {
  const source = await readFile(layoutUrl, 'utf8')
  const branchStart = source.indexOf('if (shouldBypassMainShell) {')
  const sidebarStart = source.indexOf('<Sidebar', branchStart)
  const parentHostBranch = source.slice(branchStart, sidebarStart)

  assert.notEqual(branchStart, -1)
  assert.notEqual(sidebarStart, -1)
  assert.match(source, /const shouldBypassMainShell = isParentShellHost \|\| isParentIntentRoute/)
  assert.match(parentHostBranch, /<Outlet \/>/)
  assert.doesNotMatch(parentHostBranch, /<Topbar/)
  assert.doesNotMatch(parentHostBranch, /OnboardingProvider/)
  assert.doesNotMatch(parentHostBranch, /QuickActionHotbar/)
})
