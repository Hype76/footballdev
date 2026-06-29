import {
  CAPABILITIES,
  ACCESS_PLAN_KEYS,
  ACCESS_READINESS,
  getCapabilityDefinition,
  getLimitDefinition,
  getRequiredUpgradePlanKeyForCapability,
  isCapabilityIncludedForPlan,
  normalizeCapabilityKey,
} from './paywall-capabilities.js'
import {
  getPlan,
  getPlanLimit as getCanonicalPlanLimit,
  getPlanName,
  isPlanComped,
  normalizePlanKey,
  PLAN_OPTIONS,
} from './plans.js'

export { CAPABILITIES, normalizePlanKey }

const VALID_PAID_STATUSES = new Set(['active', 'trialing'])
const INVALID_STATUSES = new Set(['past_due', 'incomplete', 'cancelled', 'canceled', 'expired', 'unpaid', 'incomplete_expired'])

function normalizeRole(value) {
  return String(value ?? '').trim()
}

function normalizeBoolean(value) {
  return value === true
}

function normalizePaymentStatus(value) {
  const status = String(value ?? '').trim().toLowerCase()

  if (status === 'cancelled') {
    return 'canceled'
  }

  return status
}

export function normalizeAccessContext(context = {}) {
  const planKey = normalizePlanKey(context, { mapMissingToFree: true })
  const plan = getPlan({ planKey })
  const role = normalizeRole(context.role ?? context.clubRole ?? context.platformRole)
  const roleRank = Number(context.roleRank ?? context.role_rank ?? 0)
  const paymentStatus = normalizePaymentStatus(context.planStatus ?? context.plan_status ?? context.subscriptionStatus ?? context.subscription_status)

  return {
    ...context,
    planKey,
    plan,
    role,
    roleRank: Number.isFinite(roleRank) ? roleRank : 0,
    paymentStatus,
    isPlanComped: isPlanComped(context),
    clubId: String(context.clubId ?? context.club_id ?? '').trim(),
    teamId: String(context.teamId ?? context.team_id ?? context.activeTeamId ?? context.active_team_id ?? '').trim(),
    playerId: String(context.playerId ?? context.player_id ?? '').trim(),
    ownsResource: normalizeBoolean(context.ownsResource ?? context.isOwner ?? context.is_owner),
  }
}

function isReadinessActive(capabilityDefinition) {
  return capabilityDefinition.readiness === ACCESS_READINESS.active
}

function isPaymentValid(accessContext, capabilityDefinition) {
  if (!capabilityDefinition.requiresPayment) {
    return true
  }

  if (accessContext.plan?.requiresPayment === false) {
    return true
  }

  if (accessContext.isPlanComped) {
    return true
  }

  if (accessContext.planKey === ACCESS_PLAN_KEYS.individual) {
    return false
  }

  if (VALID_PAID_STATUSES.has(accessContext.paymentStatus)) {
    return true
  }

  return false
}

function getPaymentReason(accessContext) {
  if (!accessContext.paymentStatus) {
    return 'no_subscription'
  }

  if (INVALID_STATUSES.has(accessContext.paymentStatus)) {
    return `invalid_payment_state:${accessContext.paymentStatus}`
  }

  return `unsupported_payment_state:${accessContext.paymentStatus}`
}

function isRoleAllowed(accessContext, rolePolicy = {}) {
  const blockedRoles = new Set(rolePolicy.blockedRoles ?? [])

  if (blockedRoles.has(accessContext.role)) {
    return false
  }

  const allowedRoles = rolePolicy.allowedRoles ?? []

  if (allowedRoles.length > 0 && !allowedRoles.includes(accessContext.role)) {
    return false
  }

  const minimumRoleRank = Number(rolePolicy.minimumRoleRank ?? 0)

  if (minimumRoleRank > 0 && accessContext.roleRank < minimumRoleRank) {
    return false
  }

  return true
}

function isContextAllowed(accessContext, contextPolicy = {}) {
  if (contextPolicy.requiresClub && !accessContext.clubId) {
    return false
  }

  if (contextPolicy.requiresTeam && !accessContext.teamId) {
    return false
  }

  if (contextPolicy.requiresPlayer && !accessContext.playerId) {
    return false
  }

  if (contextPolicy.requiresOwnership && !accessContext.ownsResource) {
    return false
  }

  if (contextPolicy.requiresLiveParentPlayerData && accessContext.previewOnly) {
    return false
  }

  return true
}

function getContextFailureReason(accessContext, contextPolicy = {}) {
  if (contextPolicy.requiresClub && !accessContext.clubId) {
    return 'missing_club_context'
  }

  if (contextPolicy.requiresTeam && !accessContext.teamId) {
    return 'missing_team_context'
  }

  if (contextPolicy.requiresPlayer && !accessContext.playerId) {
    return 'missing_player_context'
  }

  if (contextPolicy.requiresOwnership && !accessContext.ownsResource) {
    return 'ownership_required'
  }

  if (contextPolicy.requiresLiveParentPlayerData && accessContext.previewOnly) {
    return 'preview_cannot_use_live_data'
  }

  return 'context_not_allowed'
}

function isSetupComplete(accessContext, setupRequirements = []) {
  return setupRequirements.every((requirement) => accessContext[requirement] === true)
}

function getSetupFailureReason(accessContext, setupRequirements = []) {
  const missingRequirement = setupRequirements.find((requirement) => accessContext[requirement] !== true)
  return missingRequirement ? `setup_required:${missingRequirement}` : 'setup_required'
}

function deniedAccess({ capabilityDefinition, accessContext, reason }) {
  return {
    allowed: false,
    known: Boolean(capabilityDefinition),
    capability: capabilityDefinition?.key || '',
    label: capabilityDefinition?.label || 'Unknown capability',
    planKey: accessContext.planKey,
    planName: accessContext.plan?.name || getPlanName({ planKey: accessContext.planKey }),
    readiness: capabilityDefinition?.readiness || ACCESS_READINESS.unavailable,
    reason,
    requiredUpgradePlanKey: capabilityDefinition ? getRequiredUpgradePlanKeyForCapability(capabilityDefinition.key, accessContext.planKey) : '',
    securityNotes: capabilityDefinition?.securityNotes || '',
  }
}

export function getFeatureAccess(context, capabilityKey) {
  const accessContext = normalizeAccessContext(context)
  const normalizedCapabilityKey = normalizeCapabilityKey(capabilityKey)
  const capabilityDefinition = getCapabilityDefinition(normalizedCapabilityKey)

  if (!capabilityDefinition) {
    return deniedAccess({ capabilityDefinition: null, accessContext, reason: 'unknown_capability' })
  }

  if (!isReadinessActive(capabilityDefinition)) {
    return deniedAccess({ capabilityDefinition, accessContext, reason: `readiness:${capabilityDefinition.readiness}` })
  }

  if (capabilityDefinition.key === CAPABILITIES.platformAdminAccess) {
    if (!isRoleAllowed(accessContext, capabilityDefinition.rolePolicy)) {
      return deniedAccess({ capabilityDefinition, accessContext, reason: 'role_not_allowed' })
    }

    return {
      allowed: true,
      known: true,
      capability: capabilityDefinition.key,
      label: capabilityDefinition.label,
      planKey: accessContext.planKey,
      planName: accessContext.plan.name,
      readiness: capabilityDefinition.readiness,
      reason: 'allowed',
      requiredUpgradePlanKey: '',
      securityNotes: capabilityDefinition.securityNotes,
    }
  }

  if (!isCapabilityIncludedForPlan(accessContext.planKey, capabilityDefinition.key)) {
    return deniedAccess({ capabilityDefinition, accessContext, reason: 'plan_not_included' })
  }

  if (!isPaymentValid(accessContext, capabilityDefinition)) {
    return deniedAccess({ capabilityDefinition, accessContext, reason: getPaymentReason(accessContext) })
  }

  if (!isRoleAllowed(accessContext, capabilityDefinition.rolePolicy)) {
    return deniedAccess({ capabilityDefinition, accessContext, reason: 'role_not_allowed' })
  }

  if (!isContextAllowed(accessContext, capabilityDefinition.contextPolicy)) {
    return deniedAccess({
      capabilityDefinition,
      accessContext,
      reason: getContextFailureReason(accessContext, capabilityDefinition.contextPolicy),
    })
  }

  if (!isSetupComplete(accessContext, capabilityDefinition.setupRequirements)) {
    return deniedAccess({
      capabilityDefinition,
      accessContext,
      reason: getSetupFailureReason(accessContext, capabilityDefinition.setupRequirements),
    })
  }

  return {
    allowed: true,
    known: true,
    capability: capabilityDefinition.key,
    label: capabilityDefinition.label,
    planKey: accessContext.planKey,
    planName: accessContext.plan.name,
    readiness: capabilityDefinition.readiness,
    reason: 'allowed',
    requiredUpgradePlanKey: '',
    securityNotes: capabilityDefinition.securityNotes,
  }
}

export function canUseFeature(context, capabilityKey) {
  return getFeatureAccess(context, capabilityKey).allowed
}

export function getRequiredUpgrade(context, capabilityKey) {
  const accessContext = normalizeAccessContext(context)
  const capabilityDefinition = getCapabilityDefinition(capabilityKey)

  if (!capabilityDefinition) {
    return null
  }

  const planKey = getRequiredUpgradePlanKeyForCapability(capabilityDefinition.key, accessContext.planKey)
  const plan = PLAN_OPTIONS.find((option) => option.key === planKey)

  return plan || null
}

export function getPlanLimit(context, limitName) {
  if (!getLimitDefinition(limitName)) {
    return 0
  }

  const accessContext = normalizeAccessContext(context)
  return getCanonicalPlanLimit(accessContext, limitName)
}

export function getLimitAccess(context, limitName) {
  const accessContext = normalizeAccessContext(context)
  const limitDefinition = getLimitDefinition(limitName)

  if (!limitDefinition) {
    return {
      known: false,
      limitName: '',
      limit: 0,
      label: 'Unknown limit',
      source: '',
      notes: '',
    }
  }

  return {
    known: true,
    limitName,
    limit: getPlanLimit(accessContext, limitName),
    label: limitDefinition.label,
    source: limitDefinition.source,
    notes: limitDefinition.notes,
  }
}
