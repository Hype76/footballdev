import process from 'node:process'
import { Buffer } from 'node:buffer'
import { supabaseAdmin } from './lib/_supabase.js'
import {
  getPlanFromPriceId,
  getSubscriptionPeriodEnd,
  getSubscriptionPriceId,
  json,
  normalizePlanKey,
  normalizePlanStatus,
} from './lib/_stripe-billing.js'
import { createStripeServerClient, logStripeFailure } from './lib/_stripe-runtime.js'
import { promoteClubBillPayerToAdmin, shouldPromoteBillPayer } from './lib/_billing-role-promotion.js'
import { getWorkspaceScope } from '../../src/lib/workspace-scope.js'
import { resolveBillingAccess } from '../../src/lib/billing-access.js'

function getRawBody(event) {
  return event.isBase64Encoded
    ? Buffer.from(event.body || '', 'base64').toString('utf8')
    : event.body || ''
}

function getStringId(value) {
  return typeof value === 'string' ? value : value?.id || ''
}

async function markEventProcessed(event) {
  const { error } = await supabaseAdmin
    .from('stripe_webhook_events')
    .insert({
      id: event.id,
      event_type: event.type,
    })

  if (error?.code === '23505') {
    return false
  }

  if (error) {
    throw error
  }

  return true
}

async function updateClubFromBillingRecord(record, { preserveComped = false } = {}) {
  if (!record?.club_id) {
    return
  }

  const { data: currentClub, error: currentClubError } = await supabaseAdmin
    .from('clubs')
    .select('id, plan_key, plan_status, is_plan_comped, billing_arrangement, billing_start_at, archived_at')
    .eq('id', record.club_id)
    .maybeSingle()

  if (currentClubError) {
    throw currentClubError
  }

  if (currentClub?.archived_at) {
    return
  }

  const isPlanComped = preserveComped ? Boolean(currentClub?.is_plan_comped) : false
  const previousAccess = resolveBillingAccess({
    workspaceId: record.club_id,
    planKey: currentClub?.plan_key,
    planStatus: currentClub?.plan_status,
    isPlanComped: currentClub?.is_plan_comped,
    billingArrangement: currentClub?.billing_arrangement,
    billingStartAt: currentClub?.billing_start_at,
    archivedAt: currentClub?.archived_at,
  })

  const { error } = await supabaseAdmin
    .from('clubs')
    .update({
      plan_key: record.plan_key,
      plan_status: record.plan_status,
      is_plan_comped: isPlanComped,
      stripe_customer_id: record.stripe_customer_id || null,
      stripe_subscription_id: record.stripe_subscription_id || null,
      stripe_price_id: record.stripe_price_id || null,
      current_period_end: record.current_period_end || null,
      plan_updated_at: new Date().toISOString(),
    })
    .eq('id', record.club_id)

  if (error) {
    throw error
  }

  if (previousAccess.paymentRequired && ['active', 'trialing'].includes(record.plan_status)) {
    const stateKey = currentClub?.billing_start_at || 'legacy'
    await supabaseAdmin.from('billing_access_state_events').upsert({
      club_id: record.club_id,
      billing_start_at: currentClub?.billing_start_at || null,
      billing_state_key: stateKey,
      access_state: 'restored',
      last_observed_at: new Date().toISOString(),
    }, { onConflict: 'club_id,billing_state_key,access_state' })
    await supabaseAdmin.from('audit_logs').insert({
      club_id: record.club_id,
      action: 'billing_access_restored_by_stripe',
      entity_type: 'club',
      entity_id: record.club_id,
      event_category: 'billing',
      metadata: { planKey: record.plan_key, planStatus: record.plan_status },
    })
  }

  if (shouldPromoteBillPayer(currentClub?.plan_key, record.plan_key)) {
    await promoteClubBillPayerToAdmin(supabaseAdmin, {
      clubId: record.club_id,
      customerEmail: record.customer_email,
    })
  }
}

async function findExistingClubId(customerEmail) {
  const normalizedEmail = String(customerEmail ?? '').trim().toLowerCase()

  if (!normalizedEmail) {
    return ''
  }

  const { data, error } = await supabaseAdmin
    .from('users')
    .select('club_id')
    .ilike('email', normalizedEmail)
    .not('club_id', 'is', null)
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle()

  if (error) {
    throw error
  }

  return data?.club_id || ''
}

async function upsertCheckoutRecord({
  checkoutSession,
  subscription,
  priceId,
  planKey,
  billingCycle,
  planStatus,
  rawPayload,
}) {
  const customerEmail = String(
    checkoutSession.customer_details?.email ||
      checkoutSession.customer_email ||
      checkoutSession.metadata?.customerEmail ||
      '',
  ).trim().toLowerCase()

  if (!customerEmail) {
    throw new Error('Stripe checkout did not include a customer email')
  }

  const requestedClubId = String(checkoutSession.metadata?.clubId || '').trim()
  const isExistingWorkspace = String(checkoutSession.metadata?.existingWorkspace || '').trim() === 'true'
  let existingClubId = ''

  if (isExistingWorkspace) {
    if (!requestedClubId) throw new Error('Existing workspace checkout did not include a workspace ID')
    const { data: workspace, error: workspaceError } = await supabaseAdmin
      .from('clubs')
      .select('id, plan_key, archived_at')
      .eq('id', requestedClubId)
      .maybeSingle()
    if (workspaceError || !workspace) throw new Error('Existing workspace checkout referenced an unknown workspace')
    if (workspace.archived_at) throw new Error('Archived workspaces cannot be reactivated by payment')
    if (normalizePlanKey(workspace.plan_key) !== planKey) throw new Error('Existing workspace checkout plan did not match the workspace')
    if (getWorkspaceScope(workspace.plan_key).key !== String(checkoutSession.metadata?.workspaceScope || '')) {
      throw new Error('Existing workspace checkout scope did not match the workspace')
    }
    existingClubId = workspace.id
  } else {
    existingClubId = await findExistingClubId(customerEmail)
  }
  const recordPayload = {
    checkout_session_id: checkoutSession.id,
    customer_email: customerEmail,
    club_id: existingClubId || null,
    club_name: checkoutSession.metadata?.clubName || null,
    plan_key: planKey,
    plan_status: planStatus,
    billing_cycle: billingCycle || checkoutSession.metadata?.billingCycle || null,
    stripe_customer_id: getStringId(checkoutSession.customer),
    stripe_subscription_id: getStringId(checkoutSession.subscription),
    stripe_price_id: priceId || null,
    current_period_end: getSubscriptionPeriodEnd(subscription),
    raw_payload: rawPayload,
    updated_at: new Date().toISOString(),
  }

  if (existingClubId) {
    recordPayload.claimed_at = new Date().toISOString()
  }

  const { data, error } = await supabaseAdmin
    .from('stripe_checkout_records')
    .upsert(recordPayload, {
      onConflict: 'checkout_session_id',
    })
    .select('*')
    .single()

  if (error) {
    throw error
  }

  await updateClubFromBillingRecord(data)

  return data
}

async function handleCheckoutCompleted(stripe, checkoutSession, rawPayload) {
  const subscriptionId = getStringId(checkoutSession.subscription)
  const subscription = subscriptionId ? await stripe.subscriptions.retrieve(subscriptionId) : null
  const priceId = getSubscriptionPriceId(subscription)
  const pricePlan = getPlanFromPriceId(priceId)
  const metadataPlanKey = normalizePlanKey(checkoutSession.metadata?.planKey || checkoutSession.metadata?.planName)

  if (!priceId || !pricePlan.planKey) {
    throw new Error('Checkout price did not match a configured plan')
  }

  if (metadataPlanKey && metadataPlanKey !== pricePlan.planKey) {
    throw new Error('Checkout metadata plan does not match the configured Stripe price')
  }

  return upsertCheckoutRecord({
    checkoutSession,
    subscription,
    priceId,
    planKey: pricePlan.planKey,
    billingCycle: pricePlan.billingCycle || checkoutSession.metadata?.billingCycle || '',
    planStatus: normalizePlanStatus(subscription?.status || checkoutSession.status),
    rawPayload,
  })
}

async function updateSubscriptionRecord(subscription, rawPayload) {
  const subscriptionId = getStringId(subscription)
  const priceId = getSubscriptionPriceId(subscription)
  const pricePlan = getPlanFromPriceId(priceId)
  const planKey = pricePlan.planKey
  const planStatus = normalizePlanStatus(subscription.status)
  const currentPeriodEnd = getSubscriptionPeriodEnd(subscription)

  if (priceId && !planKey) {
    throw new Error('Subscription price did not match a configured plan')
  }

  const updatePayload = {
    plan_status: planStatus,
    stripe_subscription_id: subscriptionId,
    current_period_end: currentPeriodEnd,
    raw_payload: rawPayload,
    updated_at: new Date().toISOString(),
  }

  if (planKey) {
    updatePayload.plan_key = planKey
  }

  if (pricePlan.billingCycle) {
    updatePayload.billing_cycle = pricePlan.billingCycle
  }

  if (getStringId(subscription.customer)) {
    updatePayload.stripe_customer_id = getStringId(subscription.customer)
  }

  if (priceId) {
    updatePayload.stripe_price_id = priceId
  }

  const { data, error } = await supabaseAdmin
    .from('stripe_checkout_records')
    .update(updatePayload)
    .eq('stripe_subscription_id', subscriptionId)
    .select('*')
    .maybeSingle()

  if (error) {
    throw error
  }

  if (data) {
    await updateClubFromBillingRecord(data, { preserveComped: true })
  }
}

export async function handler(event) {
  if (event.httpMethod !== 'POST') {
    return json(405, { success: false, message: 'Method not allowed' })
  }

  if (!process.env.STRIPE_WEBHOOK_SECRET) {
    return json(500, { success: false, message: 'Stripe webhooks are not configured' })
  }

  let stripe

  try {
    stripe = createStripeServerClient()
  } catch (error) {
    logStripeFailure('Stripe webhook configuration failed', error)
    return json(500, { success: false, message: 'Stripe webhooks are not configured' })
  }

  let stripeEvent

  try {
    stripeEvent = stripe.webhooks.constructEvent(
      getRawBody(event),
      event.headers['stripe-signature'] || event.headers['Stripe-Signature'],
      process.env.STRIPE_WEBHOOK_SECRET,
    )
  } catch (error) {
    logStripeFailure('Stripe webhook signature failed', error)
    return json(400, { success: false, message: 'Invalid webhook signature' })
  }

  try {
    const shouldProcess = await markEventProcessed(stripeEvent)

    if (!shouldProcess) {
      return json(200, { success: true, skipped: true })
    }

    if (stripeEvent.type === 'checkout.session.completed') {
      await handleCheckoutCompleted(stripe, stripeEvent.data.object, stripeEvent)
    }

    if (
      stripeEvent.type === 'customer.subscription.updated' ||
      stripeEvent.type === 'customer.subscription.deleted'
    ) {
      await updateSubscriptionRecord(stripeEvent.data.object, stripeEvent)
    }

    return json(200, { success: true })
  } catch (error) {
    logStripeFailure('Stripe webhook processing failed', error)
    if (stripeEvent?.id) {
      await supabaseAdmin.from('stripe_webhook_events').delete().eq('id', stripeEvent.id)
    }
    return json(500, { success: false, message: 'Webhook could not be processed' })
  }
}
