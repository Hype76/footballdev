import assert from 'node:assert/strict'
import test from 'node:test'

import { buildFanMatchNotificationPayload } from '../netlify/functions/lib/_fan-push.js'
import { buildParentMatchDayNotificationCopy } from '../netlify/functions/lib/_match-day-notification-copy.js'

const match = {
  away_score: 1,
  home_away: 'home',
  home_score: 2,
  id: 'match-detail',
  opponent: 'Visitors',
  teams: { name: 'U16 Green' },
}

test('detailed match notifications use the event minute, added time, player details, and current score', () => {
  const goal = buildParentMatchDayNotificationCopy({
    match,
    type: 'goal',
    event: {
      assist_name: 'Jamie Smith',
      assist_shirt_number: '8',
      event_type: 'goal',
      minute: 45,
      scorer_name: 'Alex Morgan',
      scorer_shirt_number: '9',
      stoppage_minute: 2,
    },
  })
  const redCard = buildParentMatchDayNotificationCopy({
    match,
    type: 'red_card',
    event: {
      event_type: 'red_card',
      minute: 71,
      player_name: 'Casey Jones',
      player_shirt_number: '4',
    },
  })
  const fullTime = buildParentMatchDayNotificationCopy({ match, type: 'full_time' })

  assert.equal(goal.detailedBody, "Goal: Alex Morgan #9 at 45+2'. Assist: Jamie Smith #8. 2 - 1 v Visitors.")
  assert.equal(goal.tag, 'match-day-match-detail-goal')
  assert.equal(redCard.detailedBody, "Red: Casey Jones #4 at 71'. 2 - 1 v Visitors.")
  assert.equal(fullTime.detailedBody, 'Full time: U16 G 2 - 1 Visitors.')
})

test('fan notifications persist and deliver the same detailed match event copy', () => {
  const notificationCopy = buildParentMatchDayNotificationCopy({
    match,
    type: 'goal',
    event: { event_type: 'goal', minute: 12, scorer_name: 'Alex Morgan' },
  })
  const payload = buildFanMatchNotificationPayload({
    fanConnectionId: 'fan-1',
    match,
    notificationCopy,
    type: 'goal',
  })

  assert.equal(payload.title, 'Goal update')
  assert.equal(payload.body, "Goal: Alex Morgan at 12'. 2 - 1 v Visitors.")
  assert.deepEqual(payload.data, {
    app: 'parent',
    route: 'fans',
    type: 'goal',
    fanConnectionId: 'fan-1',
    matchDayId: 'match-detail',
  })
})
