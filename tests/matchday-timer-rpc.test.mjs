import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { test } from 'node:test'

import {
  createServerClockSample,
  createServerClockSampleFromDateHeader,
  formatMatchTimerClock,
  getServerSyncedNowMs,
  getMatchTimerElapsedSeconds,
  getMatchTimerMinute,
  isMatchTimerPaused,
} from '../src/lib/matchday-timer.js'

const timerMigrationUrl = new URL('../supabase/migrations/20260708165903_match_day_timer_state.sql', import.meta.url)
const matchDayPageUrl = new URL('../src/pages/MatchDayPage.jsx', import.meta.url)
const parentPortalPageUrl = new URL('../src/pages/ParentPortalPage.jsx', import.meta.url)
const matchDayDomainUrl = new URL('../src/lib/domain/match-day.js', import.meta.url)

test('match timer helper keeps running and frozen m:ss displays stable', () => {
  const now = Date.parse('2026-07-08T12:00:30Z')

  assert.equal(formatMatchTimerClock({
    status: 'live',
    timerStatus: 'running',
    timerElapsedSeconds: 120,
    timerStartedAt: '2026-07-08T12:00:00Z',
  }, now), '2:30')

  assert.equal(getMatchTimerElapsedSeconds({
    status: 'live',
    timerStatus: 'hydration',
    timerElapsedSeconds: 345,
    timerStartedAt: '2026-07-08T11:00:00Z',
  }, now), 345)

  assert.equal(formatMatchTimerClock({
    status: 'live',
    timerStatus: 'hydration',
    timerElapsedSeconds: 345,
    timerStartedAt: '2026-07-08T11:00:00Z',
  }, now + 60000), '5:45')

  assert.equal(isMatchTimerPaused({
    status: 'live',
    timerStatus: 'paused',
    timerElapsedSeconds: 10,
  }), true)

  assert.equal(formatMatchTimerClock({
    status: 'second_half',
    timerStatus: 'running',
    timerElapsedSeconds: 300,
    timerStartedAt: '2026-07-08T12:00:00Z',
  }, now), '5:30')

  assert.equal(formatMatchTimerClock({
    status: 'full_time',
    timerStatus: 'full_time',
    timerElapsedSeconds: 5400,
  }, now + 3600000), '90:00')
  assert.equal(getMatchTimerMinute({
    status: 'full_time',
    timerStatus: 'full_time',
    timerElapsedSeconds: 5400,
  }, now), null)

  assert.equal(formatMatchTimerClock({
    status: 'live',
    phaseStartedAt: '2026-07-08T11:59:30Z',
  }, now), '1:00')
})

test('server clock sample keeps live timer display consistent across client clock skew', () => {
  const serverStartedAt = Date.parse('2026-07-08T12:00:00Z')
  const serverNow = Date.parse('2026-07-08T12:00:30Z')
  const clientAClock = Date.parse('2026-07-08T12:00:44Z')
  const clientBClock = Date.parse('2026-07-08T12:00:16Z')
  const match = {
    status: 'live',
    timerStatus: 'running',
    timerElapsedSeconds: 0,
    timerStartedAt: new Date(serverStartedAt).toISOString(),
  }

  const clientASample = createServerClockSample({
    serverNowMs: serverNow,
    sampledAtMs: clientAClock,
  })
  const clientBSample = createServerClockSample({
    serverNowMs: serverNow,
    sampledAtMs: clientBClock,
  })

  assert.equal(formatMatchTimerClock(match, getServerSyncedNowMs(clientASample, clientAClock)), '0:30')
  assert.equal(formatMatchTimerClock(match, getServerSyncedNowMs(clientBSample, clientBClock)), '0:30')
  assert.equal(formatMatchTimerClock(match, getServerSyncedNowMs(clientASample, clientAClock + 5000)), '0:35')
  assert.equal(formatMatchTimerClock(match, getServerSyncedNowMs(clientBSample, clientBClock + 5000)), '0:35')
})

test('server clock sync preserves frozen timer state across pause hydration half time and full time', () => {
  const skewedClientClock = Date.parse('2026-07-08T12:01:14Z')
  const serverNow = Date.parse('2026-07-08T12:01:00Z')
  const sample = createServerClockSampleFromDateHeader(new Date(serverNow).toUTCString(), {
    sampledAtMs: skewedClientClock,
  })
  const syncedNow = getServerSyncedNowMs(sample, skewedClientClock + 30000)

  for (const timerStatus of ['paused', 'hydration', 'half_time', 'full_time']) {
    assert.equal(formatMatchTimerClock({
      status: timerStatus === 'full_time' ? 'full_time' : 'live',
      timerStatus,
      timerElapsedSeconds: 1800,
      timerStartedAt: '2026-07-08T12:00:00Z',
    }, syncedNow), '30:00')
  }
})

test('timer migration adds durable columns and a locked staff RPC without client elapsed input', async () => {
  const migration = await readFile(timerMigrationUrl, 'utf8')

  assert.match(migration, /add column if not exists timer_started_at timestamptz/i)
  assert.match(migration, /add column if not exists timer_paused_at timestamptz/i)
  assert.match(migration, /add column if not exists timer_elapsed_seconds integer not null default 0/i)
  assert.match(migration, /add column if not exists timer_status text not null default 'not_started'/i)
  assert.match(migration, /constraint match_days_timer_elapsed_seconds_check[\s\S]*timer_elapsed_seconds >= 0/i)
  assert.match(migration, /constraint match_days_timer_status_check[\s\S]*'running'[\s\S]*'hydration'[\s\S]*'full_time'/i)

  const rpcStart = migration.indexOf('create or replace function public.set_match_day_timer_state')
  const rpcEnd = migration.indexOf('revoke all on function public.set_match_day_timer_state', rpcStart)
  assert.notEqual(rpcStart, -1)
  assert.notEqual(rpcEnd, -1)
  const rpc = migration.slice(rpcStart, rpcEnd)

  assert.match(rpc, /security definer[\s\S]*set search_path = public/i)
  assert.match(rpc, /auth\.uid\(\)/i)
  assert.match(rpc, /for update/i)
  assert.match(rpc, /public\.can_manage_match_day\(match_row\.team_id\)/i)
  assert.match(rpc, /public\.current_user_club_id\(\)/i)
  assert.match(rpc, /normalized_action not in \('start', 'pause', 'half_time', 'hydration', 'resume', 'full_time'\)/i)
  assert.match(rpc, /next_timer_elapsed_seconds < 0/i)
  assert.match(rpc, /timer_elapsed_seconds = next_timer_elapsed_seconds/i)
  assert.match(rpc, /'water_break'[\s\S]*'Hydration pause'/i)
  assert.match(rpc, /'match_day_updated'[\s\S]*'Timer state updated'/i)
  assert.doesNotMatch(rpc, /client_elapsed|elapsed_seconds_value|timer_elapsed_seconds_value/i)
  assert.match(migration, /revoke execute on function public\.set_match_day_timer_state\(uuid, text\) from anon;/i)
  assert.match(migration, /grant execute on function public\.set_match_day_timer_state\(uuid, text\) to authenticated;/i)
})

test('parent and scorer RPCs carry timer state without widening access', async () => {
  const migration = await readFile(timerMigrationUrl, 'utf8')

  const parentRpc = migration.slice(
    migration.indexOf('create or replace function public.get_parent_portal_match_days'),
    migration.indexOf('revoke all on function public.get_parent_portal_match_days'),
  )
  assert.match(parentRpc, /timer_started_at timestamptz[\s\S]*timer_paused_at timestamptz[\s\S]*timer_elapsed_seconds integer[\s\S]*timer_status text/i)
  assert.match(parentRpc, /match_day\.timer_started_at[\s\S]*match_day\.timer_paused_at[\s\S]*match_day\.timer_elapsed_seconds[\s\S]*match_day\.timer_status/i)
  assert.match(parentRpc, /auth_user_id = auth\.uid\(\)/i)
  assert.match(parentRpc, /match_day\.parent_visible is true/i)

  const scoreRpc = migration.slice(
    migration.indexOf('create or replace function public.update_match_day_score_as_scorer'),
    migration.indexOf('revoke all on function public.update_match_day_score_as_scorer'),
  )
  assert.match(scoreRpc, /for update/i)
  assert.match(scoreRpc, /timer_status = next_timer_status/i)
  assert.match(scoreRpc, /timer_started_at = next_timer_started_at/i)
  assert.match(scoreRpc, /timer_elapsed_seconds = next_timer_elapsed_seconds/i)
  assert.match(scoreRpc, /next_status = 'half_time'[\s\S]*next_timer_status := 'half_time'/i)
  assert.match(scoreRpc, /next_status = 'full_time'[\s\S]*next_timer_status := 'full_time'/i)

  const goalRpc = migration.slice(
    migration.indexOf('create or replace function public.add_match_day_goal_as_scorer'),
    migration.indexOf('revoke all on function public.add_match_day_goal_as_scorer'),
  )
  assert.match(goalRpc, /for update/i)
  assert.match(goalRpc, /match_row\.status in \('scheduled', 'scorer_request'\)[\s\S]*next_timer_status := 'running'/i)
  assert.match(goalRpc, /timer_status = next_timer_status/i)
})

test('app wiring uses the timer RPC and removes local Game Mode pause state', async () => {
  const [page, parentPortal, domain] = await Promise.all([
    readFile(matchDayPageUrl, 'utf8'),
    readFile(parentPortalPageUrl, 'utf8'),
    readFile(matchDayDomainUrl, 'utf8'),
  ])

  assert.match(page, /setMatchDayTimerState/)
  assert.match(page, /useServerSyncedClock/)
  assert.match(page, /formatMatchTimerClock\(match, now\)/)
  assert.match(page, /resolveMatchDayEventMinute\({[\s\S]*now: liveClockNow/)
  assert.match(page, /isMatchTimerPaused\(match\)/)
  assert.match(page, /onHydrationToggle\(match, 'pause'\)/)
  assert.doesNotMatch(page, /setLiveClockNow\(Date\.now\(\)\)/)
  assert.doesNotMatch(page, /MATCH_DAY_GAME_MODE_PAUSE_STORAGE_KEY/)
  assert.doesNotMatch(page, /gameModePauseState/)
  assert.doesNotMatch(page, /setGameModePauseState/)

  assert.match(parentPortal, /useServerSyncedClock/)
  assert.match(parentPortal, /getMatchTimerMinute\(match, now\)/)
  assert.doesNotMatch(parentPortal, /setClockNow\(Date\.now\(\)\)/)
  assert.match(domain, /supabase\.rpc\('set_match_day_timer_state'/)
  assert.match(domain, /timerStartedAt: row\.timer_started_at/)
  assert.match(domain, /timerElapsedSeconds: normalizeNonNegativeInteger\(row\.timer_elapsed_seconds/)
  assert.match(domain, /await setMatchDayTimerState\(\{ user, match, action: 'start' \}\)/)
})
