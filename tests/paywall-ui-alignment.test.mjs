import assert from 'node:assert/strict'
import test from 'node:test'
import { CAPABILITIES } from '../src/lib/paywall-access.js'
import {
  canUseRouteFeature,
  canUseUiFeature,
  createUiFeatureUnavailableMessage,
  getRouteCapability,
} from '../src/lib/paywall-ui.js'

const baseUser = {
  id: 'user-1',
  clubId: 'club-1',
  activeTeamId: 'team-1',
  role: 'manager',
  roleRank: 50,
  planStatus: 'active',
}

test('route capability mapping keeps Free users on basic records only', () => {
  const freeUser = {
    ...baseUser,
    planKey: 'individual',
    planStatus: '',
  }

  assert.equal(getRouteCapability('/players'), CAPABILITIES.basicDevelopmentRecords)
  assert.equal(canUseRouteFeature(freeUser, '/players'), true)
  assert.equal(canUseRouteFeature(freeUser, '/assess-player'), false)
  assert.equal(canUseRouteFeature(freeUser, '/sessions/start'), false)
  assert.equal(canUseRouteFeature(freeUser, '/calendar'), false)
  assert.equal(canUseRouteFeature(freeUser, '/parent-linking'), false)
})

test('Single Team users can use team workflow and parent communication routes', () => {
  const singleTeamUser = {
    ...baseUser,
    planKey: 'single_team',
  }

  assert.equal(canUseRouteFeature(singleTeamUser, '/assess-player'), true)
  assert.equal(canUseRouteFeature(singleTeamUser, '/sessions/start'), true)
  assert.equal(canUseRouteFeature(singleTeamUser, '/parent-linking'), true)
  assert.equal(canUseRouteFeature(singleTeamUser, '/email-queue'), true)
  assert.equal(canUseRouteFeature(singleTeamUser, '/activity-log'), false)
})

test('upgrade copy is plan-aware for admins and contact-only for non-billing roles', () => {
  const freeAdmin = {
    ...baseUser,
    role: 'admin',
    roleRank: 90,
    planKey: 'individual',
    planStatus: '',
  }
  const coachUser = {
    ...baseUser,
    role: 'coach',
    roleRank: 20,
    planKey: 'individual',
    planStatus: '',
  }

  assert.match(
    createUiFeatureUnavailableMessage(freeAdmin, CAPABILITIES.parentEmails),
    /Upgrade to Single Team/,
  )
  assert.match(
    createUiFeatureUnavailableMessage(coachUser, CAPABILITIES.parentEmails),
    /Ask a Club Admin/,
  )
})

test('hidden native app capability stays unavailable through UI helper', () => {
  const largeClubUser = {
    ...baseUser,
    role: 'admin',
    roleRank: 90,
    planKey: 'large_club',
  }

  assert.equal(canUseUiFeature(largeClubUser, CAPABILITIES.nativeAppEntitlement), false)
  assert.match(
    createUiFeatureUnavailableMessage(largeClubUser, CAPABILITIES.nativeAppEntitlement),
    /not currently available/,
  )
})
