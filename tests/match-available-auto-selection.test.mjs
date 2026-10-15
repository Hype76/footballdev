import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'
import vm from 'node:vm'
import { loadMatchDayAutoSelectDefault, readMatchDayAutoSelectDefault, rememberMatchDayAutoSelectDefault } from '../src/lib/matchday-auto-select-default.js'
import { normalizeFixtureSetupIntent } from '../src/lib/matchday-workflow.js'

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

test('new website matches default off and both entry points restore the saved choice', async () => {
  const [domain, matchDayPage, sessionsPage, workflow] = await Promise.all([
    readFile(matchDayDomainUrl, 'utf8'),
    readFile(matchDayPageUrl, 'utf8'),
    readFile(sessionsPageUrl, 'utf8'),
    readFile(workflowUrl, 'utf8'),
  ])

  assert.match(matchDayPage, /const EMPTY_MATCH_FORM = \{[\s\S]*autoSelectAvailablePlayers: false/)
  assert.match(sessionsPage, /function getDefaultCalendarForm[\s\S]*autoSelectAvailablePlayers: false/)
  assert.match(matchDayPage, /loadMatchDayAutoSelectDefault\(user, preferenceTeamId, getOwnMatchSelectionPreference\)/)
  const handoff = sessionsPage.slice(sessionsPage.indexOf('const openCalendarMatchDayWorkflow ='), sessionsPage.indexOf('const handleCalendarFormChange ='))
  assert.doesNotMatch(handoff, /autoSelectAvailablePlayers:/)
  assert.match(workflow, /typeof intent\.autoSelectAvailablePlayers === 'boolean'/)
  assert.match(domain, /auto_select_available_players: match\?\.autoSelectAvailablePlayers !== false/)
})

function memoryStorage() {
  const values = new Map()
  return {
    getItem: (key) => values.get(key) ?? null,
    setItem: (key, value) => values.set(key, value),
  }
}

test('saved true and false choices survive reopening and stay scoped to staff, club and team', () => {
  const storage = memoryStorage()
  const user = { id: 'coach', clubId: 'club', activeTeamId: 'team' }
  assert.equal(readMatchDayAutoSelectDefault(user, undefined, storage), false)
  rememberMatchDayAutoSelectDefault(user, 'team', true, storage)
  assert.equal(readMatchDayAutoSelectDefault({ ...user }, 'team', storage), true)
  assert.equal(readMatchDayAutoSelectDefault({ ...user, id: 'other' }, 'team', storage), false)
  assert.equal(readMatchDayAutoSelectDefault({ ...user, clubId: 'other' }, 'team', storage), false)
  assert.equal(readMatchDayAutoSelectDefault(user, 'other', storage), false)
  assert.equal(readMatchDayAutoSelectDefault(user, '', storage), false)
  rememberMatchDayAutoSelectDefault(user, '', true, storage)
  assert.equal(readMatchDayAutoSelectDefault(user, '', storage), true)
  rememberMatchDayAutoSelectDefault(user, 'team', false, storage)
  assert.equal(readMatchDayAutoSelectDefault(user, 'team', storage), false)
})

test('missing identity, malformed data and blocked storage safely default off', () => {
  const user = { id: 'coach', clubId: 'club', activeTeamId: 'team' }
  const blocked = { getItem() { throw new Error('blocked') }, setItem() { throw new Error('full') } }
  assert.equal(readMatchDayAutoSelectDefault(user, 'team', blocked), false)
  assert.doesNotThrow(() => rememberMatchDayAutoSelectDefault(user, 'team', true, blocked))
  assert.equal(readMatchDayAutoSelectDefault({}, 'team', memoryStorage()), false)
  for (const value of [null, '', 'TRUE', '1', '{}', 'false']) {
    assert.equal(readMatchDayAutoSelectDefault(user, 'team', { getItem: () => value }), false)
  }
})

test('fixture handoff preserves explicit choices and lets omitted choices use the saved default', () => {
  assert.equal(Object.hasOwn(normalizeFixtureSetupIntent({}), 'autoSelectAvailablePlayers'), false)
  for (const choice of [true, false]) {
    assert.equal(normalizeFixtureSetupIntent({ autoSelectAvailablePlayers: choice }).autoSelectAvailablePlayers, choice)
  }
})

test('fixture writes remain authoritative while new forms refresh cached preferences safely', async () => {
  const matchDayPage = await readFile(matchDayPageUrl, 'utf8')
  const sessionsPage = await readFile(sessionsPageUrl, 'utf8')
  assert.match(matchDayPage, /const createdMatch = await createMatchDay\([\s\S]*rememberMatchDayAutoSelectDefault\(user, teamId, submittedForm\.autoSelectAvailablePlayers\)/)
  assert.match(sessionsPage, /const savedMatch = await updateMatchDay\([\s\S]*rememberMatchDayAutoSelectDefault\(user, safeTeamId, payload\.autoSelectAvailablePlayers\)/)
  assert.match(sessionsPage, /if \(calendarModal\?\.mode === 'create'\) \{\s*nextForm\.autoSelectAvailablePlayers = readMatchDayAutoSelectDefault/)
  assert.match(matchDayPage, /if \(preferenceRequest !== fixturePreferenceRequestRef.current\) return/)
  assert.match(matchDayPage, /if \(request !== fixturePreferenceRequestRef.current\) return/)
  assert.equal((matchDayPage.match(/rememberMatchDayAutoSelectDefault\(/g) || []).length, 3)
  assert.equal((sessionsPage.match(/rememberMatchDayAutoSelectDefault\(/g) || []).length, 1)
})

test('fresh server values override old device values and offline reads retain the last known cache', async () => {
  const storage = memoryStorage()
  const user = { id: 'coach', clubId: 'club', activeTeamId: 'team' }
  rememberMatchDayAutoSelectDefault(user, 'team', true, storage)
  assert.equal(await loadMatchDayAutoSelectDefault(user, 'team', async () => ({ found: true, autoSelectAvailablePlayers: false }), storage), false)
  assert.equal(await loadMatchDayAutoSelectDefault(user, 'team', async () => ({ found: false }), storage), false)
  assert.equal(await loadMatchDayAutoSelectDefault(user, 'team', async () => { throw new Error('offline') }, storage), true)
  assert.equal(await loadMatchDayAutoSelectDefault(user, 'other', async () => { throw new Error('offline') }, storage), false)
})

test('a stalled server read expires and a late response cannot replace the cached choice', async () => {
  const domain = await readFile(new URL('../src/lib/domain/team-actions.js', import.meta.url), 'utf8')
  const cache = await readFile(new URL('../src/lib/domain/cache-store.js', import.meta.url), 'utf8')
  const getter = domain.slice(domain.indexOf('export async function getOwnMatchSelectionPreference'), domain.indexOf('export async function updateOwnTeamFixturePreferences')).replace('export ', '')
  const timeout = cache.slice(cache.indexOf('export async function withRequestTimeout'), cache.indexOf('export function readViewCache')).replace('export ', '')
  let finishRead
  const context = vm.createContext({
    REQUEST_TIMEOUT_MS: 8000,
    window: { setTimeout: (callback, milliseconds) => { assert.equal(milliseconds, 8000); return setTimeout(callback, 1) }, clearTimeout },
    blockDemoMutation: async () => {},
    supabase: { rpc: () => new Promise(resolve => { finishRead = resolve }) },
  })
  vm.runInContext(timeout + getter, context)
  const user = { id: 'coach', clubId: 'club', activeTeamId: 'team' }
  const storage = memoryStorage()
  rememberMatchDayAutoSelectDefault(user, 'team', false, storage)
  assert.equal(await loadMatchDayAutoSelectDefault(user, 'team', context.getOwnMatchSelectionPreference, storage), false)
  finishRead({ data: { found: true, autoSelectAvailablePlayers: true } })
  await new Promise(resolve => setTimeout(resolve, 1))
  assert.equal(readMatchDayAutoSelectDefault(user, 'team', storage), false)
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
