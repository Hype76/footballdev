import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { test } from 'node:test'

import {
  assertValidMatchDayFixtureType,
  getMatchDayFixtureTypeLabel,
  MATCH_DAY_FIXTURE_TYPE_OPTIONS,
  normalizeMatchDayFixtureType,
} from '../src/lib/matchday-fixture-type.js'
import { normalizeFixtureSetupIntent } from '../src/lib/matchday-workflow.js'

const migration = readFileSync(
  new URL('../supabase/migrations/20260717170408_matchday_fixture_controls.sql', import.meta.url),
  'utf8',
)
const matchDayDomain = readFileSync(new URL('../src/lib/domain/match-day.js', import.meta.url), 'utf8')
const matchDayPage = readFileSync(new URL('../src/pages/MatchDayPage.jsx', import.meta.url), 'utf8')
const sessionsPage = readFileSync(new URL('../src/pages/SessionsPage.jsx', import.meta.url), 'utf8')

test('fixture classification accepts only the four V1 values and keeps legacy display safe', () => {
  assert.deepEqual(MATCH_DAY_FIXTURE_TYPE_OPTIONS.map((option) => option.value), [
    'friendly',
    'league',
    'cup',
    'tournament',
  ])
  assert.equal(normalizeMatchDayFixtureType(' League '), 'league')
  assert.equal(normalizeMatchDayFixtureType('playoff'), '')
  assert.equal(assertValidMatchDayFixtureType('cup'), 'cup')
  assert.throws(() => assertValidMatchDayFixtureType(''), /Choose Friendly, League, Cup, or Tournament/)
  assert.equal(getMatchDayFixtureTypeLabel('tournament'), 'Tournament')
  assert.equal(getMatchDayFixtureTypeLabel(null), 'Not set')
})

test('calendar to Match Day intent preserves fixture classification', () => {
  const intent = normalizeFixtureSetupIntent({ fixtureType: 'friendly', opponent: 'Jeluma QA' })
  assert.equal(intent.fixtureType, 'friendly')
  assert.match(sessionsPage, /fixtureType: calendarForm\.fixtureType/)
  assert.match(sessionsPage, /name="fixtureType"/)
  assert.match(sessionsPage, /assertValidMatchDayFixtureType\(form\.fixtureType\)/)
})

test('new fixtures persist classification while legacy null values remain readable', () => {
  assert.match(migration, /fixture_type is null or fixture_type in \('friendly', 'league', 'cup', 'tournament'\)/)
  assert.match(matchDayDomain, /const fixtureType = assertValidMatchDayFixtureType\(match\?\.fixtureType\)/)
  assert.match(matchDayDomain, /fixture_type: fixtureType/)
  assert.match(matchDayDomain, /fixtureType: normalizeMatchDayFixtureType\(row\.fixture_type/)
  assert.match(matchDayPage, /Choose fixture type/)
  assert.match(matchDayPage, /getMatchDayFixtureTypeLabel\(match\.fixtureType\)/)
})

test('opening Game Mode is read only until Start match is pressed', () => {
  const openStart = matchDayPage.indexOf('const handleGameModeOpen = (match) => {')
  const openEnd = matchDayPage.indexOf('const handleGameModeStatusChange', openStart)
  assert.notEqual(openStart, -1)
  assert.notEqual(openEnd, -1)
  const openHandler = matchDayPage.slice(openStart, openEnd)

  assert.match(openHandler, /setGameModeMatchId\(match\.id\)/)
  assert.doesNotMatch(openHandler, /saveMatchStatus|setMatchDayTimerState|updateMatchDay/)
  assert.match(matchDayPage, /Game Mode is open, but the match clock has not started/)
  assert.match(matchDayPage, /onClick=\{\(\) => onStartMatch\(match\)\}/)
  assert.match(matchDayPage, /const liveControlsDisabled = isBusy \|\| isFullTime \|\| isReady/)
  assert.doesNotMatch(matchDayDomain, /await setMatchDayTimerState\(\{ user, match, action: 'start' \}\)/)
  assert.match(matchDayDomain, /supabase\.rpc\('start_match_day'/)
  assert.match(matchDayPage, /saveTimerAction: startMatchDay/)
  assert.match(matchDayDomain, /Start the match before recording goals or events\./)
})

test('timer start remains server serialized and keeps one clock origin', () => {
  const timerMigration = readFileSync(
    new URL('../supabase/migrations/20260713090040_match_day_reversible_full_time_continuous_clock.sql', import.meta.url),
    'utf8',
  )

  assert.match(timerMigration, /where id = match_day_id_value\s+for update;/)
  assert.match(timerMigration, /next_timer_started_at := coalesce\(effective_started_at, match_row\.timer_started_at, match_row\.phase_started_at, now_value\)/)
  assert.match(timerMigration, /'action', normalized_action/)
  assert.match(migration, /create or replace function public\.start_match_day\(match_day_id_value uuid\)/)
  assert.match(migration, /for update;/)
  assert.match(migration, /'alreadyStarted', true/)
  assert.match(migration, /from public\.team_staff assignment/)
  assert.match(migration, /actor_profile\.status = 'active'/)
})

test('previous game deletion is soft, idempotent, audited, and fail closed', () => {
  assert.match(migration, /create or replace function public\.delete_previous_match_day\(match_day_id_value uuid\)/)
  assert.match(migration, /for update;/)
  assert.match(migration, /actor_role_rank < 50/)
  assert.match(migration, /from public\.team_staff assignment/)
  assert.match(migration, /match_row\.club_id <> actor_club_id/)
  assert.match(migration, /'alreadyDeleted', true/)
  assert.match(migration, /deleted_at = now_value/)
  assert.doesNotMatch(migration, /delete from public\.match_days/)
  assert.match(migration, /'previous_game_deleted'/)
  assert.match(migration, /'match_day_previous_game_deleted'/)
  assert.match(migration, /retainedRecordCounts/)
  assert.match(migration, /pending notification work/)
  assert.match(migration, /revoke execute on function public\.delete_previous_match_day\(uuid\) from anon/)
  assert.match(migration, /grant execute on function public\.delete_previous_match_day\(uuid\) to authenticated/)
})

test('deleted fixtures are hidden from staff, parent, and delivery lookups', () => {
  assert.match(matchDayDomain, /\.from\('match_days'\)[\s\S]*?\.is\('deleted_at', null\)/)
  assert.match(migration, /where fixture\.deleted_at is null/)
  assert.match(migration, /prevent_deleted_match_day_update/)
  assert.match(matchDayPage, /Delete previous game/)
  assert.match(matchDayPage, /Match history, reports, availability, notification ledgers, and audit evidence will be retained/)

  for (const path of [
    '../netlify/functions/send-match-day-availability-requests.js',
    '../netlify/functions/select-match-day-volunteer.js',
    '../netlify/functions/send-match-day-push.js',
    '../netlify/functions/send-coach-mobile-push.js',
  ]) {
    const source = readFileSync(new URL(path, import.meta.url), 'utf8')
    assert.match(source, /\.is\('deleted_at', null\)/)
  }
})

test('successful deletion stays explicit when the canonical refresh fails', () => {
  const start = matchDayPage.indexOf('const performDeletePrevious = async (match) => {')
  const end = matchDayPage.indexOf('const handleFinalReportSave = async', start)
  assert.notEqual(start, -1)
  assert.notEqual(end, -1)
  const handler = matchDayPage.slice(start, end)

  assert.match(handler, /await deletePreviousMatchDay\(\{ user, match \}\)/)
  assert.match(handler, /setPendingMatchAction\(null\)[\s\S]*try \{[\s\S]*await loadData\(\)/)
  assert.match(handler, /The game was deleted, but Match Day could not be refreshed/)
  assert.match(handler, /tone: 'warning'/)
})
