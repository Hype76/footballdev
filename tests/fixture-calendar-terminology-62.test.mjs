import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'

import {
  londonLocalToUtcIso,
} from '../apps/mobile-core/src/coachCalendarCore.js'
import {
  createCoachFixtureForm,
  getCoachMatchLocationOptions,
  validateCoachFixtureForm,
} from '../apps/mobile-core/src/coachFixtureCore.js'

const source = async (relativePath) => readFile(new URL(relativePath, import.meta.url), 'utf8')

test('ordinary London dates convert without false clock-change errors', () => {
  assert.equal(londonLocalToUtcIso('17-08-2026', '18:00'), '2026-08-17T17:00:00.000Z')
  assert.equal(londonLocalToUtcIso('17-01-2027', '18:00'), '2027-01-17T18:00:00.000Z')
  assert.throws(() => londonLocalToUtcIso('29-03-2026', '01:30'), /clocks change/)
})

test('mobile match creation starts with deliberate volunteer and poll choices', () => {
  const form = createCoachFixtureForm()
  assert.equal(form.requestScorer, false)
  assert.equal(form.requestLinesman, false)
  assert.equal(form.requestReferee, false)
  assert.equal(form.enableMotmPoll, false)
  assert.equal(form.matchDurationMinutes, 90)
  assert.equal(form.saveDurationAsDefault, false)
  assert.equal(Object.hasOwn(form, 'recurrenceFrequency'), false)
})

test('mobile match creation validates the canonical fixture contract', () => {
  const fixture = validateCoachFixtureForm({
    ...createCoachFixtureForm(),
    fixtureType: 'league',
    matchDate: '17-08-2099',
    opponent: 'Visitors FC',
    venueAddress: '1 Football Road',
    venueName: 'Home Ground',
  })
  assert.equal(fixture.opponent, 'Visitors FC')
  assert.equal(fixture.fixtureType, 'league')
  assert.equal(fixture.matchDate, '2099-08-17')
  assert.equal(fixture.kickoffTime, '10:00')
  assert.equal(fixture.arrivalTime, '09:30')
  assert.equal(fixture.homeAway, 'home')
  assert.equal(fixture.clockMode, 'fixed')
  assert.equal(fixture.matchDurationMinutes, 90)
  assert.equal(fixture.requestScorer, false)
  assert.equal(fixture.enableMotmPoll, false)
})

test('saved match locations are recent first, editable, and de-duplicated', () => {
  const locations = getCoachMatchLocationOptions([
    { updatedAt: '2026-08-16T10:00:00Z', venueAddress: 'Old Road', venueName: 'Ground A' },
    { updatedAt: '2026-08-17T10:00:00Z', venueAddress: 'New Road', venueName: 'Ground B' },
    { updatedAt: '2026-08-15T10:00:00Z', venueAddress: 'New Road', venueName: 'Ground B' },
  ])
  assert.deepEqual(locations.map((item) => item.label), ['Ground B | New Road', 'Ground A | Old Road'])
})

test('Coach mobile exposes native pickers and the full Match Day fixture form', async () => {
  const [fixtureForm, picker, appConfig, quickActions, operational, matchData, appPackage] = await Promise.all([
    source('../apps/coach-mobile/src/CoachFixtureForm.js'),
    source('../apps/coach-mobile/src/CoachDateTimeField.js'),
    source('../apps/coach-mobile/app.config.js'),
    source('../apps/coach-mobile/src/coachQuickActionsCore.js'),
    source('../apps/coach-mobile/src/CoachOperationalScreens.js'),
    source('../apps/mobile-core/src/coachMatchDayData.js'),
    source('../apps/coach-mobile/package.json'),
  ])
  assert.match(appPackage, /@react-native-community\/datetimepicker/)
  assert.match(appConfig, /@react-native-community\/datetimepicker/)
  assert.match(picker, /DateTimePicker/)
  for (const label of ['Opponent', 'Fixture type', 'How this match can finish', 'Home or away', '>Clock<', 'Match duration', 'Request scorer', 'Request linesman', 'Request referee', 'Create Player of the Match poll at full time']) {
    assert.match(fixtureForm, new RegExp(label))
  }
  assert.doesNotMatch(fixtureForm, /Repeat/)
  assert.match(quickActions, /id: 'add-match'[\s\S]*route: 'matchday'/)
  assert.match(operational, /context\.role === 'admin'[\s\S]*Club parents/)
  assert.match(matchData, /match_duration_minutes/)
  assert.match(matchData, /kickoff_time_tbc/)
  assert.match(matchData, /request_scorer/)
  assert.match(matchData, /enable_motm_poll/)
})

test('web Match Day preserves safe defaults and explicit duration preference', async () => {
  const matchDay = await source('../src/pages/MatchDayPage.jsx')
  assert.match(matchDay, /requestScorer: false/)
  assert.match(matchDay, /enableMotmPoll: false/)
  assert.match(matchDay, /saveDurationAsDefault: false/)
  assert.match(matchDay, /Save this duration as my default/)
  assert.match(matchDay, /Choose saved location/)
})

test('terminology changes visible wording without changing machine contracts', async () => {
  const [sidebar, coachChat, routes, inviteFunction] = await Promise.all([
    source('../src/components/layout/Sidebar.jsx'),
    source('../src/pages/StaffChatPage.jsx'),
    source('../src/app/router.jsx'),
    source('../netlify/functions/get-staff-invite.js'),
  ])
  assert.doesNotMatch(sidebar, />Staff</)
  assert.doesNotMatch(coachChat, /Staff Chat/)
  assert.match(routes, /staff-chat/)
  assert.match(routes, /parent-chat-staff/)
  assert.match(inviteFunction, /club_user_invites/)
})

test('release identity authorises both internal app candidates', async () => {
  const [buildGuard, submitGuard, coachPackage, parentPackage] = await Promise.all([
    source('../apps/scripts/mobile-build-guard.mjs'),
    source('../apps/scripts/mobile-submit-guard.mjs'),
    source('../apps/coach-mobile/package.json'),
    source('../apps/parent-mobile/package.json'),
  ])
  assert.match(buildGuard, /authorisedParentProductionReferences[\s\S]*FP-MOBILE-COACH-FIXTURE-CREATE-CRASH-63/)
  assert.match(buildGuard, /authorisedCoachProductionReferences[\s\S]*FP-MOBILE-COACH-FIXTURE-CREATE-CRASH-63/)
  assert.match(submitGuard, /promotionReference === 'FP-MOBILE-COACH-FIXTURE-CREATE-CRASH-63'/)
  assert.equal(JSON.parse(coachPackage).version, '1.0.19')
  assert.equal(JSON.parse(parentPackage).version, '1.0.16')
})
