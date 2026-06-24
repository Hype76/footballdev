import process from 'node:process'
import { randomUUID } from 'node:crypto'
import { Resend } from 'resend'
import { createSupabaseAdminClient, isStagingRequest } from './_supabase.js'

const VALID_PLAN_KEYS = new Set(['individual', 'single_team', 'small_club', 'large_club'])
const VALID_BILLING_MODES = new Set(['paid', 'unpaid'])

function jsonResponse(statusCode, payload) {
  return {
    statusCode,
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  }
}

function failureResponse(statusCode, message) {
  return jsonResponse(statusCode, { success: false, message })
}

function normalizeEmail(value) {
  return String(value ?? '').trim().toLowerCase()
}

function normalizeText(value) {
  return String(value ?? '').trim()
}

function envValue(name) {
  return globalThis.Netlify?.env?.get?.(name) || process.env[name]
}

function normalizeHost(value) {
  return normalizeText(value)
    .toLowerCase()
    .replace(/^https?:\/\//, '')
    .replace(/\/.*$/, '')
    .replace(/:\d+$/, '')
}

function getRequestHost(event) {
  return normalizeHost(event.headers?.['x-forwarded-host'] || event.headers?.host)
}

function getConfiguredProductionHosts() {
  const hosts = new Set(['footballplayer.online'])

  for (const value of [
    envValue('URL'),
    envValue('VITE_APP_URL'),
    envValue('PRODUCTION_URL'),
  ]) {
    const host = normalizeHost(value)

    if (host) {
      hosts.add(host)
    }
  }

  return hosts
}

function isProductionHostRequest(event) {
  return getConfiguredProductionHosts().has(getRequestHost(event))
}

function hasEmailProviderConfig() {
  return Boolean(normalizeText(envValue('RESEND_API_KEY')))
}

function isValidEmail(value) {
  return /^[^\s@<>]+@[^\s@<>]+\.[^\s@<>]+$/.test(String(value ?? '').trim())
}

function getBearerToken(event) {
  const header = event.headers.authorization || event.headers.Authorization || ''
  return header.startsWith('Bearer ') ? header.slice(7) : ''
}

function getBaseUrl(event) {
  const host = normalizeText(event.headers?.['x-forwarded-host'] || event.headers?.host)
  const protocol = normalizeText(event.headers?.['x-forwarded-proto']) || 'https'

  if (host) {
    return `${protocol}://${host}`.replace(/\/$/, '')
  }

  return normalizeText(process.env.VITE_APP_URL || process.env.URL || 'https://footballplayer.online').replace(/\/$/, '')
}

function cleanHeaderPart(value, fallback) {
  const cleanedValue = String(value ?? '')
    .split('')
    .filter((character) => {
      const code = character.charCodeAt(0)
      return code >= 32 && code !== 127 && !'<>{}[]"\'`;\\'.includes(character)
    })
    .join('')
    .trim()

  return cleanedValue || fallback
}

function getPlanName(planKey) {
  const planNames = {
    individual: 'Individual',
    single_team: 'Single Team',
    small_club: 'Small Club',
    large_club: 'Large Club',
  }

  return planNames[planKey] || planNames.small_club
}

async function getPlatformAdminProfile(supabaseAdmin, event) {
  const token = getBearerToken(event)

  if (!token) {
    throw Object.assign(new Error('Platform admin login is required.'), { statusCode: 401, code: 'unauthenticated' })
  }

  const { data: authData, error: authError } = await supabaseAdmin.auth.getUser(token)

  if (authError || !authData?.user) {
    throw Object.assign(new Error('Platform admin login is required.'), { statusCode: 401, code: 'unauthenticated' })
  }

  const authUser = authData.user
  const authEmail = normalizeEmail(authUser.email)
  const { data: profile, error: profileError } = await supabaseAdmin
    .from('users')
    .select('id, email, username, name, role, role_label, role_rank')
    .or(`id.eq.${authUser.id},email.eq.${authEmail}`)
    .limit(1)
    .maybeSingle()

  if (profileError || profile?.role !== 'super_admin') {
    throw Object.assign(new Error('Only platform admins can create clubs.'), { statusCode: 403, code: 'forbidden' })
  }

  return {
    id: profile.id,
    email: normalizeEmail(profile.email || authEmail),
    name: normalizeText(profile.name || profile.username || authEmail),
    roleLabel: normalizeText(profile.role_label || 'Super Admin'),
    roleRank: Number(profile.role_rank ?? 100),
  }
}

async function sendOwnerInviteEmail({ baseUrl, billingMode, clubName, inviteToken, ownerEmail, planKey }) {
  if (!hasEmailProviderConfig()) {
    throw Object.assign(new Error('Club invite email is not configured.'), { statusCode: 500 })
  }

  const inviteUrl = `${baseUrl}/club-invite/${encodeURIComponent(inviteToken)}`
  const safeClubName = cleanHeaderPart(clubName, 'Football Player')
  const planName = getPlanName(planKey)
  const paymentLine = billingMode === 'paid'
    ? `Payment setup will be shown after the account details are confirmed. Plan: ${planName}.`
    : `Payment setup is hidden because this workspace has been marked as unpaid. Plan: ${planName}.`
  const html = `
    <div style="font-family:Arial,sans-serif;color:#101828;line-height:1.5">
      <h1 style="font-size:22px;margin:0 0 12px">Set up ${safeClubName}</h1>
      <p>A Football Player workspace has been created for your club.</p>
      <p>${paymentLine}</p>
      <p><a href="${inviteUrl}" style="display:inline-block;background:#047857;color:#ffffff;padding:12px 16px;border-radius:8px;text-decoration:none;font-weight:700">Create club admin account</a></p>
      <p>If the button does not work, open this link:</p>
      <p><a href="${inviteUrl}">${inviteUrl}</a></p>
      <p>This invite expires in 14 days.</p>
    </div>
  `

  const resend = new Resend(envValue('RESEND_API_KEY'))
  return resend.emails.send({
    from: `Football Player <feedback@footballplayer.online>`,
    to: [ownerEmail],
    subject: `Set up ${safeClubName} in Football Player`,
    html,
  })
}

function resolveInviteDeliveryPolicy(event) {
  const context = normalizeText(envValue('CONTEXT')).toLowerCase()
  const branch = normalizeText(envValue('BRANCH')).toLowerCase()
  const nodeEnv = normalizeText(envValue('NODE_ENV')).toLowerCase()
  const netlifyDev = normalizeText(envValue('NETLIFY_DEV')).toLowerCase()
  const useStagingPolicy = isStagingRequest(event)

  if (context === 'production') {
    return {
      status: 'send',
      label: 'production',
      reason: 'production_delivery_enabled',
      message: 'Production email delivery is enabled.',
    }
  }

  if (context === 'deploy-preview') {
    return {
      status: 'skip',
      label: 'deploy_preview',
      reason: 'preview_policy',
      message: 'Email delivery was skipped by preview policy.',
    }
  }

  if (context === 'branch-deploy' || branch.includes('staging') || useStagingPolicy) {
    return {
      status: 'skip',
      label: 'staging',
      reason: 'staging_policy',
      message: 'Email delivery was skipped by staging policy.',
    }
  }

  if (nodeEnv === 'test') {
    return {
      status: 'skip',
      label: 'test',
      reason: 'test_policy',
      message: 'Email delivery was skipped by test environment policy.',
    }
  }

  if (isProductionHostRequest(event)) {
    return {
      status: 'send',
      label: 'production',
      reason: 'production_delivery_enabled',
      message: 'Production email delivery is enabled.',
    }
  }

  if (netlifyDev === 'true' || getRequestHost(event) === 'localhost' || getRequestHost(event) === '127.0.0.1' || (nodeEnv && nodeEnv !== 'production')) {
    return {
      status: 'skip',
      label: 'local',
      reason: 'local_development_policy',
      message: 'Email delivery was skipped by local development policy.',
    }
  }

  return {
    status: 'error',
    label: 'unknown',
    reason: 'unknown_environment',
    message: 'Email delivery environment is not configured.',
  }
}

export async function createPlatformClubResult(event, {
  supabaseAdmin = createSupabaseAdminClient(event),
  sendOwnerInviteEmailImpl = sendOwnerInviteEmail,
} = {}) {
  if (event.httpMethod !== 'POST') {
    return failureResponse(405, 'Method Not Allowed')
  }

  try {
    const platformAdmin = await getPlatformAdminProfile(supabaseAdmin, event)
    const body = JSON.parse(event.body || '{}')
    const name = normalizeText(body.name)
    const contactEmail = normalizeEmail(body.contactEmail)
    const contactPhone = normalizeText(body.contactPhone)
    const ownerEmail = normalizeEmail(body.ownerEmail || body.contactEmail)
    const planKey = VALID_PLAN_KEYS.has(body.planKey) ? body.planKey : 'small_club'
    const billingMode = VALID_BILLING_MODES.has(body.billingMode) ? body.billingMode : 'paid'

    if (!name) {
      return failureResponse(400, 'Club name is required.')
    }

    if (!isValidEmail(ownerEmail)) {
      return failureResponse(400, 'Owner invite email is required.')
    }

    if (contactEmail && !isValidEmail(contactEmail)) {
      return failureResponse(400, 'Contact email must be a valid email address.')
    }

    if (billingMode === 'paid' && planKey === 'individual') {
      return failureResponse(400, 'Paid club setup needs a paid club plan.')
    }

    const deliveryPolicy = resolveInviteDeliveryPolicy(event)

    if (deliveryPolicy.status === 'error') {
      throw Object.assign(new Error(deliveryPolicy.message), { statusCode: 500, code: 'email_environment_error' })
    }

    const inviteToken = randomUUID()
    const now = new Date().toISOString()
    const { data: club, error: clubError } = await supabaseAdmin
      .from('clubs')
      .insert({
        name,
        contact_email: contactEmail || ownerEmail,
        contact_phone: contactPhone,
        plan_key: planKey,
        plan_status: billingMode === 'paid' ? 'past_due' : 'active',
        is_plan_comped: billingMode === 'unpaid',
        status: 'active',
        plan_updated_at: now,
      })
      .select('id, name, logo_url, contact_email, contact_phone, require_approval, status, suspended_at, plan_key, plan_status, is_plan_comped, stripe_customer_id, stripe_subscription_id, stripe_price_id, current_period_end, plan_updated_at, tester_access_code_id, tester_access_code, tester_access_email, tester_access_redeemed_at, tester_access_expires_at, onboarding_enabled, onboarding_completed_steps, onboarding_dismissed_at, onboarding_reset_at, created_at')
      .single()

    if (clubError || !club?.id) {
      throw clubError || new Error('Club could not be created.')
    }

    const { error: roleSeedError } = await supabaseAdmin.rpc('seed_default_club_roles', {
      target_club_id: club.id,
    })

    if (roleSeedError) {
      throw roleSeedError
    }

    const { data: invite, error: inviteError } = await supabaseAdmin
      .from('club_owner_invites')
      .insert({
        club_id: club.id,
        invited_email: ownerEmail,
        billing_mode: billingMode,
        plan_key: planKey,
        invite_token: inviteToken,
        created_by: platformAdmin.id,
      })
      .select('id, invite_token')
      .single()

    if (inviteError || !invite?.id) {
      throw inviteError || new Error('Club owner invite could not be created.')
    }

    const baseUrl = getBaseUrl(event)
    const inviteUrl = `${baseUrl}/club-invite/${encodeURIComponent(inviteToken)}`
    let deliveryStatus = deliveryPolicy.status === 'send' ? 'attempted' : 'skipped'
    let deliveryMessage = deliveryPolicy.message
    let deliveryReason = deliveryPolicy.reason
    let emailResponse = null
    let emailWarning = ''

    if (deliveryPolicy.status === 'send') {
      if (!hasEmailProviderConfig()) {
        deliveryStatus = 'configuration_error'
        deliveryReason = 'missing_email_configuration'
        deliveryMessage = 'Invite email could not be sent because production email is not configured. Use the manual invite link below and contact platform support.'
        emailWarning = deliveryMessage
      } else {
        try {
          emailResponse = await sendOwnerInviteEmailImpl({
            baseUrl,
            billingMode,
            clubName: name,
            inviteToken,
            ownerEmail,
            planKey,
          })
          deliveryStatus = 'accepted'
          deliveryReason = 'production_delivery_accepted'
          deliveryMessage = 'Invite email accepted for delivery.'

          await supabaseAdmin
            .from('club_owner_invites')
            .update({ invite_sent_at: new Date().toISOString() })
            .eq('id', invite.id)
        } catch (emailError) {
          console.error('Club invite email delivery failed', {
            statusCode: emailError?.statusCode || emailError?.status || 500,
            code: emailError?.code || 'email_send_failed',
          })
          deliveryStatus = 'failed'
          deliveryReason = emailError?.code || 'provider_rejected'
          deliveryMessage = 'Invite email could not be sent. Use the manual invite link below.'
          emailWarning = deliveryMessage
        }
      }
    }

    await supabaseAdmin
      .from('audit_logs')
      .insert({
        club_id: club.id,
        actor_id: platformAdmin.id,
        actor_name: platformAdmin.name,
        actor_email: platformAdmin.email,
        actor_role_label: platformAdmin.roleLabel,
        actor_role_rank: platformAdmin.roleRank,
        action: 'club_created',
        entity_type: 'club',
        entity_id: club.id,
        metadata: {
          clubName: club.name,
          ownerEmail,
          billingMode,
          planKey,
          inviteId: invite.id,
          inviteUrl,
          inviteEmailSent: deliveryStatus === 'accepted',
          inviteDeliveryStatus: deliveryStatus,
          inviteDeliveryPolicy: deliveryPolicy.label,
          inviteDeliveryReason: deliveryReason,
          emailId: emailResponse?.data?.id || emailResponse?.id || '',
        },
      })

    return jsonResponse(200, {
      success: true,
      club,
      invite: {
        id: invite.id,
        email: ownerEmail,
        billingMode,
        planKey,
        sent: deliveryStatus === 'accepted',
        emailFailed: deliveryStatus === 'failed' || deliveryStatus === 'configuration_error',
        deliveryAttempted: deliveryStatus === 'accepted' || deliveryStatus === 'failed',
        deliveryStatus,
        deliveryPolicy: deliveryPolicy.label,
        deliveryReason,
        deliveryMessage,
        url: inviteUrl,
      },
      warning: emailWarning,
    })
  } catch (error) {
    console.error('Platform club create failed', {
      code: error?.code || 'server_error',
      statusCode: error?.statusCode || 500,
      message: error?.statusCode ? error.message : 'Club could not be created and invited.',
    })
    return jsonResponse(error.statusCode || 500, {
      success: false,
      code: error.code || 'server_error',
      message: error.statusCode ? error.message : 'Club could not be created and invited.',
    })
  }
}

export async function handler(event) {
  return createPlatformClubResult(event)
}
