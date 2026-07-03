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
const parentPortalShellUrl = new URL('../src/components/parent-portal/ParentPortalShell.jsx', import.meta.url)
const parentMessagesPageUrl = new URL('../src/pages/ParentMessagesPage.jsx', import.meta.url)
const parentPollsPageUrl = new URL('../src/pages/ParentPollsPage.jsx', import.meta.url)
const friendsFamilyPageUrl = new URL('../src/pages/FriendsFamilyPage.jsx', import.meta.url)
const parentInvitePageUrl = new URL('../src/pages/ParentInvitePage.jsx', import.meta.url)
const createParentAccountFunctionUrl = new URL('../netlify/functions/create-parent-account.js', import.meta.url)
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
  assert.match(source, /formatParentChildTeamLabel\(link\)/)
  assert.match(source, /Team not available/)
  assert.doesNotMatch(source, /Other linked children/)
  assert.match(source, /You only see updates the club has shared for this child/)
  assert.match(source, /Dates, invites, match cards, and results appear here when the club shares them/)
})

test('parent dashboard uses section navigation instead of one long page', async () => {
  const [source, shellSource] = await Promise.all([
    readFile(parentPortalPageUrl, 'utf8'),
    readFile(parentPortalShellUrl, 'utf8'),
  ])

  assert.match(shellSource, /const parentPortalSections = \[/)
  assert.match(shellSource, /id: 'overview', label: 'Overview'/)
  assert.match(shellSource, /id: 'calendar', label: 'Calendar'/)
  assert.match(shellSource, /id: 'invites', label: 'Invites'/)
  assert.match(shellSource, /id: 'matches', label: 'Match cards'/)
  assert.match(shellSource, /id: 'results', label: 'Results'/)
  assert.match(shellSource, /id: 'messages', label: 'Messages'/)
  assert.match(shellSource, /id: 'polls', label: 'Polls'/)
  assert.match(shellSource, /id: 'family', label: 'Family'/)
  assert.match(shellSource, /id: 'settings', label: 'Settings'/)
  assert.match(shellSource, /aria-label="Parent portal sections"/)
  assert.match(shellSource, /isRecoveryPathVisible\(section\.recoveryPath, \{ user \}\)/)
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
  assert.match(source, /grid grid-cols-3 gap-1\.5 rounded-lg/)
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
  const [source, shellSource] = await Promise.all([
    readFile(parentPortalPageUrl, 'utf8'),
    readFile(parentPortalShellUrl, 'utf8'),
  ])

  assert.match(shellSource, /label: 'Messages'/)
  assert.match(shellSource, /label: 'Polls'/)
  assert.match(shellSource, /label: 'Family'/)
  assert.match(shellSource, /id: 'settings', label: 'Settings'/)
  assert.doesNotMatch(shellSource, /id: 'account', label: 'Account'/)
  assert.match(shellSource, /fixed inset-x-0 bottom-0 z-\[60\]/)
  assert.match(source, /lg:grid-cols-\[16rem_minmax\(0,1fr\)\]/)
  assert.match(shellSource, /hidden lg:block lg:sticky/)
  assert.match(shellSource, /pb-\[max\(0\.75rem,env\(safe-area-inset-bottom\)\)\]/)
  assert.match(shellSource, /max-h-\[calc\(100dvh-2\.5rem\)\]/)
  assert.match(shellSource, /overflow-y-auto overscroll-contain/)
  assert.doesNotMatch(source, /coming soon/i)
  assert.doesNotMatch(source, /staff shell/i)
  assert.doesNotMatch(source, /admin shell/i)
})

test('parent portal shell keeps sign out visible on desktop and mobile', async () => {
  const [source, shellSource, messagesSource, pollsSource, familySource] = await Promise.all([
    readFile(parentPortalPageUrl, 'utf8'),
    readFile(parentPortalShellUrl, 'utf8'),
    readFile(parentMessagesPageUrl, 'utf8'),
    readFile(parentPollsPageUrl, 'utf8'),
    readFile(friendsFamilyPageUrl, 'utf8'),
  ])

  assert.match(shellSource, /function ParentPortalSignOutAction/)
  assert.match(shellSource, /const \{ selectAccessMode, signOut, user \} = useAuth\(\)/)
  assert.match(shellSource, /const canOpenTeamWorkspace = accessModeOptions\.some/)
  assert.match(shellSource, /await selectAccessMode\('team'\)/)
  assert.match(shellSource, /TEAM_WORKSPACE_HOME_PATH/)
  assert.match(shellSource, /buildMainAppUrl\(TEAM_WORKSPACE_HOME_PATH\)/)
  assert.match(shellSource, /aria-label="Open team workspace"/)
  assert.match(shellSource, /Open team workspace/)
  assert.match(shellSource, /await signOut\(\)/)
  assert.match(shellSource, /rememberParentAccessIntent\(\)/)
  assert.match(shellSource, /window\.location\.assign\(isParentPortalHost\(\) \? '\/parent-login' : buildParentAppUrl\('\/parent-login'\)\)/)
  assert.match(shellSource, /aria-label="Sign out of the parent portal"/)
  assert.match(shellSource, /Sign out/)
  assert.match(shellSource, /mt-3 shrink-0 border-t/)
  assert.match(shellSource, /mt-2 border-t/)
  assert.match(shellSource, /grid min-h-0 gap-2 overflow-y-auto overscroll-contain/)
  assert.match(shellSource, /fixed inset-x-0 bottom-0 z-\[60\]/)
  assert.match(source, /pb-44/)
  assert.match(source, /activeSection === 'settings'/)
  assert.match(messagesSource, /<ParentPortalRouteShell activeSection="messages"/)
  assert.match(pollsSource, /<ParentPortalRouteShell activeSection="polls"/)
  assert.match(familySource, /<ParentPortalRouteShell activeSection="family"/)
})

test('parent settings expose safe profile, notification, and theme controls', async () => {
  const source = await readFile(parentPortalPageUrl, 'utf8')

  assert.match(source, /function ParentSettingsPanel/)
  assert.match(source, /function ParentPortalSignOutButton/)
  assert.match(source, /'Sign out'/)
  assert.match(source, /<ParentPortalSignOutButton/)
  assert.match(source, /Display name/)
  assert.match(source, /Email address/)
  assert.match(source, /Club-managed contact details/)
  assert.match(source, /Display name and email changes are managed by the club\./)
  assert.match(source, /Please contact your Team Admin if these details need updating\./)
  assert.match(source, /Read-only/)
  assert.match(source, /mailto:\$\{emailAddress\}/)
  assert.doesNotMatch(source, /Save display name/)
  assert.doesNotMatch(source, /Change email/)
  assert.match(source, /Update password/)
  assert.match(source, /Send reset email/)
  assert.match(source, /Linked children/)
  assert.match(source, /Theme preference/)
  assert.match(source, /const themeOptions = \['system', 'light', 'dark'\]/)
  assert.doesNotMatch(source, /updateParentPortalDisplayName/)
  assert.doesNotMatch(source, /prepareParentPortalEmailChange/)
  assert.doesNotMatch(source, /requestLoginEmailChange/)
  assert.doesNotMatch(source, /updateOwnParentPortalLinksEmail/)
  assert.doesNotMatch(source, /parentPortalEmailAlreadyUpToDateMessage/)
  assert.doesNotMatch(source, /parentPortalUnsafeEmailMessage/)
  assert.doesNotMatch(source, /New emails need inbox confirmation/)
  assert.doesNotMatch(source, /Error sending email change email/)
  assert.doesNotMatch(source, /A user with this email address has already been registered/)
  assert.doesNotMatch(source, /Email not updated/)
  assert.doesNotMatch(source, /Display name not saved/)
  assert.match(source, /updateSignedInPassword/)
  assert.match(source, /<PushNotificationPanel/)
  assert.match(source, /getParentDisplayName/)
  assert.match(source, /!value\.includes\('@'\)/)
})

test('parent portal shell persists navigation on messages polls and family routes', async () => {
  const [messagesSource, pollsSource, familySource, shellSource] = await Promise.all([
    readFile(parentMessagesPageUrl, 'utf8'),
    readFile(parentPollsPageUrl, 'utf8'),
    readFile(friendsFamilyPageUrl, 'utf8'),
    readFile(parentPortalShellUrl, 'utf8'),
  ])

  assert.match(messagesSource, /<ParentPortalRouteShell activeSection="messages"/)
  assert.match(pollsSource, /<ParentPortalRouteShell activeSection="polls"/)
  assert.match(familySource, /<ParentPortalRouteShell activeSection="family"/)
  assert.match(shellSource, /variant="desktop"/)
  assert.match(shellSource, /variant="mobile"/)
  assert.doesNotMatch(shellSource, /coach|admin|staff/i)
})

test('parent messages use compact unread total stat and keep linked children in settings', async () => {
  const [messagesSource, settingsSource] = await Promise.all([
    readFile(parentMessagesPageUrl, 'utf8'),
    readFile(parentPortalPageUrl, 'utf8'),
  ])

  assert.match(messagesSource, /label: 'Unread messages'/)
  assert.match(messagesSource, /value: `\$\{unreadCount\} \/ \$\{messages\.length\}`/)
  assert.doesNotMatch(messagesSource, /label: 'Linked children'/)
  assert.match(settingsSource, /Linked children/)
})

test('messages and polls nav badges use scoped page counts', async () => {
  const [messagesSource, pollsSource, shellSource] = await Promise.all([
    readFile(parentMessagesPageUrl, 'utf8'),
    readFile(parentPollsPageUrl, 'utf8'),
    readFile(parentPortalShellUrl, 'utf8'),
  ])

  assert.match(messagesSource, /messages: unreadCount/)
  assert.match(pollsSource, /polls: unansweredPollCount/)
  assert.match(shellSource, /typeof count === 'number'/)
})

test('friends and family invite wording and success flow are neutral', async () => {
  const [inviteSource, functionSource] = await Promise.all([
    readFile(parentInvitePageUrl, 'utf8'),
    readFile(createParentAccountFunctionUrl, 'utf8'),
  ])
  const combinedSource = `${inviteSource}\n${functionSource}`

  assert.match(inviteSource, /Create account/)
  assert.match(inviteSource, /Already have an account\?/)
  assert.match(inviteSource, /Please confirm your email\./)
  assert.match(inviteSource, /window\.setTimeout\(\(\) => \{[\s\S]*window\.close\(\)[\s\S]*\}, 30000\)/)
  assert.match(functionSource, /Confirm family access/)
  assert.match(functionSource, /Confirm account/)
  assert.match(combinedSource, /This access link is not available\. Please ask the club to send a new invite\./)
  assert.doesNotMatch(combinedSource, /Create parent account|Already have parent access|Parent access not opened|staging account|platform admin for a fresh test invite/)
})

test('calendar includes agenda view with grouped chronological events', async () => {
  const calendarSource = await readFile(footballCalendarUrl, 'utf8')

  assert.match(calendarSource, /\['month', 'week', 'agenda'\]/)
  assert.match(calendarSource, /Agenda/)
  assert.match(calendarSource, /function groupAgendaEvents\(events\)/)
  assert.match(calendarSource, /orderedEvents\.forEach/)
  assert.match(calendarSource, /No upcoming agenda items are available/)
  assert.match(calendarSource, /grid grid-cols-3 gap-1\.5 rounded-lg/)
})

test('parent overview includes neutral helper engagement summary from parent-visible match cards', async () => {
  const source = await readFile(parentPortalPageUrl, 'utf8')

  assert.match(source, /function getParentEngagementSummary\(matches = \[\]\)/)
  assert.match(source, /status === 'scorer_request' \|\| Boolean\(match\.scorerRequestMessage\)/)
  assert.match(source, /match\.hasInterest/)
  assert.match(source, /match\.isScorer/)
  assert.match(source, /Only parent-visible match cards are counted/)
  assert.match(source, /Scorer offers received/)
  assert.match(source, /Interest sent/)
  assert.match(source, /Selected scorer roles/)
  assert.doesNotMatch(source, /missed|ignored|failed to help|blame|shame/i)
})

test('parent calendar modal uses mobile keyboard-safe flex scroll layout', async () => {
  const source = await readFile(parentPortalPageUrl, 'utf8')
  const modalStart = source.indexOf('function ParentCalendarEventModal(')
  assert.notEqual(modalStart, -1)
  const modalSection = source.slice(modalStart)

  assert.match(modalSection, /items-stretch[\s\S]*sm:items-center/)
  assert.match(modalSection, /max-h-\[calc\(100dvh-1\.5rem\)\][\s\S]*flex-col[\s\S]*overflow-hidden/)
  assert.match(modalSection, /className="min-h-0 flex-1 overflow-y-auto overscroll-contain scroll-pb-28/)
  assert.match(modalSection, /className="shrink-0 flex items-start justify-between/)
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
