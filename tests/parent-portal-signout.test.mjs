import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { test } from 'node:test'

const parentPortalPageUrl = new URL('../src/pages/ParentPortalPage.jsx', import.meta.url)
const routerUrl = new URL('../src/app/router.jsx', import.meta.url)

test('parent portal renders visible sign out actions in the main header and settings', async () => {
  const source = await readFile(parentPortalPageUrl, 'utf8')
  const childSelectorStart = source.indexOf('function ParentChildSelector')
  const childSelectorEnd = source.indexOf('function PushNotificationPanel', childSelectorStart)
  const childSelectorSection = source.slice(childSelectorStart, childSelectorEnd)
  const settingsStart = source.indexOf('function ParentSettingsPanel')
  const settingsEnd = source.indexOf('function toDateOnly', settingsStart)
  const settingsSection = source.slice(settingsStart, settingsEnd)

  assert.match(source, /function ParentPortalSignOutButton/)
  assert.match(source, /'Sign out'/)
  assert.match(childSelectorSection, /<ParentPortalSignOutButton/)
  assert.match(childSelectorSection, /className="mt-4 w-full"/)
  assert.match(settingsSection, /<ParentPortalSignOutButton/)
  assert.match(settingsSection, /className="w-full sm:w-auto"/)
})

test('parent portal sign out uses the auth helper and redirects to parent login', async () => {
  const source = await readFile(parentPortalPageUrl, 'utf8')
  const componentStart = source.indexOf('export function ParentPortalPage()')
  const handlerStart = source.indexOf('const handleParentSignOut = async () => {', componentStart)
  const handlerEnd = source.indexOf('async function loadMatches()', handlerStart)
  const handlerSection = source.slice(handlerStart, handlerEnd)

  assert.match(source, /const \{ authUser, resetPassword, signOut, user \} = useAuth\(\)/)
  assert.match(handlerSection, /await signOut\(\)/)
  assert.match(handlerSection, /window\.sessionStorage\.clear\(\)/)
  assert.match(handlerSection, /window\.location\.replace\('\/parent-login'\)/)
  assert.doesNotMatch(handlerSection, /window\.location\.assign/)
  assert.match(source, /onClick=\{onSignOut\}/)
})

test('parent portal sign out failure shows friendly copy only', async () => {
  const source = await readFile(parentPortalPageUrl, 'utf8')
  const handlerStart = source.indexOf('const handleParentSignOut = async () => {')
  const handlerEnd = source.indexOf('async function loadMatches()', handlerStart)
  const handlerSection = source.slice(handlerStart, handlerEnd)

  assert.match(handlerSection, /const message = 'We could not sign you out\. Please try again\.'/)
  assert.match(handlerSection, /showToast\(\{ title: 'Sign out failed', message, tone: 'error' \}\)/)
  assert.match(source, /<NoticeBanner title="Sign out failed" message=\{signOutError\} \/>/)
  assert.doesNotMatch(handlerSection, /error\.message/)
})

test('signed-out parent portal route remains protected after sign out', async () => {
  const routerSource = await readFile(routerUrl, 'utf8')
  const gateStart = routerSource.indexOf('function useWorkspaceRouteGate')
  const gateEnd = routerSource.indexOf('function WorkspaceHome', gateStart)
  const gateSection = routerSource.slice(gateStart, gateEnd)

  assert.match(gateSection, /if \(!session\?\.user\) \{[\s\S]*if \(parentIntent\) \{[\s\S]*<ParentLoginRedirect \/>/)
  assert.match(gateSection, /return \{ element: <Navigate to=\{isParentHost\(\) \? '\/parent-login' : '\/sign-in'\} replace \/>/)
  assert.match(routerSource, /function ParentLoginRedirect\(\) \{[\s\S]*<Navigate to="\/parent-login" replace \/>/)
})
