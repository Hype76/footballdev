import { createSupabaseAdminClient } from './lib/_supabase.js'

const SUPPORT_REFERENCE = 'FPO-V1-FEEDBACK-UPLOAD-EMAIL-04'
const SIGNED_URL_EXPIRES_IN_SECONDS = 60
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
const ATTACHMENT_URL_ERROR_MESSAGE = 'Screenshot attachment could not be opened. Please try again.'

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

function httpError(code, message, statusCode = 500) {
  return Object.assign(new Error(message), { code, statusCode })
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
    throw httpError('validation_error', ATTACHMENT_URL_ERROR_MESSAGE, 400)
  }
}

function requireUuid(value) {
  const normalizedValue = normalizeText(value)

  if (!normalizedValue || !UUID_PATTERN.test(normalizedValue)) {
    throw httpError('invalid_report_id', ATTACHMENT_URL_ERROR_MESSAGE, 400)
  }

  return normalizedValue
}

async function getPlatformAdminProfile(event, supabaseAdmin) {
  const token = getBearerToken(event)

  if (!token) {
    throw httpError('unauthenticated', 'Sign in before opening issue report screenshots.', 401)
  }

  const { data: authData, error: authError } = await supabaseAdmin.auth.getUser(token)

  if (authError || !authData?.user?.id) {
    throw httpError('unauthenticated', 'Sign in before opening issue report screenshots.', 401)
  }

  const authUser = authData.user
  const authEmail = normalizeText(authUser.email, { maxLength: 320 }).toLowerCase()
  const { data: profile, error: profileError } = await supabaseAdmin
    .from('users')
    .select('id, email, role, role_label, role_rank')
    .or(`id.eq.${authUser.id},email.eq.${authEmail}`)
    .limit(1)
    .maybeSingle()

  if (profileError) {
    throw profileError
  }

  if (!profile?.id || profile.role !== 'super_admin') {
    throw httpError('forbidden', 'Only platform admins can open issue report screenshots.', 403)
  }

  return {
    id: profile.id,
    email: normalizeText(profile.email || authEmail, { maxLength: 320 }).toLowerCase(),
    role: normalizeText(profile.role, { maxLength: 80 }),
  }
}

function normalizeAttachment(row) {
  return {
    fileSize: Number(row.screenshot_file_size || 0),
    hasAttachment: Boolean(row.screenshot_storage_bucket && row.screenshot_storage_path),
    mimeType: normalizeText(row.screenshot_mime_type, { maxLength: 120 }),
    originalFilename: normalizeText(row.screenshot_original_filename, { maxLength: 240 }),
    uploadedAt: row.screenshot_uploaded_at ?? '',
  }
}

function safeDiagnostic(error) {
  return {
    code: normalizeText(error?.code || error?.status || error?.statusCode),
    details: normalizeText(error?.details),
    hint: normalizeText(error?.hint),
    message: normalizeText(error?.message),
  }
}

export async function platformFeedbackAttachmentUrlResult(event, {
  supabaseAdmin = createSupabaseAdminClient(event),
} = {}) {
  let actor = null
  let reportId = ''

  try {
    if (event.httpMethod !== 'POST') {
      return jsonResponse(405, { success: false, code: 'method_not_allowed', message: 'Method Not Allowed' })
    }

    const body = parseBody(event)
    reportId = requireUuid(body.reportId)
    actor = await getPlatformAdminProfile(event, supabaseAdmin)

    const { data: report, error } = await supabaseAdmin
      .from('tester_feedback_reports')
      .select('id, screenshot_storage_bucket, screenshot_storage_path, screenshot_original_filename, screenshot_mime_type, screenshot_file_size, screenshot_uploaded_at')
      .eq('id', reportId)
      .maybeSingle()

    if (error) {
      throw error
    }

    if (!report?.id) {
      throw httpError('report_not_found', ATTACHMENT_URL_ERROR_MESSAGE, 404)
    }

    if (!report.screenshot_storage_bucket || !report.screenshot_storage_path) {
      throw httpError('attachment_not_found', 'This issue report does not have a screenshot attachment.', 404)
    }

    const { data: signedUrlData, error: signedUrlError } = await supabaseAdmin.storage
      .from(report.screenshot_storage_bucket)
      .createSignedUrl(report.screenshot_storage_path, SIGNED_URL_EXPIRES_IN_SECONDS, {
        download: report.screenshot_original_filename || true,
      })

    if (signedUrlError || !signedUrlData?.signedUrl) {
      throw signedUrlError || httpError('signed_url_failed', ATTACHMENT_URL_ERROR_MESSAGE, 502)
    }

    return jsonResponse(200, {
      success: true,
      attachment: normalizeAttachment(report),
      expiresIn: SIGNED_URL_EXPIRES_IN_SECONDS,
      signedUrl: signedUrlData.signedUrl,
    })
  } catch (error) {
    const diagnostic = safeDiagnostic(error)
    const statusCode = Number(error?.statusCode || error?.status || 500)
    console.error('platform_feedback_attachment_url_failed', {
      actorId: actor?.id || undefined,
      code: error?.code || 'attachment_url_failed',
      message: diagnostic.message || undefined,
      reference: SUPPORT_REFERENCE,
      reportId: reportId || undefined,
      statusCode,
      supabaseCode: diagnostic.code || undefined,
      supabaseDetails: diagnostic.details || undefined,
      supabaseHint: diagnostic.hint || undefined,
    })

    return jsonResponse(statusCode, {
      success: false,
      code: error?.code || 'attachment_url_failed',
      message: error?.statusCode ? error.message : ATTACHMENT_URL_ERROR_MESSAGE,
    })
  }
}

export async function handler(event) {
  return platformFeedbackAttachmentUrlResult(event)
}
