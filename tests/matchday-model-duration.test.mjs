import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { test } from 'node:test'

import { getMatchDayDisplayParts } from '../src/lib/matchday-display.js'
import {
  assertNewMatchHomeAway,
  assertValidMatchDurationMinutes,
  DEFAULT_MATCH_DURATION_MINUTES,
  MATCH_DAY_HOME_AWAY_OPTIONS,
  getRequiredMatchDurationValidationError,
  normalizeLegacyMatchHomeAway,
  normalizeMatchDurationMinutes,
} from '../src/lib/matchday-model.js'
import { getMatchTimerElapsedSeconds, getMatchTimerMinute, formatMatchTimerClock } from '../src/lib/matchday-timer.js'
import { normalizeFixtureSetupIntent } from '../src/lib/matchday-workflow.js'

const domainUrl = new URL('../src/lib/domain/match-day.js', import.meta.url)
const pageUrl = new URL('../src/pages/MatchDayPage.jsx', import.meta.url)
const parentPortalUrl = new URL('../src/pages/ParentPortalPage.jsx', import.meta.url)
const previousGameCardUrl = new URL('../src/components/match-day/PreviousGameCard.jsx', import.meta.url)
const migrationUrl = new URL('../supabase/migrations/20260710094600_match_day_duration_home_away_timer.sql', import.meta.url)

test('new fixtures support Home and Away only while legacy neutral fixtures remain readable', () => {
  assert.deepEqual(MATCH_DAY_HOME_AWAY_OPTIONS.map((option) => option.value), ['home', 'away'])
  assert.throws(() => assertNewMatchHomeAway('neutral'), /Home or Away/)
  assert.equal(normalizeLegacyMatchHomeAway('neutral'), 'neutral')
  assert.equal(normalizeFixtureSetupIntent({ homeAway: 'neutral' }).homeAway, 'home')

  assert.deepEqual(getMatchDayDisplayParts({
    teamName: 'Test FC',
    opponent: 'Riverside',
    homeAway: 'neutral',
    homeScore: 2,
    awayScore: 1,
  }), {
    firstTeam: 'Test FC',
    secondTeam: 'Riverside',
    firstScore: 2,
    secondScore: 1,
    firstSide: 'team',
    secondSide: 'opponent',
  })
})

test('match duration defaults safely and validates new fixture values', () => {
  assert.equal(DEFAULT_MATCH_DURATION_MINUTES, 90)
  assert.equal(normalizeMatchDurationMinutes(), 90)
  assert.equal(normalizeMatchDurationMinutes(80), 80)
  assert.equal(normalizeMatchDurationMinutes(71), 90)

  for (const duration of [60, 70, 80, 90]) {
    assert.equal(assertValidMatchDurationMinutes(duration), duration)
  }

  for (const duration of [20, 60, 82, 100, 140]) {
    assert.equal(getRequiredMatchDurationValidationError(duration), '')
    assert.equal(assertValidMatchDurationMinutes(duration), duration)
  }

  assert.equal(assertValidMatchDurationMinutes(90), 90)
  assert.equal(assertValidMatchDurationMinutes(80), 80)
  assert.throws(() => assertValidMatchDurationMinutes(71), /even match duration/)
  assert.throws(() => assertValidMatchDurationMinutes(18), /even match duration/)
  assert.match(getRequiredMatchDurationValidationError(''), /Enter a custom match duration/)
  assert.match(getRequiredMatchDurationValidationError(21), /even match duration/)
  assert.match(getRequiredMatchDurationValidationError(18), /even match duration/)
  assert.match(getRequiredMatchDurationValidationError(142), /even match duration/)
})

test('second-half timer and event minute use the configured match duration', () => {
  const now = Date.parse('2026-07-10T09:00:00Z')

  for (const [duration, expectedClock] of [[90, '45:00'], [82, '41:00'], [100, '50:00'], [80, '40:00'], [70, '35:00'], [60, '30:00']]) {
    const match = {
      status: 'second_half',
      timerStatus: 'running',
      timerElapsedSeconds: 0,
      timerStartedAt: new Date(now).toISOString(),
      matchDurationMinutes: duration,
    }

    assert.equal(formatMatchTimerClock(match, now), expectedClock)
    assert.equal(getMatchTimerMinute(match, now), (duration / 2) + 1)
  }

  assert.equal(formatMatchTimerClock({
    status: 'live',
    timerStatus: 'running',
    timerElapsedSeconds: 0,
    timerStartedAt: new Date(now).toISOString(),
    matchDurationMinutes: 60,
  }, now), '0:00')
  assert.equal(getMatchTimerElapsedSeconds({
    status: 'extra_time',
    timerStatus: 'running',
    timerElapsedSeconds: 0,
    timerStartedAt: new Date(now).toISOString(),
    matchDurationMinutes: 60,
  }, now), 0)
  assert.equal(getMatchTimerElapsedSeconds({
    status: 'penalties',
    timerStatus: 'running',
    timerElapsedSeconds: 0,
    timerStartedAt: new Date(now).toISOString(),
    matchDurationMinutes: 60,
  }, now), 0)
})

test('configured second-half state survives pause resume refresh and repeated start without moving backward', () => {
  const secondHalfStart = Date.parse('2026-07-10T10:00:00Z')
  const runningMatch = {
    status: 'second_half',
    timerStatus: 'running',
    timerElapsedSeconds: 2400,
    timerStartedAt: new Date(secondHalfStart).toISOString(),
    matchDurationMinutes: 80,
  }

  assert.equal(formatMatchTimerClock(runningMatch, secondHalfStart + 30000), '40:30')
  assert.equal(formatMatchTimerClock({
    status: 'second_half',
    timer_status: 'running',
    timer_elapsed_seconds: 2400,
    timer_started_at: new Date(secondHalfStart).toISOString(),
    match_duration_minutes: 80,
  }, secondHalfStart + 30000), '40:30')
  assert.equal(formatMatchTimerClock({
    ...runningMatch,
    timerStatus: 'paused',
    timerElapsedSeconds: 2460,
  }, secondHalfStart + 600000), '41:00')
  assert.equal(formatMatchTimerClock({
    ...runningMatch,
    timerElapsedSeconds: 2460,
  }, secondHalfStart + 30000), '41:30')
  assert.equal(formatMatchTimerClock({
    ...runningMatch,
    timerElapsedSeconds: 2600,
  }, secondHalfStart), '43:20')
  assert.equal(formatMatchTimerClock({
    status: 'half_time',
    timerStatus: 'half_time',
    timerElapsedSeconds: 2395,
    matchDurationMinutes: 80,
  }, secondHalfStart + 600000), '39:55')
})

test('creation UI, domain writes, and migration enforce the new model narrowly', async () => {
  const [domain, page, parentPortal, previousGameCard, migration] = await Promise.all([
    readFile(domainUrl, 'utf8'),
    readFile(pageUrl, 'utf8'),
    readFile(parentPortalUrl, 'utf8'),
    readFile(previousGameCardUrl, 'utf8'),
    readFile(migrationUrl, 'utf8'),
  ])

  assert.match(domain, /assertNewMatchHomeAway\(match\?\.homeAway\)/)
  assert.match(domain, /assertValidMatchDurationMinutes\(match\?\.matchDurationMinutes\)/)
  assert.match(domain, /match_duration_minutes: matchDurationMinutes/)
  assert.match(domain, /matchDurationMinutes: normalizeMatchDurationMinutes\(row\.match_duration_minutes\)/)
  assert.match(domain, /match_duration_minutes, venue_name/)
  assert.match(page, /Match duration/)
  assert.match(page, /const MATCH_DAY_DURATION_PRESETS = \[60, 70, 80, 90\]/)
  assert.match(page, /Custom duration/)
  assert.match(page, /Custom minutes/)
  assert.match(page, /getRequiredMatchDurationValidationError\(form\.customMatchDurationMinutes/)
  assert.match(page, /min="20"/)
  assert.match(page, /max="140"/)
  assert.match(page, /step="2"/)
  assert.match(page, /updateCustomMatchDuration\(event\.target\.value\)/)
  assert.doesNotMatch(page, /<option[^>]+value="neutral"/)
  assert.match(page, /return 'Neutral venue'/)
  assert.match(previousGameCard, /getMatchDayDisplayName\(match\)/)
  assert.match(previousGameCard, /getMatchDayDisplayScore\(match\)/)
  assert.match(parentPortal, /<PreviousGameCard key=\{match\.id\} match=\{match\}/)
  assert.match(migration, /add column if not exists match_duration_minutes integer/)
  assert.match(migration, /match_duration_minutes between 20 and 140/)
  assert.match(migration, /before insert or update of home_away/)
  assert.match(migration, /new\.home_away is null or new\.home_away not in \('home', 'away'\)/)
  assert.match(migration, /\(coalesce\(new\.match_duration_minutes, 90\) \/ 2\) \* 60/)
  assert.doesNotMatch(migration, /update public\.match_days\s+set home_away/i)
  assert.doesNotMatch(migration, /delete from public\.match_days/i)
})
