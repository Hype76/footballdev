import { sendExpoPushMessages } from './lib/_expo-push.js'
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

function isMissingTableError(error) {
  const code = String(error?.code ?? '').trim()
  const message = String(error?.message ?? '').toLowerCase()

  return code === '42P01' || message.includes('relation') && message.includes('does not exist')
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
  const email = normalizeText(authUser.email).toLowerCase()
  const { data, error } = await supabaseAdmin
    .from('users')
    .select('id, email, role, role_rank, club_id')
    .or(`id.eq.${authUser.id},email.eq.${email}`)
    .maybeSingle()

  if (error) {
    throw error
  }

  if (!data || normalizeText(data.role) === 'parent_portal' || Number(data.role_rank ?? 0) < 20) {
    throw Object.assign(new Error('Club staff access is required.'), { statusCode: 403 })
  }

  return {
    clubId: data.club_id,
    id: data.id,
    role: normalizeText(data.role),
    roleRank: Number(data.role_rank ?? 0),
  }
}

async function getMessagePayload({ id, profile }) {
  const { data: log, error } = await supabaseAdmin
    .from('communication_logs')
    .select('id, club_id, player_id, user_name, metadata, created_at')
    .eq('id', id)
    .eq('club_id', profile.clubId)
    .eq('channel', 'email')
    .eq('action', 'parent_email_sent')
    .maybeSingle()

  if (error || !log) {
    throw Object.assign(new Error('Parent message could not be found.'), { statusCode: 404 })
  }

  const metadata = log.metadata && typeof log.metadata === 'object' ? log.metadata : {}
  const title = normalizeText(metadata.subject) || 'New club message'
  const body = normalizeText(metadata.playerName)
    ? `${normalizeText(metadata.playerName)} has a new message.`
    : 'A new club message is available.'

  return {
    clubId: log.club_id,
    data: {
      app: 'parent',
      communicationLogId: log.id,
      route: 'messages',
      type: 'parent_message',
    },
    parentLinkQuery: (query) => query.eq('player_id', log.player_id),
    teamId: null,
    title,
    body,
    type: 'parent_message',
  }
}

async function getPollPayload({ id, profile }) {
  const { data: poll, error } = await supabaseAdmin
    .from('polls')
    .select('id, club_id, team_id, title, description, audience, status')
    .eq('id', id)
    .eq('club_id', profile.clubId)
    .eq('audience', 'parents')
    .eq('status', 'open')
    .maybeSingle()

  if (error || !poll) {
    throw Object.assign(new Error('Parent poll could not be found.'), { statusCode: 404 })
  }

  return {
    clubId: poll.club_id,
    data: {
      app: 'parent',
      pollId: poll.id,
      route: 'polls',
      type: 'parent_poll',
    },
    parentLinkQuery: (query) => poll.team_id ? query.eq('team_id', poll.team_id) : query,
    teamId: poll.team_id || null,
    title: 'New parent poll',
    body: normalizeText(poll.title) || 'A new club poll is open.',
    type: 'parent_poll',
  }
}

async function getTargetParentLinks(payload) {
  let query = supabaseAdmin
    .from('parent_player_links')
    .select('id, auth_user_id, club_id, team_id')
    .eq('club_id', payload.clubId)
    .eq('status', 'active')

  query = payload.parentLinkQuery(query)
  const { data, error } = await query

  if (error) {
    if (isMissingTableError(error)) {
      console.warn('Mobile push devices table is not available; skipping native parent push.')
      return []
    }

    throw error
  }

  return data ?? []
}

async function getMobileDevices({ clubId, parentLinkIds, teamId }) {
  if (parentLinkIds.length === 0) {
    return []
  }

  let query = supabaseAdmin
    .from('mobile_push_devices')
    .select('id, auth_user_id, device_token, parent_link_id')
    .eq('club_id', clubId)
    .eq('app_role', 'parent')
    .eq('status', 'active')
    .eq('notification_enabled', true)
    .in('parent_link_id', parentLinkIds)

  if (teamId) {
    query = query.eq('team_id', teamId)
  }

  const { data, error } = await query

  if (error) {
    throw error
  }

  return data ?? []
}

async function logNotificationEvents({ devices, payload, status }) {
  if (devices.length === 0) {
    return
  }

  const now = new Date().toISOString()
  const { error } = await supabaseAdmin
    .from('notification_events')
    .insert(devices.map((device) => ({
      body: payload.body,
      channel: 'mobile_push',
      club_id: payload.clubId,
      data: payload.data,
      notification_type: payload.type,
      parent_link_id: device.parent_link_id || null,
      sent_at: status === 'sent' ? now : null,
      status,
      target_auth_user_id: device.auth_user_id,
      team_id: payload.teamId || null,
      title: payload.title,
    })))

  if (error) {
    if (isMissingTableError(error)) {
      console.warn('Notification events table is not available; skipping parent mobile push event log.')
      return
    }

    console.error('Parent mobile notification event log failed', error)
  }
}

async function revokeMobileDeviceTokens(deviceTokens) {
  const tokens = [...new Set(deviceTokens.map(normalizeText).filter(Boolean))]

  if (tokens.length === 0) {
    return
  }

  const { error } = await supabaseAdmin
    .from('mobile_push_devices')
    .update({
      notification_enabled: false,
      status: 'revoked',
      updated_at: new Date().toISOString(),
    })
    .in('device_token', tokens)

  if (error) {
    if (isMissingTableError(error)) {
      console.warn('Mobile push devices table is not available; skipping invalid token revocation.')
      return
    }

    console.error('Parent mobile push device revoke failed', error)
  }
}

export async function sendParentMobilePushById({ id, profile, type }) {
  const payload = type === 'parent_message'
    ? await getMessagePayload({ id, profile })
    : await getPollPayload({ id, profile })
  const parentLinks = await getTargetParentLinks(payload)
  const devices = await getMobileDevices({
    clubId: payload.clubId,
    parentLinkIds: parentLinks.map((link) => link.id).filter(Boolean),
    teamId: payload.teamId,
  })
  const pushResult = await sendExpoPushMessages(devices.map((device) => ({
    body: payload.body,
    data: payload.data,
    sound: 'default',
    title: payload.title,
    to: device.device_token,
  })))
  await revokeMobileDeviceTokens(pushResult.invalidTokens || [])

  await logNotificationEvents({
    devices,
    payload,
    status: pushResult.failed > 0 && pushResult.sent === 0 ? 'failed' : 'sent',
  })

  return {
    failed: pushResult.failed,
    parentLinks: parentLinks.length,
    sent: pushResult.sent,
  }
}

export async function handler(event) {
  if (event.httpMethod !== 'POST') {
    return failureResponse(405, 'Method Not Allowed')
  }

  try {
    const authUser = await getAuthUser(event)
    const profile = await getStaffProfile(authUser)
    const body = JSON.parse(event.body || '{}')
    const type = normalizeText(body.type)
    const id = normalizeText(body.id)

    if (!id || !['parent_message', 'parent_poll'].includes(type)) {
      return failureResponse(400, 'A valid parent notification type and id are required.')
    }

    const pushResult = await sendParentMobilePushById({ id, profile, type })

    return jsonResponse(200, {
      ...pushResult,
      success: true,
    })
  } catch (error) {
    console.error(error)
    return failureResponse(error.statusCode || 500, error.message || 'Parent notifications could not be sent.')
  }
}
