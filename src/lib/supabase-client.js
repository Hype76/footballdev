import { createClient } from '@supabase/supabase-js'

const fallbackSupabaseUrl = 'https://placeholder.supabase.co'
const fallbackSupabaseAnonKey = 'placeholder-anon-key'
const viteEnv = import.meta.env ?? {}
const runtimeEnv = globalThis.process?.env ?? {}

const supabaseUrl = viteEnv.VITE_SUPABASE_URL || runtimeEnv.VITE_SUPABASE_URL || fallbackSupabaseUrl
const supabaseAnonKey =
  viteEnv.VITE_SUPABASE_ANON_KEY ||
  viteEnv.VITE_SUPABASE_PUBLISHABLE_KEY ||
  runtimeEnv.VITE_SUPABASE_ANON_KEY ||
  runtimeEnv.VITE_SUPABASE_PUBLISHABLE_KEY ||
  fallbackSupabaseAnonKey

if (
  !supabaseUrl ||
  supabaseUrl === fallbackSupabaseUrl ||
  !supabaseAnonKey ||
  supabaseAnonKey === fallbackSupabaseAnonKey
) {
  console.error(
    'Supabase environment variables are missing. Configure VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY or VITE_SUPABASE_PUBLISHABLE_KEY.',
  )
}

export const supabase = createClient(supabaseUrl, supabaseAnonKey)
export const CLUB_LOGOS_BUCKET = 'club-logos'
export const MAX_LOGO_FILE_SIZE_BYTES = 2 * 1024 * 1024
export const EVALUATION_SECTIONS = ['Trial', 'Squad']
export const REQUEST_TIMEOUT_MS = 8000
