import assert from 'node:assert/strict'
import test from 'node:test'
import { getGoalScorerSide, setGoalOwnGoal } from '../src/lib/matchday-goal-credit.js'
import { validateScorerMatchEvent } from '../src/lib/matchday-scorer-event.js'
import { captureMatchEventTime, formatMatchAddedTimeClock, getMatchClockDescription } from '../src/lib/matchday-event-time.js'
import { captureCoachMatchDayAction, createCoachMatchDayEventForm, validateCoachMatchDayEventForm } from '../apps/mobile-core/src/coachMatchDayCore.js'
import { captureParentScorerAction } from '../apps/parent-mobile/src/parentScorerCore.js'

test('ticking own goal preserves the chosen player and credits the other team exactly once', () => {
  for (const teamSide of ['club', 'opponent']) {
    const goal = { teamSide, scorerName: 'Clyde Bates', scorerShirtNumber: '4', assistName: 'Alex', isPenaltyGoal: true }
    const own = setGoalOwnGoal(goal, true)
    assert.notEqual(own.teamSide, teamSide)
    assert.equal(getGoalScorerSide(own), teamSide)
    assert.equal(own.scorerName, goal.scorerName)
    assert.equal(own.scorerShirtNumber, goal.scorerShirtNumber)
    assert.equal(own.assistName, '')
    assert.equal(own.isPenaltyGoal, false)
    assert.deepEqual(setGoalOwnGoal(own, true), own)
    assert.equal(setGoalOwnGoal(own, false).teamSide, teamSide)
    assert.equal(validateCoachMatchDayEventForm({ ...own, eventType: 'goal', minute: '4', stoppageMinute: '1' }).isOwnGoal, true)
  }
})

test('web and both apps capture the same 10 minute match time after half-time and pause', () => {
  const now = Date.parse('2026-09-03T12:00:00Z')
  for (const clockMode of ['fixed', 'continuous']) {
    const match = { matchDurationMinutes: 10, clockMode, status: 'second_half', currentMatchPhase: 'second_half', timerStatus: 'running', timerElapsedSeconds: clockMode === 'fixed' ? 300 : 120, timerStartedAt: new Date(now).toISOString() }
    const at = now + 40000
    const minute = clockMode === 'fixed' ? 6 : 3
    assert.equal(formatMatchAddedTimeClock(match, at), clockMode === 'fixed' ? '5:40' : '2:40')
    assert.equal(captureMatchEventTime(match, at).minute, minute)
    assert.equal(captureCoachMatchDayAction(match, 'goal', at).capturedMinute, minute)
    assert.equal(captureParentScorerAction(match, 'goal', at).capturedMinute, minute)
    const paused = { ...match, timerStatus: 'paused', timerStartedAt: null, timerElapsedSeconds: match.timerElapsedSeconds + 40 }
    assert.equal(formatMatchAddedTimeClock(paused, at + 600000), formatMatchAddedTimeClock(match, at))
    assert.match(getMatchClockDescription(match), clockMode === 'fixed' ? /10 minute match, 5 minutes per half/ : /Continuous clock/)
  }
})

test('Coach event forms retain added time instead of silently losing it when saving', () => {
  const match = { matchDurationMinutes: 10, clockMode: 'fixed', status: 'live', currentMatchPhase: 'first_half', timerStatus: 'paused', timerElapsedSeconds: 370 }
  const form = createCoachMatchDayEventForm('yellow_card', match)
  assert.equal(form.minute, '5')
  assert.equal(form.stoppageMinute, '2')
  assert.equal(validateCoachMatchDayEventForm(form).stoppageMinute, 2)
})

test('scorer event validation rejects missing or identical substitution players and bad times', () => {
  const event = { eventType: 'substitution', teamSide: 'club', minute: 4, playerName: 'Clyde', playerShirtNumber: '4', playerOnName: 'Alex', playerOnShirtNumber: '9' }
  assert.equal(validateScorerMatchEvent(event).playerOnName, 'Alex')
  assert.throws(() => validateScorerMatchEvent({ ...event, playerOnName: '' }), /coming on/)
  assert.throws(() => validateScorerMatchEvent({ ...event, playerOnName: 'Clyde', playerOnShirtNumber: '4' }), /different player/)
  assert.throws(() => validateScorerMatchEvent({ ...event, minute: 1.5 }), /whole match minute/)
  assert.throws(() => validateScorerMatchEvent({ ...event, stoppageMinute: 31 }), /added time/)
  assert.throws(() => validateScorerMatchEvent({ ...event, eventType: 'delete_match' }), /card or substitution/)
})
