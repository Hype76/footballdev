import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'
import { getNewlyEnabledCalendarVolunteerRoles } from '../src/lib/calendar-volunteer-invites.js'
import {
  assertValidPitchType,
  getPitchTypeLabel,
  PITCH_TYPE_OPTIONS,
} from '../src/lib/pitch-type.js'

const sessionsPageUrl = new URL('../src/pages/SessionsPage.jsx', import.meta.url)
const matchDayPageUrl = new URL('../src/pages/MatchDayPage.jsx', import.meta.url)
const calendarDomainUrl = new URL('../src/lib/domain/calendar-events.js', import.meta.url)
const matchDayDomainUrl = new URL('../src/lib/domain/match-day.js', import.meta.url)
const workflowUrl = new URL('../src/lib/matchday-workflow.js', import.meta.url)

test('pitch type options use the requested dropdown values and labels', () => {
  assert.deepEqual(PITCH_TYPE_OPTIONS, [
    { value: 'grass', label: 'Grass' },
    { value: '3g', label: '3G' },
    { value: '4g', label: '4G' },
    { value: 'indoor', label: 'Indoor' },
    { value: 'other', label: 'Other' },
  ])
  assert.equal(assertValidPitchType(' 3G '), '3g')
  assert.equal(getPitchTypeLabel('4g'), '4G')
  assert.throws(() => assertValidPitchType('sand'), /valid pitch type/i)
})

test('only volunteer roles changed from disabled to enabled are selected for automatic invitations', () => {
  const event = {
    sourceType: 'match-day',
    data: {
      requestScorer: false,
      requestLinesman: true,
      requestReferee: false,
    },
  }

  assert.deepEqual(getNewlyEnabledCalendarVolunteerRoles({
    event,
    form: {
      requestScorer: true,
      requestLinesman: true,
      requestReferee: true,
    },
  }), ['scorer', 'referee'])
  assert.deepEqual(getNewlyEnabledCalendarVolunteerRoles({
    event,
    form: {
      requestScorer: false,
      requestLinesman: false,
      requestReferee: false,
    },
  }), [])
  assert.deepEqual(getNewlyEnabledCalendarVolunteerRoles({
    event: { ...event, sourceType: 'calendar' },
    form: { requestScorer: true },
  }), [])
})

test('calendar and Match Day flows persist and display pitch type', async () => {
  const [sessionsPage, matchDayPage, calendarDomain, matchDayDomain, workflow] = await Promise.all([
    readFile(sessionsPageUrl, 'utf8'),
    readFile(matchDayPageUrl, 'utf8'),
    readFile(calendarDomainUrl, 'utf8'),
    readFile(matchDayDomainUrl, 'utf8'),
    readFile(workflowUrl, 'utf8'),
  ])

  assert.match(sessionsPage, /<select name="pitchType"/)
  assert.match(sessionsPage, /Pitch type[\s\S]*getPitchTypeLabel\(form\.pitchType\)/)
  assert.match(sessionsPage, /pitchType: calendarForm\.pitchType/)
  assert.match(matchDayPage, /<select value=\{form\.pitchType\}/)
  assert.match(matchDayPage, /DetailItem label="Pitch type"/)
  assert.match(calendarDomain, /pitch_type: assertValidPitchType\(event\?\.pitchType\)/)
  assert.match(matchDayDomain, /pitch_type: assertValidPitchType\(match\?\.pitchType\)/)
  assert.match(matchDayDomain, /payload\.pitch_type = assertValidPitchType\(updates\.pitchType\)/)
  assert.match(workflow, /pitchType: assertValidPitchType\(intent\.pitchType\)/)
})

test('calendar edit automatically uses the existing notification service for newly enabled roles', async () => {
  const sessionsPage = await readFile(sessionsPageUrl, 'utf8')

  assert.match(sessionsPage, /getNewlyEnabledCalendarVolunteerRoles\(\{[\s\S]*event: activeEvent,[\s\S]*form: calendarForm/)
  assert.match(sessionsPage, /\|\| shouldNotifyNewlyEnabledVolunteerRoles/)
  assert.match(sessionsPage, /requestToken: notificationRequestToken/)
  assert.match(sessionsPage, /notifyCalendarEventParents\(\{/)
  assert.match(sessionsPage, /Share this fixture with parents and choose an audience/)
  assert.match(sessionsPage, /Saving a newly enabled role sends the normal parent invitations automatically/)
})
