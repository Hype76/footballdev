import { Buffer } from 'node:buffer'
import { supabaseAdmin } from './lib/_supabase.js'

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
const EXPO_PUSH_TOKEN_PATTERN = /^(Exponent|Expo)PushToken\[[A-Za-z0-9_-]+\]$/
const MAX_REQUEST_BYTES = 4096

function normalizeText(value) {
  return String(value ?? '').trim()
}

function normalizeDetailLevel(value) {
  return normalizeText(value).toLowerCase() === 'detailed' ? 'detailed' : 'minimal'
}

function jsonResponse(statusCode, payload) {
  return {
    statusCode,
    headers: {
      'Cache-Control': 'private, no-store, max-age=0',
      'Content-Type': 'application/json; charset=utf-8',
      'X-Content-Type-Options': 'nosniff',
    },
    body: JSON.stringify(payload),
  }
}

function failure(statusCode, code, message) {
  return jsonResponse(statusCode, { success: false, code, message })
}

function getBearerToken(event) {
  const header = normalizeText(event.headers?.authorization || event.headers?.Authorization)
  const [scheme, token] = header.split(/\s+/, 2)
  return scheme?.toLowerCase() === 'bearer' ? normalizeText(token) : ''
}

async function getAuthUser(event) {
  const accessToken = getBearerToken(event)
  if (!accessToken) {
    throw Object.assign(new Error('Sign in again before changing notifications.'), {
      code: 'PARENT_MOBILE_SIGN_IN_REQUIRED',
      statusCode: 401,
    })
  }

  const { data, error } = await supabaseAdmin.auth.getUser(accessToken)
  if (error || !data?.user?.id) {
    throw Object.assign(new Error('Sign in again before changing notifications.'), {
      code: 'PARENT_MOBILE_SIGN_IN_REQUIRED',
      statusCode: 401,
    })
  }

  return data.user
}

function parseBody(event) {
  const rawBody = normalizeText(event.body)
  if (Buffer.byteLength(rawBody, 'utf8') > MAX_REQUEST_BYTES) {
    throw Object.assign(new Error('The notification request is too large.'), {
      code: 'PARENT_MOBILE_REQUEST_TOO_LARGE',
      statusCode: 413,
    })
  }

  try {
    const body = rawBody ? JSON.parse(rawBody) : {}
    if (!body || typeof body !== 'object' || Array.isArray(body)) throw new Error('invalid body')
    return body
  } catch {
    throw Object.assign(new Error('The notification request is not valid.'), {
      code: 'PARENT_MOBILE_REQUEST_INVALID',
      statusCode: 400,
    })
  }
}

function getInstallationId(event, body) {
  return normalizeText(body?.installationId || event.queryStringParameters?.installationId)
}

function publicInstallation(row) {
  return {
    detailLevel: normalizeDetailLevel(row?.detail_level),
    enabled: Boolean(row?.enabled && row?.status === 'active'),
    platform: normalizeText(row?.platform),
    registered: row?.status === 'active',
  }
}

async function loadOwnedInstallation(installationId, authUserId) {
  const { data, error } = await supabaseAdmin
    .from('parent_mobile_push_installations')
    .select('installation_id, auth_user_id, parent_link_id, club_id, team_id, expo_push_token, platform, detail_level, enabled, status')
    .eq('installation_id', installationId)
    .eq('auth_user_id', authUserId)
    .maybeSingle()

  if (error) throw error
  return data
}

async function loadParentLink(parentLinkId, authUserId) {
  const { data, error } = await supabaseAdmin
    .from('parent_player_links')
    .select('id, auth_user_id, club_id, team_id, status')
    .eq('id', parentLinkId)
    .eq('auth_user_id', authUserId)
    .eq('status', 'active')
    .maybeSingle()

  if (error) throw error
  if (!data) {
    throw Object.assign(new Error('This family portal link could not be opened.'), {
      code: 'PARENT_MOBILE_LINK_REQUIRED',
      statusCode: 403,
    })
  }
  return data
}

async function registerInstallation({ authUserId, body, installationId }) {
  const expoPushToken = normalizeText(body.expoPushToken)
  const parentLinkId = normalizeText(body.parentLinkId)
  const platform = normalizeText(body.platform).toLowerCase()

  if (!UUID_PATTERN.test(parentLinkId)
    || !['android', 'ios'].includes(platform)
    || expoPushToken.length > 512
    || !EXPO_PUSH_TOKEN_PATTERN.test(expoPushToken)) {
    throw Object.assign(new Error('The notification registration is not valid.'), {
      code: 'PARENT_MOBILE_REGISTRATION_INVALID',
      statusCode: 400,
    })
  }

  const parentLink = await loadParentLink(parentLinkId, authUserId)
  const { data: existing, error: existingError } = await supabaseAdmin
    .from('parent_mobile_push_installations')
    .select('auth_user_id, status')
    .eq('installation_id', installationId)
    .maybeSingle()

  if (existingError) throw existingError
  if (existing?.auth_user_id && existing.auth_user_id !== authUserId) {
    throw Object.assign(new Error('This installation belongs to another account.'), {
      code: 'PARENT_MOBILE_INSTALLATION_OWNED',
      statusCode: 403,
    })
  }

  const now = new Date().toISOString()
  const { error: revokeError } = await supabaseAdmin
    .from('parent_mobile_push_installations')
    .update({
      auth_user_id: null,
      parent_link_id: null,
      club_id: null,
      team_id: null,
      expo_push_token: null,
      enabled: false,
      status: 'revoked',
      updated_at: now,
    })
    .eq('expo_push_token', expoPushToken)
    .neq('installation_id', installationId)

  if (revokeError) throw revokeError

  const payload = {
    installation_id: installationId,
    auth_user_id: authUserId,
    parent_link_id: parentLink.id,
    club_id: parentLink.club_id,
    team_id: parentLink.team_id || null,
    expo_push_token: expoPushToken,
    platform,
    app_version: normalizeText(body.appVersion).slice(0, 40),
    build_number: normalizeText(body.buildNumber).slice(0, 40),
    detail_level: normalizeDetailLevel(body.detailLevel),
    enabled: true,
    status: 'active',
    last_seen_at: now,
    updated_at: now,
  }
  const { data, error } = await supabaseAdmin
    .from('parent_mobile_push_installations')
    .upsert(payload, { onConflict: 'installation_id' })
    .select('platform, detail_level, enabled, status')
    .single()

  if (error) throw error
  return data
}

async function updatePreference({ authUserId, body, installationId }) {
  const current = await loadOwnedInstallation(installationId, authUserId)
  if (!current || current.status !== 'active' || !current.expo_push_token) {
    throw Object.assign(new Error('This notification installation is not available.'), {
      code: 'PARENT_MOBILE_INSTALLATION_UNAVAILABLE',
      statusCode: 403,
    })
  }

  const { data, error } = await supabaseAdmin
    .from('parent_mobile_push_installations')
    .update({
      detail_level: normalizeDetailLevel(body.detailLevel),
      enabled: Boolean(body.enabled),
      last_seen_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    })
    .eq('installation_id', installationId)
    .eq('auth_user_id', authUserId)
    .select('platform, detail_level, enabled, status')
    .single()

  if (error) throw error
  return data
}

async function unbindInstallation(installationId, authUserId) {
  const { error } = await supabaseAdmin
    .from('parent_mobile_push_installations')
    .update({
      auth_user_id: null,
      parent_link_id: null,
      club_id: null,
      team_id: null,
      expo_push_token: null,
      enabled: false,
      status: 'unbound',
      updated_at: new Date().toISOString(),
    })
    .eq('installation_id', installationId)
    .eq('auth_user_id', authUserId)

  if (error) throw error
}

export async function handler(event) {
  if (!['DELETE', 'GET', 'PATCH', 'POST'].includes(event.httpMethod)) {
    return failure(405, 'METHOD_NOT_ALLOWED', 'Method Not Allowed')
  }

  try {
    const authUser = await getAuthUser(event)
    const body = event.httpMethod === 'GET' ? {} : parseBody(event)
    const installationId = getInstallationId(event, body)

    if (!UUID_PATTERN.test(installationId)) {
      return failure(400, 'PARENT_MOBILE_INSTALLATION_REQUIRED', 'Choose a valid notification installation.')
    }

    if (event.httpMethod === 'GET') {
      const installation = await loadOwnedInstallation(installationId, authUser.id)
      return jsonResponse(200, {
        installation: publicInstallation(installation),
        success: true,
      })
    }

    if (event.httpMethod === 'DELETE') {
      await unbindInstallation(installationId, authUser.id)
      return jsonResponse(200, { success: true })
    }

    const installation = event.httpMethod === 'PATCH'
      ? await updatePreference({ authUserId: authUser.id, body, installationId })
      : await registerInstallation({ authUserId: authUser.id, body, installationId })

    return jsonResponse(200, {
      installation: publicInstallation(installation),
      success: true,
    })
  } catch (error) {
    const statusCode = Number(error?.statusCode || 500)
    if (statusCode >= 500) {
      console.error('Parent mobile notification installation failed', {
        code: normalizeText(error?.code || 'PARENT_MOBILE_INSTALLATION_FAILED'),
        errorName: normalizeText(error?.name || 'Error'),
      })
    }
    return failure(
      statusCode,
      normalizeText(error?.code || 'PARENT_MOBILE_INSTALLATION_FAILED'),
      statusCode >= 500
        ? 'Notification settings could not be saved.'
        : error.message || 'Notification settings could not be saved.',
    )
  }
}
