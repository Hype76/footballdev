import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { test } from 'node:test'

import {
  consumeFixtureSetupIntent,
  FIXTURE_SETUP_EVENT,
  openMatchDayFixtureSetup,
} from '../src/lib/matchday-workflow.js'
import {
  getTodayMatchDayDateValue,
  isPastMatchDayDate,
} from '../src/lib/domain/match-day.js'

const eventRequestsMigrationUrl = new URL('../supabase/migrations/20260630100000_v1_team_season_reports_and_event_requests.sql', import.meta.url)

function createWindowStub() {
  const values = new Map()
  const dispatchedEvents = []

  return {
    dispatchedEvents,
    dispatchEvent(event) {
      dispatchedEvents.push(event.type)
    },
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

test('calendar fixture setup opens the real Match Day workflow with a safe intent', () => {
  const windowRef = createWindowStub()
  const navigations = []

  openMatchDayFixtureSetup({
    kickoffTime: '10:30',
    matchDate: '2026-06-21',
    opponent: 'Riverside Juniors',
    parentAudience: 'involved_players',
    parentVisible: true,
    teamId: 'team-1',
    venueName: 'Main Pitch',
  }, {
    navigate: (url) => navigations.push(url),
    windowRef,
  })

  assert.deepEqual(navigations, ['/match-day'])

  const setupIntent = consumeFixtureSetupIntent({ windowRef })
  assert.equal(setupIntent.matchDate, '2026-06-21')
  assert.equal(setupIntent.opponent, 'Riverside Juniors')
  assert.equal(setupIntent.parentAudience, 'involved_players')
  assert.equal(setupIntent.parentVisible, true)
  assert.equal(consumeFixtureSetupIntent({ windowRef }), null)
})

test('fixture setup dispatches locally when no router navigate function is supplied', () => {
  const windowRef = createWindowStub()

  openMatchDayFixtureSetup({ opponent: 'Riverside Juniors' }, { windowRef })

  assert.deepEqual(windowRef.dispatchedEvents, [FIXTURE_SETUP_EVENT])
})

test('calendar match type selection routes to Match Day instead of generic save', () => {
  const source = readFileSync(
    new URL('../src/pages/SessionsPage.jsx', import.meta.url),
    'utf8',
  )

  assert.match(source, /openCalendarMatchDayWorkflow/)
  assert.match(source, /name === 'eventType' && value === 'match' && calendarModal\?\.mode === 'create'/)
  assert.match(source, /openMatchDayFixtureSetup\(/)
  assert.match(source, /setCalendarModal\(null\)/)
})

test('match day calendar item edit opens Match Day workflow', () => {
  const source = readFileSync(
    new URL('../src/pages/SessionsPage.jsx', import.meta.url),
    'utf8',
  )

  assert.match(source, /currentEvent\?\.sourceType === 'match-day'/)
  assert.match(source, /navigate\(currentEvent\.href \|\| '\/match-day'\)/)
})

test('manual review Match Day migration removes missing player team assignment dependency', () => {
  const migration = readFileSync(
    new URL('../supabase/migrations/20260616153314_repair_manual_review_eval_matchday.sql', import.meta.url),
    'utf8',
  )

  assert.match(migration, /create or replace function public\.create_match_day_motm_poll/)
  assert.match(migration, /player\.team_id = match_row\.team_id/)
  assert.doesNotMatch(migration, /player_team_assignments/)
  assert.doesNotMatch(migration, /create table.*player_team_assignments/is)
})

test('match day date helper blocks past dates and allows today', () => {
  const now = new Date('2026-06-16T12:00:00Z')

  assert.equal(getTodayMatchDayDateValue(now), '2026-06-16')
  assert.equal(isPastMatchDayDate('2026-06-15', now), true)
  assert.equal(isPastMatchDayDate('2026-06-16', now), false)
  assert.equal(isPastMatchDayDate('2026-06-17', now), false)
})

test('fixture setup Continue validates visibly and advances to squad selection', () => {
  const source = readFileSync(
    new URL('../src/pages/MatchDayPage.jsx', import.meta.url),
    'utf8',
  )
  const handlerStart = source.indexOf('const handleCreateMatch = async (event) => {')
  const handlerEnd = source.indexOf('const handleConfirmCreateMatch = async () => {', handlerStart)
  assert.notEqual(handlerStart, -1)
  assert.notEqual(handlerEnd, -1)
  const handlerSource = source.slice(handlerStart, handlerEnd)

  assert.match(handlerSource, /blurActiveFixtureControl\(\)/)
  assert.match(handlerSource, /getFixtureSetupValidationMessage\(\{ availablePlayerIds, form \}\)/)
  assert.match(handlerSource, /setErrorMessage\(validationMessage\)/)
  assert.match(handlerSource, /setSquadSelection\(\{/)
  assert.match(source, /Add an opponent before continuing to squad selection\./)
  assert.match(source, /onSubmit=\{handleCreateMatch\} noValidate/)
  assert.match(source, /isFixtureDataLoading \? 'Loading squad\.\.\.' : 'Continue to squad'/)
  assert.match(source, /role="alert"/)
  assert.doesNotMatch(handlerSource, /if \(!form\.parentVisible\)[\s\S]*await createMatchDay/)
})

test('match day fixture setup saves parent volunteer request roles', () => {
  const pageSource = readFileSync(
    new URL('../src/pages/MatchDayPage.jsx', import.meta.url),
    'utf8',
  )
  const domainSource = readFileSync(
    new URL('../src/lib/domain/match-day.js', import.meta.url),
    'utf8',
  )
  const migration = readFileSync(eventRequestsMigrationUrl, 'utf8')
  const parentPortalSource = readFileSync(
    new URL('../src/pages/ParentPortalPage.jsx', import.meta.url),
    'utf8',
  )

  assert.match(pageSource, /requestScorer: true/)
  assert.match(pageSource, /requestLinesman: false/)
  assert.match(pageSource, /requestReferee: false/)
  assert.match(pageSource, /Request scorer/)
  assert.match(pageSource, /Request linesman/)
  assert.match(pageSource, /Request referee/)
  assert.match(domainSource, /request_scorer: requestScorer/)
  assert.match(domainSource, /request_linesman: requestLinesman/)
  assert.match(domainSource, /request_referee: requestReferee/)
  assert.match(domainSource, /requestScorer: normalizeBoolean\(row\.request_scorer/)
  assert.match(parentPortalSource, /getMatchVolunteerRequestLabels/)
  assert.match(parentPortalSource, /match\.requestLinesman === true \? 'Linesman'/)
  assert.match(parentPortalSource, /match\.requestReferee === true \? 'Referee'/)
  assert.match(parentPortalSource, /\{label\} requested/)
  assert.match(migration, /add column if not exists request_scorer boolean not null default false/i)
  assert.match(migration, /add column if not exists request_linesman boolean not null default false/i)
  assert.match(migration, /add column if not exists request_referee boolean not null default false/i)
  assert.match(migration, /drop function if exists public\.get_parent_portal_match_days\(uuid\);[\s\S]*create function public\.get_parent_portal_match_days/i)
  assert.doesNotMatch(migration, /drop function[^;]+cascade/i)
  assert.match(migration, /request_linesman boolean/i)
  assert.match(migration, /match_day\.request_referee/i)
})
