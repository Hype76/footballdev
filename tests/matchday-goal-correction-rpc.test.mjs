import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { test } from 'node:test'

const migrationUrl = new URL('../supabase/migrations/20260708064812_matchday_goal_correction_rpc.sql', import.meta.url)
const domainUrl = new URL('../src/lib/domain/match-day.js', import.meta.url)
const staffPageUrl = new URL('../src/pages/MatchDayPage.jsx', import.meta.url)
const parentPageUrl = new URL('../src/pages/ParentPortalPage.jsx', import.meta.url)
const goalStateUrl = new URL('../src/lib/matchday-goal-state.js', import.meta.url)
const netlifyTomlUrl = new URL('../netlify.toml', import.meta.url)
const safetyScriptUrl = new URL('../scripts/netlify-deploy-safety-check.mjs', import.meta.url)

test('goal correction migration adds correction metadata without direct event delete policies', async () => {
  const migration = await readFile(migrationUrl, 'utf8')

  assert.match(migration, /alter table public\.match_day_events[\s\S]*add column if not exists event_status text not null default 'active'/i)
  assert.match(migration, /add column if not exists correction_metadata jsonb not null default '\{\}'::jsonb/i)
  assert.match(migration, /match_day_events_event_status_check[\s\S]*event_status in \('active', 'corrected', 'voided'\)/i)
  assert.match(migration, /match_day_events_correction_metadata_object_check[\s\S]*jsonb_typeof\(correction_metadata\) = 'object'/i)
  assert.doesNotMatch(migration, /create policy[\s\S]*on public\.match_day_events[\s\S]*for update/i)
  assert.doesNotMatch(migration, /create policy[\s\S]*on public\.match_day_events[\s\S]*for delete/i)
  assert.doesNotMatch(migration, /delete from public\.match_day_events/i)
})

test('goal correction RPC verifies staff or selected scorer parent server-side', async () => {
  const migration = await readFile(migrationUrl, 'utf8')

  assert.match(migration, /create or replace function public\.correct_match_day_goal/i)
  assert.match(migration, /create or replace function public\.void_match_day_goal/i)
  assert.match(migration, /security definer[\s\S]*set search_path = public/i)
  assert.match(migration, /actor_user_id uuid := auth\.uid\(\)/i)
  assert.match(migration, /if actor_user_id is null then[\s\S]*Login is required/i)
  assert.match(migration, /public\.can_manage_match_day\(match_row\.team_id\)/i)
  assert.match(migration, /from public\.parent_player_links[\s\S]*auth_user_id = actor_user_id[\s\S]*status = 'active'[\s\S]*club_id = match_row\.club_id/i)
  assert.match(migration, /from public\.match_day_scorer_assignments assignment[\s\S]*assignment\.match_day_id = match_row\.id[\s\S]*assignment\.parent_link_id = link_row\.id[\s\S]*assignment\.auth_user_id = actor_user_id/i)
  assert.match(migration, /Only selected scorers can correct this match/i)
  assert.match(migration, /Only selected scorers can remove this goal/i)
  assert.match(migration, /revoke execute on function public\.correct_match_day_goal[\s\S]*from anon/i)
  assert.match(migration, /grant execute on function public\.correct_match_day_goal[\s\S]*to authenticated/i)
})

test('goal correction RPC locks match and event rows and adjusts score atomically', async () => {
  const migration = await readFile(migrationUrl, 'utf8')

  assert.match(migration, /from public\.match_days[\s\S]*where id = match_day_id_value[\s\S]*for update/i)
  assert.match(migration, /from public\.match_day_events[\s\S]*where id = goal_event_id_value[\s\S]*for update/i)
  assert.match(migration, /if event_row\.event_type <> 'goal' then[\s\S]*Only goal events can be corrected/i)
  assert.match(migration, /if event_row\.event_status = 'voided' then[\s\S]*already been removed/i)
  assert.match(migration, /next_home_score := next_home_score - 1/i)
  assert.match(migration, /next_away_score := next_away_score - 1/i)
  assert.match(migration, /next_home_score := next_home_score \+ 1/i)
  assert.match(migration, /next_away_score := next_away_score \+ 1/i)
  assert.match(migration, /if next_home_score < 0 or next_away_score < 0 then[\s\S]*score negative/i)
  assert.match(migration, /update public\.match_days[\s\S]*home_score = next_home_score[\s\S]*away_score = next_away_score/i)
  assert.match(migration, /update public\.match_day_events[\s\S]*event_status = 'corrected'/i)
  assert.match(migration, /update public\.match_day_events[\s\S]*event_status = 'voided'/i)
})

test('goal correction RPC records audit clarity and refreshes parent event JSON', async () => {
  const migration = await readFile(migrationUrl, 'utf8')

  assert.match(migration, /insert into public\.match_day_event_log/i)
  assert.match(migration, /'Goal corrected'/i)
  assert.match(migration, /'Goal removed'/i)
  assert.match(migration, /'correctionAction', 'corrected'/i)
  assert.match(migration, /'correctionAction', 'voided'/i)
  assert.match(migration, /'source', 'match_day_goal_correction_rpc'/i)
  assert.match(migration, /drop function if exists public\.get_parent_portal_match_days\(uuid\)/i)
  assert.match(migration, /'eventStatus', event\.event_status/i)
  assert.match(migration, /'correctedAt', event\.corrected_at/i)
  assert.match(migration, /'voidedAt', event\.voided_at/i)
  assert.match(migration, /'correctionReason', event\.correction_reason/i)
  assert.match(migration, /revoke execute on function public\.get_parent_portal_match_days\(uuid\) from anon/i)
})

test('domain wrappers call correction RPCs without direct event table updates', async () => {
  const domain = await readFile(domainUrl, 'utf8')
  const correctionStart = domain.indexOf('export async function correctStaffMatchDayGoal')
  const correctionEnd = domain.indexOf('export async function addStaffMatchDayEvent', correctionStart)
  const scorerCorrectionStart = domain.indexOf('export async function correctMatchDayGoalAsScorer')
  const scorerCorrectionSource = domain.slice(scorerCorrectionStart)
  const correctionSource = `${domain.slice(correctionStart, correctionEnd)}\n${scorerCorrectionSource}`

  assert.match(domain, /export async function correctStaffMatchDayGoal/)
  assert.match(domain, /export async function voidStaffMatchDayGoal/)
  assert.match(domain, /export async function correctMatchDayGoalAsScorer/)
  assert.match(domain, /export async function voidMatchDayGoalAsScorer/)
  assert.match(correctionSource, /supabase\.rpc\('correct_match_day_goal'/)
  assert.match(correctionSource, /supabase\.rpc\('void_match_day_goal'/)
  assert.match(correctionSource, /assertStaffMatchDayAccess\(user\)/)
  assert.match(correctionSource, /assertMatchInActiveTeamScope\(user, match\)/)
  assert.doesNotMatch(correctionSource, /\.from\('match_day_events'\)[\s\S]*\.update\(/)
  assert.doesNotMatch(correctionSource, /\.from\('match_day_events'\)[\s\S]*\.delete\(/)
})

test('staff and scorer UI expose correction controls only through RPC handlers', async () => {
  const staffPage = await readFile(staffPageUrl, 'utf8')
  const parentPage = await readFile(parentPageUrl, 'utf8')

  assert.match(staffPage, /const handleCorrectGoal = async \(match, goalEvent\) =>/)
  assert.match(staffPage, /await correctStaffMatchDayGoal\(/)
  assert.match(staffPage, /await voidStaffMatchDayGoal\(/)
  assert.match(staffPage, /reconcileMatchDayGoalCorrectionInList/)
  assert.match(staffPage, /onCorrectGoal=\{onCorrectGoal\}/)
  assert.match(staffPage, /onVoidGoal=\{onVoidGoal\}/)
  assert.match(staffPage, /event\.eventType === 'goal' && event\.eventStatus !== 'voided'/)
  assert.match(parentPage, /await correctMatchDayGoalAsScorer\(/)
  assert.match(parentPage, /await voidMatchDayGoalAsScorer\(/)
  assert.match(parentPage, /if \(!selectedLink\?\.id \|\| !match\.isScorer\)/)
  assert.match(parentPage, /match\.isScorer && event\.eventType === 'goal' && event\.eventStatus !== 'voided'/)
  assert.doesNotMatch(parentPage, /\.from\('match_day_events'\)/)
})

test('local goal correction state replaces goal rows and keeps correction history visible', async () => {
  const goalState = await readFile(goalStateUrl, 'utf8')

  assert.match(goalState, /export function reconcileMatchDayGoalCorrection/)
  assert.match(goalState, /export function reconcileMatchDayGoalCorrectionInList/)
  assert.match(goalState, /eventStatus: normalizeText\(event\.eventStatus \?\? event\.event_status\) \|\| 'active'/)
  assert.match(goalState, /currentEvents\.some\(\(event\) => normalizeText\(event\.id\) === correctedEvent\.id\)/)
  assert.match(goalState, /eventLabel: label/)
  assert.match(goalState, /correctionAction: isVoided \? 'voided' : 'corrected'/)
})

test('scheduled email hotfix and production ref safety markers stay present', async () => {
  const netlifyToml = await readFile(netlifyTomlUrl, 'utf8')
  const safetyScript = await readFile(safetyScriptUrl, 'utf8')

  assert.match(netlifyToml, /\[functions\."send-scheduled-emails"\][\s\S]*schedule = "\* \* \* \* \*"/)
  assert.match(safetyScript, /liveProjectRef = 'hvapkizujvsahvgspser'/)
  assert.match(safetyScript, /legacyStagingProjectRef = 'llpufwzvgxyczxcjwupu'/)
})
