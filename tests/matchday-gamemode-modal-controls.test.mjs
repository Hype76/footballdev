import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { test } from 'node:test'

const matchDayPageUrl = new URL('../src/pages/MatchDayPage.jsx', import.meta.url)

test('Open Game Mode is read only while Start Match and Resume Match use explicit status paths', async () => {
  const source = await readFile(matchDayPageUrl, 'utf8')
  const statusChangeStart = source.indexOf('const handleStatusChange = async (match, status) => {')
  const gameModeOpenStart = source.indexOf('const handleGameModeOpen = (match) => {')
  const statusChange = source.slice(statusChangeStart, gameModeOpenStart)
  const gameModeOpen = source.slice(gameModeOpenStart, source.indexOf('const handleGameModeStatusChange', gameModeOpenStart))

  assert.match(statusChange, /status === 'live'/)
  assert.match(statusChange, /await saveMatchStatus\(match, 'live'\)/)
  assert.match(statusChange, /status === 'second_half' \|\| status === 'resume_match'/)
  assert.match(statusChange, /await saveMatchStatus\(match, status\)/)
  assert.match(gameModeOpen, /setGameModeMatchId\(match\.id\)/)
  assert.doesNotMatch(gameModeOpen, /saveMatchStatus|setMatchDayTimerState|updateMatchDay/)
  assert.match(source, /Game Mode is open, but the match clock has not started/)
  assert.match(source, /onClick=\{\(\) => onStartMatch\(match\)\}/)
})

test('Game Mode owns live goal and event entry through app modals', async () => {
  const source = await readFile(matchDayPageUrl, 'utf8')
  const cardSlice = source.slice(
    source.indexOf('function MatchDayCard'),
    source.indexOf('function LiveMatchQuickActions'),
  )
  const gameModeSlice = source.slice(
    source.indexOf('function MatchDayGameModePanel'),
    source.indexOf('function GoalCorrectionModal'),
  )

  assert.match(source, /const \[liveEntryModal, setLiveEntryModal\] = useState\(null\)/)
  assert.match(source, /function LiveMatchEntryModal/)
  assert.match(source, /function GoalCorrectionModal/)
  assert.match(gameModeSlice, /onOpenGoalModal\(match\)/)
  assert.match(gameModeSlice, /onOpenEventModal\(match\)/)
  assert.doesNotMatch(gameModeSlice, /activeFlow/)
  assert.doesNotMatch(cardSlice, /onAddGoal/)
  assert.doesNotMatch(cardSlice, /onAddMatchEvent/)
  assert.match(cardSlice, /Use Game Mode for goals, cards, substitutions, hydration, half time, and full time/)
  assert.match(cardSlice, /Manage stays focused on fixture setup, score checks, roles, availability, notes, and history/)
})

test('Game Mode modal fields prevent opponent and own-team mixed states', async () => {
  const source = await readFile(matchDayPageUrl, 'utf8')
  const liveEntrySlice = source.slice(
    source.indexOf('function LiveMatchEntryModal'),
    source.indexOf('function getMatchEventSortMinute'),
  )
  const goalCorrectionSlice = source.slice(
    source.indexOf('function GoalCorrectionModal'),
    source.indexOf('function LiveMatchEntryModal'),
  )

  assert.match(source, /function getGoalSideFormReset\(teamSide\)/)
  assert.match(source, /function getMatchEventTeamSideFormReset\(teamSide\)/)
  assert.match(source, /function getMatchEventPlayerLabels\(eventType, isOpponentTeamSide\)/)
  assert.match(source, /scorerName: '',[\s\S]*scorerShirtNumber: '',[\s\S]*assistName: '',[\s\S]*assistShirtNumber: '',/)
  assert.match(source, /playerId: '',[\s\S]*playerName: '',[\s\S]*playerShirtNumber: '',[\s\S]*playerOnId: '',[\s\S]*playerOnName: '',[\s\S]*playerOnShirtNumber: '',/)

  assert.match(liveEntrySlice, /const isOpponentGoal = goalForm\.teamSide === 'opponent'/)
  assert.match(liveEntrySlice, /onGoalFormChange\(match\.id, getGoalSideFormReset\(event\.target\.value\)\)/)
  assert.match(liveEntrySlice, /\{!isOpponentGoal \? \([\s\S]*Scorer player/)
  assert.match(liveEntrySlice, /\{isOpponentGoal \? 'Opponent scorer name optional' : 'Scorer name'\}/)
  assert.match(liveEntrySlice, /\{isOpponentGoal \? 'Opponent scorer shirt optional' : 'Scorer shirt'\}/)
  assert.match(liveEntrySlice, /\{!isOpponentGoal \? \([\s\S]*Assist player[\s\S]*Assist name[\s\S]*Assist shirt/)

  assert.match(liveEntrySlice, /const isOpponentMatchEvent = matchEventForm\.teamSide === 'opponent'/)
  assert.match(liveEntrySlice, /const matchEventPlayerLabels = getMatchEventPlayerLabels\(matchEventForm\.eventType, isOpponentMatchEvent\)/)
  assert.match(liveEntrySlice, /onMatchEventFormChange\(match\.id, getMatchEventTeamSideFormReset\(event\.target\.value\)\)/)
  assert.match(liveEntrySlice, /\{matchEventPlayerLabels\.playerSelect \? \([\s\S]*onMatchEventPlayerPick/)
  assert.match(source, /playerSelect: null,[\s\S]*playerName: 'Opponent player name optional'[\s\S]*playerOnSelect: null/)
  assert.match(source, /playerSelect: 'Player Off',[\s\S]*playerName: 'Player Off name'[\s\S]*playerOnSelect: 'Player On'[\s\S]*playerOnName: 'Player On name'[\s\S]*notes: 'Note'/)

  assert.match(goalCorrectionSlice, /const isOpponentGoal = goal\.teamSide === 'opponent'/)
  assert.match(goalCorrectionSlice, /updateGoal\(getGoalSideFormReset\(event\.target\.value\)\)/)
  assert.match(goalCorrectionSlice, /\{!isOpponentGoal \? \([\s\S]*Scorer player/)
  assert.match(goalCorrectionSlice, /\{isOpponentGoal \? 'Opponent scorer name optional' : 'Scorer name'\}/)
  assert.match(goalCorrectionSlice, /\{!isOpponentGoal \? \([\s\S]*Assist player[\s\S]*Assist name[\s\S]*Assist shirt/)
})

test('Mobile Game Mode prioritises one cockpit and removes duplicate Back controls', async () => {
  const source = await readFile(matchDayPageUrl, 'utf8')
  const cardSlice = source.slice(
    source.indexOf('function MatchDayCard'),
    source.indexOf('function LiveMatchQuickActions'),
  )
  const gameModeSlice = source.slice(
    source.indexOf('function MatchDayGameModePanel'),
    source.indexOf('function GoalCorrectionModal'),
  )

  assert.match(cardSlice, /\{isExpanded && !isGameMode \? \(/)
  assert.match(gameModeSlice, /game-mode-cockpit/)
  assert.match(gameModeSlice, /aria-label="Game Mode cockpit"/)
  assert.match(gameModeSlice, /Score/)
  assert.match(gameModeSlice, /Timer/)
  assert.match(gameModeSlice, /Period/)
  assert.match(gameModeSlice, /Exit Game Mode/)
  assert.doesNotMatch(gameModeSlice, />Back</)
  assert.match(gameModeSlice, /grid-cols-2[\s\S]*sm:grid-cols-3[\s\S]*lg:grid-cols-6/)
  assert.match(gameModeSlice, /<MatchTimelinePanel[\s\S]*events=\{events\}[\s\S]*match=\{match\}[\s\S]*onUndoEvent=\{onUndoEvent\}/)
  assert.doesNotMatch(gameModeSlice, /<MatchTimelinePanel[^>]*isReadOnly/)
})

test('Half Time, Full Time, score overwrite, event void, and reset use app modals only', async () => {
  const source = await readFile(matchDayPageUrl, 'utf8')
  const gameModeStatusStart = source.indexOf('const handleGameModeStatusChange = async (match, status) => {')
  const gameModeStatus = source.slice(gameModeStatusStart, source.indexOf('const handleConfirmStatusAction', gameModeStatusStart))

  assert.match(gameModeStatus, /status === 'half_time'/)
  assert.match(gameModeStatus, /setPendingStatusAction/)
  assert.match(gameModeStatus, /Confirm half time/)
  assert.match(gameModeStatus, /status === 'full_time'/)
  assert.match(gameModeStatus, /Confirm full time/)
  assert.match(source, /setPendingMatchAction\(\{[\s\S]*type: 'score'/)
  assert.match(source, /setUndoEventModal\(\{[\s\S]*eventId: timelineEvent\.id/)
  assert.match(source, /function UndoEventModal/)
  assert.match(source, /setPendingMatchAction\(\{[\s\S]*type: 'resetPrevious'/)
  assert.doesNotMatch(source, /window\.confirm|window\.prompt|window\.alert|confirmMatchDayAction|promptGoalCorrectionInput/)
})

test('Hydration stays direct and shows visible paused or resume state', async () => {
  const source = await readFile(matchDayPageUrl, 'utf8')
  const gameModeSlice = source.slice(
    source.indexOf('function MatchDayGameModePanel'),
    source.indexOf('function GoalCorrectionModal'),
  )

  assert.match(source, /const handleGameModeHydrationToggle = async \(match, pauseAction = 'hydration'\) =>/)
  assert.match(gameModeSlice, /onHydrationToggle\(match, 'pause'\)/)
  assert.match(gameModeSlice, />Pause</)
  assert.match(gameModeSlice, /Match clock paused\. Use Resume to continue from the frozen time\./)
  assert.match(gameModeSlice, /isPaused \? 'Resume' : 'Hydration'/)
  assert.doesNotMatch(gameModeSlice, /setPendingStatusAction[\s\S]{0,120}hydration/i)
})
