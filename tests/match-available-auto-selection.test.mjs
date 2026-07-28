import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'

const migrationUrl = new URL(
  '../supabase/migrations/20260728161800_match_available_auto_selection.sql',
  import.meta.url,
)
const privilegeMigrationUrl = new URL(
  '../supabase/migrations/20260728164000_lock_auto_selection_trigger_function.sql',
  import.meta.url,
)
const matchDayDomainUrl = new URL('../src/lib/domain/match-day.js', import.meta.url)
const matchDayPageUrl = new URL('../src/pages/MatchDayPage.jsx', import.meta.url)
const sessionsPageUrl = new URL('../src/pages/SessionsPage.jsx', import.meta.url)
const workflowUrl = new URL('../src/lib/matchday-workflow.js', import.meta.url)

test('new match fixtures default automatic Available selection on both creation routes', async () => {
  const [domain, matchDayPage, sessionsPage, workflow] = await Promise.all([
    readFile(matchDayDomainUrl, 'utf8'),
    readFile(matchDayPageUrl, 'utf8'),
    readFile(sessionsPageUrl, 'utf8'),
    readFile(workflowUrl, 'utf8'),
  ])

  assert.match(matchDayPage, /const EMPTY_MATCH_FORM = \{[\s\S]*autoSelectAvailablePlayers: true/)
  assert.match(sessionsPage, /function getDefaultCalendarForm[\s\S]*autoSelectAvailablePlayers: true/)
  assert.match(workflow, /autoSelectAvailablePlayers: intent\.autoSelectAvailablePlayers !== false/)
  assert.match(domain, /auto_select_available_players: match\?\.autoSelectAvailablePlayers !== false/)
})

test('the accessible match-only control persists through create and edit without appearing in training', async () => {
  const [matchDayPage, sessionsPage, domain] = await Promise.all([
    readFile(matchDayPageUrl, 'utf8'),
    readFile(sessionsPageUrl, 'utf8'),
    readFile(matchDayDomainUrl, 'utf8'),
  ])
  const controlCopy = /Automatically select players who respond Available/
  const helperCopy = /When enabled, invited players who respond Available will be added to the match selection automatically\./

  assert.match(matchDayPage, controlCopy)
  assert.match(matchDayPage, helperCopy)
  assert.match(matchDayPage, /id="matchday-auto-select-available"[\s\S]*type="checkbox"/)
  assert.match(matchDayPage, /min-h-12/)
  assert.match(sessionsPage, /\{isMatchFixture \? \([\s\S]*name="autoSelectAvailablePlayers"/)
  assert.match(sessionsPage, controlCopy)
  assert.match(sessionsPage, helperCopy)
  assert.match(sessionsPage, /autoSelectAvailablePlayers: source\.autoSelectAvailablePlayers === true/)
  assert.match(sessionsPage, /autoSelectAvailablePlayers: calendarForm\.autoSelectAvailablePlayers === true/)
  assert.match(domain, /updates\.autoSelectAvailablePlayers !== undefined[\s\S]*payload\.auto_select_available_players/)
})

test('server migration preserves existing behavior and contains one-way selection failures', async () => {
  const [migration, privilegeMigration] = await Promise.all([
    readFile(migrationUrl, 'utf8'),
    readFile(privilegeMigrationUrl, 'utf8'),
  ])

  assert.match(migration, /add column if not exists auto_select_available_players boolean not null default false/)
  assert.match(migration, /alter column auto_select_available_players set default true/)
  assert.match(migration, /after insert or update of status[\s\S]*match_day_player_availability/)
  assert.match(migration, /if new\.status <> 'available'/)
  assert.match(migration, /if old\.status = 'available'[\s\S]*return new/)
  assert.match(migration, /match_row\.status not in \('scheduled', 'scorer_request'\)/)
  assert.match(migration, /player_row\.section <> 'Squad'/)
  assert.match(migration, /calendar_event_invites[\s\S]*match_day_availability_requests/)
  assert.match(migration, /on conflict on constraint match_day_player_squad_decisions_match_player_key/)
  assert.match(migration, /exception[\s\S]*failure_category[\s\S]*selection_constraint/)
  assert.match(migration, /return new;[\s\S]*exception[\s\S]*return new;/)
  assert.match(migration, /'responseSource', response_source/)
  assert.match(migration, /'automaticSelectionSucceeded', automatic_selection_succeeded/)
  assert.match(migration, /'selectionRecordCreated', selection_record_created/)
  assert.doesNotMatch(migration, /notification_queue|scheduled_email|send_email/)
  assert.match(privilegeMigration, /revoke all on function public\.handle_match_day_available_auto_selection\(\)/)
  assert.match(privilegeMigration, /from public, anon, authenticated, service_role/)
})

test('staff receives the exact safe failure message while parent availability remains separate', async () => {
  const matchDayPage = await readFile(matchDayPageUrl, 'utf8')

  assert.match(matchDayPage, /Player marked Available but could not be added to the match selection\./)
  const sessionsPage = await readFile(sessionsPageUrl, 'utf8')
  assert.match(sessionsPage, /Player marked Available but could not be added to the match selection\./)
  assert.match(sessionsPage, /latestAutomaticSelection\?\.metadata\?\.automaticSelectionSucceeded === false/)
  assert.match(sessionsPage, /tone: automaticSelectionFailed \? 'warning' : undefined/)
  assert.match(matchDayPage, /entry\.metadata\?\.source === 'availability_auto_selection'/)
  assert.match(matchDayPage, /automaticSelectionSucceeded === false/)
  assert.match(matchDayPage, /Availability answers whether a player can play\./)
})
