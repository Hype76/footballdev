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

const FEATURE_UPGRADE_COPY = {
  approvalWorkflow: {
    label: 'Team approval controls',
    action: 'change approval settings',
  },
  auditLogs: {
    label: 'Activity logs',
    action: 'view staff activity logs',
  },
  basicBranding: {
    label: 'Club branding',
    action: 'change club branding',
  },
  customBranding: {
    label: 'Custom branding',
    action: 'use custom branding',
  },
  customFormFields: {
    label: 'Custom development fields',
    action: 'change development fields',
  },
  parentEmail: {
    label: 'Parent and player email',
    action: 'send emails to parents or players',
  },
  pdfExport: {
    label: 'PDF exports and attachments',
    action: 'create PDFs or attach PDFs to emails',
  },
  themes: {
    label: 'Theme settings',
    action: 'change theme settings',
  },
}

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

export function isPlanAccessActive(value) {
  if (value?.role === 'super_admin' || isPlanComped(value)) {
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

  return Boolean(getPlan(user).features[featureName])
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

export function getUpgradePlanForFeature(featureName) {
  const matchedPlan = PLAN_OPTIONS.find((plan) => plan.features[featureName])
  return matchedPlan?.name || 'a paid plan'
}

export function getUpgradePlanForLimit(limitName) {
  const matchedPlan = PLAN_OPTIONS.find((plan) => plan.limits[limitName] === null)
  return matchedPlan?.name || 'a higher plan'
}

export function createFeatureUpgradeMessage(featureName, planOrUser = null) {
  const featureCopy = FEATURE_UPGRADE_COPY[featureName] ?? {
    label: 'This feature',
    action: 'use it',
  }

  if (planOrUser && !isPlanAccessActive(planOrUser)) {
    return `${featureCopy.label} is included in ${getPlanName(planOrUser)}, but this workspace billing status is ${getPlanStatusLabel(planOrUser)}. Update billing or mark the club as active before changing it.`
  }

  return `${featureCopy.label} is not available in your current billing tier. Upgrade to ${getUpgradePlanForFeature(featureName)} to ${featureCopy.action}.`
}

export function createLimitUpgradeMessage(user, limitName, label) {
  const limit = getPlanLimit(user, limitName)
  const targetPlan = getUpgradePlanForLimit(limitName)

  if (user && !isPlanAccessActive(user)) {
    return `${label} is included in ${getPlanName(user)}, but this workspace billing status is ${getPlanStatusLabel(user)}. Update billing or mark the club as active before adding more.`
  }

  return `${label} has reached the limit for your current billing tier (${limit}). Upgrade to ${targetPlan} to add more.`
}
