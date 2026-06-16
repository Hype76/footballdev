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
  const gateStart = source.indexOf('function useWorkspaceRouteGate')
  const gateEnd = source.indexOf('function WorkspaceHome', gateStart)
  const gateSection = source.slice(gateStart, gateEnd)
  const publicStart = source.indexOf('function PublicOnly()')
  const publicEnd = source.indexOf('function RequireFormBuilderAccess()', publicStart)
  const publicSection = source.slice(publicStart, publicEnd)
  const parentAccessStart = source.indexOf('function RequireParentPortalAccess()')
  const parentAccessEnd = source.indexOf('function RequireParentLinkingAccess()', parentAccessStart)
  const parentAccessSection = source.slice(parentAccessStart, parentAccessEnd)

  assert.match(gateSection, /parentIntent = false/)
  assert.match(gateSection, /if \(parentIntent\) \{\s*return \{ element: <ParentLoginRedirect \/>/)
  assert.match(gateSection, /return \{ element: <ParentAccountIntentState session=\{session\} user=\{user\} \/>/)
  assert.match(gateSection, /return \{ element: <ParentAccountIntentState session=\{session\} type="no-link" user=\{user\} \/>/)
  assert.match(publicSection, /if \(isParentIntentPath\(location\.pathname\)\) \{\s*return <Outlet \/>/)
  assert.match(publicSection, /return <Navigate to=\{isParentHost\(\) \? '\/parent-portal' : '\/'\} replace \/>/)
  assert.match(parentAccessSection, /parentIntent: true/)
  assert.doesNotMatch(parentAccessSection, /RedirectToWorkspaceHome/)
})
