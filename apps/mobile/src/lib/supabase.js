import * as SecureStore from 'expo-secure-store'
import { createClient } from '@supabase/supabase-js'
import Constants from 'expo-constants'
import { Platform } from 'react-native'

const configExtra = Constants.expoConfig?.extra || Constants.manifest?.extra || {}
const supabaseUrl = process.env.EXPO_PUBLIC_SUPABASE_URL || configExtra.supabaseUrl || process.env.VITE_SUPABASE_URL || ''
const supabaseAnonKey =
  process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY ||
  process.env.EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY ||
  configExtra.supabasePublishableKey ||
  process.env.VITE_SUPABASE_ANON_KEY ||
  process.env.VITE_SUPABASE_PUBLISHABLE_KEY ||
  ''
const supabaseEnvironment = String(process.env.EXPO_PUBLIC_SUPABASE_ENV || configExtra.supabaseEnvironment || 'test').trim().toLowerCase()
const allowLiveSupabase =
  String(process.env.EXPO_PUBLIC_ALLOW_LIVE_SUPABASE || configExtra.allowLiveSupabase || '').trim().toLowerCase() === 'true'
const isLocalSupabase = /^https?:\/\/(localhost|127\.0\.0\.1|\[?::1\]?)(:|\/|$)/i.test(supabaseUrl)
const isLiveBlocked = supabaseEnvironment === 'live' && !allowLiveSupabase

if (isLiveBlocked) {
  throw new Error('Mobile app is configured for live Supabase, but live access is disabled. Set EXPO_PUBLIC_ALLOW_LIVE_SUPABASE=true only when live mobile access is approved.')
}

if (supabaseEnvironment !== 'live' && supabaseUrl && !isLocalSupabase && !allowLiveSupabase) {
  throw new Error('Mobile app is locked to test Supabase. Use a local/test Supabase URL, or explicitly approve live access later.')
}

const webStorage = {
  getItem: async (key) => globalThis.localStorage?.getItem(key) ?? null,
  setItem: async (key, value) => {
    globalThis.localStorage?.setItem(key, value)
  },
  removeItem: async (key) => {
    globalThis.localStorage?.removeItem(key)
  },
}

const nativeSecureStorage = {
  getItem: (key) => SecureStore.getItemAsync(key),
  setItem: (key, value) => SecureStore.setItemAsync(key, value),
  removeItem: (key) => SecureStore.deleteItemAsync(key),
}

const storage = Platform.OS === 'web' ? webStorage : nativeSecureStorage

export const isSupabaseConfigured = Boolean(supabaseUrl && supabaseAnonKey)
export const supabaseConfig = {
  environment: supabaseEnvironment,
  isLocal: isLocalSupabase,
}

export const supabase = createClient(supabaseUrl || 'https://placeholder.supabase.co', supabaseAnonKey || 'placeholder-anon-key', {
  auth: {
    autoRefreshToken: true,
    detectSessionInUrl: false,
    persistSession: true,
    storage,
  },
})
