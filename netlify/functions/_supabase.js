import process from 'node:process'
import { createClient } from '@supabase/supabase-js'

if (!process.env.VITE_SUPABASE_URL) {
  throw new Error('Missing required environment variable: VITE_SUPABASE_URL')
}

if (!process.env.SUPABASE_SERVICE_ROLE_KEY) {
  throw new Error('Missing required environment variable: SUPABASE_SERVICE_ROLE_KEY')
}

export const supabaseAdmin = createClient(
  process.env.VITE_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY,
  {
    auth: {
      persistSession: false,
      autoRefreshToken: false,
    },
  },
)
