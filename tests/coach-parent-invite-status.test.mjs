import assert from 'node:assert/strict'
import test from 'node:test'

import { getCoachParentInviteStatus } from '../apps/mobile-core/src/coachParentInviteStatus.js'

const contact = { email: ' Parent@Example.test ' }
const now = Date.parse('2026-09-21T12:00:00Z')

test('parent invite status only claims a sent invite when the link records send proof', () => {
  assert.deepEqual(getCoachParentInviteStatus({ contact }), {
    label: 'Not invited',
    state: 'not-invited',
  })
  assert.equal(getCoachParentInviteStatus({
    contact,
    inviteResults: { 'parent@example.test': { status: 'sent' } },
    link: { status: 'pending' },
  }).label, 'Not invited')
  assert.equal(getCoachParentInviteStatus({
    contact,
    link: { invite_sent_at: '2026-09-21T11:00:00Z', status: 'pending' },
  }).label, 'Invite sent awaiting acceptance')
  assert.equal(getCoachParentInviteStatus({
    contact,
    link: { inviteSentAt: '2026-09-21T11:00:00Z', status: 'pending' },
  }).label, 'Invite sent awaiting acceptance')
})

test('parent invite status supports accepted and expired snake or camel case links', () => {
  assert.equal(getCoachParentInviteStatus({
    contact,
    link: { expires_at: '2026-09-21T11:59:59Z', status: 'pending' },
    now,
  }).label, 'Expired')
  assert.equal(getCoachParentInviteStatus({
    contact,
    link: { expiresAt: '2026-09-21T11:59:59Z', status: 'active' },
    now,
  }).label, 'Accepted')
  assert.equal(getCoachParentInviteStatus({
    contact,
    link: { expiresAt: '2026-09-21T11:59:59Z', status: 'uninvited' },
    now,
  }).label, 'Not invited')
})

test('parent invite status exposes in-progress and failed attempts without a delivery claim', () => {
  assert.equal(getCoachParentInviteStatus({ contact, inviteResults: { 'parent@example.test': { status: 'sent', confirmedByServer: true } } }).label, 'Invite sent awaiting acceptance')
  assert.equal(getCoachParentInviteStatus({ contact, inviteResults: { 'parent@example.test': { status: 'accepted', confirmedByServer: true } } }).label, 'Accepted')
  assert.deepEqual(getCoachParentInviteStatus({ contact, isSending: true }), {
    label: 'Sending',
    state: 'sending',
  })
  assert.deepEqual(getCoachParentInviteStatus({
    contact,
    inviteResults: {
      'parent@example.test': { message: 'Email provider unavailable.', status: 'failed' },
    },
    link: { status: 'uninvited' },
  }), {
    label: 'Invite failed: Email provider unavailable.',
    state: 'failed',
  })
})
