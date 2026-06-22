import {
  CAPABILITIES,
  canUseFeature,
  getFeatureAccess,
} from './paywall-access.js'
import { ACCESS_READINESS, getCapabilityDefinition } from './paywall-capabilities.js'
import { getPlanName } from './plans.js'

export const ROUTE_CAPABILITIES = Object.freeze({
  '/activity-log': CAPABILITIES.fullOperationalAuditLog,
  '/add-player': CAPABILITIES.basicDevelopmentRecords,
  '/archived-players': CAPABILITIES.limitedRecordHistory,
  '/assess-player': CAPABILITIES.assessments,
  '/calendar': CAPABILITIES.teamCalendar,
  '/club-settings': CAPABILITIES.basicLogoBranding,
  '/email-queue': CAPABILITIES.parentEmails,
  '/end-season-stats': CAPABILITIES.basicClubAnalytics,
  '/form-builder': CAPABILITIES.customDevelopmentFields,
  '/match-day': CAPABILITIES.matchDay,
  '/parent-email-templates': CAPABILITIES.parentEmails,
  '/parent-linking': CAPABILITIES.parentInvitations,
  '/players': CAPABILITIES.basicDevelopmentRecords,
  '/polls': CAPABILITIES.teamPolls,
  '/sessions': CAPABILITIES.teamCalendar,
  '/teams': CAPABILITIES.teamStaffRoles,
  '/user-access': CAPABILITIES.teamStaffRoles,
})

const ROUTE_PREFIX_CAPABILITIES = Object.freeze([
  ['/assess-player/', CAPABILITIES.assessments],
  ['/calendar/', CAPABILITIES.teamCalendar],
  ['/create-evaluation', CAPABILITIES.assessments],
  ['/players/', CAPABILITIES.basicDevelopmentRecords],
  ['/sessions/', CAPABILITIES.teamCalendar],
])

function normalizeRoutePath(path) {
  const normalizedPath = String(path ?? '').trim()
  if (!normalizedPath) {
    return '/'
  }

  return normalizedPath.split('?')[0].replace(/\/+$/, '') || '/'
}

export function getRouteCapability(path) {
  const routePath = normalizeRoutePath(path)

  if (ROUTE_CAPABILITIES[routePath]) {
    return ROUTE_CAPABILITIES[routePath]
  }

  const matchedPrefix = ROUTE_PREFIX_CAPABILITIES.find(([prefix]) => routePath.startsWith(prefix))
  return matchedPrefix?.[1] ?? ''
}

export function getUiAccessContext(user, overrides = {}) {
  return {
    ...user,
    ...overrides,
    clubId: overrides.clubId ?? overrides.club_id ?? user?.clubId ?? user?.club_id ?? '',
    teamId: overrides.teamId ?? overrides.team_id ?? user?.teamId ?? user?.team_id ?? user?.activeTeamId ?? user?.active_team_id ?? '',
  }
}

export function canUseUiFeature(user, capabilityKey, overrides = {}) {
  if (!capabilityKey) {
    return true
  }

  return canUseFeature(getUiAccessContext(user, overrides), capabilityKey)
}

export function getUiFeatureAccess(user, capabilityKey, overrides = {}) {
  if (!capabilityKey) {
    return {
      allowed: true,
      known: false,
      capability: '',
      label: 'Workspace',
      readiness: ACCESS_READINESS.active,
      reason: 'allowed',
      requiredUpgradePlanKey: '',
    }
  }

  return getFeatureAccess(getUiAccessContext(user, overrides), capabilityKey)
}

export function canUseRouteFeature(user, path, overrides = {}) {
  return canUseUiFeature(user, getRouteCapability(path), overrides)
}

function canManagePlanUpgrade(user) {
  if (!user) {
    return false
  }

  return user.role === 'admin' || user.role === 'super_admin' || Number(user.roleRank ?? 0) >= 90
}

export function createUiFeatureUnavailableMessage(user, capabilityKey, overrides = {}) {
  const access = getUiFeatureAccess(user, capabilityKey, overrides)
  const capability = getCapabilityDefinition(capabilityKey)
  const label = access.label || capability?.label || 'This feature'

  if (access.allowed) {
    return `${label} is available for this account.`
  }

  if (!access.known) {
    return 'This area is not available yet.'
  }

  if (access.readiness !== ACCESS_READINESS.active) {
    return `${label} is not currently available.`
  }

  if (access.reason === 'missing_team_context') {
    return `${label} needs a team context before it can open. Choose a team first.`
  }

  if (access.reason === 'missing_club_context') {
    return `${label} needs a club context before it can open.`
  }

  if (access.reason === 'role_not_allowed') {
    return `${label} is not available for your current role. Ask a Club Admin if you need access.`
  }

  if (access.reason === 'plan_not_included') {
    if (!canManagePlanUpgrade(user)) {
      return `${label} is not included for this workspace. Ask a Club Admin to review the plan.`
    }

    const upgradePlan = access.requiredUpgradePlanKey
      ? getPlanName({ planKey: access.requiredUpgradePlanKey })
      : 'a higher plan'

    return `${label} is not included in the current plan. Upgrade to ${upgradePlan} to ${capability?.action || 'use it'}.`
  }

  if (String(access.reason).startsWith('setup_required')) {
    return `${label} is eligible for this plan, but setup is not complete yet.`
  }

  if (access.reason === 'no_subscription' || String(access.reason).startsWith('invalid_payment_state') || String(access.reason).startsWith('unsupported_payment_state')) {
    if (!canManagePlanUpgrade(user)) {
      return `${label} needs active billing before it can open. Ask a Club Admin to review billing.`
    }

    return `${label} needs active billing before it can open. Review billing before using it.`
  }

  return `${label} is not available for this workspace.`
}

