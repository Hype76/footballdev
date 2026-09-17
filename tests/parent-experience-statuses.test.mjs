import assert from 'node:assert/strict'
import test from 'node:test'
import { getParentAgendaResponseBadge, getParentMatchStatusBadges } from '../apps/parent-mobile/src/parentExperience.js'

const link = { id: 'parent-link', linkType: 'parent', playerId: 'player-1' }
const match = { id: 'match-1', status: 'scheduled', availabilityStatus: 'available', squadDecisionState: 'selected' }

test('Parent Home match status badges keep availability and squad separate', () => {
  assert.deepEqual(getParentMatchStatusBadges(match, [], link).map(({ key, label, tone }) => ({ key, label, tone })), [
    { key: 'availability', label: 'Available', tone: 'success' },
    { key: 'squad', label: 'Selected', tone: 'accent' },
  ])
  assert.equal(getParentMatchStatusBadges({ ...match, availabilityStatus: 'unavailable', squadDecisionState: 'not_selected' }, [], link)[0].label, 'Not available')
  assert.equal(getParentMatchStatusBadges({ ...match, availabilityStatus: '' }, [{ invitationType: 'match_attendance', eventId: 'match-1', parentLinkId: 'parent-link', childId: 'player-1', responseState: 'accepted' }], link)[0].label, 'Available')
})

test('Parent agenda response badge reflects authoritative invitation states', () => {
  const event = { id: 'event-1', eventId: 'event-1', requiresResponse: true }
  assert.deepEqual(getParentAgendaResponseBadge(event, [{ invitationType: 'training_attendance', eventId: 'event-1', isPending: true }]), { icon: 'help-outline', key: 'response', label: 'Needs response', tone: 'warning' })
  assert.equal(getParentAgendaResponseBadge({ ...event, responseState: 'accepted' }, []).label, 'Attending')
  assert.equal(getParentAgendaResponseBadge({ ...event, responseState: 'declined' }, []).label, 'Not attending')
  assert.equal(getParentAgendaResponseBadge({ ...event, status: 'cancelled' }, [{ invitationType: 'training_attendance', eventId: 'event-1', isPending: true }]), null)
  assert.equal(getParentAgendaResponseBadge({ id: 'event-2', responseState: 'not_required' }, []), null)
  assert.equal(getParentAgendaResponseBadge({ id: 'event-2' }, []), null)
})
