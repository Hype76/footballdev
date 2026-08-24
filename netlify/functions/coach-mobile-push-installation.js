import { Buffer } from 'node:buffer'
import { loadActiveAuthorityProfile } from './lib/_authority-profile.js'
import { resolveCoachMobileRegistrationPreference } from './lib/_coach-mobile-notification-preference.js'
import { supabaseAdmin } from './lib/_supabase.js'

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
const CONTEXT_PATTERN = /^(club|team):([0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12})$/i
const EXPO_PUSH_TOKEN_PATTERN = /^(Exponent|Expo)PushToken\[[A-Za-z0-9_-]+\]$/
const MAX_REQUEST_BYTES = 4096

function normalizeText(value) {
  return String(value ?? '').trim()
}

function normalizeDetailLevel(value) {
  const level = normalizeText(value).toLowerCase()
  return ['off', 'minimal', 'detailed'].includes(level) ? level : 'minimal'
}

function jsonResponse(statusCode, payload) {
  return new Response(JSON.stringify(payload), {
    status: statusCode,
    headers: {
      'Cache-Control': 'private, no-store, max-age=0',
      'Content-Type': 'application/json; charset=utf-8',
      'X-Content-Type-Options': 'nosniff',
    },
  })
}

function failure(statusCode, code, message) {
  return jsonResponse(statusCode, { success: false, code, message })
}

function getBearerToken(request) {
  const header = normalizeText(request.headers.get('authorization'))
  const [scheme, token] = header.split(/\s+/, 2)
  return scheme?.toLowerCase() === 'bearer' ? normalizeText(token) : ''
}

async function getAuthUser(request) {
  const accessToken = getBearerToken(request)
  if (!accessToken) {
    throw Object.assign(new Error('Sign in again before changing notifications.'), {
      code: 'COACH_MOBILE_SIGN_IN_REQUIRED',
      statusCode: 401,
    })
  }

  const { data, error } = await supabaseAdmin.auth.getUser(accessToken)
  if (error || !data?.user?.id) {
    throw Object.assign(new Error('Sign in again before changing notifications.'), {
      code: 'COACH_MOBILE_SIGN_IN_REQUIRED',
      statusCode: 401,
    })
  }
  return data.user
}

async function parseBody(request) {
  const rawBody = normalizeText(await request.text())
  if (Buffer.byteLength(rawBody, 'utf8') > MAX_REQUEST_BYTES) {
    throw Object.assign(new Error('The notification request is too large.'), {
      code: 'COACH_MOBILE_REQUEST_TOO_LARGE',
      statusCode: 413,
    })
  }

  try {
    const body = rawBody ? JSON.parse(rawBody) : {}
    if (!body || typeof body !== 'object' || Array.isArray(body)) throw new Error('invalid body')
    return body
  } catch {
    throw Object.assign(new Error('The notification request is not valid.'), {
      code: 'COACH_MOBILE_REQUEST_INVALID',
      statusCode: 400,
    })
  }
}

function getInstallationId(url, body) {
  return normalizeText(body?.installationId || url.searchParams.get('installationId'))
}

function publicInstallation(row) {
  return {
    contextId: normalizeText(row?.context_id),
    detailLevel: normalizeDetailLevel(row?.detail_level),
    enabled: Boolean(row?.enabled && row?.status === 'active'),
    platform: normalizeText(row?.platform),
    registered: row?.status === 'active',
  }
}

async function loadOwnedInstallation(installationId, authUserId) {
  const { data, error } = await supabaseAdmin
    .from('coach_mobile_push_installations')
    .select(
      'installation_id, auth_user_id, user_profile_id, club_id, team_id, context_id, expo_push_token, platform, detail_level, enabled, status',
    )
    .eq('installation_id', installationId)
    .eq('auth_user_id', authUserId)
    .maybeSingle()

  if (error) throw error
  return data
}

async function loadCoachProfile(authUser) {
  const profile = await loadActiveAuthorityProfile(supabaseAdmin, authUser, {
    select: 'id, club_id, role, role_rank, status',
  })
  const role = normalizeText(profile.role)
  const roleRank = Number(profile.role_rank ?? 0)
  if (role === 'parent_portal' || role === 'super_admin' || roleRank < 20) {
    throw Object.assign(new Error('This account does not have active Coach access.'), {
      code: 'COACH_MOBILE_STAFF_REQUIRED',
      statusCode: 403,
    })
  }
  return { ...profile, role, roleRank }
}

async function loadCoachContext(authUser, contextId) {
  const match = CONTEXT_PATTERN.exec(normalizeText(contextId))
  if (!match) {
    throw Object.assign(new Error('Choose a valid Coach context.'), {
      code: 'COACH_MOBILE_CONTEXT_REQUIRED',
      statusCode: 400,
    })
  }

  const [, contextType, resourceId] = match
  const profile = await loadCoachProfile(authUser)
  const clubId = normalizeText(profile.club_id)

  if (contextType.toLowerCase() === 'club') {
    if (resourceId !== clubId || profile.role !== 'admin' || profile.roleRank < 90) {
      throw Object.assign(new Error('This Club context is not available to this Coach account.'), {
        code: 'COACH_MOBILE_CONTEXT_FORBIDDEN',
        statusCode: 403,
      })
    }
    return { clubId, contextId: `club:${clubId}`, profile, teamId: null }
  }

  const { data: team, error: teamError } = await supabaseAdmin
    .from('teams')
    .select('id, club_id, status, archived_at')
    .eq('id', resourceId)
    .eq('club_id', clubId)
    .maybeSingle()
  if (teamError) throw teamError
  if (!team?.id || normalizeText(team.status || 'active') !== 'active' || team.archived_at) {
    throw Object.assign(new Error('This Team context is not active.'), {
      code: 'COACH_MOBILE_CONTEXT_FORBIDDEN',
      statusCode: 403,
    })
  }

  if (profile.role !== 'admin') {
    const { data: assignment, error: assignmentError } = await supabaseAdmin
      .from('team_staff')
      .select('id, role_key, role_rank')
      .eq('team_id', team.id)
      .eq('user_id', profile.id)
      .maybeSingle()
    if (assignmentError) throw assignmentError
    if (!assignment?.id || Number(assignment.role_rank ?? 0) < 20) {
      throw Object.assign(new Error('This Team context is not assigned to this Coach account.'), {
        code: 'COACH_MOBILE_CONTEXT_FORBIDDEN',
        statusCode: 403,
      })
    }
  }

  return { clubId, contextId: `team:${team.id}`, profile, teamId: team.id }
}

async function registerInstallation({ authUser, body, installationId }) {
  const expoPushToken = normalizeText(body.expoPushToken)
  const platform = normalizeText(body.platform).toLowerCase()
  if (
    !['android', 'ios'].includes(platform) ||
    expoPushToken.length > 512 ||
    !EXPO_PUSH_TOKEN_PATTERN.test(expoPushToken)
  ) {
    throw Object.assign(new Error('The notification registration is not valid.'), {
      code: 'COACH_MOBILE_REGISTRATION_INVALID',
      statusCode: 400,
    })
  }

  const context = await loadCoachContext(authUser, body.contextId)
  const { data: existing, error: existingError } = await supabaseAdmin
    .from('coach_mobile_push_installations')
    .select('auth_user_id, detail_level, enabled, status')
    .eq('installation_id', installationId)
    .maybeSingle()
  if (existingError) throw existingError
  if (existing?.auth_user_id && existing.auth_user_id !== authUser.id) {
    throw Object.assign(new Error('This installation belongs to another account.'), {
      code: 'COACH_MOBILE_INSTALLATION_OWNED',
      statusCode: 403,
    })
  }

  const now = new Date().toISOString()
  const { error: revokeError } = await supabaseAdmin
    .from('coach_mobile_push_installations')
    .update({
      auth_user_id: null,
      user_profile_id: null,
      club_id: null,
      team_id: null,
      context_id: '',
      expo_push_token: null,
      enabled: false,
      status: 'revoked',
      updated_at: now,
    })
    .eq('expo_push_token', expoPushToken)
    .neq('installation_id', installationId)
  if (revokeError) throw revokeError

  const preference = resolveCoachMobileRegistrationPreference({
    existing: existing?.auth_user_id === authUser.id ? existing : null,
    mode: body.preferenceMode,
    requestedDetailLevel: body.detailLevel,
  })
  const { data, error } = await supabaseAdmin
    .from('coach_mobile_push_installations')
    .upsert(
      {
        installation_id: installationId,
        auth_user_id: authUser.id,
        user_profile_id: context.profile.id,
        club_id: context.clubId,
        team_id: context.teamId,
        context_id: context.contextId,
        app_role: 'coach',
        expo_push_token: expoPushToken,
        platform,
        app_version: normalizeText(body.appVersion).slice(0, 40),
        build_number: normalizeText(body.buildNumber).slice(0, 40),
        detail_level: preference.detailLevel,
        enabled: preference.enabled,
        status: 'active',
        last_seen_at: now,
        updated_at: now,
      },
      { onConflict: 'installation_id' },
    )
    .select('context_id, platform, detail_level, enabled, status')
    .single()
  if (error) throw error
  return data
}

async function updatePreference({ authUser, body, installationId }) {
  const current = await loadOwnedInstallation(installationId, authUser.id)
  if (!current || current.status !== 'active' || !current.expo_push_token) {
    throw Object.assign(new Error('This notification installation is not available.'), {
      code: 'COACH_MOBILE_INSTALLATION_UNAVAILABLE',
      statusCode: 403,
    })
  }

  const context = await loadCoachContext(authUser, current.context_id)
  if (context.contextId !== normalizeText(body.contextId || current.context_id)) {
    throw Object.assign(new Error('Refresh notifications for the active Coach context.'), {
      code: 'COACH_MOBILE_CONTEXT_REFRESH_REQUIRED',
      statusCode: 409,
    })
  }
  const detailLevel = normalizeDetailLevel(body.detailLevel)
  const { data, error } = await supabaseAdmin
    .from('coach_mobile_push_installations')
    .update({
      detail_level: detailLevel,
      enabled: detailLevel !== 'off' && body.enabled !== false,
      last_seen_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    })
    .eq('installation_id', installationId)
    .eq('auth_user_id', authUser.id)
    .select('context_id, platform, detail_level, enabled, status')
    .single()
  if (error) throw error
  return data
}

async function unbindInstallation(installationId, authUserId) {
  const { error } = await supabaseAdmin
    .from('coach_mobile_push_installations')
    .update({
      auth_user_id: null,
      user_profile_id: null,
      club_id: null,
      team_id: null,
      context_id: '',
      expo_push_token: null,
      enabled: false,
      status: 'unbound',
      updated_at: new Date().toISOString(),
    })
    .eq('installation_id', installationId)
    .eq('auth_user_id', authUserId)
  if (error) throw error
}

export default async function handler(request) {
  if (!['DELETE', 'GET', 'PATCH', 'POST'].includes(request.method)) {
    return failure(405, 'METHOD_NOT_ALLOWED', 'Method Not Allowed')
  }

  try {
    const authUser = await getAuthUser(request)
    const body = request.method === 'GET' ? {} : await parseBody(request)
    const installationId = getInstallationId(new URL(request.url), body)
    if (!UUID_PATTERN.test(installationId)) {
      return failure(400, 'COACH_MOBILE_INSTALLATION_REQUIRED', 'Choose a valid notification installation.')
    }

    if (request.method === 'GET') {
      const installation = await loadOwnedInstallation(installationId, authUser.id)
      if (installation?.status === 'active') await loadCoachContext(authUser, installation.context_id)
      return jsonResponse(200, {
        installation: publicInstallation(installation),
        success: true,
      })
    }
    if (request.method === 'DELETE') {
      await unbindInstallation(installationId, authUser.id)
      return jsonResponse(200, { success: true })
    }

    const installation =
      request.method === 'PATCH'
        ? await updatePreference({ authUser, body, installationId })
        : await registerInstallation({ authUser, body, installationId })
    return jsonResponse(200, {
      installation: publicInstallation(installation),
      success: true,
    })
  } catch (error) {
    const statusCode = Number(error?.statusCode || 500)
    if (statusCode >= 500) {
      console.error('Coach mobile notification installation failed', {
        code: normalizeText(error?.code || 'COACH_MOBILE_INSTALLATION_FAILED'),
        errorName: normalizeText(error?.name || 'Error'),
      })
    }
    return failure(
      statusCode,
      normalizeText(error?.code || 'COACH_MOBILE_INSTALLATION_FAILED'),
      statusCode >= 500
        ? 'Notification settings could not be saved.'
        : error.message || 'Notification settings could not be saved.',
    )
  }
}

export const config = {
  path: '/api/mobile/coach-push-installation',
}
