import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'

const readSource = (path) => readFileSync(new URL(`../${path}`, import.meta.url), 'utf8')

const indexCss = readSource('src/index.css')
const parentPortalPage = readSource('src/pages/ParentPortalPage.jsx')
const parentPortalShell = readSource('src/components/parent-portal/ParentPortalShell.jsx')
const parentInvitePage = readSource('src/pages/ParentInvitePage.jsx')
const parentChatPage = readSource('src/pages/ParentChatPage.jsx')
const parentChatWorkspace = readSource('src/components/chat/ParentChatWorkspace.jsx')
const parentPollsPage = readSource('src/pages/ParentPollsPage.jsx')
const friendsFamilyPage = readSource('src/pages/FriendsFamilyPage.jsx')
const toast = readSource('src/components/ui/Toast.jsx')
const noticeBanner = readSource('src/components/ui/NoticeBanner.jsx')
const router = readSource('src/app/router.jsx')

const parentPaletteSources = [
  parentPortalPage,
  parentPortalShell,
  parentInvitePage,
  parentChatWorkspace,
  parentPollsPage,
  friendsFamilyPage,
]

const routeAndStateInventory = [
  ['Parent portal overview', 'one child, multiple children, selected child overview'],
  ['Parent child selector', 'one child, multiple children, child switch'],
  ['Development records and feedback', 'records, details, empty, loading, error'],
  ['Calendar', 'events, no events, event detail'],
  ['Invites and availability', 'pending, completed, no invitations, error'],
  ['Match cards', 'information, no information, match selection'],
  ['Parent scorer', 'score, timer, goal, correction, shootout, permission denied'],
  ['Parent volunteer', 'available, selected, unavailable, permission denied'],
  ['Results', 'previous games, no results, download, print'],
  ['Resources', 'shared files, shared links, preparing, open, download, denied, error, empty'],
  ['Settings and profile', 'profile, notifications, forms, sign out'],
  ['Parent chat', 'rooms, messages, unread, empty, loading, error'],
  ['Parent polls', 'open, answered, unanswered, empty, loading, error'],
  ['Friends and family', 'cards, forms, empty, modal, error'],
  ['Invite completion', 'valid, accepted, expired, invalid, loading, error'],
  ['Sign-in continuation', 'Parent intent, invite continuation, staff-only denial'],
  ['Shared presentation', 'mobile navigation, drawers, modals, dropdowns, toasts'],
  ['Shared controls', 'tables, cards, forms, badges, tabs, accordions, buttons, links'],
]

test('Parent route and state inventory covers every required V1 Parent area', () => {
  const inventoryText = routeAndStateInventory.flat().join(' ').toLowerCase()

  for (const requiredTerm of [
    'overview',
    'child selector',
    'one child',
    'multiple children',
    'development records',
    'feedback',
    'calendar',
    'event detail',
    'availability',
    'match cards',
    'match selection',
    'scorer',
    'volunteer',
    'notifications',
    'profile',
    'settings',
    'invite completion',
    'sign-in continuation',
    'empty',
    'loading',
    'error',
    'permission denied',
    'expired',
    'invalid',
    'mobile navigation',
    'drawers',
    'modals',
    'dropdowns',
    'toasts',
    'tables',
    'cards',
    'forms',
    'badges',
    'tabs',
    'accordions',
    'buttons',
    'links',
    'download',
    'print',
  ]) {
    assert.match(inventoryText, new RegExp(requiredTerm.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')))
  }

  for (const route of [
    "path: 'parent-portal'",
    "path: 'parent-chat'",
    "path: 'parent-messages'",
    "path: 'parent-polls'",
    "path: 'friends-family'",
    "path: '/parent-invite/:token'",
  ]) {
    assert.match(router, new RegExp(route.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')))
  }
})

test('every reachable Parent surface enters the shared theme scope', () => {
  assert.match(parentPortalPage, /<ParentPortalRouteShell/)
  assert.match(parentPortalPage, /data-testid="parent-portal-page"/)
  assert.match(parentPortalShell, /className="parent-portal-theme-scope[^"]*"/)
  assert.match(parentPortalShell, /data-testid="parent-portal-route-shell"/)
  assert.match(parentInvitePage, /className="parent-portal-theme-scope[^"]*"/)
  assert.match(parentInvitePage, /data-testid="parent-invite-shell"/)

  for (const source of [parentChatPage, parentPollsPage, friendsFamilyPage]) {
    assert.match(source, /ParentPortalRouteShell/)
  }
  assert.match(parentChatPage, /ParentChatWorkspace/)
})

test('Parent fixed palette is completely mapped inside the scoped token layer', () => {
  const scopeStart = indexCss.indexOf('.parent-portal-theme-scope')
  const scopeEnd = indexCss.indexOf('.matchday-control-panel', scopeStart)
  const scopeCss = indexCss.slice(scopeStart, scopeEnd)
  assert.ok(scopeStart >= 0)
  assert.ok(scopeEnd > scopeStart)

  const paletteTokens = new Set()
  for (const source of parentPaletteSources) {
    for (const match of source.matchAll(/[A-Za-z0-9_:/.-]*\[#(?:[0-9a-f]{3}|[0-9a-f]{6}|[0-9a-f]{8})\](?:\/[0-9]+)?/gi)) {
      paletteTokens.add(match[0])
    }
    for (const match of source.matchAll(/[A-Za-z0-9_:/.-]*(?:bg|text|border|ring|shadow|divide|placeholder)-(?:white|black)(?:\/[0-9]+)?/g)) {
      paletteTokens.add(match[0])
    }
  }

  const intentionallyStableTokens = new Set(['bg-[#101828]/45'])
  for (const token of paletteTokens) {
    if (!intentionallyStableTokens.has(token)) {
      assert.ok(scopeCss.includes(token), `Parent theme scope maps ${token}`)
    }
  }

  for (const token of [
    '--app-bg',
    '--panel-bg',
    '--panel-alt',
    '--border-color',
    '--text-primary',
    '--text-muted',
    '--text-secondary',
    '--accent',
    '--accent-soft',
    '--button-primary',
    '--button-primary-text',
    '--danger-border',
    '--danger-soft',
    '--danger-text',
  ]) {
    assert.match(scopeCss, new RegExp(token.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')))
  }
})

test('Parent interactions keep accessible token-aware state styling', () => {
  const scopeStart = indexCss.indexOf('.parent-portal-theme-scope')
  const scopeEnd = indexCss.indexOf('.matchday-control-panel', scopeStart)
  const scopeCss = indexCss.slice(scopeStart, scopeEnd)

  for (const state of [
    ':focus',
    ':focus-within',
    ':hover',
    ':read-only',
    'accent-color',
    '--tw-ring-color',
    '--tw-shadow-color',
  ]) {
    assert.match(scopeCss, new RegExp(state.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')))
  }

  assert.match(scopeCss, /--parent-warning-bg/)
  assert.match(scopeCss, /--parent-warning-border/)
  assert.match(scopeCss, /--parent-warning-text/)
})

test('shared notices and toasts use semantic tokens without fixed light-only palettes', () => {
  for (const source of [toast, noticeBanner]) {
    assert.match(source, /--danger-border/)
    assert.match(source, /--danger-soft/)
    assert.match(source, /--danger-text/)
    assert.doesNotMatch(source, /\b(?:bg|text|border)-(?:white|red|rose)-?\d*\b/)
  }

  assert.match(toast, /--panel-bg/)
  assert.match(toast, /--text-primary/)
  assert.match(noticeBanner, /--accent-soft/)
})

test('theme correction preserves Parent authentication, authority, and data operations', () => {
  for (const action of [
    'getParentPortalInvitationState',
    'getParentPortalMatchDays',
    'getParentPortalMatchDayPlayers',
    'getParentPortalPlayerResources',
    'getParentPortalResourceAccessUrl',
    'getParentPortalSharedCalendarEvents',
    'respondToParentPortalInvitation',
    'expressMatchDayScorerInterest',
    'updateMatchDayScoreAsScorer',
    'recordParentScorerShootoutKick',
    'saveThemePreferences',
    'subscribeToParentPush',
    'unsubscribeFromParentPush',
  ]) {
    assert.match(parentPortalPage, new RegExp(`\\b${action}\\b`))
  }

  assert.match(parentChatWorkspace, /\bgetParentChatRooms\b/)
  assert.match(parentChatWorkspace, /\bgetParentChatMessages\b/)
  assert.match(parentPollsPage, /\bgetParentPortalPolls\b/)
  assert.match(parentInvitePage, /\bacceptParentPortalInvite\b/)
  assert.match(router, /if \(!canOpenParentPortal\(user\)\)/)
  assert.match(router, /return <ParentAccessSignInRedirect \/>/)
})

test('Parent resource open and download stay server-authorised inside the shared theme', () => {
  assert.match(parentPortalPage, /\bgetParentPortalResourceAccessUrl\b/)
  assert.match(parentPortalPage, /parentLinkId:\s*selectedLink\.id/)
  assert.match(parentPortalPage, /resourceId:\s*resource\.id/)
  assert.match(
    parentPortalPage,
    /resource\.resourceType === 'external_link'[\s\S]*'Open resource'[\s\S]*'Download resource'/,
  )
  assert.match(parentPortalPage, /className=\{`\$\{secondaryButtonClass\} mt-4 w-full sm:w-auto`\}/)
  assert.match(parentPortalPage, /title="Resource not opened"/)
})
