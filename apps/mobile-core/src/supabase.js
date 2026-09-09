import { createClient } from '@supabase/supabase-js'
import { getMobileRuntimeConfig } from './config'
import { createMobileSessionStorage, getMobileSupabaseAuthStorageKey } from './sessionStorage'
import { createBoundedMobileFetch } from './mobileFetchCore'

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
    global: { fetch: createBoundedMobileFetch((...args) => fetch(...args)) },
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

// Read only the device's validated secure session. getSession may renew an
// expired token and wait for the network before returning anything.
export async function readSavedMobileSession() {
  const value = await mobileSessionStorage.getItem(mobileSupabaseAuthStorageKey)
  if (!value) return null
  const session = JSON.parse(value)
  return session?.user?.id && session?.refresh_token ? session : null
}

export async function getAccessToken() {
  const { data } = await supabase.auth.getSession()
  return data?.session?.access_token || ''
}
