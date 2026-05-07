import process from 'node:process'

export const PLAN_BY_NAME = {
  'Single Team': 'single_team',
  'Small Club': 'small_club',
}

export function getPriceMap() {
  return {
    [process.env.VITE_STRIPE_SINGLE_TEAM_MONTHLY_PRICE_ID]: {
      planKey: 'single_team',
      billingCycle: 'monthly',
    },
    [process.env.VITE_STRIPE_SINGLE_TEAM_ANNUAL_PRICE_ID]: {
      planKey: 'single_team',
      billingCycle: 'annual',
    },
    [process.env.VITE_STRIPE_SMALL_CLUB_MONTHLY_PRICE_ID]: {
      planKey: 'small_club',
      billingCycle: 'monthly',
    },
    [process.env.VITE_STRIPE_SMALL_CLUB_ANNUAL_PRICE_ID]: {
      planKey: 'small_club',
      billingCycle: 'annual',
    },
  }
}

export function getPlanFromPriceId(priceId) {
  const priceDetails = getPriceMap()[priceId]

  return {
    planKey: priceDetails?.planKey || '',
    billingCycle: priceDetails?.billingCycle || '',
  }
}

export function normalizePlanKey(value) {
  const normalizedValue = String(value ?? '').trim()

  if (['individual', 'single_team', 'small_club', 'large_club'].includes(normalizedValue)) {
    return normalizedValue
  }

  return PLAN_BY_NAME[normalizedValue] || ''
}

export function normalizePlanStatus(status) {
  const normalizedStatus = String(status ?? '').trim()

  if (normalizedStatus === 'trialing') {
    return 'trialing'
  }

  if (normalizedStatus === 'active') {
    return 'active'
  }

  if (normalizedStatus === 'canceled' || normalizedStatus === 'cancelled') {
    return 'cancelled'
  }

  if (['past_due', 'unpaid', 'incomplete', 'incomplete_expired'].includes(normalizedStatus)) {
    return 'past_due'
  }

  return 'past_due'
}

export function getSubscriptionPriceId(subscription) {
  return String(subscription?.items?.data?.[0]?.price?.id ?? '').trim()
}

export function getSubscriptionPeriodEnd(subscription) {
  const periodEnd = Number(subscription?.current_period_end ?? 0)
  return periodEnd ? new Date(periodEnd * 1000).toISOString() : null
}

export function json(statusCode, body) {
  return {
    statusCode,
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  }
}
