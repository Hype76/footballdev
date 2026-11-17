import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { test } from 'node:test'

import {
  canAutoSendParentInvite,
  canSendPendingParentInviteRetry,
  getParentPortalInviteActionForContact,
  isParentPortalInviteEligiblePlayer,
} from '../src/lib/parent-portal-invite-actions.js'

const parentPortalDomainUrl = new URL('../src/lib/domain/parent-portal.js', import.meta.url)
const playerDetailsSectionUrl = new URL('../src/components/players/PlayerDetailsSection.jsx', import.meta.url)
const playerProfileUrl = new URL('../src/pages/PlayerProfile.jsx', import.meta.url)
const sendParentPortalInviteFunctionUrl = new URL('../netlify/functions/send-parent-portal-invite.js', import.meta.url)

test('parent portal invite action appears for active Trial and Squad players with parent email', () => {
  assert.equal(isParentPortalInviteEligiblePlayer({ section: 'Squad' }), true)
  assert.equal(isParentPortalInviteEligiblePlayer({ section: 'Trial' }), true)
  assert.equal(isParentPortalInviteEligiblePlayer({ section: 'Trial', status: 'archived' }), false)

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
  assert.equal(trialAction.canSend, true)
  assert.equal(trialAction.label, 'Send parent portal invite')
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

test('only an expired or unsent pending Parent link can be retried', () => {
  const email = 'parent@example.com'
  const contact = { email }
  const player = { section: 'Squad' }
  const now = Date.parse('2026-11-17T12:00:00Z')
  const pending = { id: 'pending', email, status: 'pending', expiresAt: '2026-11-17T12:00:00Z', inviteSentAt: '2026-11-16T12:00:00Z' }
  const action = (links) => getParentPortalInviteActionForContact({ contact, links, player, now })
  assert.equal(action([pending]).statusLabel, 'Invite expired')
  assert.equal(action([pending]).retryLinkId, pending.id)
  assert.equal(action([{ ...pending, expiresAt: '2026-11-17T13:00:00Z' }]).retryLinkId, '')
  assert.equal(action([{ ...pending, expiresAt: '2026-11-17T13:00:00Z', inviteSentAt: '' }]).statusLabel, 'Invite not sent')
  assert.equal(action([{ ...pending, linkType: 'fan' }]).retryLinkId, '')
  assert.equal(action([pending, { ...pending, id: 'active', status: 'active' }]).statusLabel, 'Parent portal linked')
})

test('player details show a targeted retry for an eligible, pending link', async () => {
  const source = await readFile(playerDetailsSectionUrl, 'utf8')
  assert.match(source, /getParentPortalInviteActionForContact/)
  assert.match(source, /inviteAction\.retryLinkId && onRetryParentInvite/)
  assert.match(source, /inviteAction\.statusLabel/)
})

test('save sends outstanding parent invites and preserves the active-player guard', async () => {
  const [domainSource, profileSource, functionSource] = await Promise.all([
    readFile(parentPortalDomainUrl, 'utf8'),
    readFile(playerProfileUrl, 'utf8'),
    readFile(sendParentPortalInviteFunctionUrl, 'utf8'),
  ])

  assert.match(domainSource, /includeSentPending = false/)
  assert.match(domainSource, /row\.status === 'pending' && \(includeSentPending \|\| !row\.invite_sent_at\)/)
  assert.match(domainSource, /Family portal links require an active player\./)
  assert.match(profileSource, /sendParentPortalInvitesForPlayer\(savedPlayer, \{ automatic: true \}\)/)
  assert.doesNotMatch(profileSource, /includeSentPending: true/)
  assert.match(functionSource, /Family portal invites require an active player\./)
  assert.match(functionSource, /retryEnabled: !retryPending/)
  assert.match(functionSource, /const currentLink = await getInviteLink\(inviteLink.id\)[\s\S]+?currentLink.invite_token !== inviteLink.invite_token[\s\S]+?link: currentLink[\s\S]+?await sendEmail\(/)
})

test('retry renews only the chosen expired pending link and reuses an unsent renewal', async () => {
  const source = await readFile(parentPortalDomainUrl, 'utf8')
  const start = source.indexOf('export async function createParentPortalInvites(')
  const body = source.slice(start + 7, source.indexOf('\nexport ', start + 7))
  const expired = { id: 'expired', email: 'parent@example.com', status: 'pending', invite_sent_at: '2000-01-01', expires_at: '2000-01-02', invite_token: 'old' }
  const records = [{ ...expired }]
  const mutations = []
  const supabase = {
    from() {
      const query = { filters: {}, columns: '', patch: null,
        select(columns) { this.columns = columns; return this },
        eq(key, value) { this.filters[key] = value; return this },
        in() { return this },
        order() { return this },
        update(patch) { this.patch = patch; return this },
        insert() { assert.fail('An explicit retry must never create a different link') },
        then(resolve) {
          const data = this.filters.status === 'active' ? [] : records.map(row => ({ ...row }))
          return Promise.resolve({ data, error: null }).then(resolve)
        },
        async maybeSingle() {
          const row = records.find(item => Object.entries(this.filters).every(([key, value]) => item[key] === value))
          if (!row) return { data: null }
          mutations.push({ filters: this.filters, patch: this.patch })
          Object.assign(row, this.patch)
          return { data: { ...row } }
        },
      }
      return query
    },
  }
  const normalizeEmail = value => String(value || '').trim().toLowerCase()
  const create = new Function('supabase', 'assertClubFeature', 'CAPABILITIES', 'canAutoSendParentInvite',
    'normalizeEmail', 'normalizeParentLink', 'buildInviteUrl', body + '\nreturn createParentPortalInvites')(
      supabase, async () => {}, { parentInvitations: 'parentInvitations' }, canAutoSendParentInvite,
      normalizeEmail, row => row, token => token,
    )
  const args = {
    user: { id: 'coach', clubId: 'club' }, player: { id: 'player', teamId: 'team', section: 'Squad' },
    contacts: [{ email: expired.email }], automatic: true, retryPendingLinkId: 'expired',
  }
  assert.deepEqual(await create({ ...args, retryPendingLinkId: 'different' }), [])
  assert.equal(mutations.length, 0)
  const [renewed] = await create(args)
  assert.equal(renewed.id, expired.id)
  assert.notEqual(renewed.invite_token, expired.invite_token)
  assert.equal(renewed.invite_sent_at, null)
  assert.ok(Date.parse(renewed.expires_at) > Date.now())
  assert.deepEqual(mutations[0].filters, { id: expired.id, status: 'pending', expires_at: expired.expires_at })
  assert.equal((await create(args))[0].invite_token, renewed.invite_token)
  assert.equal(mutations.length, 1)
  records[0].status = 'active'
  assert.deepEqual(await create(args), [])
})

test('explicit send accepts only the confirmed unexpired, unsent Parent link version', () => {
  const link = { link_type: 'parent', status: 'pending', email: 'parent@example.com', expires_at: '2026-11-17T13:00:00Z' }
  const request = { link, email: link.email.toUpperCase(), expiresAt: link.expires_at, now: Date.parse('2026-11-17T12:00:00Z') }
  assert.equal(canSendPendingParentInviteRetry(request), true)
  for (const change of [
    { email: 'other@example.com' },
    { expiresAt: '2026-11-17T15:00:00Z' },
    { expiresAt: '' },
    { now: Date.parse(link.expires_at) },
    { link: { ...link, status: 'revoked' } },
    { link: { ...link, link_type: 'fan' } },
    { link: { ...link, invite_sent_at: '2026-11-17T12:00:01Z' } },
  ]) assert.equal(canSendPendingParentInviteRetry({ ...request, ...change }), false)
})
