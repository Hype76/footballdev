import process from 'node:process'
import Stripe from 'stripe'
import { loadActiveAuthorityProfile } from './lib/_authority-profile.js'
import { supabaseAdmin } from './lib/_supabase.js'
import { json } from './lib/_stripe-billing.js'

function formatInvoice(invoice) {
  return {
    id: invoice.id,
    number: invoice.number || invoice.id,
    status: invoice.status || 'unknown',
    amountDue: Number(invoice.amount_due ?? 0),
    amountPaid: Number(invoice.amount_paid ?? 0),
    currency: String(invoice.currency ?? 'gbp').toUpperCase(),
    hostedInvoiceUrl: invoice.hosted_invoice_url || '',
    invoicePdf: invoice.invoice_pdf || '',
    createdAt: invoice.created ? new Date(invoice.created * 1000).toISOString() : '',
    dueDate: invoice.due_date ? new Date(invoice.due_date * 1000).toISOString() : '',
  }
}

async function getCaller(event) {
  const authHeader = event.headers.authorization || event.headers.Authorization || ''
  const token = authHeader.startsWith('Bearer ') ? authHeader.slice(7) : ''

  if (!token) {
    throw new Error('Login required')
  }

  const { data, error } = await supabaseAdmin.auth.getUser(token)

  if (error || !data?.user) {
    throw new Error('Login required')
  }

  return loadActiveAuthorityProfile(supabaseAdmin, data.user, {
    select: 'id, email, role, role_rank, club_id, status',
  })
}

export async function handler(event) {
  if (event.httpMethod !== 'GET') {
    return json(405, { success: false, message: 'Method not allowed' })
  }

  if (!process.env.STRIPE_SECRET_KEY) {
    return json(500, { success: false, message: 'Billing is not configured yet' })
  }

  try {
    const caller = await getCaller(event)

    const requestedClubId = String(event.queryStringParameters?.clubId || '').trim()
    const clubId = caller.role === 'super_admin' ? requestedClubId : caller.club_id

    if (!clubId) {
      return json(400, { success: false, message: 'Club ID is required' })
    }

    const { data: club, error: clubError } = await supabaseAdmin
      .from('clubs')
      .select('id, name, plan_key, plan_status, is_plan_comped, stripe_customer_id, stripe_subscription_id, stripe_price_id, current_period_end, plan_updated_at, tester_access_expires_at')
      .eq('id', clubId)
      .single()

    if (clubError || !club) {
      return json(404, { success: false, message: 'Club billing record not found' })
    }

    const callerRank = Number(caller.role_rank ?? 0)
    const canAccessBilling = caller.role === 'super_admin' || callerRank >= 90

    if (!canAccessBilling) {
      return json(403, { success: false, message: 'Billing is only available to Club Admin users.' })
    }

    let invoices = []

    if (club.stripe_customer_id) {
      const stripe = new Stripe(process.env.STRIPE_SECRET_KEY, {
        apiVersion: '2026-02-25.clover',
      })
      const invoiceResult = await stripe.invoices.list({
        customer: club.stripe_customer_id,
        limit: 12,
      })

      invoices = invoiceResult.data.map(formatInvoice)
    }

    return json(200, {
      success: true,
      billing: {
        club: {
          id: club.id,
          name: club.name,
          planKey: club.plan_key,
          planStatus: club.plan_status,
          isPlanComped: Boolean(club.is_plan_comped),
          stripeCustomerId: club.stripe_customer_id || '',
          stripeSubscriptionId: club.stripe_subscription_id || '',
          stripePriceId: club.stripe_price_id || '',
          currentPeriodEnd: club.current_period_end || '',
          planUpdatedAt: club.plan_updated_at || '',
          testerAccessExpiresAt: club.tester_access_expires_at || '',
        },
        invoices,
      },
    })
  } catch (error) {
    console.error(error)
    return json(500, { success: false, message: 'Billing details could not be loaded' })
  }
}
