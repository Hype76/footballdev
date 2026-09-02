import assert from 'node:assert/strict'
import test from 'node:test'
import { readFile } from 'node:fs/promises'
import { captureParentScorerAction, getParentMatchTimeline, getParentScorerActionLabel, getParentScorerMatches } from '../apps/parent-mobile/src/parentScorerCore.js'
import { buildCompletedMatchEventPresentation } from '../src/lib/matchday-final-report.js'
import { formatMatchAddedTimeClock, getMatchEventTime } from '../src/lib/matchday-event-time.js'
import { buildParentMatchDayNotificationCopy } from '../netlify/functions/lib/_match-day-notification-copy.js'

const match = { id: 'match', status: 'live', currentMatchPhase: 'first_half', matchDurationMinutes: 20, timerStatus: 'paused', timerElapsedSeconds: 14 * 60 + 30, isScorer: true, homeAway: 'home', homeScore: 2, awayScore: 1 }

test('assigned scorer remains discoverable after a fresh load, including half-time and finishing the report', () => {
  const fresh = JSON.parse(JSON.stringify(match))
  assert.deepEqual(getParentScorerMatches([fresh, { ...fresh, id: 'other', isScorer: false }]).map(x => x.id), ['match'])
  assert.equal(getParentScorerActionLabel(fresh), 'Resume scoring')
  assert.equal(getParentScorerActionLabel({ ...fresh, status: 'half_time' }), 'Resume scoring')
  assert.equal(getParentScorerActionLabel({ ...fresh, status: 'full_time' }), 'Finish match report')
  assert.deepEqual(getParentScorerMatches([{ ...fresh, concludedAt: '2026-09-02' }, { ...fresh, status: 'cancelled' }]), [])
})

test('fixed duration captures added time separately and continuous clocks retain elapsed minutes', () => {
  assert.equal(formatMatchAddedTimeClock(match), '10+4:30')
  const capture = captureParentScorerAction(match, 'goal', 1000)
  assert.equal(capture.capturedMinute, 10)
  assert.equal(capture.capturedStoppageMinute, 5)
  assert.deepEqual(getMatchEventTime(match, 15, 'first_half'), { minute: 10, stoppageMinute: 5 })
  assert.deepEqual(getMatchEventTime(match, 25, 'second_half'), { minute: 20, stoppageMinute: 5 })
  assert.deepEqual(getMatchEventTime({ ...match, clockMode: 'continuous' }, 15, 'first_half'), { minute: 15, stoppageMinute: null })
  assert.equal(formatMatchAddedTimeClock({ ...match, currentMatchPhase: 'second_half', status: 'second_half', timerElapsedSeconds: 600 }), '10:00')
})

test('completed report puts Full time first, Kick-off last, and preserves phase order over overlapping added minutes', () => {
  const completed = { ...match, status: 'full_time', events: [
    { id: 'early', eventType: 'goal', matchPhase: 'first_half', minute: 15, scorerName: 'First' },
    { id: 'later', eventType: 'goal', matchPhase: 'second_half', minute: 11, scorerName: 'Second' },
    { id: 'void', eventType: 'goal', eventStatus: 'voided', minute: 19 },
  ] }
  const timeline = getParentMatchTimeline(completed)
  assert.deepEqual(timeline.map(x => x.id), ['match:fulltime', 'later', 'early', 'match:kickoff'])
  assert.equal(buildCompletedMatchEventPresentation(timeline[0], completed).title, 'Full time')
  assert.equal(buildCompletedMatchEventPresentation(timeline[2], completed).minuteLabel, "10+5'")
  assert.equal(buildCompletedMatchEventPresentation(timeline.at(-1), completed).title, 'Kick-off')
  assert.equal(getParentMatchTimeline(match).at(-1).eventType, 'kick_off')
  assert.deepEqual(getParentMatchTimeline({ status: 'scheduled' }), [])
})

test('own goals have explicit report and notification wording', () => {
  const goal = { eventType: 'goal', isOwnGoal: true, teamSide: 'opponent', scorerName: 'Alex', minute: 10, stoppageMinute: 2 }
  assert.equal(buildCompletedMatchEventPresentation(goal, match).title, 'Own goal')
  const copy = buildParentMatchDayNotificationCopy({ match, type: 'goal', event: goal })
  assert.match(JSON.stringify(copy), /Own goal: Alex/)
})

test('Home opens the scoring route, club heading replaces app heading and correction reason is submitted', async () => {
  const app = await readFile(new URL('../apps/parent-mobile/App.js', import.meta.url), 'utf8')
  const screens = await readFile(new URL('../apps/parent-mobile/src/ParentPortalScreens.js', import.meta.url), 'utf8')
  const data = await readFile(new URL('../apps/parent-mobile/src/parentPortalData.js', import.meta.url), 'utf8')
  assert.match(app, /onOpenMatch=\{\(match\) => \{ setSelectedMatchId\(match.id\); setActiveTab\('matchday'\)/)
  assert.match(app, /selectedLink\?\.clubName \|\| 'Your club'/)
  assert.doesNotMatch(app, />Football Player Parents</)
  assert.match(screens, /accessibilityLabel="Score correction reason"[^>]*multiline/)
  assert.match(screens, /submitAndClose\('score', \{ awayScore, homeScore, reason: scoreReason \}\)/)
  assert.match(data, /notes_value: normalizeText\(reason\) \|\| 'Score corrected by parent scorer'/)
  assert.match(screens, /const activeEvents = getParentMatchTimeline\(match\)/)
})
