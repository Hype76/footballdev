import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { test } from 'node:test'

import {
  canResumeMatchDay,
  getMatchDayLifecycleState,
  isMatchDayAtFullTime,
  isMatchDayConcluded,
} from '../src/lib/matchday-lifecycle.js'
import {
  assertValidMatchClockMode,
  assertValidMatchDurationMinutes,
  isContinuousMatchClock,
  normalizeMatchClockMode,
} from '../src/lib/matchday-model.js'
import {
  formatMatchTimerClock,
  getMatchTimerDisplayLabel,
  getMatchTimerElapsedSeconds,
} from '../src/lib/matchday-timer.js'
import { reconcileMatchDayUpdate } from '../src/lib/matchday-update-state.js'

const migrationUrl = new URL('../supabase/migrations/20260713090040_match_day_reversible_full_time_continuous_clock.sql', import.meta.url)
const pageUrl = new URL('../src/pages/MatchDayPage.jsx', import.meta.url)
const domainUrl = new URL('../src/lib/domain/match-day.js', import.meta.url)

test('Full Time freezes the authoritative clock without concluding the match', () => {
  const fullTimeMatch = {
    status: 'full_time',
    timerStatus: 'full_time',
    timerElapsedSeconds: 4372,
    timerStartedAt: '',
    concludedAt: '',
  }

  assert.equal(formatMatchTimerClock(fullTimeMatch, Date.parse('2026-07-13T10:00:00Z')), '72:52')
  assert.equal(formatMatchTimerClock(fullTimeMatch, Date.parse('2026-07-13T12:00:00Z')), '72:52')
  assert.equal(isMatchDayAtFullTime(fullTimeMatch), true)
  assert.equal(isMatchDayConcluded(fullTimeMatch), false)
  assert.equal(canResumeMatchDay(fullTimeMatch), true)
  assert.equal(getMatchDayLifecycleState(fullTimeMatch), 'full_time')
})

test('timer-only lifecycle reconciliation preserves score events selections availability and roles', () => {
  const existingMatch = {
    id: 'match-1',
    status: 'full_time',
    timerStatus: 'full_time',
    timerElapsedSeconds: 4372,
    homeScore: 3,
    awayScore: 2,
    events: [{ id: 'goal-1' }],
    playerAvailability: [{ id: 'availability-1' }],
    availabilityRequests: [{ id: 'request-1' }],
    roleAssignments: [{ id: 'role-1' }],
    scorerAssignments: [{ id: 'scorer-1' }],
  }
  const resumedMatch = reconcileMatchDayUpdate(existingMatch, {
    id: 'match-1',
    status: 'second_half',
    timerStatus: 'running',
    timerStartedAt: '2026-07-13T10:00:00Z',
    timerElapsedSeconds: 4372,
    concludedAt: '',
  })

  assert.equal(resumedMatch.homeScore, 3)
  assert.equal(resumedMatch.awayScore, 2)
  assert.deepEqual(resumedMatch.events, existingMatch.events)
  assert.deepEqual(resumedMatch.playerAvailability, existingMatch.playerAvailability)
  assert.deepEqual(resumedMatch.availabilityRequests, existingMatch.availabilityRequests)
  assert.deepEqual(resumedMatch.roleAssignments, existingMatch.roleAssignments)
  assert.deepEqual(resumedMatch.scorerAssignments, existingMatch.scorerAssignments)
  assert.equal(getMatchDayLifecycleState(resumedMatch), 'playing')
})

test('Continuous Clock counts from zero, survives persisted reload, pauses, resumes, and has no automatic endpoint', () => {
  const startedAt = Date.parse('2026-07-13T10:00:00Z')
  const runningMatch = {
    status: 'live',
    clockMode: 'continuous',
    timerStatus: 'running',
    timerElapsedSeconds: 0,
    timerStartedAt: new Date(startedAt).toISOString(),
  }

  assert.equal(formatMatchTimerClock(runningMatch, startedAt), '0:00')
  assert.equal(formatMatchTimerClock(runningMatch, startedAt + 95_000), '1:35')
  assert.equal(getMatchTimerElapsedSeconds(runningMatch, startedAt + 4 * 60 * 60 * 1000), 14_400)
  assert.equal(getMatchDayLifecycleState(runningMatch), 'playing')

  const pausedReload = {
    status: 'live',
    match_clock_mode: 'continuous',
    timer_status: 'paused',
    timer_elapsed_seconds: 95,
    timer_started_at: null,
  }
  assert.equal(formatMatchTimerClock(pausedReload, startedAt + 60 * 60 * 1000), '1:35')
  assert.equal(getMatchDayLifecycleState(pausedReload), 'paused')

  const resumedReload = {
    ...pausedReload,
    timer_status: 'running',
    timer_started_at: new Date(startedAt + 120_000).toISOString(),
  }
  assert.equal(formatMatchTimerClock(resumedReload, startedAt + 150_000), '2:05')
})

test('Continuous Clock ignores fixed-duration second-half floors while fixed and custom durations remain unchanged', () => {
  const secondHalfStart = Date.parse('2026-07-13T11:00:00Z')

  assert.equal(formatMatchTimerClock({
    status: 'second_half',
    clockMode: 'continuous',
    timerStatus: 'running',
    timerElapsedSeconds: 120,
    timerStartedAt: new Date(secondHalfStart).toISOString(),
  }, secondHalfStart), '2:00')

  assert.equal(formatMatchTimerClock({
    status: 'second_half',
    clockMode: 'fixed',
    matchDurationMinutes: 80,
    timerStatus: 'running',
    timerElapsedSeconds: 120,
    timerStartedAt: new Date(secondHalfStart).toISOString(),
  }, secondHalfStart), '40:00')

  assert.equal(assertValidMatchDurationMinutes(80), 80)
  assert.equal(assertValidMatchDurationMinutes(82), 82)
  assert.equal(normalizeMatchClockMode(), 'fixed')
  assert.equal(assertValidMatchClockMode('continuous'), 'continuous')
  assert.equal(isContinuousMatchClock({ match_clock_mode: 'continuous' }), true)
  assert.equal(getMatchTimerDisplayLabel({ clockMode: 'continuous' }), 'Elapsed continuous clock')
})

test('migration enforces Full Time resume and irreversible conclusion through the staff RPC', async () => {
  const migration = await readFile(migrationUrl, 'utf8')
  const rpcStart = migration.indexOf('create or replace function public.set_match_day_timer_state')
  const rpcEnd = migration.indexOf('revoke all on function public.set_match_day_timer_state', rpcStart)
  const rpc = migration.slice(rpcStart, rpcEnd)

  assert.match(migration, /add column if not exists match_clock_mode text not null default 'fixed'/i)
  assert.match(migration, /add column if not exists full_time_resume_status text/i)
  assert.match(migration, /add column if not exists concluded_at timestamptz/i)
  assert.match(migration, /where status = 'full_time'[\s\S]*and concluded_at is null/i)
  assert.match(migration, /old\.concluded_at is not null[\s\S]*cannot be reopened/i)
  assert.match(migration, /new\.match_clock_mode is distinct from old\.match_clock_mode[\s\S]*Clock type cannot be changed after the match clock has started/i)
  assert.match(migration, /current_setting\('app\.match_day_lifecycle_authorized'/i)
  assert.match(migration, /coalesce\(new\.match_clock_mode, 'fixed'\) = 'fixed'/i)

  assert.match(rpc, /normalized_action not in \('start', 'pause', 'half_time', 'hydration', 'resume', 'full_time', 'conclude'\)/i)
  assert.match(rpc, /public\.can_manage_match_day\(match_row\.team_id\)/i)
  assert.match(rpc, /match_row\.club_id <> public\.current_user_club_id\(\)/i)
  assert.match(rpc, /current_timer_status = 'full_time'[\s\S]*next_timer_status := 'running'/i)
  assert.match(rpc, /next_timer_elapsed_seconds := stored_elapsed_seconds/i)
  assert.match(rpc, /next_full_time_resume_status := null/i)
  assert.match(rpc, /match_row\.status <> 'full_time' or current_timer_status <> 'full_time'[\s\S]*Choose Full Time before concluding/i)
  assert.match(rpc, /next_concluded_at := now_value/i)
  assert.match(rpc, /A concluded match cannot be resumed or changed/i)
  assert.match(rpc, /Only a paused or Full Time match clock can be resumed/i)
  assert.match(rpc, /Start the match clock before choosing Full Time/i)
  assert.doesNotMatch(rpc, /client_elapsed|elapsed_seconds_value|timer_elapsed_seconds_value/i)
})

test('Match Day UI exposes mobile-safe Resume Match and confirmed Conclude Match actions', async () => {
  const [page, domain] = await Promise.all([
    readFile(pageUrl, 'utf8'),
    readFile(domainUrl, 'utf8'),
  ])

  assert.match(page, /function FullTimeLifecyclePanel/)
  assert.match(page, /The clock is stopped, but Match Day is still open/)
  assert.match(page, /Resume Match/)
  assert.match(page, />\s*Conclude Match\s*</)
  assert.match(page, /Conclude match permanently/)
  assert.match(page, /cannot be resumed after conclusion/i)
  assert.match(page, /grid w-full gap-2 sm:grid-cols-2 lg:w-auto/)
  assert.match(page, /Starts at 0:00 and counts up[\s\S]*There is no automatic match endpoint/i)
  assert.match(page, /getMatchTimerDisplayLabel\(match\)/)
  assert.match(page, /isMatchDayConcluded\(match\)/)
  assert.match(page, /isMatchDayAtFullTime\(match\)/)
  assert.match(domain, /MATCH_DAY_TIMER_ACTIONS = new Set\(\['start', 'pause', 'half_time', 'hydration', 'resume', 'full_time', 'conclude'\]\)/)
  assert.match(domain, /supabase\.rpc\('set_match_day_timer_state'/)
})

test('concluded lifecycle state cannot be offered as resumable', () => {
  const concludedMatch = {
    status: 'full_time',
    timerStatus: 'full_time',
    timerElapsedSeconds: 5400,
    concludedAt: '2026-07-13T12:00:00Z',
  }

  assert.equal(isMatchDayConcluded(concludedMatch), true)
  assert.equal(isMatchDayAtFullTime(concludedMatch), false)
  assert.equal(canResumeMatchDay(concludedMatch), false)
  assert.equal(getMatchDayLifecycleState(concludedMatch), 'concluded')
})
