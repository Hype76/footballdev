import process from 'node:process'
import { loadActiveAuthorityProfile } from './lib/_authority-profile.js'
import { supabaseAdmin } from './lib/_supabase.js'
import { createBillingContext, loadBillingWorkspace } from './lib/_billing-access.js'
import { isBillingActionAllowed, BILLING_ACTION_CATEGORIES } from '../../src/lib/billing-access.js'
import { createStripeServerClient, logStripeFailure } from './lib/_stripe-runtime.js'

const RETURN_URL = 'https://footballplayer.online/billing'
const reply = (status, body) => new Response(JSON.stringify(body), {
  status,
  headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' },
})

async function authenticatedCaller(token) {
  const { data, error } = await supabaseAdmin.auth.getUser(token)
  if (error || !data?.user) throw Object.assign(new Error('Login required.'), { statusCode: 401 })
  return loadActiveAuthorityProfile(supabaseAdmin, data.user, {
    select: 'id, email, role, role_label, role_rank, club_id, status',
  })
}

export function createBillingPortalHandler({
  getCaller = authenticatedCaller,
  loadWorkspace = loadBillingWorkspace,
  createStripe = createStripeServerClient,
  environment = process.env,
  logFailure = logStripeFailure,
} = {}) {
  return async (request) => {
    if (request.method !== 'POST') return reply(405, { success: false, message: 'Method not allowed.' })
    let authorityResolved = false
    try {
      const authorization = request.headers.get('authorization') || ''
      const token = authorization.startsWith('Bearer ') ? authorization.slice(7).trim() : ''
      if (!token) return reply(401, { success: false, message: 'Login required.' })
      const text = await request.text()
      if (text.length > 2048) return reply(400, { success: false, message: 'Invalid billing request.' })
      let body
      try { body = JSON.parse(text || '{}') } catch { return reply(400, { success: false, message: 'Invalid billing request.' }) }
      if (!body || Array.isArray(body) || typeof body !== 'object' || Object.keys(body).length) {
        return reply(400, { success: false, message: 'Billing details are determined by your signed-in workspace.' })
      }
      const caller = await getCaller(token)
      if (caller.status !== 'active' || !caller.club_id || caller.role === 'super_admin') {
        return reply(403, { success: false, message: 'Only the active workspace billing owner can manage this subscription.' })
      }
      const workspace = await loadWorkspace(caller.club_id)
      authorityResolved = true
      if (!workspace || workspace.id !== caller.club_id || workspace.archived_at || workspace.status === 'archived') {
        return reply(403, { success: false, message: 'This workspace is not available for billing changes.' })
      }
      if (!workspace.workspace_owner_user_id || caller.id !== workspace.workspace_owner_user_id || !isBillingActionAllowed(createBillingContext(caller, workspace), BILLING_ACTION_CATEGORIES.billing)) {
        return reply(403, { success: false, message: 'Only the workspace billing owner can manage this subscription.' })
      }
      if (!/^cus_[A-Za-z0-9]+$/.test(workspace.stripe_customer_id || '') || !/^sub_[A-Za-z0-9]+$/.test(workspace.stripe_subscription_id || '')) {
        return reply(409, { success: false, message: 'This workspace does not have an online subscription to manage.' })
      }
      const configurationId = String(environment.STRIPE_BILLING_PORTAL_CONFIGURATION || '').trim()
      if (!/^bpc_[A-Za-z0-9]+$/.test(configurationId)) {
        return reply(503, { success: false, message: 'Subscription management is temporarily unavailable. Please contact support.' })
      }
      const stripe = createStripe()
      const configuration = await stripe.billingPortal.configurations.retrieve(configurationId)
      const cancellation = configuration?.features?.subscription_cancel
      const cancellationOnly = ['subscription_update', 'customer_update', 'payment_method_update', 'invoice_history'].every((feature) => configuration?.features?.[feature]?.enabled === false)
      if (!configuration?.active || !cancellation?.enabled || cancellation.mode !== 'at_period_end' || cancellation.proration_behavior !== 'none' || !cancellationOnly) {
        return reply(503, { success: false, message: 'Subscription management settings could not be verified. Please contact support.' })
      }
      const subscription = await stripe.subscriptions.retrieve(workspace.stripe_subscription_id)
      const customerId = typeof subscription.customer === 'string' ? subscription.customer : subscription.customer?.id
      if (customerId !== workspace.stripe_customer_id || typeof configuration.livemode !== 'boolean' || configuration.livemode !== subscription.livemode || !['active', 'trialing', 'past_due', 'unpaid'].includes(subscription.status)) {
        return reply(409, { success: false, message: 'The subscription does not match this workspace or is no longer active.' })
      }
      const session = await stripe.billingPortal.sessions.create({
        customer: workspace.stripe_customer_id,
        configuration: configurationId,
        return_url: RETURN_URL,
        locale: 'en-GB',
        flow_data: {
          type: 'subscription_cancel',
          subscription_cancel: { subscription: workspace.stripe_subscription_id },
          after_completion: { type: 'redirect', redirect: { return_url: RETURN_URL } },
        },
      })
      const url = new URL(session.url)
      if (url.protocol !== 'https:' || url.hostname !== 'billing.stripe.com') throw new Error('Unexpected billing portal address.')
      return reply(200, { success: true, url: session.url })
    } catch (error) {
      if (!authorityResolved && [401, 403].includes(error?.statusCode)) return reply(error.statusCode, { success: false, message: error.statusCode === 401 ? 'Login required.' : 'Workspace billing access is not available.' })
      logFailure('Billing portal request failed', error)
      return reply(502, { success: false, message: 'Subscription management could not be opened. Please try again or contact support.' })
    }
  }
}

export default createBillingPortalHandler()
