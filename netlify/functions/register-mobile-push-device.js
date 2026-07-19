import { loadActiveAuthorityProfile } from './lib/_authority-profile.js'
import { supabaseAdmin } from './lib/_supabase.js'

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

function getBearerToken(event) {
  const header = event.headers.authorization || event.headers.Authorization || ''
  return header.startsWith('Bearer ') ? header.slice(7) : ''
}

function normalizeText(value) {
  return String(value ?? '').trim()
}

async function getAuthUser(event) {
  const token = getBearerToken(event)

  if (!token) {
    throw Object.assign(new Error('Login is required.'), { statusCode: 401 })
  }

  const { data, error } = await supabaseAdmin.auth.getUser(token)

  if (error || !data?.user) {
    throw Object.assign(new Error('Login is required.'), { statusCode: 401 })
  }

  return data.user
}

async function getStaffProfile(authUser) {
  return loadActiveAuthorityProfile(supabaseAdmin, authUser, {
    select: 'id, club_id, role, role_rank, status',
  })
}

async function getParentLink(parentLinkId, authUserId) {
  const { data, error } = await supabaseAdmin
    .from('parent_player_links')
    .select('id, club_id, team_id, auth_user_id, status')
    .eq('id', parentLinkId)
    .eq('auth_user_id', authUserId)
    .eq('status', 'active')
    .maybeSingle()

  if (error) {
    throw error
  }

  return data
}

async function buildDevicePayload({ authUser, body }) {
  const appRole = normalizeText(body.appRole)
  const deviceToken = normalizeText(body.deviceToken)

  if (!['coach', 'parent'].includes(appRole)) {
    throw Object.assign(new Error('A valid mobile app role is required.'), { statusCode: 400 })
  }

  if (!deviceToken.startsWith('ExponentPushToken[')) {
    throw Object.assign(new Error('A valid Expo push token is required.'), { statusCode: 400 })
  }

  if (appRole === 'parent') {
    const parentLinkId = normalizeText(body.parentLinkId)
    const parentLink = await getParentLink(parentLinkId, authUser.id)

    if (!parentLink) {
      throw Object.assign(new Error('This family portal link could not be opened.'), { statusCode: 403 })
    }

    return {
      app_role: appRole,
      auth_user_id: authUser.id,
      club_id: parentLink.club_id,
      team_id: parentLink.team_id || null,
      parent_link_id: parentLink.id,
      user_profile_id: null,
      device_token: deviceToken,
    }
  }

  const profile = await getStaffProfile(authUser)

  if (profile.role === 'parent_portal' || profile.role === 'super_admin' || Number(profile.role_rank ?? 0) < 20) {
    throw Object.assign(new Error('This staff account cannot register mobile notifications.'), { statusCode: 403 })
  }

  return {
    app_role: appRole,
    auth_user_id: authUser.id,
    club_id: profile.club_id,
    team_id: normalizeText(body.teamId) || null,
    parent_link_id: null,
    user_profile_id: profile.id,
    device_token: deviceToken,
  }
}

export async function handler(event) {
  if (!['POST', 'DELETE'].includes(event.httpMethod)) {
    return failureResponse(405, 'Method Not Allowed')
  }

  try {
    const authUser = await getAuthUser(event)
    const body = JSON.parse(event.body || '{}')
    const deviceToken = normalizeText(body.deviceToken)

    if (!deviceToken) {
      return failureResponse(400, 'Device token is required.')
    }

    if (event.httpMethod === 'DELETE') {
      const { error } = await supabaseAdmin
        .from('mobile_push_devices')
        .update({
          status: 'revoked',
          notification_enabled: false,
          updated_at: new Date().toISOString(),
        })
        .eq('auth_user_id', authUser.id)
        .eq('device_token', deviceToken)

      if (error) {
        throw error
      }

      return jsonResponse(200, { success: true })
    }

    const payload = await buildDevicePayload({ authUser, body })
    const { error } = await supabaseAdmin
      .from('mobile_push_devices')
      .upsert({
        ...payload,
        platform: normalizeText(body.platform) || 'unknown',
        metadata: {
          channelId: normalizeText(body.channelId) || 'matchday',
        },
        device_name: normalizeText(body.deviceName).slice(0, 120),
        status: 'active',
        notification_enabled: true,
        last_registered_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      }, {
        onConflict: 'device_token',
      })

    if (error) {
      throw error
    }

    return jsonResponse(200, { success: true })
  } catch (error) {
    console.error(error)
    return failureResponse(error.statusCode || 500, error.message || 'Mobile notification device could not be registered.')
  }
}
