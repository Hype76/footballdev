import { createSupabaseAdminClient } from './_supabase.js'
import { sendSupportNotification } from './_support-notification.js'

const SUPPORT_REFERENCE = 'FPO-V1-SUPPORT-EMAIL-AUDIT-013'
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i

function jsonResponse(statusCode, payload) {
  return {
    statusCode,
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  }
}

function normalizeText(value, { maxLength = 4000 } = {}) {
  return String(value ?? '').trim().slice(0, maxLength)
}

function getBearerToken(event) {
  const header = event.headers.authorization || event.headers.Authorization || ''
  const [scheme, token] = String(header).split(' ')

  return scheme?.toLowerCase() === 'bearer' ? token : ''
}

function parseBody(event) {
  try {
    return JSON.parse(event.body || '{}')
  } catch {
    throw Object.assign(new Error('Request body must be valid JSON.'), {
      code: 'validation_error',
      statusCode: 400,
    })
  }
}

function requireUuid(value) {
  const normalizedValue = normalizeText(value, { maxLength: 80 })

  if (!UUID_PATTERN.test(normalizedValue)) {
    throw Object.assign(new Error('Feedback notification could not be sent.'), {
      code: 'invalid_feedback_id',
      statusCode: 400,
    })
  }

  return normalizedValue
}

function safeDiagnostic(error) {
  return {
    code: normalizeText(error?.code || error?.status || error?.statusCode),
    message: normalizeText(error?.message),
  }
}

async function getAuthenticatedProfile(event, supabaseAdmin) {
  const token = getBearerToken(event)

  if (!token) {
    throw Object.assign(new Error('Sign in before notifying support.'), {
      code: 'unauthenticated',
      statusCode: 401,
    })
  }

  const { data: authData, error: authError } = await supabaseAdmin.auth.getUser(token)

  if (authError || !authData?.user?.id) {
    throw Object.assign(new Error('Sign in before notifying support.'), {
      code: 'unauthenticated',
      statusCode: 401,
    })
  }

  const authUser = authData.user
  const authEmail = normalizeText(authUser.email, { maxLength: 320 }).toLowerCase()
  const { data: profile, error: profileError } = await supabaseAdmin
    .from('users')
    .select('id, email, username, name, display_name, role, role_label, role_rank, club_id')
    .or(`id.eq.${authUser.id},email.eq.${authEmail}`)
    .limit(1)
    .maybeSingle()

  if (profileError) {
    throw profileError
  }

  if (!profile?.id) {
    throw Object.assign(new Error('Signed-in user profile was not found.'), {
      code: 'profile_not_found',
      statusCode: 403,
    })
  }

  return {
    id: profile.id,
    email: normalizeText(profile.email || authEmail, { maxLength: 320 }).toLowerCase(),
    name: normalizeText(profile.display_name || profile.name || profile.username || profile.email || authEmail, { maxLength: 240 }),
    role: normalizeText(profile.role, { maxLength: 80 }),
    clubId: profile.club_id || null,
  }
}

function normalizeFeedbackRow(row) {
  const clubRow = Array.isArray(row.clubs) ? row.clubs[0] : row.clubs

  return {
    id: row.id,
    clubId: row.club_id ?? '',
    clubName: normalizeText(clubRow?.name, { maxLength: 240 }),
    createdBy: row.created_by ?? '',
    createdByName: normalizeText(row.created_by_name, { maxLength: 240 }),
    createdByEmail: normalizeText(row.created_by_email, { maxLength: 320 }).toLowerCase(),
    message: normalizeText(row.message),
    status: normalizeText(row.status || 'open', { maxLength: 80 }),
    createdAt: row.created_at ?? '',
  }
}

export async function platformFeedbackNotificationResult(event, {
  supabaseAdmin = createSupabaseAdminClient(event),
  supportNotificationSender = sendSupportNotification,
} = {}) {
  if (event.httpMethod !== 'POST') {
    return jsonResponse(405, { success: false, code: 'method_not_allowed', message: 'Method Not Allowed' })
  }

  let profile = null
  let feedbackId = ''

  try {
    const body = parseBody(event)
    feedbackId = requireUuid(body.feedbackId)
    profile = await getAuthenticatedProfile(event, supabaseAdmin)

    const { data, error } = await supabaseAdmin
      .from('platform_feedback')
      .select('id, club_id, created_by, created_by_name, created_by_email, message, status, created_at, clubs:club_id (name)')
      .eq('id', feedbackId)
      .maybeSingle()

    if (error) {
      throw error
    }

    if (!data?.id) {
      throw Object.assign(new Error('Feedback notification could not be sent.'), {
        code: 'feedback_not_found',
        statusCode: 404,
      })
    }

    const feedback = normalizeFeedbackRow(data)

    if (profile.role !== 'super_admin' && String(feedback.createdBy) !== String(profile.id)) {
      throw Object.assign(new Error('Feedback notification could not be sent.'), {
        code: 'forbidden',
        statusCode: 403,
      })
    }

    const notification = await supportNotificationSender({
      source: 'platform_feedback',
      reportId: feedback.id,
      type: 'feature_request',
      severity: 'medium',
      title: 'Platform feedback item',
      summary: feedback.message,
      route: '/platform-feedback',
      pageTitle: 'Platform Feedback',
      module: 'Platform feedback',
      phase: 'production',
      reporterId: feedback.createdBy,
      reporterName: feedback.createdByName || profile.name,
      reporterEmail: feedback.createdByEmail || profile.email,
      clubId: feedback.clubId,
      clubName: feedback.clubName,
      submittedAt: feedback.createdAt,
      adminReviewUrl: 'https://footballplayer.online/platform-feedback',
    })

    return jsonResponse(200, {
      success: true,
      notification,
    })
  } catch (error) {
    const statusCode = Number(error?.statusCode || error?.status || 500)
    const diagnostic = safeDiagnostic(error)
    console.error('platform_feedback_support_notification_failed', {
      reference: SUPPORT_REFERENCE,
      statusCode,
      code: error?.code || 'platform_feedback_notification_failed',
      actorId: profile?.id || undefined,
      feedbackId: feedbackId || undefined,
      message: diagnostic.message || undefined,
    })

    return jsonResponse(statusCode, {
      success: false,
      code: error?.code || 'platform_feedback_notification_failed',
      message: statusCode < 500 ? error.message : 'Feedback notification could not be sent.',
    })
  }
}

export async function handler(event) {
  return platformFeedbackNotificationResult(event)
}
