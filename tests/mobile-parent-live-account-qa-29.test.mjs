import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'

import {
  buildParentCalendarEvents,
  getDateInTimeZone,
  getParentCalendarWindow,
  groupParentCalendarEvents,
} from '../apps/mobile-core/src/parentCalendarCore.js'
import {
  getParentNotificationStorageKeys,
  getParentPushSetupFailureCode,
} from '../apps/mobile-core/src/parentNotificationsCore.js'
import {
  createParentMobileTheme,
  getParentThemeContrastRatio,
  resolveParentMobileBranding,
} from '../apps/mobile-core/src/parentThemeCore.js'
import {
  getBuildClassification,
  getParentFriendlyError,
} from '../apps/parent-mobile/src/parentExperience.js'
import { createThemeColorTokens } from '../src/lib/theme.js'

const [appSource, notificationSource, profileSource, screenSource] = await Promise.all([
  readFile(new URL('../apps/parent-mobile/App.js', import.meta.url), 'utf8'),
  readFile(new URL('../apps/parent-mobile/src/notifications.js', import.meta.url), 'utf8'),
  readFile(new URL('../apps/mobile-core/src/profile.js', import.meta.url), 'utf8'),
  readFile(new URL('../apps/parent-mobile/src/ParentPortalScreens.js', import.meta.url), 'utf8'),
])

test('notification storage isolates environments with SecureStore-compatible keys', () => {
  const production = getParentNotificationStorageKeys('production')
  const testKeys = getParentNotificationStorageKeys('test')

  assert.match(production.installationId, /^[A-Za-z0-9._-]+$/)
  assert.match(testKeys.installationId, /^[A-Za-z0-9._-]+$/)
  assert.notEqual(production.installationId, testKeys.installationId)
  assert.equal(production.installationId.includes(':'), false)
  assert.equal(production.detailLevel.endsWith(':production'), true)
  assert.match(notificationSource, /getParentNotificationStorageKeys/)
  assert.match(notificationSource, /\.netlify\/functions\/parent-mobile-push-installation/)
})

test('notification failures preserve accurate production-facing categories', () => {
  const signedOut = { status: 401, code: 'PARENT_MOBILE_SIGN_IN_REQUIRED' }
  const noAuthority = { status: 403, code: 'PARENT_MOBILE_LINK_REQUIRED' }
  const service = { status: 503, code: 'PARENT_MOBILE_INSTALLATION_FAILED' }

  assert.equal(getParentPushSetupFailureCode(signedOut, 'api'), 'PARENT_PUSH_API_SIGNED_OUT')
  assert.equal(getParentPushSetupFailureCode(noAuthority, 'api'), 'PARENT_PUSH_API_PARENT_AUTHORITY')
  assert.equal(getParentPushSetupFailureCode(service, 'api'), 'PARENT_PUSH_API_SERVICE')
  assert.equal(getParentFriendlyError({ code: 'PARENT_PUSH_API_SIGNED_OUT' }), 'Your session has expired. Sign in again before changing notifications.')
  assert.equal(getParentFriendlyError({ code: 'PARENT_PUSH_API_PARENT_AUTHORITY' }), 'Choose a linked child before changing notifications.')
  assert.equal(getParentFriendlyError({ code: 'PARENT_PUSH_API_NETWORK' }), 'No connection. Notification settings were not changed.')
})

test('mobile branding uses the same accent authority and contrast treatment as web', () => {
  for (const mode of ['light', 'dark']) {
    for (const accent of ['yellow', 'blue', 'green', 'red', 'purple', '#336699']) {
      const mobile = createParentMobileTheme({ mode, selectedLink: { themeAccent: accent } })
      const web = createThemeColorTokens(accent, mode)
      assert.equal(mobile.tokens.accent, web.accent)
      assert.equal(mobile.tokens.buttonPrimary, web.buttonPrimary)
      assert.ok(getParentThemeContrastRatio(mobile.tokens.textPrimary, mobile.tokens.background) >= 4.5)
      assert.ok(getParentThemeContrastRatio(mobile.tokens.textSecondary, mobile.tokens.surface) >= 4.5)
      assert.ok(getParentThemeContrastRatio(mobile.tokens.accentForeground, mobile.tokens.buttonPrimary) >= 4.5)
    }
  }
})

test('dark surfaces remain stable while light mode receives complete semantic surfaces', () => {
  const dark = createParentMobileTheme({ mode: 'dark' })
  const light = createParentMobileTheme({ mode: 'light' })

  assert.deepEqual(
    {
      background: dark.tokens.background,
      border: dark.tokens.border,
      surface: dark.tokens.surface,
      surfaceRaised: dark.tokens.surfaceRaised,
      textPrimary: dark.tokens.textPrimary,
      textSecondary: dark.tokens.textSecondary,
    },
    {
      background: '#030603',
      border: '#1d3520',
      surface: '#0a160c',
      surfaceRaised: '#102415',
      textPrimary: '#f2faef',
      textSecondary: '#a9b8a6',
    },
  )
  assert.equal(light.tokens.background, '#f3f7f6')
  assert.equal(light.tokens.surface, '#ffffff')
  assert.equal(light.tokens.textPrimary, '#132522')
  assert.doesNotMatch(`${appSource}\n${screenSource}`, /#[0-9a-f]{6}/i)
  for (const token of ['background', 'surface', 'surfaceRaised', 'textPrimary', 'textSecondary', 'border', 'accent', 'accentForeground', 'success', 'warning', 'danger', 'muted']) {
    assert.notEqual(light.tokens[token], undefined, `light mode missing ${token}`)
    assert.notEqual(dark.tokens[token], undefined, `dark mode missing ${token}`)
  }
})

test('branding follows the selected child and sanitizes crest URLs', () => {
  const first = resolveParentMobileBranding({
    clubId: 'club-a',
    clubLogoUrl: 'https://cdn.example.test/a.png',
    id: 'link-a',
    themeAccent: 'blue',
    themeButtonStyle: 'gradient',
  })
  const second = resolveParentMobileBranding({ clubId: 'club-b', clubLogoUrl: 'http://unsafe.test/b.png', id: 'link-b', themeAccent: 'red' })

  assert.deepEqual(first, {
    accent: 'blue',
    buttonStyle: 'gradient',
    clubLogoUrl: 'https://cdn.example.test/a.png',
    sourceClubId: 'club-a',
    sourceLinkId: 'link-a',
  })
  assert.equal(second.accent, 'red')
  assert.equal(second.clubLogoUrl, '')
  assert.notEqual(createParentMobileTheme({ selectedLink: { themeAccent: 'blue' } }).tokens.accent, createParentMobileTheme({ selectedLink: { themeAccent: 'red' } }).tokens.accent)
})

test('mobile profile hydrates the canonical Club and Team branding fields', () => {
  assert.match(profileSource, /teams:team_id \(name, theme_mode, theme_accent, theme_button_style\)/)
  assert.match(profileSource, /clubs:club_id \(name, logo_url, theme_accent, theme_button_style\)/)
  for (const field of ['clubLogoUrl', 'themeAccent', 'themeButtonStyle', 'themeMode']) {
    assert.match(profileSource, new RegExp(`${field}:`))
  }
  assert.match(appSource, /ClubBrandLogo/)
  assert.match(appSource, /createParentMobileTheme\(\{ mode: displayTheme, selectedLink \}\)/)
})

test('Calendar parity combines shared events, fixtures, and invitation-only events without duplicates', () => {
  const events = buildParentCalendarEvents({
    calendarEvents: [{ id: 'event-training', eventType: 'training', startsAt: '2026-08-10T17:30:00+01:00', title: 'Training' }],
    invitations: [
      { childName: 'Child', eventId: 'event-training', eventStart: '2026-08-10T17:30:00+01:00', eventTitle: 'Training', invitationId: 'invite-training', responseState: 'available', teamName: 'U12' },
      { childName: 'Child', eventId: 'event-general', eventStart: '2026-08-11T18:00:00+01:00', eventTitle: 'Club evening', invitationId: 'invite-general', responseState: 'awaiting_response', teamName: 'U12' },
    ],
    matches: [{ id: 'match-1', kickoffTime: '10:00:00', matchDate: '2026-08-12', opponent: 'Visitors', status: 'scheduled', teamName: 'U12' }],
  })

  assert.equal(events.length, 3)
  assert.deepEqual(events.map((event) => event.sourceType), ['calendar_event', 'invitation', 'match_day'])
  assert.equal(events[0].responseState, 'available')
  assert.equal(events[2].title, 'U12 v Visitors')
  assert.equal(groupParentCalendarEvents(events).length, 3)
})

test('Calendar date windows use Europe London boundaries and DST safely', () => {
  assert.equal(getDateInTimeZone(new Date('2026-03-29T23:30:00Z')), '2026-03-30')
  assert.equal(getDateInTimeZone(new Date('2026-10-25T00:30:00Z')), '2026-10-25')

  const items = [
    { calendarDate: '2026-08-09', id: 'today', status: 'scheduled' },
    { calendarDate: '2026-09-08', id: 'day-30', status: 'scheduled' },
    { calendarDate: '2026-09-09', id: 'day-31', status: 'scheduled' },
  ]
  assert.deepEqual(getParentCalendarWindow(items, '30-days', new Date('2026-08-09T10:00:00Z')).map((item) => item.id), ['today', 'day-30'])
})

test('Calendar screen provides native filtering, grouped dates, refresh, detail, and response state', () => {
  assert.match(appSource, /buildParentCalendarEvents\(\{/)
  assert.match(appSource, /calendarEvents: valueFor\('calendar'\)/)
  assert.match(appSource, /invitations: valueFor\('invitations'\)/)
  assert.match(appSource, /matches: valueFor\('matches'\)/)
  for (const copy of ['Upcoming', 'Next 30 days', 'All dates', 'Refresh Calendar', 'Response:']) {
    assert.match(screenSource, new RegExp(copy))
  }
  assert.match(screenSource, /formatParentProductDateTime/)
  assert.match(screenSource, /formatParentProductTime/)
})

test('production build labels do not present live binaries as development builds', () => {
  assert.equal(getBuildClassification('store-live'), 'Production TestFlight build')
  assert.equal(getBuildClassification('internal-live'), 'Production internal build')
  assert.equal(getBuildClassification('store-test'), 'TestFlight test build')
})
