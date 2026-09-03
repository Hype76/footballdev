import assert from 'node:assert/strict'
import test from 'node:test'
import { buildCoachHomeOperationalSnapshot } from '../apps/mobile-core/src/coachPhase31GCore.js'
import { getCoachVolunteerAssignmentLabel, getCoachVolunteerPersonLabel } from '../apps/mobile-core/src/coachMatchDayCore.js'

test('Home counts the staff and parent room groups returned by the Coach data service', () => {
  const snapshot = buildCoachHomeOperationalSnapshot({ chatRooms: {
    staff: [{ id: 'staff-1', unreadCount: 2 }],
    parent: [{ id: 'team-1', unreadCount: 3 }, { id: 'parent-1', unreadCount: 1 }],
  } })
  assert.equal(snapshot.unreadChat, 6)
  assert.equal(snapshot.chatRooms.length, 3)
  const afterRead = buildCoachHomeOperationalSnapshot({ chatRooms: {
    staff: [{ id: 'staff-1', unreadCount: 2 }],
    parent: [{ id: 'team-1', unreadCount: 0 }, { id: 'parent-1', unreadCount: 1 }],
  } })
  assert.equal(afterRead.unreadChat, 3)
})

test('Unassigned roles never borrow a volunteer name from an empty Parent link', () => {
  const responses = [{ parentLinkId: '', recipientName: 'Ed' }]
  assert.equal(getCoachVolunteerAssignmentLabel(undefined, responses), 'Not assigned')
  assert.equal(getCoachVolunteerAssignmentLabel(null, responses), 'Not assigned')
  assert.equal(getCoachVolunteerAssignmentLabel({}, responses), 'Not assigned')
  assert.equal(getCoachVolunteerAssignmentLabel({ id: 'assignment', parentLinkId: '', assignedByName: 'Bill' }, responses), 'Assigned Parent or guardian')
})

test('Assignment labels match a real Parent link and ignore the assigning Coach name', () => {
  const responses = [{ parentLinkId: 'other', recipientName: 'Ed' }, { parentLinkId: 'selected', recipientName: 'Jamie Parent' }]
  assert.equal(getCoachVolunteerAssignmentLabel({ id: 'assignment', parentLinkId: 'selected', assignedByName: 'Bill' }, responses), 'Jamie Parent')
  assert.equal(getCoachVolunteerAssignmentLabel({ id: 'assignment', parentLinkId: 'missing', parentName: 'Sam Parent' }, responses), 'Sam Parent')
  assert.equal(getCoachVolunteerPersonLabel({ recipientName: '', recipientEmail: 'jamie@example.com' }), 'jamie@example.com')
})
