import AsyncStorage from '@react-native-async-storage/async-storage'
import { createClient } from '@supabase/supabase-js'
import { getMobileRuntimeConfig } from './config'

const config = getMobileRuntimeConfig('shared')

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
      storage: AsyncStorage,
    },
  },
)

export async function getAccessToken() {
  const { data } = await supabase.auth.getSession()
  return data?.session?.access_token || ''
}
