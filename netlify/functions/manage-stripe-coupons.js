import process from 'node:process'
import Stripe from 'stripe'
import { supabaseAdmin } from './_supabase.js'
import { json } from './_stripe-billing.js'

function getBearerToken(event) {
  const header = event.headers.authorization || event.headers.Authorization || ''
  const [scheme, token] = String(header).split(' ')
  return scheme?.toLowerCase() === 'bearer' ? token : ''
}

function cleanText(value, maxLength = 120) {
  return String(value ?? '').replace(/[<>\r\n]/g, '').trim().slice(0, maxLength)
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
    throw new Error('End date must be in the future')
  }

  return timestamp
}

async function getPlatformAdmin(event) {
  const token = getBearerToken(event)

  if (!token) {
    throw new Error('Login is required')
  }

  const { data: authData, error: authError } = await supabaseAdmin.auth.getUser(token)

  if (authError || !authData?.user?.id) {
    throw new Error('Login is required')
  }

  const { data: profile, error: profileError } = await supabaseAdmin
    .from('users')
    .select('id, email, role')
    .eq('id', authData.user.id)
    .single()

  if (profileError) {
    throw profileError
  }

  if (profile.role !== 'super_admin') {
    throw new Error('Platform admin access is required')
  }

  return profile
}

function getStripe() {
  if (!process.env.STRIPE_SECRET_KEY) {
    throw new Error('Billing is not configured')
  }

  return new Stripe(process.env.STRIPE_SECRET_KEY, {
    apiVersion: '2026-02-25.clover',
  })
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
    if (couponId && !promotionCodeByCoupon.has(couponId)) {
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

  if (!name) {
    throw new Error('Coupon name is required')
  }

  if (!code) {
    throw new Error('Promotion code is required')
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
    throw new Error('Enter a percentage or fixed amount discount')
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

  const promotionCode = await stripe.promotionCodes.create(promotionCodePayload)

  return {
    coupon,
    promotionCode,
  }
}

export async function handler(event) {
  try {
    const admin = await getPlatformAdmin(event)
    const stripe = getStripe()

    if (event.httpMethod === 'GET') {
      const coupons = await listCoupons(stripe)
      return json(200, { success: true, coupons })
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
        },
      })

      const coupons = await listCoupons(stripe)
      return json(200, { success: true, coupons })
    }

    return json(405, { success: false, message: 'Method not allowed' })
  } catch (error) {
    console.error(error)
    return json(500, { success: false, message: error.message || 'Coupon action could not be completed' })
  }
}
