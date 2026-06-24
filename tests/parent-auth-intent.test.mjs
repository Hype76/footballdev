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
const parentProfileSourceUrl = new URL('../src/lib/domain/core.js', import.meta.url)
const authSourceUrl = new URL('../src/lib/auth.js', import.meta.url)
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

test('account unavailable copy is production-safe for live parent portal users', async () => {
  const source = await readFile(routerUrl, 'utf8')
  const rulesStart = source.indexOf('const accountRecoveryRules = [')
  const stateStart = source.indexOf('function AccountDetailsUnavailableState', rulesStart)
  const stateEnd = source.indexOf('function ParentAccountIntentState', stateStart)
  const section = source.slice(rulesStart, stateEnd)

  assert.match(section, /We could not find an active parent portal link for this account\./)
  assert.match(section, /Ask your club or team contact to resend your parent portal invite/)
  assert.match(section, /same email address that received/)
  assert.doesNotMatch(section, /staging account/i)
  assert.doesNotMatch(section, /test workspace/i)
  assert.doesNotMatch(section, /fresh test invite/i)
  assert.doesNotMatch(section, /staging test account/i)
  assert.doesNotMatch(section, /Test and live workspaces keep accounts separate/)
})

test('production auth success copy avoids staging workspace wording', async () => {
  const source = await readFile(authSourceUrl, 'utf8')

  assert.match(source, /Access is ready\. Continue into your workspace\./)
  assert.doesNotMatch(source, /Staging tester access is ready/i)
  assert.doesNotMatch(source, /Continue into your test workspace/i)
})

test('active parent-player link resolves to parent portal profile without app user row', async () => {
  const source = await readFile(parentProfileSourceUrl, 'utf8')
  const profileStart = source.indexOf('export async function fetchUserProfile')
  const profileEnd = source.indexOf('export async function updatePassword', profileStart)
  const section = source.slice(profileStart, profileEnd)

  assert.match(section, /const parentLinks = isDemoAuthUser \? \[\] : await getParentPortalMemberships\(authUser\)/)
  assert.match(section, /const hasParentAccess = parentLinks\.length > 0/)
  assert.match(section, /if \(hasParentAccess && selectedAccessMode === 'parent'\) \{\s*return normalizeParentPortalProfile\(authUser, parentLinks\)/)
  assert.match(section, /if \(hasParentAccess\) \{\s*return normalizeParentPortalProfile\(authUser, parentLinks\)/)
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
  assert.match(gateSection, /if \(isParentHost\(\) && isParentPortalUser\(user\)\) \{\s*return \{ element: <Navigate to="\/parent-portal" replace \/>/)

  const parentHostNonParentRedirect = gateSection.indexOf('if (isParentHost() && !isParentPortalUser(user))')
  const parentHostParentRedirect = gateSection.indexOf('if (isParentHost() && isParentPortalUser(user))')
  const parentIntentPassThrough = gateSection.indexOf('if (!redirectSuperAdmin && isParentPortalUser(user))')
  assert.ok(parentHostNonParentRedirect > -1)
  assert.ok(parentHostParentRedirect > parentHostNonParentRedirect)
  assert.ok(parentIntentPassThrough > parentHostParentRedirect)

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

test('parent host and parent intent routes bypass main app shell chrome', async () => {
  const source = await readFile(layoutUrl, 'utf8')

  assert.match(source, /import \{ isParentPortalHost \} from '\.\.\/\.\.\/lib\/app-origins\.js'/)
  assert.match(source, /import \{ isParentIntentPath \} from '\.\.\/\.\.\/lib\/parent-auth-intent\.js'/)
  assert.match(source, /const isParentShellHost = isParentPortalHost\(\)/)
  assert.match(source, /const isParentIntentRoute = isParentIntentPath\(location\.pathname\)/)
  assert.match(source, /const shouldBypassMainShell = isParentShellHost \|\| isParentIntentRoute/)

  const branchStart = source.indexOf('if (shouldBypassMainShell) {')
  const sidebarStart = source.indexOf('<Sidebar', branchStart)
  assert.notEqual(branchStart, -1)
  assert.notEqual(sidebarStart, -1)

  const parentRouteBranch = source.slice(branchStart, sidebarStart)
  assert.match(parentRouteBranch, /<Outlet \/>/)
  assert.doesNotMatch(parentRouteBranch, /<Sidebar/)
  assert.doesNotMatch(parentRouteBranch, /<Topbar/)
  assert.doesNotMatch(parentRouteBranch, /OnboardingProvider/)
  assert.doesNotMatch(parentRouteBranch, /QuickActionHotbar/)
  assert.doesNotMatch(parentRouteBranch, /WorkspaceSelection/)
})

test('parent shell bypass routes do not run main shell audit hooks', async () => {
  const source = await readFile(layoutUrl, 'utf8')
  const guardMatches = source.match(/if \(shouldBypassMainShell \|\| !user\?\.id\)/g) ?? []

  assert.equal(guardMatches.length, 2)
  assert.match(source, /\[activeTitle, location\.pathname, location\.search, shouldBypassMainShell, user\]/)
  assert.match(source, /\[location\.pathname, shouldBypassMainShell, user\]/)
})
