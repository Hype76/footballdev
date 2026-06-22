import assert from 'node:assert/strict'
import test from 'node:test'

import {
  CAPABILITIES,
  canUseFeature,
  getFeatureAccess,
  getLimitAccess,
  getPlanLimit as getAccessPlanLimit,
  getRequiredUpgrade,
} from '../src/lib/paywall-access.js'
import {
  ACCESS_PLAN_KEYS,
  CAPABILITY_REGISTRY,
  PLAN_ORDER,
  isCapabilityIncludedForPlan,
} from '../src/lib/paywall-capabilities.js'
import {
  getUpgradePlanForFeature,
  getUpgradePlanForLimit,
  PLAN_KEYS,
} from '../src/lib/plans.js'

const activeStaffContext = {
  clubId: 'club-1',
  teamId: 'team-1',
  role: 'manager',
  roleRank: 50,
  planStatus: 'active',
}

function context(planKey, overrides = {}) {
  return {
    ...activeStaffContext,
    planKey,
    ...overrides,
  }
}

test('capability registry covers every capability and maps approved tier ownership', () => {
  assert.deepEqual(PLAN_ORDER, [
    PLAN_KEYS.individual,
    PLAN_KEYS.singleTeam,
    PLAN_KEYS.smallClub,
    PLAN_KEYS.developmentClub,
    PLAN_KEYS.largeClub,
  ])

  for (const capabilityDefinition of Object.values(CAPABILITY_REGISTRY)) {
    assert.equal(capabilityDefinition.key in CAPABILITIES || Object.values(CAPABILITIES).includes(capabilityDefinition.key), true)

    for (const planKey of PLAN_ORDER) {
      assert.equal(
        isCapabilityIncludedForPlan(planKey, capabilityDefinition.key),
        capabilityDefinition.includedPlans.includes(planKey),
      )
    }
  }

  const placementCases = [
    [CAPABILITIES.familyPortalPreview, [ACCESS_PLAN_KEYS.individual, ACCESS_PLAN_KEYS.singleTeam, ACCESS_PLAN_KEYS.smallClub, ACCESS_PLAN_KEYS.developmentClub, ACCESS_PLAN_KEYS.largeClub]],
    [CAPABILITIES.parentPortal, [ACCESS_PLAN_KEYS.singleTeam, ACCESS_PLAN_KEYS.smallClub, ACCESS_PLAN_KEYS.developmentClub, ACCESS_PLAN_KEYS.largeClub]],
    [CAPABILITIES.parentEmails, [ACCESS_PLAN_KEYS.singleTeam, ACCESS_PLAN_KEYS.smallClub, ACCESS_PLAN_KEYS.developmentClub, ACCESS_PLAN_KEYS.largeClub]],
    [CAPABILITIES.pdfReports, [ACCESS_PLAN_KEYS.singleTeam, ACCESS_PLAN_KEYS.smallClub, ACCESS_PLAN_KEYS.developmentClub, ACCESS_PLAN_KEYS.largeClub]],
    [CAPABILITIES.recurringEvents, [ACCESS_PLAN_KEYS.smallClub, ACCESS_PLAN_KEYS.developmentClub, ACCESS_PLAN_KEYS.largeClub]],
    [CAPABILITIES.calendarExportFeed, [ACCESS_PLAN_KEYS.smallClub, ACCESS_PLAN_KEYS.developmentClub, ACCESS_PLAN_KEYS.largeClub]],
    [CAPABILITIES.fullOperationalAuditLog, [ACCESS_PLAN_KEYS.smallClub, ACCESS_PLAN_KEYS.developmentClub, ACCESS_PLAN_KEYS.largeClub]],
    [CAPABILITIES.approvalWorkflows, [ACCESS_PLAN_KEYS.developmentClub, ACCESS_PLAN_KEYS.largeClub]],
    [CAPABILITIES.clubWideOperationalExports, [ACCESS_PLAN_KEYS.developmentClub, ACCESS_PLAN_KEYS.largeClub]],
    [CAPABILITIES.integrations, [ACCESS_PLAN_KEYS.largeClub]],
    [CAPABILITIES.nativeAppEntitlement, []],
  ]

  for (const [capability, expectedPlans] of placementCases) {
    assert.deepEqual(
      PLAN_ORDER.filter((planKey) => isCapabilityIncludedForPlan(planKey, capability)),
      expectedPlans,
    )
  }
})

test('central access separates Free preview from the real Parent Portal', () => {
  const freeContext = {
    planKey: PLAN_KEYS.individual,
    role: 'coach',
    roleRank: 20,
  }

  assert.equal(canUseFeature(freeContext, CAPABILITIES.basicDevelopmentRecords), true)
  assert.equal(canUseFeature(freeContext, CAPABILITIES.familyPortalPreview), true)
  assert.equal(canUseFeature(freeContext, CAPABILITIES.parentPortal), false)
  assert.equal(canUseFeature(freeContext, CAPABILITIES.parentInvitations), false)
  assert.equal(canUseFeature(freeContext, CAPABILITIES.parentEmails), false)
  assert.equal(canUseFeature(freeContext, CAPABILITIES.pdfReports), false)

  const previewAccess = getFeatureAccess(freeContext, CAPABILITIES.familyPortalPreview)
  assert.equal(previewAccess.allowed, true)
  assert.equal(CAPABILITY_REGISTRY[CAPABILITIES.familyPortalPreview].previewOnly, true)
  assert.equal(CAPABILITY_REGISTRY[CAPABILITIES.familyPortalPreview].allowsLiveParentPlayerData, false)

  const singleTeamParentPortal = canUseFeature(
    context(PLAN_KEYS.singleTeam, { role: 'parent_portal', roleRank: 0, clubId: 'club-1', teamId: '', planStatus: 'active' }),
    CAPABILITIES.parentPortal,
  )
  assert.equal(singleTeamParentPortal, true)
})

test('payment states preserve active and trialing while invalid states fail closed', () => {
  const validStatuses = ['active', 'trialing']
  const invalidStatuses = ['past_due', 'incomplete', 'canceled', 'cancelled', 'expired', '', 'unknown']

  for (const planStatus of validStatuses) {
    assert.equal(
      canUseFeature(context(PLAN_KEYS.singleTeam, { planStatus }), CAPABILITIES.parentEmails),
      true,
      planStatus,
    )
  }

  for (const planStatus of invalidStatuses) {
    assert.equal(
      canUseFeature(context(PLAN_KEYS.singleTeam, { planStatus }), CAPABILITIES.parentEmails),
      false,
      planStatus || 'missing',
    )
  }

  assert.equal(canUseFeature(context('future_enterprise_plus'), CAPABILITIES.parentEmails), false)
  assert.equal(canUseFeature({ role: 'coach', roleRank: 20 }, CAPABILITIES.basicDevelopmentRecords), true)
  assert.equal(canUseFeature({ role: 'coach', roleRank: 20 }, CAPABILITIES.parentEmails), false)
})

test('role, ownership, and context checks stay separate from plan entitlement', () => {
  assert.equal(canUseFeature(context(PLAN_KEYS.singleTeam, { roleRank: 0 }), CAPABILITIES.parentEmails), false)
  assert.equal(canUseFeature(context(PLAN_KEYS.singleTeam, { roleRank: 20 }), CAPABILITIES.parentEmails), true)

  assert.equal(canUseFeature(context(PLAN_KEYS.singleTeam, { teamId: '' }), CAPABILITIES.assessments), false)
  assert.equal(canUseFeature(context(PLAN_KEYS.singleTeam, { teamId: 'team-1' }), CAPABILITIES.assessments), true)

  assert.equal(canUseFeature(context(PLAN_KEYS.smallClub, { role: 'coach', roleRank: 20 }), CAPABILITIES.clubWideEvents), false)
  assert.equal(canUseFeature(context(PLAN_KEYS.smallClub, { role: 'admin', roleRank: 90 }), CAPABILITIES.clubWideEvents), true)

  assert.equal(canUseFeature(context(PLAN_KEYS.largeClub), 'notARealCapability'), false)
})

test('Platform Admin access is based on role rather than plan fallback', () => {
  const platformAdmin = {
    role: 'super_admin',
    planKey: 'future_enterprise_plus',
    planStatus: 'expired',
  }

  assert.equal(canUseFeature(platformAdmin, CAPABILITIES.platformAdminAccess), true)
  assert.equal(canUseFeature({ ...platformAdmin, role: 'admin' }, CAPABILITIES.platformAdminAccess), false)
})

test('approved tier transitions and setup-gated Large Club integrations are explicit', () => {
  assert.equal(canUseFeature(context(PLAN_KEYS.singleTeam), CAPABILITIES.recurringEvents), false)
  assert.equal(canUseFeature(context(PLAN_KEYS.smallClub), CAPABILITIES.recurringEvents), true)

  assert.equal(canUseFeature(context(PLAN_KEYS.smallClub, { role: 'admin', roleRank: 90 }), CAPABILITIES.approvalWorkflows), false)
  assert.equal(canUseFeature(context(PLAN_KEYS.developmentClub, { role: 'admin', roleRank: 90 }), CAPABILITIES.approvalWorkflows), true)

  assert.equal(canUseFeature(context(PLAN_KEYS.developmentClub), CAPABILITIES.integrations), false)
  assert.equal(canUseFeature(context(PLAN_KEYS.largeClub), CAPABILITIES.integrations), false)
  assert.equal(canUseFeature(context(PLAN_KEYS.largeClub, { integrationsConfigured: true }), CAPABILITIES.integrations), true)

  assert.equal(canUseFeature(context(PLAN_KEYS.largeClub), CAPABILITIES.nativeAppEntitlement), false)
  assert.equal(getFeatureAccess(context(PLAN_KEYS.largeClub), CAPABILITIES.nativeAppEntitlement).reason, 'readiness:hidden')
})

test('numeric limits and upgrade targets come from central configuration', () => {
  const limitCases = [
    [PLAN_KEYS.individual, 'teams', 1],
    [PLAN_KEYS.individual, 'staffLogins', 1],
    [PLAN_KEYS.individual, 'players', 5],
    [PLAN_KEYS.singleTeam, 'staffLogins', 5],
    [PLAN_KEYS.singleTeam, 'players', 30],
    [PLAN_KEYS.smallClub, 'teams', 5],
    [PLAN_KEYS.developmentClub, 'teams', 10],
    [PLAN_KEYS.largeClub, 'teams', 10],
  ]

  for (const [planKey, limitName, expectedLimit] of limitCases) {
    assert.equal(getAccessPlanLimit(context(planKey), limitName), expectedLimit)
    assert.equal(getLimitAccess(context(planKey), limitName).known, true)
  }

  assert.equal(getAccessPlanLimit(context(PLAN_KEYS.singleTeam), 'unknownLimit'), 0)
  assert.equal(getLimitAccess(context(PLAN_KEYS.singleTeam), 'unknownLimit').known, false)
  assert.equal(getAccessPlanLimit(context(PLAN_KEYS.largeClub, { negotiatedLimits: { teams: 25 } }), 'teams'), 25)
  assert.equal(getAccessPlanLimit(context(PLAN_KEYS.largeClub, { maxTeams: 30 }), 'teams'), 30)

  assert.equal(getUpgradePlanForLimit('teams', context(PLAN_KEYS.singleTeam)), 'Small Club')
  assert.equal(getUpgradePlanForLimit('teams', context(PLAN_KEYS.smallClub)), 'Development Club')
  assert.equal(getUpgradePlanForLimit('staffLogins', context(PLAN_KEYS.individual)), 'Single Team')
  assert.equal(getUpgradePlanForLimit('players', context(PLAN_KEYS.individual)), 'Single Team')
  assert.equal(getUpgradePlanForFeature('auditLogs', context(PLAN_KEYS.singleTeam)), 'Small Club')
  assert.equal(getUpgradePlanForFeature('approvalWorkflow', context(PLAN_KEYS.smallClub)), 'Development Club')
  assert.equal(getRequiredUpgrade(context(PLAN_KEYS.smallClub), CAPABILITIES.integrations)?.name, 'Large Club')
})
