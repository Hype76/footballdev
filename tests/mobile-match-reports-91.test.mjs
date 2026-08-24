import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'
import {
  buildCompletedMatchEventPresentation,
  buildFinalMatchReportSummary,
} from '../src/lib/matchday-final-report.js'

const [coachScreen, parentData, parentMetro, parentScreens] = await Promise.all([
  readFile(new URL('../apps/coach-mobile/src/CoachMatchDayScreen.js', import.meta.url), 'utf8'),
  readFile(new URL('../apps/parent-mobile/src/parentPortalData.js', import.meta.url), 'utf8'),
  readFile(new URL('../apps/parent-mobile/metro.config.js', import.meta.url), 'utf8'),
  readFile(new URL('../apps/parent-mobile/src/ParentPortalScreens.js', import.meta.url), 'utf8'),
])

test('Coach app exposes the canonical final report with guarded saving', () => {
  const reportStart = coachScreen.indexOf('function ReportPanel')
  const reportEnd = coachScreen.indexOf('export function CoachMatchDayScreen', reportStart)
  const reportSource = coachScreen.slice(reportStart, reportEnd)

  assert.match(coachScreen, /\{ label: 'Report', value: 'report' \}/)
  assert.match(coachScreen, /panel === 'report'/)
  assert.match(coachScreen, /canSave=\{actions\.canSaveFinalReport\}/)
  assert.match(reportSource, /buildCoachFinalMatchReport\(match\)/)
  assert.match(reportSource, /buildCompletedMatchEventPresentation\(event, match\)/)
  assert.match(reportSource, /Final Match Report/)
  assert.match(reportSource, /Coach notes/)
  assert.match(reportSource, /Save final report/)
  assert.doesNotMatch(coachScreen, /COACH_MOBILE_FA_REPORT_VISIBLE/)
})

test('Parent app normalizes canonical event state needed for safe reports', () => {
  assert.match(parentData, /eventStatus: normalizeText\(row\.event_status \?\? row\.eventStatus\)/)
  assert.match(parentData, /isPenaltyGoal: row\.is_penalty_goal === true \|\| row\.isPenaltyGoal === true/)
  assert.match(parentData, /matchPhase: normalizeText\(row\.match_phase \?\? row\.matchPhase\)/)
  assert.match(parentData, /phaseOrder: Number\(row\.phase_order \?\? row\.phaseOrder \?\? 0\)/)
  assert.match(parentData, /stoppageMinute: row\.stoppage_minute \?\? row\.stoppageMinute \?\? null/)
})

test('Parent Results exposes event reports without staff-only final report data', () => {
  const resultsStart = parentScreens.indexOf('export function ResultsScreen')
  const resultsEnd = parentScreens.indexOf('export function DevelopmentScreen', resultsStart)
  const resultsSource = parentScreens.slice(resultsStart, resultsEnd)

  assert.match(resultsSource, /ParentMatchReportCard/)
  assert.match(resultsSource, /View match report/)
  assert.match(resultsSource, /Hide match report/)
  assert.match(resultsSource, /buildFinalMatchReportSummary\(match\)/)
  assert.match(resultsSource, /buildCompletedMatchEventPresentation\(event, match, \{ includeNotes: false \}\)/)
  assert.match(resultsSource, /Goals \{report\.activeGoals\.length\}/)
  assert.match(resultsSource, /Cards \{report\.activeCards\.length\}/)
  assert.match(resultsSource, /Substitutions \{report\.activeSubstitutions\.length\}/)
  assert.match(resultsSource, /Match timeline/)
  assert.doesNotMatch(resultsSource, /staffNotes|match_day_final_reports|Coach notes/)
})

test('Parent OTA bundling includes the shared canonical report source', () => {
  assert.match(parentMetro, /path\.resolve\(workspaceRoot, 'src'\)/)
  assert.match(parentScreens, /from '\.\.\/\.\.\/\.\.\/src\/lib\/matchday-final-report\.js'/)
})

test('Parent match report omits voided events and keeps Parent-visible event copy', () => {
  const match = {
    awayScore: 1,
    events: [
      { eventStatus: 'active', eventType: 'goal', homeScore: 1, awayScore: 0, id: 'goal', minute: 12, scorerName: 'Alex', teamSide: 'club' },
      { eventStatus: 'voided', eventType: 'yellow_card', id: 'voided', minute: 20, playerName: 'Jamie', teamSide: 'club' },
    ],
    homeAway: 'home',
    homeScore: 2,
    opponent: 'Visitors',
    status: 'full_time',
    teamName: 'FP TEST',
  }
  const report = buildFinalMatchReportSummary(match)
  const event = buildCompletedMatchEventPresentation(report.activeEvents[0], match, { includeNotes: false })

  assert.deepEqual(report.activeEvents.map((item) => item.id), ['goal'])
  assert.deepEqual(report.voidedEvents.map((item) => item.id), ['voided'])
  assert.equal(report.result.finalScore, '2 - 1')
  assert.equal(event.title, 'Goal')
  assert.equal(event.detail, 'Alex')
  assert.equal(event.team.name, 'FP TEST')
  assert.equal(event.notes, '')
})
