import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { test } from 'node:test'

const pageSource = readFileSync(new URL('../src/pages/MatchDayPage.jsx', import.meta.url), 'utf8')

function getHandlerSource(startMarker, endMarker) {
  const start = pageSource.indexOf(startMarker)
  const end = pageSource.indexOf(endMarker, start)

  assert.notEqual(start, -1, `Missing source marker: ${startMarker}`)
  assert.notEqual(end, -1, `Missing source marker: ${endMarker}`)

  return pageSource.slice(start, end)
}

test('post-mutation refresh keeps local state while loading authoritative Match detail', () => {
  const helperSource = getHandlerSource(
    'const refreshMatchDayDetailAfterMutation = async',
    'const retryMatchDayLiveDetail = async',
  )

  assert.match(helperSource, /if \(typeof reconcile === 'function'\) \{\s*setMatches\(reconcile\)/)
  assert.match(helperSource, /setLiveRefreshStatus\('refreshing'\)/)
  assert.match(helperSource, /getMatchDay\(\{[\s\S]*matchDayId: matchId,[\s\S]*includeScorerEligibility: true/)
  assert.match(helperSource, /replaceMatchDayDetailInList\(currentMatches, \{[\s\S]*match: refreshedMatch,[\s\S]*matchId/)
  assert.match(helperSource, /setLiveRefreshStatus\('ok'\)/)
  assert.match(helperSource, /catch \(refreshError\)[\s\S]*setLiveRefreshStatus\('warning'\)[\s\S]*setErrorMessage\(warning\)[\s\S]*return \{ refreshedMatch: null, warning \}/)
  assert.doesNotMatch(helperSource, /setMatches\(\[\]\)|setExpandedMatchId|setGameModeMatchId/)
})

test('successful goal logging preserves selected Match and Game Mode state', () => {
  const handlerSource = getHandlerSource(
    'const handleAddGoal = async (event, match) => {',
    'const openGoalCorrectionModal =',
  )

  assert.match(handlerSource, /setMatches\(reconcileSavedGoal\)/)
  assert.match(handlerSource, /await refreshMatchDayDetailAfterMutation\(\{[\s\S]*matchId: match\.id/)
  assert.doesNotMatch(handlerSource, /setExpandedMatchId|setGameModeMatchId|await loadData\(\)/)
})

test('primary live Match mutations use scoped authoritative detail refresh', () => {
  const handlers = [
    ['const reconcileSavedTimerMatch = async', 'const persistTimerAction = async'],
    ['const handleShootoutKick = async', 'const handleVoidShootoutKick = async'],
    ['const handleVoidShootoutKick = async', 'const performScoreSave = async'],
    ['const performScoreSave = async', 'const openVolunteerSelectionPrompt ='],
    ['const performGoalCorrection = async', 'const handleCorrectGoal ='],
    ['const performVoidEvent = async', 'const handleUndoEvent ='],
    ['const handleAddMatchEvent = async', 'const performResetPrevious = async'],
  ]

  for (const [startMarker, endMarker] of handlers) {
    const handlerSource = getHandlerSource(startMarker, endMarker)
    assert.match(handlerSource, /await refreshMatchDayDetailAfterMutation\(\{/)
    assert.doesNotMatch(handlerSource, /await loadData\(\)/)
  }
})

test('recoverable live refresh warning exposes an explicit retry without hiding the workspace', () => {
  const retrySource = getHandlerSource(
    'const retryMatchDayLiveDetail = async',
    'const handleMatchToggle = async',
  )
  const cardSource = getHandlerSource(
    'function MatchDayCard({',
    'function MatchDayReadinessPanel(',
  )

  assert.match(retrySource, /await refreshMatchDayDetailAfterMutation\(\{[\s\S]*matchId: match\.id/)
  assert.match(cardSource, /Live sync needs attention/)
  assert.match(cardSource, /onClick=\{\(\) => void onRetryLiveRefresh\(match\)\}/)
  assert.match(cardSource, /Retry live data/)
  assert.match(pageSource, /selectedMatch && \(!isDemoExperience \|\| isGameModeActive\) \? renderSelectedMatchWorkspace\(selectedMatch\) : null/)
})
