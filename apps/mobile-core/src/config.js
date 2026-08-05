import Constants from 'expo-constants'
import { validateResolvedMobileEnvironment } from './environmentBoundary'

function normalize(value) {
  return String(value ?? '').trim()
}

export function getMobileRuntimeConfig(appRole) {
  const extra = Constants.expoConfig?.extra || Constants.manifest?.extra || {}
  const resolvedAppRole = normalize(extra.appRole || appRole).toLowerCase()
  const supabaseUrl = normalize(extra.supabaseUrl || process.env.EXPO_PUBLIC_SUPABASE_URL)
  const supabasePublishableKey = normalize(
    extra.supabasePublishableKey
      || process.env.EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY
      || process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY,
  )
  const supabaseEnvironment = normalize(extra.supabaseEnvironment || process.env.EXPO_PUBLIC_SUPABASE_ENV).toLowerCase()
  const allowLiveSupabaseValue = normalize(extra.allowLiveSupabase || process.env.EXPO_PUBLIC_ALLOW_LIVE_SUPABASE).toLowerCase()
  const apiBaseUrl = normalize(extra.apiBaseUrl || process.env.EXPO_PUBLIC_API_BASE_URL)
  const easProjectId = normalize(extra.easProjectId || process.env.EXPO_PUBLIC_EAS_PROJECT_ID)
  const buildProfile = normalize(extra.buildProfile || process.env.EXPO_PUBLIC_BUILD_PROFILE).toLowerCase()
  const boundary = validateResolvedMobileEnvironment({
    allowLiveSupabase: allowLiveSupabaseValue,
    apiBaseUrl,
    appRole: resolvedAppRole,
    buildProfile,
    easProjectId,
    supabaseEnvironment,
    supabasePublishableKey,
    supabaseUrl,
  })
  const isConfigured = boundary.pass
  const isLiveBlocked = boundary.reasonCodes.includes('forbidden_live_supabase') ||
    boundary.reasonCodes.includes('live_access_enabled') ||
    boundary.reasonCodes.includes('production_build_not_authorised')
  const configError = boundary.pass ? '' : 'This app build is not ready for access yet.'

  return {
    apiBaseUrl,
    appRole: resolvedAppRole,
    boundaryReasonCodes: boundary.reasonCodes,
    buildProfile,
    configError,
    easProjectId,
    isConfigured,
    isLiveBlocked,
    isUsable: boundary.pass,
    supabaseEnvironment,
    supabasePublishableKey,
    supabaseUrl,
  }
}
