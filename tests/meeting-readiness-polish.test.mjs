import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { test } from 'node:test'

import { canManagePolls } from '../src/lib/auth-permissions.js'

const navigationUrl = new URL('../src/app/navigation.js', import.meta.url)
const sidebarUrl = new URL('../src/components/layout/Sidebar.jsx', import.meta.url)
const layoutUrl = new URL('../src/components/layout/Layout.jsx', import.meta.url)
const routerUrl = new URL('../src/app/router.jsx', import.meta.url)
const pollsPageUrl = new URL('../src/pages/PollsPage.jsx', import.meta.url)
const parentPollsPageUrl = new URL('../src/pages/ParentPollsPage.jsx', import.meta.url)
const matchDayPageUrl = new URL('../src/pages/MatchDayPage.jsx', import.meta.url)
const sessionsPageUrl = new URL('../src/pages/SessionsPage.jsx', import.meta.url)

function staffUser(overrides = {}) {
  return {
    activeTeamId: 'team-1',
    clubId: 'club-1',
    planStatus: 'active',
    role: 'coach',
    roleRank: 30,
    ...overrides,
  }
}

test('staff navigation surfaces Polls with role and recovery gates', async () => {
  const [navigationSource, sidebarSource] = await Promise.all([
    readFile(navigationUrl, 'utf8'),
    readFile(sidebarUrl, 'utf8'),
  ])

  assert.match(navigationSource, /label: 'Polls'[\s\S]*path: '\/polls'/)
  assert.match(navigationSource, /helper: 'Create and track replies'/)

  const pollGateStart = sidebarSource.indexOf("if (item.path === '/polls')")
  const pollGateEnd = sidebarSource.indexOf("if (item.path === '/match-day')", pollGateStart)
  assert.notEqual(pollGateStart, -1)
  assert.notEqual(pollGateEnd, -1)
  const pollGateSource = sidebarSource.slice(pollGateStart, pollGateEnd)
  assert.match(pollGateSource, /canManagePolls\(displayUser\)/)
  assert.doesNotMatch(pollGateSource, /canUseTeamWorkflow/)
  assert.match(sidebarSource, /if \(!isRecoveryPathVisible\(item\.path, \{ user: displayUser \}\)\) \{/)
})

test('quick actions expose Create Poll only to permitted staff', async () => {
  const source = await readFile(layoutUrl, 'utf8')

  assert.match(source, /import \{ canCreateEvaluation, canManagePolls,/)
  assert.match(source, /const canUsePollQuickAction = canManagePolls\(user\) && isRecoveryPathVisible\('\/polls', \{ user \}\)/)
  assert.match(source, /label: 'Create Poll', href: '\/polls\?action=create-poll', isVisible: canUsePollQuickAction/)
  assert.match(source, /const visibleActions = actions\.filter\(\(action\) => action\.isVisible !== false\)/)
  assert.match(source, /const \[hasActiveOverlay, setHasActiveOverlay\] = useState\(false\)/)
  assert.match(source, /document\.querySelector\('\[aria-modal="true"\], \[role="dialog"\]'\)/)
  assert.match(source, /hasActiveOverlay \? 'pointer-events-none translate-y-2 opacity-0' : 'opacity-100'/)
  assert.equal(canManagePolls(staffUser()), true)
  assert.equal(canManagePolls(staffUser({ roleRank: 10 })), false)
  assert.equal(canManagePolls(staffUser({ role: 'parent_portal', roleRank: 0 })), false)
})

test('parent bypass shell uses the wider app content width without staff chrome', async () => {
  const source = await readFile(layoutUrl, 'utf8')
  const branchStart = source.indexOf('if (shouldBypassMainShell) {')
  const branchEnd = source.indexOf('<Sidebar', branchStart)
  assert.notEqual(branchStart, -1)
  assert.notEqual(branchEnd, -1)
  const parentBranch = source.slice(branchStart, branchEnd)

  assert.match(parentBranch, /max-w-\[108rem\]/)
  assert.match(parentBranch, /<Outlet \/>/)
  assert.doesNotMatch(parentBranch, /<Sidebar/)
  assert.doesNotMatch(parentBranch, /QuickActionHotbar/)
})

test('direct poll routes stay role-gated and parent route stays parent-safe', async () => {
  const [routerSource, parentPollsSource] = await Promise.all([
    readFile(routerUrl, 'utf8'),
    readFile(parentPollsPageUrl, 'utf8'),
  ])
  const start = routerSource.indexOf('function RequirePollAccess()')
  const end = routerSource.indexOf('function RequireMatchDayAccess()', start)
  assert.notEqual(start, -1)
  assert.notEqual(end, -1)
  const section = routerSource.slice(start, end)

  assert.match(section, /isRecoveryModuleVisible\('pollsAvailability', \{ user \}\)/)
  assert.match(section, /canManagePolls\(user\)/)
  assert.doesNotMatch(section, /needsTeamWorkflowContext\(user\)/)
  assert.match(section, /return <RedirectToWorkspaceHome user=\{user\} \/>/)
  assert.match(section, /return <Outlet \/>/)
  assert.match(parentPollsSource, /Parent polls/)
  assert.match(parentPollsSource, /No parent polls are open for this child right now/)
  assert.doesNotMatch(parentPollsSource, /Create Poll|Create poll|Staff poll|Poll management/)
})

test('poll management page uses visible poll language and create affordance', async () => {
  const source = await readFile(pollsPageUrl, 'utf8')

  assert.match(source, /<p className=\{eyebrowClass\}>Polls<\/p>/)
  assert.match(source, /Create poll/)
  assert.match(source, /Polls and availability/)
  assert.match(source, /No polls have been created yet/)
  assert.doesNotMatch(source, /Availability board/)
})

test('fixture and squad modals use mobile-safe flex scroll layouts', async () => {
  const source = await readFile(matchDayPageUrl, 'utf8')
  const fixtureStart = source.indexOf('function FixtureSetupModal(')
  const squadStart = source.indexOf('function FixtureSquadSelectionModal(')
  assert.notEqual(fixtureStart, -1)
  assert.notEqual(squadStart, -1)
  const fixtureSection = source.slice(fixtureStart, squadStart)
  const squadSection = source.slice(squadStart)

  assert.match(source, /function useModalPageScrollLock\(isLocked\)/)
  assert.match(source, /body\.style\.position = 'fixed'/)
  assert.match(source, /window\.scrollTo\(0, scrollY\)/)
  assert.match(source, /function useFixtureModalViewportStyle\(\)/)
  assert.match(source, /window\.visualViewport/)
  assert.match(source, /--fixture-modal-viewport-height/)
  assert.match(source, /--fixture-modal-viewport-top/)
  assert.match(source, /keyboardInset > 120/)
  assert.match(source, /function getFixtureSetupValidationMessage/)
  assert.match(source, /function blurActiveFixtureControl\(\)/)
  assert.match(source, /function scrollFixtureControlIntoView\(element\)/)
  assert.match(source, /function useFixtureKeyboardFocusState\(\)/)

  assert.match(fixtureSection, /items-stretch[\s\S]*sm:items-center/)
  assert.match(fixtureSection, /top-\[var\(--fixture-modal-viewport-top\)\][\s\S]*h-\[var\(--fixture-modal-viewport-height\)\]/)
  assert.match(fixtureSection, /max-h-full[\s\S]*flex-col[\s\S]*overflow-hidden/)
  assert.match(fixtureSection, /className="flex min-h-0 flex-1 flex-col overflow-hidden"/)
  assert.match(fixtureSection, /shouldPrioritizeFixtureFields = isFixtureControlFocused \|\| isKeyboardOpen/)
  assert.match(fixtureSection, /shouldPrioritizeFixtureFields \? 'hidden sm:flex' : 'flex'[\s\S]*shrink-0 flex-col gap-4 border-b/)
  assert.match(fixtureSection, /shouldPrioritizeFixtureFields \? 'scroll-pb-8 scroll-pt-4' : 'scroll-pb-40 scroll-pt-28'/)
  assert.match(fixtureSection, /sm:scroll-pb-40/)
  assert.match(fixtureSection, /sm:scroll-pt-28/)
  assert.match(fixtureSection, /onFocusCapture=\{handleFocusCapture\}/)
  assert.match(fixtureSection, /onBlurCapture=\{handleBlurCapture\}/)
  assert.match(fixtureSection, /role="alert"/)
  assert.match(fixtureSection, /shouldPrioritizeFixtureFields \? 'hidden sm:flex' : 'flex'/)
  assert.match(fixtureSection, /shrink-0 flex-col-reverse/)
  assert.match(fixtureSection, /onPointerDown=\{blurActiveFixtureControl\}/)

  assert.match(squadSection, /items-stretch[\s\S]*sm:items-center/)
  assert.match(squadSection, /top-\[var\(--fixture-modal-viewport-top\)\][\s\S]*h-\[var\(--fixture-modal-viewport-height\)\]/)
  assert.match(squadSection, /max-h-full[\s\S]*flex-col[\s\S]*overflow-hidden/)
  assert.match(squadSection, /className="min-h-0 flex-1 overflow-y-auto overscroll-contain scroll-pb-40 scroll-pt-24/)
  assert.match(squadSection, /className="shrink-0 flex flex-col-reverse/)
  assert.doesNotMatch(squadSection, /max-h-\[58vh\]/)
})

test('calendar event modal uses mobile keyboard-safe flex scroll layout', async () => {
  const source = await readFile(sessionsPageUrl, 'utf8')
  const modalStart = source.indexOf('function CalendarEventModal(')
  assert.notEqual(modalStart, -1)
  const modalSection = source.slice(modalStart)

  assert.match(modalSection, /items-stretch[\s\S]*sm:items-center/)
  assert.match(modalSection, /max-h-\[calc\(100dvh-1\.5rem\)\][\s\S]*flex-col[\s\S]*overflow-hidden/)
  assert.match(modalSection, /className="flex min-h-0 flex-1 flex-col overflow-hidden"/)
  assert.match(modalSection, /className="min-h-0 flex-1 overflow-y-auto overscroll-contain scroll-pb-32/)
  assert.match(modalSection, /className="shrink-0 flex flex-col-reverse/)
})
