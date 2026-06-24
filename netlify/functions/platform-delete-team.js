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

function normalizeDeleteError(error) {
  if (error?.code === '23503') {
    return httpError(
      'deletion_conflict',
      'This team cannot be deleted because linked records still depend on it.',
      409,
    )
  }

  if (error?.code && error?.statusCode) {
    return error
  }

  return httpError('server_error', 'Team could not be deleted.', 500)
}

export async function deletePlatformTeamResult(event, {
  supabaseAdmin = createSupabaseAdminClient(event),
  supabasePublic = createPublicSupabaseClient(event),
} = {}) {
  try {
    if (event.httpMethod !== 'DELETE') {
      return jsonResponse(405, { success: false, code: 'method_not_allowed', message: 'Method Not Allowed' })
    }

    const body = parseBody(event)
    const teamId = requireUuid(body.teamId, 'invalid_team_id', 'Team ID is required.')
    const clubId = requireUuid(body.clubId, 'invalid_club_id', 'Club ID is required.')
    const password = String(body.password ?? '')

    if (!password) {
      throw httpError('missing_password', 'Enter your password to confirm this action.', 400)
    }

    const platformAdmin = await getAuthenticatedSuperAdmin(event, supabaseAdmin)
    const { error: passwordError } = await supabasePublic.auth.signInWithPassword({
      email: platformAdmin.email,
      password,
    })

    if (passwordError) {
      throw httpError('invalid_password', 'Password confirmation failed. Check your password and try again.', 401)
    }

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

    const { error: deleteError } = await supabaseAdmin
      .from('teams')
      .delete()
      .eq('id', team.id)
      .eq('club_id', clubId)

    if (deleteError) {
      throw normalizeDeleteError(deleteError)
    }

    const { error: auditError } = await supabaseAdmin.from('audit_logs').insert({
      club_id: team.club_id,
      actor_id: platformAdmin.id,
      actor_email: platformAdmin.email,
      actor_name: platformAdmin.name,
      actor_role: platformAdmin.role,
      actor_role_label: platformAdmin.roleLabel,
      actor_role_rank: platformAdmin.roleRank,
      action: 'platform_team_deleted',
      entity_type: 'team',
      entity_id: team.id,
      metadata: {
        teamName: team.name,
        clubId: team.club_id,
      },
    })

    if (auditError) {
      throw auditError
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
    const normalizedError = normalizeDeleteError(error)
    console.error('Platform team delete failed', {
      code: normalizedError.code || 'server_error',
      statusCode: normalizedError.statusCode || 500,
      message: normalizedError.message || 'Team could not be deleted.',
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
