import process from 'node:process'
import { supabaseAdmin } from './lib/_supabase.js'
import { loadActiveAuthorityProfile } from './lib/_authority-profile.js'
import { assertWorkspaceBillingAction, BILLING_ACTION_CATEGORIES } from './lib/_billing-access.js'
import { createCoachWebHandoffHandler } from './lib/_coach-web-handoff.js'

export const handler = createCoachWebHandoffHandler({
  client: supabaseAdmin,
  loadProfile: loadActiveAuthorityProfile,
  assertUpgrade: args => assertWorkspaceBillingAction({ ...args, actionCategory: BILLING_ACTION_CATEGORIES.billing }),
  secret: process.env.SUPABASE_SERVICE_ROLE_KEY,
  clientIp: (event, context) => String(context?.ip || context?.clientIp || (process.env.NETLIFY === 'true' ? event.headers?.['x-nf-client-connection-ip'] : '') || 'unknown'),
})
