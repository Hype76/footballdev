import { getWorkspaceScope, WORKSPACE_SCOPES } from './workspace-scope.js'

export const BILLING_ARRANGEMENTS = Object.freeze({
  immediate: 'immediate',
  deferred: 'deferred',
  complimentary: 'complimentary',
})

export const BILLING_ACCESS_STATES = Object.freeze({
  full: 'full',
  paymentDueSoon: 'payment_due_soon',
  paymentRequired: 'payment_required',
  archived: 'archived',
})

export const BILLING_ACTION_CATEGORIES = Object.freeze({
  read: 'READ',
  export: 'EXPORT',
  billing: 'BILLING',
  accountSecurity: 'ACCOUNT_SECURITY',
  parentOperation: 'PARENT_OPERATION',
  staffMutation: 'STAFF_MUTATION',
  platformAdmin: 'PLATFORM_ADMIN',
})

export const BILLING_ACTOR_CATEGORIES = Object.freeze({
  platformAdmin: 'PLATFORM_ADMIN',
  parentOrPlayer: 'PARENT_OR_PLAYER',
  customerStaff: 'CUSTOMER_STAFF',
  system: 'SYSTEM_CONTEXT',
  unknown: 'UNKNOWN',
})

export const PAYMENT_REQUIRED_ERROR_CODE = 'payment_required'

const VALID_SUBSCRIPTION_STATUSES = new Set(['active', 'trialing'])
const PARENT_OR_PLAYER_ROLES = new Set(['parent', 'parent_portal', 'player', 'adult_player'])
const CUSTOMER_STAFF_ROLES = new Set(['admin', 'head_manager', 'manager', 'coach', 'assistant_coach'])
const DUE_SOON_WINDOW_MS = 7 * 24 * 60 * 60 * 1000

function normalizeText(value) {
  return String(value ?? '').trim()
}

function normalizeRole(value) {
  return normalizeText(value).toLowerCase()
}

function normalizeBillingContext(context) {
  return context && typeof context === 'object' && !Array.isArray(context) ? context : {}
}

function normalizeSubscriptionStatus(value) {
  const status = normalizeText(value).toLowerCase()
  return status === 'cancelled' ? 'canceled' : status
}

function normalizeArrangement(value, isPlanComped) {
  if (isPlanComped) {
    return BILLING_ARRANGEMENTS.complimentary
  }

  const arrangement = normalizeText(value).toLowerCase()
  return Object.values(BILLING_ARRANGEMENTS).includes(arrangement) ? arrangement : ''
}

function normalizeTimestamp(value) {
  if (!value) {
    return null
  }

  const timestamp = new Date(value).getTime()
  return Number.isFinite(timestamp) ? timestamp : null
}

function normalizeNow(value) {
  const timestamp = value instanceof Date ? value.getTime() : normalizeTimestamp(value)
  return timestamp ?? Date.now()
}

function isArchivedWorkspace(context) {
  return Boolean(
    context.archivedAt
    || context.archived_at
    || context.clubArchivedAt
    || context.club_archived_at,
  )
}

function isPayerAuthorized({ context, role, scope }) {
  if (scope.key === WORKSPACE_SCOPES.team) {
    return role === scope.ownerRole.key
      && Number(context.roleRank ?? context.role_rank ?? 0) >= scope.ownerRole.rank
  }

  if (scope.key === WORKSPACE_SCOPES.club) {
    return role === scope.ownerRole.key
      && Number(context.roleRank ?? context.role_rank ?? 0) >= scope.ownerRole.rank
  }

  return false
}

function resolveBillingActorCategory(role) {
  if (role === 'super_admin') {
    return BILLING_ACTOR_CATEGORIES.platformAdmin
  }

  if (role === 'system') {
    return BILLING_ACTOR_CATEGORIES.system
  }

  if (PARENT_OR_PLAYER_ROLES.has(role)) {
    return BILLING_ACTOR_CATEGORIES.parentOrPlayer
  }

  if (CUSTOMER_STAFF_ROLES.has(role)) {
    return BILLING_ACTOR_CATEGORIES.customerStaff
  }

  return role ? BILLING_ACTOR_CATEGORIES.unknown : BILLING_ACTOR_CATEGORIES.system
}

function buildDecision({
  accessState,
  actorCategory,
  arrangement,
  billingStartAt,
  context,
  nextPaymentAction = '',
  operationalMutationsAllowed,
  payerAuthorized,
  reason,
  reviewRequired = false,
  scope,
  subscriptionStatus,
}) {
  return {
    accessState,
    actorCategory,
    arrangement,
    billingStartAt: billingStartAt ? new Date(billingStartAt).toISOString() : '',
    commercialScope: scope.key,
    dueSoon: accessState === BILLING_ACCESS_STATES.paymentDueSoon,
    exportAllowed: true,
    nextPaymentAction: nextPaymentAction || (payerAuthorized ? 'continue_with_stripe' : 'contact_billing_owner'),
    operationalMutationsAllowed,
    payerAuthorized,
    paymentRequired: accessState === BILLING_ACCESS_STATES.paymentRequired,
    reason,
    reviewRequired,
    subscriptionStatus,
    workspaceId: normalizeText(context.workspaceId ?? context.workspace_id ?? context.clubId ?? context.club_id),
  }
}

export function isValidBillingSubscriptionStatus(value) {
  return VALID_SUBSCRIPTION_STATUSES.has(normalizeSubscriptionStatus(value))
}

export function resolveBillingAccess(context = {}, { actorRequired = false, now = null } = {}) {
  const safeContext = normalizeBillingContext(context)
  const role = normalizeRole(safeContext.role ?? safeContext.clubRole ?? safeContext.club_role)
  const actorCategory = resolveBillingActorCategory(role)
  const scope = getWorkspaceScope(safeContext.planKey ?? safeContext.plan_key)

  if (actorCategory === BILLING_ACTOR_CATEGORIES.platformAdmin) {
    return buildDecision({
      accessState: BILLING_ACCESS_STATES.full,
      actorCategory,
      arrangement: '',
      billingStartAt: null,
      context: safeContext,
      nextPaymentAction: 'none',
      operationalMutationsAllowed: true,
      payerAuthorized: false,
      reason: 'platform_admin_customer_billing_bypass',
      scope,
      subscriptionStatus: '',
    })
  }

  if (actorCategory === BILLING_ACTOR_CATEGORIES.parentOrPlayer && isArchivedWorkspace(safeContext)) {
    return buildDecision({
      accessState: BILLING_ACCESS_STATES.archived,
      actorCategory,
      arrangement: '',
      billingStartAt: null,
      context: safeContext,
      nextPaymentAction: 'none',
      operationalMutationsAllowed: false,
      payerAuthorized: false,
      reason: 'workspace_archived',
      scope,
      subscriptionStatus: '',
    })
  }

  if (actorCategory === BILLING_ACTOR_CATEGORIES.parentOrPlayer) {
    return buildDecision({
      accessState: BILLING_ACCESS_STATES.full,
      actorCategory,
      arrangement: '',
      billingStartAt: null,
      context: safeContext,
      nextPaymentAction: 'none',
      operationalMutationsAllowed: true,
      payerAuthorized: false,
      reason: 'parent_or_player_customer_billing_bypass',
      scope,
      subscriptionStatus: '',
    })
  }

  if (
    actorCategory === BILLING_ACTOR_CATEGORIES.unknown
    || (actorRequired && actorCategory === BILLING_ACTOR_CATEGORIES.system)
  ) {
    return buildDecision({
      accessState: BILLING_ACCESS_STATES.paymentRequired,
      actorCategory: BILLING_ACTOR_CATEGORIES.unknown,
      arrangement: '',
      billingStartAt: null,
      context: safeContext,
      operationalMutationsAllowed: false,
      payerAuthorized: false,
      reason: 'unknown_actor',
      reviewRequired: true,
      scope,
      subscriptionStatus: '',
    })
  }

  const subscriptionStatus = normalizeSubscriptionStatus(
    safeContext.subscriptionStatus
    ?? safeContext.subscription_status
    ?? safeContext.planStatus
    ?? safeContext.plan_status,
  )
  const arrangement = normalizeArrangement(
    safeContext.billingArrangement ?? safeContext.billing_arrangement,
    Boolean(safeContext.isPlanComped ?? safeContext.is_plan_comped),
  )
  const billingStartAt = normalizeTimestamp(safeContext.billingStartAt ?? safeContext.billing_start_at)
  const payerAuthorized = isPayerAuthorized({ context: safeContext, role, scope })

  if (isArchivedWorkspace(safeContext)) {
    return buildDecision({
      accessState: BILLING_ACCESS_STATES.archived,
      actorCategory,
      arrangement,
      billingStartAt,
      context: safeContext,
      operationalMutationsAllowed: false,
      payerAuthorized: false,
      reason: 'workspace_archived',
      scope,
      subscriptionStatus,
    })
  }

  if (!scope.supported) {
    return buildDecision({
      accessState: BILLING_ACCESS_STATES.paymentRequired,
      actorCategory,
      arrangement,
      billingStartAt,
      context: safeContext,
      operationalMutationsAllowed: false,
      payerAuthorized: false,
      reason: 'unknown_commercial_scope',
      reviewRequired: true,
      scope,
      subscriptionStatus,
    })
  }

  if (scope.key === WORKSPACE_SCOPES.individual) {
    return buildDecision({
      accessState: BILLING_ACCESS_STATES.full,
      actorCategory,
      arrangement: arrangement || BILLING_ARRANGEMENTS.complimentary,
      billingStartAt,
      context: safeContext,
      operationalMutationsAllowed: true,
      payerAuthorized: false,
      reason: 'individual_free_access',
      scope,
      subscriptionStatus,
    })
  }

  if (isValidBillingSubscriptionStatus(subscriptionStatus)) {
    return buildDecision({
      accessState: BILLING_ACCESS_STATES.full,
      actorCategory,
      arrangement,
      billingStartAt,
      context: safeContext,
      operationalMutationsAllowed: true,
      payerAuthorized,
      reason: 'valid_subscription',
      scope,
      subscriptionStatus,
    })
  }

  if (arrangement === BILLING_ARRANGEMENTS.complimentary) {
    return buildDecision({
      accessState: BILLING_ACCESS_STATES.full,
      actorCategory,
      arrangement,
      billingStartAt,
      context: safeContext,
      operationalMutationsAllowed: true,
      payerAuthorized,
      reason: 'complimentary_access',
      scope,
      subscriptionStatus,
    })
  }

  if (!arrangement) {
    return buildDecision({
      accessState: BILLING_ACCESS_STATES.full,
      actorCategory,
      arrangement,
      billingStartAt,
      context: safeContext,
      operationalMutationsAllowed: true,
      payerAuthorized,
      reason: 'legacy_billing_review_required',
      reviewRequired: true,
      scope,
      subscriptionStatus,
    })
  }

  if (arrangement === BILLING_ARRANGEMENTS.immediate) {
    return buildDecision({
      accessState: BILLING_ACCESS_STATES.paymentRequired,
      actorCategory,
      arrangement,
      billingStartAt,
      context: safeContext,
      operationalMutationsAllowed: false,
      payerAuthorized,
      reason: 'immediate_payment_required',
      scope,
      subscriptionStatus,
    })
  }

  if (!billingStartAt) {
    return buildDecision({
      accessState: BILLING_ACCESS_STATES.paymentRequired,
      actorCategory,
      arrangement,
      billingStartAt,
      context: safeContext,
      operationalMutationsAllowed: false,
      payerAuthorized,
      reason: 'deferred_date_invalid',
      reviewRequired: true,
      scope,
      subscriptionStatus,
    })
  }

  const remainingMs = billingStartAt - normalizeNow(now)

  if (remainingMs <= 0) {
    return buildDecision({
      accessState: BILLING_ACCESS_STATES.paymentRequired,
      actorCategory,
      arrangement,
      billingStartAt,
      context: safeContext,
      operationalMutationsAllowed: false,
      payerAuthorized,
      reason: 'deferred_access_expired',
      scope,
      subscriptionStatus,
    })
  }

  return buildDecision({
    accessState: remainingMs <= DUE_SOON_WINDOW_MS
      ? BILLING_ACCESS_STATES.paymentDueSoon
      : BILLING_ACCESS_STATES.full,
    actorCategory,
    arrangement,
    billingStartAt,
    context: safeContext,
    operationalMutationsAllowed: true,
    payerAuthorized,
    reason: remainingMs <= DUE_SOON_WINDOW_MS ? 'payment_due_soon' : 'deferred_access_active',
    scope,
    subscriptionStatus,
  })
}

export function isBillingActionAllowed(context = {}, actionCategory, options = {}) {
  const safeContext = normalizeBillingContext(context)
  const category = normalizeText(actionCategory).toUpperCase()
  const role = normalizeRole(safeContext.role ?? safeContext.clubRole ?? safeContext.club_role)
  const actorCategory = resolveBillingActorCategory(role)
  const trustedSystemContext = actorCategory === BILLING_ACTOR_CATEGORIES.system
    && options.trustedSystemContext === true

  if (actorCategory === BILLING_ACTOR_CATEGORIES.unknown || (
    actorCategory === BILLING_ACTOR_CATEGORIES.system
    && !trustedSystemContext
  )) {
    return false
  }

  if (category === BILLING_ACTION_CATEGORIES.platformAdmin) {
    return actorCategory === BILLING_ACTOR_CATEGORIES.platformAdmin
  }

  if (actorCategory === BILLING_ACTOR_CATEGORIES.platformAdmin) {
    return true
  }

  if (actorCategory === BILLING_ACTOR_CATEGORIES.parentOrPlayer) {
    return category !== BILLING_ACTION_CATEGORIES.billing
      && category !== BILLING_ACTION_CATEGORIES.platformAdmin
  }

  const decision = resolveBillingAccess(safeContext, {
    ...options,
    actorRequired: !trustedSystemContext,
  })

  if (
    category === BILLING_ACTION_CATEGORIES.read
    || category === BILLING_ACTION_CATEGORIES.export
    || category === BILLING_ACTION_CATEGORIES.accountSecurity
  ) {
    return true
  }

  if (category === BILLING_ACTION_CATEGORIES.billing) {
    return decision.payerAuthorized && decision.accessState !== BILLING_ACCESS_STATES.archived
  }

  if (category === BILLING_ACTION_CATEGORIES.staffMutation) {
    return decision.operationalMutationsAllowed
  }

  return false
}

export function createPaymentRequiredError() {
  const error = new Error('Payment is required to continue editing and management features. Your existing information remains available to view and export.')
  error.category = PAYMENT_REQUIRED_ERROR_CODE
  error.code = PAYMENT_REQUIRED_ERROR_CODE
  error.statusCode = 402
  error.exposeMessage = true
  return error
}

export function assertBillingActionAllowed(context = {}, actionCategory, options = {}) {
  if (!isBillingActionAllowed(context, actionCategory, options)) {
    throw createPaymentRequiredError()
  }

  const role = normalizeRole(context?.role ?? context?.clubRole ?? context?.club_role)
  const trustedSystemContext = resolveBillingActorCategory(role) === BILLING_ACTOR_CATEGORIES.system
    && options.trustedSystemContext === true

  return resolveBillingAccess(context, {
    ...options,
    actorRequired: !trustedSystemContext,
  })
}

export function isParentOrPlayerBillingBypassRole(value) {
  return PARENT_OR_PLAYER_ROLES.has(normalizeRole(value))
}
