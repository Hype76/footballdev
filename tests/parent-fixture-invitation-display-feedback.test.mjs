import assert from 'node:assert/strict'
import { test } from 'node:test'
import { getParentScorerInterestInvitation, getParentMatchCalendarUrl, getParentMatchStatusLabel } from '../apps/parent-mobile/src/parentExperience.js'
import { getParentInvitationLockReason } from '../apps/parent-mobile/src/parentPresentationCore.js'
import { getMatchDayDisplayName, getMatchDayDisplayScore } from '../src/lib/matchday-display.js'

const now = new Date('2026-09-02T12:00:00Z')
const match = { id: 'match-1', matchDate: '2026-09-27', requestScorer: true, status: 'scorer_request', teamName: 'U17 Green', opponent: 'Westham', homeAway: 'away', homeScore: 1, awayScore: 3 }
const invitation = { invitationId: 'role-1', eventId: 'match-1', invitationType: 'match_role', roleType: 'scorer', sourceRecordId: 'sent-request-1', invitationState: 'offered', canRespond: true, responseState: 'awaiting_response' }

test('unsent and unrelated invitations never expose the scorer interest action', () => {
  for (const invitations of [[], [{ ...invitation, sourceRecordId: '' }], [{ ...invitation, invitationState: 'shared' }], [{ ...invitation, eventId: 'another-match' }], [{ ...invitation, roleType: 'linesman' }], [{ ...invitation, invitationType: 'match_attendance' }]]) {
    assert.equal(getParentScorerInterestInvitation(match, invitations, now), null)
  }
})

test('an active sent scorer invitation supplies the exact request for the response', () => {
  assert.equal(getParentScorerInterestInvitation(match, [invitation], now), invitation)
  const legacyRole = { ...invitation, roleType: 'volunteer_scorer', canRespond: false, canChangeResponse: true }
  assert.equal(getParentScorerInterestInvitation(match, [legacyRole], now), legacyRole)
})

test('closed, expired, answered or unauthorised requests hide scorer registration', () => {
  for (const changes of [{ invitationState: 'closed' }, { invitationState: 'expired' }, { canRespond: false }, { responseDeadline: '2026-09-01T12:00:00Z' }, { responseState: 'yes' }]) {
    assert.equal(getParentScorerInterestInvitation(match, [{ ...invitation, ...changes }], now), null)
  }
  for (const changes of [{ isScorer: true }, { hasInterest: true }, { status: 'full_time' }, { requestScorer: false }, { matchDate: '2026-09-01' }]) {
    assert.equal(getParentScorerInterestInvitation({ ...match, ...changes }, [invitation], now), null)
  }
})

test('shared match copy explains unsent invites without replacing other restrictions', () => {
  const shared = { invitationType: 'match_attendance', invitationState: 'shared', sourceRecordId: '', lockReason: 'No attendance response was requested for this fixture.' }
  assert.equal(getParentInvitationLockReason(shared), 'Invites have not yet been sent for this event.')
  assert.equal(getParentInvitationLockReason({ ...shared, invitationState: 'closed', lockReason: 'This fixture has concluded.' }), 'This fixture has concluded.')
  assert.equal(getParentInvitationLockReason({ ...shared, sourceRecordId: 'sent-request', lockReason: 'This response belongs to another parent contact for the child.' }), 'This response belongs to another parent contact for the child.')
})

test('home and away names follow the fixture setting and keep scores aligned', () => {
  assert.equal(getMatchDayDisplayName(match), 'Westham v U17 Green')
  assert.equal(getMatchDayDisplayScore(match), '1 - 3')
  assert.equal(getMatchDayDisplayName({ ...match, homeAway: 'home' }), 'U17 Green v Westham')
  assert.equal(getMatchDayDisplayName({ ...match, homeAway: 'neutral' }), 'U17 Green v Westham')
  assert.equal(new URL(getParentMatchCalendarUrl(match)).searchParams.get('text'), 'Westham v U17 Green')
})

test('scorer requests use normal fixture status text without changing the saved status', () => {
  assert.equal(getParentMatchStatusLabel(match), 'Scheduled')
  assert.equal(match.status, 'scorer_request')
  assert.equal(getParentMatchStatusLabel({ status: 'live' }), 'Live')
  assert.equal(getParentMatchStatusLabel({ status: 'full_time' }), 'Full time')
  assert.equal(getParentMatchStatusLabel({ status: 'cancelled' }), 'Cancelled')
})
