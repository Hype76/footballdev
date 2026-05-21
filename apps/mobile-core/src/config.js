import Constants from 'expo-constants'

function normalize(value) {
  return String(value ?? '').trim()
}

export function getMobileRuntimeConfig(appRole) {
  const extra = Constants.expoConfig?.extra || Constants.manifest?.extra || {}
  const supabaseUrl = normalize(extra.supabaseUrl || process.env.EXPO_PUBLIC_SUPABASE_URL)
  const supabasePublishableKey = normalize(
    extra.supabasePublishableKey
      || process.env.EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY
      || process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY,
  )
  const supabaseEnvironment = normalize(extra.supabaseEnvironment || process.env.EXPO_PUBLIC_SUPABASE_ENV || 'test')
  const allowLiveSupabase = normalize(extra.allowLiveSupabase || process.env.EXPO_PUBLIC_ALLOW_LIVE_SUPABASE || 'false') === 'true'
  const apiBaseUrl = normalize(extra.apiBaseUrl || process.env.EXPO_PUBLIC_API_BASE_URL)
  const easProjectId = normalize(extra.easProjectId || process.env.EXPO_PUBLIC_EAS_PROJECT_ID)
  const isConfigured = Boolean(supabaseUrl && supabasePublishableKey)
  const isLiveBlocked = supabaseEnvironment === 'live' && !allowLiveSupabase
  const configError = isLiveBlocked
    ? 'This app build is not ready for access yet.'
    : !isConfigured
      ? 'This app build is missing its connection setup.'
      : ''

  return {
    apiBaseUrl,
    appRole,
    configError,
    easProjectId,
    isConfigured,
    isLiveBlocked,
    isUsable: isConfigured && !isLiveBlocked,
    supabaseEnvironment,
    supabasePublishableKey,
    supabaseUrl,
  }
}
