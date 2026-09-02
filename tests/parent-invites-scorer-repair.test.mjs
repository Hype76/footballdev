import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'
import { getParentInvitationCounts, getParentInvitationSections, groupParentInvitationsByEvent } from '../apps/parent-mobile/src/parentPresentationCore.js'
import { getParentFriendlyError } from '../apps/parent-mobile/src/parentExperience.js'
import { resolveParentNotificationOpen } from '../apps/mobile-core/src/parentNotificationsCore.js'
import { countUnreadNonChatNotifications, getParentOpenedNotificationIds, getParentNotificationPresentation, prepareParentNotificationInbox } from '../apps/mobile-core/src/parentNotificationInboxCore.js'

const now = new Date('2026-09-02T08:00:00Z')
const attendance = { invitationId: 'match_attendance:request-1', childId: 'child-1', eventId: 'match-1', eventStart: '2026-09-02', eventDate: '2026-09-02', kickoffTimeTbc: true, invitationType: 'match_attendance', invitationState: 'active', isPending: true, canRespond: true, responseState: 'awaiting_response' }

test('same-day TBC attendance and roles appear together in Needs response and count as one event', () => {
  const rows = [attendance, { ...attendance, invitationId: 'role:scorer', invitationType: 'match_role', roleType: 'scorer' }]
  const sections = getParentInvitationSections(rows, now)
  assert.equal(sections.needsResponse.length, 2)
  assert.equal(sections.history.length, 0)
  assert.equal(getParentInvitationCounts(rows, now).needsResponse, 1)
  assert.equal(groupParentInvitationsByEvent(sections.needsResponse).length, 1)
})

test('active replacement training request wins over expired copies without merging different occurrences', () => {
  const training = { ...attendance, invitationType: 'training_attendance', eventId: 'training-1' }
  const rows = [
    { ...training, invitationId: 'old', sourceRecordId: 'old', invitationState: 'expired', canRespond: false },
    { ...training, invitationId: 'current', sourceRecordId: 'new' },
    { ...training, invitationId: 'next', eventDate: '2026-09-09', eventStart: '2026-09-09' },
  ]
  const sections = getParentInvitationSections(rows, now)
  assert.deepEqual(sections.needsResponse.map((row) => row.invitationId), ['current', 'next'])
  assert.equal(sections.history.length, 0)
  assert.equal(getParentInvitationCounts(rows, now).needsResponse, 2)
  assert.equal(getParentInvitationSections([{ ...attendance, eventDate: '2026-09-01', eventStart: '2026-09-01' }], now).needsResponse.length, 0)
})

test('old and new event notifications resolve only to invitations available to the current parent', () => {
  const available = { invites: [attendance.invitationId], invitationRecords: [attendance] }
  for (const data of [
    { route: 'invites', invitationId: 'match:request-1' },
    { route: 'invites', invitationId: 'removed-request', matchDayId: 'match-1' },
    { route: 'matchday', type: 'scorer_request', matchDayId: 'match-1' },
  ]) assert.deepEqual(resolveParentNotificationOpen({ app: 'parent', ...data }, available), { tab: 'invites', targetId: attendance.invitationId })
  assert.equal(resolveParentNotificationOpen({ app: 'parent', route: 'invites', matchDayId: 'other-match' }, available).targetId, '')
})

test('one event card and badge cover all its request notifications, and opening it reads them together', () => {
  const data = { app: 'parent', route: 'invites', parentLinkId: 'link-1', matchDayId: 'match-1' }
  const rows = [
    { id: 'attendance', isRead: false, data },
    { id: 'role', isRead: false, data: { ...data, route: 'matchday', type: 'scorer_request' } },
    { id: 'other-child', isRead: false, data: { ...data, parentLinkId: 'link-2' } },
  ]
  assert.equal(prepareParentNotificationInbox(rows).length, 2)
  assert.equal(countUnreadNonChatNotifications(rows), 2)
  const opened = getParentOpenedNotificationIds(data, rows)
  assert.deepEqual(opened, ['attendance', 'role'])
  assert.equal(countUnreadNonChatNotifications(rows.map((row) => ({ ...row, isRead: opened.includes(row.id) }))), 1)
  const presentation = getParentNotificationPresentation(rows[0], [{ id: 'match-1', teamName: 'U17 Green', opponent: 'Newcastle', matchDate: '2026-09-02' }])
  assert.equal(presentation.displayTitle, 'U17 Green v Newcastle')
  assert.equal(presentation.actionLabel, 'Open event invitation')
})

test('permission and timeout failures do not falsely claim a connection failure', () => {
  assert.match(getParentFriendlyError(new Error('You cannot record goals for this match.')), /scorer access/)
  assert.match(getParentFriendlyError(new Error('Request timed out')), /check whether your change was saved/)
  assert.match(getParentFriendlyError(new Error('Start or resume the match before recording a goal')), /Start or resume/)
})

test('goals omit Coach, invitations omit hide controls, and creation sends no separate scorer request', async () => {
  const [portal, page, app] = await Promise.all([
    readFile(new URL('../apps/parent-mobile/src/ParentPortalScreens.js', import.meta.url), 'utf8'),
    readFile(new URL('../src/pages/MatchDayPage.jsx', import.meta.url), 'utf8'),
    readFile(new URL('../apps/parent-mobile/App.js', import.meta.url), 'utf8'),
  ])
  assert.doesNotMatch(portal.slice(portal.indexOf('function GoalForm'), portal.indexOf('function GoalCorrectionForm')), /label="Coach"|\['coach'/)
  assert.doesNotMatch(portal.slice(portal.indexOf('function InvitationResponseControl'), portal.indexOf('function scoreVisible')), /action\.hide|onDismiss/)
  assert.doesNotMatch(page, /type: 'scorer_request'/)
  assert.doesNotMatch(portal.slice(portal.indexOf('function MatchCard'), portal.indexOf('function GoalPlayerPicker')), /action\.hide|onDismiss/)
  assert.doesNotMatch(app, /resources\.matches\.items\.filter.*dismissedItems/)
  assert.match(app, /notificationType = 'live'/)
  assert.match(app, /if \(changeSaved\)\s*\{[\s\S]*?return true/)
})
