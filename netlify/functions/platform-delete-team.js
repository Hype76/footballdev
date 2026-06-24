import { createPublicSupabaseClient, createSupabaseAdminClient } from './_supabase.js'

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i

function jsonResponse(statusCode, payload) {
  return {
    statusCode,
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  }
}

function normalizeText(value) {
  return String(value ?? '').trim()
}

function getBearerToken(event) {
  const header = event.headers.authorization || event.headers.Authorization || ''
  const [scheme, token] = String(header).split(' ')

  return scheme?.toLowerCase() === 'bearer' ? token : ''
}

function httpError(code, message, statusCode = 500) {
  return Object.assign(new Error(message), { code, statusCode })
}

function safeErrorDetail(error) {
  return {
    supabaseCode: normalizeText(error?.code || error?.status || error?.statusCode),
    supabaseHint: normalizeText(error?.hint),
    supabaseDetails: normalizeText(error?.details),
  }
}

function isPasswordAuthError(error) {
  const status = Number(error?.status || error?.statusCode || 0)
  const code = normalizeText(error?.code || error?.name).toLowerCase()
  const message = normalizeText(error?.message).toLowerCase()

  return status === 400
    || status === 401
    || code === 'invalid_credentials'
    || code === 'authapierror'
    || message.includes('invalid login credentials')
    || message.includes('invalid credentials')
}

async function verifyPlatformAdminPassword(supabasePublic, email, password) {
  try {
    const { error } = await supabasePublic.auth.signInWithPassword({
      email,
      password,
    })

    if (error) {
      throw error
    }
  } catch (error) {
    if (isPasswordAuthError(error)) {
      throw httpError('invalid_password', 'That password was not accepted.', 401)
    }

    throw error
  }
}

function parseBody(event) {
  try {
    return JSON.parse(event.body || '{}')
  } catch {
    throw httpError('validation_error', 'Request body must be valid JSON.', 400)
  }
}

function requireUuid(value, code, message) {
  const normalizedValue = normalizeText(value)

  if (!normalizedValue || !UUID_PATTERN.test(normalizedValue)) {
    throw httpError(code, message, 400)
  }

  return normalizedValue
}

async function getAuthenticatedSuperAdmin(event, supabaseAdmin) {
  const token = getBearerToken(event)

  if (!token) {
    throw httpError('unauthenticated', 'Platform admin login is required.', 401)
  }

  const { data: authData, error: authError } = await supabaseAdmin.auth.getUser(token)

  if (authError || !authData?.user?.id) {
    throw httpError('unauthenticated', 'Platform admin login is required.', 401)
  }

  const authUser = authData.user
  const authEmail = normalizeText(authUser.email).toLowerCase()
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
    throw httpError('forbidden', 'Only platform admins can delete teams.', 403)
  }

  return {
    id: profile.id,
    email: normalizeText(profile.email || authEmail).toLowerCase(),
    name: normalizeText(profile.name || profile.username || profile.email || authEmail),
    role: profile.role,
    roleLabel: normalizeText(profile.role_label || 'Super Admin'),
    roleRank: Number(profile.role_rank ?? 100),
  }
}

function normalizeDeleteError(error, stage = 'unknown') {
  const message = normalizeText(error?.message).toLowerCase()
  const details = normalizeText(error?.details).toLowerCase()
  const hint = normalizeText(error?.hint).toLowerCase()

  if (error?.code === '23503') {
    return httpError(
      'deletion_conflict',
      'This team cannot be deleted because linked records still depend on it.',
      409,
    )
  }

  if (message.includes('deletion_conflict') || details.includes('deletion_conflict')) {
    return httpError(
      'deletion_conflict',
      'This team cannot be deleted because linked records still depend on it.',
      409,
    )
  }

  if (message.includes('team_not_found') || details.includes('team_not_found')) {
    return httpError('team_not_found', 'Team was not found.', 404)
  }

  if (message.includes('team_club_mismatch') || details.includes('team_club_mismatch')) {
    return httpError('team_club_mismatch', 'Selected team is not linked to the selected club.', 409)
  }

  if (message.includes('audit_failed') || details.includes('audit_failed') || hint.includes('audit_failed')) {
    return httpError(
      'audit_failed',
      'The team could not be deleted because the audit log could not be written.',
      500,
    )
  }

  if (error?.code && error?.statusCode) {
    return error
  }

  const serverError = httpError(
    'server_error',
    'The server could not complete this action. Please contact support with reference FPO-V1-TEAMDELETE-ACTUALFIX-006.',
    500,
  )
  serverError.stage = stage
  return serverError
}

export async function deletePlatformTeamResult(event, {
  supabaseAdmin = createSupabaseAdminClient(event),
  supabasePublic = createPublicSupabaseClient(event),
} = {}) {
  let failureStage = 'method_validation'
  let safeTeamId = ''
  let safeClubId = ''
  let actorResolved = false

  try {
    if (event.httpMethod !== 'DELETE') {
      return jsonResponse(405, { success: false, code: 'method_not_allowed', message: 'Method Not Allowed' })
    }

    failureStage = 'request_body_parsing'
    const body = parseBody(event)
    failureStage = 'team_id_validation'
    const teamId = requireUuid(body.teamId, 'invalid_team_id', 'Team ID is required.')
    safeTeamId = teamId
    failureStage = 'club_id_validation'
    const clubId = requireUuid(body.clubId, 'invalid_club_id', 'Club ID is required.')
    safeClubId = clubId
    failureStage = 'password_validation'
    const password = String(body.password ?? '')

    if (!password) {
      throw httpError('missing_password', 'Enter your password to confirm this action.', 400)
    }

    failureStage = 'platform_admin_resolution'
    const platformAdmin = await getAuthenticatedSuperAdmin(event, supabaseAdmin)
    actorResolved = true
    failureStage = 'password_verification'
    await verifyPlatformAdminPassword(supabasePublic, platformAdmin.email, password)

    failureStage = 'team_fetch'
    const { data: team, error: teamError } = await supabaseAdmin
      .from('teams')
      .select('id, name, club_id')
      .eq('id', teamId)
      .maybeSingle()

    if (teamError) {
      throw teamError
    }

    if (!team?.id) {
      throw httpError('team_not_found', 'Team was not found.', 404)
    }

    if (String(team.club_id) !== String(clubId)) {
      throw httpError('team_club_mismatch', 'Selected team is not linked to the selected club.', 409)
    }

    failureStage = 'team_delete_transaction'
    const { data: deleteData, error: deleteError } = await supabaseAdmin.rpc('delete_platform_team_transaction', {
      p_team_id: team.id,
      p_club_id: clubId,
      p_actor_id: platformAdmin.id,
      p_actor_email: platformAdmin.email,
      p_actor_name: platformAdmin.name,
      p_actor_role: platformAdmin.role,
      p_actor_role_label: platformAdmin.roleLabel,
      p_actor_role_rank: platformAdmin.roleRank,
    })

    if (deleteError) {
      throw normalizeDeleteError(deleteError, failureStage)
    }

    const deleteResult = Array.isArray(deleteData) ? deleteData[0] : deleteData

    if (deleteResult?.deleted !== true) {
      throw httpError('server_error', 'Team could not be deleted.', 500)
    }

    return jsonResponse(200, {
      success: true,
      team: {
        id: team.id,
        name: team.name,
        clubId: team.club_id,
      },
    })
  } catch (error) {
    const normalizedError = normalizeDeleteError(error, failureStage)
    const safeDetail = safeErrorDetail(error)
    console.error('Platform team delete failed', {
      reference: 'FPO-V1-TEAMDELETE-ACTUALFIX-006',
      stage: failureStage,
      code: normalizedError.code || 'server_error',
      statusCode: normalizedError.statusCode || 500,
      message: normalizedError.message || 'Team could not be deleted.',
      actorResolved,
      teamId: safeTeamId || undefined,
      clubId: safeClubId || undefined,
      supabaseCode: safeDetail.supabaseCode || undefined,
      supabaseHint: safeDetail.supabaseHint || undefined,
      supabaseDetails: safeDetail.supabaseDetails || undefined,
    })

    return jsonResponse(normalizedError.statusCode || 500, {
      success: false,
      code: normalizedError.code || 'server_error',
      message: normalizedError.message || 'Team could not be deleted.',
    })
  }
}

export async function handler(event) {
  return deletePlatformTeamResult(event)
}
