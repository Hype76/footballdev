import assert from 'node:assert/strict'
import { test } from 'node:test'
import { buildParentMatchDayNotificationCopy } from '../netlify/functions/lib/_match-day-notification-copy.js'

const match = {
  id: 'feedback-match', opponent: 'Newcastle', home_score: 3, away_score: 1,
  teams: { name: 'U17 Green', notification_display_name: 'U17G' },
  clubs: { name: 'Football Player Demo FC' },
}

test('Other scorer and free text assist names appear in detailed goal alerts', () => {
  const copy = buildParentMatchDayNotificationCopy({ match, type: 'goal', event: {
    id: 'named-goal', event_type: 'goal', team_side: 'club',
    scorer_name: 'Other: Trial Player', assist_name: 'Guest Assist',
  } })
  assert.equal(copy.detailedBody, 'Goal: Trial Player. Assist: Guest Assist. 3 - 1 v Newcastle.')
  assert.equal(copy.matchTitle, 'U17G v Newcastle')
  assert.doesNotMatch(copy.minimalBody, /Trial Player|Guest Assist/)
  assert.equal(copy.tag, 'match-day-feedback-match-goal-named-goal')
})

test('squad shirt numbers survive alongside an Other scorer', () => {
  const copy = buildParentMatchDayNotificationCopy({ match, type: 'goal', event: {
    scorerName: 'Other: Trial Player', assistName: 'Ella Foster', assistShirtNumber: '5',
  } })
  assert.equal(copy.detailedBody, 'Goal: Trial Player. Assist: Ella Foster #5. 3 - 1 v Newcastle.')
})

test('compact match titles retain fixture identity for all notification categories', () => {
  for (const type of ['live', 'goal', 'half_time', 'full_time', 'scorer_selected']) {
    const copy = buildParentMatchDayNotificationCopy({ match, type })
    assert.equal(copy.matchTitle, 'U17G v Newcastle')
    assert.doesNotMatch(copy.matchTitle, /Football Player Demo FC/)
    assert.ok(copy.minimalBody.length > 0)
    assert.ok(copy.detailedBody.length > 0)
  }
})
