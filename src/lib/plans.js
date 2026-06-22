import { isDemoUser } from './demo.js'
import {
  getCapabilityDefinition,
  getFeatureFlagMapForPlan,
  getRequiredUpgradePlanKeyForCapability,
  isCapabilityIncludedForPlan,
} from './paywall-capabilities.js'

export const PLAN_KEYS = {
  individual: 'individual',
  singleTeam: 'single_team',
  smallClub: 'small_club',
  developmentClub: 'development_club',
  largeClub: 'large_club',
}

export const PLAN_PURCHASE_MODES = {
  free: 'free',
  selfService: 'self_service',
  contactSales: 'contact_sales',
  none: 'none',
}

export const PLAN_STATES = {
  active: 'active',
  deprecated: 'deprecated',
  unsupported: 'unsupported',
}

export const PLAN_KEY_ALIASES = Object.freeze({
  coach_free: PLAN_KEYS.individual,
  free: PLAN_KEYS.individual,
  individual: PLAN_KEYS.individual,
  individual_coach: PLAN_KEYS.individual,
  individual_coach_free: PLAN_KEYS.individual,
  individual_free: PLAN_KEYS.individual,
  individualcoachfree: PLAN_KEYS.individual,
  single: PLAN_KEYS.singleTeam,
  single_team: PLAN_KEYS.singleTeam,
  singleteam: PLAN_KEYS.singleTeam,
  team: PLAN_KEYS.singleTeam,
  club: PLAN_KEYS.smallClub,
  small_club: PLAN_KEYS.smallClub,
  smallclub: PLAN_KEYS.smallClub,
  development: PLAN_KEYS.developmentClub,
  development_club: PLAN_KEYS.developmentClub,
  developmentclub: PLAN_KEYS.developmentClub,
  dev_club: PLAN_KEYS.developmentClub,
  devclub: PLAN_KEYS.developmentClub,
  contact: PLAN_KEYS.largeClub,
  contact_sales: PLAN_KEYS.largeClub,
  enterprise: PLAN_KEYS.largeClub,
  large_club: PLAN_KEYS.largeClub,
  largeclub: PLAN_KEYS.largeClub,
  negotiated: PLAN_KEYS.largeClub,
})

const PLAN_FEATURES_NONE = getFeatureFlagMapForPlan(PLAN_KEYS.individual)
const PLAN_FEATURES_SINGLE_TEAM = getFeatureFlagMapForPlan(PLAN_KEYS.singleTeam)
const PLAN_FEATURES_SMALL_CLUB = getFeatureFlagMapForPlan(PLAN_KEYS.smallClub)
const PLAN_FEATURES_DEVELOPMENT_CLUB = getFeatureFlagMapForPlan(PLAN_KEYS.developmentClub)
const PLAN_FEATURES_LARGE_CLUB = getFeatureFlagMapForPlan(PLAN_KEYS.largeClub)

const UNKNOWN_PLAN = Object.freeze({
  key: '',
  name: 'Unknown plan',
  displayName: 'Unknown plan',
  headlineMonthlyPrice: 'Unknown',
  price: 'Unknown',
  isFree: false,
  isPaid: false,
  purchaseMode: PLAN_PURCHASE_MODES.none,
  state: PLAN_STATES.unsupported,
  isDeprecated: true,
  limits: Object.freeze({
    teams: 0,
    staffLogins: 0,
    players: 0,
    monthlyEvaluations: 0,
  }),
  features: PLAN_FEATURES_NONE,
  legacyAliases: Object.freeze([]),
  safeDefaultBehavior: 'fail_closed_no_paid_entitlement',
})

export const PLAN_OPTIONS = [
  {
    key: PLAN_KEYS.individual,
    name: 'Individual Coach - Free',
    displayName: 'Individual Coach - Free',
    headlineMonthlyPrice: 'GBP 0',
    price: 'GBP 0',
    isFree: true,
    isPaid: false,
    purchaseMode: PLAN_PURCHASE_MODES.free,
    state: PLAN_STATES.active,
    isDeprecated: false,
    limits: {
      teams: 1,
      staffLogins: 1,
      players: 5,
      monthlyEvaluations: 10,
    },
    features: PLAN_FEATURES_NONE,
    legacyAliases: ['Individual', 'Free', 'Individual Coach Free'],
    safeDefaultBehavior: 'explicit_free_tier_for_missing_paid_subscription',
  },
  {
    key: PLAN_KEYS.singleTeam,
    name: 'Single Team',
    displayName: 'Single Team',
    headlineMonthlyPrice: 'GBP 12.99/month',
    price: 'GBP 12.99/month',
    isFree: false,
    isPaid: true,
    purchaseMode: PLAN_PURCHASE_MODES.selfService,
    state: PLAN_STATES.active,
    isDeprecated: false,
    limits: {
      teams: 1,
      staffLogins: 5,
      players: 30,
      monthlyEvaluations: null,
    },
    features: PLAN_FEATURES_SINGLE_TEAM,
    legacyAliases: ['Single Team', 'single_team'],
    safeDefaultBehavior: 'self_service_paid_plan_requires_explicit_key',
  },
  {
    key: PLAN_KEYS.smallClub,
    name: 'Small Club',
    displayName: 'Small Club',
    headlineMonthlyPrice: 'GBP 34.99/month',
    price: 'GBP 34.99/month',
    isFree: false,
    isPaid: true,
    purchaseMode: PLAN_PURCHASE_MODES.selfService,
    state: PLAN_STATES.active,
    isDeprecated: false,
    limits: {
      teams: 5,
      staffLogins: null,
      players: null,
      monthlyEvaluations: null,
    },
    features: PLAN_FEATURES_SMALL_CLUB,
    legacyAliases: ['Small Club', 'small_club'],
    safeDefaultBehavior: 'self_service_paid_plan_requires_explicit_key',
    limitNotes: 'Staff and player limits preserve the currently enforced unlimited values until explicit numeric limits are approved.',
  },
  {
    key: PLAN_KEYS.developmentClub,
    name: 'Development Club',
    displayName: 'Development Club',
    headlineMonthlyPrice: 'GBP 59.99/month',
    price: 'GBP 59.99/month',
    isFree: false,
    isPaid: true,
    purchaseMode: PLAN_PURCHASE_MODES.selfService,
    state: PLAN_STATES.active,
    isDeprecated: false,
    limits: {
      teams: 10,
      staffLogins: null,
      players: null,
      monthlyEvaluations: null,
    },
    features: PLAN_FEATURES_DEVELOPMENT_CLUB,
    legacyAliases: ['Development Club', 'development_club'],
    safeDefaultBehavior: 'self_service_paid_plan_requires_explicit_key',
    limitNotes: 'Staff and player limits preserve the currently enforced unlimited values until explicit numeric limits are approved.',
  },
  {
    key: PLAN_KEYS.largeClub,
    name: 'Large Club',
    displayName: 'Large Club',
    headlineMonthlyPrice: 'GBP 99.99+/month',
    price: 'GBP 99.99+/month',
    isFree: false,
    isPaid: true,
    purchaseMode: PLAN_PURCHASE_MODES.contactSales,
    state: PLAN_STATES.active,
    isDeprecated: false,
    limits: {
      teams: null,
      staffLogins: null,
      players: null,
      monthlyEvaluations: null,
    },
    features: PLAN_FEATURES_LARGE_CLUB,
    legacyAliases: ['Large Club', 'large_club', 'Contact', 'Contact sales'],
    safeDefaultBehavior: 'negotiated_plan_requires_explicit_key',
  },
]

const PLAN_BY_KEY = Object.fromEntries(PLAN_OPTIONS.map((plan) => [plan.key, plan]))
export const PLAN_KEY_SET = new Set(PLAN_OPTIONS.map((plan) => plan.key))

const NEGOTIATED_LIMIT_ALIASES = Object.freeze({
  teams: ['teams', 'teamLimit', 'team_limit', 'teamsLimit', 'teams_limit', 'maxTeams', 'max_teams'],
  staffLogins: ['staffLogins', 'staff_logins', 'staffLimit', 'staff_limit', 'staffLoginsLimit', 'staff_logins_limit', 'maxStaffLogins', 'max_staff_logins'],
  players: ['players', 'playerLimit', 'player_limit', 'playersLimit', 'players_limit', 'maxPlayers', 'max_players'],
  monthlyEvaluations: ['monthlyEvaluations', 'monthly_evaluations', 'monthlyEvaluationLimit', 'monthly_evaluation_limit', 'maxMonthlyEvaluations', 'max_monthly_evaluations'],
})

function getRawPlanValue(value) {
  return typeof value === 'string'
    ? value
    : value?.planKey ?? value?.plan_key ?? value?.clubPlanKey ?? value?.club_plan_key
}

function normalizePlanToken(value) {
  return String(value ?? '')
    .normalize('NFKD')
    .replace(/[^\w]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .toLowerCase()
}

function hasUnsafePlanTokenShape(value) {
  return /[<>/\\]/.test(value)
}

export function normalizePlanKey(value, { fallbackKey = '', mapMissingToFree = false } = {}) {
  const rawValue = getRawPlanValue(value)
  const normalizedText = String(rawValue ?? '').trim()

  if (!normalizedText) {
    return mapMissingToFree ? PLAN_KEYS.individual : fallbackKey
  }

  if (hasUnsafePlanTokenShape(normalizedText)) {
    return fallbackKey
  }

  const alias = normalizePlanToken(normalizedText)
  return PLAN_KEY_ALIASES[alias] || fallbackKey
}

export function isKnownPlanKey(value) {
  return Boolean(normalizePlanKey(value))
}

export function getPlanKey(value, options = {}) {
  return normalizePlanKey(value, { mapMissingToFree: true, ...options })
}

export function getPlan(planOrUser) {
  return PLAN_BY_KEY[getPlanKey(planOrUser)] ?? UNKNOWN_PLAN
}

export function isPlanComped(value) {
  if (value?.testerAccessExpired) {
    return false
  }

  return Boolean(value?.isPlanComped ?? value?.is_plan_comped)
}

export function isPlanAccessActive(value) {
  if (value?.role === 'super_admin') {
    return true
  }

  const planKey = getPlanKey(value)

  if (!planKey) {
    return false
  }

  if (isPlanComped(value)) {
    return true
  }

  const status = String(value?.planStatus ?? value?.plan_status ?? '').trim()
  return status === 'active' || status === 'trialing'
}

export function getPlanStatusLabel(value) {
  const status = String(value?.planStatus ?? value?.plan_status ?? '').trim()

  if (status === 'active') {
    return 'Active'
  }

  if (status === 'trialing') {
    return 'Trialing'
  }

  if (status === 'past_due') {
    return 'Past due'
  }

  if (status === 'cancelled') {
    return 'Cancelled'
  }

  return status || 'Not active'
}

export function getPlanName(planOrUser) {
  return getPlan(planOrUser).name
}

function getNumericLimitOverride(source, aliases = []) {
  if (!source || typeof source !== 'object') {
    return undefined
  }

  for (const alias of aliases) {
    const value = source[alias]

    if (value === null) {
      return null
    }

    const numberValue = Number(value)

    if (Number.isFinite(numberValue) && numberValue >= 0) {
      return numberValue
    }
  }

  return undefined
}

function getNegotiatedLimitOverride(user, limitName) {
  const aliases = NEGOTIATED_LIMIT_ALIASES[limitName] ?? [limitName]
  const directOverride = getNumericLimitOverride(user, aliases)

  if (directOverride !== undefined) {
    return directOverride
  }

  const nestedSources = [
    user?.negotiatedLimits,
    user?.negotiated_limits,
    user?.planLimits,
    user?.plan_limits,
    user?.limitOverrides,
    user?.limit_overrides,
  ]

  for (const source of nestedSources) {
    const override = getNumericLimitOverride(source, aliases)

    if (override !== undefined) {
      return override
    }
  }

  return undefined
}

export function hasPlanFeature(user, featureName) {
  if (isDemoUser(user) && featureName === 'parentEmail') {
    return false
  }

  if (user?.role === 'super_admin') {
    return true
  }

  if (!isPlanAccessActive(user)) {
    return false
  }

  return isCapabilityIncludedForPlan(getPlanKey(user), featureName)
}

export function canEditClubIdentity(user) {
  if (!user || isDemoUser(user)) {
    return false
  }

  if (user.role === 'super_admin') {
    return true
  }

  if (!user.clubId) {
    return false
  }

  const planKey = getPlanKey(user)

  if (planKey === PLAN_KEYS.individual) {
    return true
  }

  if (planKey === PLAN_KEYS.singleTeam) {
    return user.role === 'head_manager' || Number(user.roleRank ?? 0) >= 70
  }

  return user.role === 'admin'
}

export function getPlanLimit(user, limitName) {
  if (user?.role === 'super_admin') {
    return null
  }

  if (!isPlanAccessActive(user)) {
    return 0
  }

  const planKey = getPlanKey(user)

  if (planKey === PLAN_KEYS.largeClub) {
    const negotiatedOverride = getNegotiatedLimitOverride(user, limitName)

    if (negotiatedOverride !== undefined) {
      return negotiatedOverride
    }

    if (limitName === 'teams') {
      return PLAN_BY_KEY[PLAN_KEYS.developmentClub].limits.teams
    }
  }

  return getPlan(user).limits[limitName] ?? null
}

export function isWithinPlanLimit(user, limitName, currentCount) {
  const limit = getPlanLimit(user, limitName)

  if (limit === null || limit === undefined) {
    return true
  }

  return Number(currentCount ?? 0) < Number(limit)
}

export function normalizePlanEmail(value) {
  return String(value ?? '').trim().toLowerCase()
}

export function getUniqueStaffAccessEmails(members = [], invites = []) {
  const emails = new Set()

  members.forEach((member) => {
    const email = normalizePlanEmail(typeof member === 'string' ? member : member?.email)

    if (email) {
      emails.add(email)
    }
  })

  invites.forEach((invite) => {
    if (invite?.acceptedAt || invite?.accepted_at) {
      return
    }

    const email = normalizePlanEmail(typeof invite === 'string' ? invite : invite?.email)

    if (email) {
      emails.add(email)
    }
  })

  return emails
}

export function canAddStaffAccessEmail(user, email, members = [], invites = []) {
  const normalizedEmail = normalizePlanEmail(email)
  const accessEmails = getUniqueStaffAccessEmails(members, invites)

  if (normalizedEmail && accessEmails.has(normalizedEmail)) {
    return true
  }

  return isWithinPlanLimit(user, 'staffLogins', accessEmails.size)
}

export function getUpgradePlanForFeature(featureName, planOrUser = null) {
  const currentPlanKey = planOrUser ? getPlanKey(planOrUser) : ''
  const matchedPlanKey = getRequiredUpgradePlanKeyForCapability(featureName, currentPlanKey)
  return PLAN_BY_KEY[matchedPlanKey]?.name || 'a paid plan'
}

function isLimitUpgrade(currentLimit, candidateLimit) {
  if (candidateLimit === null) {
    return currentLimit !== null
  }

  if (currentLimit === null || candidateLimit === undefined) {
    return false
  }

  return Number(candidateLimit) > Number(currentLimit)
}

export function getUpgradePlanForLimit(limitName, planOrUser = null) {
  const currentPlanKey = planOrUser ? getPlanKey(planOrUser) : PLAN_KEYS.individual
  const currentLimit = PLAN_BY_KEY[currentPlanKey]?.limits?.[limitName] ?? 0
  const currentIndex = PLAN_OPTIONS.findIndex((plan) => plan.key === currentPlanKey)
  const searchStartIndex = currentIndex >= 0 ? currentIndex + 1 : 0
  const matchedPlan = PLAN_OPTIONS
    .slice(searchStartIndex)
    .find((plan) => isLimitUpgrade(currentLimit, plan.limits[limitName]))

  return matchedPlan?.name || 'a higher plan'
}

export function createFeatureUpgradeMessage(featureName, planOrUser = null) {
  const featureCopy = getCapabilityDefinition(featureName) ?? {
    label: 'This feature',
    action: 'use it',
  }

  if (planOrUser && isCapabilityIncludedForPlan(getPlanKey(planOrUser), featureName) && !isPlanAccessActive(planOrUser)) {
    return `${featureCopy.label} is included in ${getPlanName(planOrUser)}, but this workspace billing status is ${getPlanStatusLabel(planOrUser)}. Update billing or mark the club as active before changing it.`
  }

  if (planOrUser && planOrUser.role === 'parent_portal') {
    return `${featureCopy.label} is not available for this parent account. Ask your club contact if you need access.`
  }

  if (planOrUser && planOrUser.role !== 'admin' && planOrUser.role !== 'super_admin' && Number(planOrUser.roleRank ?? 0) < 90) {
    return `${featureCopy.label} is not available for your current workspace. Ask a Club Admin to review the plan.`
  }

  return `${featureCopy.label} is not available in your current billing tier. Upgrade to ${getUpgradePlanForFeature(featureName, planOrUser)} to ${featureCopy.action}.`
}

export function createLimitUpgradeMessage(user, limitName, label) {
  const limit = getPlanLimit(user, limitName)
  const targetPlan = getUpgradePlanForLimit(limitName, user)

  if (user && !isPlanAccessActive(user)) {
    return `${label} is included in ${getPlanName(user)}, but this workspace billing status is ${getPlanStatusLabel(user)}. Update billing or mark the club as active before adding more.`
  }

  return `${label} has reached the limit for your current billing tier (${limit}). Upgrade to ${targetPlan} to add more.`
}
