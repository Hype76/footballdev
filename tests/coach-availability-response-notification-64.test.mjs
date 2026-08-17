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
  assert.equal(payload.body, 'Jack Hughes is available for the match against Wrexham.')
  assert.deepEqual(payload.data, {
    app: 'coach',
    route: 'matchday',
    targetId: 'match-wrexham',
    teamId: 'team-1',
    type: 'match_availability_response',
  })
})

test('minimal Coach availability notifications do not include Player details', () => {
  const payload = buildCoachAvailabilityResponsePayload({
    detailLevel: 'minimal',
    playerName: 'Jack Hughes',
    route: 'sessions',
    status: 'unavailable',
    targetId: 'training-1',
    teamId: 'team-1',
    type: 'training_availability_response',
  })
  assert.equal(payload.body, 'A player availability response has been updated.')
  assert.doesNotMatch(payload.body, /Jack/)
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
