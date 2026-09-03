import assert from 'node:assert/strict'
import test from 'node:test'
import { assertCoachConfirmedVolunteerSelection } from '../netlify/functions/lib/_coach-confirmed-volunteer.js'

test('coach confirmation accepts only an unanswered request with an explicit verified-link candidate', () => {
  assert.doesNotThrow(() => assertCoachConfirmedVolunteerSelection({ confirmedByCoach: true, parentLinkId: 'link-1', response: 'no_response' }))
  assert.doesNotThrow(() => assertCoachConfirmedVolunteerSelection({ confirmedByCoach: false, parentLinkId: '', response: 'yes' }))
  assert.throws(() => assertCoachConfirmedVolunteerSelection({ confirmedByCoach: true, parentLinkId: '', response: 'no_response' }), /linked parent/)
  for (const response of ['yes', 'no']) {
    assert.throws(() => assertCoachConfirmedVolunteerSelection({ confirmedByCoach: true, parentLinkId: 'link-1', response }), /already been recorded/)
  }
})
