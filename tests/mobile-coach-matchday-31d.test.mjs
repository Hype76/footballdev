import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'
import {
  COACH_MATCH_DAY_BACKEND_DELTAS,
  buildCoachFinalMatchReport,
  buildCoachMatchDaySquad,
  createCoachMatchDayEventForm,
  filterCoachMatchDays,
  getCoachMatchDayActions,
  getCoachMatchDayPresentation,
  getCoachMatchDayUndoModel,
  validateCoachMatchDayEventForm,
} from '../apps/mobile-core/src/coachMatchDayCore.js'

const context = Object.freeze({ paymentAccess: { canMutate: true }, role: 'coach', roleRank: 30, teamId: 'team-test' })
const baseMatch = Object.freeze({
  awayScore: 1, concludedAt: '', conclusionRule: 'normal_time', currentMatchPhase: 'first_half', events: [], homeAway: 'home',
  homeScore: 2, id: 'match-1', matchDate: '2026-08-09', matchDurationMinutes: 90, opponent: 'Visitors',
  playerAvailability: [], roleAssignments: [], shootoutEvents: [], squadDecisions: [], status: 'live', teamName: 'FP TEST',
  timerElapsedSeconds: 125, timerStartedAt: '2026-08-09T12:00:00Z', timerStatus: 'paused',
})

test('Match Day presentation preserves home and away score order and canonical lifecycle', () => {
  const view = getCoachMatchDayPresentation(baseMatch, Date.parse('2026-08-09T12:10:00Z'))
  assert.equal(view.displayName, 'FP TEST v Visitors')
  assert.equal(view.displayScore, '2 - 1')
  assert.equal(view.clock, '2:05')
  assert.equal(view.lifecycle, 'paused')
})

test('away fixtures preserve club and opponent display order without rewriting stored score', () => {
  const view = getCoachMatchDayPresentation({ ...baseMatch, homeAway: 'away', homeScore: 3, awayScore: 4 })
  assert.equal(view.displayName, 'Visitors v FP TEST')
  assert.equal(view.displayScore, '3 - 4')
  assert.equal(view.parts.secondScore, 4)
})

test('fixture filters separate live, upcoming, previous, and cancelled states', () => {
  const matches = [
    { ...baseMatch, id: 'live', status: 'live' },
    { ...baseMatch, id: 'future', matchDate: '2026-08-10', status: 'scheduled' },
    { ...baseMatch, id: 'past', matchDate: '2026-08-08', status: 'full_time' },
    { ...baseMatch, id: 'cancelled', status: 'cancelled' },
  ]
  const now = new Date('2026-08-09T12:00:00Z')
  assert.deepEqual(filterCoachMatchDays(matches, 'current', now).map((item) => item.id), ['live'])
  assert.deepEqual(filterCoachMatchDays(matches, 'upcoming', now).map((item) => item.id), ['future'])
  assert.deepEqual(filterCoachMatchDays(matches, 'previous', now).map((item) => item.id), ['past'])
  assert.equal(filterCoachMatchDays(matches, 'all', now).length, 4)
})

test('payment-required, stale, closed, and insufficient-role contexts fail closed', () => {
  const empty = getCoachMatchDayActions({ context, match: null })
  assert.match(empty.blockedReason, /Select a fixture/)
  assert.equal(empty.canMutate, false)
  assert.deepEqual(empty.timerActions, [])
  assert.match(getCoachMatchDayActions({ context: { ...context, paymentAccess: { canMutate: false } }, match: baseMatch }).blockedReason, /payment/)
  assert.match(getCoachMatchDayActions({ context, match: baseMatch, stale: true }).blockedReason, /Reconnect/)
  assert.match(getCoachMatchDayActions({ context, match: { ...baseMatch, concludedAt: '2026-08-09T14:00:00Z' } }).blockedReason, /closed/)
  assert.match(getCoachMatchDayActions({ context: { ...context, roleRank: 10 }, match: baseMatch }).blockedReason, /Coach or manager/)
  assert.match(getCoachMatchDayActions({ context: { ...context, role: 'admin', roleRank: 90 }, match: baseMatch }).blockedReason, /Coach or manager/)
})

test('hidden and archived previous fixtures never reappear in mobile lists', () => {
  const matches = [
    { ...baseMatch, id: 'visible', matchDate: '2026-08-08', status: 'full_time' },
    { ...baseMatch, id: 'hidden', matchDate: '2026-08-08', previousHiddenAt: '2026-08-09T10:00:00Z', status: 'full_time' },
    { ...baseMatch, deletedAt: '2026-08-09T10:00:00Z', id: 'deleted', matchDate: '2026-08-08', status: 'full_time' },
  ]
  assert.deepEqual(filterCoachMatchDays(matches, 'all', new Date('2026-08-09T12:00:00Z')).map((item) => item.id), ['visible'])
})

test('timer actions derive from canonical lifecycle including reversible Full Time', () => {
  assert.deepEqual(getCoachMatchDayActions({ context, match: { ...baseMatch, status: 'scheduled', timerStatus: 'not_started' } }).timerActions.map((item) => item.action), ['start'])
  assert.deepEqual(getCoachMatchDayActions({ context, match: { ...baseMatch, status: 'full_time', timerStatus: 'full_time' } }).timerActions.map((item) => item.action), ['resume', 'conclude'])
})

test('Start match is unavailable when the server confirms that the fixture date is not today', () => {
  const actions = getCoachMatchDayActions({
    context,
    match: { ...baseMatch, hasPresentationState: true, isToday: false, matchDate: '2026-08-10', serverLocalDate: '2026-08-09', status: 'scheduled', timerStatus: 'not_started' },
  })
  assert.deepEqual(actions.timerActions, [])
  assert.match(actions.startBlockedReason, /fixture date/)
  assert.equal(actions.canSetSquad, true)
  assert.equal(actions.canSelectVolunteers, true)
})

test('Start match remains available when the server confirms that the fixture date is today', () => {
  const actions = getCoachMatchDayActions({
    context,
    match: { ...baseMatch, hasPresentationState: true, isToday: true, matchDate: '2026-08-09', serverLocalDate: '2026-08-09', status: 'scheduled', timerStatus: 'not_started' },
  })
  assert.deepEqual(actions.timerActions.map((item) => item.action), ['start'])
  assert.equal(actions.startBlockedReason, '')
})

test('extended-time actions preserve extra time and shootout gates', () => {
  const normalComplete = getCoachMatchDayActions({ context, match: { ...baseMatch, conclusionRule: 'extra_time_then_penalties', currentMatchPhase: 'normal_time_complete', status: 'extra_time', timerStatus: 'paused' } })
  assert.deepEqual(normalComplete.timerActions.map((item) => item.action), ['start_extra_time'])
  const shootout = getCoachMatchDayActions({ context, match: { ...baseMatch, conclusionRule: 'straight_to_penalties', currentMatchPhase: 'penalties', shootoutEvents: [], status: 'penalties', timerStatus: 'paused' } })
  assert.equal(shootout.timerActions[0].action, 'full_time')
  assert.equal(shootout.timerActions[0].disabled, true)
})

test('squad model keeps availability separate from optimistic-concurrency decision state', () => {
  const squad = buildCoachMatchDaySquad([{ id: 'p1', playerName: 'Alex' }, { id: 'p2', playerName: 'Jamie' }], {
    playerAvailability: [{ playerId: 'p1', status: 'available' }],
    squadDecisions: [{ decidedAt: '2026-08-09T10:00:00Z', playerId: 'p1', status: 'selected' }],
  })
  assert.equal(squad.rows[0].availabilityLabel, 'Available')
  assert.equal(squad.rows[0].decisionLabel, 'Selected')
  assert.equal(squad.rows[0].decidedAt, '2026-08-09T10:00:00Z')
  assert.equal(squad.summary.undecided, 1)
})

test('goal form preserves scorer, assist, penalty, team-side, and minute data', () => {
  const form = validateCoachMatchDayEventForm({ ...createCoachMatchDayEventForm('goal', baseMatch), assistName: 'Jamie', isPenaltyGoal: true, minute: '41', scorerName: 'Alex', teamSide: 'club' })
  assert.equal(form.minute, 41)
  assert.equal(form.scorerName, 'Alex')
  assert.equal(form.assistName, 'Jamie')
  assert.equal(form.isPenaltyGoal, true)
})

test('cards and substitutions use only canonical staff event types', () => {
  assert.equal(validateCoachMatchDayEventForm({ eventType: 'yellow_card', minute: '15', playerName: 'Alex' }).eventType, 'yellow_card')
  assert.equal(validateCoachMatchDayEventForm({ eventType: 'red_card', minute: '16', playerName: 'Alex' }).eventType, 'red_card')
  assert.equal(validateCoachMatchDayEventForm({ eventType: 'substitution', minute: '60', playerName: 'Alex', playerOnName: 'Jamie' }).eventType, 'substitution')
  assert.throws(() => validateCoachMatchDayEventForm({ eventType: 'injury' }), /supported/)
})

test('event validation rejects malformed minutes and incomplete substitutions', () => {
  assert.throws(() => validateCoachMatchDayEventForm({ eventType: 'goal', minute: '1000' }), /valid match minute/)
  assert.throws(() => validateCoachMatchDayEventForm({ eventType: 'goal', minute: '1.5' }), /valid match minute/)
  assert.throws(() => validateCoachMatchDayEventForm({ eventType: 'substitution', minute: '60', playerName: 'Alex' }), /Player coming on/)
})

test('undo model requires a canonical reason and Other note', () => {
  const event = { eventStatus: 'active', eventType: 'goal' }
  const model = getCoachMatchDayUndoModel(event, { reasonCode: 'goal_disallowed' })
  assert.equal(model.canUndo, true)
  assert.equal(model.validate().reasonCode, 'goal_disallowed')
  assert.throws(() => getCoachMatchDayUndoModel(event, { reasonCode: 'other' }).validate(), /short note/)
  assert.equal(getCoachMatchDayUndoModel({ eventStatus: 'voided', eventType: 'goal' }).canUndo, false)
})

test('final report derives active and voided timeline evidence and shootout result', () => {
  const report = buildCoachFinalMatchReport({ ...baseMatch, events: [{ createdAt: '2026-08-09T12:01:00Z', eventStatus: 'active', eventType: 'goal', homeScore: 1, awayScore: 0 }, { createdAt: '2026-08-09T12:02:00Z', eventStatus: 'voided', eventType: 'yellow_card' }], status: 'full_time' })
  assert.equal(report.activeEvents.length, 1)
  assert.equal(report.voidedEvents.length, 1)
  assert.equal(report.result.finalScore, '2 - 1')
})

test('backend deltas explicitly refuse invented fixture-linked lineup and external delivery', () => {
  assert.deepEqual([...new Set(COACH_MATCH_DAY_BACKEND_DELTAS.map((item) => item.category))].sort(), ['A', 'B', 'C', 'D', 'E'])
  assert.equal(COACH_MATCH_DAY_BACKEND_DELTAS.some((item) => item.category === 'C' && /captain/.test(item.capability)), true)
  assert.equal(COACH_MATCH_DAY_BACKEND_DELTAS.some((item) => item.category === 'E' && /No external communication/.test(item.decision)), true)
})

test('Match Day live operations use canonical RPC mutations while pre-match fixture details remain editable', async () => {
  const source = await readFile(new URL('../apps/mobile-core/src/coachMatchDayData.js', import.meta.url), 'utf8')
  for (const rpc of ['start_match_day', 'set_match_day_timer_state', 'set_match_day_extended_state', 'set_match_day_player_squad_decision_v2', 'record_match_day_goal_v3', 'record_match_day_score_correction_v2', 'record_match_day_scorer_event_v1', 'void_match_day_event', 'record_match_day_shootout_kick', 'void_match_day_shootout_kick', 'save_match_day_final_report']) assert.match(source, new RegExp(`['\"]${rpc}['\"]`))
  assert.match(source, /select-match-day-volunteer/)
  assert.match(source, /Authorization: `Bearer \$\{accessToken\}`/)
  assert.equal((source.match(/\.from\('match_days'\)\.update\(/g) || []).length, 0)
  assert.match(source, /rpc\('update_match_day_fixture_for_team'/)
  assert.match(source, /export async function updateCoachMatchDayFixture[\s\S]*Fixture details can only be edited before the match starts/)
  assert.doesNotMatch(source, /\.from\('match_day_events'\)[\s\S]{0,300}\.insert\(/)
  assert.match(source, /\['admin', 'parent_portal', 'adult_player', 'super_admin'\]/)
  assert.match(source, /archived or unavailable/)
})

test('legacy pilot Match Day direct writes and Match Day push side effects are removed', async () => {
  const source = await readFile(new URL('../apps/mobile-core/src/data.js', import.meta.url), 'utf8')
  assert.doesNotMatch(source, /updateCoachMatchStatus|addCoachMatchGoal|undoCoachLastMatchGoal/)
  assert.doesNotMatch(source, /send-match-day-push/)
})

test('Match Day screen disables offline writes and requires plain-language confirmation', async () => {
  const source = await readFile(new URL('../apps/coach-mobile/src/CoachMatchDayScreen.js', import.meta.url), 'utf8')
  assert.match(source, /Showing encrypted cached Match Day data/)
  assert.match(source, /Every change is disabled/)
  assert.match(source, /Start this match\?/)
  assert.match(source, /Only start when both teams are ready for kick-off/)
  assert.match(source, /This change will be checked and saved online/)
  assert.doesNotMatch(source, /Canonical recipient action|production authority|concurrency before saving/)
})

test('Coach Match Day exposes Start match on Overview and keeps confirmation in view', async () => {
  const source = await readFile(new URL('../apps/coach-mobile/src/CoachMatchDayScreen.js', import.meta.url), 'utf8')
  const overview = source.slice(source.indexOf("panel === 'overview'"), source.indexOf("panel === 'squad'"))
  assert.match(overview, /Ready for kick-off\?/)
  assert.match(overview, /Not available to start today/)
  assert.match(overview, /edit the fixture date first/)
  assert.match(overview, /label="Start match"/)
  assert.match(overview, /runCoachMatchDayTimerAction\(user, match, 'start'\)/)
  assert.match(source, /visible=\{Boolean\(pending\)\}/)
  assert.match(source, /accessibilityViewIsModal/)
})

test('Match Day keeps the selected fixture stable while cached data refreshes', async () => {
  const [screen, app, calendar] = await Promise.all([
    readFile(new URL('../apps/coach-mobile/src/CoachMatchDayScreen.js', import.meta.url), 'utf8'),
    readFile(new URL('../apps/coach-mobile/App.js', import.meta.url), 'utf8'),
    readFile(new URL('../apps/coach-mobile/src/CoachOperationalScreens.js', import.meta.url), 'utf8'),
  ])
  assert.match(screen, /const selectedMatchId = useRef\(''\)/)
  assert.match(screen, /const selectionBeforeLoad = selectedMatchId\.current/)
  assert.match(screen, /if \(!selectionBeforeLoad && cachedMatch\)/)
  assert.match(screen, /const activeSelectionId = selectedMatchId\.current/)
  assert.match(screen, /selectedMatchId\.current = summary\.id/)
  assert.doesNotMatch(screen, /\[cache, context, match\?\.id, user\]/)
  assert.match(app, /activeRoute !== 'matchday'/)
  assert.match(calendar, /onNavigate\('matchday', \{ fixtureId: event\.sourceId \}\)/)
  assert.match(app, /setMatchDayTarget\(resolved === 'matchday' && navigationTarget\?\.fixtureId/)
  assert.match(screen, /selectedMatchId\.current = requestedFixtureId/)
  assert.match(screen, /match\?\.id !== requestedFixtureId/)
})

test('Match Day screen exposes operational tools and the final report entry', async () => {
  const source = await readFile(new URL('../apps/coach-mobile/src/CoachMatchDayScreen.js', import.meta.url), 'utf8')
  for (const marker of ['Squad', 'Volunteers', 'Live', 'Timeline', 'Shootout', 'Correct score', 'Add goal']) assert.match(source, new RegExp(marker))
  assert.match(source, /\{ label: 'Report', value: 'report' \}/)
  assert.match(source, /panel === 'report'/)
  assert.match(source, /function ReportPanel/)
  assert.match(source, /Final result/)
  assert.match(source, /Match summary/)
  assert.match(source, /canSave=\{actions\.canSaveFinalReport\}/)
  assert.doesNotMatch(source, /COACH_MOBILE_FA_REPORT_VISIBLE/)
  assert.match(source, /Correct goal details/)
  assert.doesNotMatch(source, /recipientEmail/)
})

test('Match Day screen does not expose internal model copy or fabricate lineup writes', async () => {
  const [screen, adapter] = await Promise.all([
    readFile(new URL('../apps/coach-mobile/src/CoachMatchDayScreen.js', import.meta.url), 'utf8'),
    readFile(new URL('../apps/mobile-core/src/coachMatchDayData.js', import.meta.url), 'utf8'),
  ])
  assert.doesNotMatch(screen, /canonical Match Day model|No inferred data/)
  assert.doesNotMatch(adapter, /lineup|captain|goalkeeper|formation_board/i)
})

test('Coach App routes Match Day to the native operational screen', async () => {
  const app = await readFile(new URL('../apps/coach-mobile/App.js', import.meta.url), 'utf8')
  assert.match(app, /activeRoute === 'matchday'.*CoachMatchDayScreen/)
})

test('Phase 31D sources contain no live Football Player project reference or production mutation enablement', async () => {
  const sources = await Promise.all(['../apps/mobile-core/src/coachMatchDayCore.js', '../apps/mobile-core/src/coachMatchDayData.js', '../apps/coach-mobile/src/CoachMatchDayScreen.js'].map((path) => readFile(new URL(path, import.meta.url), 'utf8')))
  for (const source of sources) {
    assert.doesNotMatch(source, /hvapkizujvsahvgspser/)
    assert.doesNotMatch(source, /allowLiveSupabase|productionAccess:\s*true/)
  }
})
