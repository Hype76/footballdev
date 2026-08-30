import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'

import {
  getCoachQuickActionIconKey,
  getCoachRouteIconKey,
  getMatchDayFilterIconKey,
  getMatchDayPanelIconKey,
  getMobileIconName,
  getParentTabIconKey,
  listMobileIconNames,
} from '../apps/mobile-core/src/mobileIconSystem.js'

test('mobile icon system uses one Material icon vocabulary for both apps', () => {
  assert.equal(getMobileIconName(getCoachRouteIconKey('home')), 'home')
  assert.equal(getMobileIconName(getCoachRouteIconKey('formation')), 'grid-view')
  assert.equal(getMobileIconName(getParentTabIconKey('matchday')), 'sports-soccer')
  assert.equal(getMobileIconName(getCoachQuickActionIconKey('add-player')), 'person-add-alt')
  assert.equal(getMobileIconName(getMatchDayPanelIconKey('volunteers')), 'volunteer-activism')
  assert.equal(getMobileIconName(getMatchDayFilterIconKey('previous')), 'history')
  assert.ok(listMobileIconNames().length >= 30)
})

test('mobile icon refresh stays on the installed OTA-safe icon library and semantic palettes', async () => {
  const [coachApp, coachPackage, matchDayScreen, quickActions, parentApp, parentPackage, coachTheme, parentTheme] = await Promise.all([
    readFile(new URL('../apps/coach-mobile/App.js', import.meta.url), 'utf8'),
    readFile(new URL('../apps/coach-mobile/package.json', import.meta.url), 'utf8'),
    readFile(new URL('../apps/coach-mobile/src/CoachMatchDayScreen.js', import.meta.url), 'utf8'),
    readFile(new URL('../apps/coach-mobile/src/CoachQuickActions.js', import.meta.url), 'utf8'),
    readFile(new URL('../apps/parent-mobile/App.js', import.meta.url), 'utf8'),
    readFile(new URL('../apps/parent-mobile/package.json', import.meta.url), 'utf8'),
    readFile(new URL('../apps/coach-mobile/src/coachThemeCore.js', import.meta.url), 'utf8'),
    readFile(new URL('../apps/mobile-core/src/parentThemeCore.js', import.meta.url), 'utf8'),
  ])

  assert.match(coachPackage, /"@expo\/vector-icons": "15\.1\.1"/)
  assert.match(parentPackage, /"@expo\/vector-icons": "15\.1\.1"/)
  assert.match(coachApp, /@expo\/vector-icons\/MaterialIcons/)
  assert.match(parentApp, /@expo\/vector-icons\/MaterialIcons/)
  assert.match(coachApp, /getCoachRouteIconKey/)
  assert.match(parentApp, /getParentTabIconKey/)
  assert.match(quickActions, /getCoachQuickActionIconKey/)
  assert.match(matchDayScreen, /iconKey="match\.yellow-card"[\s\S]*warning/)
  assert.match(matchDayScreen, /danger[\s\S]*iconKey="match\.red-card"/)
  assert.match(parentApp, /iconKey="parent\.directions"/)
  for (const token of ['accent', 'success', 'warning', 'danger']) {
    assert.match(coachTheme, new RegExp(`\\b${token}\\b`))
    assert.match(parentTheme, new RegExp(`\\b${token}\\b`))
  }
})
