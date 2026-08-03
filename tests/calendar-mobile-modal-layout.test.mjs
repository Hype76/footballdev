import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { test } from 'node:test'

const sessionsPageUrl = new URL('../src/pages/SessionsPage.jsx', import.meta.url)
const source = await readFile(sessionsPageUrl, 'utf8')
const modalStart = source.indexOf('function CalendarEventModal(')

assert.notEqual(modalStart, -1)

const modalSource = source.slice(modalStart)

test('Calendar modal follows the visual viewport and locks page-behind scrolling', () => {
  assert.match(source, /function useCalendarModalPageScrollLock\(isLocked\)/)
  assert.match(source, /body\.style\.position = 'fixed'/)
  assert.match(source, /documentElement\.style\.overscrollBehavior = 'none'/)
  assert.match(source, /window\.scrollTo\(0, scrollY\)/)
  assert.match(source, /function useCalendarModalViewportStyle\(isOpen\)/)
  assert.match(source, /window\.visualViewport/)
  assert.match(source, /--calendar-modal-viewport-height/)
  assert.match(source, /--calendar-modal-viewport-top/)
  assert.match(modalSource, /top-\[var\(--calendar-modal-viewport-top\)\]/)
  assert.match(modalSource, /h-\[var\(--calendar-modal-viewport-height\)\]/)
  assert.match(modalSource, /height: 'var\(--calendar-modal-viewport-height\)'/)
  assert.match(modalSource, /maxHeight: 'var\(--calendar-modal-viewport-height\)'/)
})

test('Calendar modal reserves most of the mobile viewport for independently scrolling event content', () => {
  assert.match(modalSource, /data-testid="calendar-event-modal"/)
  assert.match(modalSource, /h-screen min-h-0[\s\S]*flex-col overflow-hidden/)
  assert.match(modalSource, /data-testid="calendar-event-modal-content"[\s\S]*min-h-0 flex-1 overflow-y-auto overscroll-contain/)
  assert.match(modalSource, /\[-webkit-overflow-scrolling:touch\]/)
  assert.match(modalSource, /shrink-0 border-b/)
  assert.match(modalSource, /<MobileActionDock/)
  assert.match(modalSource, /mode="contained"/)
})

test('Mobile view mode has compact Open item and More actions controls without a footer Close button', () => {
  const viewFooterStart = modalSource.indexOf('{(event?.href || hasMobileSecondaryActions) ? (')
  const desktopFooterStart = modalSource.indexOf('data-testid="calendar-desktop-action-bar"', viewFooterStart)
  assert.notEqual(viewFooterStart, -1)
  assert.notEqual(desktopFooterStart, -1)

  const mobileViewFooter = modalSource.slice(viewFooterStart, desktopFooterStart)
  assert.match(mobileViewFooter, /testId="calendar-mobile-action-bar"/)
  assert.match(mobileViewFooter, /breakpoint="sm"/)
  assert.match(mobileViewFooter, />Open item</)
  assert.match(mobileViewFooter, />\s*More actions\s*</)
  assert.doesNotMatch(mobileViewFooter, />Close</)
})

test('More actions is an accessible non-nested menu with destructive action last', () => {
  const menuStart = modalSource.indexOf('id="calendar-mobile-actions"')
  const menuEnd = modalSource.indexOf('<ConfirmModal', menuStart)
  assert.notEqual(menuStart, -1)
  assert.notEqual(menuEnd, -1)

  const menuSource = modalSource.slice(menuStart, menuEnd)
  assert.match(menuSource, /role="menu"/)
  assert.match(menuSource, /aria-labelledby="calendar-mobile-actions-title"/)
  assert.match(menuSource, /role="menuitem"[\s\S]*onManagePlayers/)
  assert.match(menuSource, /role="menuitem"[\s\S]*Edit event/)
  assert.match(menuSource, /role="menuitem"[\s\S]*Move or reschedule/)
  assert.match(menuSource, /role="menuitem"[\s\S]*Cancel fixture/)
  assert.ok(menuSource.indexOf('Edit event') < menuSource.indexOf('Move or reschedule'))
  assert.ok(menuSource.indexOf('Move or reschedule') < menuSource.indexOf('Cancel fixture'))
  assert.doesNotMatch(menuSource, /role="dialog"/)
})

test('Header dismissal and modal focus behaviour remain keyboard and touch accessible', () => {
  assert.match(modalSource, /ref=\{closeButtonRef\}/)
  assert.match(modalSource, /aria-label="Close calendar event"/)
  assert.match(modalSource, /h-11 w-11/)
  assert.match(modalSource, /safe-area-inset-top/)
  assert.match(modalSource, /safe-area-inset-right/)
  assert.match(modalSource, /event\.key === 'Escape'/)
  assert.match(modalSource, /event\.key !== 'Tab'/)
  assert.match(modalSource, /getModalFocusableElements/)
  assert.match(modalSource, /returnFocusRef/)
})

test('Desktop action bar remains visible and places destructive action after edit and move actions', () => {
  const desktopFooterStart = modalSource.indexOf('data-testid="calendar-desktop-action-bar"')
  const mobileMenuStart = modalSource.indexOf('{isMobileActionMenuOpen ? (', desktopFooterStart)
  assert.notEqual(desktopFooterStart, -1)
  assert.notEqual(mobileMenuStart, -1)

  const desktopFooter = modalSource.slice(desktopFooterStart, mobileMenuStart)
  assert.match(desktopFooter, /hidden[\s\S]*sm:flex/)
  assert.match(desktopFooter, />Close</)
  assert.match(desktopFooter, />Edit event</)
  assert.match(desktopFooter, />Move or reschedule</)
  assert.ok(desktopFooter.indexOf('Edit event') < desktopFooter.indexOf('Move or reschedule'))
  assert.ok(desktopFooter.indexOf('Move or reschedule') < desktopFooter.indexOf('Cancel fixture'))
})
