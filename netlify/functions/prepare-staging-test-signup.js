import process from 'node:process'
import { createSupabaseAdminClient, resolveSupabaseEnvironment } from './lib/_supabase.js'
import { arePaymentsDisabled, json, normalizePlanKey } from './lib/_stripe-billing.js'

const STAGING_PROJECT_REF = 'llpufwzvgxyczxcjwupu'
const LIVE_PROJECT_REF = 'hvapkizujvsahvgspser'
const STAGING_SIGNUP_PLAN_KEYS = new Set(['individual', 'single_team', 'small_club', 'large_club'])
const STAGING_BRANCHES = new Set(['football-os-staging', 'staging', 'codex/football-club-os-staging-rebuild'])

function envValue(name) {
  return globalThis.Netlify?.env?.get?.(name) || process.env[name]
}

function normalizeText(value) {
  return String(value ?? '').trim()
}

function normalizeEmail(value) {
  return String(value ?? '').trim().toLowerCase()
}

function normalizeWords(value) {
  return String(value ?? '')
    .trim()
    .split(/\s+/)
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1).toLowerCase())
    .join(' ')
}

function getDisplayName(email) {
  const emailPrefix = normalizeEmail(email).split('@')[0]?.replace(/[._-]+/g, ' ') || ''
  return normalizeWords(emailPrefix) || 'Test User'
}

function getSupabaseProjectRef(supabaseUrl) {
  const match = String(supabaseUrl ?? '').match(/^https:\/\/([a-z0-9]+)\.supabase\.co/i)
  return match?.[1] || ''
}

export function getStagingTestModeDiagnostics(event = {}) {
  const environment = resolveSupabaseEnvironment(event)
  const supabaseUrl = String(environment.supabaseUrl ?? '')
  const supabaseRef = getSupabaseProjectRef(supabaseUrl)
  const host = normalizeText(event.headers?.['x-forwarded-host'] || event.headers?.host).toLowerCase()
  const context = normalizeText(envValue('CONTEXT')).toLowerCase()
  const branch = normalizeText(envValue('BRANCH')).toLowerCase()
  const paymentsDisabled = arePaymentsDisabled() || normalizeText(envValue('VITE_PAYMENTS_DISABLED')).toLowerCase() === 'true'
  const isProductionContext = context === 'production'
  const isMainBranch = branch === 'main'
  const isLiveSupabase = supabaseRef === LIVE_PROJECT_REF || supabaseUrl.includes(`${LIVE_PROJECT_REF}.supabase.co`)
  const isStagingSupabase = supabaseRef === STAGING_PROJECT_REF || supabaseUrl.includes(`${STAGING_PROJECT_REF}.supabase.co`)
  const hasStagingRuntimeEvidence = Boolean(
    environment.useStaging ||
      paymentsDisabled ||
      context === 'branch-deploy' ||
      context === 'deploy-preview' ||
      STAGING_BRANCHES.has(branch) ||
      branch.includes('staging') ||
      host.includes('football-os-staging') ||
      host.includes('staging.footballplayer.online'),
  )

  return {
    branch,
    context,
    host,
    paymentsDisabled,
    supabaseRef,
    useStaging: Boolean(environment.useStaging),
    isProductionContext,
    isMainBranch,
    isLiveSupabase,
    isStagingSupabase,
    hasStagingRuntimeEvidence,
    allowed: Boolean(
      isStagingSupabase &&
        hasStagingRuntimeEvidence &&
        !isLiveSupabase &&
        !isProductionContext &&
        !isMainBranch,
    ),
  }
}

function formatStagingDiagnostic(diagnostics) {
  const fields = {
    context: diagnostics.context || 'unset',
    branch: diagnostics.branch || 'unset',
    host: diagnostics.host || 'unset',
    supabaseRef: diagnostics.supabaseRef || 'unknown',
    paymentsDisabled: diagnostics.paymentsDisabled,
    useStaging: diagnostics.useStaging,
  }

  return Object.entries(fields)
    .map(([key, value]) => `${key}=${value}`)
    .join(', ')
}

function assertStagingTestEnvironment(event) {
  const diagnostics = getStagingTestModeDiagnostics(event)

  if (!diagnostics.allowed) {
    throw new Error(`Staging test signup is not available for this environment. ${formatStagingDiagnostic(diagnostics)}`)
  }
}

export async function handler(event) {
  if (event.httpMethod !== 'POST') {
    return json(405, { success: false, message: 'Method not allowed.' })
  }

  try {
    assertStagingTestEnvironment(event)

    const body = JSON.parse(event.body || '{}')
    const email = normalizeEmail(body.email)
    const password = String(body.password ?? '')
    const clubName = String(body.clubName ?? '').trim()
    const planKey = normalizePlanKey(body.planKey)

    if (!email || !password || !clubName || !STAGING_SIGNUP_PLAN_KEYS.has(planKey)) {
      return json(400, {
        success: false,
        message: 'Enter an email, password, club name, and valid test tier.',
      })
    }

    const supabaseAdmin = createSupabaseAdminClient(event)
    const displayName = getDisplayName(email)
    const { data, error } = await supabaseAdmin.auth.admin.createUser({
      email,
      password,
      email_confirm: true,
      user_metadata: {
        username: displayName,
        name: displayName,
        display_name: displayName,
        club_name: clubName,
        test_signup_plan_key: planKey,
        staging_test_signup: true,
      },
    })

    if (error) {
      const message = String(error.message ?? '').toLowerCase()

      if (message.includes('already') || message.includes('registered') || message.includes('exists')) {
        return json(409, {
          success: false,
          message: 'An account already exists for this email. Use a fresh staging test account or ask the platform admin for a new invite.',
        })
      }

      throw error
    }

    if (!data?.user?.id) {
      throw new Error('Staging test account could not be created.')
    }

    return json(200, {
      success: true,
      email,
      planKey,
      message: 'Staging tester access is ready. Continue into your test workspace.',
    })
  } catch (error) {
    console.error(error)
    return json(500, {
      success: false,
      message: error.message || 'Staging test signup could not be prepared.',
    })
  }
}
