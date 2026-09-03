import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { test } from 'node:test'

import {
  captureCoachMatchDayAction,
  createCoachMatchDayEventForm,
} from '../apps/mobile-core/src/coachMatchDayCore.js'

const coachScreenUrl = new URL('../apps/coach-mobile/src/CoachMatchDayScreen.js', import.meta.url)
const parentScreenUrl = new URL('../apps/parent-mobile/src/ParentPortalScreens.js', import.meta.url)
const parentAppUrl = new URL('../apps/parent-mobile/App.js', import.meta.url)

const runningMatch = {
  awayScore: 0,
  homeScore: 0,
  status: 'live',
  timerElapsedSeconds: 0,
  timerStartedAt: '2026-08-25T10:00:00.000Z',
  timerStatus: 'running',
}

test('Match Day action capture freezes the clock and minute at the original button press', () => {
  const pressedAt = Date.parse('2026-08-25T10:03:35.000Z')
  const capture = captureCoachMatchDayAction(runningMatch, 'goal', pressedAt)
  const form = createCoachMatchDayEventForm('goal', runningMatch, pressedAt)

  assert.equal(capture.capturedAt, '2026-08-25T10:03:35.000Z')
  assert.equal(capture.capturedClock, '3:35')
  assert.equal(capture.capturedMinute, 4)
  assert.equal(form.capturedAt, capture.capturedAt)
  assert.equal(form.capturedClock, capture.capturedClock)
  assert.equal(form.minute, '4')
})

test('Coach Game Mode keeps the cockpit compact and moves event and score forms into action sheets', async () => {
  const source = await readFile(coachScreenUrl, 'utf8')
  const livePanel = source.slice(source.indexOf('function LivePanel'), source.indexOf('function TimelinePanel'))

  assert.match(source, /function MatchDayActionSheet/)
  assert.match(source, /KeyboardAvoidingView/)
  assert.match(source, /ScrollView/)
  assert.match(livePanel, /const pressedAt = Date\.now\(\)/)
  assert.match(livePanel, /createCoachMatchDayEventForm\(eventType, match, pressedAt\)/)
  assert.match(source, /Time captured at/)
  assert.match(livePanel, /actionSheet\?\.kind === 'event'/)
  assert.match(livePanel, /actionSheet\?\.kind === 'score'/)
  assert.match(livePanel, /\['hydration', 'pause', 'resume'\]\.includes\(action\)/)
  assert.doesNotMatch(livePanel, /eventComposerOpen|scoreCorrectionOpen|Hide score correction/)
})

test('Parent scorer Game Mode uses the shared compact action grid and focused sheets', async () => {
  const [screen, app] = await Promise.all([
    readFile(parentScreenUrl, 'utf8'),
    readFile(parentAppUrl, 'utf8'),
  ])
  const scorerControls = screen.slice(screen.indexOf('function ScorerControls'), screen.indexOf('export function MatchdayScreen'))

  assert.match(screen, /function ParentMatchDayActionSheet/)
  assert.match(scorerControls, /getParentScorerTimerActions\(match\)/)
  assert.match(scorerControls, /captureParentScorerAction\(match, kind, Date\.now\(\)\)/)
  assert.match(scorerControls, /actionSheet\?\.kind === 'goal'/)
  assert.match(scorerControls, /actionSheet\?\.kind === 'score'/)
  assert.match(scorerControls, /actionSheet\?\.kind === 'correct-goal'/)
  assert.match(scorerControls, /actionSheet\?\.kind === 'shootout'/)
  assert.match(scorerControls, /Goal details open separately so the main match screen stays clear\./)
  assert.doesNotMatch(scorerControls, /Start clock|Pause clock|Resume clock/)
  assert.match(app, /return true/)
  assert.match(app, /return false/)
})
