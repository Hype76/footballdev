import { migrationSourceUrl } from './helpers/migration-source.mjs'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { test } from 'node:test'

import {
  consumeFixtureSetupIntent,
  FIXTURE_SETUP_EVENT,
  openMatchDayFixtureSetup,
} from '../src/lib/matchday-workflow.js'
import {
  getMatchDayDisplayName,
  getMatchDayDisplayParts,
  getMatchDayDisplayScore,
  getTodayMatchDayDateValue,
  isPastMatchDayDate,
  isPastMatchDayDateTime,
  normalizeMatchDay,
} from '../src/lib/domain/match-day.js'

const eventRequestsMigrationUrl = migrationSourceUrl('20260630102239_20260630100000_v1_team_season_reports_and_event_requests.sql', 'active')

function createWindowStub() {
  const values = new Map()
  const dispatchedEvents = []

  return {
    dispatchedEvents,
    dispatchEvent(event) {
      dispatchedEvents.push(event.type)
    },
    sessionStorage: {
      getItem(key) {
        return values.get(key) ?? null
      },
      removeItem(key) {
        values.delete(key)
      },
      setItem(key, value) {
        values.set(key, String(value))
      },
    },
  }
}

test('calendar fixture setup opens the real Match Day workflow with a safe intent', () => {
  const windowRef = createWindowStub()
  const navigations = []

  openMatchDayFixtureSetup({
    kickoffTime: '10:30',
    matchDate: '2026-06-21',
    opponent: 'Riverside Juniors',
    parentAudience: 'involved_players',
    parentVisible: true,
    teamId: 'team-1',
    venueName: 'Main Pitch',
  }, {
    navigate: (url) => navigations.push(url),
    windowRef,
  })

  assert.deepEqual(navigations, ['/match-day'])

  const setupIntent = consumeFixtureSetupIntent({ windowRef })
  assert.equal(setupIntent.matchDate, '2026-06-21')
  assert.equal(setupIntent.opponent, 'Riverside Juniors')
  assert.equal(setupIntent.parentAudience, 'involved_players')
  assert.equal(setupIntent.parentVisible, true)
  assert.equal(consumeFixtureSetupIntent({ windowRef }), null)
})

test('fixture setup dispatches locally when no router navigate function is supplied', () => {
  const windowRef = createWindowStub()

  openMatchDayFixtureSetup({ opponent: 'Riverside Juniors' }, { windowRef })

  assert.deepEqual(windowRef.dispatchedEvents, [FIXTURE_SETUP_EVENT])
})

test('calendar match type selection routes to Match Day instead of generic save', () => {
  const source = readFileSync(
    new URL('../src/pages/SessionsPage.jsx', import.meta.url),
    'utf8',
  )

  assert.match(source, /openCalendarMatchDayWorkflow/)
  assert.match(source, /name === 'eventType' && value === 'match' && calendarModal\?\.mode === 'create'/)
  assert.match(source, /openMatchDayFixtureSetup\(/)
  assert.match(source, /setCalendarModal\(null\)/)
})

test('match day calendar item edit stays inside the calendar modal', () => {
  const source = readFileSync(
    new URL('../src/pages/SessionsPage.jsx', import.meta.url),
    'utf8',
  )

  assert.match(source, /setCalendarModal\(\(current\) => \(\{ \.\.\.current, mode: 'edit' \}\)\)/)
  assert.doesNotMatch(source, /navigate\(currentEvent\.href \|\| '\/match-day'\)/)
  assert.match(source, /Cancel this fixture\? This keeps existing history and removes it from the active calendar\./)
  assert.match(source, /Move or reschedule/)
  assert.match(source, /Cancel fixture/)
  assert.match(source, /Delete event/)
  assert.match(source, /Save changes/)
})

test('manual review Match Day migration removes missing player team assignment dependency', () => {
  const migration = readFileSync(
    migrationSourceUrl('20260616153836_repair_manual_review_eval_matchday.sql', 'active'),
    'utf8',
  )

  assert.match(migration, /create or replace function public\.create_match_day_motm_poll/)
  assert.match(migration, /player\.team_id = match_row\.team_id/)
  assert.doesNotMatch(migration, /player_team_assignments/)
  assert.doesNotMatch(migration, /create table.*player_team_assignments/is)
})

test('match day date helper blocks past dates and allows today', () => {
  const now = new Date('2026-06-16T12:00:00')

  assert.equal(getTodayMatchDayDateValue(now), '2026-06-16')
  assert.equal(isPastMatchDayDate('2026-06-15', now), true)
  assert.equal(isPastMatchDayDate('2026-06-16', now), false)
  assert.equal(isPastMatchDayDate('2026-06-17', now), false)
  assert.equal(isPastMatchDayDateTime('2026-06-16', '11:59', now), true)
  assert.equal(isPastMatchDayDateTime('2026-06-16', '12:00', now), false)
  assert.equal(isPastMatchDayDateTime('2026-06-16', '12:01', now), false)
  assert.equal(isPastMatchDayDateTime('2026-06-16', '', now), false)
})

test('fixture setup Continue validates visibly and advances to squad selection', () => {
  const source = readFileSync(
    new URL('../src/pages/MatchDayPage.jsx', import.meta.url),
    'utf8',
  )
  const handlerStart = source.indexOf('const handleCreateMatch = async (event) => {')
  const handlerEnd = source.indexOf('const handleConfirmCreateMatch = async ({ calendarOnly = false } = {}) => {', handlerStart)
  assert.notEqual(handlerStart, -1)
  assert.notEqual(handlerEnd, -1)
  const handlerSource = source.slice(handlerStart, handlerEnd)

  assert.match(handlerSource, /blurActiveFixtureControl\(\)/)
  assert.match(handlerSource, /getFixtureSetupValidationMessage\(\{ availablePlayerIds, form \}\)/)
  assert.match(handlerSource, /setErrorMessage\(validationMessage\)/)
  assert.match(handlerSource, /setSquadSelection\(\{/)
  assert.match(source, /Add an opponent before continuing to squad selection\./)
  assert.match(source, /isPastMatchDayDateTime\(form\.matchDate, form\.kickoffTime\)/)
  assert.match(source, /Fixture date and time cannot be in the past\./)
  assert.match(source, /onSubmit=\{handleCreateMatch\} noValidate/)
  assert.match(source, /isFixtureDataLoading \? 'Loading squad\.\.\.' : 'Continue to squad'/)
  assert.match(source, /role="alert"/)
  assert.doesNotMatch(handlerSource, /if \(!form\.parentVisible\)[\s\S]*await createMatchDay/)
})

test('match day page keeps fixture controls behind one compact Manage panel', () => {
  const source = readFileSync(
    new URL('../src/pages/MatchDayPage.jsx', import.meta.url),
    'utf8',
  )
  const navigationCard = readFileSync(
    new URL('../src/components/match-day/FixtureNavigationCard.jsx', import.meta.url),
    'utf8',
  )

  assert.match(source, /const \[expandedMatchId, setExpandedMatchId\] = useState\(requestedFixtureId\)/)
  assert.match(source, /isSelected=\{String\(expandedMatchId\) === String\(match\.id\)\}/)
  assert.match(source, /onOpen=\{\(\) => void handleMatchToggle\(match\)\}/)
  assert.match(navigationCard, /\{isSelected \? 'Close' : 'Manage'\}/)
  assert.match(source, /availabilitySummary=\{getAvailabilitySummary\(match\)\}/)
  assert.match(source, /roleWarningSummary=\{getRoleWarningSummary\(match\)\}/)
  assert.match(source, /getRoleResponseRows\(match, role\)/)
  assert.match(source, /const \[isPreviousGamesOpen, setIsPreviousGamesOpen\] = useState\(false\)/)
  assert.match(source, /aria-expanded=\{isPreviousGamesOpen\}/)
  assert.match(source, /`Previous games \(\$\{previousMatches\.length\}\)`/)
  assert.match(source, /Hide previous games/)
})

test('match day separates previous games without removing staff controls', () => {
  const source = readFileSync(
    new URL('../src/pages/MatchDayPage.jsx', import.meta.url),
    'utf8',
  )

  const groupingStart = source.indexOf('function isPreviousMatch(match)')
  const groupingEnd = source.indexOf('function sortMatches(matches)', groupingStart)
  assert.notEqual(groupingStart, -1)
  assert.notEqual(groupingEnd, -1)
  const groupingSource = source.slice(groupingStart, groupingEnd)

  assert.match(groupingSource, /isMatchDayConcluded\(match\)/)
  assert.match(groupingSource, /\['postponed', 'cancelled'\]\.includes\(match\.status\)/)
  assert.match(groupingSource, /new Date\(`\$\{match\.matchDate\}T23:59:59`\)\.getTime\(\) < Date\.now\(\)/)
  assert.match(source, /const activeMatches = useMemo\([\s\S]*sortMatchDayPresentation\(matches\.filter\(\(match\) => !isPreviousMatch\(match\)\)\)/)
  assert.match(source, /const previousMatches = useMemo\(\(\) => sortMatches\(matches\.filter\(isPreviousMatch\)\)\.reverse\(\)/)

  const previousSectionStart = source.indexOf('{isPreviousGamesOpen ? (')
  const previousSectionEnd = source.indexOf('</section>', previousSectionStart)
  assert.notEqual(previousSectionStart, -1)
  assert.notEqual(previousSectionEnd, -1)
  const previousSection = source.slice(previousSectionStart, previousSectionEnd)

  assert.match(previousSection, /previousMatches\.map\(renderFixtureNavigationCard\)/)
  assert.doesNotMatch(previousSection, /<MatchDayCard/)
  assert.doesNotMatch(previousSection, /<PreviousGameCard/)
  assert.match(source, /selectedMatch && \(!isDemoExperience \|\| isGameModeActive\) \? renderSelectedMatchWorkspace\(selectedMatch\) : null/)
  assert.match(source, /onStatusChange=\{handleStatusChange\}/)
  assert.match(source, /onScoreSave=\{handleScoreSave\}/)
  assert.match(source, /onVolunteerSelection=\{openVolunteerSelectionPrompt\}/)
  assert.match(source, /onCorrectGoal=\{handleCorrectGoal\}/)
  assert.match(source, /onUndoEvent=\{handleUndoEvent\}/)
})

test('staff live match console polls active match state without full page reload or role fan-out', () => {
  const source = readFileSync(
    new URL('../src/pages/MatchDayPage.jsx', import.meta.url),
    'utf8',
  )
  const refreshStart = source.indexOf('async function refreshLiveMatches()')
  const refreshEnd = source.indexOf('if (!canManageMatchDay(user))', refreshStart)
  assert.notEqual(refreshStart, -1)
  assert.notEqual(refreshEnd, -1)
  const refreshSource = source.slice(refreshStart, refreshEnd)

  assert.match(source, /const LIVE_MATCH_REFRESH_INTERVAL_MS = 15000/)
  assert.match(source, /const LIVE_MATCH_CLOCK_INTERVAL_MS = 1000/)
  assert.match(refreshSource, /getMatchDays\(\{ user \}\)/)
  assert.match(refreshSource, /mergeMatchDaySummaries\(currentMatches, nextMatches\)\.map/)
  assert.match(
    refreshSource,
    /getMatchDay\(\{ user, matchDayId: match\.id \}\)/,
  )
  assert.doesNotMatch(refreshSource, /includeScorerEligibility|select-match-day-volunteer/)
  assert.match(refreshSource, /refreshedDetailsById/)
  assert.match(refreshSource, /refreshState\.inFlight/)
  assert.match(refreshSource, /setLiveRefreshStatus\(detailRefreshFailed \? 'warning' : 'ok'\)/)
  assert.match(refreshSource, /setLiveRefreshStatus\('warning'\)/)
  assert.match(refreshSource, /window\.setInterval\(\(\) => \{/)
  assert.doesNotMatch(refreshSource, /window\.location|reload\(|loadData\(/)
})

test('staff live controls keep timer feedback while Pause stays in Game Mode', () => {
  const source = readFileSync(
    new URL('../src/pages/MatchDayPage.jsx', import.meta.url),
    'utf8',
  )
  const statusHandlerStart = source.indexOf('const saveMatchStatus = async (match, status')
  const statusHandlerEnd = source.indexOf('const performScoreSave = async (match) => {', statusHandlerStart)
  assert.notEqual(statusHandlerStart, -1)
  assert.notEqual(statusHandlerEnd, -1)
  const statusHandlerSource = source.slice(statusHandlerStart, statusHandlerEnd)

  assert.match(source, /const RUNNING_MATCH_STATUSES = new Set\(\['live', 'second_half', 'extra_time', 'penalties'\]\)/)
  assert.match(source, /const PAUSED_MATCH_STATUSES = new Set\(\['half_time'\]\)/)
  assert.match(source, /const manageStatusActions = \(\(\) => \{/)
  assert.match(source, /return getMatchDayExtendedTimerActions\(match\)/)
  assert.match(source, /return \{ label: 'Resume Match', status: 'second_half' \}/)
  assert.match(source, /function formatLiveMatchClock\(match, now = Date\.now\(\)\)/)
  assert.match(source, /return formatMatchTimerClock\(match, now\)/)
  assert.match(source, /isMatchTimerPaused\(match\)/)
  assert.match(source, /saveTimerAction = setMatchDayTimerState/)
  assert.match(source, /saveTimerAction\(\{ user, match, action \}\)/)
  assert.match(source, /const LIVE_MATCH_CLOCK_INTERVAL_MS = 1000/)
  assert.match(source, /function LiveMatchEntryModal/)
  assert.match(source, /Confirm half time/)
  assert.match(source, /Confirm full time/)
  assert.match(source, /Open Game Mode/)
  assert.match(source.slice(source.indexOf('function MatchDayGameModePanel'), source.indexOf('function GoalCorrectionModal')), /onTimerAction\(match, 'pause'\)/)
  assert.match(source.slice(source.indexOf('function MatchDayGameModePanel'), source.indexOf('function GoalCorrectionModal')), /onTimerAction\(match, 'hydration'\)/)
  assert.match(source, /const handleGameModeTimerAction = async \(match, action\) =>/)
  assert.match(source, /if \(action === 'resume'\)/)
  assert.match(source, /onStatusChange\(match, 'half_time'\)/)
  assert.match(source, /onStatusChange\(match, normalTimeCompletionAction\)/)
  assert.match(source, /Live sync needs attention/)
  assert.match(source, /Retry live data/)
  assert.match(statusHandlerSource, /setPendingStatusAction/)
  assert.match(source, /const handleConfirmStartMatch = async \(\) => \{[\s\S]*saveTimerAction: startMatchDay/)
  assert.doesNotMatch(statusHandlerSource, /await saveMatchStatus\(match, 'live'\)/)
  assert.match(statusHandlerSource, /const handleGameModeOpen = async \(match\) => \{[\s\S]*await hydrateMatchDay\(match\)[\s\S]*setGameModeMatchId\(match\.id\)/)
  assert.doesNotMatch(statusHandlerSource, /shouldConfirm/)
  assert.doesNotMatch(statusHandlerSource, /updates\.phaseStartedAt = new Date\(\)\.toISOString\(\)/)
  assert.match(statusHandlerSource, /setMatchActionStatus\(\{\s*key: `\$\{match\.id\}:status`/)
  assert.match(statusHandlerSource, /tone: 'success'/)
  assert.match(statusHandlerSource, /tone: 'error'/)
})

test('phone and desktop Game Day render list-first navigation and one selected workspace', () => {
  const source = readFileSync(
    new URL('../src/pages/MatchDayPage.jsx', import.meta.url),
    'utf8',
  )
  const fixtureListStart = source.indexOf('>Active fixtures</h2>')
  const selectedWorkspaceStart = source.indexOf('const renderSelectedMatchWorkspace')
  assert.notEqual(fixtureListStart, -1)
  assert.notEqual(selectedWorkspaceStart, -1)
  assert.match(source, /selectedMatch \? 'hidden xl:block xl:basis-\[22rem\] xl:flex-grow' : ''/)
  assert.match(source, />\s*Back to fixtures\s*</)
  assert.match(source, /xl:flex xl:flex-wrap xl:items-start/)
  assert.doesNotMatch(source, /xl:max-h-\[calc\(100vh-9rem\)\] xl:overflow-y-auto/)
  assert.match(source, /selectedMatch && \(!isDemoExperience \|\| isGameModeActive\) \? renderSelectedMatchWorkspace\(selectedMatch\) : null/)
  assert.equal((source.match(/<MatchDayCard/g) || []).length, 1)
})

test('selected Game Day fixture separates focused workspace sections', () => {
  const source = readFileSync(
    new URL('../src/pages/MatchDayPage.jsx', import.meta.url),
    'utf8',
  )

  assert.match(source, /<MatchDayWorkspaceTabs activeSection=\{workspaceSection\}/)
  assert.match(source, /workspaceSection === 'overview'/)
  assert.match(source, /workspaceSection === 'squad'/)
  assert.match(source, /workspaceSection === 'roles'/)
  assert.match(source, /workspaceSection === 'timeline'/)
  assert.match(source, /<MatchDayReadinessPanel match=\{match\} \/>/)
  assert.match(source, /<MatchTimelinePanel/)
  assert.doesNotMatch(source, /function PitchsideCockpitPanel/)
})

test('parent Match Day calendar event modal stays focused on in-product responses', () => {
  const source = readFileSync(
    new URL('../src/pages/ParentPortalPage.jsx', import.meta.url),
    'utf8',
  )
  const calendarBuilderStart = source.indexOf('function buildParentCalendarEvents')
  const calendarBuilderEnd = source.indexOf('function getMatchVolunteerRequestLabels', calendarBuilderStart)
  const modalStart = source.indexOf('function ParentCalendarEventModal')
  const modalEnd = source.indexOf('function ParentUpcomingEvents', modalStart)
  assert.notEqual(calendarBuilderStart, -1)
  assert.notEqual(calendarBuilderEnd, -1)
  assert.notEqual(modalStart, -1)
  assert.notEqual(modalEnd, -1)
  const calendarBuilderSource = source.slice(calendarBuilderStart, calendarBuilderEnd)
  const modalSource = source.slice(modalStart, modalEnd)

  assert.match(calendarBuilderSource, /const matchEvents = matches[\s\S]*sourceType: 'parent-match-day'/)
  assert.doesNotMatch(source, /function buildParentMatchDayCalendarUrl\(event\)/)
  assert.doesNotMatch(modalSource, /Add to calendar/)
  assert.doesNotMatch(modalSource, /calendarUrl/)
  assert.doesNotMatch(modalSource, /getParentPortalMatchDays\(|getParentPortalSharedCalendarEvents\(|fetch\(|supabase/)
})

test('parent portal keeps role selection and involved-child calendar scope separate', () => {
  const source = readFileSync(
    new URL('../src/pages/ParentPortalPage.jsx', import.meta.url),
    'utf8',
  )
  const roleStart = source.indexOf('function getParentRoleSelectionRows')
  const roleEnd = source.indexOf('function ParentMatchCardsPanel', roleStart)
  const calendarBuilderStart = source.indexOf('function buildParentCalendarEvents')
  const calendarBuilderEnd = source.indexOf('function getMatchVolunteerRequestLabels', calendarBuilderStart)
  assert.notEqual(roleStart, -1)
  assert.notEqual(roleEnd, -1)
  assert.notEqual(calendarBuilderStart, -1)
  assert.notEqual(calendarBuilderEnd, -1)
  const roleSource = source.slice(roleStart, roleEnd)
  const calendarBuilderSource = source.slice(calendarBuilderStart, calendarBuilderEnd)

  assert.match(roleSource, /key: roleConfig\.key/)
  assert.match(roleSource, /isSelected: true/)
  assert.match(roleSource, /You have been selected as \$\{roleLabel\} for this fixture\./)
  assert.match(calendarBuilderSource, /const matchEvents = matches[\s\S]*\.map\(\(match\) => \{[\s\S]*sourceType: 'parent-match-day'[\s\S]*data: match/)
  assert.doesNotMatch(calendarBuilderSource, /all_team_parents|all_club_parents|parent_audience|parentAudience/)
})

test('Game Mode opens in Ready without restarting and uses explicit start and pause rules', () => {
  const source = readFileSync(
    new URL('../src/pages/MatchDayPage.jsx', import.meta.url),
    'utf8',
  )
  const openStart = source.indexOf('const handleGameModeOpen = async (match) => {')
  const openEnd = source.indexOf('const handleGameModeStatusChange = async', openStart)
  const gameModeStart = source.indexOf('function MatchDayGameModePanel')
  const gameModeEnd = source.indexOf('function MatchTimelinePanel', gameModeStart)
  assert.notEqual(openStart, -1)
  assert.notEqual(openEnd, -1)
  assert.notEqual(gameModeStart, -1)
  assert.notEqual(gameModeEnd, -1)
  const openSource = source.slice(openStart, openEnd)
  const gameModeSource = source.slice(gameModeStart, gameModeEnd)

  assert.match(openSource, /await hydrateMatchDay\(match\)/)
  assert.match(openSource, /setGameModeMatchId\(match\.id\)/)
  assert.doesNotMatch(openSource, /saveMatchStatus|setMatchDayTimerState|updateMatchDay/)
  assert.match(source, /onGameModeStart=\{handleGameModeOpen\}/)
  assert.match(gameModeSource, /const isPaused = isMatchTimerPaused\(match\)/)
  assert.match(gameModeSource, /const isReady = \['scheduled', 'scorer_request'\]\.includes\(match\.status\)/)
  assert.match(gameModeSource, /Game Mode is open, but the match clock has not started/)
  assert.match(gameModeSource, /onStartMatch\(match\)/)
  assert.match(gameModeSource, /const liveControlsDisabled = isBusy \|\| isFullTime \|\| isReady/)
  assert.doesNotMatch(gameModeSource, /gameModePauseState/)
  assert.match(gameModeSource, /data-match-day-timer-action="resume"/)
  assert.match(gameModeSource, /data-match-day-timer-action="hydration"/)
  assert.match(gameModeSource, /const canMoveToHalfTime = match\.status === 'live'/)
  assert.match(gameModeSource, /disabled=\{liveControlsDisabled \|\| !canMoveToHalfTime\}/)
  assert.match(gameModeSource, /disabled=\{liveControlsDisabled\}/)
})

test('Game Mode hides admin readiness cards and shows the staff timeline controls', () => {
  const source = readFileSync(
    new URL('../src/pages/MatchDayPage.jsx', import.meta.url),
    'utf8',
  )
  const cardStart = source.indexOf('function MatchDayCard')
  const cardEnd = source.indexOf('function MatchDayGameModePanel', cardStart)
  const gameModeStart = source.indexOf('function MatchDayGameModePanel')
  const gameModeEnd = source.indexOf('function GoalCorrectionModal', gameModeStart)
  assert.notEqual(cardStart, -1)
  assert.notEqual(cardEnd, -1)
  assert.notEqual(gameModeStart, -1)
  assert.notEqual(gameModeEnd, -1)
  const cardSource = source.slice(cardStart, cardEnd)
  const gameModeSource = source.slice(gameModeStart, gameModeEnd)

  assert.match(cardSource, /const events = Array\.isArray\(match\.events\) \? match\.events : \[\]/)
  assert.match(cardSource, /\{!isGameMode \? \([\s\S]*<CompactFact label="Availability" value=\{getAvailabilitySummary\(match\)\} \/>[\s\S]*<CompactFact label="Scorer" value=\{getRoleStatus\(match, 'scorer'\)\} \/>[\s\S]*<CompactFact label="Referee" value=\{getRoleStatus\(match, 'referee'\)\} \/>[\s\S]*<CompactFact label="Linesman" value=\{getRoleStatus\(match, 'linesman'\)\} \/>[\s\S]*<CompactFact label="Status" value=\{getMatchLifecycleLabel\(match\)\} \/>/)
  assert.match(cardSource, /events=\{events\}[\s\S]*match=\{match\}[\s\S]*onBack=\{onGameModeBack\}/)
  assert.match(gameModeSource, /events,/)
  assert.match(gameModeSource, /<MatchTimelinePanel[\s\S]*events=\{events\}[\s\S]*match=\{match\}[\s\S]*onUndoEvent=\{onUndoEvent\}/)
  assert.doesNotMatch(gameModeSource, /<MatchTimelinePanel[^>]*isReadOnly/)
  assert.doesNotMatch(gameModeSource, /getAvailabilitySummary|getRoleStatus|getMatchStatusLabel\(match\.status\)|CompactFact label="Availability"|CompactFact label="Scorer"|CompactFact label="Referee"|CompactFact label="Linesman"|CompactFact label="Status"/)
})

test('Match Timeline uses persisted events, stable ordering, and the approved empty state', () => {
  const source = readFileSync(
    new URL('../src/pages/MatchDayPage.jsx', import.meta.url),
    'utf8',
  )
  const orderingStart = source.indexOf('function getOrderedMatchTimelineEvents')
  const timelineStart = source.indexOf('function MatchTimelinePanel')
  const timelineEnd = source.indexOf('function MatchDayReadinessPanel', timelineStart)
  assert.notEqual(orderingStart, -1)
  assert.notEqual(timelineStart, -1)
  assert.notEqual(timelineEnd, -1)
  const orderingSource = source.slice(orderingStart, timelineStart)
  const timelineSource = source.slice(timelineStart, timelineEnd)

  assert.match(orderingSource, /\.sort\(\(left, right\) => \{/)
  assert.match(orderingSource, /getMatchEventSortTime\(right\) - getMatchEventSortTime\(left\)/)
  assert.match(orderingSource, /getMatchEventSortMinute\(right\) - getMatchEventSortMinute\(left\)/)
  assert.ok(
    orderingSource.indexOf('getMatchEventSortTime(right) - getMatchEventSortTime(left)')
      < orderingSource.indexOf('getMatchEventSortMinute(right) - getMatchEventSortMinute(left)'),
  )
  assert.match(orderingSource, /String\(right\.id \|\| ''\)\.localeCompare/)
  assert.match(timelineSource, /const timelineEvents = getOrderedMatchTimelineEvents\(events\)/)
  assert.match(timelineSource, /const visibleTimelineEvents = isExpanded \? timelineEvents : timelineEvents\.slice\(0, 3\)/)
  assert.match(timelineSource, /visibleTimelineEvents\.map/)
  assert.match(timelineSource, /Show all/)
  assert.match(timelineSource, /Show less/)
  assert.match(timelineSource, /No match events yet\./)
  assert.match(timelineSource, /Goals, cards and match actions will appear here once recorded\./)
  assert.match(timelineSource, /getMatchEventDetailItems\(event\)/)
  assert.match(timelineSource, /getMatchEventBadge\(event\)/)
  assert.match(timelineSource, /event\.eventType === 'goal' && event\.eventStatus !== 'voided'/)
  assert.match(timelineSource, /const isLatestEvent = eventIndex === 0/)
  assert.match(timelineSource, /Undo event/)
  assert.match(timelineSource, /isMatchDayEventUndoSupported\(event\)/)
  assert.match(timelineSource, /isReadOnly \? \(/)
  assert.doesNotMatch(timelineSource, /slice\(0, 8\)/)
})

test('post-game Manage detail keeps admin facts and the persisted timeline available', () => {
  const source = readFileSync(
    new URL('../src/pages/MatchDayPage.jsx', import.meta.url),
    'utf8',
  )
  const matchCardStart = source.indexOf('function MatchDayCard')
  const matchCardEnd = source.indexOf('function MatchDayGameModePanel', matchCardStart)
  const previousSectionStart = source.indexOf('{isPreviousGamesOpen ? (')
  const previousSectionEnd = source.indexOf('</section>', previousSectionStart)
  assert.notEqual(matchCardStart, -1)
  assert.notEqual(matchCardEnd, -1)
  assert.notEqual(previousSectionStart, -1)
  assert.notEqual(previousSectionEnd, -1)
  const matchCardSource = source.slice(matchCardStart, matchCardEnd)
  const previousSection = source.slice(previousSectionStart, previousSectionEnd)

  assert.match(previousSection, /previousMatches\.map\(renderFixtureNavigationCard\)/)
  assert.doesNotMatch(previousSection, /<MatchDayCard/)
  assert.match(source, /selectedMatch && \(!isDemoExperience \|\| isGameModeActive\) \? renderSelectedMatchWorkspace\(selectedMatch\) : null/)
  assert.match(matchCardSource, /<MatchDayReadinessPanel match=\{match\} \/>/)
  assert.match(matchCardSource, /<CompactFact label="Availability" value=\{getAvailabilitySummary\(match\)\} \/>/)
  assert.match(matchCardSource, /<CompactFact label="Scorer" value=\{getRoleStatus\(match, 'scorer'\)\} \/>/)
  assert.match(matchCardSource, /<CompactFact label="Referee" value=\{getRoleStatus\(match, 'referee'\)\} \/>/)
  assert.match(matchCardSource, /<CompactFact label="Linesman" value=\{getRoleStatus\(match, 'linesman'\)\} \/>/)
  assert.match(matchCardSource, /<MatchTimelinePanel[\s\S]*events=\{events\}[\s\S]*onCorrectGoal=\{onCorrectGoal\}[\s\S]*onUndoEvent=\{onUndoEvent\}/)
})

test('staff goal logging keeps the selected mobile workspace open after successful save', () => {
  const source = readFileSync(
    new URL('../src/pages/MatchDayPage.jsx', import.meta.url),
    'utf8',
  )
  const goalHandlerStart = source.indexOf('const handleAddGoal = async (event, match) => {')
  const goalHandlerEnd = source.indexOf('const openGoalCorrectionModal =', goalHandlerStart)
  assert.notEqual(goalHandlerStart, -1)
  assert.notEqual(goalHandlerEnd, -1)
  const goalHandlerSource = source.slice(goalHandlerStart, goalHandlerEnd)

  assert.match(goalHandlerSource, /await addStaffMatchDayGoal\(\{ user, match, goal \}\)/)
  assert.match(goalHandlerSource, /setGoalForms\(\(currentForms\) => \(\{/)
  assert.doesNotMatch(goalHandlerSource, /setExpandedMatchId/)
  assert.match(goalHandlerSource, /await refreshMatchDayDetailAfterMutation\(\{/)
  assert.match(goalHandlerSource, /Goal added\./)
})

test('parent live score polling and scorer-only Game Mode remain in the parent portal', () => {
  const source = readFileSync(
    new URL('../src/pages/ParentPortalPage.jsx', import.meta.url),
    'utf8',
  )
  const loadStart = source.indexOf('async function runLoad({ showLoading = false } = {})')
  const loadEnd = source.indexOf('useEffect(() => {', source.indexOf('window.clearInterval(intervalId)', loadStart))
  assert.notEqual(loadStart, -1)
  assert.notEqual(loadEnd, -1)
  const loadSource = source.slice(loadStart, loadEnd)

  assert.match(loadSource, /getParentPortalMatchDays\(\{ parentLinkId: selectedLink\.id \}\)/)
  assert.match(loadSource, /setMatches\(nextMatches\)/)
  assert.match(loadSource, /window\.setInterval\(\(\) => \{/)
  assert.match(loadSource, /60000/)
  assert.doesNotMatch(source, /LiveMatchQuickActions/)
  assert.doesNotMatch(source, /Add event\/card/)
  assert.match(source, /match\.isScorer/)
  assert.match(source, /Open Game Mode/)
  assert.match(source, /!match\.isScorer \? \(/)
  assert.doesNotMatch(source, /onGameModeHydrationToggle/)
})

test('match day normalizer preserves seeded camel-case availability summaries', () => {
  const match = normalizeMatchDay({
    id: 'match-availability-fixture',
    opponent: 'Riverside Juniors',
    availabilityRequests: [
      {
        id: 'request-1',
        matchDayId: 'match-availability-fixture',
        playerId: 'player-1',
        playerName: 'Ava Green',
        recipientEmail: 'ava.parent@example.test',
        status: 'available',
      },
      {
        id: 'request-2',
        matchDayId: 'match-availability-fixture',
        playerId: 'player-2',
        playerName: 'Mia Shah',
        recipientEmail: 'mia.parent@example.test',
        status: 'pending',
      },
    ],
  })

  assert.equal(match.availabilityRequests.length, 2)
  assert.equal(match.availabilityRequests[0].status, 'available')
  assert.equal(match.availabilityRequests[1].recipientEmail, 'mia.parent@example.test')
})

test('match day display helper lists the home side first for home and away fixtures', () => {
  const homeMatch = {
    teamName: 'Cambourne Town',
    opponent: 'Riverside Juniors',
    homeAway: 'home',
    homeScore: 2,
    awayScore: 1,
  }
  const awayMatch = {
    teamName: 'Cambourne Town',
    opponent: 'Riverside Juniors',
    homeAway: 'away',
    homeScore: 3,
    awayScore: 2,
  }

  assert.equal(getMatchDayDisplayName(homeMatch), 'Cambourne Town v Riverside Juniors')
  assert.equal(getMatchDayDisplayScore(homeMatch), '2 - 1')
  assert.deepEqual(getMatchDayDisplayParts(homeMatch), {
    firstTeam: 'Cambourne Town',
    secondTeam: 'Riverside Juniors',
    firstScore: 2,
    secondScore: 1,
    firstSide: 'home',
    secondSide: 'away',
  })
  assert.equal(getMatchDayDisplayName(awayMatch), 'Riverside Juniors v Cambourne Town')
  assert.equal(getMatchDayDisplayScore(awayMatch), '3 - 2')
  assert.deepEqual(getMatchDayDisplayParts(awayMatch), {
    firstTeam: 'Riverside Juniors',
    secondTeam: 'Cambourne Town',
    firstScore: 3,
    secondScore: 2,
    firstSide: 'home',
    secondSide: 'away',
  })
})

test('match day fixture setup saves parent volunteer request roles', () => {
  const pageSource = readFileSync(
    new URL('../src/pages/MatchDayPage.jsx', import.meta.url),
    'utf8',
  )
  const domainSource = readFileSync(
    new URL('../src/lib/domain/match-day.js', import.meta.url),
    'utf8',
  )
  const migration = readFileSync(eventRequestsMigrationUrl, 'utf8')
  const parentPortalSource = readFileSync(
    new URL('../src/pages/ParentPortalPage.jsx', import.meta.url),
    'utf8',
  )

  assert.match(pageSource, /requestScorer: false/)
  assert.match(pageSource, /requestLinesman: false/)
  assert.match(pageSource, /requestReferee: false/)
  assert.match(pageSource, /Request scorer/)
  assert.match(pageSource, /Request linesman/)
  assert.match(pageSource, /Request referee/)
  assert.match(domainSource, /request_scorer: requestScorer/)
  assert.match(domainSource, /request_linesman: requestLinesman/)
  assert.match(domainSource, /request_referee: requestReferee/)
  assert.match(domainSource, /requestScorer: normalizeBoolean\(row\.request_scorer/)
  assert.match(parentPortalSource, /getMatchVolunteerRequestLabels/)
  assert.match(parentPortalSource, /match\.requestLinesman === true \? 'Linesman'/)
  assert.match(parentPortalSource, /match\.requestReferee === true \? 'Referee'/)
  assert.match(parentPortalSource, /\{label\} requested/)
  assert.match(migration, /add column if not exists request_scorer boolean not null default false/i)
  assert.match(migration, /add column if not exists request_linesman boolean not null default false/i)
  assert.match(migration, /add column if not exists request_referee boolean not null default false/i)
  assert.match(migration, /drop function if exists public\.get_parent_portal_match_days\(uuid\);[\s\S]*create function public\.get_parent_portal_match_days/i)
  assert.doesNotMatch(migration, /drop function[^;]+cascade/i)
  assert.match(migration, /request_linesman boolean/i)
  assert.match(migration, /match_day\.request_referee/i)
})

test('fixture request checkboxes stay first-click stable on mobile', () => {
  const source = readFileSync(
    new URL('../src/pages/MatchDayPage.jsx', import.meta.url),
    'utf8',
  )
  const editableStart = source.indexOf('function isFixtureEditableElement')
  const editableEnd = source.indexOf('function blurActiveFixtureControl', editableStart)
  const modalStart = source.indexOf('function FixtureSetupModal')
  const modalEnd = source.indexOf('function FixtureSquadSelectionModal', modalStart)
  const editableSource = source.slice(editableStart, editableEnd)
  const modalSource = source.slice(modalStart, modalEnd)

  assert.notEqual(editableStart, -1)
  assert.notEqual(editableEnd, -1)
  assert.notEqual(modalStart, -1)
  assert.notEqual(modalEnd, -1)
  assert.match(editableSource, /element\?\.type !== 'checkbox'/)
  assert.match(editableSource, /element\?\.type !== 'radio'/)
  assert.match(modalSource, /id="matchday-request-scorer"[\s\S]*checked=\{form\.requestScorer === true\}/)
  assert.match(modalSource, /id="matchday-request-linesman"[\s\S]*checked=\{form\.requestLinesman === true\}/)
  assert.match(modalSource, /id="matchday-request-referee"[\s\S]*checked=\{form\.requestReferee === true\}/)
  assert.match(modalSource, /onChange=\{\(event\) => updateForm\(\{ requestScorer: event\.target\.checked \}\)\}/)
  assert.match(modalSource, /onChange=\{\(event\) => updateForm\(\{ requestLinesman: event\.target\.checked \}\)\}/)
  assert.match(modalSource, /onChange=\{\(event\) => updateForm\(\{ requestReferee: event\.target\.checked \}\)\}/)
})

test('match day fixture creation reports queued availability requests or post-save queue failures', () => {
  const source = readFileSync(
    new URL('../src/pages/MatchDayPage.jsx', import.meta.url),
    'utf8',
  )
  const handlerStart = source.indexOf('const handleConfirmCreateMatch = async ({ calendarOnly = false } = {}) => {')
  const handlerEnd = source.indexOf('const handleStatusChange = async', handlerStart)
  assert.notEqual(handlerStart, -1)
  assert.notEqual(handlerEnd, -1)
  const handlerSource = source.slice(handlerStart, handlerEnd)

  assert.match(handlerSource, /let availabilityWarning = ''/)
  assert.match(handlerSource, /availabilityWarning = result\.message \|\| 'Fixture availability requests could not be sent\.'/)
  assert.doesNotMatch(handlerSource, /throw new Error\(result\.message \|\| 'Fixture availability requests could not be sent\.'\)/)
  assert.match(handlerSource, /The fixture was saved, but availability requests could not be sent:/)
  assert.match(handlerSource, /availability request notification/)
  assert.match(handlerSource, /scheduled/)
  assert.doesNotMatch(handlerSource, /availability requests queued/)
  assert.match(handlerSource, /result\.queuedCount \?\? result\.sentCount/)
  assert.match(handlerSource, /Availability sending is enabled only on production or approved live runtimes\./)
  assert.match(handlerSource, /The fixture was added to calendars only\. No availability requests or notifications were sent\./)
  assert.doesNotMatch(handlerSource, /Availability sending is gated in this environment/)
})
