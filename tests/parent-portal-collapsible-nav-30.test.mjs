import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'

import {
  PARENT_PORTAL_MOBILE_NAV_STORAGE_KEY,
  readParentPortalMobileNavCollapsed,
  writeParentPortalMobileNavCollapsed,
} from '../src/lib/parent-portal-mobile-nav.js'

const shellUrl = new URL('../src/components/parent-portal/ParentPortalShell.jsx', import.meta.url)
const actionDockUrl = new URL('../src/components/ui/MobileActionDock.jsx', import.meta.url)
const stylesUrl = new URL('../src/index.css', import.meta.url)
const [shellSource, actionDockSource, stylesSource] = await Promise.all([
  readFile(shellUrl, 'utf8'),
  readFile(actionDockUrl, 'utf8'),
  readFile(stylesUrl, 'utf8'),
])

test('Parent Portal navigation preference is private, device-only, expanded by default, and fails safely', () => {
  const values = new Map()
  const storage = {
    getItem: (key) => values.get(key) ?? null,
    setItem: (key, value) => values.set(key, value),
  }
  const blockedStorage = {
    getItem: () => { throw new Error('blocked') },
    setItem: () => { throw new Error('blocked') },
  }

  assert.equal(PARENT_PORTAL_MOBILE_NAV_STORAGE_KEY, 'footballplayer.online:parent-portal-mobile-nav:collapsed:v1')
  assert.equal(readParentPortalMobileNavCollapsed(storage), false)
  assert.equal(writeParentPortalMobileNavCollapsed(true, storage), true)
  assert.equal(readParentPortalMobileNavCollapsed(storage), true)
  values.set(PARENT_PORTAL_MOBILE_NAV_STORAGE_KEY, 'stale')
  assert.equal(readParentPortalMobileNavCollapsed(storage), false)
  assert.equal(readParentPortalMobileNavCollapsed(blockedStorage), false)
  assert.equal(writeParentPortalMobileNavCollapsed(true, blockedStorage), false)
  assert.doesNotMatch(PARENT_PORTAL_MOBILE_NAV_STORAGE_KEY, /:(child|team|user|email)(:|-)/i)
})

test('mobile Parent Portal navigation has expanded and compact accessible states', () => {
  assert.match(shellSource, /data-parent-portal-mobile-nav=\{variant === 'mobile' \? 'expanded'/)
  assert.match(shellSource, /data-parent-portal-mobile-nav="collapsed"/)
  assert.match(shellSource, /aria-label="Collapse Parent Portal navigation"/)
  assert.match(shellSource, /aria-label="Expand Parent Portal navigation"/)
  assert.match(shellSource, /aria-expanded="true"/)
  assert.match(shellSource, /aria-expanded="false"/)
  assert.match(shellSource, /min-h-12 min-w-12 max-w-28/)
  assert.match(shellSource, /activeSectionLabel/)
  assert.match(shellSource, /\?\.label \|\| 'Portal menu'/)
  assert.match(shellSource, /role="status" aria-live="polite"/)
  assert.match(shellSource, /motion-reduce:transition-none/)
})

test('expanded navigation preserves context, destinations, badges, staff return, and sign out', () => {
  for (const label of ['Overview', 'Calendar', 'Invites', 'Match cards', 'Results', 'Development', 'Resources', 'Chat', 'Polls', 'Settings']) {
    assert.match(shellSource, new RegExp(`label: '${label}'`))
  }
  assert.match(shellSource, /<ParentPortalContext/)
  assert.match(shellSource, /parent-portal-shell-child-mobile/)
  assert.match(shellSource, /has new activity/)
  assert.match(shellSource, /PARENT_PORTAL_STAFF_RETURN_LABEL/)
  assert.match(shellSource, /aria-label="Sign out of the parent portal"/)
})

test('Parent navigation reuses low-level keyboard and layout contracts without action-dock preference coupling', () => {
  assert.match(shellSource, /isMobileVirtualKeyboardOpen/)
  assert.match(shellSource, /MOBILE_ACTION_DOCK_LAYOUT_EVENT/)
  assert.match(shellSource, /ResizeObserver/)
  assert.match(shellSource, /--parent-portal-mobile-nav-content-padding/)
  assert.match(shellSource, /--mobile-floating-bottom-clearance/)
  assert.match(stylesSource, /--parent-portal-mobile-nav-content-padding: 18rem/)
  assert.doesNotMatch(shellSource, /readMobileActionDockCollapsed|writeMobileActionDockCollapsed/)
  assert.match(actionDockSource, /MOBILE_ACTION_DOCK_STORAGE_KEY/)
})

test('desktop shell and existing Phase 29D action docks remain separate', () => {
  assert.match(shellSource, /className="hidden lg:flex"/)
  assert.match(shellSource, /variant="desktop"/)
  assert.match(shellSource, /variant="mobile"/)
  assert.doesNotMatch(shellSource, /<MobileActionDock/)
})

test('focused files contain no em dash characters', () => {
  assert.doesNotMatch(shellSource, /\u2014/)
  assert.doesNotMatch(stylesSource, /\u2014/)
})
