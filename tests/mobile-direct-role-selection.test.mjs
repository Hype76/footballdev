import test from 'node:test'
import assert from 'node:assert/strict'
import { getCoachOtherEligibleParents, isCoachMatchDayVolunteerSelectionApplied } from '../apps/mobile-core/src/coachMatchDayCore.js'

test('other parent choices exclude existing volunteers and the current assignment', () => {
  const parents = [{ parentLinkId: 'a' }, { parentLinkId: 'b' }, { parentLinkId: 'c' }, { parentLinkId: '' }]
  assert.deepEqual(getCoachOtherEligibleParents(parents, [{ parentLinkId: 'a' }], { parentLinkId: 'b' }), [{ parentLinkId: 'c' }])
})

test('direct assignment reconciliation uses the selected parent link and role', () => {
  const match = { roleAssignments: [{ role: 'scorer', parentLinkId: 'c' }] }
  assert.equal(isCoachMatchDayVolunteerSelectionApplied(match, { parentLinkId: 'c' }, 'scorer'), true)
  assert.equal(isCoachMatchDayVolunteerSelectionApplied(match, { parentLinkId: 'c' }, 'referee'), false)
})
