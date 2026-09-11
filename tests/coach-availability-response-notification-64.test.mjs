import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'

import { buildCoachAvailabilityResponsePayload } from '../netlify/functions/lib/_coach-availability-push.js'

test('Coach availability notifications deep-link to the exact Match Day item', () => {
  const payload = buildCoachAvailabilityResponsePayload({
    contextLabel: 'the match against Wrexham',
    detailLevel: 'detailed',
    playerName: 'Jack Hughes',
    route: 'matchday',
    status: 'available',
    targetId: 'match-wrexham',
    teamId: 'team-1',
    type: 'match_availability_response',
  })
  assert.equal(payload.body, 'Jack Hughes is attending for the match against Wrexham.')
  assert.deepEqual(payload.data, {
    app: 'coach',
    clubName: '',
    route: 'matchday',
    targetId: 'match-wrexham',
    teamId: 'team-1',
    teamName: '',
    type: 'match_availability_response',
  })
})

test('default Coach availability notifications identify the player, response and training session', () => {
  const payload = buildCoachAvailabilityResponsePayload({
    detailLevel: 'minimal',
    playerName: 'Jack Hughes',
    contextLabel: 'U14 training',
    route: 'sessions',
    status: 'unavailable',
    targetId: 'training-1',
    teamId: 'team-1',
    type: 'training_availability_response',
  })
  assert.equal(payload.body, 'Jack Hughes is not attending for U14 training.')
  assert.equal(payload.data.route, 'sessions')
  assert.equal(payload.data.targetId, 'training-1')
})

test('availability alerts keep useful copy across existing detail preferences and response values', () => {
  for (const detailLevel of [undefined, 'minimal', 'detailed']) {
    for (const [status, responseText] of [['available', 'is attending'], ['unavailable', 'is not attending'], ['maybe', 'responded Maybe']]) {
      const payload = buildCoachAvailabilityResponsePayload({ clubName: 'FP TEST Club', teamName: 'U14', detailLevel, playerName: 'Alex Taylor', status, contextLabel: 'Saturday training' })
      assert.equal(payload.body, `Alex Taylor ${responseText} for Saturday training.`)
      assert.equal(payload.title, 'FP TEST Club | U14 | Availability updated')
    }
  }
  assert.equal(buildCoachAvailabilityResponsePayload({}).body, 'A player updated their availability.')
})

test('public availability responders trigger non-blocking Coach push delivery', async () => {
  const [matchResponse, trainingResponse] = await Promise.all([
    readFile(new URL('../netlify/functions/match-day-availability-confirm.js', import.meta.url), 'utf8'),
    readFile(new URL('../netlify/functions/training-availability-response.js', import.meta.url), 'utf8'),
  ])
  assert.match(matchResponse, /sendCoachAvailabilityResponsePush/)
  assert.match(matchResponse, /type: 'match_availability_response'/)
  assert.match(trainingResponse, /sendCoachAvailabilityResponsePush/)
  assert.match(trainingResponse, /type: 'training_availability_response'/)
  assert.match(matchResponse, /\.catch\(\(pushError\)/)
  assert.match(trainingResponse, /\.catch\(\(pushError\)/)
})

test('authenticated Parent Training responses notify Coaches only after a changed response is saved', async () => {
  const [parentData, coachPush] = await Promise.all([
    readFile(new URL('../apps/parent-mobile/src/parentPortalData.js', import.meta.url), 'utf8'),
    readFile(new URL('../netlify/functions/send-coach-mobile-push.js', import.meta.url), 'utf8'),
  ])

  assert.match(parentData, /previousResponse !== response && data\?\.respondedAt/)
  assert.match(parentData, /type: 'training_availability_response'/)
  assert.match(parentData, /requestPlayerId: invitation\.sourceRecordId/)
  assert.match(coachPush, /getParentTrainingAvailabilityResponse/)
  assert.match(coachPush, /\.eq\('auth_user_id', authUser\.id\)/)
  assert.match(coachPush, /normalizeText\(response\.responded_at\) !== respondedAt/)
  assert.match(coachPush, /route: 'sessions'/)
  assert.match(coachPush, /sendCoachAvailabilityResponsePush/)
})
