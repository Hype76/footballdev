import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { test } from 'node:test'

const layoutUrl = new URL('../src/components/layout/Layout.jsx', import.meta.url)

test('Quick Add menu is positioned with viewport clamping and mobile safe margins', async () => {
  const source = await readFile(layoutUrl, 'utf8')

  assert.match(source, /const QUICK_ACTION_MENU_WIDTH = 288/)
  assert.match(source, /const QUICK_ACTION_MENU_BREAKPOINT = 640/)
  assert.match(source, /const QUICK_ACTION_MOBILE_BOTTOM_CLEARANCE = 112/)
  assert.match(source, /const quickActionMenuStyle = getQuickActionMenuStyle\(quickActionPosition, visibleActions\.length\)/)
  assert.match(source, /className="fixed rounded-lg border border-\[#d7e5dc\] bg-white p-2 shadow-2xl shadow-\[#047857\]\/20"/)
  assert.match(source, /style=\{quickActionMenuStyle\}/)
  assert.match(source, /function getQuickActionMenuStyle\(position, actionCount = 0\)/)
  assert.match(source, /if \(viewportWidth < QUICK_ACTION_MENU_BREAKPOINT\) \{[\s\S]*bottom: `\$\{QUICK_ACTION_EDGE_GAP\}px`/)
  assert.match(source, /right: `\$\{QUICK_ACTION_EDGE_GAP\}px`/)
  assert.match(source, /width: 'auto'/)
  assert.match(source, /function isMobileQuickActionViewport\(\)/)
  assert.match(source, /function getQuickActionBottomClearance\(\)/)
  assert.match(source, /const bottomClearance = getQuickActionBottomClearance\(\)/)
  assert.match(source, /window\.innerHeight - QUICK_ACTION_BUTTON_SIZE - bottomClearance/)
  assert.match(source, /window\.innerWidth < 768/)
  assert.match(source, /safePosition\.x \+ QUICK_ACTION_BUTTON_SIZE - menuWidth/)
  assert.match(source, /const hasRoomBelow = belowTop \+ estimatedMenuHeight <= viewportHeight - QUICK_ACTION_EDGE_GAP/)
  assert.match(source, /const preferredTop = hasRoomBelow \? belowTop : aboveTop/)
  assert.match(source, /overflowY: 'auto'/)
})

test('Quick Add actions and close behaviour remain wired', async () => {
  const source = await readFile(layoutUrl, 'utf8')

  for (const route of [
    '/add-player',
    '/sessions/start?action=create-session',
    '/assess-player/new?choosePlayer=1',
    '/calendar?action=add-event',
    '/match-day',
    '/polls?action=create-poll',
  ]) {
    assert.match(source, new RegExp(`href: '${route.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}'`))
  }

  assert.match(source, /label: 'Game Day', href: '\/match-day'[\s\S]*coachModeVisible: true/)
  assert.match(source, /label: 'Add Voice Note', type: 'voice-note'/)
  assert.match(source, /document\.addEventListener\('pointerdown', handlePointerDown\)/)
  assert.match(source, /document\.addEventListener\('keydown', handleKeyDown\)/)
  assert.match(source, /if \(event\.key === 'Escape'\) \{[\s\S]*setIsOpen\(false\)/)
})
