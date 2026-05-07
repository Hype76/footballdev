import { isDemoUser } from './demo.js'

export const PLAN_KEYS = {
  individual: 'individual',
  singleTeam: 'single_team',
  smallClub: 'small_club',
  largeClub: 'large_club',
}

export const PLAN_OPTIONS = [
  {
    key: PLAN_KEYS.individual,
    name: 'Individual',
    price: 'Free',
    limits: {
      teams: 1,
      staffLogins: 1,
      players: 5,
      monthlyEvaluations: 10,
    },
    features: {
      pdfExport: false,
      parentEmail: false,
      customFormFields: false,
      basicBranding: false,
      customBranding: false,
      themes: false,
      auditLogs: false,
      approvalWorkflow: false,
    },
  },
  {
    key: PLAN_KEYS.singleTeam,
    name: 'Single Team',
    price: '£9.99/month',
    limits: {
      teams: 1,
      staffLogins: 3,
      players: 20,
      monthlyEvaluations: null,
    },
    features: {
      pdfExport: true,
      parentEmail: true,
      customFormFields: true,
      basicBranding: true,
      customBranding: false,
      themes: false,
      auditLogs: false,
      approvalWorkflow: false,
    },
  },
  {
    key: PLAN_KEYS.smallClub,
    name: 'Small Club',
    price: '£24.99/month',
    limits: {
      teams: 10,
      staffLogins: null,
      players: null,
      monthlyEvaluations: null,
    },
    features: {
      pdfExport: true,
      parentEmail: true,
      customFormFields: true,
      basicBranding: true,
      customBranding: true,
      themes: true,
      auditLogs: true,
      approvalWorkflow: true,
    },
  },
  {
    key: PLAN_KEYS.largeClub,
    name: 'Large Club',
    price: 'Contact us',
    limits: {
      teams: null,
      staffLogins: null,
      players: null,
      monthlyEvaluations: null,
    },
    features: {
      pdfExport: true,
      parentEmail: true,
      customFormFields: true,
      basicBranding: true,
      customBranding: true,
      themes: true,
      auditLogs: true,
      approvalWorkflow: true,
    },
  },
]

const PLAN_BY_KEY = Object.fromEntries(PLAN_OPTIONS.map((plan) => [plan.key, plan]))

export function getPlanKey(value) {
  const rawValue = typeof value === 'string'
    ? value
    : value?.planKey ?? value?.plan_key ?? value?.clubPlanKey ?? value?.club_plan_key

  return PLAN_BY_KEY[rawValue] ? rawValue : PLAN_KEYS.smallClub
}

export function getPlan(planOrUser) {
  return PLAN_BY_KEY[getPlanKey(planOrUser)] ?? PLAN_BY_KEY[PLAN_KEYS.smallClub]
}

export function isPlanComped(value) {
  if (value?.testerAccessExpired) {
    return false
  }

  return Boolean(value?.isPlanComped ?? value?.is_plan_comped)
}

export function getPlanName(planOrUser) {
  return getPlan(planOrUser).name
}

export function hasPlanFeature(user, featureName) {
  if (isDemoUser(user) && featureName === 'parentEmail') {
    return false
  }

  if (user?.role === 'super_admin' || isPlanComped(user)) {
    return true
  }

  return Boolean(getPlan(user).features[featureName])
}

export function getPlanLimit(user, limitName) {
  if (user?.role === 'super_admin' || isPlanComped(user)) {
    return null
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

export function getUpgradePlanForFeature(featureName) {
  const matchedPlan = PLAN_OPTIONS.find((plan) => plan.features[featureName])
  return matchedPlan?.name || 'a paid plan'
}

export function getUpgradePlanForLimit(limitName) {
  const matchedPlan = PLAN_OPTIONS.find((plan) => plan.limits[limitName] === null)
  return matchedPlan?.name || 'a higher plan'
}

export function createFeatureUpgradeMessage(featureName) {
  return `This feature is not included in your current plan. Upgrade to ${getUpgradePlanForFeature(featureName)} to use it.`
}

export function createLimitUpgradeMessage(user, limitName, label) {
  const limit = getPlanLimit(user, limitName)
  const targetPlan = getUpgradePlanForLimit(limitName)
  return `${label} is limited to ${limit} on your current plan. Upgrade to ${targetPlan} to add more.`
}
