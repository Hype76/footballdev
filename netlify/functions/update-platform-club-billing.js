import process from 'node:process'
import Stripe from 'stripe'
import { supabaseAdmin } from './lib/_supabase.js'
import { json, normalizePlanStatus } from './lib/_stripe-billing.js'
import { promoteClubBillPayerToAdmin, shouldPromoteBillPayer } from './lib/_billing-role-promotion.js'
import { getPlanDefaultLimit, getPlanLimit, normalizePlanKey, normalizeTeamLimitOverride } from '../../src/lib/plans.js'

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

function publicError(message, statusCode = 400) {
  return Object.assign(new Error(message), { statusCode, exposeMessage: true })
}

async function saveTeamLimitOverride({ clubId, value, updatedBy }) {
  let normalizedOverride = null

  try {
    normalizedOverride = normalizeTeamLimitOverride(value)
  } catch (error) {
    throw publicError(error.message, 400)
  }

  const now = new Date().toISOString()

  if (normalizedOverride === null) {
    const { error } = await supabaseAdmin
      .from('club_team_limit_overrides')
      .delete()
      .eq('club_id', clubId)

    if (error) {
      throw publicError('Team allowance could not be saved.', 500)
    }

    return {
      teamLimitOverride: null,
      teamLimitOverrideUpdatedAt: now,
    }
  }

  const { data, error } = await supabaseAdmin
    .from('club_team_limit_overrides')
    .upsert({
      club_id: clubId,
      team_limit_override: normalizedOverride,
      updated_by: updatedBy,
      updated_at: now,
    }, { onConflict: 'club_id' })
    .select('team_limit_override, updated_at')
    .single()

  if (error) {
    throw publicError('Team allowance could not be saved.', 500)
  }

  return {
    teamLimitOverride: data.team_limit_override,
    teamLimitOverrideUpdatedAt: data.updated_at,
  }
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
      .select('id, name, plan_key, plan_status, is_plan_comped, stripe_subscription_id, current_period_end, plan_updated_at')
      .eq('id', clubId)
      .single()

    if (clubError) {
      throw publicError('Club settings could not be loaded.', 500)
    }

    const hasRequestedPlanKey = Object.prototype.hasOwnProperty.call(body, 'planKey')
    const hasRequestedPlanStatus = Object.prototype.hasOwnProperty.call(body, 'planStatus')
    const hasRequestedIsPlanComped = Object.prototype.hasOwnProperty.call(body, 'isPlanComped')
    const hasRequestedTeamLimitOverride = Object.prototype.hasOwnProperty.call(body, 'teamLimitOverride')
    const nextPlanKey = hasRequestedPlanKey
      ? normalizePlanKey(body.planKey)
      : normalizePlanKey(currentClub.plan_key, { mapMissingToFree: true })

    if (!nextPlanKey) {
      return json(400, { success: false, message: 'Choose a valid billing plan.' })
    }

    const nextPlanStatus = hasRequestedPlanStatus
      ? normalizePlanStatus(body.planStatus || 'active')
      : normalizePlanStatus(currentClub.plan_status || 'active')
    const nextIsPlanComped = hasRequestedIsPlanComped ? Boolean(body.isPlanComped) : Boolean(currentClub.is_plan_comped)
    const shouldUpdateBilling = hasRequestedPlanKey || hasRequestedPlanStatus || hasRequestedIsPlanComped
    const shouldChangePause = shouldUpdateBilling && Boolean(currentClub.is_plan_comped) !== nextIsPlanComped
    const pauseResult = shouldChangePause
      ? await setSubscriptionPause(currentClub.stripe_subscription_id, nextIsPlanComped)
      : { changed: false, message: 'Billing pause state unchanged' }

    const now = new Date().toISOString()
    let updatedClub = {
      id: currentClub.id,
      name: currentClub.name,
      plan_key: currentClub.plan_key,
      plan_status: currentClub.plan_status,
      is_plan_comped: currentClub.is_plan_comped,
      stripe_subscription_id: currentClub.stripe_subscription_id,
      current_period_end: currentClub.current_period_end,
      plan_updated_at: currentClub.plan_updated_at,
    }

    if (shouldUpdateBilling) {
      const { data, error: updateError } = await supabaseAdmin
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
        throw publicError('Club billing could not be updated.', 500)
      }

      updatedClub = data
    }

    let promotion = null

    if (shouldUpdateBilling && shouldPromoteBillPayer(currentClub.plan_key, nextPlanKey)) {
      const customerEmail = await getLatestBillingCustomerEmail(clubId)
      promotion = await promoteClubBillPayerToAdmin(supabaseAdmin, {
        clubId,
        customerEmail,
        fallbackToHighestRole: true,
      })
    }

    let teamLimitOverrideResult = null

    if (hasRequestedTeamLimitOverride) {
      teamLimitOverrideResult = await saveTeamLimitOverride({
        clubId,
        value: body.teamLimitOverride,
        updatedBy: admin.id,
      })
    } else {
      const { data: existingOverride, error: existingOverrideError } = await supabaseAdmin
        .from('club_team_limit_overrides')
        .select('team_limit_override, updated_at')
        .eq('club_id', clubId)
        .maybeSingle()

      if (existingOverrideError) {
        throw publicError('Team allowance could not be loaded.', 500)
      }

      teamLimitOverrideResult = {
        teamLimitOverride: existingOverride?.team_limit_override ?? null,
        teamLimitOverrideUpdatedAt: existingOverride?.updated_at ?? '',
      }
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
        teamLimitOverride: teamLimitOverrideResult.teamLimitOverride,
        changedTeamLimitOverride: hasRequestedTeamLimitOverride,
        pauseResult,
        promotedUserId: promotion?.userId || null,
        promotedUserEmail: promotion?.email || null,
      },
    })

    const planProfile = {
      planKey: nextPlanKey,
      planStatus: nextPlanStatus,
      isPlanComped: nextIsPlanComped,
      teamLimitOverride: teamLimitOverrideResult.teamLimitOverride,
    }
    const responseMessage = hasRequestedTeamLimitOverride && !shouldUpdateBilling
      ? 'Club team allowance updated.'
      : pauseResult.message

    return json(200, {
      success: true,
      message: responseMessage,
      club: {
        id: updatedClub.id,
        name: updatedClub.name,
        planKey: updatedClub.plan_key,
        planStatus: updatedClub.plan_status,
        isPlanComped: updatedClub.is_plan_comped,
        teamLimitOverride: teamLimitOverrideResult.teamLimitOverride,
        teamLimitOverrideUpdatedAt: teamLimitOverrideResult.teamLimitOverrideUpdatedAt,
        planTeamLimit: getPlanDefaultLimit(planProfile, 'teams'),
        effectiveTeamLimit: getPlanLimit(planProfile, 'teams'),
        stripeSubscriptionId: updatedClub.stripe_subscription_id,
        currentPeriodEnd: updatedClub.current_period_end,
        planUpdatedAt: updatedClub.plan_updated_at,
      },
    })
  } catch (error) {
    console.error(error)
    const statusCode = Number(error.statusCode ?? 500)
    const message = error.exposeMessage && error.message
      ? error.message
      : 'Club settings could not be updated.'
    return json(statusCode, { success: false, message })
  }
}
