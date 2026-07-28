import { loadActiveAuthorityProfile } from './lib/_authority-profile.js'
import { supabaseAdmin } from './lib/_supabase.js'
import { arePaymentsDisabled, json } from './lib/_stripe-billing.js'
import {
  createStripeServerClient,
  isStripeProviderError,
  logStripeFailure,
} from './lib/_stripe-runtime.js'

function publicError(message, statusCode = 400) {
  return Object.assign(new Error(message), {
    exposeMessage: true,
    statusCode,
  })
}

function getBearerToken(event) {
  const header = event.headers.authorization || event.headers.Authorization || ''
  const [scheme, token] = String(header).split(' ')
  return scheme?.toLowerCase() === 'bearer' ? token : ''
}

function cleanText(value, maxLength = 120) {
  return String(value ?? '').replace(/[<>\r\n]/g, '').trim().slice(0, maxLength)
}

function isLiveWebsitePromotion(promotionCode) {
  return String(promotionCode?.metadata?.show_live ?? '').trim().toLowerCase() === 'true'
}

function getEndOfDayTimestamp(value) {
  const normalizedValue = String(value ?? '').trim()

  if (!/^\d{4}-\d{2}-\d{2}$/.test(normalizedValue)) {
    return null
  }

  const parsedDate = new Date(`${normalizedValue}T23:59:59Z`)

  if (Number.isNaN(parsedDate.getTime())) {
    return null
  }

  const timestamp = Math.floor(parsedDate.getTime() / 1000)

  if (timestamp <= Math.floor(Date.now() / 1000)) {
    throw publicError('End date must be in the future')
  }

  return timestamp
}

async function getPlatformAdmin(event) {
  const token = getBearerToken(event)

  if (!token) {
    throw publicError('Login is required', 401)
  }

  const { data: authData, error: authError } = await supabaseAdmin.auth.getUser(token)

  if (authError || !authData?.user?.id) {
    throw publicError('Login is required', 401)
  }

  const profile = await loadActiveAuthorityProfile(supabaseAdmin, authData.user, {
    select: 'id, email, role, role_rank, club_id, status',
  })

  if (profile.role !== 'super_admin') {
    throw publicError('Platform admin access is required', 403)
  }

  return profile
}

async function listCoupons(stripe) {
  const [coupons, promotionCodes] = await Promise.all([
    stripe.coupons.list({ limit: 100 }),
    stripe.promotionCodes.list({ limit: 100 }),
  ])

  const promotionCodeByCoupon = new Map()
  for (const promotionCode of promotionCodes.data) {
    const promotionCoupon = promotionCode.promotion?.coupon ?? promotionCode.coupon
    const couponId = typeof promotionCoupon === 'string' ? promotionCoupon : promotionCoupon?.id
    if (couponId && (!promotionCodeByCoupon.has(couponId) || isLiveWebsitePromotion(promotionCode))) {
      promotionCodeByCoupon.set(couponId, promotionCode)
    }
  }

  return coupons.data.map((coupon) => {
    const promotionCode = promotionCodeByCoupon.get(coupon.id)

    return {
      id: coupon.id,
      name: coupon.name || '',
      percentOff: coupon.percent_off,
      amountOff: coupon.amount_off,
      currency: coupon.currency,
      duration: coupon.duration,
      durationInMonths: coupon.duration_in_months,
      redeemBy: coupon.redeem_by ? new Date(coupon.redeem_by * 1000).toISOString() : null,
      valid: coupon.valid,
      code: promotionCode?.code || '',
      promotionCodeId: promotionCode?.id || '',
      expiresAt: promotionCode?.expires_at ? new Date(promotionCode.expires_at * 1000).toISOString() : null,
      firstTimeOnly: Boolean(promotionCode?.restrictions?.first_time_transaction),
      liveOnWebsite: isLiveWebsitePromotion(promotionCode),
      active: promotionCode?.active ?? coupon.valid,
      createdAt: coupon.created ? new Date(coupon.created * 1000).toISOString() : null,
    }
  })
}

async function createCoupon(stripe, body) {
  const name = cleanText(body.name)
  const code = cleanText(body.code, 48).toUpperCase()
  const duration = ['once', 'repeating', 'forever'].includes(body.duration) ? body.duration : 'once'
  const durationInMonths = Number(body.durationInMonths || 0)
  const percentOff = Number(body.percentOff || 0)
  const amountOff = Number(body.amountOff || 0)
  const expiresAt = getEndOfDayTimestamp(body.expiresAt)
  const firstTimeOnly = Boolean(body.firstTimeOnly)

  if (!name) {
    throw publicError('Coupon name is required')
  }

  if (!code) {
    throw publicError('Promotion code is required')
  }

  const couponPayload = {
    name,
    duration,
  }

  if (duration === 'repeating') {
    couponPayload.duration_in_months = durationInMonths > 0 ? durationInMonths : 3
  }

  if (expiresAt) {
    couponPayload.redeem_by = expiresAt
  }

  if (percentOff > 0) {
    couponPayload.percent_off = Math.min(percentOff, 100)
  } else if (amountOff > 0) {
    couponPayload.amount_off = Math.round(amountOff * 100)
    couponPayload.currency = 'gbp'
  } else {
    throw publicError('Enter a percentage or fixed amount discount')
  }

  const coupon = await stripe.coupons.create(couponPayload)
  const promotionCodePayload = {
    promotion: {
      type: 'coupon',
      coupon: coupon.id,
    },
    code,
  }

  if (expiresAt) {
    promotionCodePayload.expires_at = expiresAt
  }

  if (firstTimeOnly) {
    promotionCodePayload.restrictions = {
      first_time_transaction: true,
    }
  }

  const promotionCode = await stripe.promotionCodes.create(promotionCodePayload)

  return {
    coupon,
    promotionCode,
  }
}

async function setLivePromotion(stripe, body) {
  const promotionCodeId = cleanText(body.promotionCodeId, 120)
  const showLive = Boolean(body.showLive)

  if (showLive && !promotionCodeId) {
    throw publicError('Promotion code is required')
  }

  const promotionCodes = await stripe.promotionCodes.list({ limit: 100 })
  const updates = promotionCodes.data
    .filter((promotionCode) => promotionCode.id === promotionCodeId || isLiveWebsitePromotion(promotionCode))
    .map((promotionCode) =>
      stripe.promotionCodes.update(promotionCode.id, {
        metadata: {
          show_live: showLive && promotionCode.id === promotionCodeId ? 'true' : 'false',
        },
      }),
    )

  if (showLive && !promotionCodes.data.some((promotionCode) => promotionCode.id === promotionCodeId)) {
    throw publicError('Promotion code was not found', 404)
  }

  await Promise.all(updates)
}

async function deleteCoupon(stripe, body) {
  const couponId = cleanText(body.couponId, 120)
  const promotionCodeId = cleanText(body.promotionCodeId, 120)

  if (!couponId && !promotionCodeId) {
    throw publicError('Coupon is required')
  }

  let resolvedCouponId = couponId

  if (promotionCodeId) {
    const promotionCode = await stripe.promotionCodes.retrieve(promotionCodeId)
    const promotionCoupon = promotionCode.promotion?.coupon ?? promotionCode.coupon
    resolvedCouponId = resolvedCouponId || (typeof promotionCoupon === 'string' ? promotionCoupon : promotionCoupon?.id)

    await stripe.promotionCodes.update(promotionCodeId, {
      active: false,
      metadata: {
        show_live: 'false',
      },
    })
  }

  if (!resolvedCouponId) {
    throw publicError('Coupon was not found', 404)
  }

  await stripe.coupons.del(resolvedCouponId)

  return {
    couponId: resolvedCouponId,
    promotionCodeId,
  }
}

export async function handler(event) {
  try {
    const admin = await getPlatformAdmin(event)
    const stripe = createStripeServerClient()

    if (event.httpMethod === 'GET') {
      const coupons = await listCoupons(stripe)
      return json(200, { success: true, coupons })
    }

    if (arePaymentsDisabled()) {
      return json(403, { success: false, message: 'Payments are disabled in this test environment' })
    }

    if (event.httpMethod === 'POST') {
      const body = JSON.parse(event.body || '{}')
      const created = await createCoupon(stripe, body)

      await supabaseAdmin.from('audit_logs').insert({
        actor_id: admin.id,
        actor_email: admin.email,
        actor_role: admin.role,
        actor_role_rank: 100,
        action: 'billing_coupon_created',
        entity_type: 'billing_coupon',
        entity_id: created.coupon.id,
        metadata: {
          couponName: created.coupon.name,
          code: created.promotionCode.code,
          percentOff: created.coupon.percent_off,
          amountOff: created.coupon.amount_off,
          duration: created.coupon.duration,
          redeemBy: created.coupon.redeem_by,
          expiresAt: created.promotionCode.expires_at,
          firstTimeOnly: Boolean(created.promotionCode.restrictions?.first_time_transaction),
        },
      })

      const coupons = await listCoupons(stripe)
      return json(200, { success: true, coupons })
    }

    if (event.httpMethod === 'PATCH') {
      const body = JSON.parse(event.body || '{}')
      await setLivePromotion(stripe, body)

      await supabaseAdmin.from('audit_logs').insert({
        actor_id: admin.id,
        actor_email: admin.email,
        actor_role: admin.role,
        actor_role_rank: 100,
        action: 'billing_live_promotion_updated',
        entity_type: 'billing_promotion_code',
        entity_id: cleanText(body.promotionCodeId, 120) || null,
        metadata: {
          promotionCodeId: cleanText(body.promotionCodeId, 120),
          showLive: Boolean(body.showLive),
        },
      })

      const coupons = await listCoupons(stripe)
      return json(200, { success: true, coupons })
    }

    if (event.httpMethod === 'DELETE') {
      const body = JSON.parse(event.body || '{}')
      const deleted = await deleteCoupon(stripe, body)

      await supabaseAdmin.from('audit_logs').insert({
        actor_id: admin.id,
        actor_email: admin.email,
        actor_role: admin.role,
        actor_role_rank: 100,
        action: 'billing_coupon_deleted',
        entity_type: 'billing_coupon',
        entity_id: deleted.couponId,
        metadata: {
          couponId: deleted.couponId,
          promotionCodeId: deleted.promotionCodeId,
        },
      })

      const coupons = await listCoupons(stripe)
      return json(200, { success: true, coupons })
    }

    return json(405, { success: false, message: 'Method not allowed' })
  } catch (error) {
    if (error?.exposeMessage) {
      return json(Number(error.statusCode ?? 400), {
        success: false,
        message: error.message,
      })
    }

    if (isStripeProviderError(error)) {
      logStripeFailure('Stripe coupon request failed', error)
    } else {
      console.error('Coupon request failed', {
        code: String(error?.code ?? '').slice(0, 80) || 'unknown',
        statusCode: Number(error?.statusCode ?? 0) || null,
      })
    }

    return json(503, {
      success: false,
      message: event.httpMethod === 'GET'
        ? 'Stripe coupon data is temporarily unavailable.'
        : 'Stripe coupon action could not be completed.',
    })
  }
}
