import process from 'node:process'
import { createClient } from '@supabase/supabase-js'

function envValue(name) {
  return globalThis.Netlify?.env?.get?.(name) || process.env[name]
}

function normalizeText(value) {
  return String(value ?? '').trim()
}

export function isStagingRequest(event = {}) {
  const host = normalizeText(event.headers?.['x-forwarded-host'] || event.headers?.host).toLowerCase()
  const context = normalizeText(envValue('CONTEXT')).toLowerCase()
  const branch = normalizeText(envValue('BRANCH')).toLowerCase()

  return host.includes('staging.footballplayer.online')
    || host.includes('football-os-staging')
    || context === 'branch-deploy'
    || context === 'deploy-preview'
    || branch === 'staging'
    || branch.includes('staging')
}

export function resolveSupabaseEnvironment(event = {}, { publicOnly = false } = {}) {
  const useStaging = isStagingRequest(event)
  const supabaseUrl = useStaging
    ? envValue('STAGING_SUPABASE_URL') || envValue('VITE_SUPABASE_URL')
    : envValue('VITE_SUPABASE_URL')
  const publishableKey = useStaging
    ? envValue('STAGING_SUPABASE_PUBLISHABLE_KEY') || envValue('VITE_SUPABASE_PUBLISHABLE_KEY') || envValue('VITE_SUPABASE_ANON_KEY')
    : envValue('VITE_SUPABASE_PUBLISHABLE_KEY') || envValue('VITE_SUPABASE_ANON_KEY')
  const serviceRoleKey = useStaging
    ? envValue('STAGING_SUPABASE_SERVICE_ROLE_KEY') || envValue('SUPABASE_SERVICE_ROLE_KEY')
    : envValue('SUPABASE_SERVICE_ROLE_KEY')

  if (!supabaseUrl) {
    throw new Error('Missing required Supabase URL environment variable.')
  }

  if (publicOnly) {
    if (!publishableKey) {
      throw new Error('Missing required Supabase publishable key environment variable.')
    }

    return { supabaseUrl, publishableKey, useStaging }
  }

  if (!serviceRoleKey) {
    throw new Error('Missing required Supabase service role environment variable.')
  }

  return { supabaseUrl, serviceRoleKey, useStaging }
}

export function createSupabaseAdminClient(event = {}) {
  const { supabaseUrl, serviceRoleKey } = resolveSupabaseEnvironment(event)

  return createClient(supabaseUrl, serviceRoleKey, {
    auth: {
      persistSession: false,
      autoRefreshToken: false,
    },
  })
}

export function createPublicSupabaseClient(event = {}, options = {}) {
  const { supabaseUrl, publishableKey } = resolveSupabaseEnvironment(event, { publicOnly: true })

  return createClient(supabaseUrl, publishableKey, {
    auth: {
      persistSession: false,
      autoRefreshToken: false,
    },
    ...options,
  })
}

export const supabaseAdmin = createSupabaseAdminClient()
