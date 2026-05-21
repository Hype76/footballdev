import { sendExpoPushMessages } from './_expo-push.js'
import { supabaseAdmin } from './_supabase.js'

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

async function getProfile(authUser) {
  const email = normalizeText(authUser.email).toLowerCase()
  const { data: userProfile, error: userError } = await supabaseAdmin
    .from('users')
    .select('id, email, role, role_rank, club_id')
    .or(`id.eq.${authUser.id},email.eq.${email}`)
    .maybeSingle()

  if (userError) {
    throw userError
  }

  if (userProfile) {
    return {
      clubId: userProfile.club_id,
      email,
      id: userProfile.id,
      role: normalizeText(userProfile.role),
      roleRank: Number(userProfile.role_rank ?? 0),
    }
  }

  const { data: parentLink, error: parentError } = await supabaseAdmin
    .from('parent_player_links')
    .select('id, club_id, team_id, status')
    .eq('auth_user_id', authUser.id)
    .eq('status', 'active')
    .maybeSingle()

  if (parentError) {
    throw parentError
  }

  if (parentLink) {
    return {
      clubId: parentLink.club_id,
      email,
      id: authUser.id,
      parentLinkId: parentLink.id,
      role: 'parent_portal',
      roleRank: 0,
      teamId: parentLink.team_id,
    }
  }

  return {
    clubId: '',
    email,
    id: authUser.id,
    role: 'unknown',
    roleRank: 0,
  }
}

async function getMatch(matchDayId) {
  const { data, error } = await supabaseAdmin
    .from('match_days')
    .select('id, club_id, team_id, opponent, teams:team_id (name)')
    .eq('id', matchDayId)
    .maybeSingle()

  if (error || !data) {
    throw Object.assign(new Error('Match Day could not be found.'), { statusCode: 404 })
  }

  return data
}

async function canNotifyCoaches({ authUser, match, profile, type }) {
  if (profile.role !== 'parent_portal' && profile.clubId === match.club_id && profile.roleRank >= 20) {
    return true
  }

  if (type === 'scorer_volunteer' && profile.role === 'parent_portal') {
    const { data, error } = await supabaseAdmin
      .from('match_day_scorer_interest')
      .select('id')
      .eq('match_day_id', match.id)
      .eq('auth_user_id', authUser.id)
      .maybeSingle()

    if (error) {
      throw error
    }

    return Boolean(data?.id)
  }

  return false
}

function getTeamName(match) {
  const team = Array.isArray(match.teams) ? match.teams[0] : match.teams
  return normalizeText(team?.name) || 'Your team'
}

function buildPayload({ match, profile, type }) {
  const teamName = getTeamName(match)
  const opponent = normalizeText(match.opponent) || 'Opponent'

  if (type === 'scorer_volunteer') {
    return {
      body: `${profile.email} volunteered for ${teamName} v ${opponent}.`,
      data: {
        app: 'coach',
        matchDayId: match.id,
        route: 'matchday',
        type,
      },
      title: 'Scorer volunteer',
      type,
    }
  }

  return {
    body: `${teamName} v ${opponent}`,
    data: {
      app: 'coach',
      matchDayId: match.id,
      route: 'matchday',
      type,
    },
    title: 'Coach update',
    type,
  }
}

async function getCoachDevices(match) {
  let query = supabaseAdmin
    .from('mobile_push_devices')
    .select('id, auth_user_id, device_token, team_id')
    .eq('club_id', match.club_id)
    .eq('app_role', 'coach')
    .eq('status', 'active')
    .eq('notification_enabled', true)

  if (match.team_id) {
    query = query.or(`team_id.is.null,team_id.eq.${match.team_id}`)
  }

  const { data, error } = await query

  if (error) {
    throw error
  }

  return data ?? []
}

async function logNotificationEvents({ devices, match, payload, status }) {
  if (devices.length === 0) {
    return
  }

  const now = new Date().toISOString()
  const { error } = await supabaseAdmin
    .from('notification_events')
    .insert(devices.map((device) => ({
      body: payload.body,
      channel: 'mobile_push',
      club_id: match.club_id,
      data: payload.data,
      notification_type: payload.type,
      parent_link_id: null,
      sent_at: status === 'sent' ? now : null,
      status,
      target_auth_user_id: device.auth_user_id,
      team_id: match.team_id || null,
      title: payload.title,
    })))

  if (error) {
    console.error('Coach notification event log failed', error)
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
    console.error('Coach mobile push device revoke failed', error)
  }
}

export async function handler(event) {
  if (event.httpMethod !== 'POST') {
    return failureResponse(405, 'Method Not Allowed')
  }

  try {
    const authUser = await getAuthUser(event)
    const profile = await getProfile(authUser)
    const body = JSON.parse(event.body || '{}')
    const matchDayId = normalizeText(body.matchDayId)
    const type = normalizeText(body.type) || 'coach_update'

    if (!matchDayId) {
      return failureResponse(400, 'Match Day is required.')
    }

    const match = await getMatch(matchDayId)
    const isAllowed = await canNotifyCoaches({ authUser, match, profile, type })

    if (!isAllowed) {
      return failureResponse(403, 'You cannot send coach notifications for this match.')
    }

    const devices = await getCoachDevices(match)
    const payload = buildPayload({ match, profile, type })
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
      match,
      payload,
      status: pushResult.failed > 0 && pushResult.sent === 0 ? 'failed' : 'sent',
    })

    return jsonResponse(200, {
      failed: pushResult.failed,
      sent: pushResult.sent,
      success: true,
    })
  } catch (error) {
    console.error(error)
    return failureResponse(error.statusCode || 500, error.message || 'Coach notifications could not be sent.')
  }
}
