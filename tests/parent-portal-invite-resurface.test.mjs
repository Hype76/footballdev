import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { test } from 'node:test'

import {
  getParentPortalInviteActionForContact,
  isParentPortalInviteEligiblePlayer,
} from '../src/lib/parent-portal-invite-actions.js'

const parentPortalDomainUrl = new URL('../src/lib/domain/parent-portal.js', import.meta.url)
const playerDetailsSectionUrl = new URL('../src/components/players/PlayerDetailsSection.jsx', import.meta.url)
const playerProfileUrl = new URL('../src/pages/PlayerProfile.jsx', import.meta.url)
const sendParentPortalInviteFunctionUrl = new URL('../netlify/functions/send-parent-portal-invite.js', import.meta.url)

test('parent portal invite action only appears for squad players with parent email', () => {
  assert.equal(isParentPortalInviteEligiblePlayer({ section: 'Squad' }), true)
  assert.equal(isParentPortalInviteEligiblePlayer({ section: 'Trial' }), false)

  const squadAction = getParentPortalInviteActionForContact({
    contact: { email: 'parent@example.com' },
    player: { section: 'Squad' },
  })
  const trialAction = getParentPortalInviteActionForContact({
    contact: { email: 'parent@example.com' },
    player: { section: 'Trial' },
  })

  assert.equal(squadAction.canSend, true)
  assert.equal(squadAction.label, 'Send parent portal invite')
  assert.equal(trialAction.canSend, false)
  assert.equal(trialAction.label, '')
})

test('parent portal invite action supports pending resend but hides active links', () => {
  const pendingAction = getParentPortalInviteActionForContact({
    contact: { email: 'Parent@Example.com' },
    links: [{ email: 'parent@example.com', status: 'pending', inviteSentAt: '2026-06-17T08:00:00Z' }],
    player: { section: 'Squad' },
  })
  const activeAction = getParentPortalInviteActionForContact({
    contact: { email: 'parent@example.com' },
    links: [{ email: 'parent@example.com', status: 'active', inviteSentAt: '2026-06-17T08:00:00Z' }],
    player: { section: 'Squad' },
  })

  assert.equal(pendingAction.canSend, true)
  assert.equal(pendingAction.label, 'Resend parent portal invite')
  assert.equal(pendingAction.statusLabel, 'Invite sent')
  assert.equal(activeAction.canSend, false)
  assert.equal(activeAction.label, '')
  assert.equal(activeAction.statusLabel, 'Parent portal linked')
})

test('saved parent emails render the inline parent portal invite action', async () => {
  const source = await readFile(playerDetailsSectionUrl, 'utf8')

  assert.match(source, /getParentPortalInviteActionForContact/)
  assert.match(source, /onSendParentPortalInviteForContact\(contact\)/)
  assert.match(source, /parentPortalInviteSendingKey === sendingKey \? 'Sending\.\.\.' : inviteAction\.label/)
})

test('explicit resend path reuses pending parent links and keeps squad guard', async () => {
  const [domainSource, profileSource, functionSource] = await Promise.all([
    readFile(parentPortalDomainUrl, 'utf8'),
    readFile(playerProfileUrl, 'utf8'),
    readFile(sendParentPortalInviteFunctionUrl, 'utf8'),
  ])

  assert.match(domainSource, /includeSentPending = false/)
  assert.match(domainSource, /row\.status === 'pending' && \(includeSentPending \|\| !row\.invite_sent_at\)/)
  assert.match(domainSource, /Family portal links can only be sent for squad players\./)
  assert.match(profileSource, /includeSentPending: true/)
  assert.match(profileSource, /Parent portal invites can only be sent for Squad players\./)
  assert.match(functionSource, /Family portal invites can only be sent for squad players\./)
})
