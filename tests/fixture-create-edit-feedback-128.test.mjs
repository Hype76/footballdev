import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'

import {
  createCoachFixtureForm,
  validateCoachFixtureForm,
} from '../apps/mobile-core/src/coachFixtureCore.js'
import {
  resolveMatchDayNotificationTeamName,
} from '../src/lib/team-notification-display.js'

const source = async (relativePath) => readFile(new URL(relativePath, import.meta.url), 'utf8')

test('a fixture notification name overrides the saved Team notification name for that fixture', () => {
  assert.equal(resolveMatchDayNotificationTeamName({
    notification_team_name: 'U14 JPL',
    teams: { name: 'Cambourne Town U14', notification_display_name: 'Cambourne U14' },
  }), 'U14 JPL')
  assert.equal(resolveMatchDayNotificationTeamName({
    teams: { name: 'Cambourne Town U14', notification_display_name: 'Cambourne U14' },
  }), 'Cambourne U14')
})

test('every fixture notification path reads the per-fixture notification name', async () => {
  const paths = await Promise.all([
    source('../netlify/functions/calendar-change-notifications.js'),
    source('../netlify/functions/lib/_calendar-notification-email.js'),
    source('../netlify/functions/send-coach-mobile-push.js'),
    source('../netlify/functions/send-match-day-push.js'),
  ])

  for (const notificationSource of paths) assert.match(notificationSource, /resolveMatchDayNotificationTeamName/)
  for (const notificationSource of paths.slice(0, 3)) assert.match(notificationSource, /notification_team_name/)
  assert.match(paths[3], /\.select\('\*, teams:team_id/)
})

test('Coach fixture defaults include a reusable arrival choice and TBC Kits', () => {
  const form = createCoachFixtureForm({
    defaultArrivalPreset: '45',
    defaultDuration: 80,
  })
  assert.equal(form.arrivalPreset, '45')
  assert.equal(form.arrivalTime, '09:15')
  assert.equal(form.saveArrivalAsDefault, false)
  assert.equal(validateCoachFixtureForm({
    ...form,
    fixtureType: 'friendly',
    matchDate: '17-08-2099',
    opponent: 'Visitors FC',
    shirtChoice: 'tbc',
  }).shirtChoice, 'tbc')

  const squadCalendarForm = {
    ...form,
    fixtureType: 'friendly',
    matchDate: '17-08-2099',
    opponent: 'Visitors FC',
    parentAudience: 'involved_players',
    parentVisible: true,
    selectedPlayerIds: [],
  }
  assert.throws(() => validateCoachFixtureForm(squadCalendarForm), /Choose at least one Player/)
  assert.equal(validateCoachFixtureForm(squadCalendarForm, { requireSelectedPlayers: false }).parentVisible, true)
})

test('web and app fixture creation expose recipient, Coach-calendar, and squad-calendar actions', async () => {
  const [web, coachForm, coachData] = await Promise.all([
    source('../src/pages/MatchDayPage.jsx'),
    source('../apps/coach-mobile/src/CoachFixtureForm.js'),
    source('../apps/mobile-core/src/coachMatchDayData.js'),
  ])
  for (const label of ['Squad only', 'Save this arrival as my default', 'Delete saved address']) {
    assert.match(web, new RegExp(label))
    assert.match(coachForm, new RegExp(label))
  }
  for (const label of ['Add to Coach calendars', 'Add to squad calendars']) {
    assert.match(web, new RegExp(label))
    assert.match(coachForm, new RegExp(label))
  }
  assert.match(web, /calendarTarget/)
  assert.match(web, /syncCalendarEventParentScope/)
  assert.match(web, /playerIds: squadCalendarPlayerIds/)
  assert.match(web, /selectionMode: 'manual'/)
  assert.match(web, /No availability requests or notifications were sent/)
  assert.match(coachData, /calendarTarget/)
  assert.match(coachData, /sync_calendar_event_parent_scope_v2/)
  assert.match(coachData, /fixture\.parentVisible && !normalizedCalendarTarget/)
})

test('web fixture defaults persist as soon as the fixture save succeeds', async () => {
  const web = await source('../src/pages/MatchDayPage.jsx')
  const createStart = web.indexOf('const createdMatch = await createMatchDay')
  const preferenceWrite = web.indexOf('writeMatchDayFixturePreferences(submittedForm)', createStart)
  const availabilitySend = web.indexOf("fetch('/.netlify/functions/send-match-day-availability-requests'", createStart)

  assert.notEqual(createStart, -1)
  assert.ok(preferenceWrite > createStart)
  assert.ok(availabilitySend > preferenceWrite)
  assert.match(web, /const updatedTeam = await updateTeamNotificationDisplayName\([\s\S]*setTeams\(\(currentTeams\)/)
})

test('Calendar editing refreshes the remembered Team notification name immediately', async () => {
  const sessions = await source('../src/pages/SessionsPage.jsx')

  assert.match(sessions, /if \(safeTeamId && calendarForm\.rememberNotificationTeamName\) \{[\s\S]*const updatedTeam = await updateTeamNotificationDisplayName/)
  assert.match(sessions, /setTeams\(\(currentTeams\) => currentTeams\.map/)
})

test('fixture duration, conclusion rule, Kits, and saved locations are editable on web and Coach mobile', async () => {
  const [sessions, coachScreen, coachData, migration] = await Promise.all([
    source('../src/pages/SessionsPage.jsx'),
    source('../apps/coach-mobile/src/CoachMatchDayScreen.js'),
    source('../apps/mobile-core/src/coachMatchDayData.js'),
    source('../supabase/migrations/20260901073002_fixture_edit_defaults_and_saved_locations.sql'),
  ])
  assert.match(sessions, /name="matchDurationMinutes"/)
  assert.match(sessions, /name="conclusionRule"/)
  assert.match(sessions, /name="shirtChoice"/)
  assert.match(sessions, /notificationTeamName/)
  assert.match(coachScreen, /label="Edit fixture"/)
  assert.match(coachData, /updateCoachMatchDayFixture/)
  assert.match(coachData, /rpc\('update_match_day_fixture_for_team'/)
  assert.doesNotMatch(coachData, /\.from\('match_days'\)\.update/)
  assert.match(coachData, /archiveCoachMatchLocation/)
  assert.match(migration, /check \(shirt_choice in \('home', 'away', 'tbc'\)\)/)
  assert.match(migration, /notification_team_name/)
  assert.match(migration, /archive_match_location_for_team/)
  assert.match(migration, /update_match_day_fixture_for_team/)
  assert.match(migration, /app_private\.actor_can_manage_team_resource/)
  assert.match(migration, /revoke all on function public\.archive_match_location_for_team/)
})
