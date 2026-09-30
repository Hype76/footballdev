import { isDemoEmail } from '../demo.js'
import { supabase } from '../supabase-client.js'
import {
  assertBillingActionAllowed,
  BILLING_ACTION_CATEGORIES,
} from '../billing-access.js'
import { DEMO_MUTATION_ERROR_MESSAGE } from './core-constants.js'

export function isDemoAccountValue(account) {
  return Boolean(account?.isDemoAccount) || isDemoEmail(account?.email)
}

export async function isCurrentSessionDemoUser() {
  const { data, error } = await supabase.auth.getUser()

  if (error) {
    console.error(error)
    return false
  }

  return isDemoEmail(data?.user?.email)
}

export async function blockDemoMutation(account) {
  const hasDemoIdentity = Boolean(account?.isDemoAccount || account?.email)

  if (isDemoAccountValue(account) || (!hasDemoIdentity && await isCurrentSessionDemoUser())) {
    throw new Error(DEMO_MUTATION_ERROR_MESSAGE)
  }

  if (account) {
    assertBillingActionAllowed(account, BILLING_ACTION_CATEGORIES.staffMutation)
  }
}

export function blockDemoSignupProvisioning(authUser) {
  if (isDemoAccountValue(authUser)) {
    throw new Error(DEMO_MUTATION_ERROR_MESSAGE)
  }

  if (!authUser?.id || !authUser.email_confirmed_at) {
    throw new Error('Confirm your email and sign in before creating your workspace.')
  }
  // A new account has no workspace role or billing context yet. The signup
  // endpoint verifies the session and authorises the requested plan itself.
}
