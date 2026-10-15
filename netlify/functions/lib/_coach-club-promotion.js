import { normalizeCoachClubCode } from '../../../src/lib/coach-club-promotion.js'
import { isDeepStrictEqual } from 'node:util'

export const COACH_CLUB_COUPON_ID = 'fp_coach_club_50_first_3_months_v1'
const fail = (message, statusCode = 400) => Object.assign(new Error(message), { statusCode, exposeMessage: true })
const row = result => Array.isArray(result.data) ? result.data[0] : result.data

export function assertCoachClubPromotionSelection(body, planKey, billingCycle) {
  const code = normalizeCoachClubCode(body.referralCode)
  if (!/^FP-[A-F0-9]{16}$/.test(code)) throw fail('Enter a valid Coach promotion code.')
  if (planKey !== 'club' || billingCycle !== 'monthly') throw fail('Coach codes apply to monthly Club subscriptions only.')
  if (body.livePromotionCodeId || body.promotionCode || body.discounts || body.coupon) throw fail('Coach codes cannot be combined with other discounts.')
  return code
}

export async function ensureCoachClubCoupon(stripe) {
  let coupon
  try { coupon = await stripe.coupons.retrieve(COACH_CLUB_COUPON_ID) }
  catch (error) {
    if (error.code !== 'resource_missing') throw error
    coupon = await stripe.coupons.create({ id: COACH_CLUB_COUPON_ID, name: 'Coach referral: 50% off 3 months',
      percent_off: 50, duration: 'repeating', duration_in_months: 3,
      metadata: { purpose: 'coach_club_referral', version: '1' } }, { idempotencyKey: COACH_CLUB_COUPON_ID })
  }
  if (!coupon?.valid || coupon.percent_off !== 50 || coupon.duration !== 'repeating' || coupon.duration_in_months !== 3
    || coupon.amount_off || coupon.applies_to?.products?.length || coupon.metadata?.purpose !== 'coach_club_referral') {
    throw fail('The Coach offer is temporarily unavailable. Please try again later.', 503)
  }
  return coupon.id
}

async function findUnboundCheckout(stripe, reservation) {
  let after
  for (let page = 0; page < 5; page++) {
    const result = await stripe.checkout.sessions.list({ limit: 100,
      created: { gte: Math.floor(Date.parse(reservation.created_at) / 1000), lte: Math.ceil(Date.parse(reservation.checkout_expires_at) / 1000) },
      ...(after ? { starting_after: after } : {}) })
    const match = result.data.find(session => session.metadata?.workspaceCheckoutReservation === reservation.reservation_id)
    if (match) return match
    if (!result.has_more) return null
    after = result.data.at(-1)?.id
    if (!after) break
  }
  throw fail('The previous checkout could not be checked safely. Please try again later.', 503)
}

export async function startCoachClubPromotionCheckout({ db, stripe, caller, workspace, code = '', selection, createSession }) {
  if (code && workspace.stripe_customer_id) {
    const [customer, subscriptions] = await Promise.all([
      stripe.customers.retrieve(workspace.stripe_customer_id),
      stripe.subscriptions.list({ customer: workspace.stripe_customer_id, status: 'all', limit: 1 }),
    ])
    if (customer.deleted || subscriptions.data?.length) throw fail('This offer is for new paid clubs only.', 409)
    if (customer.discount || customer.discounts?.length) throw fail('Coach codes cannot be combined with other discounts.', 409)
  }
  const reserve = async previous => {
    const result = await db.rpc('reserve_coach_club_promotion', { p_actor: caller.id, p_club: workspace.id, p_code: code || null, p_selection: selection, p_previous: previous || null })
    if (result.error) throw result.error.code === 'P0001' ? fail(result.error.message, 409) : fail('The Coach offer could not be checked. Please try again.', 503)
    if (!row(result)?.reservation_id) throw fail('The Coach offer could not be reserved.', 503)
    return row(result)
  }
  let reservation = await reserve()
  if (!reservation.checkout_session_id && Date.parse(reservation.checkout_expires_at) <= Date.now()) {
    // A lost provider response must be reconciled before changing its frozen selection.
    // The fixed expiry also prevents a late request from creating the old checkout.
    const recovered = await findUnboundCheckout(stripe, reservation)
    if (recovered && recovered.status !== 'expired') throw fail('The previous checkout is still open or has completed. Please resume it or check Plan access.', 409)
    reservation = await reserve(reservation.reservation_id)
  }
  if (reservation.checkout_session_id) {
    const existing = await stripe.checkout.sessions.retrieve(reservation.checkout_session_id)
    if (existing.status === 'expired') reservation = await reserve(reservation.reservation_id)
    else if (existing.status === 'open' && (reservation.code || '') === code && isDeepStrictEqual(reservation.selection, selection)) return existing
    else throw fail(existing.status === 'complete' ? 'This club has already started its paid subscription.' : 'A checkout is already open for this club. Finish it or wait for it to expire before changing the offer.', 409)
  }
  if ((reservation.code || '') !== code || !isDeepStrictEqual(reservation.selection, selection)) {
    throw fail('A different checkout is being prepared for this club. Please try again shortly.', 409)
  }
  const couponId = code ? await ensureCoachClubCoupon(stripe) : ''
  const session = await createSession({ couponId, reservationId: reservation.reservation_id,
    idempotencyKey: `coach-club-${reservation.reservation_id}`, expiresAt: Math.floor(Date.parse(reservation.checkout_expires_at) / 1000) })
  const saved = await db.from('coach_club_promotion_redemptions')
    .update({ checkout_session_id: session.id, checkout_expires_at: new Date(session.expires_at * 1000).toISOString() })
    .eq('club_id', workspace.id).eq('reservation_id', reservation.reservation_id).select('reservation_id').single()
  if (saved.error || !saved.data) throw fail('Checkout was prepared but could not be saved. Please try again.', 503)
  return session
}
