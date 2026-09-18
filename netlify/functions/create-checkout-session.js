import process from 'node:process'
import { arePaymentsDisabled, getCheckoutLineItems, getCheckoutPriceId, isSelfServiceCheckoutPlanKey, json, validateCheckoutPrices } from './lib/_stripe-billing.js'
import { createStripeServerClient, logStripeFailure } from './lib/_stripe-runtime.js'
import { getPlanName, normalizePlanKey } from '../../src/lib/plans.js'
import { getWorkspaceScope } from '../../src/lib/workspace-scope.js'

function cleanString(value) {
  return typeof value === 'string' ? value.trim().slice(0, 120) : ''
}

function isLiveWebsitePromotion(promotionCode) {
  return String(promotionCode?.metadata?.show_live ?? '').trim().toLowerCase() === 'true'
}

function isFutureTimestamp(value) {
  return !value || Number(value) > Math.floor(Date.now() / 1000)
}

async function getValidatedLivePromotionCodeId(stripe, promotionCodeId) {
  const normalizedPromotionCodeId = cleanString(promotionCodeId)

  if (!normalizedPromotionCodeId) {
    return ''
  }

  try {
    const promotionCode = await stripe.promotionCodes.retrieve(normalizedPromotionCodeId)

    if (!promotionCode?.active || !isLiveWebsitePromotion(promotionCode) || !isFutureTimestamp(promotionCode.expires_at)) {
      return ''
    }

    return promotionCode.id
  } catch (error) {
    logStripeFailure('Live promotion lookup failed', error)
    return ''
  }
}

export async function createCheckoutSession(stripe, params, livePromotionCodeId = '') {
  const checkoutParams = {
    mode: 'subscription',
    line_items: params.lineItems || [{ price: params.priceId, quantity: 1 }],
    success_url: `${params.appUrl}/sign-in?checkout=success&plan=${encodeURIComponent(params.planName)}&session_id={CHECKOUT_SESSION_ID}`,
    cancel_url: `${params.appUrl}/sign-in?checkout=cancelled`,
    customer_email: params.customerEmail || undefined,
    subscription_data: {
      trial_period_days: 14,
      metadata: {
        planKey: params.planKey,
        planName: params.planName,
        billingCycle: params.billingCycle,
        clubName: params.clubName,
        workspaceScope: params.workspaceScope,
        teamCapacity: params.teamCapacity,
      },
    },
    metadata: {
      planKey: params.planKey,
      planName: params.planName,
      billingCycle: params.billingCycle,
      clubName: params.clubName,
      workspaceScope: params.workspaceScope,
      teamCapacity: params.teamCapacity,
    },
  }

  if (livePromotionCodeId) {
    checkoutParams.discounts = [{ promotion_code: livePromotionCodeId }]
  } else {
    checkoutParams.allow_promotion_codes = true
  }

  return stripe.checkout.sessions.create(checkoutParams)
}

export async function handler(event) {
  if (event.httpMethod !== 'POST') {
    return json(405, { success: false, message: 'Method not allowed' })
  }

  if (arePaymentsDisabled()) {
    return json(403, { success: false, message: 'Payments are disabled in this test environment' })
  }

  try {
    const body = JSON.parse(event.body || '{}')
    const planKey = normalizePlanKey(body.planKey || body.planName)
    const billingCycle = cleanString(body.billingCycle || 'monthly').toLowerCase()
    const customerEmail = cleanString(body.customerEmail)
    const clubName = cleanString(body.clubName)
    const isModernPlan = ['team', 'club'].includes(planKey)
    const teamCapacity = isModernPlan ? (body.teamCapacity ?? (planKey === 'club' ? 10 : 1)) : undefined

    if (!planKey) {
      return json(400, { success: false, message: 'Choose a valid billing plan.' })
    }

    if (!isSelfServiceCheckoutPlanKey(planKey)) {
      return json(400, { success: false, message: 'This plan is not available for self-service checkout.' })
    }

    if (!['monthly', 'annual'].includes(billingCycle)) {
      return json(400, { success: false, message: 'Choose a valid billing cycle.' })
    }

    const planName = getPlanName({ planKey })
    const workspaceScope = getWorkspaceScope(planKey)

    if (!workspaceScope.supported) {
      return json(400, { success: false, message: 'Choose a supported billing plan.' })
    }
    const priceId = isModernPlan ? '' : getCheckoutPriceId(planKey, billingCycle)
    const lineItems = isModernPlan ? getCheckoutLineItems(planKey, billingCycle, teamCapacity) : undefined

    if (!isModernPlan && !priceId) {
      return json(400, { success: false, message: 'This plan is not available for checkout yet' })
    }

    const appUrl = (process.env.VITE_APP_URL || process.env.URL || 'https://footballplayer.online').replace(/\/$/, '')
    const stripe = createStripeServerClient()
    if (isModernPlan) await validateCheckoutPrices(stripe, lineItems, planKey, billingCycle, teamCapacity)
    const livePromotionCodeId = await getValidatedLivePromotionCodeId(stripe, body.livePromotionCodeId)

    const checkoutParams = {
      appUrl,
      billingCycle,
      clubName,
      customerEmail,
      planKey,
      planName,
      priceId,
      workspaceScope: workspaceScope.key,
      teamCapacity,
      lineItems,
    }
    let session
    let promotionApplied = Boolean(livePromotionCodeId)

    try {
      session = await createCheckoutSession(stripe, checkoutParams, livePromotionCodeId)
    } catch (promotionError) {
      if (!livePromotionCodeId) {
        throw promotionError
      }

      logStripeFailure('Auto promotion checkout failed', promotionError)
      promotionApplied = false
      session = await createCheckoutSession(stripe, checkoutParams)
    }

    return json(200, { success: true, url: session.url, promotionApplied })
  } catch (error) {
    logStripeFailure('Checkout request failed', error)
    return json(error instanceof RangeError ? 400 : 500, { success: false, message: error instanceof RangeError ? 'Invalid checkout selection.' : 'Checkout could not be started' })
  }
}
