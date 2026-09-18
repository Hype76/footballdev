import process from 'node:process'
import { loadActiveAuthorityProfile } from './lib/_authority-profile.js'
import { supabaseAdmin } from './lib/_supabase.js'
import { arePaymentsDisabled, getCheckoutLineItems, getCheckoutPriceId, isSelfServiceCheckoutPlanKey, json, validateCheckoutPrices } from './lib/_stripe-billing.js'
import { createStripeServerClient, logStripeFailure } from './lib/_stripe-runtime.js'
import { assertWorkspaceBillingAction, BILLING_ACTION_CATEGORIES } from './lib/_billing-access.js'
import { getPlanName } from '../../src/lib/plans.js'
import { getWorkspaceScope } from '../../src/lib/workspace-scope.js'

async function getCaller(event) {
  const header = event.headers.authorization || event.headers.Authorization || ''
  const token = header.startsWith('Bearer ') ? header.slice(7) : ''
  if (!token) throw Object.assign(new Error('Login required'), { statusCode: 401 })
  const { data, error } = await supabaseAdmin.auth.getUser(token)
  if (error || !data?.user) throw Object.assign(new Error('Login required'), { statusCode: 401 })
  return loadActiveAuthorityProfile(supabaseAdmin, data.user, {
    select: 'id, email, role, role_label, role_rank, club_id, status',
  })
}

export function createExistingWorkspaceCheckout(stripe, { appUrl, billingCycle, caller, priceId, lineItems, workspace, targetPlanKey, teamCapacity }) {
  const scope = getWorkspaceScope(workspace.plan_key)
  const targetScope = getWorkspaceScope(targetPlanKey || workspace.plan_key)
  const metadata = {
    existingWorkspace: 'true',
    clubId: workspace.id,
    planKey: targetPlanKey || workspace.plan_key,
    originalPlanKey: workspace.plan_key,
    planName: getPlanName({ planKey: targetPlanKey || workspace.plan_key }),
    billingCycle,
    clubName: workspace.name,
    workspaceScope: scope.key,
    sourceWorkspaceScope: scope.key,
    targetWorkspaceScope: targetScope.key,
    teamCapacity,
    billingOwnerUserId: caller.id,
  }
  return stripe.checkout.sessions.create({
    mode: 'subscription',
    line_items: lineItems || [{ price: priceId, quantity: 1 }],
    success_url: `${appUrl}/billing?checkout=success&session_id={CHECKOUT_SESSION_ID}`,
    cancel_url: `${appUrl}/billing?checkout=cancelled`,
    customer: workspace.stripe_customer_id || undefined,
    customer_email: workspace.stripe_customer_id ? undefined : caller.email,
    allow_promotion_codes: true,
    metadata,
    subscription_data: { metadata },
  })
}

export async function handler(event) {
  if (event.httpMethod !== 'POST') return json(405, { success: false, message: 'Method not allowed' })
  if (arePaymentsDisabled()) return json(403, { success: false, message: 'Payments are disabled in this test environment' })

  try {
    const caller = await getCaller(event)
    const body = JSON.parse(event.body || '{}')
    const billingCycle = String(body.billingCycle || 'monthly').trim().toLowerCase()
    const requestedPlanKey = String(body.planKey || '').trim().toLowerCase()
    if (!['monthly', 'annual'].includes(billingCycle)) return json(400, { success: false, message: 'Choose a valid billing cycle.' })

    const { workspace } = await assertWorkspaceBillingAction({
      actionCategory: BILLING_ACTION_CATEGORIES.billing,
      clubId: caller.club_id,
      profile: caller,
    })
    if (workspace.archived_at) return json(409, { success: false, message: 'Archived workspaces cannot be reactivated by payment.' })
    if (workspace.stripe_subscription_id) return json(409, { success: false, message: 'This workspace has an existing subscription; use the billing portal.' })
    if (requestedPlanKey && !['team', 'club'].includes(requestedPlanKey)) return json(400, { success: false, message: 'Modern checkout only supports Team or Club.' })
    const targetPlanKey = requestedPlanKey || workspace.plan_key
    if (!isSelfServiceCheckoutPlanKey(targetPlanKey)) return json(400, { success: false, message: 'This plan is not available for self-service checkout.' })
    const isModernPlan = ['team', 'club'].includes(targetPlanKey)
    const teamCapacity = isModernPlan ? (body.teamCapacity ?? (targetPlanKey === 'club' ? 10 : 1)) : undefined
    if (isModernPlan) {
      const { data: teamRows, error: teamCountError } = await supabaseAdmin.from('teams').select('id, status').eq('club_id', workspace.id)
      if (teamCountError) throw teamCountError
      const currentTeamCount = (teamRows ?? []).filter((team) => String(team.status ?? '').toLowerCase() !== 'archived').length
      if (Number(teamCapacity) < currentTeamCount) return json(409, { success: false, message: 'Selected capacity is below the workspace team count.' })
    }
    const priceId = isModernPlan ? '' : getCheckoutPriceId(targetPlanKey, billingCycle)
    const lineItems = isModernPlan ? getCheckoutLineItems(targetPlanKey, billingCycle, teamCapacity) : undefined
    if (!isModernPlan && !priceId) return json(400, { success: false, message: 'This plan is not available for checkout yet.' })

    const stripe = createStripeServerClient()
    if (isModernPlan) await validateCheckoutPrices(stripe, lineItems, targetPlanKey, billingCycle, teamCapacity)
    const appUrl = (process.env.VITE_APP_URL || process.env.URL || 'https://footballplayer.online').replace(/\/$/, '')
    const session = await createExistingWorkspaceCheckout(stripe, { appUrl, billingCycle, caller, priceId, lineItems, workspace, targetPlanKey, teamCapacity })
    await supabaseAdmin.from('audit_logs').insert({
      actor_id: caller.id,
      actor_email: caller.email,
      actor_role_label: caller.role_label || caller.role,
      actor_role_rank: caller.role_rank,
      club_id: workspace.id,
      action: 'billing_checkout_started',
      entity_type: 'club',
      entity_id: workspace.id,
      event_category: 'billing',
      metadata: { billingCycle, planKey: workspace.plan_key, workspaceScope: getWorkspaceScope(workspace.plan_key).key },
    })
    return json(200, { success: true, url: session.url })
  } catch (error) {
    logStripeFailure('Existing workspace checkout request failed', error)
    const statusCode = error instanceof RangeError ? 400 : Number(error.statusCode || 500)
    return json(statusCode, { success: false, message: error instanceof RangeError ? 'Invalid checkout selection.' : error.exposeMessage ? error.message : 'Checkout could not be started' })
  }
}
