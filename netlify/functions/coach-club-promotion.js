import { loadActiveAuthorityProfile } from './lib/_authority-profile.js'
import { supabaseAdmin } from './lib/_supabase.js'
import { json } from './lib/_stripe-billing.js'
import { coachClubShareLink, COACH_CLUB_PROMOTION_TERMS } from '../../src/lib/coach-club-promotion.js'

export async function getCoachClubPromotion(db, event) {
  const token = String(event.headers?.authorization || event.headers?.Authorization || '').match(/^Bearer (.+)$/i)?.[1]
  if (!token) throw Object.assign(new Error('Sign in again to view your promotion code.'), { statusCode: 401 })
  const { data, error } = await db.auth.getUser(token)
  if (error || !data?.user?.email_confirmed_at) throw Object.assign(new Error('Confirm your account before sharing a code.'), { statusCode: 403 })
  const profile = await loadActiveAuthorityProfile(db, data.user)
  if (Number(profile.role_rank) < 20 || ['parent', 'player', 'fan', 'super_admin'].includes(profile.role)) {
    throw Object.assign(new Error('Active Coach access is required.'), { statusCode: 403 })
  }
  const result = await db.rpc('ensure_coach_club_promotion_code', { p_actor: data.user.id })
  if (result.error || !result.data) throw Object.assign(new Error('Your promotion code could not be loaded. Please try again.'), { statusCode: 503 })
  return { success: true, code: result.data, shareUrl: coachClubShareLink(result.data), terms: COACH_CLUB_PROMOTION_TERMS }
}

export async function handler(event) {
  if (event.httpMethod !== 'POST') return json(405, { success: false, message: 'Method not allowed' })
  try { return json(200, await getCoachClubPromotion(supabaseAdmin, event)) }
  catch (error) { return json(Number(error.statusCode || 500), { success: false, message: error.statusCode ? error.message : 'Your promotion code could not be loaded.' }) }
}
