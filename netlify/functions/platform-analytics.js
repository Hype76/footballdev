import { createSupabaseAdminClient } from './lib/_supabase.js'
import { createPlatformAnalyticsHandler } from './lib/_platform-analytics.js'

export async function handler(event) {
  const supabaseAdmin = createSupabaseAdminClient(event)
  return createPlatformAnalyticsHandler({ supabaseAdmin })(event)
}
