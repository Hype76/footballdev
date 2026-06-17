import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { test } from 'node:test'

import {
  canOpenParentPortal,
  hasActiveParentPortalLink,
  isParentIntentPath,
  normalizeParentIntentPath,
} from '../src/lib/parent-auth-intent.js'

const parentLoginUrl = new URL('../src/pages/ParentLoginPage.jsx', import.meta.url)
const routerUrl = new URL('../src/app/router.jsx', import.meta.url)
const layoutUrl = new URL('../src/components/layout/Layout.jsx', import.meta.url)
const netlifyRedirectsUrl = new URL('../public/_redirects', import.meta.url)

test('parent intent paths include login portal and legacy parent entry points', () => {
  assert.equal(isParentIntentPath('/parent-login'), true)
  assert.equal(isParentIntentPath('/parent-portal'), true)
  assert.equal(isParentIntentPath('/parents/portal'), true)
  assert.equal(isParentIntentPath('/parent-messages'), true)
  assert.equal(isParentIntentPath('/parent-polls'), true)
  assert.equal(isParentIntentPath('/friends-family'), true)
  assert.equal(isParentIntentPath('/sign-in'), false)
  assert.equal(normalizeParentIntentPath('parent-login?next=/parent-portal'), '/parent-login')
})

test('parent portal access requires parent role and an active link in the loaded profile', () => {
  const linkedParent = {
    role: 'parent_portal',
    parentPortalLinks: [{ id: 'link-1' }],
  }
  const parentWithoutLinks = {
    role: 'parent_portal',
    parentPortalLinks: [],
  }
  const staffWithLinks = {
    role: 'coach',
    parentPortalLinks: [{ id: 'link-1' }],
  }

  assert.equal(hasActiveParentPortalLink(linkedParent), true)
  assert.equal(canOpenParentPortal(linkedParent), true)
  assert.equal(canOpenParentPortal(parentWithoutLinks), false)
  assert.equal(canOpenParentPortal(staffWithLinks), false)
})

test('parent login blocks an existing non-parent session instead of submitting under it', async () => {
  const source = await readFile(parentLoginUrl, 'utf8')

  assert.match(source, /existingSessionBlocksParentLogin/)
  assert.match(source, /Use a parent account for the Parent Portal/)
  assert.match(source, /You are currently signed in/)
  assert.match(source, /Sign out and continue to Parent Login/)
  assert.match(source, /Go to main platform/)
  assert.match(source, /handleSignOutForParentLogin/)
  assert.match(source, /rememberParentAccessIntent\(\)/)
  assert.match(source, /preferredAccessMode: 'parent'/)
})

test('parent routes preserve parent intent while main sign-in remains separate', async () => {
  const source = await readFile(routerUrl, 'utf8')
  const rootStart = source.indexOf('function PublicLandingOrWorkspaceHome()')
  const rootEnd = source.indexOf('function RequireUser()', rootStart)
  const rootSection = source.slice(rootStart, rootEnd)
  const requireUserStart = source.indexOf('function RequireUser()')
  const requireUserEnd = source.indexOf('function RequireClubWorkspace()', requireUserStart)
  const requireUserSection = source.slice(requireUserStart, requireUserEnd)
  const gateStart = source.indexOf('function useWorkspaceRouteGate')
  const gateEnd = source.indexOf('function WorkspaceHome', gateStart)
  const gateSection = source.slice(gateStart, gateEnd)
  const publicStart = source.indexOf('function PublicOnly()')
  const publicEnd = source.indexOf('function RequireFormBuilderAccess()', publicStart)
  const publicSection = source.slice(publicStart, publicEnd)
  const parentAccessStart = source.indexOf('function RequireParentPortalAccess()')
  const parentAccessEnd = source.indexOf('function RequireParentLinkingAccess()', parentAccessStart)
  const parentAccessSection = source.slice(parentAccessStart, parentAccessEnd)

  assert.match(rootSection, /if \(!session\?\.user\) \{\s*return isParentHost\(\) \? \(/)
  assert.match(rootSection, /<Navigate to="\/parent-login" replace \/>/)
  assert.match(rootSection, /if \(isParentHost\(\)\) \{\s*return <Navigate to="\/parent-portal" replace \/>/)
  assert.match(requireUserSection, /const location = useLocation\(\)/)
  assert.match(requireUserSection, /if \(isParentIntentPath\(location\.pathname\)\) \{\s*return <ParentLoginRedirect \/>/)
  assert.match(requireUserSection, /return <Navigate to=\{isParentHost\(\) \? '\/parent-login' : '\/sign-in'\} replace \/>/)
  assert.match(gateSection, /parentIntent = false/)
  assert.match(gateSection, /if \(parentIntent\) \{\s*return \{ element: <ParentLoginRedirect \/>/)
  assert.match(gateSection, /return \{ element: <ParentAccountIntentState session=\{session\} user=\{user\} \/>/)
  assert.match(gateSection, /return \{ element: <ParentAccountIntentState session=\{session\} type="no-link" user=\{user\} \/>/)
  assert.match(publicSection, /if \(isParentIntentPath\(location\.pathname\)\) \{\s*return <Outlet \/>/)
  assert.match(publicSection, /return <Navigate to=\{isParentHost\(\) \? '\/parent-portal' : '\/'\} replace \/>/)
  assert.match(parentAccessSection, /parentIntent: true/)
  assert.doesNotMatch(parentAccessSection, /RedirectToWorkspaceHome/)
})

test('netlify serves parent host routes through the SPA router', async () => {
  const redirects = await readFile(netlifyRedirectsUrl, 'utf8')

  assert.match(redirects, /\/\*\s+\/index\.html\s+200/)
  assert.doesNotMatch(redirects, /parent\.footballplayer\.online/)
  assert.doesNotMatch(redirects, /footballplayer\.online\/?\s+30[1278]/)
})

test('parent host layout bypasses main app shell chrome', async () => {
  const source = await readFile(layoutUrl, 'utf8')

  assert.match(source, /import \{ isParentPortalHost \} from '\.\.\/\.\.\/lib\/app-origins\.js'/)
  assert.match(source, /const isParentShellHost = isParentPortalHost\(\)/)

  const branchStart = source.indexOf('if (isParentShellHost) {')
  const sidebarStart = source.indexOf('<Sidebar', branchStart)
  assert.notEqual(branchStart, -1)
  assert.notEqual(sidebarStart, -1)

  const parentHostBranch = source.slice(branchStart, sidebarStart)
  assert.match(parentHostBranch, /<Outlet \/>/)
  assert.doesNotMatch(parentHostBranch, /<Sidebar/)
  assert.doesNotMatch(parentHostBranch, /<Topbar/)
  assert.doesNotMatch(parentHostBranch, /OnboardingProvider/)
  assert.doesNotMatch(parentHostBranch, /QuickActionHotbar/)
  assert.doesNotMatch(parentHostBranch, /WorkspaceSelection/)
})

test('parent host layout does not run main shell audit hooks', async () => {
  const source = await readFile(layoutUrl, 'utf8')
  const guardMatches = source.match(/if \(isParentShellHost \|\| !user\?\.id\)/g) ?? []

  assert.equal(guardMatches.length, 2)
  assert.match(source, /\[activeTitle, isParentShellHost, location\.pathname, location\.search, user\]/)
  assert.match(source, /\[isParentShellHost, location\.pathname, user\]/)
})
