import { isDemoEmail } from '../demo.js'
import { supabase } from '../supabase-client.js'
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
}
