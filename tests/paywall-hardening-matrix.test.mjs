import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'

import { CAPABILITIES, canUseFeature, getFeatureAccess, getPlanLimit, getRequiredUpgrade } from '../src/lib/paywall-access.js'
import { CAPABILITY_REGISTRY, PLAN_ORDER } from '../src/lib/paywall-capabilities.js'
import { canUseRouteFeature, getRouteCapability } from '../src/lib/paywall-ui.js'
import {
  getPlanKey,
  getPlanLimit as getCanonicalPlanLimit,
  getPlanName,
  hasPlanFeature,
  isPlanAccessActive,
  normalizePlanKey,
  PLAN_KEYS,
  PLAN_OPTIONS,
} from '../src/lib/plans.js'
import { pricingPlans } from '../src/lib/login-pricing.js'
import { getPlanFromPriceId, SELF_SERVICE_CHECKOUT_PLAN_KEYS } from '../netlify/functions/_stripe-billing.js'

const activeBase = {
  clubId: 'club-1',
  teamId: 'team-1',
  playerId: 'player-1',
  role: 'manager',
  roleRank: 50,
  planStatus: 'active',
  ownsResource: true,
}

function context(planKey, overrides = {}) {
  return {
    ...activeBase,
    planKey,
    ...overrides,
  }
}

function readSource(path) {
  return readFileSync(path, 'utf8')
}

test('approved plans, aliases, malformed values, and payment states fail closed consistently', () => {
  assert.deepEqual(PLAN_OPTIONS.map((plan) => plan.key), [
    PLAN_KEYS.individual,
    PLAN_KEYS.singleTeam,
    PLAN_KEYS.smallClub,
    PLAN_KEYS.developmentClub,
    PLAN_KEYS.largeClub,
  ])

  const aliasCases = [
    ['Individual Coach - Free', PLAN_KEYS.individual],
    ['free', PLAN_KEYS.individual],
    ['club', PLAN_KEYS.smallClub],
    ['Development Club', PLAN_KEYS.developmentClub],
    ['dev club', PLAN_KEYS.developmentClub],
    ['Contact sales', PLAN_KEYS.largeClub],
    ['enterprise', PLAN_KEYS.largeClub],
  ]

  for (const [input, expected] of aliasCases) {
    assert.equal(normalizePlanKey(input), expected)
  }

  for (const missingValue of [null, undefined, '', {}, { planKey: '' }]) {
    assert.equal(getPlanKey(missingValue), PLAN_KEYS.individual)
    assert.equal(normalizePlanKey(missingValue), '')
  }

  for (const unknownValue of ['future_plus', '../large_club', '<script>large_club</script>']) {
    assert.equal(normalizePlanKey(unknownValue), '')
    assert.equal(getPlanKey({ planKey: unknownValue }), '')
    assert.equal(isPlanAccessActive({ planKey: unknownValue, planStatus: 'active' }), false)
    assert.equal(hasPlanFeature({ planKey: unknownValue, planStatus: 'active' }, 'parentEmail'), false)
  }

  assert.equal(isPlanAccessActive(context(PLAN_KEYS.singleTeam, { planStatus: 'active' })), true)
  assert.equal(isPlanAccessActive(context(PLAN_KEYS.singleTeam, { planStatus: 'trialing' })), true)

  for (const planStatus of ['past_due', 'incomplete', 'canceled', 'cancelled', 'expired', 'unpaid', 'incomplete_expired', 'unknown', '']) {
    assert.equal(canUseFeature(context(PLAN_KEYS.singleTeam, { planStatus }), CAPABILITIES.parentEmails), false, planStatus || 'missing')
  }
})

test('tier capability matrix enforces Free, Single, Small, Development, and Large boundaries', () => {
  const free = context(PLAN_KEYS.individual, { planStatus: '', role: 'coach', roleRank: 20 })
  const single = context(PLAN_KEYS.singleTeam)
  const small = context(PLAN_KEYS.smallClub, { role: 'admin', roleRank: 90 })
  const development = context(PLAN_KEYS.developmentClub, { role: 'admin', roleRank: 90 })
  const large = context(PLAN_KEYS.largeClub, { role: 'admin', roleRank: 90 })

  for (const capability of [
    CAPABILITIES.basicDevelopmentRecords,
    CAPABILITIES.goalsAndNotes,
    CAPABILITIES.limitedRecordHistory,
    CAPABILITIES.responsiveWebPwa,
    CAPABILITIES.footballPlayerBranding,
    CAPABILITIES.familyPortalPreview,
  ]) {
    assert.equal(canUseFeature(free, capability), true, capability)
  }

  for (const capability of [
    CAPABILITIES.assessments,
    CAPABILITIES.attachments,
    CAPABILITIES.parentPortal,
    CAPABILITIES.parentInvitations,
    CAPABILITIES.parentEmails,
    CAPABILITIES.pdfReports,
    CAPABILITIES.teamCalendar,
    CAPABILITIES.matchDay,
    CAPABILITIES.teamPolls,
    CAPABILITIES.fullOperationalAuditLog,
    CAPABILITIES.basicClubAnalytics,
    CAPABILITIES.clubWideOperationalExports,
    CAPABILITIES.integrations,
  ]) {
    assert.equal(canUseFeature(free, capability), false, capability)
  }

  for (const capability of [
    CAPABILITIES.assessments,
    CAPABILITIES.playerNotes,
    CAPABILITIES.attachments,
    CAPABILITIES.parentPortal,
    CAPABILITIES.parentEmails,
    CAPABILITIES.pdfReports,
    CAPABILITIES.teamCalendar,
    CAPABILITIES.trainingEvents,
    CAPABILITIES.fixtures,
    CAPABILITIES.generalEvents,
    CAPABILITIES.matchDay,
    CAPABILITIES.teamPolls,
    CAPABILITIES.basicLogoBranding,
    CAPABILITIES.basicActivityVisibility,
  ]) {
    assert.equal(canUseFeature(single, capability), true, capability)
  }

  for (const capability of [
    CAPABILITIES.clubAdministration,
    CAPABILITIES.clubWideCalendar,
    CAPABILITIES.recurringEvents,
    CAPABILITIES.calendarExportFeed,
    CAPABILITIES.fullOperationalAuditLog,
    CAPABILITIES.advancedDevelopmentAnalytics,
  ]) {
    assert.equal(canUseFeature(single, capability), false, capability)
  }

  for (const capability of [
    CAPABILITIES.clubAdministration,
    CAPABILITIES.clubStaffRoles,
    CAPABILITIES.sharedPlayerOversight,
    CAPABILITIES.bulkInvitesImports,
    CAPABILITIES.clubWideCalendar,
    CAPABILITIES.recurringEvents,
    CAPABILITIES.calendarExportFeed,
    CAPABILITIES.customColoursBranding,
    CAPABILITIES.fullOperationalAuditLog,
    CAPABILITIES.basicClubAnalytics,
  ]) {
    assert.equal(canUseFeature(small, capability), true, capability)
  }

  for (const capability of [
    CAPABILITIES.advancedDevelopmentAnalytics,
    CAPABILITIES.playerPathways,
    CAPABILITIES.coachHandovers,
    CAPABILITIES.scheduledReviewCycles,
    CAPABILITIES.approvalWorkflows,
    CAPABILITIES.customAssessmentTemplates,
    CAPABILITIES.customReportTemplates,
    CAPABILITIES.clubWideOperationalExports,
    CAPABILITIES.scheduledParentReports,
  ]) {
    assert.equal(canUseFeature(small, capability), false, capability)
    assert.equal(canUseFeature(development, capability), true, capability)
  }

  assert.equal(canUseFeature(development, CAPABILITIES.integrations), false)
  assert.equal(canUseFeature(large, CAPABILITIES.integrations), false)
  assert.equal(getFeatureAccess(large, CAPABILITIES.integrations).reason, 'setup_required:integrationsConfigured')
  assert.equal(canUseFeature({ ...large, integrationsConfigured: true }, CAPABILITIES.integrations), true)
})

test('numeric limits and negotiated Large Club team limits are explicit', () => {
  const limitCases = [
    [PLAN_KEYS.individual, 'teams', 1],
    [PLAN_KEYS.individual, 'staffLogins', 1],
    [PLAN_KEYS.individual, 'players', 5],
    [PLAN_KEYS.singleTeam, 'teams', 1],
    [PLAN_KEYS.singleTeam, 'staffLogins', 5],
    [PLAN_KEYS.singleTeam, 'players', 30],
    [PLAN_KEYS.smallClub, 'teams', 5],
    [PLAN_KEYS.developmentClub, 'teams', 10],
    [PLAN_KEYS.largeClub, 'teams', 10],
  ]

  for (const [planKey, limitName, expected] of limitCases) {
    assert.equal(getCanonicalPlanLimit(context(planKey), limitName), expected)
    assert.equal(getPlanLimit(context(planKey), limitName), expected)
  }

  assert.equal(getPlanLimit(context(PLAN_KEYS.largeClub, { negotiatedLimits: { teams: 18 } }), 'teams'), 18)
  assert.equal(getPlanLimit(context(PLAN_KEYS.largeClub, { maxTeams: 22 }), 'teams'), 22)
  assert.equal(getCanonicalPlanLimit(context(PLAN_KEYS.largeClub, { planStatus: 'past_due', negotiatedLimits: { teams: 18 } }), 'teams'), 0)
})

test('role, route, context, ownership, and hostile access checks remain separate from tier', () => {
  const single = context(PLAN_KEYS.singleTeam)

  assert.equal(canUseFeature({ ...single, role: 'coach', roleRank: 20 }, CAPABILITIES.parentEmails), true)
  assert.equal(canUseFeature({ ...single, role: 'assistant_coach', roleRank: 20 }, CAPABILITIES.parentEmails), true)
  assert.equal(canUseFeature({ ...single, role: 'parent_portal', roleRank: 0 }, CAPABILITIES.parentEmails), false)
  assert.equal(canUseFeature({ ...single, role: 'player', roleRank: 0 }, CAPABILITIES.parentEmails), false)
  assert.equal(canUseFeature({ ...single, role: '', roleRank: 0 }, CAPABILITIES.parentEmails), false)

  assert.equal(canUseFeature({ role: 'super_admin', planKey: 'future_plus', planStatus: 'expired' }, CAPABILITIES.platformAdminAccess), true)
  assert.equal(canUseFeature({ role: 'admin', planKey: PLAN_KEYS.largeClub, planStatus: 'active' }, CAPABILITIES.platformAdminAccess), false)

  assert.equal(canUseFeature({ ...single, clubId: '' }, CAPABILITIES.parentEmails), false)
  assert.equal(canUseFeature({ ...single, teamId: '' }, CAPABILITIES.assessments), false)
  assert.equal(canUseFeature({ ...single, playerId: '', ownsResource: false }, 'notARealCapability'), false)

  assert.equal(getRouteCapability('/assess-player'), CAPABILITIES.assessments)
  assert.equal(canUseRouteFeature(context(PLAN_KEYS.individual, { planStatus: '' }), '/assess-player'), false)
  assert.equal(canUseRouteFeature(single, '/assess-player'), true)
  assert.equal(canUseRouteFeature(single, '/activity-log'), false)
  assert.equal(canUseRouteFeature(context(PLAN_KEYS.smallClub, { role: 'admin', roleRank: 90 }), '/activity-log'), true)
  assert.equal(canUseRouteFeature(context(PLAN_KEYS.individual, { planStatus: '' }), '/calendar'), false)
  assert.equal(canUseRouteFeature(single, '/calendar'), true)
})

test('commerce and Stripe mapping stay canonical and fail closed', () => {
  assert.deepEqual(pricingPlans.map((plan) => [plan.planKey, plan.name, plan.price]), [
    [PLAN_KEYS.individual, 'Individual Coach - Free', 'Free'],
    [PLAN_KEYS.singleTeam, 'Single Team', 12.99],
    [PLAN_KEYS.smallClub, 'Small Club', 34.99],
    [PLAN_KEYS.developmentClub, 'Development Club', 59.99],
    [PLAN_KEYS.largeClub, 'Large Club', '\u00a399.99+'],
  ])

  assert.equal(pricingPlans[0].features.includes('Family portal preview only'), true)
  assert.equal(pricingPlans[1].description, 'The complete Football Player product for one team.')
  assert.equal(SELF_SERVICE_CHECKOUT_PLAN_KEYS.has(PLAN_KEYS.singleTeam), true)
  assert.equal(SELF_SERVICE_CHECKOUT_PLAN_KEYS.has(PLAN_KEYS.smallClub), true)
  assert.equal(SELF_SERVICE_CHECKOUT_PLAN_KEYS.has(PLAN_KEYS.developmentClub), true)
  assert.equal(SELF_SERVICE_CHECKOUT_PLAN_KEYS.has(PLAN_KEYS.individual), false)
  assert.equal(SELF_SERVICE_CHECKOUT_PLAN_KEYS.has(PLAN_KEYS.largeClub), false)
  assert.deepEqual(getPlanFromPriceId('price_unknown'), { planKey: '', billingCycle: '' })
})

test('core controls and data rights are not premium commercial entitlements', () => {
  for (const capability of [
    CAPABILITIES.secureAuthentication,
    CAPABILITIES.accountProtection,
    CAPABILITIES.safeguardingControls,
    CAPABILITIES.essentialRolePermissions,
    CAPABILITIES.parentalConsentVisibilityControls,
    CAPABILITIES.safetyAuditability,
    CAPABILITIES.dataRightsAccess,
    CAPABILITIES.dataRightsExport,
    CAPABILITIES.dataRightsDeletion,
  ]) {
    const definition = CAPABILITY_REGISTRY[capability]
    assert.equal(definition.commercial, false, capability)
    assert.equal(definition.requiresPayment, false, capability)
    assert.deepEqual(PLAN_ORDER.filter((planKey) => definition.includedPlans.includes(planKey)), PLAN_ORDER)
  }

  assert.equal(CAPABILITY_REGISTRY[CAPABILITIES.fullOperationalAuditLog].requiresPayment, true)
  assert.equal(CAPABILITY_REGISTRY[CAPABILITIES.clubWideOperationalExports].requiresPayment, true)
  assert.match(CAPABILITY_REGISTRY[CAPABILITIES.clubWideOperationalExports].securityNotes, /separate from required data rights exports/)
})

test('trusted function, RPC, RLS, and storage sources contain fail-closed paywall enforcement', () => {
  const planGate = readSource('netlify/functions/_plan-gate.js')
  const manageTeam = readSource('netlify/functions/manage-team.js')
  const sendParentEmail = readSource('netlify/functions/send-parent-email.js')
  const renderPdf = readSource('netlify/functions/render-pdf.js')
  const manageScheduledEmails = readSource('netlify/functions/manage-scheduled-emails.js')
  const parentInvite = readSource('netlify/functions/send-parent-portal-invite.js')
  const staffInvite = readSource('netlify/functions/send-staff-invite.js')
  const domainTeamActions = readSource('src/lib/domain/team-actions.js')
  const serverMigration = readSource('supabase/migrations/20260622050850_paywall_server_enforcement.sql')
  const foundationMigration = readSource('supabase/migrations/20260622043000_paywall_plan_key_foundation.sql')
  const stripeWebhook = readSource('netlify/functions/stripe-webhook.js')
  const checkout = readSource('netlify/functions/create-checkout-session.js')

  assert.match(planGate, /profileAuthUserId && profileAuthUserId !== String\(authUser\.id\)/)
  assert.match(planGate, /profileEmail !== authEmail/)
  assert.match(planGate, /assertPlanFeature\(planProfile, featureName\)/)

  assert.doesNotMatch(manageTeam, /planKey === PLAN_KEYS\.largeClub/)
  assert.match(manageTeam, /getPlanLimit\(profile, 'teams'\)/)
  assert.doesNotMatch(domainTeamActions, /PLAN_KEYS\.largeClub \? null/)
  assert.match(domainTeamActions, /getPlanLimit\(user, 'teams'\)/)

  assert.match(sendParentEmail, /assertPlanFeature\(planProfile,\s*'parentEmails'\)/)
  assert.match(sendParentEmail, /assertPlanFeature\(planProfile,\s*'pdfReports'\)/)
  assert.match(renderPdf, /assertPlanFeature\(planProfile,\s*'pdfReports'\)/)
  assert.match(manageScheduledEmails, /assertPlanFeature\(profile,\s*'parentEmails'\)/)
  assert.match(manageScheduledEmails, /requiredFeature: 'parentEmails'/)
  assert.match(parentInvite, /assertPlanFeature\(planProfile,\s*'parentInvitations'\)/)
  assert.match(staffInvite, /assertPlanFeature\(planProfile,\s*invite\.team_id \? 'teamStaffRoles' : 'clubStaffRoles'\)/)

  assert.match(serverMigration, /else false\s+end;/)
  assert.match(serverMigration, /public\.can_use_plan_feature\(calendar_events\.club_id, 'recurringEvents'\)/)
  assert.match(serverMigration, /public\.can_use_plan_feature\(parent_player_links\.club_id, 'parentInvitations'\)/)
  assert.match(serverMigration, /public\.can_use_plan_feature\(public\.current_user_club_id\(\), 'basicLogoBranding'\)/)
  assert.match(serverMigration, /storage\.objects/)
  assert.match(serverMigration, /current_user_club_id\(\)::text/)
  assert.match(foundationMigration, /when 'large_club' then 10/)
  assert.doesNotMatch(foundationMigration, /target_plan_key = 'large_club' then\s+return true/)

  assert.match(checkout, /isSelfServiceCheckoutPlanKey\(planKey\)/)
  assert.match(checkout, /\['monthly', 'annual'\]\.includes\(billingCycle\)/)
  assert.match(stripeWebhook, /Checkout price did not match a configured plan/)
  assert.match(stripeWebhook, /Checkout metadata plan does not match the configured Stripe price/)
  assert.match(stripeWebhook, /error\?\.code === '23505'/)
})

test('upgrade targets match public tier progression', () => {
  assert.equal(getRequiredUpgrade(context(PLAN_KEYS.individual), CAPABILITIES.parentPortal)?.name, 'Single Team')
  assert.equal(getRequiredUpgrade(context(PLAN_KEYS.singleTeam), CAPABILITIES.fullOperationalAuditLog)?.name, 'Small Club')
  assert.equal(getRequiredUpgrade(context(PLAN_KEYS.smallClub), CAPABILITIES.approvalWorkflows)?.name, 'Development Club')
  assert.equal(getRequiredUpgrade(context(PLAN_KEYS.developmentClub), CAPABILITIES.integrations)?.name, 'Large Club')
  assert.equal(getPlanName({ planKey: 'future_plus' }), 'Unknown plan')
})
