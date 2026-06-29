import { createSupabaseAdminClient } from './lib/_supabase.js'

const SUPPORT_REFERENCE = 'FPO-V1-FEEDBACK-ADMIN-FIX-012'
const UPDATE_FAILED_MESSAGE = 'Issue report could not be updated. Please try again.'
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i

const actionToStatus = {
  reviewed: 'triaged',
  closed: 'fixed',
}

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
    throw httpError('validation_error', UPDATE_FAILED_MESSAGE, 400)
  }
}

function requireUuid(value) {
  const normalizedValue = normalizeText(value)

  if (!normalizedValue || !UUID_PATTERN.test(normalizedValue)) {
    throw httpError('invalid_report_id', UPDATE_FAILED_MESSAGE, 400)
  }

  return normalizedValue
}

function getNextStatus(action) {
  const normalizedAction = normalizeText(action, { maxLength: 40 })
  const nextStatus = actionToStatus[normalizedAction]

  if (!nextStatus) {
    throw httpError('invalid_action', UPDATE_FAILED_MESSAGE, 400)
  }

  return nextStatus
}

async function getPlatformAdminProfile(event, supabaseAdmin) {
  const token = getBearerToken(event)

  if (!token) {
    throw httpError('unauthenticated', 'Sign in before updating issue reports.', 401)
  }

  const { data: authData, error: authError } = await supabaseAdmin.auth.getUser(token)

  if (authError || !authData?.user?.id) {
    throw httpError('unauthenticated', 'Sign in before updating issue reports.', 401)
  }

  const authUser = authData.user
  const authEmail = normalizeText(authUser.email, { maxLength: 320 }).toLowerCase()
  const { data: profile, error: profileError } = await supabaseAdmin
    .from('users')
    .select('id, email, username, name, role, role_label, role_rank')
    .or(`id.eq.${authUser.id},email.eq.${authEmail}`)
    .limit(1)
    .maybeSingle()

  if (profileError) {
    throw profileError
  }

  if (!profile?.id || profile.role !== 'super_admin') {
    throw httpError('forbidden', 'Only platform admins can update issue reports.', 403)
  }

  return {
    id: profile.id,
    email: normalizeText(profile.email || authEmail, { maxLength: 320 }).toLowerCase(),
    name: normalizeText(profile.name || profile.username || profile.email || authEmail, { maxLength: 240 }),
    role: normalizeText(profile.role, { maxLength: 80 }),
    roleLabel: normalizeText(profile.role_label || 'Super Admin', { maxLength: 120 }),
    roleRank: Number(profile.role_rank ?? 100),
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

async function writeAuditLog(supabaseAdmin, { actor, reportId, nextStatus }) {
  const { error } = await supabaseAdmin.from('audit_logs').insert({
    club_id: null,
    actor_id: actor.id,
    actor_name: actor.name,
    actor_email: actor.email,
    actor_role_label: actor.roleLabel,
    actor_role_rank: actor.roleRank,
    action: 'tester_feedback_report_status_updated',
    entity_type: 'tester_feedback_report',
    entity_id: reportId,
    metadata: {
      nextStatus,
      reference: SUPPORT_REFERENCE,
    },
  })

  if (error) {
    console.error('platform_feedback_report_update_audit_failed', {
      reference: SUPPORT_REFERENCE,
      reportId,
      code: normalizeText(error.code),
      message: normalizeText(error.message),
    })
  }
}

export async function platformFeedbackReportUpdateResult(event, {
  supabaseAdmin = createSupabaseAdminClient(event),
} = {}) {
  let actor = null
  let reportId = ''
  let nextStatus = ''

  try {
    if (event.httpMethod !== 'POST') {
      return jsonResponse(405, { success: false, code: 'method_not_allowed', message: 'Method Not Allowed' })
    }

    const body = parseBody(event)
    reportId = requireUuid(body.reportId)
    nextStatus = getNextStatus(body.action)
    actor = await getPlatformAdminProfile(event, supabaseAdmin)

    const updatePayload = {
      status: nextStatus,
      resolution_state: nextStatus === 'fixed' ? 'closed' : 'reviewed',
    }
    const adminNotes = normalizeText(body.adminNotes, { maxLength: 4000 })

    if (adminNotes) {
      updatePayload.admin_notes = adminNotes
    }

    const { data, error } = await supabaseAdmin
      .from('tester_feedback_reports')
      .update(updatePayload)
      .eq('id', reportId)
      .select('id, created_at, submitted_by_user_id, submitted_by_email, submitted_by_name, role, club_id, team_id, module, phase, route, page_title, feedback_type, severity, status, resolution_state, title, summary, reproduction_steps, expected_result, actual_result, browser_device, log_reference, admin_notes, clubs:club_id (name), teams:team_id (name)')
      .maybeSingle()

    if (error) {
      throw error
    }

    if (!data?.id) {
      throw httpError('report_not_found', UPDATE_FAILED_MESSAGE, 404)
    }

    await writeAuditLog(supabaseAdmin, { actor, reportId, nextStatus })

    return jsonResponse(200, {
      success: true,
      report: normalizeFeedbackReport(data),
    })
  } catch (error) {
    const diagnostic = safeDiagnostic(error)
    const statusCode = Number(error?.statusCode || error?.status || 500)
    console.error('platform_feedback_report_update_failed', {
      reference: SUPPORT_REFERENCE,
      statusCode,
      code: error?.code || 'feedback_report_update_failed',
      actorId: actor?.id || undefined,
      reportId: reportId || undefined,
      nextStatus: nextStatus || undefined,
      supabaseCode: diagnostic.code || undefined,
      supabaseDetails: diagnostic.details || undefined,
      supabaseHint: diagnostic.hint || undefined,
      message: diagnostic.message || undefined,
    })

    return jsonResponse(statusCode, {
      success: false,
      code: error?.code || 'feedback_report_update_failed',
      message: error?.statusCode ? error.message : UPDATE_FAILED_MESSAGE,
    })
  }
}

export async function handler(event) {
  return platformFeedbackReportUpdateResult(event)
}
