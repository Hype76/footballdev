import assert from 'node:assert/strict'
import test from 'node:test'

import {
  canEditClubIdentity,
  getPlan,
  getPlanKey,
  getPlanLimit,
  getPlanName,
  hasPlanFeature,
  isPlanAccessActive,
  normalizePlanKey,
  PLAN_KEYS,
  PLAN_OPTIONS,
} from '../src/lib/plans.js'
import { normalizePlanKey as normalizeStripePlanKey } from '../netlify/functions/_stripe-billing.js'
import { shouldPromoteBillPayer } from '../netlify/functions/_billing-role-promotion.js'

const canonicalPlans = [
  [PLAN_KEYS.individual, 'Individual Coach - Free', 'GBP 0'],
  [PLAN_KEYS.singleTeam, 'Single Team', 'GBP 12.99/month'],
  [PLAN_KEYS.smallClub, 'Small Club', 'GBP 34.99/month'],
  [PLAN_KEYS.developmentClub, 'Development Club', 'GBP 59.99/month'],
  [PLAN_KEYS.largeClub, 'Large Club', 'GBP 99.99+/month'],
]

test('canonical plan registry exposes all approved plan definitions', () => {
  assert.deepEqual(PLAN_OPTIONS.map((plan) => plan.key), canonicalPlans.map(([key]) => key))

  for (const [key, displayName, headlineMonthlyPrice] of canonicalPlans) {
    const plan = getPlan(key)

    assert.equal(plan.key, key)
    assert.equal(plan.name, displayName)
    assert.equal(plan.displayName, displayName)
    assert.equal(plan.headlineMonthlyPrice, headlineMonthlyPrice)
    assert.equal(plan.state, 'active')
    assert.equal(plan.isDeprecated, false)
  }
})

test('plan aliases normalize through the explicit compatibility map', () => {
  const cases = [
    ['individual', PLAN_KEYS.individual],
    ['Individual', PLAN_KEYS.individual],
    [' Individual Coach - Free ', PLAN_KEYS.individual],
    ['free', PLAN_KEYS.individual],
    ['single_team', PLAN_KEYS.singleTeam],
    ['Single Team', PLAN_KEYS.singleTeam],
    ['single-team', PLAN_KEYS.singleTeam],
    ['club', PLAN_KEYS.smallClub],
    ['small_club', PLAN_KEYS.smallClub],
    ['Small Club', PLAN_KEYS.smallClub],
    ['development_club', PLAN_KEYS.developmentClub],
    ['Development Club', PLAN_KEYS.developmentClub],
    ['dev club', PLAN_KEYS.developmentClub],
    ['large_club', PLAN_KEYS.largeClub],
    ['Large Club', PLAN_KEYS.largeClub],
    ['contact sales', PLAN_KEYS.largeClub],
  ]

  for (const [input, expected] of cases) {
    assert.equal(normalizePlanKey(input), expected)
    assert.equal(normalizeStripePlanKey(input), expected)
  }
})

test('missing plan values map explicitly to Free while malformed plans fail closed', () => {
  assert.equal(getPlanKey(null), PLAN_KEYS.individual)
  assert.equal(getPlanKey({}), PLAN_KEYS.individual)
  assert.equal(getPlanKey({ planKey: '' }), PLAN_KEYS.individual)

  assert.equal(normalizePlanKey(null), '')
  assert.equal(normalizePlanKey('future_enterprise_plus'), '')
  assert.equal(getPlanKey({ planKey: 'future_enterprise_plus' }), '')

  const malformedActiveUser = {
    planKey: 'future_enterprise_plus',
    planStatus: 'active',
  }

  assert.equal(isPlanAccessActive(malformedActiveUser), false)
  assert.equal(hasPlanFeature(malformedActiveUser, 'parentEmail'), false)
  assert.equal(hasPlanFeature(malformedActiveUser, 'auditLogs'), false)
  assert.equal(getPlanLimit(malformedActiveUser, 'teams'), 0)
  assert.equal(getPlanName(malformedActiveUser), 'Unknown plan')
})

test('no subscription uses Free limits instead of accidental Small Club access', () => {
  const freeUser = {
    planStatus: 'active',
  }

  assert.equal(getPlanKey(freeUser), PLAN_KEYS.individual)
  assert.equal(getPlanName(freeUser), 'Individual Coach - Free')
  assert.equal(hasPlanFeature(freeUser, 'parentEmail'), false)
  assert.equal(hasPlanFeature(freeUser, 'auditLogs'), false)
  assert.equal(getPlanLimit(freeUser, 'teams'), 1)
  assert.equal(getPlanLimit(freeUser, 'staffLogins'), 1)
  assert.equal(getPlanLimit(freeUser, 'players'), 5)
})

test('active paid plans retain current feature visibility without broad fallback', () => {
  const singleTeamUser = {
    planKey: PLAN_KEYS.singleTeam,
    planStatus: 'active',
  }
  const smallClubUser = {
    planKey: PLAN_KEYS.smallClub,
    planStatus: 'active',
  }
  const developmentClubUser = {
    planKey: PLAN_KEYS.developmentClub,
    planStatus: 'active',
  }
  const largeClubUser = {
    planKey: PLAN_KEYS.largeClub,
    planStatus: 'active',
  }

  assert.equal(hasPlanFeature(singleTeamUser, 'parentEmail'), true)
  assert.equal(hasPlanFeature(singleTeamUser, 'auditLogs'), false)
  assert.equal(getPlanLimit(singleTeamUser, 'staffLogins'), 5)
  assert.equal(getPlanLimit(singleTeamUser, 'players'), 30)

  assert.equal(hasPlanFeature(smallClubUser, 'auditLogs'), true)
  assert.equal(getPlanLimit(smallClubUser, 'teams'), 5)
  assert.equal(getPlanLimit(smallClubUser, 'staffLogins'), null)
  assert.equal(getPlanLimit(smallClubUser, 'players'), null)

  assert.equal(hasPlanFeature(developmentClubUser, 'auditLogs'), true)
  assert.equal(getPlanLimit(developmentClubUser, 'teams'), 10)
  assert.equal(getPlanLimit(developmentClubUser, 'staffLogins'), null)
  assert.equal(getPlanLimit(developmentClubUser, 'players'), null)

  assert.equal(hasPlanFeature(largeClubUser, 'auditLogs'), true)
  assert.equal(getPlanLimit(largeClubUser, 'teams'), 10)
  assert.equal(getPlanLimit({ ...largeClubUser, negotiatedLimits: { teams: 24 } }, 'teams'), 24)
})

test('inactive paid subscriptions do not unlock paid features', () => {
  const user = {
    planKey: PLAN_KEYS.smallClub,
    planStatus: 'past_due',
  }

  assert.equal(isPlanAccessActive(user), false)
  assert.equal(hasPlanFeature(user, 'auditLogs'), false)
  assert.equal(getPlanLimit(user, 'teams'), 0)
})

test('platform admin authority comes from role instead of plan fallback', () => {
  const platformAdmin = {
    role: 'super_admin',
    planKey: 'future_enterprise_plus',
    planStatus: 'past_due',
  }
  const nonAdmin = {
    role: 'admin',
    planKey: 'future_enterprise_plus',
    planStatus: 'active',
    clubId: 'club-1',
  }

  assert.equal(hasPlanFeature(platformAdmin, 'auditLogs'), true)
  assert.equal(getPlanLimit(platformAdmin, 'teams'), null)
  assert.equal(hasPlanFeature(nonAdmin, 'auditLogs'), false)
  assert.equal(canEditClubIdentity(nonAdmin), true)
})

test('billing promotion rank recognizes Development Club and Large Club', () => {
  assert.equal(shouldPromoteBillPayer(PLAN_KEYS.singleTeam, PLAN_KEYS.developmentClub), true)
  assert.equal(shouldPromoteBillPayer(PLAN_KEYS.smallClub, PLAN_KEYS.developmentClub), false)
  assert.equal(shouldPromoteBillPayer(PLAN_KEYS.singleTeam, PLAN_KEYS.largeClub), true)
  assert.equal(shouldPromoteBillPayer(PLAN_KEYS.developmentClub, PLAN_KEYS.largeClub), false)
  assert.equal(shouldPromoteBillPayer('future_enterprise_plus', PLAN_KEYS.largeClub), false)
})
