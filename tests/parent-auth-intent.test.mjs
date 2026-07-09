import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { test } from 'node:test'

import {
  canOpenParentPortal,
  hasActiveParentPortalLink,
  isIntentionalParentAccessContext,
  isParentIntentPath,
  normalizeParentIntentPath,
  resolveAccessModeForRoute,
} from '../src/lib/parent-auth-intent.js'

const parentLoginUrl = new URL('../src/pages/ParentLoginPage.jsx', import.meta.url)
const routerUrl = new URL('../src/app/router.jsx', import.meta.url)
const layoutUrl = new URL('../src/components/layout/Layout.jsx', import.meta.url)
const parentProfileSourceUrl = new URL('../src/lib/domain/core.js', import.meta.url)
const authSourceUrl = new URL('../src/lib/auth.js', import.meta.url)
const netlifyRedirectsUrl = new URL('../public/_redirects', import.meta.url)

test('parent intent paths include login portal and legacy parent entry points', () => {
  assert.equal(isParentIntentPath('/parent-login'), true)
  assert.equal(isParentIntentPath('/parents-login'), true)
  assert.equal(isParentIntentPath('/parent/sign-in'), true)
  assert.equal(isParentIntentPath('/parents/sign-in'), true)
  assert.equal(isParentIntentPath('/parent-portal'), true)
  assert.equal(isParentIntentPath('/parents/portal'), true)
  assert.equal(isParentIntentPath('/parent'), false)
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

test('stale parent access mode is ignored on normal app root without parent intent', () => {
  assert.equal(isIntentionalParentAccessContext({
    isParentHost: false,
    loginAccessIntent: '',
    pathname: '/',
  }), false)
  assert.equal(resolveAccessModeForRoute({
    isParentHost: false,
    loginAccessIntent: '',
    pathname: '/',
    selectedAccessMode: 'parent',
  }), 'team')
  assert.equal(resolveAccessModeForRoute({
    isParentHost: false,
    loginAccessIntent: '',
    pathname: '/coach',
    selectedAccessMode: 'parent',
  }), 'parent')
  assert.equal(resolveAccessModeForRoute({
    isParentHost: false,
    loginAccessIntent: '',
    pathname: '/parent-portal',
    selectedAccessMode: 'parent',
  }), 'parent')
  assert.equal(resolveAccessModeForRoute({
    isParentHost: true,
    loginAccessIntent: '',
    pathname: '/',
    selectedAccessMode: 'parent',
  }), 'parent')
  assert.equal(resolveAccessModeForRoute({
    isParentHost: false,
    loginAccessIntent: 'parent',
    pathname: '/',
    selectedAccessMode: 'parent',
  }), 'parent')
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

test('parent access unavailable redirects to parent login without fallback explainer copy', async () => {
  const source = await readFile(routerUrl, 'utf8')
  const stateStart = source.indexOf('function ParentAccessSignInRedirect')
  const stateEnd = source.indexOf('function LoginIntentMismatchState', stateStart)
  const section = source.slice(stateStart, stateEnd)

  assert.match(section, /await signOut\(\)/)
  assert.match(section, /window\.sessionStorage\.clear\(\)/)
  assert.match(section, /rememberParentAccessIntent\(\)/)
  assert.match(section, /window\.location\.assign\(getParentLoginTarget\(\)\)/)
  assert.match(source, /element: <ParentAccessSignInRedirect \/>/)
  assert.match(source, /function buildParentSignInPath/)
  assert.match(source, /params\.set\('tab', 'parent'\)/)
  assert.match(source, /path: '\/parent-login',\s*element: <ParentSignInRedirect \/>/)
  assert.doesNotMatch(source, /function AccountDetailsUnavailableState/)
  assert.doesNotMatch(source, /function ParentAccountIntentState/)
  assert.doesNotMatch(source, /const accountRecoveryRules = \[/)
  assert.doesNotMatch(source, /Account details unavailable/)
  assert.doesNotMatch(source, /Your login session is active/)
  assert.doesNotMatch(source, /this parent portal view cannot find an active linked parent profile/)
  assert.doesNotMatch(source, /You can open your team workspace now/)
  assert.doesNotMatch(source, /same email address that received/)
  assert.doesNotMatch(source, /staging account/i)
  assert.doesNotMatch(source, /test workspace/i)
  assert.doesNotMatch(source, /fresh test invite/i)
  assert.doesNotMatch(source, /staging test account/i)
  assert.doesNotMatch(source, /Test and live workspaces keep accounts separate/)
})

test('production auth success copy avoids staging workspace wording', async () => {
  const source = await readFile(authSourceUrl, 'utf8')

  assert.match(source, /Access is ready\. Continue into your workspace\./)
  assert.doesNotMatch(source, /Staging tester access is ready/i)
  assert.doesNotMatch(source, /Continue into your test workspace/i)
})

test('club login intent does not run create-club completion fallback', async () => {
  const profileSource = await readFile(parentProfileSourceUrl, 'utf8')
  const authSource = await readFile(authSourceUrl, 'utf8')
  const routerSource = await readFile(routerUrl, 'utf8')
  const profileStart = profileSource.indexOf('export async function fetchUserProfile')
  const profileEnd = profileSource.indexOf('export async function selectUserClub', profileStart)
  const profileSection = profileSource.slice(profileStart, profileEnd)
  const signInStart = authSource.indexOf('const signInWithPassword = async')
  const signInEnd = authSource.indexOf('const selectClub = async', signInStart)
  const signInSection = authSource.slice(signInStart, signInEnd)

  assert.match(profileSource, /export function shouldCompleteSignupClubProfile/)
  assert.match(profileSource, /if \(\['team', 'parent', 'platform_admin'\]\.includes\(normalizedLoginAccessIntent\)\) \{\s*return false\s*\}/)
  assert.match(profileSection, /allowSignupClubProfileCompletion/)
  assert.match(profileSection, /allowSignupClubProfileCompletion && data\?\.role === 'admin' && data\?\.club_id/)
  assert.match(profileSection, /allowClubCreation: allowSignupClubProfileCompletion/)
  assert.match(profileSource, /teamAccessUnavailable: true/)
  assert.match(profileSection, /if \(data\?\.teamAccessUnavailable\) \{\s*return data\s*\}/)
  assert.match(authSource, /if \(profile\?\.teamAccessUnavailable\) \{[\s\S]*setAccessRouteMismatch\(profile\)/)
  assert.match(routerSource, /function TeamAccessUnavailableState/)
  assert.match(routerSource, /Club staff access was not found/)
  assert.match(routerSource, /accessRouteMismatch\?\.teamAccessUnavailable/)
  assert.match(signInSection, /if \(error\) \{[\s\S]*clearLoginAccessIntent\(\)/)
})

test('active parent-player link resolves to parent portal profile without app user row', async () => {
  const source = await readFile(parentProfileSourceUrl, 'utf8')
  const profileStart = source.indexOf('export async function fetchUserProfile')
  const profileEnd = source.indexOf('export async function updatePassword', profileStart)
  const section = source.slice(profileStart, profileEnd)

  assert.match(section, /const parentLinks = isDemoAuthUser \? \[\] : await getParentPortalMemberships\(authUser\)/)
  assert.match(section, /const hasParentAccess = parentLinks\.length > 0/)
  assert.match(section, /if \(hasParentAccess && selectedAccessMode === 'parent'\) \{[\s\S]*return normalizeParentPortalProfile\(authUser, parentLinks, \{/)
  assert.match(section, /if \(hasParentAccess\) \{[\s\S]*return normalizeParentPortalProfile\(authUser, parentLinks\)/)
})

test('dual access parent mode carries a safe route back to team access', async () => {
  const source = await readFile(parentProfileSourceUrl, 'utf8')
  const profileStart = source.indexOf('export async function fetchUserProfile')
  const profileEnd = source.indexOf('export async function updatePassword', profileStart)
  const section = source.slice(profileStart, profileEnd)

  assert.match(source, /function buildParentAccessModeOptions/)
  assert.match(source, /options\.push\(\{ id: 'team', label: 'Team \/ Coach', meta: 'Open coaching and club tools' \}\)/)
  assert.match(section, /const memberships = isDemoAuthUser \? \[\] : await getUserClubMemberships\(authUser\)/)
  assert.match(section, /const hasTeamAccess = Boolean\(data\?\.club_id \|\| memberships\.length > 0 \|\| hasPlatformAccess\)/)
  assert.match(section, /if \(selectedAccessMode === 'parent' && !hasParentAccess && hasTeamAccess\) \{/)
  assert.match(section, /parentAccessUnavailable: true/)
  assert.match(section, /accessModeOptions: buildParentAccessModeOptions\(\{ hasPlatformAccess, hasTeamAccess \}\)/)
  assert.match(section, /parentPortalLinks: parentLinks/)
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
  assert.match(rootSection, /<ParentSignInRedirect \/>/)
  assert.match(rootSection, /if \(isParentHost\(\)\) \{\s*return <Navigate to="\/parent-portal" replace \/>/)
  assert.match(requireUserSection, /const location = useLocation\(\)/)
  assert.match(requireUserSection, /if \(isParentIntentPath\(location\.pathname\)\) \{\s*return <ParentSignInRedirect \/>/)
  assert.match(requireUserSection, /return isParentHost\(\) \? <ParentSignInRedirect \/> : <Navigate to="\/sign-in" replace \/>/)
  assert.match(gateSection, /parentIntent = false/)
  assert.match(gateSection, /if \(parentIntent\) \{\s*return \{ element: <ParentSignInRedirect \/>/)
  assert.match(gateSection, /return \{ element: <ParentAccessSignInRedirect \/>/)
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

test('singular parent route aliases to the public parents page while legacy parent login routes use unified sign-in', async () => {
  const source = await readFile(routerUrl, 'utf8')
  const aliasIndex = source.indexOf("path: '/parent'")
  const parentsIndex = source.indexOf("path: '/parents'")
  const parentLoginIndex = source.indexOf("path: '/parent-login'")
  const parentPortalIndex = source.indexOf("path: 'parent-portal'")

  assert.ok(aliasIndex > -1)
  assert.ok(parentsIndex > aliasIndex)
  assert.ok(parentLoginIndex > parentsIndex)
  assert.ok(parentPortalIndex > parentLoginIndex)
  assert.match(source, /path: '\/parent',\s*element: <Navigate to="\/parents" replace \/>/)
  assert.match(source, /path: '\/parents',\s*element: <PublicOnly \/>/)
  assert.match(source, /path: '\/parent-login',\s*element: <ParentSignInRedirect \/>/)
  assert.match(source, /path: '\/parents-login',\s*element: <ParentSignInRedirect \/>/)
  assert.match(source, /path: '\/parent\/sign-in',\s*element: <ParentSignInRedirect \/>/)
  assert.match(source, /path: '\/parents\/sign-in',\s*element: <ParentSignInRedirect \/>/)
  assert.match(source, /path: 'parent-portal',\s*element: \(\s*<PageSuspense>\s*<ParentPortalPage \/>/)
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
