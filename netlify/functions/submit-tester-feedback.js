import { createSupabaseAdminClient } from './lib/_supabase.js'

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
const SUPPORT_REFERENCE = 'FPO-V1-FEEDBACK-LIVEFIX-010'
const MAX_TEXT_LENGTH = 4000

export const FEEDBACK_SAVE_ERROR_MESSAGE = 'Feedback could not be saved. Please try again or contact support.'

const ALLOWED_TYPES = new Set(['bug', 'suggestion', 'confusion', 'missing_feature', 'praise', 'other'])
const ALLOWED_SEVERITIES = new Set(['low', 'medium', 'high', 'critical'])

function jsonResponse(statusCode, payload) {
  return {
    statusCode,
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  }
}

function normalizeText(value, { maxLength = MAX_TEXT_LENGTH } = {}) {
  return String(value ?? '').trim().slice(0, maxLength)
}

function nullableText(value, options) {
  const normalizedValue = normalizeText(value, options)
  return normalizedValue || null
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

function isUuid(value) {
  return UUID_PATTERN.test(String(value ?? '').trim())
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

  if (isSchemaOrTableError(error)) {
    return Object.assign(new Error(FEEDBACK_SAVE_ERROR_MESSAGE), {
      code: 'feedback_storage_unavailable',
      statusCode: 503,
    })
  }

  return Object.assign(new Error(FEEDBACK_SAVE_ERROR_MESSAGE), {
    code: 'feedback_save_failed',
    statusCode: 500,
  })
}

async function getAuthenticatedProfile(event, supabaseAdmin) {
  const token = getBearerToken(event)

  if (!token) {
    throw Object.assign(new Error('Sign in before sending feedback.'), {
      code: 'unauthenticated',
      statusCode: 401,
    })
  }

  const { data: authData, error: authError } = await supabaseAdmin.auth.getUser(token)

  if (authError || !authData?.user?.id) {
    throw Object.assign(new Error('Sign in before sending feedback.'), {
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
    roleLabel: normalizeText(profile.role_label, { maxLength: 120 }),
    roleRank: Number(profile.role_rank ?? 0),
    clubId: isUuid(profile.club_id) ? profile.club_id : null,
  }
}

async function resolveTeamContext({ activeTeamId, profile, supabaseAdmin }) {
  const teamId = normalizeText(activeTeamId, { maxLength: 64 })

  if (!teamId) {
    return null
  }

  if (!isUuid(teamId)) {
    throw Object.assign(new Error('Selected team context was not valid.'), {
      code: 'invalid_team_context',
      statusCode: 400,
    })
  }

  const { data: team, error: teamError } = await supabaseAdmin
    .from('teams')
    .select('id, club_id')
    .eq('id', teamId)
    .maybeSingle()

  if (teamError) {
    throw teamError
  }

  if (!team?.id || String(team.club_id) !== String(profile.clubId)) {
    throw Object.assign(new Error('Selected team context was not available.'), {
      code: 'invalid_team_context',
      statusCode: 403,
    })
  }

  if (profile.role === 'super_admin' || profile.role === 'admin') {
    return team.id
  }

  const { data: assignment, error: assignmentError } = await supabaseAdmin
    .from('team_staff')
    .select('id')
    .eq('team_id', team.id)
    .eq('user_id', profile.id)
    .maybeSingle()

  if (assignmentError) {
    throw assignmentError
  }

  if (!assignment?.id) {
    throw Object.assign(new Error('Selected team context was not available.'), {
      code: 'invalid_team_context',
      statusCode: 403,
    })
  }

  return team.id
}

function validateReport(report) {
  const title = normalizeText(report?.title, { maxLength: 240 })
  const summary = normalizeText(report?.summary, { maxLength: 4000 })

  if (!title) {
    throw Object.assign(new Error('Add a title before sending feedback.'), {
      code: 'missing_title',
      statusCode: 400,
    })
  }

  if (!summary) {
    throw Object.assign(new Error('Add a summary before sending feedback.'), {
      code: 'missing_summary',
      statusCode: 400,
    })
  }

  const feedbackType = normalizeText(report?.feedbackType, { maxLength: 80 })
  const severity = normalizeText(report?.severity, { maxLength: 80 })

  return {
    module: normalizeText(report?.module, { maxLength: 160 }),
    phase: normalizeText(report?.phase, { maxLength: 120 }) || 'production',
    route: normalizeText(report?.route, { maxLength: 500 }),
    page_title: nullableText(report?.pageTitle, { maxLength: 240 }),
    feedback_type: ALLOWED_TYPES.has(feedbackType) ? feedbackType : 'bug',
    severity: ALLOWED_SEVERITIES.has(severity) ? severity : 'medium',
    title,
    summary,
    reproduction_steps: normalizeText(report?.reproductionSteps),
    expected_result: normalizeText(report?.expectedResult),
    actual_result: normalizeText(report?.actualResult),
    browser_device: normalizeText(report?.browserDevice, { maxLength: 1000 }),
    screenshot_url: nullableText(report?.screenshotUrl, { maxLength: 1000 }),
    log_reference: nullableText(report?.logReference, { maxLength: 1000 }),
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

export async function submitTesterFeedbackResult(event, {
  supabaseAdmin = createSupabaseAdminClient(event),
} = {}) {
  if (event.httpMethod !== 'POST') {
    return jsonResponse(405, { success: false, code: 'method_not_allowed', message: 'Method Not Allowed' })
  }

  let profile = null

  try {
    const body = parseBody(event)
    profile = await getAuthenticatedProfile(event, supabaseAdmin)
    const report = validateReport(body.report || {})
    const teamId = await resolveTeamContext({
      activeTeamId: body.context?.activeTeamId,
      profile,
      supabaseAdmin,
    })

    const { data, error } = await supabaseAdmin
      .from('tester_feedback_reports')
      .insert({
        submitted_by_user_id: profile.id,
        submitted_by_email: profile.email,
        submitted_by_name: profile.name,
        role: profile.role,
        club_id: profile.clubId,
        team_id: teamId,
        ...report,
        status: 'new',
        resolution_state: '',
      })
      .select('id, created_at')
      .single()

    if (error) {
      throw error
    }

    return jsonResponse(200, {
      success: true,
      report: data,
    })
  } catch (error) {
    const normalizedError = publicError(error)
    const diagnostic = safeDiagnostic(error)
    console.error('tester_feedback_submit_failed', {
      reference: SUPPORT_REFERENCE,
      statusCode: normalizedError.statusCode || 500,
      code: normalizedError.code || 'feedback_save_failed',
      actorId: profile?.id || undefined,
      clubId: profile?.clubId || undefined,
      supabaseCode: diagnostic.code || undefined,
      supabaseDetails: diagnostic.details || undefined,
      supabaseHint: diagnostic.hint || undefined,
      message: diagnostic.message || undefined,
    })

    return jsonResponse(normalizedError.statusCode || 500, {
      success: false,
      code: normalizedError.code || 'feedback_save_failed',
      message: normalizedError.message || FEEDBACK_SAVE_ERROR_MESSAGE,
    })
  }
}

export async function handler(event) {
  return submitTesterFeedbackResult(event)
}
