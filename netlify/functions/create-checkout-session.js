import process from 'node:process'
import Stripe from 'stripe'
import { json } from './_stripe-billing.js'

function getPriceId(planName, billingCycle) {
  const prices = {
    'Single Team': {
      monthly: process.env.VITE_STRIPE_SINGLE_TEAM_MONTHLY_PRICE_ID,
      annual: process.env.VITE_STRIPE_SINGLE_TEAM_ANNUAL_PRICE_ID,
    },
    'Small Club': {
      monthly: process.env.VITE_STRIPE_SMALL_CLUB_MONTHLY_PRICE_ID,
      annual: process.env.VITE_STRIPE_SMALL_CLUB_ANNUAL_PRICE_ID,
    },
  }

  return prices[planName]?.[billingCycle] || ''
}

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
    console.error(error)
    return ''
  }
}

export async function handler(event) {
  if (event.httpMethod !== 'POST') {
    return json(405, { success: false, message: 'Method not allowed' })
  }

  if (!process.env.STRIPE_SECRET_KEY) {
    return json(500, { success: false, message: 'Checkout is not configured yet' })
  }

  try {
    const body = JSON.parse(event.body || '{}')
    const planName = cleanString(body.planName)
    const billingCycle = cleanString(body.billingCycle)
    const customerEmail = cleanString(body.customerEmail)
    const clubName = cleanString(body.clubName)
    const priceId = getPriceId(planName, billingCycle)

    if (!priceId) {
      return json(400, { success: false, message: 'This plan is not available for checkout yet' })
    }

    const appUrl = (process.env.VITE_APP_URL || process.env.URL || 'https://playerfeedback.online').replace(/\/$/, '')
    const stripe = new Stripe(process.env.STRIPE_SECRET_KEY, {
      apiVersion: '2026-02-25.clover',
    })
    const livePromotionCodeId = await getValidatedLivePromotionCodeId(stripe, body.livePromotionCodeId)

    const session = await stripe.checkout.sessions.create({
      mode: 'subscription',
      line_items: [{ price: priceId, quantity: 1 }],
      success_url: `${appUrl}/login?checkout=success&plan=${encodeURIComponent(planName)}&session_id={CHECKOUT_SESSION_ID}`,
      cancel_url: `${appUrl}/login?checkout=cancelled`,
      allow_promotion_codes: !livePromotionCodeId,
      discounts: livePromotionCodeId ? [{ promotion_code: livePromotionCodeId }] : undefined,
      customer_email: customerEmail || undefined,
      subscription_data: {
        trial_period_days: 14,
        metadata: {
          planName,
          billingCycle,
          clubName,
        },
      },
      metadata: {
        planName,
        billingCycle,
        clubName,
      },
    })

    return json(200, { success: true, url: session.url })
  } catch (error) {
    console.error(error)
    return json(500, { success: false, message: 'Checkout could not be started' })
  }
}
