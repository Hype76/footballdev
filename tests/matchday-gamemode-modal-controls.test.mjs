import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { test } from 'node:test'

const matchDayPageUrl = new URL('../src/pages/MatchDayPage.jsx', import.meta.url)

test('Start Match and Resume Match enter Game Mode through the shared live status path', async () => {
  const source = await readFile(matchDayPageUrl, 'utf8')
  const statusChangeStart = source.indexOf('const handleStatusChange = async (match, status) => {')
  const gameModeOpenStart = source.indexOf('const handleGameModeOpen = async (match) => {')
  const statusChange = source.slice(statusChangeStart, gameModeOpenStart)
  const gameModeOpen = source.slice(gameModeOpenStart, source.indexOf('const handleGameModeStatusChange', gameModeOpenStart))

  assert.match(statusChange, /status === 'live' \|\| status === 'second_half'/)
  assert.match(statusChange, /await handleGameModeOpen\(match\)/)
  assert.match(gameModeOpen, /setGameModeMatchId\(match\.id\)/)
  assert.match(gameModeOpen, /match\.status === 'scheduled' \|\| match\.status === 'scorer_request'/)
  assert.match(gameModeOpen, /await saveMatchStatus\(match, 'live'\)/)
  assert.match(gameModeOpen, /PAUSED_MATCH_STATUSES\.has\(match\.status\)/)
  assert.match(gameModeOpen, /await saveMatchStatus\(match, 'second_half'\)/)
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

test('Half Time, Full Time, score overwrite, goal removal, and reset use app modals only', async () => {
  const source = await readFile(matchDayPageUrl, 'utf8')
  const gameModeStatusStart = source.indexOf('const handleGameModeStatusChange = async (match, status) => {')
  const gameModeStatus = source.slice(gameModeStatusStart, source.indexOf('const handleConfirmStatusAction', gameModeStatusStart))

  assert.match(gameModeStatus, /status === 'half_time'/)
  assert.match(gameModeStatus, /setPendingStatusAction/)
  assert.match(gameModeStatus, /Confirm half time/)
  assert.match(gameModeStatus, /status === 'full_time'/)
  assert.match(gameModeStatus, /Confirm full time/)
  assert.match(source, /setPendingMatchAction\(\{[\s\S]*type: 'score'/)
  assert.match(source, /setPendingMatchAction\(\{[\s\S]*type: 'goalVoid'/)
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
  assert.match(gameModeSlice, /Match clock paused\. Use Resume to continue from the frozen time\./)
  assert.match(gameModeSlice, /isPaused \? 'Resume' : 'Hydration'/)
  assert.doesNotMatch(gameModeSlice, /setPendingStatusAction[\s\S]{0,120}hydration/i)
})
