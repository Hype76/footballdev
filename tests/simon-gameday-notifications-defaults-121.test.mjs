import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'

const read = (path) => readFile(new URL(path, import.meta.url), 'utf8')

test('selected scorers receive an app alert while email remains available', async () => {
  const source = await read('../netlify/functions/select-match-day-volunteer.js')

  assert.match(source, /sendMatchDayPushHandler/)
  assert.match(source, /selected && role === 'scorer' && !isSameSelection/)
  assert.match(source, /type: 'scorer_selected'/)
  assert.match(source, /parentLinkId: parentLink\.id/)
  assert.match(source, /scorerAlert/)
  assert.match(source, /queueRoleNotification/)
})

test('web and Coach fixture forms explain and remember Your Team notification names', async () => {
  const [matchDay, sessions, coachFixture, coachCalendar] = await Promise.all([
    read('../src/pages/MatchDayPage.jsx'),
    read('../src/pages/SessionsPage.jsx'),
    read('../apps/coach-mobile/src/CoachFixtureForm.js'),
    read('../apps/coach-mobile/src/CoachOperationalScreens.js'),
  ])

  for (const source of [matchDay, sessions, coachFixture, coachCalendar]) {
    assert.match(source, /Your Team notification name/)
    assert.match(source, /This is Your Team, not the opponent/)
    assert.match(source, /Remember this name for Your Team/)
  }
  assert.match(matchDay, /Save this vote expiry as my default/)
  assert.match(coachFixture, /Save this vote expiry as my default/)
})

test('saved vote expiry stays device local and is applied only when requested', async () => {
  const [web, coachPreferences, coachFixture] = await Promise.all([
    read('../src/pages/MatchDayPage.jsx'),
    read('../apps/coach-mobile/src/coachFixturePreferences.js'),
    read('../apps/coach-mobile/src/CoachFixtureForm.js'),
  ])

  assert.match(web, /motmPollExpiryDuration/)
  assert.match(web, /saveMotmExpiryAsDefault/)
  assert.match(coachPreferences, /motmPollExpiryDuration/)
  assert.match(coachFixture, /submittedForm\.saveMotmExpiryAsDefault/)
})

test('Parent scorer has confirmed-squad dropdowns, a working goal save path, and device-only wake control', async () => {
  const [app, screens, data, packageJson] = await Promise.all([
    read('../apps/parent-mobile/App.js'),
    read('../apps/parent-mobile/src/ParentPortalScreens.js'),
    read('../apps/parent-mobile/src/parentPortalData.js'),
    read('../apps/parent-mobile/package.json'),
  ])

  assert.match(app, /getParentPortalMatchDayPlayers/)
  assert.match(app, /players=\{matchDayPlayers\}/)
  assert.match(screens, /function GoalPlayerPicker/)
  assert.match(screens, /const confirmedPlayerNames = new Set\(selectedMatch\.confirmedTeam \|\| \[\]\)/)
  assert.match(screens, /players\.filter\(\(player\) => confirmedPlayerNames\.has\(player\.playerName\)\)/)
  assert.match(screens, /label="No assist"/)
  assert.match(screens, /openAction\('goal', 'Add goal'\)/)
  assert.match(screens, /submitAndClose\('goal', goal\)/)
  assert.match(screens, /This change was not saved\. Check your connection and try again\./)
  assert.match(data, /scorerRpc\('record_match_day_goal_v2'/)
  assert.match(screens, /activateKeepAwakeAsync\('football-player-parent-game-day'\)/)
  assert.match(screens, /deactivateKeepAwake\('football-player-parent-game-day'\)/)
  assert.match(screens, /Optional for this live controller session\. No match data is changed\./)
  assert.match(packageJson, /"expo-keep-awake"/)
})
