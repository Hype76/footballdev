import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { test } from 'node:test'

import {
  addMinutesToRequiredTime,
  buildRequiredLocalDateTime,
  formatFixtureDateTime,
  getFixtureKickoffLabel,
  getFixtureStartDateTime,
  normalizeRequiredDate,
  normalizeRequiredTime,
  validateFixtureDateTime,
  validateOrdinaryEventDateTime,
} from '../src/lib/calendar-datetime-integrity.js'
import { buildFootballCalendarEvents } from '../src/lib/football-calendar-events.js'
import {
  consumeFixtureSetupIntent,
  openMatchDayFixtureSetup,
} from '../src/lib/matchday-workflow.js'

const calendarPageSource = readFileSync(new URL('../src/pages/SessionsPage.jsx', import.meta.url), 'utf8')
const matchDayPageSource = readFileSync(new URL('../src/pages/MatchDayPage.jsx', import.meta.url), 'utf8')
const matchDayDomainSource = readFileSync(new URL('../src/lib/domain/match-day.js', import.meta.url), 'utf8')
const parentPortalSource = readFileSync(new URL('../src/pages/ParentPortalPage.jsx', import.meta.url), 'utf8')
const availabilityConfirmSource = readFileSync(new URL('../netlify/functions/match-day-availability-confirm.js', import.meta.url), 'utf8')
const availabilitySendSource = readFileSync(new URL('../netlify/functions/send-match-day-availability-requests.js', import.meta.url), 'utf8')
const migrationSource = readFileSync(new URL('../supabase/migrations/20260713171403_match_time_tbc_datetime_integrity.sql', import.meta.url), 'utf8')

function assertErrorMessage(callback, message) {
  assert.throws(callback, (error) => error instanceof Error && error.message === message)
}

function createWindowStub() {
  const values = new Map()

  return {
    dispatchEvent() {},
    sessionStorage: {
      getItem(key) {
        return values.get(key) ?? null
      },
      removeItem(key) {
        values.delete(key)
      },
      setItem(key, value) {
        values.set(key, String(value))
      },
    },
  }
}

test('ordinary event creation defaults date start and end to blank', () => {
  const defaultFormStart = calendarPageSource.indexOf('function getDefaultCalendarForm')
  const defaultFormEnd = calendarPageSource.indexOf('\nfunction ', defaultFormStart + 1)
  const defaultFormSource = calendarPageSource.slice(defaultFormStart, defaultFormEnd)

  assert.match(defaultFormSource, /function getDefaultCalendarForm\(date = ''\)/)
  assert.match(defaultFormSource, /date: eventDate,/)
  assert.match(defaultFormSource, /startTime: '',/)
  assert.match(defaultFormSource, /endTime: '',/)
  assert.doesNotMatch(defaultFormSource, /09:00|10:00/)
})

test('generic Add Event opens without an implicit calendar date', () => {
  assert.match(calendarPageSource, /onClick=\{\(\) => handleOpenCalendarCreate\(\)\}/)
})

test('an explicitly supplied calendar date remains available to the create form', () => {
  assert.match(calendarPageSource, /const handleOpenCalendarCreate = \(date = '', requestedEventType = ''\) => \{/)
  assert.match(calendarPageSource, /const defaultForm = getDefaultCalendarForm\(date\)/)
})

test('required date and time normalizers reject impossible or partial values', () => {
  assert.equal(normalizeRequiredDate('2026-02-29'), '')
  assert.equal(normalizeRequiredDate('2026-07-13'), '2026-07-13')
  assert.equal(normalizeRequiredTime('9:30'), '')
  assert.equal(normalizeRequiredTime('24:00'), '')
  assert.equal(normalizeRequiredTime('09:30:00'), '09:30')
})

test('ordinary events reject a blank date', () => {
  assertErrorMessage(
    () => validateOrdinaryEventDateTime({ date: '', startTime: '09:00', endTime: '10:00' }),
    'Enter an event date.',
  )
})

test('ordinary events reject a blank start time', () => {
  assertErrorMessage(
    () => validateOrdinaryEventDateTime({ date: '2026-07-14', startTime: '', endTime: '10:00' }),
    'Enter a start time.',
  )
})

test('ordinary events reject a blank end time', () => {
  assertErrorMessage(
    () => validateOrdinaryEventDateTime({ date: '2026-07-14', startTime: '09:00', endTime: '' }),
    'Enter an end time.',
  )
})

test('ordinary events require end time to be after start time', () => {
  assertErrorMessage(
    () => validateOrdinaryEventDateTime({ date: '2026-07-14', startTime: '10:00', endTime: '09:00' }),
    'End time must be after start time.',
  )
})

test('ordinary event timestamps are built only from valid explicit values', () => {
  assert.equal(buildRequiredLocalDateTime('2026-07-14', '09:30'), '2026-07-14T09:30:00')
  assert.equal(buildRequiredLocalDateTime('2026-07-14', ''), '')
  assert.equal(addMinutesToRequiredTime('', 120), '')
  assert.equal(addMinutesToRequiredTime('23:30', 60), '00:30')
})

test('calendar modal makes all three ordinary event date-time inputs required', () => {
  assert.match(calendarPageSource, /<input name="date" type="date"[\s\S]*required className=\{fieldClass\}/)
  assert.match(calendarPageSource, /<input name="startTime" type="time"[\s\S]*required=\{!isMatchFixture \|\| !form\.kickoffTimeTbc\}/)
  assert.match(calendarPageSource, /<input name="endTime" type="time"[\s\S]*required className=\{fieldClass\}/)
})

test('calendar close resets the create form to blank values', () => {
  assert.match(calendarPageSource, /setCalendarForm\(getDefaultCalendarForm\(\)\)/)
  assert.match(calendarPageSource, /setCalendarModal\(null\)/)
})

test('confirmed fixture time requires a real match date and kickoff', () => {
  assertErrorMessage(
    () => validateFixtureDateTime({ matchDate: '', kickoffTime: '11:00', kickoffTimeTbc: false }),
    'Enter a match date.',
  )
  assertErrorMessage(
    () => validateFixtureDateTime({ matchDate: '2026-07-18', kickoffTime: '', kickoffTimeTbc: false }),
    'Enter a kickoff time or choose Time TBC.',
  )
})

test('explicit Time TBC preserves date and clears the kickoff value', () => {
  assert.deepEqual(validateFixtureDateTime({
    matchDate: '2026-07-18',
    kickoffTime: '11:00',
    kickoffTimeTbc: true,
  }), {
    matchDate: '2026-07-18',
    kickoffTime: '',
    kickoffTimeTbc: true,
  })
})

test('Time TBC still requires a valid match date', () => {
  assertErrorMessage(
    () => validateFixtureDateTime({ matchDate: '', kickoffTime: '', kickoffTimeTbc: true }),
    'Enter a match date.',
  )
})

test('fixture labels never manufacture midnight for Time TBC', () => {
  const fixture = { matchDate: '2026-07-18', kickoffTime: '', kickoffTimeTbc: true }

  assert.equal(getFixtureKickoffLabel(fixture), 'TBC')
  assert.equal(getFixtureKickoffLabel(fixture, { long: true }), 'Time TBC')
  assert.equal(getFixtureStartDateTime(fixture), '')
  assert.match(formatFixtureDateTime(fixture), /Time TBC/)
})

test('fixture workflow carries explicit Time TBC without stale arrival or kickoff', () => {
  const windowRef = createWindowStub()

  openMatchDayFixtureSetup({
    arrivalTime: '10:15',
    kickoffTime: '11:00',
    kickoffTimeTbc: true,
    matchDate: '2026-07-18',
  }, { navigate() {}, windowRef })

  assert.deepEqual(consumeFixtureSetupIntent({ windowRef }), {
    arrivalTime: '',
    clockMode: 'fixed',
    homeAway: 'home',
    kickoffTime: '',
    kickoffTimeTbc: true,
    matchDate: '2026-07-18',
    matchDurationMinutes: 90,
    notes: '',
    opponent: '',
    parentAudience: 'none',
    parentVisible: false,
    teamId: '',
    venueAddress: '',
    venueName: '',
  })
})

test('staff football calendar exposes Time TBC and protects active timing edits', () => {
  const scheduled = buildFootballCalendarEvents({
    matchDays: [{ id: 'match-1', matchDate: '2026-07-18', kickoffTimeTbc: true, opponent: 'Rovers', status: 'scheduled' }],
  }).find((event) => event.id === 'match:match-1')
  const live = buildFootballCalendarEvents({
    matchDays: [{ id: 'match-2', matchDate: '2026-07-18', kickoffTimeTbc: true, opponent: 'City', status: 'live' }],
  }).find((event) => event.id === 'match:match-2')

  assert.equal(scheduled.time, 'TBC')
  assert.match(scheduled.description, /Kick off TBC/)
  assert.equal(scheduled.editable, true)
  assert.equal(live.editable, false)
})

test('domain create and update payloads persist both timing states safely', () => {
  assert.match(matchDayDomainSource, /kickoff_time_tbc: fixtureDateTime\.kickoffTimeTbc/)
  assert.match(matchDayDomainSource, /arrival_time: fixtureDateTime\.kickoffTimeTbc \? null/)
  assert.match(matchDayDomainSource, /payload\.kickoff_time_tbc = nextFixtureDateTime\.kickoffTimeTbc/)
  assert.match(matchDayDomainSource, /payload\.kickoff_time = nextFixtureDateTime\.kickoffTime \|\| null/)
  assert.match(matchDayDomainSource, /payload\.arrival_time = null/)
  assert.match(matchDayDomainSource, /MATCH_DAY_FIXTURE_TIMING_EDITABLE_STATUSES/)
})

test('fixture edits support deterministic TBC to confirmed and confirmed to TBC transitions', () => {
  assert.deepEqual(validateFixtureDateTime({
    matchDate: '2026-07-18',
    kickoffTime: '11:30',
    kickoffTimeTbc: false,
  }), {
    matchDate: '2026-07-18',
    kickoffTime: '11:30',
    kickoffTimeTbc: false,
  })
  assert.deepEqual(validateFixtureDateTime({
    matchDate: '2026-07-18',
    kickoffTime: '11:30',
    kickoffTimeTbc: true,
  }), {
    matchDate: '2026-07-18',
    kickoffTime: '',
    kickoffTimeTbc: true,
  })
})

test('existing confirmed fixture values remain confirmed by default', () => {
  assert.equal(getFixtureKickoffLabel({ matchDate: '2026-07-18', kickoffTime: '11:30' }), '11:30')
  assert.equal(getFixtureStartDateTime({ matchDate: '2026-07-18', kickoffTime: '11:30' }), '2026-07-18T11:30:00')
})

test('staff fixture setup exposes confirmed and Time TBC choices accessibly', () => {
  assert.match(matchDayPageSource, /aria-describedby="matchday-kickoff-time-help"/)
  assert.match(matchDayPageSource, /<option value="confirmed">Confirmed time<\/option>/)
  assert.match(matchDayPageSource, /<option value="tbc">Time TBC<\/option>/)
  assert.match(matchDayPageSource, /required=\{!form\.kickoffTimeTbc\} disabled=\{form\.kickoffTimeTbc\}/)
})

test('calendar modal is constrained and scrollable on desktop and mobile', () => {
  assert.match(calendarPageSource, /role="dialog"[\s\S]*aria-modal="true"[\s\S]*aria-labelledby="calendar-event-modal-title"/)
  assert.match(calendarPageSource, /max-h-\[calc\(100dvh-1\.5rem\)\][\s\S]*max-w-3xl[\s\S]*overflow-hidden/)
  assert.match(calendarPageSource, /min-h-0 flex-1 overflow-y-auto overscroll-contain scroll-pb-32/)
})

test('fixture setup modal remains constrained and scrollable on desktop and mobile', () => {
  assert.match(matchDayPageSource, /role="dialog"[\s\S]*aria-modal="true"[\s\S]*aria-labelledby="fixture-setup-title"/)
  assert.match(matchDayPageSource, /max-h-full w-full max-w-5xl flex-col overflow-hidden/)
  assert.match(matchDayPageSource, /min-h-0 flex-1 overflow-y-auto overscroll-contain/)
})

test('parent portal uses date-only Time TBC display and calendar export handling', () => {
  assert.match(parentPortalSource, /kickoffTimeTbc \? 'Kick-off: Time TBC'/)
  assert.match(parentPortalSource, /startsAt: kickoffTimeTbc \? ''/)
  assert.match(parentPortalSource, /endsAt: kickoffTimeTbc \? ''/)
  assert.match(parentPortalSource, /const startLabel = kickoffTimeTbc \? 'TBC'/)
  assert.doesNotMatch(parentPortalSource, /kickoffTime \|\| '00:00'/)
})

test('confirmed-time parent calendar exports retain their exact times', () => {
  assert.match(parentPortalSource, /const startTime = kickoffTimeTbc \? '' : toTimeOnly\(data\.arrivalTime \|\| data\.kickoffTime \|\| event\.time\)/)
  assert.match(parentPortalSource, /const endTime = kickoffTimeTbc \? '' : toTimeOnly\(data\.kickoffTime\)/)
})

test('availability response and invite emails expose Time TBC without fake arrival', () => {
  assert.match(availabilityConfirmSource, /kickoffTimeTbc \? 'Kick-off: Time TBC'/)
  assert.match(availabilityConfirmSource, /kickoffTimeTbc \? 'Available when kickoff is confirmed'/)
  assert.match(availabilitySendSource, /kickoffTimeTbc \? 'Time TBC'/)
  assert.match(availabilitySendSource, /kickoffTimeTbc \? 'Available when kickoff is confirmed'/)
})

test('database model defaults existing fixtures to confirmed time without inferred backfill', () => {
  assert.match(migrationSource, /kickoff_time_tbc boolean not null default false/)
  assert.doesNotMatch(migrationSource, /update\s+public\.match_days/i)
  assert.doesNotMatch(migrationSource, /kickoff_time\s*=\s*time\s+'00:00'/i)
})

test('database constraint rejects Time TBC with a stored kickoff or arrival', () => {
  assert.match(migrationSource, /match_days_kickoff_time_tbc_integrity_check/)
  assert.match(migrationSource, /kickoff_time_tbc is false[\s\S]*match_date is not null[\s\S]*kickoff_time is null[\s\S]*arrival_time is null/)
})

test('parent and token read models expose Time TBC with narrow execute grants', () => {
  assert.match(migrationSource, /get_parent_portal_match_days\(parent_link_id_value uuid\)[\s\S]*kickoff_time_tbc boolean/)
  assert.match(migrationSource, /get_parent_portal_invitation_state\(parent_link_id_value uuid\)[\s\S]*event_date date,[\s\S]*kickoff_time_tbc boolean/)
  assert.match(migrationSource, /get_match_day_availability_response_v2\(token_hash_value text\)[\s\S]*kickoff_time_tbc boolean/)
  assert.match(migrationSource, /revoke execute on function public\.get_parent_portal_match_days\(uuid\) from anon;/)
  assert.match(migrationSource, /grant execute on function public\.get_parent_portal_match_days\(uuid\) to authenticated, service_role;/)
})

test('Time TBC transition does not queue or send new fixture notifications', () => {
  const updateStart = matchDayDomainSource.indexOf('export async function updateMatchDay')
  const updateEnd = matchDayDomainSource.indexOf('\nexport async function ', updateStart + 1)
  const updateSource = matchDayDomainSource.slice(updateStart, updateEnd)

  assert.doesNotMatch(updateSource, /scheduled_email_queue|send-match-day|sendMatchDay|notification/i)
})

test('no TBC helper uses midnight as a fallback', () => {
  const helperSource = readFileSync(new URL('../src/lib/calendar-datetime-integrity.js', import.meta.url), 'utf8')

  assert.doesNotMatch(helperSource, /(?:\|\||\?\?)\s*['"](?:00:00|12:00)['"]/)
})
