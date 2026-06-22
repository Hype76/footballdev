import process from 'node:process'
import { normalizePlanKey as normalizeCanonicalPlanKey } from '../../src/lib/plans.js'

const STAGING_PROJECT_REF = 'llpufwzvgxyczxcjwupu'
const LIVE_PROJECT_REF = 'hvapkizujvsahvgspser'
const STAGING_BRANCHES = new Set(['football-os-staging', 'staging', 'codex/football-club-os-staging-rebuild'])

export const PLAN_BY_NAME = {
  'Single Team': 'single_team',
  'Small Club': 'small_club',
  'Development Club': 'development_club',
  'Large Club': 'large_club',
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
  return String(subscription?.items?.data?.[0]?.price?.id ?? '').trim()
}

export function getSubscriptionPeriodEnd(subscription) {
  const periodEnd = Number(subscription?.current_period_end ?? 0)
  return periodEnd ? new Date(periodEnd * 1000).toISOString() : null
}

export function arePaymentsDisabled(event = {}) {
  const envValue = (name) => globalThis.Netlify?.env?.get?.(name) ?? process.env[name]
  const value = envValue('VITE_PAYMENTS_DISABLED')

  if (String(value ?? '').trim().toLowerCase() === 'true') {
    return true
  }

  const context = String(envValue('CONTEXT') ?? '').trim().toLowerCase()
  const branch = String(envValue('BRANCH') ?? '').trim().toLowerCase()
  const host = String(event.headers?.['x-forwarded-host'] || event.headers?.host || '').trim().toLowerCase()
  const supabaseUrl = String(envValue('STAGING_SUPABASE_URL') || envValue('VITE_SUPABASE_URL') || '').trim()
  const isStagingSupabase = supabaseUrl.includes(`${STAGING_PROJECT_REF}.supabase.co`)
  const isLiveSupabase = supabaseUrl.includes(`${LIVE_PROJECT_REF}.supabase.co`)
  const hasStagingRuntimeEvidence = Boolean(
    context === 'branch-deploy' ||
      context === 'deploy-preview' ||
      STAGING_BRANCHES.has(branch) ||
      branch.includes('staging') ||
      host.includes('football-os-staging') ||
      host.includes('staging.footballplayer.online'),
  )

  return Boolean(
    isStagingSupabase &&
      hasStagingRuntimeEvidence &&
      !isLiveSupabase &&
      context !== 'production' &&
      branch !== 'main',
  )
}

export function json(statusCode, body) {
  return {
    statusCode,
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  }
}
