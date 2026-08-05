import { createClient } from '@supabase/supabase-js'
import { getMobileRuntimeConfig } from './config'
import { createMobileSessionStorage, MOBILE_SUPABASE_AUTH_STORAGE_KEY } from './sessionStorage'

const config = getMobileRuntimeConfig('shared')
export const mobileSessionStorage = createMobileSessionStorage(config)

export const mobileConfigError = config.configError
export const isSupabaseConfigured = config.isUsable

export const supabase = createClient(
  config.isUsable ? config.supabaseUrl : 'https://placeholder.supabase.co',
  config.isUsable ? config.supabasePublishableKey : 'placeholder-key',
  {
    auth: {
      autoRefreshToken: true,
      detectSessionInUrl: false,
      persistSession: true,
      storage: mobileSessionStorage,
      storageKey: MOBILE_SUPABASE_AUTH_STORAGE_KEY,
    },
  },
)

export async function clearMobileSessionStorage() {
  await mobileSessionStorage.clearSessionStorage()
}

export async function getAccessToken() {
  const { data } = await supabase.auth.getSession()
  return data?.session?.access_token || ''
}
