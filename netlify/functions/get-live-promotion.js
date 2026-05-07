import process from 'node:process'
import Stripe from 'stripe'
import { json } from './_stripe-billing.js'

function getStripe() {
  if (!process.env.STRIPE_SECRET_KEY) {
    throw new Error('Billing is not configured')
  }

  return new Stripe(process.env.STRIPE_SECRET_KEY, {
    apiVersion: '2026-02-25.clover',
  })
}

function isLiveWebsitePromotion(promotionCode) {
  return String(promotionCode?.metadata?.show_live ?? '').trim().toLowerCase() === 'true'
}

function isFutureTimestamp(value) {
  return !value || Number(value) > Math.floor(Date.now() / 1000)
}

function getPromotionCouponId(promotionCode) {
  const promotionCoupon = promotionCode?.promotion?.coupon ?? promotionCode?.coupon
  return typeof promotionCoupon === 'string' ? promotionCoupon : promotionCoupon?.id
}

function formatPromotion(coupon, promotionCode) {
  return {
    promotionCodeId: promotionCode.id,
    code: promotionCode.code,
    percentOff: coupon.percent_off,
    amountOff: coupon.amount_off,
    currency: coupon.currency,
    duration: coupon.duration,
    durationInMonths: coupon.duration_in_months,
    expiresAt: promotionCode.expires_at ? new Date(promotionCode.expires_at * 1000).toISOString() : null,
    redeemBy: coupon.redeem_by ? new Date(coupon.redeem_by * 1000).toISOString() : null,
    firstTimeOnly: Boolean(promotionCode.restrictions?.first_time_transaction),
  }
}

export async function handler(event) {
  if (event.httpMethod !== 'GET') {
    return json(405, { success: false, message: 'Method not allowed' })
  }

  try {
    const stripe = getStripe()
    const promotionCodes = await stripe.promotionCodes.list({ limit: 100 })
    const livePromotionCode = promotionCodes.data.find((promotionCode) =>
      promotionCode.active &&
      isLiveWebsitePromotion(promotionCode) &&
      isFutureTimestamp(promotionCode.expires_at),
    )

    if (!livePromotionCode) {
      return json(200, { success: true, promotion: null })
    }

    const couponId = getPromotionCouponId(livePromotionCode)

    if (!couponId) {
      return json(200, { success: true, promotion: null })
    }

    const coupon = await stripe.coupons.retrieve(couponId)

    if (!coupon?.valid || !isFutureTimestamp(coupon.redeem_by)) {
      return json(200, { success: true, promotion: null })
    }

    return json(200, {
      success: true,
      promotion: formatPromotion(coupon, livePromotionCode),
    })
  } catch (error) {
    console.error(error)
    return json(200, { success: true, promotion: null })
  }
}
