import { createSupabaseAdminClient } from './lib/_supabase.js'

const SUPPORT_REFERENCE = 'FPO-V1-FEEDBACK-ADMIN-FIX-012'
const FEEDBACK_REPORTS_LOAD_MESSAGE = 'Issue reports could not be loaded. Please contact support with reference FPO-V1-FEEDBACK-ADMIN-FIX-012.'

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

function isSchemaOrTableError(error) {
  const code = normalizeText(error?.code).toLowerCase()
  const message = normalizeText(error?.message).toLowerCase()
  const details = normalizeText(error?.details).toLowerCase()

  return code === '42p01'
    || code === 'pgrst205'
    || code === 'pgrst204'
    || message.includes('schema cache')
    || message.includes('tester_feedback_reports')
    || details.includes('tester_feedback_reports')
}

function publicError(error) {
  if (error?.statusCode && error?.code) {
    return error
  }

  return Object.assign(new Error(FEEDBACK_REPORTS_LOAD_MESSAGE), {
    code: isSchemaOrTableError(error) ? 'feedback_reports_unavailable' : 'feedback_reports_load_failed',
    statusCode: isSchemaOrTableError(error) ? 503 : 500,
  })
}

function safeDiagnostic(error) {
  return {
    code: normalizeText(error?.code || error?.status || error?.statusCode),
    details: normalizeText(error?.details),
    hint: normalizeText(error?.hint),
    message: normalizeText(error?.message),
  }
}

async function getPlatformAdminProfile(event, supabaseAdmin) {
  const token = getBearerToken(event)

  if (!token) {
    throw Object.assign(new Error('Sign in before loading feedback reports.'), {
      code: 'unauthenticated',
      statusCode: 401,
    })
  }

  const { data: authData, error: authError } = await supabaseAdmin.auth.getUser(token)

  if (authError || !authData?.user?.id) {
    throw Object.assign(new Error('Sign in before loading feedback reports.'), {
      code: 'unauthenticated',
      statusCode: 401,
    })
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
    throw Object.assign(new Error('Only platform admins can load feedback reports.'), {
      code: 'forbidden',
      statusCode: 403,
    })
  }

  return {
    id: profile.id,
    email: normalizeText(profile.email || authEmail, { maxLength: 320 }).toLowerCase(),
    role: normalizeText(profile.role, { maxLength: 80 }),
  }
}

function normalizeFeedbackReport(row) {
  const clubRow = Array.isArray(row.clubs) ? row.clubs[0] : row.clubs
  const teamRow = Array.isArray(row.teams) ? row.teams[0] : row.teams

  return {
    id: row.id,
    createdAt: row.created_at ?? '',
    submittedByUserId: row.submitted_by_user_id ?? '',
    submittedByEmail: normalizeText(row.submitted_by_email, { maxLength: 320 }),
    submittedByName: normalizeText(row.submitted_by_name, { maxLength: 240 }),
    role: normalizeText(row.role, { maxLength: 120 }),
    clubId: row.club_id ?? '',
    clubName: normalizeText(clubRow?.name, { maxLength: 240 }),
    teamId: row.team_id ?? '',
    teamName: normalizeText(teamRow?.name, { maxLength: 240 }),
    module: normalizeText(row.module, { maxLength: 160 }),
    phase: normalizeText(row.phase, { maxLength: 120 }),
    route: normalizeText(row.route, { maxLength: 500 }),
    pageTitle: normalizeText(row.page_title, { maxLength: 240 }),
    feedbackType: normalizeText(row.feedback_type, { maxLength: 80 }),
    severity: normalizeText(row.severity, { maxLength: 80 }),
    status: normalizeText(row.status || 'new', { maxLength: 80 }) || 'new',
    resolutionState: normalizeText(row.resolution_state, { maxLength: 120 }),
    title: normalizeText(row.title, { maxLength: 240 }),
    summary: normalizeText(row.summary),
    reproductionSteps: normalizeText(row.reproduction_steps),
    expectedResult: normalizeText(row.expected_result),
    actualResult: normalizeText(row.actual_result),
    browserDevice: normalizeText(row.browser_device, { maxLength: 1000 }),
    logReference: normalizeText(row.log_reference, { maxLength: 1000 }),
    adminNotes: normalizeText(row.admin_notes),
    attachment: {
      fileSize: Number(row.screenshot_file_size || 0),
      hasAttachment: Boolean(row.screenshot_storage_bucket && row.screenshot_storage_path),
      mimeType: normalizeText(row.screenshot_mime_type, { maxLength: 120 }),
      originalFilename: normalizeText(row.screenshot_original_filename, { maxLength: 240 }),
      uploadedAt: row.screenshot_uploaded_at ?? '',
    },
  }
}

function getSupportReportStats(reports) {
  return {
    total: reports.length,
    open: reports.filter((report) => report.status === 'new' || report.status === 'triaged' || !report.status).length,
    production: reports.filter((report) => report.phase === 'production').length,
    highSeverity: reports.filter((report) => report.severity === 'high' || report.severity === 'critical').length,
  }
}

export async function platformFeedbackReportsResult(event, {
  supabaseAdmin = createSupabaseAdminClient(event),
} = {}) {
  if (event.httpMethod !== 'GET') {
    return jsonResponse(405, { success: false, code: 'method_not_allowed', message: 'Method Not Allowed' })
  }

  let profile = null

  try {
    profile = await getPlatformAdminProfile(event, supabaseAdmin)

    const { data, error } = await supabaseAdmin
      .from('tester_feedback_reports')
      .select('id, created_at, submitted_by_user_id, submitted_by_email, submitted_by_name, role, club_id, team_id, module, phase, route, page_title, feedback_type, severity, status, resolution_state, title, summary, reproduction_steps, expected_result, actual_result, browser_device, log_reference, admin_notes, screenshot_storage_bucket, screenshot_storage_path, screenshot_original_filename, screenshot_mime_type, screenshot_file_size, screenshot_uploaded_at, clubs:club_id (name), teams:team_id (name)')
      .order('created_at', { ascending: false })
      .limit(200)

    if (error) {
      throw error
    }

    const reports = (data ?? []).map(normalizeFeedbackReport)

    return jsonResponse(200, {
      success: true,
      reports,
      stats: getSupportReportStats(reports),
    })
  } catch (error) {
    const normalizedError = publicError(error)
    const diagnostic = safeDiagnostic(error)
    console.error('platform_feedback_reports_load_failed', {
      reference: SUPPORT_REFERENCE,
      statusCode: normalizedError.statusCode || 500,
      code: normalizedError.code || 'feedback_reports_load_failed',
      actorId: profile?.id || undefined,
      supabaseCode: diagnostic.code || undefined,
      supabaseDetails: diagnostic.details || undefined,
      supabaseHint: diagnostic.hint || undefined,
      message: diagnostic.message || undefined,
    })

    return jsonResponse(normalizedError.statusCode || 500, {
      success: false,
      code: normalizedError.code || 'feedback_reports_load_failed',
      message: normalizedError.message || FEEDBACK_REPORTS_LOAD_MESSAGE,
    })
  }
}

export async function handler(event) {
  return platformFeedbackReportsResult(event)
}
