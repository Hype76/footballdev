import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'

const manifestUrl = new URL('../src/lib/matchday-capability-manifest.js', import.meta.url)
const pageUrl = new URL('../src/pages/MatchDayPage.jsx', import.meta.url)
const migrationUrl = new URL('../supabase/migrations/20260803170012_fp_v1_gameday_capability_restoration_31a.sql', import.meta.url)

test('31A keeps one complete canonical Game Day capability matrix', async () => {
  const manifest = await import(`${manifestUrl.href}?31a=${Date.now()}`)
  const rows = manifest.MATCH_DAY_CAPABILITY_MATRIX
  const requiredFields = [
    'key',
    'category',
    'name',
    'historicalEvidence',
    'currentSource',
    'serverAction',
    'databaseModel',
    'requiredStates',
    'requiredRoles',
    'desktopReachability',
    'mobileReachability',
    'scorerModeReachability',
    'currentProductionStatus',
    'restorationRequired',
    'testCoverage',
    'auditRequirement',
  ]

  assert.ok(rows.length >= 25)
  assert.equal(new Set(rows.map((row) => row.key)).size, rows.length)
  for (const row of rows) {
    for (const field of requiredFields) assert.ok(Object.hasOwn(row, field), `${row.key} is missing ${field}`)
  }

  const requiredInspectionKeys = [
    'open_game_mode',
    'start_match',
    'pause_resume',
    'half_time_second_half',
    'full_time_conclude_reopen',
    'cancel_postpone',
    'timer_period_correction',
    'goal',
    'goal_details',
    'goal_correction_undo',
    'score_correction',
    'timeline',
    'yellow_card',
    'red_card',
    'second_yellow',
    'card_note_undo',
    'card_edit_post_match',
    'substitution',
    'water_break',
    'squad_selection',
    'bench_participation_minutes',
    'remove_from_match',
    'player_of_match',
    'fixture_details',
    'roles',
    'availability_players',
    'parent_updates',
    'transport',
    'match_notes',
    'previous_games',
    'report_export',
  ]
  for (const key of requiredInspectionKeys) assert.ok(rows.some((row) => row.key === key), `${key} is not inventoried`)

  const restoredKeys = rows.filter((row) => row.restorationRequired).map((row) => row.key).sort()
  assert.deepEqual(restoredKeys, ['red_card', 'substitution', 'water_break', 'yellow_card'])
})

test('31A direct live actions come from the canonical registry on desktop and mobile', async () => {
  const [manifest, page] = await Promise.all([
    import(`${manifestUrl.href}?31a-actions=${Date.now()}`),
    readFile(pageUrl, 'utf8'),
  ])
  const actions = manifest.MATCH_DAY_LIVE_EVENT_ACTIONS

  assert.deepEqual(actions.map((action) => action.key), ['goal', 'yellow_card', 'red_card', 'substitution', 'water_break'])
  assert.ok(actions.every((action) => action.desktop && action.mobile && action.demoSupport))
  assert.equal(actions.find((action) => action.key === 'goal').scorerMode, true)
  assert.ok(actions.filter((action) => action.key !== 'goal').every((action) => action.scorerMode === false))
  assert.match(page, /MATCH_DAY_LIVE_EVENT_ACTIONS\.map\(\(action\) =>/)
  assert.match(page, /data-match-day-action=\{action\.key\}/)
  assert.match(page, /onOpenEventModal\(match, action\.eventType\)/)
  assert.doesNotMatch(page, />Event<\/button>/)
})

test('31A limits own-team card and substitution choices to the selected Match squad', async () => {
  const page = await readFile(pageUrl, 'utf8')

  assert.match(page, /function getParticipatingMatchPlayers\(match, players = \[\]\)/)
  assert.match(page, /normalizeMatchDaySquadDecision\(decision\?\.status\) === 'selected'/)
  assert.match(page, /Choose a selected Match squad Player before recording this event\./)
  assert.match(page, /Choose a selected Match squad Player On before recording this substitution\./)
  assert.match(page, /<LiveMatchEntryModal[\s\S]*players=\{getParticipatingMatchPlayers\(liveEntryMatch, squadPlayers\)\}/)
  assert.match(page, /disabled=\{isBusy \|\| !hasRequiredSelectedClubPlayers\}/)
})

test('31A server boundary rejects cross-Team and non-participating own-team events', async () => {
  const migration = await readFile(migrationUrl, 'utf8')
  const idempotencyPosition = migration.indexOf('if event_row.id is not null then')
  const participantPosition = migration.indexOf("if normalized_team_side = 'club' and normalized_event_type <> 'water_break' then")

  assert.ok(idempotencyPosition > 0)
  assert.ok(participantPosition > idempotencyPosition, 'idempotent retries must return before current squad validation')
  assert.match(migration, /if not public\.can_manage_match_day\(match_row\.team_id\)/)
  assert.match(migration, /decision\.match_day_id = match_row\.id/)
  assert.match(migration, /decision\.club_id = match_row\.club_id/)
  assert.match(migration, /decision\.team_id = match_row\.team_id/)
  assert.match(migration, /decision\.status = 'selected'/)
  assert.match(migration, /player\.team_id = match_row\.team_id/)
  assert.match(migration, /participant_match_count <> 1/)
  assert.match(migration, /participant_player_id = participant_player_on_id/)
  assert.match(migration, /'playerId', participant_player_id/)
  assert.match(migration, /'playerOnId', participant_player_on_id/)
  assert.match(migration, /'capabilityRelease', 'FP-V1-GAMEDAY-CAPABILITY-RESTORATION-31A'/)
  assert.match(migration, /grant execute on function public\.record_match_day_staff_event_v2[\s\S]*to authenticated, service_role/)
})
