import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { test } from 'node:test'

import {
  MOBILE_ACTION_DOCK_STORAGE_KEY,
  getMobileFloatingBottomClearance,
  isMobileVirtualKeyboardOpen,
  readMobileActionDockCollapsed,
  writeMobileActionDockCollapsed,
} from '../src/lib/mobile-action-dock.js'

const files = {
  component: new URL('../src/components/ui/MobileActionDock.jsx', import.meta.url),
  formation: new URL('../src/pages/FormationBoardsPage.jsx', import.meta.url),
  globalInstall: new URL('../src/components/pwa/GlobalInstallAppButton.jsx', import.meta.url),
  layout: new URL('../src/components/layout/Layout.jsx', import.meta.url),
  offlineSync: new URL('../src/components/pwa/OfflineDraftSync.jsx', import.meta.url),
  parentShell: new URL('../src/components/parent-portal/ParentPortalShell.jsx', import.meta.url),
  sessions: new URL('../src/pages/SessionsPage.jsx', import.meta.url),
  styles: new URL('../src/index.css', import.meta.url),
  toast: new URL('../src/components/ui/Toast.jsx', import.meta.url),
}

const source = Object.fromEntries(await Promise.all(
  Object.entries(files).map(async ([key, url]) => [key, await readFile(url, 'utf8')]),
))

test('action-bar inventory migrates every live editor bar and classifies non-editor fixed UI', () => {
  const inventory = [
    {
      route: '/resources/formation-boards',
      component: 'FormationBoardsPage',
      actions: ['Players', 'Undo', 'Actions', 'Save'],
      primary: 'Save',
      unsaved: 'snapshot comparison, local draft, before-leave blocker',
      error: 'Formation Board error summary and Retry',
      safeArea: 'safe-area-inset-bottom',
      zIndex: 40,
      breakpoint: 'lg',
      previous: 'one-off fixed footer',
      decision: 'MobileActionDock page mode',
    },
    {
      route: '/calendar and /sessions/start',
      component: 'CalendarEventModal in SessionsPage',
      actions: ['Cancel', 'Save', 'More', 'Open item', 'More actions'],
      primary: 'Save or Open item',
      unsaved: 'editing baseline comparison',
      error: 'calendar validation summary and field focus',
      safeArea: 'safe-area-inset-bottom within visual viewport modal',
      zIndex: 80,
      breakpoint: 'sm',
      previous: 'one-off mobile-only modal footer',
      decision: 'MobileActionDock contained mode',
    },
  ]

  assert.equal(inventory.length, 2)
  assert.deepEqual(inventory.map((item) => item.primary), ['Save', 'Save or Open item'])
  assert.match(source.formation, /<MobileActionDock[\s\S]*testId="formation-mobile-action-dock"/)
  assert.doesNotMatch(source.formation, /fixed inset-x-0 bottom-0 z-40/)
  assert.equal((source.sessions.match(/testId="calendar-mobile-action-bar"/g) || []).length, 2)
  assert.doesNotMatch(source.sessions, /data-testid="calendar-mobile-action-bar" className=/)
  assert.match(source.parentShell, /ParentPortalSectionNav[\s\S]*variant === 'mobile'/)
  assert.match(source.parentShell, /fixed inset-x-0 bottom-0 z-\[60\]/)
  assert.doesNotMatch(source.parentShell, /MobileActionDock/)
})

test('shared dock provides expanded, collapsed, preference, status, focus, and reduced-motion contracts', () => {
  assert.match(source.component, /readMobileActionDockCollapsed/)
  assert.match(source.component, /writeMobileActionDockCollapsed/)
  assert.match(source.component, /data-mobile-action-dock="expanded"/)
  assert.match(source.component, /data-mobile-action-dock="collapsed"/)
  assert.match(source.component, /aria-label="Collapse actions"/)
  assert.match(source.component, /aria-label=\{`Expand actions/)
  assert.match(source.component, /aria-expanded="true"/)
  assert.match(source.component, /aria-expanded="false"/)
  assert.match(source.component, /Error and unsaved changes/)
  assert.match(source.component, /role="status" aria-live="polite"/)
  assert.match(source.component, /min-h-12 min-w-12/)
  assert.match(source.component, /motion-reduce:transition-none/)
  assert.match(source.component, /window\.visualViewport/)
  assert.match(source.component, /isMobileVirtualKeyboardOpen/)
  assert.match(source.component, /onAttentionFocus/)
})

test('device-only preference defaults expanded and fails safely when storage is blocked or stale', () => {
  const values = new Map()
  const storage = {
    getItem: (key) => values.get(key) ?? null,
    setItem: (key, value) => values.set(key, value),
  }
  const blockedStorage = {
    getItem: () => { throw new Error('blocked') },
    setItem: () => { throw new Error('blocked') },
  }

  assert.equal(MOBILE_ACTION_DOCK_STORAGE_KEY, 'footballplayer.online:mobile-action-dock:collapsed:v1')
  assert.equal(readMobileActionDockCollapsed(storage), false)
  assert.equal(writeMobileActionDockCollapsed(true, storage), true)
  assert.equal(readMobileActionDockCollapsed(storage), true)
  values.set(MOBILE_ACTION_DOCK_STORAGE_KEY, 'stale-value')
  assert.equal(readMobileActionDockCollapsed(storage), false)
  assert.equal(readMobileActionDockCollapsed(blockedStorage), false)
  assert.equal(writeMobileActionDockCollapsed(true, blockedStorage), false)
  assert.equal(writeMobileActionDockCollapsed(true, null), false)
})

test('virtual keyboard detection hides only page docks while an editable field is obscured', () => {
  assert.equal(isMobileVirtualKeyboardOpen({
    activeElement: { tagName: 'INPUT' },
    innerHeight: 800,
    visualViewport: { height: 520 },
  }), true)
  assert.equal(isMobileVirtualKeyboardOpen({
    activeElement: { tagName: 'BUTTON' },
    innerHeight: 800,
    visualViewport: { height: 520 },
  }), false)
  assert.equal(isMobileVirtualKeyboardOpen({
    activeElement: { tagName: 'TEXTAREA' },
    innerHeight: 800,
    visualViewport: { height: 730 },
  }), false)
})

test('floating actions, notifications, safe areas, and content padding share one positioning contract', () => {
  assert.match(source.styles, /--mobile-action-content-padding: calc\(8\.5rem \+ env\(safe-area-inset-bottom\)\)/)
  assert.match(source.styles, /--mobile-floating-bottom-clearance: 144px/)
  assert.match(source.styles, /data-mobile-action-dock-state='collapsed'/)
  assert.match(source.layout, /getMobileFloatingBottomClearance/)
  assert.match(source.layout, /MOBILE_ACTION_DOCK_LAYOUT_EVENT/)
  assert.match(source.toast, /bottom-\[var\(--mobile-floating-bottom-clearance\)\]/)
  assert.match(source.globalInstall, /bottom-\[var\(--mobile-floating-bottom-clearance\)\]/)
  assert.match(source.offlineSync, /bottom-\[var\(--mobile-floating-bottom-clearance\)\]/)
  assert.match(source.formation, /pb-\[var\(--mobile-action-content-padding\)\]/)

  const documentElement = {}
  const originalWindow = globalThis.window
  globalThis.window = {
    getComputedStyle: (target) => {
      assert.equal(target, documentElement)
      return { getPropertyValue: () => '144px' }
    },
  }
  try {
    assert.equal(getMobileFloatingBottomClearance({ documentElement }), 144)
  } finally {
    globalThis.window = originalWindow
  }
})

test('Formation Board keeps action order, authority, drafts, pitch tools, and error recovery', () => {
  const dockStart = source.formation.indexOf('<MobileActionDock')
  const dockEnd = source.formation.indexOf('</MobileActionDock>', dockStart)
  const dock = source.formation.slice(dockStart, dockEnd)

  assert.ok(dock.indexOf('>Players<') < dock.indexOf('>Undo<'))
  assert.ok(dock.indexOf('>Undo<') < dock.indexOf('>Actions<'))
  assert.ok(dock.indexOf('>Actions<') < dock.indexOf("'Save'"))
  assert.match(dock, /disabled=\{!canEdit \|\| isSaving \|\| !hasUnsavedChanges \|\| pitchCapacity\.isOverCapacity\}/)
  assert.match(source.formation, /useBlocker\(\(\) => hasUnsavedChanges/)
  assert.match(source.formation, /serializeFormationDraft/)
  assert.match(source.formation, /MobileRosterSheet/)
  assert.match(source.formation, /UnplacedPlayersTray/)
  assert.match(source.formation, /onMove=\{\(playerId, coordinates\)/)
  assert.match(source.formation, /attentionKey=\{dockAttentionKey\}/)
  assert.match(source.formation, /onAttentionFocus=\{focusFormationError\}/)
})

test('Calendar and Session docks retain primary, secondary, destructive, validation, and modal focus semantics', () => {
  assert.match(source.sessions, /label="Calendar editor actions"/)
  assert.match(source.sessions, /hasUnsavedChanges=\{hasUnsavedEditorChanges\}/)
  assert.match(source.sessions, /attentionKey=\{validationError\?\.message \|\| ''\}/)
  assert.match(source.sessions, />Cancel<\/button>[\s\S]*type="submit"[\s\S]*Save/)
  assert.match(source.sessions, />\s*More\s*<\/button>/)
  assert.match(source.sessions, /label="Calendar event actions"[\s\S]*>Open item<\/button>/)
  assert.match(source.sessions, /id="calendar-mobile-actions"/)
  assert.match(source.sessions, /role="menuitem"[\s\S]*Cancel fixture/)
  assert.match(source.sessions, /#calendar-modal-validation-summary/)
  assert.match(source.sessions, /target\?\.focus\(\{ preventScroll: true \}\)/)
  assert.match(source.sessions, /aria-modal="true"/)
})
