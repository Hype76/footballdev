import { loadActiveAuthorityProfile } from './lib/_authority-profile.js'
import { createPublicSupabaseClient, createSupabaseAdminClient } from './lib/_supabase.js'

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
const SUPPORT_REFERENCE = 'FPO-V1-USERDELETE-SERVERERR-102'

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
  const normalized = normalizeText(value)
  if (!UUID_PATTERN.test(normalized)) throw httpError(code, message, 400)
  return normalized
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
    const { error } = await supabasePublic.auth.signInWithPassword({ email, password })
    if (error) throw error
  } catch (error) {
    if (isPasswordAuthError(error)) throw httpError('invalid_password', 'That password was not accepted.', 401)
    throw error
  }
}

async function getAuthenticatedSuperAdmin(event, supabaseAdmin) {
  const token = getBearerToken(event)
  if (!token) throw httpError('unauthenticated', 'Platform admin login is required.', 401)

  const { data: authData, error: authError } = await supabaseAdmin.auth.getUser(token)
  if (authError || !authData?.user?.id) throw httpError('unauthenticated', 'Platform admin login is required.', 401)

  const authUser = authData.user
  const profile = await loadActiveAuthorityProfile(supabaseAdmin, authUser, {
    select: 'id, email, username, name, role, role_label, role_rank, club_id, status',
  })
  if (!profile?.id || profile.role !== 'super_admin') {
    throw httpError('forbidden', 'Only platform admins can delete user access.', 403)
  }

  return {
    id: profile.id,
    email: normalizeText(profile.email || authUser.email).toLowerCase(),
    name: normalizeText(profile.name || profile.username || profile.email || authUser.email),
    role: profile.role,
    roleLabel: normalizeText(profile.role_label || 'Super Admin'),
    roleRank: Number(profile.role_rank ?? 100),
  }
}

async function deleteRows(supabaseAdmin, table, column, value) {
  const { error } = await supabaseAdmin.from(table).delete().eq(column, value)
  if (error && error.code !== '42P01' && error.code !== '42703') throw error
}

async function deleteRowsByEmail(supabaseAdmin, table, email) {
  const normalizedEmail = normalizeText(email).toLowerCase()
  if (!normalizedEmail) return
  const { error } = await supabaseAdmin.from(table).delete().ilike('email', normalizedEmail)
  if (error && error.code !== '42P01' && error.code !== '42703') throw error
}

function normalizeDeleteError(error, stage) {
  if (error?.code && error?.statusCode) return error
  if (error?.code === '23503') {
    return httpError('deletion_conflict', 'This user still owns linked records that must be reassigned before access can be deleted.', 409)
  }
  const failure = httpError(
    'server_error',
    `The server could not complete this action. Please contact support with reference ${SUPPORT_REFERENCE}.`,
    500,
  )
  failure.stage = stage
  return failure
}

export async function deletePlatformUserResult(event, {
  supabaseAdmin = createSupabaseAdminClient(event),
  supabasePublic = createPublicSupabaseClient(event),
} = {}) {
  let stage = 'method_validation'
  let safeTargetUserId = ''

  try {
    if (event.httpMethod !== 'DELETE') {
      return jsonResponse(405, { success: false, code: 'method_not_allowed', message: 'Method Not Allowed' })
    }

    stage = 'request_body_parsing'
    const body = parseBody(event)
    const deletionScope = normalizeText(body.deletionScope)
    if (deletionScope !== 'platform_account') {
      throw httpError(
        'platform_scope_required',
        'Use Club access to remove a person from one Club. Platform account deletion requires the dedicated platform-wide workflow.',
        400,
      )
    }
    stage = 'target_user_validation'
    const targetUserId = requireUuid(body.targetUserId, 'invalid_user_id', 'User ID is required.')
    safeTargetUserId = targetUserId
    const password = String(body.password ?? '')
    if (!password) throw httpError('missing_password', 'Enter your password to confirm this action.', 400)

    stage = 'platform_admin_resolution'
    const platformAdmin = await getAuthenticatedSuperAdmin(event, supabaseAdmin)
    if (platformAdmin.id === targetUserId) throw httpError('self_delete_blocked', 'You cannot delete your own platform admin account.', 409)

    stage = 'password_verification'
    await verifyPlatformAdminPassword(supabasePublic, platformAdmin.email, password)

    stage = 'target_user_fetch'
    const { data: targetUser, error: targetUserError } = await supabaseAdmin
      .from('users')
      .select('id, email, username, name, role, role_label, club_id')
      .eq('id', targetUserId)
      .maybeSingle()
    if (targetUserError) throw targetUserError
    if (!targetUser?.id) throw httpError('user_not_found', 'User was not found.', 404)
    if (targetUser.role === 'super_admin') throw httpError('platform_admin_delete_required', 'Use Platform Admin account management to delete another Platform Admin.', 409)

    stage = 'active_access_cleanup'
    await deleteRows(supabaseAdmin, 'team_staff', 'user_id', targetUserId)
    await deleteRows(supabaseAdmin, 'user_club_memberships', 'auth_user_id', targetUserId)
    await deleteRows(supabaseAdmin, 'parent_player_links', 'auth_user_id', targetUserId)
    await deleteRowsByEmail(supabaseAdmin, 'parent_player_links', targetUser.email)
    await deleteRows(supabaseAdmin, 'parent_push_subscriptions', 'auth_user_id', targetUserId)
    await deleteRows(supabaseAdmin, 'parent_mobile_push_installations', 'auth_user_id', targetUserId)
    await deleteRows(supabaseAdmin, 'coach_mobile_push_installations', 'auth_user_id', targetUserId)
    await deleteRows(supabaseAdmin, 'users', 'id', targetUserId)

    stage = 'sign_in_soft_delete'
    const { error: authDeleteError } = await supabaseAdmin.auth.admin.deleteUser(targetUserId, true)
    if (authDeleteError) throw authDeleteError

    stage = 'audit_write'
    const { error: auditError } = await supabaseAdmin.from('audit_logs').insert({
      actor_id: platformAdmin.id,
      actor_name: platformAdmin.name,
      actor_email: platformAdmin.email,
      actor_role_label: platformAdmin.roleLabel,
      actor_role_rank: platformAdmin.roleRank,
      action: 'platform_user_deleted',
      entity_type: 'user',
      entity_id: targetUserId,
      event_category: 'security',
      severity: 'warning',
      outcome: 'success',
      source: 'netlify_function',
      metadata: {
        email: targetUser.email,
        name: targetUser.name || targetUser.username,
        role: targetUser.role_label || targetUser.role,
        clubId: targetUser.club_id,
        signInSoftDeleted: true,
      },
    })
    if (auditError) throw auditError

    return jsonResponse(200, {
      success: true,
      user: {
        id: targetUserId,
        email: targetUser.email,
        name: targetUser.name || targetUser.username,
      },
    })
  } catch (error) {
    const normalizedError = normalizeDeleteError(error, stage)
    console.error('Platform user delete failed', {
      reference: SUPPORT_REFERENCE,
      stage,
      code: normalizedError.code || 'server_error',
      statusCode: normalizedError.statusCode || 500,
      targetUserId: safeTargetUserId || undefined,
      databaseCode: normalizeText(error?.code),
      databaseDetails: normalizeText(error?.details),
    })
    return jsonResponse(normalizedError.statusCode || 500, {
      success: false,
      code: normalizedError.code || 'server_error',
      message: normalizedError.message || 'User access could not be deleted.',
    })
  }
}

export async function handler(event) {
  return deletePlatformUserResult(event)
}
