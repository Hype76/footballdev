import { createClient } from '@supabase/supabase-js'
import { getMobileRuntimeConfig } from './config'
import { createMobileSessionStorage, getMobileSupabaseAuthStorageKey } from './sessionStorage'

const config = getMobileRuntimeConfig('shared')
export const mobileSessionStorage = createMobileSessionStorage(config)
export const mobileSessionStorageError = mobileSessionStorage.initializationError || ''
export const mobileSupabaseAuthStorageKey = getMobileSupabaseAuthStorageKey(config)

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
      storageKey: mobileSupabaseAuthStorageKey || 'blocked-mobile-auth-token',
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
