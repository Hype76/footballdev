import { createSupabaseAdminClient } from './lib/_supabase.js'
import { createFromAddress, sendEmail } from './lib/_email-provider.js'
import { createFanAccountHandler } from './lib/_fan-account.js'

export const handler = createFanAccountHandler({ createClient: createSupabaseAdminClient, createFromAddress, sendEmail })
