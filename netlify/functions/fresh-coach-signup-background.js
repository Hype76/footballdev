import { createSupabaseAdminClient } from './lib/_supabase.js'
import { createFreshSignupWorker } from './lib/_fresh-coach-signup.js'

export const handler = createFreshSignupWorker({ createAdminClient: createSupabaseAdminClient })
