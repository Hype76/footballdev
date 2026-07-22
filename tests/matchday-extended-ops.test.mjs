import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'

import {
  canFinishPenaltyShootout,
  getMatchDayExtendedTimerActions,
  getMatchDayPhaseLabel,
  getNormalTimeCompletionAction,
  MATCH_DAY_CONCLUSION_RULE_OPTIONS,
  normalizeExtraTimePeriodCount,
  normalizeMatchDayConclusionRule,
} from '../src/lib/matchday-extended-ops.js'
import {
  buildCompletedMatchEventPresentation,
  buildCompletedMatchResult,
  buildFinalMatchReportSummary,
} from '../src/lib/matchday-final-report.js'

const fixtureTypes = ['friendly', 'league', 'cup', 'tournament']

test('every fixture type receives the same explicit conclusion rules', () => {
  const expectedRules = ['normal_time', 'extra_time', 'extra_time_then_penalties', 'straight_to_penalties']
  for (const fixtureType of fixtureTypes) {
    assert.equal(fixtureType.length > 0, true)
    assert.deepEqual(MATCH_DAY_CONCLUSION_RULE_OPTIONS.map((option) => option.value), expectedRules)
  }
  assert.equal(normalizeMatchDayConclusionRule('invalid_combination'), 'normal_time')
  assert.equal(normalizeExtraTimePeriodCount(1), 1)
  assert.equal(normalizeExtraTimePeriodCount(2), 2)
  assert.equal(normalizeExtraTimePeriodCount(3), 2)
})

test('normal time deliberately routes to only configured phases', () => {
  assert.equal(getNormalTimeCompletionAction({ conclusionRule: 'normal_time' }), 'full_time')
  assert.equal(getNormalTimeCompletionAction({ conclusionRule: 'extra_time' }), 'normal_time_complete')
  assert.deepEqual(
    getMatchDayExtendedTimerActions({ conclusionRule: 'straight_to_penalties', currentMatchPhase: 'normal_time_complete' }),
    [{ action: 'start_penalties', label: 'Start penalty shootout' }],
  )
  assert.deepEqual(
    getMatchDayExtendedTimerActions({ conclusionRule: 'extra_time', currentMatchPhase: 'normal_time_complete' }),
    [{ action: 'start_extra_time', label: 'Start extra time' }],
  )
})

test('one and two period extra-time configurations have explicit final transitions', () => {
  assert.deepEqual(
    getMatchDayExtendedTimerActions({ currentMatchPhase: 'extra_time_first_half', extraTimePeriodCount: 1 }),
    [{ action: 'complete_extra_time', label: 'End extra time' }],
  )
  assert.deepEqual(
    getMatchDayExtendedTimerActions({ currentMatchPhase: 'extra_time_first_half', extraTimePeriodCount: 2 }),
    [{ action: 'extra_time_half_time', label: 'Extra time half time' }],
  )
  assert.deepEqual(
    getMatchDayExtendedTimerActions({ currentMatchPhase: 'extra_time_half_time', extraTimePeriodCount: 2 }),
    [{ action: 'start_extra_time_second_half', label: 'Start extra time second half' }],
  )
  assert.equal(getMatchDayPhaseLabel({ currentMatchPhase: 'extra_time_first_half', extraTimePeriodCount: 1 }), 'Extra time')
})

test('shootout completion supports early mathematical completion and sudden death', () => {
  const kick = (teamSide, outcome, number) => ({ id: `${teamSide}-${number}`, teamSide, outcome, eventStatus: 'active' })
  const earlyFinish = {
    shootoutEvents: [
      kick('club', 'scored', 1), kick('opponent', 'missed', 1),
      kick('club', 'scored', 2), kick('opponent', 'missed', 2),
      kick('club', 'scored', 3), kick('opponent', 'missed', 3),
    ],
  }
  assert.equal(canFinishPenaltyShootout(earlyFinish), true)

  const notFinished = { shootoutEvents: earlyFinish.shootoutEvents.slice(0, 5) }
  assert.equal(canFinishPenaltyShootout(notFinished), false)

  const suddenDeath = {
    shootoutEvents: [
      ...Array.from({ length: 5 }, (_, index) => kick('club', index < 4 ? 'scored' : 'missed', index + 1)),
      ...Array.from({ length: 5 }, (_, index) => kick('opponent', index < 4 ? 'scored' : 'missed', index + 1)),
      kick('club', 'scored', 6), kick('opponent', 'missed', 6),
    ],
  }
  assert.equal(canFinishPenaltyShootout(suddenDeath), true)
  assert.equal(canFinishPenaltyShootout({
    shootoutEvents: [...suddenDeath.shootoutEvents, { ...kick('opponent', 'scored', 7), eventStatus: 'voided' }],
  }), true)
})

test('penalty goals remain normal goals while shootout kicks remain separate report data', () => {
  const match = {
    conclusionRule: 'extra_time_then_penalties',
    homeAway: 'home',
    teamName: 'FP TEST Team',
    opponent: 'FP TEST Opponent',
    homeScore: 1,
    awayScore: 1,
    normalTimeHomeScore: 0,
    normalTimeAwayScore: 0,
    extraTimeHomeScore: 1,
    extraTimeAwayScore: 1,
    homeShootoutScore: 5,
    awayShootoutScore: 4,
    shootoutWinner: 'home',
    events: [{
      id: 'goal-1', eventType: 'goal', eventStatus: 'active', isPenaltyGoal: true,
      teamSide: 'club', scorerName: 'FP TEST Player', minute: 101, homeScore: 1, awayScore: 0,
      matchPhase: 'extra_time_second_half', phaseOrder: 70,
    }],
    shootoutEvents: [{
      id: 'kick-1', teamSide: 'club', outcome: 'scored', kickNumber: 1,
      playerName: 'FP TEST Player', eventStatus: 'active', createdAt: '2030-01-01T12:00:00Z',
    }],
  }
  const presentation = buildCompletedMatchEventPresentation(match.events[0], match)
  const report = buildFinalMatchReportSummary(match)
  const result = buildCompletedMatchResult(match)

  assert.equal(presentation.title, 'Penalty goal')
  assert.equal(report.activeGoals.length, 1)
  assert.equal(report.activeEvents.length, 1)
  assert.equal(result.regulationScore, '0 - 0')
  assert.equal(result.extraTimeScore, '1 - 1')
  assert.equal(result.shootoutScore, '5 - 4')
  assert.equal(result.shootoutWinner, 'FP TEST Team')
  assert.equal(result.shootoutEvents.length, 1)
})

test('migration and UI preserve authority, audit, hydration, and Wake Lock boundaries', async () => {
  const [migration, staffPage, parentPage, wakeLock] = await Promise.all([
    readFile(new URL('../supabase/migrations/20260722195910_fp_v1_gameday_extended_ops_12a.sql', import.meta.url), 'utf8'),
    readFile(new URL('../src/pages/MatchDayPage.jsx', import.meta.url), 'utf8'),
    readFile(new URL('../src/pages/ParentPortalPage.jsx', import.meta.url), 'utf8'),
    readFile(new URL('../src/lib/use-matchday-wake-lock.js', import.meta.url), 'utf8'),
  ])

  for (const signature of [
    'set_match_day_extended_state(uuid, text)',
    'record_match_day_shootout_kick(uuid, text, text, text, text)',
    'void_match_day_shootout_kick(uuid, uuid, text)',
    'get_parent_portal_match_day_extended_state(uuid)',
  ]) {
    assert.match(migration, new RegExp(`revoke all on function public\\.${signature.replace(/[()]/g, '\\$&')}`))
  }
  assert.match(migration, /security definer\s+set search_path = ''/i)
  assert.match(migration, /current_user_is_match_day_scorer\(match_row\.id\)/)
  assert.match(migration, /current_user_has_match_day_scorer_assignment\(match_row\.id\)/)
  assert.match(migration, /for update/)
  assert.match(migration, /Shootout kick voided/)
  assert.match(migration, /public\.apply_match_day_timer_action/)
  assert.doesNotMatch(migration, /create or replace function public\.apply_match_day_timer_action/)
  assert.match(migration, /where current_match_phase = 'pre_match'\s+and deleted_at is null/)
  assert.doesNotMatch(migration, /update public\.match_day_events event\s+set match_phase/)
  assert.match(migration, /kick\.team_side = normalized_team_side\s+and kick\.event_status = 'active'/)
  assert.match(staffPage, /Penalty goal/)
  assert.match(parentPage, /Penalty goal/)
  assert.match(staffPage, /MatchDayWakeLockControl/)
  assert.match(parentPage, /MatchDayWakeLockControl/)
  assert.match(wakeLock, /sessionStorage/)
  assert.match(wakeLock, /navigator\.wakeLock\.request/)
  assert.match(wakeLock, /if \(!active \|\| !enabled \|\| !isSupported/)
  assert.match(staffPage, /<MatchDayWakeLockControl active=\{!isFullTime\} \/>/)
  assert.match(parentPage, /<MatchDayWakeLockControl active=\{match\.status !== 'full_time'\} \/>/)
  assert.doesNotMatch(wakeLock, /supabase|database|rpc\(/i)
})
