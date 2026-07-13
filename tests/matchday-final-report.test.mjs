import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { test } from 'node:test'
import { normalizeMatchDay } from '../src/lib/domain/match-day.js'
import {
  buildFinalMatchReportSummary,
  isFinalMatchReportAvailable,
  validateFinalMatchReportNotes,
} from '../src/lib/matchday-final-report.js'
import { getMatchDayDisplayScore } from '../src/lib/matchday-display.js'
import { migrationSourceUrl } from './helpers/migration-source.mjs'

const migrationUrl = migrationSourceUrl('20260710183205_match_day_final_reports.sql', 'active')
const domainUrl = new URL('../src/lib/domain/match-day.js', import.meta.url)
const pageUrl = new URL('../src/pages/MatchDayPage.jsx', import.meta.url)
const parentPageUrl = new URL('../src/pages/ParentPortalPage.jsx', import.meta.url)

test('final report is available only after full time and notes remain narrowly validated', () => {
  assert.equal(isFinalMatchReportAvailable({ status: 'full_time' }), true)
  assert.equal(isFinalMatchReportAvailable({ status: 'live' }), false)
  assert.equal(isFinalMatchReportAvailable({ status: 'half_time' }), false)
  assert.equal(validateFinalMatchReportNotes('  Good response after the break.  '), 'Good response after the break.')
  assert.throws(() => validateFinalMatchReportNotes('x'.repeat(5001)), /5000 characters or fewer/)
})

test('final report summary uses authoritative score and excludes voided events from active totals', () => {
  const match = normalizeMatchDay({
    id: 'match-1',
    club_id: 'club-1',
    team_id: 'team-1',
    opponent: 'City Juniors',
    home_away: 'away',
    match_duration_minutes: 70,
    status: 'full_time',
    home_score: 1,
    away_score: 2,
    match_day_events: [
      { id: 'goal-1', event_type: 'goal', event_status: 'active', team_side: 'club', minute: 12, home_score: 0, away_score: 1 },
      { id: 'goal-void', event_type: 'goal', event_status: 'voided', team_side: 'club', minute: 18, home_score: 0, away_score: 2 },
      { id: 'card-1', event_type: 'yellow_card', event_status: 'active', team_side: 'opponent', minute: 25 },
      { id: 'sub-void', event_type: 'substitution', event_status: 'voided', team_side: 'club', minute: 44 },
      { id: 'water-1', event_type: 'water_break', event_status: 'active', team_side: 'club', minute: 50 },
    ],
  })
  const summary = buildFinalMatchReportSummary(match)

  assert.equal(getMatchDayDisplayScore(match), '1 - 2')
  assert.equal(match.matchDurationMinutes, 70)
  assert.equal(match.homeAway, 'away')
  assert.deepEqual(summary.activeGoals.map((event) => event.id), ['goal-1'])
  assert.deepEqual(summary.activeCards.map((event) => event.id), ['card-1'])
  assert.equal(summary.activeSubstitutions.length, 0)
  assert.deepEqual(summary.activeWaterBreaks.map((event) => event.id), ['water-1'])
  assert.deepEqual(summary.voidedEvents.map((event) => event.id), ['goal-void', 'sub-void'])
})

test('match normalization attaches one report to the correct game and preserves safe empty state', () => {
  const completedMatch = normalizeMatchDay({
    id: 'match-1',
    status: 'full_time',
    match_day_final_reports: [{
      match_day_id: 'match-1',
      staff_notes: 'Strong second-half response.',
      created_by_name: 'Coach Taylor',
      created_at: '2026-07-10T18:00:00Z',
      updated_by_name: 'Coach Taylor',
      updated_at: '2026-07-10T18:05:00Z',
    }],
  })
  const completedWithoutReport = normalizeMatchDay({ id: 'match-2', status: 'full_time' })

  assert.deepEqual(completedMatch.finalReport, {
    matchDayId: 'match-1',
    staffNotes: 'Strong second-half response.',
    createdByName: 'Coach Taylor',
    createdAt: '2026-07-10T18:00:00Z',
    updatedByName: 'Coach Taylor',
    updatedAt: '2026-07-10T18:05:00Z',
  })
  assert.equal(completedWithoutReport.finalReport, null)
})

test('migration creates an additive match-bound report with no direct authenticated writes', async () => {
  const migration = await readFile(migrationUrl, 'utf8')

  assert.match(migration, /create table if not exists public\.match_day_final_reports/i)
  assert.match(migration, /match_day_id uuid primary key references public\.match_days \(id\) on delete cascade/i)
  assert.match(migration, /staff_notes text not null default ''/i)
  assert.match(migration, /created_by_name text/i)
  assert.match(migration, /updated_by_name text/i)
  assert.match(migration, /profile\.name/i)
  assert.doesNotMatch(migration, /profile\.full_name/i)
  assert.match(migration, /alter table public\.match_day_final_reports enable row level security/i)
  assert.match(migration, /revoke all on public\.match_day_final_reports from authenticated/i)
  assert.match(migration, /grant select on public\.match_day_final_reports to authenticated/i)
  assert.doesNotMatch(migration, /grant (insert|update|delete)[^;]*match_day_final_reports to authenticated/i)
  assert.doesNotMatch(migration, /\b(drop table|truncate|delete from)\b/i)
})

test('report read and save boundaries fail closed for parents and other-team staff', async () => {
  const migration = await readFile(migrationUrl, 'utf8')
  const selectPolicyStart = migration.indexOf('create policy match_day_final_reports_staff_select_scoped')
  const saveFunctionStart = migration.indexOf('create or replace function public.save_match_day_final_report')
  const grantsStart = migration.indexOf('revoke all on function public.save_match_day_final_report', saveFunctionStart)
  const selectPolicy = migration.slice(selectPolicyStart, saveFunctionStart)
  const saveFunction = migration.slice(saveFunctionStart, grantsStart)

  assert.match(selectPolicy, /current_user_role\(\), ''\) not in \('admin', 'parent_portal', 'super_admin'\)/i)
  assert.match(selectPolicy, /current_user_role_rank\(\), 0\) >= 20/i)
  assert.match(selectPolicy, /club_id = public\.current_user_club_id\(\)/i)
  assert.match(selectPolicy, /match_day\.status = 'full_time'/i)
  assert.match(selectPolicy, /public\.can_read_match_day\(match_day\.team_id\)/i)
  assert.match(saveFunction, /match_row\.status <> 'full_time'/i)
  assert.match(saveFunction, /match_row\.club_id is distinct from public\.current_user_club_id\(\)/i)
  assert.match(saveFunction, /current_user_role\(\), ''\) in \('admin', 'parent_portal', 'super_admin'\)/i)
  assert.match(saveFunction, /not coalesce\(public\.can_read_match_day\(match_row\.team_id\), false\)/i)
  assert.match(migration, /revoke execute on function public\.save_match_day_final_report\(uuid, text\) from anon/i)
  assert.doesNotMatch(migration, /grant execute on function public\.save_match_day_final_report\(uuid, text\) to anon/i)
})

test('staff domain saves through the scoped full-time RPC and strips reports from parent normalization', async () => {
  const domain = await readFile(domainUrl, 'utf8')
  const saveStart = domain.indexOf('export async function saveMatchDayFinalReport')
  const parentStart = domain.indexOf('function normalizeParentPortalMatchDay')
  const parentEnd = domain.indexOf('function assertStaffMatchDayAccess', parentStart)
  const saveSource = domain.slice(saveStart, domain.indexOf('export async function getParentPortalMatchDays', saveStart))
  const parentSource = domain.slice(parentStart, parentEnd)

  assert.match(domain, /match_day_final_reports \(\*\)/)
  assert.match(saveSource, /assertStaffMatchDayAccess\(user\)/)
  assert.match(saveSource, /assertMatchInActiveTeamScope\(user, match\)/)
  assert.match(saveSource, /isFinalMatchReportAvailable\(match\)/)
  assert.match(saveSource, /supabase\.rpc\('save_match_day_final_report'/)
  assert.match(parentSource, /delete match\.finalReport/)
})

test('completed game and Previous Games UI expose one mobile-safe staff report entry point', async () => {
  const page = await readFile(pageUrl, 'utf8')
  const parentPage = await readFile(parentPageUrl, 'utf8')
  const reportStart = page.indexOf('function FinalMatchReportPanel')
  const reportEnd = page.indexOf('function MatchDayCard', reportStart)
  const reportSource = page.slice(reportStart, reportEnd)
  const previousStart = page.indexOf('<h2 className="mt-1 text-xl font-black tracking-tight text-[#101828]">Previous games</h2>')
  const previousEnd = page.indexOf('<ConfirmModal', previousStart)
  const previousSource = page.slice(previousStart, previousEnd)

  assert.match(page, /const isFinalReportAvailable = match\.status === 'full_time'/)
  assert.match(page, />\s*Final Match Report\s*</)
  assert.match(reportSource, /Staff notes/)
  assert.match(reportSource, /Save report/)
  assert.match(reportSource, /No match summary has been saved yet\./)
  assert.match(reportSource, /Clock/)
  assert.match(reportSource, /Continuous clock/)
  assert.match(reportSource, /Home or away/)
  assert.match(reportSource, /getMatchDayDisplayScore\(match\)/)
  assert.match(reportSource, /Final timeline/)
  assert.match(reportSource, /event\.eventStatus === 'voided' \? 'Voided'/)
  assert.match(reportSource, /w-full sm:w-auto/)
  assert.match(previousSource, /<MatchDayCard/)
  assert.match(previousSource, /onFinalReportSave=\{handleFinalReportSave\}/)
  assert.doesNotMatch(parentPage, /Final Match Report|Staff notes|match_day_final_reports/)
})

test('report migration has no email, parent-sharing, scoring, timer, undo, or resource side effects', async () => {
  const migration = await readFile(migrationUrl, 'utf8')

  assert.doesNotMatch(migration, /scheduled_email_queue|send_email|parent_visible|public_link|push/i)
  assert.doesNotMatch(migration, /update public\.match_days|match_day_events|timer_|home_score|away_score|void_match_day/i)
  assert.doesNotMatch(migration, /resource_library/i)
})
