import process from 'node:process'
import Stripe from 'stripe'
import { supabaseAdmin } from './_supabase.js'
import { json, normalizePlanStatus } from './_stripe-billing.js'
import { promoteClubBillPayerToAdmin, shouldPromoteBillPayer } from './_billing-role-promotion.js'

const VALID_PLAN_KEYS = ['individual', 'single_team', 'small_club', 'large_club']

function getBearerToken(event) {
  const header = event.headers.authorization || event.headers.Authorization || ''
  const [scheme, token] = String(header).split(' ')
  return scheme?.toLowerCase() === 'bearer' ? token : ''
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

async function setSubscriptionPause(subscriptionId, isPaused) {
  if (!subscriptionId || !process.env.STRIPE_SECRET_KEY) {
    return {
      changed: false,
      message: subscriptionId ? 'Billing provider is not configured' : 'No subscription linked',
    }
  }

  const stripe = new Stripe(process.env.STRIPE_SECRET_KEY, {
    apiVersion: '2026-02-25.clover',
  })

  await stripe.subscriptions.update(subscriptionId, {
    pause_collection: isPaused ? { behavior: 'void' } : null,
  })

  return {
    changed: true,
    message: isPaused ? 'Subscription billing paused' : 'Subscription billing resumed',
  }
}

async function getLatestBillingCustomerEmail(clubId) {
  const { data, error } = await supabaseAdmin
    .from('stripe_checkout_records')
    .select('customer_email')
    .eq('club_id', clubId)
    .order('updated_at', { ascending: false })
    .limit(1)
    .maybeSingle()

  if (error) {
    throw error
  }

  return String(data?.customer_email ?? '').trim().toLowerCase()
}

export async function handler(event) {
  if (event.httpMethod !== 'POST') {
    return json(405, { success: false, message: 'Method not allowed' })
  }

  try {
    const admin = await getPlatformAdmin(event)
    const body = JSON.parse(event.body || '{}')
    const clubId = String(body.clubId ?? '').trim()

    if (!clubId) {
      return json(400, { success: false, message: 'Club is required' })
    }

    const { data: currentClub, error: clubError } = await supabaseAdmin
      .from('clubs')
      .select('id, name, plan_key, plan_status, is_plan_comped, stripe_subscription_id')
      .eq('id', clubId)
      .single()

    if (clubError) {
      throw clubError
    }

    const nextPlanKey = VALID_PLAN_KEYS.includes(body.planKey) ? body.planKey : currentClub.plan_key || 'small_club'
    const nextPlanStatus = normalizePlanStatus(body.planStatus || currentClub.plan_status || 'active')
    const nextIsPlanComped = Boolean(body.isPlanComped)
    const shouldChangePause = Boolean(currentClub.is_plan_comped) !== nextIsPlanComped
    const pauseResult = shouldChangePause
      ? await setSubscriptionPause(currentClub.stripe_subscription_id, nextIsPlanComped)
      : { changed: false, message: 'Billing pause state unchanged' }

    const now = new Date().toISOString()
    const { data: updatedClub, error: updateError } = await supabaseAdmin
      .from('clubs')
      .update({
        plan_key: nextPlanKey,
        plan_status: nextPlanStatus,
        is_plan_comped: nextIsPlanComped,
        plan_updated_at: now,
      })
      .eq('id', clubId)
      .select('id, name, plan_key, plan_status, is_plan_comped, stripe_subscription_id, current_period_end, plan_updated_at')
      .single()

    if (updateError) {
      throw updateError
    }

    let promotion = null

    if (shouldPromoteBillPayer(currentClub.plan_key, nextPlanKey)) {
      const customerEmail = await getLatestBillingCustomerEmail(clubId)
      promotion = await promoteClubBillPayerToAdmin(supabaseAdmin, {
        clubId,
        customerEmail,
        fallbackToHighestRole: true,
      })
    }

    await supabaseAdmin.from('audit_logs').insert({
      actor_id: admin.id,
      actor_email: admin.email,
      actor_role: admin.role,
      actor_role_rank: 100,
      club_id: clubId,
      action: 'club_billing_updated',
      entity_type: 'club',
      entity_id: clubId,
      metadata: {
        clubName: currentClub.name,
        planKey: nextPlanKey,
        planStatus: nextPlanStatus,
        isPlanComped: nextIsPlanComped,
        pauseResult,
        promotedUserId: promotion?.userId || null,
        promotedUserEmail: promotion?.email || null,
      },
    })

    return json(200, {
      success: true,
      message: pauseResult.message,
      club: {
        id: updatedClub.id,
        name: updatedClub.name,
        planKey: updatedClub.plan_key,
        planStatus: updatedClub.plan_status,
        isPlanComped: updatedClub.is_plan_comped,
        stripeSubscriptionId: updatedClub.stripe_subscription_id,
        currentPeriodEnd: updatedClub.current_period_end,
        planUpdatedAt: updatedClub.plan_updated_at,
      },
    })
  } catch (error) {
    console.error(error)
    return json(500, { success: false, message: error.message || 'Club billing could not be updated' })
  }
}
