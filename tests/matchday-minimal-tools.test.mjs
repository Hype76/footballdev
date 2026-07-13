import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { test } from 'node:test'

import {
  getMatchCalendarLocation,
  getMatchLocationSummary,
  getMatchMapLocation,
  getMatchVenueDisplay,
} from '../src/lib/match-location.js'

const matchDayPageUrl = new URL('../src/pages/MatchDayPage.jsx', import.meta.url)
const matchDayTimerMigrationUrl = new URL('../supabase/migrations/20260708165903_match_day_timer_state.sql', import.meta.url)
const calendarEventsUrl = new URL('../src/lib/football-calendar-events.js', import.meta.url)
const parentPortalUrl = new URL('../src/pages/ParentPortalPage.jsx', import.meta.url)
const layoutUrl = new URL('../src/components/layout/Layout.jsx', import.meta.url)
const coachHomeUrl = new URL('../src/pages/CoachHomePage.jsx', import.meta.url)

test('venue helpers use venue for display and address for maps and calendar with venue fallback', () => {
  const match = {
    venueName: 'Main Pitch',
    venueAddress: '1 Stadium Road, Cambridge',
  }

  assert.equal(getMatchVenueDisplay(match), 'Main Pitch')
  assert.equal(getMatchMapLocation(match), '1 Stadium Road, Cambridge')
  assert.equal(getMatchCalendarLocation(match), '1 Stadium Road, Cambridge')
  assert.deepEqual(getMatchLocationSummary(match), {
    venueName: 'Main Pitch',
    mapLocation: '1 Stadium Road, Cambridge',
    calendarLocation: '1 Stadium Road, Cambridge',
    displayLabel: 'Main Pitch',
  })

  assert.equal(getMatchMapLocation({ venueName: 'Training Ground' }), 'Training Ground')
  assert.equal(getMatchCalendarLocation({ venueName: 'Training Ground' }), 'Training Ground')
})

test('Match Day active fixture toggle persists locally and never reads previous games', async () => {
  const source = await readFile(matchDayPageUrl, 'utf8')

  assert.match(source, /MATCH_DAY_ACTIVE_FIXTURE_MODE_STORAGE_KEY = 'football-player:match-day-active-fixture-mode'/)
  assert.match(source, /const displayedActiveMatches = useMemo\(/)
  assert.match(source, /activeFixtureMode === 'all' \? activeMatches : activeMatches\.slice\(0, 1\)/)
  assert.match(source, /Next game/)
  assert.match(source, /List all/)
  assert.match(source, /displayedActiveMatches\.map\(\(match\) => \(/)
  assert.doesNotMatch(source, /activeFixtureMode[\s\S]{0,220}previousMatches\.map/)
})

test('Game Mode exposes minimal live controls and keeps full management separate', async () => {
  const [source, timerMigration] = await Promise.all([
    readFile(matchDayPageUrl, 'utf8'),
    readFile(matchDayTimerMigrationUrl, 'utf8'),
  ])

  assert.match(source, /function MatchDayGameModePanel/)
  assert.match(source, /Start Game Mode/)
  for (const label of ['Goal', 'Event', 'HT', 'FT', 'Exit Game Mode']) {
    assert.match(source, new RegExp(`>${label}<`))
  }
  assert.match(source, /Assist player/)
  assert.match(source, /Assist name/)
  assert.match(source, /Assist shirt/)
  assert.match(source, /MATCH_EVENT_TYPE_OPTIONS\.map/)
  assert.match(source, /Save event/)
  assert.match(source, /Hydration/)
  assert.match(source, /onStatusChange\(match, 'full_time'\)/)
  assert.match(source, /Stop the match clock at Full Time[\s\S]*resume the same match or conclude it after post-match work/)
  assert.match(timerMigration, /'water_break'/)
  assert.match(timerMigration, /'Hydration pause'/)
  assert.match(source, /onAddGoal\(event, match\)/)
  assert.match(source, /onAddMatchEvent\(event, match\)/)
})

test('Coach Mode is a local UI preference and filters quick actions only', async () => {
  const [layout, coachHome] = await Promise.all([
    readFile(layoutUrl, 'utf8'),
    readFile(coachHomeUrl, 'utf8'),
  ])

  assert.match(layout, /COACH_MODE_STORAGE_KEY = 'football-player:coach-mode'/)
  assert.match(layout, /Add Assessment/)
  assert.match(layout, /Add Match/)
  assert.match(layout, /Game Day/)
  assert.match(layout, /href: '\/match-day'/)
  assert.match(layout, /Add Voice Note/)
  assert.match(layout, /!isCoachMode \|\| action\.coachModeVisible === true/)
  assert.match(coachHome, /Coach Mode/)
  assert.match(coachHome, /Full Mode/)
  assert.match(coachHome, /className="grid w-full grid-cols-2 gap-1/)
  assert.match(coachHome, /aria-label="Coach mode display"/)
  assert.match(coachHome, /className={`min-h-10 w-full min-w-0 rounded-md px-3 py-2 text-center/)
  assert.match(coachHome, /aria-pressed={isCoachMode === option\.value}/)
  assert.match(coachHome, /onClick={\(\) => onChange\(option\.value\)}/)
  assert.match(coachHome, /window\.localStorage\.setItem\(COACH_MODE_STORAGE_KEY, isCoachMode \? 'coach' : 'full'\)/)
  assert.doesNotMatch(`${layout}\n${coachHome}`, /roleRank\s*=/)
})

test('calendar and parent portal use address-first Match Day locations', async () => {
  const [calendarEvents, parentPortal] = await Promise.all([
    readFile(calendarEventsUrl, 'utf8'),
    readFile(parentPortalUrl, 'utf8'),
  ])

  assert.match(calendarEvents, /getMatchCalendarLocation\(match\)/)
  assert.match(calendarEvents, /getMatchVenueDisplay\(match\)/)
  assert.match(parentPortal, /getMatchCalendarLocation\(match\)/)
  assert.match(parentPortal, /getMatchVenueDisplay\(match\)/)
})
