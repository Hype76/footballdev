import { validateResolvedMobileEnvironment } from '../mobile-core/src/environmentBoundary.js'

const [appRole, buildProfile] = process.argv.slice(2)
const result = validateResolvedMobileEnvironment({
  allowLiveSupabase: process.env.EXPO_PUBLIC_ALLOW_LIVE_SUPABASE,
  apiBaseUrl: process.env.EXPO_PUBLIC_API_BASE_URL,
  appRole,
  buildProfile,
  easProjectId: process.env.EXPO_PUBLIC_EAS_PROJECT_ID,
  supabaseEnvironment: process.env.EXPO_PUBLIC_SUPABASE_ENV,
  supabasePublishableKey: process.env.EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY || process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY,
  supabaseUrl: process.env.EXPO_PUBLIC_SUPABASE_URL,
})

console.log(JSON.stringify(result))
if (!result.pass) process.exitCode = 1
