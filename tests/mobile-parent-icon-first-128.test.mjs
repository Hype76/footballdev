import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'
import {
  getParentInvitationEventKey,
  groupParentInvitationsByEvent,
} from '../apps/parent-mobile/src/parentPresentationCore.js'

test('Parent invitations group attendance and volunteer roles into one event', () => {
  const attendance = {
    childId: 'child-1',
    eventId: 'match-1',
    eventStart: '2026-09-05T11:45:00',
    eventTitle: 'Match Day vs St Neots',
    invitationType: 'match_attendance',
  }
  const scorer = {
    ...attendance,
    invitationType: 'match_role',
    roleType: 'scorer',
    sourceRecordId: 'scorer-request-1',
  }
  const linesman = {
    ...attendance,
    invitationType: 'match_role',
    roleType: 'linesman',
    sourceRecordId: 'linesman-request-1',
  }

  assert.equal(getParentInvitationEventKey(attendance), 'event:match-1')
  assert.equal(groupParentInvitationsByEvent([attendance, scorer, linesman]).length, 1)
  assert.deepEqual(
    groupParentInvitationsByEvent([attendance, linesman, scorer])[0].invitations.map((item) => `${item.invitationType}:${item.roleType || ''}`),
    ['match_attendance:', 'match_role:scorer', 'match_role:linesman'],
  )
})

test('Parent invitation grouping has a stable fallback when an event id is unavailable', () => {
  const base = {
    childId: 'child-1',
    eventStart: '2026-09-05T11:45:00',
    eventTitle: 'Match Day vs St Neots',
    teamName: 'U14',
  }
  assert.equal(
    getParentInvitationEventKey({ ...base, invitationType: 'match_attendance' }),
    getParentInvitationEventKey({ ...base, invitationType: 'match_role', roleType: 'scorer' }),
  )
})

test('Parent overview screens use the flat icon-first system', async () => {
  const [appSource, iconSource, portalSource] = await Promise.all([
    readFile(new URL('../apps/parent-mobile/App.js', import.meta.url), 'utf8'),
    readFile(new URL('../apps/parent-mobile/src/ParentIcon.js', import.meta.url), 'utf8'),
    readFile(new URL('../apps/parent-mobile/src/ParentPortalScreens.js', import.meta.url), 'utf8'),
  ])

  assert.match(iconSource, /FontAwesome5/)
  assert.match(iconSource, /name="futbol"/)
  assert.match(appSource, /card: \{ backgroundColor: 'transparent'/)
  assert.match(appSource, /styles\.compactRow/)
  assert.match(appSource, /iconKey="football"/)
  assert.match(portalSource, /Match & volunteer invite/)
  assert.match(portalSource, /editingInvitationId/)
  assert.match(portalSource, /styles\.iconChoiceRow/)
  assert.match(portalSource, /styles\.moreGrid/)
  assert.match(portalSource, /volunteerHelpOpen/)
  assert.match(portalSource, /This is a Parent or guardian volunteer role/)
})
