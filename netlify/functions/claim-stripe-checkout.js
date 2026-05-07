import { supabaseAdmin } from './_supabase.js'
import { json } from './_stripe-billing.js'

function getBearerToken(event) {
  const header = event.headers.authorization || event.headers.Authorization || ''
  const [scheme, token] = String(header).split(' ')
  return scheme?.toLowerCase() === 'bearer' ? token : ''
}

async function getAuthenticatedProfile(event) {
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
    .select('id, email, club_id')
    .eq('id', authData.user.id)
    .maybeSingle()

  if (profileError) {
    throw profileError
  }

  if (!profile?.club_id) {
    throw new Error('Club account is required')
  }

  return profile
}

async function claimLatestCheckout(profile) {
  const normalizedEmail = String(profile.email ?? '').trim().toLowerCase()

  if (!normalizedEmail) {
    return null
  }

  const { data: checkoutRecord, error: checkoutError } = await supabaseAdmin
    .from('stripe_checkout_records')
    .select('*')
    .ilike('customer_email', normalizedEmail)
    .in('plan_status', ['active', 'trialing'])
    .or(`club_id.is.null,club_id.eq.${profile.club_id}`)
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle()

  if (checkoutError) {
    throw checkoutError
  }

  if (!checkoutRecord) {
    return null
  }

  const now = new Date().toISOString()
  const { data: claimedRecord, error: claimError } = await supabaseAdmin
    .from('stripe_checkout_records')
    .update({
      club_id: profile.club_id,
      claimed_at: checkoutRecord.claimed_at || now,
      updated_at: now,
    })
    .eq('id', checkoutRecord.id)
    .select('*')
    .single()

  if (claimError) {
    throw claimError
  }

  const { error: clubError } = await supabaseAdmin
    .from('clubs')
    .update({
      plan_key: claimedRecord.plan_key,
      plan_status: claimedRecord.plan_status,
      is_plan_comped: false,
      stripe_customer_id: claimedRecord.stripe_customer_id || null,
      stripe_subscription_id: claimedRecord.stripe_subscription_id || null,
      stripe_price_id: claimedRecord.stripe_price_id || null,
      current_period_end: claimedRecord.current_period_end || null,
      plan_updated_at: now,
    })
    .eq('id', profile.club_id)

  if (clubError) {
    throw clubError
  }

  return claimedRecord
}

export async function handler(event) {
  if (event.httpMethod !== 'POST') {
    return json(405, { success: false, message: 'Method not allowed' })
  }

  try {
    const profile = await getAuthenticatedProfile(event)
    const claimedRecord = await claimLatestCheckout(profile)

    if (!claimedRecord) {
      return json(200, { success: true, claimed: false })
    }

    return json(200, {
      success: true,
      claimed: true,
      club: {
        planKey: claimedRecord.plan_key,
        planStatus: claimedRecord.plan_status,
        isPlanComped: false,
      },
    })
  } catch (error) {
    console.error(error)
    return json(200, { success: false, claimed: false, message: 'Billing status could not be refreshed' })
  }
}
