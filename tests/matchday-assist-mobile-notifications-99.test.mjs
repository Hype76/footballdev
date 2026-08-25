import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'

import { buildCompletedMatchEventPresentation } from '../src/lib/matchday-final-report.js'
import { buildParentMatchDayNotificationCopy } from '../netlify/functions/lib/_match-day-notification-copy.js'

const root = new URL('../', import.meta.url)
const source = (path) => readFile(new URL(path, root), 'utf8')

test('goal event presentation shows a recorded assist and remains useful without one', () => {
  assert.equal(
    buildCompletedMatchEventPresentation({ eventType: 'goal', scorerName: 'John Barnes', assistName: 'Jamie Smith' }).detail,
    'John Barnes, assisted by Jamie Smith',
  )
  assert.equal(
    buildCompletedMatchEventPresentation({ eventType: 'goal', scorerName: 'John Barnes' }).detail,
    'John Barnes',
  )
})

test('detailed goal notifications use compact scorer and assist copy while minimal copy does not expose Player names', () => {
  const copy = buildParentMatchDayNotificationCopy({
    match: { away_score: 0, home_score: 1, home_away: 'home', id: 'match', opponent: 'Visitors', teams: { name: 'U17 Green' } },
    type: 'goal',
    event: { assist_name: 'Jamie Smith', assist_shirt_number: '8', event_type: 'goal', scorer_name: 'John Barnes' },
  })

  assert.equal(copy.detailedBody, 'Goal: John Barnes. Assist: Jamie Smith #8. 1 - 0 v Visitors.')
  assert.doesNotMatch(copy.minimalBody, /Jamie Smith|John Barnes/)
})

test('Parent scorer goals preserve assist fields and request the shared Parent push after the event is saved', async () => {
  const [app, data, parentScreen, coachScreen] = await Promise.all([
    source('apps/parent-mobile/App.js'),
    source('apps/parent-mobile/src/parentPortalData.js'),
    source('apps/parent-mobile/src/ParentPortalScreens.js'),
    source('apps/coach-mobile/src/CoachMatchDayScreen.js'),
  ])

  assert.match(data, /assist_name_value: normalizeText\(goal\.assistName\)/)
  assert.match(data, /sendParentScorerMatchDayPush[\s\S]*send-match-day-push/)
  assert.match(app, /const savedEvent = await addParentScorerGoal[\s\S]*sendParentScorerMatchDayPush\(selectedMobileUser, match\.id, 'goal', savedEvent\?\.id\)/)
  assert.match(parentScreen, /buildCompletedMatchEventPresentation\(event, selectedMatch/)
  assert.match(coachScreen, /buildCompletedMatchEventPresentation\(event, match/)
})
