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

const eventRequestsMigrationUrl = new URL('../supabase/migrations/20260630100000_v1_team_season_reports_and_event_requests.sql', import.meta.url)

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
    new URL('../supabase/migrations/20260616153314_repair_manual_review_eval_matchday.sql', import.meta.url),
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
  const handlerEnd = source.indexOf('const handleConfirmCreateMatch = async () => {', handlerStart)
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

  assert.match(source, /const \[expandedMatchId, setExpandedMatchId\] = useState\(''\)/)
  assert.match(source, /isExpanded=\{expandedMatchId === match\.id\}/)
  assert.match(source, /onToggle=\{\(\) => setExpandedMatchId/)
  assert.match(source, /\{isExpanded \? 'Close' : 'Manage'\}/)
  assert.match(source, /getAvailabilitySummary\(match\)/)
  assert.match(source, /getRoleStatus\(match, 'referee'\)/)
  assert.match(source, /getRoleStatus\(match, 'linesman'\)/)
  assert.match(source, /getRoleResponseRows\(match, role\)/)
  assert.match(source, /const \[isPreviousGamesOpen, setIsPreviousGamesOpen\] = useState\(false\)/)
  assert.match(source, /aria-expanded=\{isPreviousGamesOpen\}/)
  assert.match(source, /Show previous games/)
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

  assert.match(groupingSource, /\['full_time', 'postponed', 'cancelled'\]\.includes\(match\.status\)/)
  assert.match(groupingSource, /new Date\(`\$\{match\.matchDate\}T23:59:59`\)\.getTime\(\) < Date\.now\(\)/)
  assert.match(source, /const activeMatches = useMemo\(\(\) => sortMatches\(matches\.filter\(\(match\) => !isPreviousMatch\(match\)\)\)/)
  assert.match(source, /const previousMatches = useMemo\(\(\) => sortMatches\(matches\.filter\(isPreviousMatch\)\)\.reverse\(\)/)

  const previousSectionStart = source.indexOf('<h2 className="mt-1 text-xl font-black tracking-tight text-[#101828]">Previous games</h2>')
  const previousSectionEnd = source.indexOf('function MatchDayCard(', previousSectionStart)
  assert.notEqual(previousSectionStart, -1)
  assert.notEqual(previousSectionEnd, -1)
  const previousSection = source.slice(previousSectionStart, previousSectionEnd)

  assert.match(previousSection, /previousMatches\.map\(\(match\) => \(/)
  assert.match(previousSection, /<MatchDayCard/)
  assert.doesNotMatch(previousSection, /<PreviousGameCard/)
  assert.match(previousSection, /onStatusChange=\{handleStatusChange\}/)
  assert.match(previousSection, /onScoreSave=\{handleScoreSave\}/)
  assert.match(previousSection, /onVolunteerSelection=\{openVolunteerSelectionPrompt\}/)
  assert.match(previousSection, /onAddGoal=\{handleAddGoal\}/)
  assert.match(previousSection, /onAddMatchEvent=\{handleAddMatchEvent\}/)
  assert.match(previousSection, /onMatchEventFormChange=\{updateMatchEventForm\}/)
  assert.match(previousSection, /onMatchEventPlayerPick=\{handleMatchEventPlayerPick\}/)
  assert.match(previousSection, /onPlayerPick=\{handlePlayerPick\}/)
  assert.match(previousSection, /onGoalFormChange=\{updateGoalForm\}/)
  assert.match(previousSection, /matchEventForm=\{matchEventForms\[match\.id\] \?\? EMPTY_MATCH_EVENT_FORM\}/)
  assert.match(previousSection, /scoreDraft=\{scoreDrafts\[match\.id\] \?\? \{ homeScore: match\.homeScore, awayScore: match\.awayScore \}\}/)
  assert.match(previousSection, /volunteerSelectionStatus=\{volunteerSelectionStatus\}/)
})

test('staff live match console polls match state without full page reload', () => {
  const source = readFileSync(
    new URL('../src/pages/MatchDayPage.jsx', import.meta.url),
    'utf8',
  )
  const refreshStart = source.indexOf('async function refreshLiveMatches()')
  const refreshEnd = source.indexOf('const updateForm = (updates) => {', refreshStart)
  assert.notEqual(refreshStart, -1)
  assert.notEqual(refreshEnd, -1)
  const refreshSource = source.slice(refreshStart, refreshEnd)

  assert.match(source, /const LIVE_MATCH_REFRESH_INTERVAL_MS = 15000/)
  assert.match(source, /const LIVE_MATCH_CLOCK_INTERVAL_MS = 1000/)
  assert.match(refreshSource, /getMatchDays\(\{ user \}\)/)
  assert.match(refreshSource, /setMatches\(nextMatches\)/)
  assert.match(refreshSource, /setLiveRefreshStatus\('ok'\)/)
  assert.match(refreshSource, /setLiveRefreshStatus\('warning'\)/)
  assert.match(refreshSource, /window\.setInterval\(\(\) => \{/)
  assert.doesNotMatch(refreshSource, /window\.location|reload\(|loadData\(/)
})

test('staff live controls expose pause, resume, timer, and action feedback', () => {
  const source = readFileSync(
    new URL('../src/pages/MatchDayPage.jsx', import.meta.url),
    'utf8',
  )
  const statusHandlerStart = source.indexOf('const saveMatchStatus = async (match, status')
  const statusHandlerEnd = source.indexOf('const handleScoreSave = async (match) => {', statusHandlerStart)
  assert.notEqual(statusHandlerStart, -1)
  assert.notEqual(statusHandlerEnd, -1)
  const statusHandlerSource = source.slice(statusHandlerStart, statusHandlerEnd)

  assert.match(source, /const RUNNING_MATCH_STATUSES = new Set\(\['live', 'second_half', 'extra_time', 'penalties'\]\)/)
  assert.match(source, /const PAUSED_MATCH_STATUSES = new Set\(\['half_time'\]\)/)
  assert.match(source, /const LIVE_CONTROL_STATUSES = \['half_time', 'second_half', 'extra_time', 'penalties', 'full_time'\]/)
  assert.match(source, /return \{ label: 'Resume', status: 'second_half' \}/)
  assert.match(source, /function formatLiveMatchClock\(match, now = Date\.now\(\)\)/)
  assert.match(source, /return formatMatchTimerClock\(match, now\)/)
  assert.match(source, /isMatchTimerPaused\(match\)/)
  assert.match(source, /setMatchDayTimerState\(\{ user, match, action \}\)/)
  assert.match(source, /const LIVE_MATCH_CLOCK_INTERVAL_MS = 1000/)
  assert.match(source, /<LiveMatchQuickActions/)
  assert.match(source, /isLiveConsole && !isGameMode/)
  assert.match(source, /Add goal/)
  assert.match(source, /Add event\/card/)
  assert.match(source, /'Pause'/)
  assert.match(source, /Half time/)
  assert.match(source, /Full time/)
  assert.match(source, /Open Game Mode/)
  assert.match(source, /onHydrationToggle\(match, 'pause'\)/)
  assert.match(source, /onStatusChange\(match, 'half_time'\)/)
  assert.match(source, /onStatusChange\(match, 'full_time'\)/)
  assert.match(source, /Live sync retrying/)
  assert.match(statusHandlerSource, /saveMatchStatus\(match, status, \{ shouldConfirm: true \}\)/)
  assert.doesNotMatch(statusHandlerSource, /updates\.phaseStartedAt = new Date\(\)\.toISOString\(\)/)
  assert.match(statusHandlerSource, /setMatchActionStatus\(\{\s*key: `\$\{match\.id\}:status`/)
  assert.match(statusHandlerSource, /tone: 'success'/)
  assert.match(statusHandlerSource, /tone: 'error'/)
})

test('phone and tablet Game Day renders pitchside cockpit before lower priority content', () => {
  const source = readFileSync(
    new URL('../src/pages/MatchDayPage.jsx', import.meta.url),
    'utf8',
  )
  const cockpitPanelStart = source.indexOf('function PitchsideCockpitPanel')
  const cockpitPanelEnd = source.indexOf('function MatchDayCard', cockpitPanelStart)
  const cockpitRenderStart = source.indexOf('{pitchsidePriorityMatch ? (')
  const fixtureListStart = source.indexOf('>Active fixtures</h2>')
  const mobileOverviewStart = source.indexOf('Game Day overview and needs attention')
  const desktopSummaryStart = source.indexOf('<section className="hidden gap-3 xl:grid xl:grid-cols-4">')
  const routeGuardStart = source.indexOf('if (!canManageMatchDay(user))')
  assert.notEqual(cockpitPanelStart, -1)
  assert.notEqual(cockpitPanelEnd, -1)
  assert.notEqual(cockpitRenderStart, -1)
  assert.notEqual(fixtureListStart, -1)
  assert.notEqual(mobileOverviewStart, -1)
  assert.notEqual(desktopSummaryStart, -1)
  assert.notEqual(routeGuardStart, -1)
  assert.ok(routeGuardStart < cockpitRenderStart)
  assert.ok(cockpitRenderStart < fixtureListStart)
  assert.ok(fixtureListStart < mobileOverviewStart)
  assert.ok(mobileOverviewStart < desktopSummaryStart)

  const cockpitPanelSource = source.slice(cockpitPanelStart, cockpitPanelEnd)
  assert.match(source, /const pitchsidePriorityMatch = useMemo\([\s\S]*activeMatches\.find\(isLiveMatchConsoleState\) \|\| activeMatches\[0\]/)
  assert.match(source, /function isLiveMatchConsoleState\(match\)/)
  assert.match(cockpitPanelSource, /aria-label="Pitchside Game Day cockpit"/)
  assert.match(cockpitPanelSource, /xl:hidden/)
  assert.match(cockpitPanelSource, /Score/)
  assert.match(cockpitPanelSource, /Timer/)
  assert.match(cockpitPanelSource, /Period/)
  assert.match(cockpitPanelSource, /LiveMatchQuickActions/)
  assert.match(cockpitPanelSource, /Manage fixture/)
  assert.match(cockpitPanelSource, /Open Game Mode/)
  assert.match(cockpitPanelSource, /onToggle=\{onToggle\}/)
  assert.match(source, /<summary className="cursor-pointer[\s\S]*Game Day overview and needs attention/)
  assert.match(source, /className="hidden overflow-hidden rounded-lg border border-\[#d7e5dc\][\s\S]*xl:block"/)
})

test('expanded Game Day fixture orders pitchside inputs before admin detail panels', () => {
  const source = readFileSync(
    new URL('../src/pages/MatchDayPage.jsx', import.meta.url),
    'utf8',
  )

  assert.match(source, /<section className=\{`\$\{panelClass\} order-1`\}>[\s\S]*Game Mode/)
  assert.match(source, /<section className=\{`\$\{panelClass\} order-2`\}>[\s\S]*Score/)
  assert.match(source, /<form className=\{`\$\{panelClass\} order-3`\} onSubmit=\{\(event\) => onAddGoal\(event, match\)\}>/)
  assert.match(source, /<form className=\{`\$\{panelClass\} order-4`\} onSubmit=\{\(event\) => onAddMatchEvent\(event, match\)\}>/)
  assert.match(source, /<div className="order-5">[\s\S]*<MatchTimelinePanel/)
  assert.match(source, /<div className="order-6">[\s\S]*<MatchDayReadinessPanel match=\{match\} \/>/)
  assert.match(source, /<div className="order-7 grid gap-4/)
})

test('parent Match Day calendar events expose Add to calendar only after parent portal filtering', () => {
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

  assert.match(source, /function buildParentMatchDayCalendarUrl\(event\)/)
  assert.match(source, /event\?\.sourceType !== 'parent-match-day'/)
  assert.match(source, /new URLSearchParams\(\{[\s\S]*action: 'TEMPLATE'[\s\S]*ctz: 'Europe\/London'/)
  assert.match(source, /Parent Portal: https:\/\/footballplayer\.online\/parent-portal/)
  assert.match(calendarBuilderSource, /const matchEvents = matches[\s\S]*sourceType: 'parent-match-day'/)
  assert.match(modalSource, /const calendarUrl = buildParentMatchDayCalendarUrl\(event\)/)
  assert.match(modalSource, /Add to calendar/)
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
  assert.match(calendarBuilderSource, /matches[\s\S]*\.map\(\(match\) => \(\{[\s\S]*data: match/)
  assert.doesNotMatch(calendarBuilderSource, /all_team_parents|all_club_parents|parent_audience|parentAudience/)
})

test('Game Mode opens existing live state without restarting and matches pause resume rules', () => {
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

  assert.match(openSource, /setGameModeMatchId\(match\.id\)/)
  assert.match(openSource, /if \(match\.status === 'scheduled' \|\| match\.status === 'scorer_request'\)/)
  assert.match(openSource, /await saveMatchStatus\(match, 'live'\)/)
  assert.doesNotMatch(openSource.replace(/if \(match\.status === 'scheduled' \|\| match\.status === 'scorer_request'\)[\s\S]*/, ''), /saveMatchStatus\(match, 'live'\)/)
  assert.match(source, /onGameModeStart=\{handleGameModeOpen\}/)
  assert.match(gameModeSource, /const isPaused = isMatchTimerPaused\(match\)/)
  assert.doesNotMatch(gameModeSource, /gameModePauseState/)
  assert.match(gameModeSource, /\{isPaused \? 'Resume' : 'Hydration'\}/)
  assert.match(gameModeSource, /const canMoveToHalfTime = match\.status === 'live'/)
  assert.match(gameModeSource, /disabled=\{isBusy \|\| !canMoveToHalfTime \|\| isFullTime\}/)
  assert.match(gameModeSource, /disabled=\{isBusy \|\| isFullTime\}/)
})

test('staff goal logging closes the expanded mobile panel after successful save only', () => {
  const source = readFileSync(
    new URL('../src/pages/MatchDayPage.jsx', import.meta.url),
    'utf8',
  )
  const goalHandlerStart = source.indexOf('const handleAddGoal = async (event, match) => {')
  const goalHandlerEnd = source.indexOf('const handleResetPrevious = async () => {', goalHandlerStart)
  assert.notEqual(goalHandlerStart, -1)
  assert.notEqual(goalHandlerEnd, -1)
  const goalHandlerSource = source.slice(goalHandlerStart, goalHandlerEnd)

  assert.match(goalHandlerSource, /await addStaffMatchDayGoal\(\{ user, match, goal \}\)/)
  assert.match(goalHandlerSource, /setGoalForms\(\(currentForms\) => \(\{/)
  assert.match(goalHandlerSource, /setExpandedMatchId\(\(currentId\) => \(currentId === match\.id \? '' : currentId\)\)/)
  assert.match(goalHandlerSource, /Goal added\./)
  assert.doesNotMatch(goalHandlerSource.slice(goalHandlerSource.indexOf('catch (error)')), /setExpandedMatchId/)
})

test('parent live score polling remains in the parent portal', () => {
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
  assert.doesNotMatch(source, /Open Game Mode/)
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

  assert.match(pageSource, /requestScorer: true/)
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

test('match day fixture creation reports queued availability requests or post-save queue failures', () => {
  const source = readFileSync(
    new URL('../src/pages/MatchDayPage.jsx', import.meta.url),
    'utf8',
  )
  const handlerStart = source.indexOf('const handleConfirmCreateMatch = async () => {')
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
  assert.doesNotMatch(handlerSource, /Availability sending is gated in this environment/)
})
