import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'
import {
  canCreateEvaluation,
  canManageMatchDay,
  canManageParentLinks,
  canManageTeamSettings,
  canManageUsers,
  canUseDataTransfer,
  canUseStaffChat,
  canViewBilling,
  canViewPlatformFeedback,
  getRoleLabel,
  isAdultPlayerUser,
  isParentPortalUser,
  isSuperAdmin,
} from '../src/lib/auth-permissions.js'
import { normalizeAdultPlayerInvitation } from '../src/lib/domain/adult-player.js'
import { normalizeLoginAccessIntent } from '../src/lib/login-access-intent.js'

const routerUrl = new URL('../src/app/router.jsx', import.meta.url)
const layoutUrl = new URL('../src/components/layout/Layout.jsx', import.meta.url)
const coreUrl = new URL('../src/lib/domain/core.js', import.meta.url)
const domainUrl = new URL('../src/lib/domain/adult-player.js', import.meta.url)
const pageUrl = new URL('../src/pages/AdultPlayerPage.jsx', import.meta.url)

test('adult player is a distinct non-parent, non-staff access mode', () => {
  const player = {
    id: 'adult-user',
    role: 'adult_player',
    roleLabel: 'Player',
    roleRank: 0,
    clubId: 'club',
    activeTeamId: 'team',
    planKey: 'individual',
    planStatus: 'active',
  }

  assert.equal(isAdultPlayerUser(player), true)
  assert.equal(isParentPortalUser(player), false)
  assert.equal(isSuperAdmin(player), false)
  assert.equal(getRoleLabel(player), 'Player')
  assert.equal(normalizeLoginAccessIntent('player'), 'player')

  assert.equal(canCreateEvaluation(player), false)
  assert.equal(canManageMatchDay(player), false)
  assert.equal(canManageParentLinks(player), false)
  assert.equal(canManageTeamSettings(player), false)
  assert.equal(canManageUsers(player), false)
  assert.equal(canUseDataTransfer(player), false)
  assert.equal(canUseStaffChat(player), false)
  assert.equal(canViewBilling(player), false)
  assert.equal(canViewPlatformFeedback(player), false)
})

test('adult invitation normalization exposes no parent or staff authority field', () => {
  const invitation = normalizeAdultPlayerInvitation({
    invitation_id: 'match:request',
    invitation_type: 'match_attendance',
    source_record_id: 'request',
    event_id: 'fixture',
    event_type: 'match_day',
    event_title: 'Match Day',
    can_respond: true,
    response_state: 'available',
  })

  assert.equal(invitation.sourceRecordId, 'request')
  assert.equal(invitation.canRespond, true)
  assert.equal(invitation.responseState, 'available')
  assert.equal('playerId' in invitation, false)
  assert.equal('parentLinkId' in invitation, false)
  assert.equal('role' in invitation, false)
})

test('routing sends adult accounts to a dedicated player shell and blocks other workspace routes', async () => {
  const [router, layout, page] = await Promise.all([
    readFile(routerUrl, 'utf8'),
    readFile(layoutUrl, 'utf8'),
    readFile(pageUrl, 'utf8'),
  ])

  assert.match(router, /if \(isAdultPlayerUser\(user\)\) \{\s*return '\/player'/)
  assert.match(router, /function RequireAdultPlayerAccess\(\)/)
  assert.match(router, /path: 'player'/)
  assert.match(router, /<AdultPlayerPage \/>/)
  assert.match(layout, /isAdultPlayerUser\(user\) && !isAdultPlayerRoute/)
  assert.match(layout, /<Navigate to="\/player" replace \/>/)
  assert.match(page, /This account cannot open parent, staff, or administration tools\./)
  assert.doesNotMatch(page, /child switch/i)
  assert.doesNotMatch(page, /team management/i)
})

test('profile resolution and response clients do not represent adult players as parents', async () => {
  const [core, domain] = await Promise.all([
    readFile(coreUrl, 'utf8'),
    readFile(domainUrl, 'utf8'),
  ])

  assert.match(core, /role: 'adult_player'/)
  assert.match(core, /roleLabel: 'Player'/)
  assert.match(core, /accessMode: 'player'/)
  assert.match(core, /adultPlayerLinkId: accountState\.linkId/)
  assert.match(core, /throw new Error\('Adult-player account access could not be verified\.'\)/)
  assert.doesNotMatch(
    core.slice(core.indexOf('function normalizeAdultPlayerProfile'), core.indexOf('function normalizeParentPortalProfile')),
    /parentPortalLinks|selectedParentLinkId|role: 'parent_portal'/,
  )

  assert.match(domain, /respond_own_adult_player_match_invitation/)
  assert.match(domain, /respond_own_adult_player_training_invitation/)
  assert.doesNotMatch(domain, /\bplayer_id_value\b|playerId:/)
  assert.doesNotMatch(domain, /parent_link_id_value|parentLinkId:/)
  assert.doesNotMatch(domain, /role_type_value|role:/)
})
