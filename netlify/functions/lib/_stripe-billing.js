import process from 'node:process'
import { normalizePlanKey as normalizeCanonicalPlanKey } from '../../../src/lib/plans.js'
import { CLUB_BASE_MONTHLY_PENCE, CLUB_ADDITIONAL_BLOCK_MONTHLY_PENCE, TEAM_MONTHLY_PENCE, TEAM_ANNUAL_PENCE, CLUB_ADDITIONAL_BLOCK_ANNUAL_PENCE, quoteSubscription } from '../../../src/lib/subscription-pricing.js'

export const PLAN_BY_NAME = {
  'Single Team': 'single_team',
  'Small Club': 'small_club',
  'Development Club': 'development_club',
  'Large Club': 'large_club',
  Pilot: 'pilot',
}

export const SELF_SERVICE_CHECKOUT_PLAN_KEYS = new Set([
  'single_team',
  'small_club',
  'development_club',
  'team',
  'club',
])

const PRICE_ENV_BY_PLAN_AND_CYCLE = {
  single_team: {
    monthly: 'VITE_STRIPE_SINGLE_TEAM_MONTHLY_PRICE_ID',
    annual: 'VITE_STRIPE_SINGLE_TEAM_ANNUAL_PRICE_ID',
  },
  small_club: {
    monthly: 'VITE_STRIPE_SMALL_CLUB_MONTHLY_PRICE_ID',
    annual: 'VITE_STRIPE_SMALL_CLUB_ANNUAL_PRICE_ID',
  },
  development_club: {
    monthly: 'VITE_STRIPE_DEVELOPMENT_CLUB_MONTHLY_PRICE_ID',
    annual: 'VITE_STRIPE_DEVELOPMENT_CLUB_ANNUAL_PRICE_ID',
  },
}

const MODERN_PRICE_ENV_BY_PLAN_AND_CYCLE = {
  team: {
    monthly: 'STRIPE_TEAM_MONTHLY_PRICE_ID',
    annual: 'STRIPE_TEAM_ANNUAL_PRICE_ID',
  },
  club: {
    monthly: 'STRIPE_CLUB_MONTHLY_PRICE_ID',
    annual: 'STRIPE_CLUB_ANNUAL_PRICE_ID',
  },
}

const MODERN_BLOCK_ENV_BY_CYCLE = {
  monthly: 'STRIPE_CLUB_BLOCK_MONTHLY_PRICE_ID',
  annual: 'STRIPE_CLUB_BLOCK_ANNUAL_PRICE_ID',
}

function getConfiguredPriceEntries() {
  return Object.entries(PRICE_ENV_BY_PLAN_AND_CYCLE)
    .flatMap(([planKey, cycleMap]) => Object.entries(cycleMap).map(([billingCycle, envName]) => ({
      billingCycle,
      envName,
      planKey,
      priceId: String(process.env[envName] ?? '').trim(),
    })))
    .filter((entry) => entry.priceId)
}

export function getPriceMap() {
  const legacy = getConfiguredPriceEntries().map((entry) => [
    entry.priceId,
    {
      planKey: entry.planKey,
      billingCycle: entry.billingCycle,
    },
  ])
  const modern = Object.entries(MODERN_PRICE_ENV_BY_PLAN_AND_CYCLE).flatMap(([planKey, cycles]) => Object.entries(cycles).map(([billingCycle, envName]) => {
    const priceId = String(process.env[envName] ?? '').trim()
    return priceId ? [priceId, { planKey, billingCycle }] : []
  })).filter(Boolean)
  return Object.fromEntries([...legacy, ...modern])
}

export function getCheckoutPriceId(planKey, billingCycle) {
  const normalizedPlanKey = normalizePlanKey(planKey)
  const normalizedBillingCycle = String(billingCycle ?? '').trim().toLowerCase()
  const envName = PRICE_ENV_BY_PLAN_AND_CYCLE[normalizedPlanKey]?.[normalizedBillingCycle]
    || MODERN_PRICE_ENV_BY_PLAN_AND_CYCLE[normalizedPlanKey]?.[normalizedBillingCycle]

  return envName ? String(process.env[envName] ?? '').trim() : ''
}

function configuredModernPrice(planKey, billingCycle) {
  const envName = MODERN_PRICE_ENV_BY_PLAN_AND_CYCLE[planKey]?.[billingCycle]
  return envName ? String(process.env[envName] ?? '').trim() : ''
}

function configuredBlockPrice(billingCycle) {
  return String(process.env[MODERN_BLOCK_ENV_BY_CYCLE[billingCycle] ?? ''] ?? '').trim()
}

export function getCheckoutLineItems(planKey, billingCycle, teamCapacity) {
  const normalizedPlanKey = normalizePlanKey(planKey)
  const normalizedCycle = String(billingCycle ?? '').trim().toLowerCase()
  if (!['team', 'club'].includes(normalizedPlanKey)) throw new RangeError('Unsupported modern subscription plan.')
  const quote = quoteSubscription({ planKey: normalizedPlanKey, billingCycle: normalizedCycle, teamCapacity })
  const basePriceId = configuredModernPrice(normalizedPlanKey, normalizedCycle)
  if (!basePriceId) throw new RangeError('The configured base subscription price is missing.')
  const items = [{ price: basePriceId, quantity: 1 }]
  if (normalizedPlanKey === 'club' && quote.additionalTeamBlocks > 0) {
    const blockPriceId = configuredBlockPrice(normalizedCycle)
    if (!blockPriceId) throw new RangeError('The configured Club capacity block price is missing.')
    items.push({ price: blockPriceId, quantity: quote.additionalTeamBlocks })
  }
  return items
}

export async function validateCheckoutPrices(stripe, lineItems, planKey, billingCycle, teamCapacity) {
  const normalizedPlanKey = normalizePlanKey(planKey)
  const quote = quoteSubscription({ planKey: normalizedPlanKey, billingCycle, teamCapacity })
  const expected = normalizedPlanKey === 'team'
    ? [billingCycle === 'annual' ? TEAM_ANNUAL_PENCE : TEAM_MONTHLY_PENCE]
    : [billingCycle === 'annual' ? CLUB_BASE_MONTHLY_PENCE * 10 : CLUB_BASE_MONTHLY_PENCE, ...(quote.additionalTeamBlocks ? [billingCycle === 'annual' ? CLUB_ADDITIONAL_BLOCK_ANNUAL_PENCE : CLUB_ADDITIONAL_BLOCK_MONTHLY_PENCE] : [])]
  const expectedIntervals = billingCycle === 'annual' ? { interval: 'year', interval_count: 1 } : { interval: 'month', interval_count: 1 }
  if (!stripe?.prices?.retrieve || !Array.isArray(lineItems) || lineItems.length !== expected.length) throw new RangeError('Configured checkout prices could not be validated.')
  for (let index = 0; index < lineItems.length; index += 1) {
    const price = await stripe.prices.retrieve(lineItems[index].price)
    if (!price?.active || Number(price.unit_amount) !== expected[index] || String(price.currency).toLowerCase() !== 'gbp' || price.recurring?.interval !== expectedIntervals.interval || Number(price.recurring?.interval_count) !== expectedIntervals.interval_count) {
      throw new RangeError('Configured checkout price does not match the approved billing amount.')
    }
  }
  return true
}

export function isSelfServiceCheckoutPlanKey(planKey) {
  return SELF_SERVICE_CHECKOUT_PLAN_KEYS.has(normalizePlanKey(planKey))
}

export function getPlanFromPriceId(priceId) {
  const priceDetails = getPriceMap()[priceId]

  return {
    planKey: priceDetails?.planKey || '',
    billingCycle: priceDetails?.billingCycle || '',
  }
}

export function normalizePlanKey(value) {
  return normalizeCanonicalPlanKey(PLAN_BY_NAME[String(value ?? '').trim()] || value)
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
  try {
    return getSubscriptionPlanDetails(subscription).priceId
  } catch {
    return String(subscription?.items?.data?.[0]?.price?.id ?? '').trim()
  }
}

export function getSubscriptionPlanDetails(subscription) {
  const items = Array.isArray(subscription?.items?.data) ? subscription.items.data : []
  const priceMap = getPriceMap()
  const entries = items.map((item) => ({
    priceId: String(item?.price?.id ?? '').trim(),
    quantity: Number(item?.quantity ?? 0),
  }))
  if (!entries.length || entries.some((entry) => !entry.priceId || !Number.isInteger(entry.quantity) || entry.quantity < 1)) {
    throw new RangeError('Subscription line items are invalid.')
  }

  const modernBaseEntries = entries.filter((entry) => Object.values(MODERN_PRICE_ENV_BY_PLAN_AND_CYCLE).some((cycles) => Object.values(cycles).map((env) => String(process.env[env] ?? '').trim()).includes(entry.priceId)))
  if (modernBaseEntries.length === 0) {
    const legacy = priceMap[entries[0].priceId]
    if (!legacy || entries.length !== 1 || entries[0].quantity !== 1) throw new RangeError('Subscription price did not match a configured plan.')
    const capacity = legacy.planKey === 'single_team' ? 1 : legacy.planKey === 'small_club' ? 5 : legacy.planKey === 'development_club' ? 10 : 1
    return { planKey: legacy.planKey, billingCycle: legacy.billingCycle, priceId: entries[0].priceId, teamCapacity: capacity }
  }
  if (modernBaseEntries.length !== 1 || entries.filter((entry) => entry.priceId === modernBaseEntries[0].priceId).length !== 1 || modernBaseEntries[0].quantity !== 1) throw new RangeError('Subscription must contain exactly one base price with quantity one.')
  const base = modernBaseEntries[0]
  const planKey = Object.entries(MODERN_PRICE_ENV_BY_PLAN_AND_CYCLE).find(([, cycles]) => Object.values(cycles).some((env) => String(process.env[env] ?? '').trim() === base.priceId))?.[0]
  const billingCycle = Object.entries(MODERN_PRICE_ENV_BY_PLAN_AND_CYCLE[planKey] ?? {}).find(([, env]) => String(process.env[env] ?? '').trim() === base.priceId)?.[0]
  const blockPriceId = configuredBlockPrice(billingCycle)
  const blockEntries = entries.filter((entry) => entry.priceId === blockPriceId)
  const unknown = entries.filter((entry) => entry.priceId !== base.priceId && entry.priceId !== blockPriceId)
  if (unknown.length > 0 || blockEntries.length > 1 || (planKey === 'team' && blockEntries.length > 0)) throw new RangeError('Subscription contains an invalid capacity price.')
  const blocks = blockEntries[0]?.quantity ?? 0
  if (planKey === 'club' && blocks > 49) throw new RangeError('Subscription capacity blocks are invalid.')
  return { planKey, billingCycle, priceId: base.priceId, teamCapacity: planKey === 'club' ? 10 + blocks * 10 : 1 }
}

export function getSubscriptionPeriodEnd(subscription) {
  const periodEnd = Number(subscription?.current_period_end ?? 0)
  return periodEnd ? new Date(periodEnd * 1000).toISOString() : null
}

export function arePaymentsDisabled() {
  const envValue = (name) => globalThis.Netlify?.env?.get?.(name) ?? process.env[name]
  const value = envValue('VITE_PAYMENTS_DISABLED')

  return String(value ?? '').trim().toLowerCase() === 'true'
}

export function json(statusCode, body) {
  return {
    statusCode,
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  }
}
