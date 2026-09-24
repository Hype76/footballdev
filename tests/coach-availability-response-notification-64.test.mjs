import assert from 'node:assert/strict'
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

test('Coach attendance response pushes are skipped for match and training changes', async () => {
  process.env.VITE_SUPABASE_URL ||= 'https://example.supabase.co'
  process.env.SUPABASE_SERVICE_ROLE_KEY ||= 'test-service-role-key'
  const { sendCoachAvailabilityResponsePush } = await import('../netlify/functions/send-coach-mobile-push.js')
  const unavailableClient = new Proxy({}, { get: () => { throw new Error('Notification delivery must not access the client') } })

  for (const type of ['match_availability_response', 'training_availability_response']) {
    const result = await sendCoachAvailabilityResponsePush({
      adminClient: unavailableClient,
      clubId: 'club-1',
      status: 'available',
      targetId: 'event-1',
      teamId: 'team-1',
      type,
    })
    assert.deepEqual(result, { failed: 0, sent: 0, skipped: true })
  }
})
