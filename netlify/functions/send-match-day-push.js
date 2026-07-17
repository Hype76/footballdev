import process from 'node:process'
import webpush from 'web-push'
import { supabaseAdmin } from './lib/_supabase.js'
import { sendExpoPushMessages } from './lib/_expo-push.js'
import { getMatchDayDisplayName, getMatchDayDisplayScore } from '../../src/lib/matchday-display.js'

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

  return code === '42P01' || code === 'PGRST205' || message.includes('relation') && message.includes('does not exist')
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
      id: userProfile.id,
      email,
      role: normalizeText(userProfile.role),
      roleRank: Number(userProfile.role_rank ?? 0),
      clubId: userProfile.club_id,
    }
  }

  const { data: membership, error: membershipError } = await supabaseAdmin
    .from('user_club_memberships')
    .select('auth_user_id, email, role, role_rank, club_id')
    .or(`auth_user_id.eq.${authUser.id},email.eq.${email}`)
    .maybeSingle()

  if (membershipError) {
    throw membershipError
  }

  if (!membership) {
    return {
      id: authUser.id,
      email,
      role: 'parent_portal',
      roleRank: 0,
      clubId: '',
    }
  }

  return {
    id: membership.auth_user_id,
    email,
    role: normalizeText(membership.role),
    roleRank: Number(membership.role_rank ?? 0),
    clubId: membership.club_id,
  }
}

async function getMatch(matchDayId) {
  const { data, error } = await supabaseAdmin
    .from('match_days')
    .select('*, teams:team_id (name)')
    .eq('id', matchDayId)
    .is('deleted_at', null)
    .maybeSingle()

  if (error || !data) {
    throw Object.assign(new Error('Match Day could not be found.'), { statusCode: 404 })
  }

  return data
}

async function canSendForMatch({ authUser, profile, match, parentLinkId }) {
  if (profile.role !== 'parent_portal' && profile.clubId === match.club_id && profile.roleRank >= 20) {
    return true
  }

  if (parentLinkId) {
    const { data } = await supabaseAdmin
      .from('match_day_scorer_assignments')
      .select('id')
      .eq('match_day_id', match.id)
      .eq('parent_link_id', parentLinkId)
      .eq('auth_user_id', authUser.id)
      .maybeSingle()

    return Boolean(data?.id)
  }

  return false
}

function configureWebPush() {
  const publicKey = normalizeText(process.env.VITE_WEB_PUSH_PUBLIC_KEY || process.env.WEB_PUSH_PUBLIC_KEY)
  const privateKey = normalizeText(process.env.WEB_PUSH_PRIVATE_KEY)
  const subject = normalizeText(process.env.WEB_PUSH_SUBJECT) || 'mailto:support@footballplayer.online'

  if (!publicKey || !privateKey) {
    return false
  }

  webpush.setVapidDetails(subject, publicKey, privateKey)
  return true
}

function getTeamName(match) {
  const team = Array.isArray(match.teams) ? match.teams[0] : match.teams
  return normalizeText(team?.name) || 'Our team'
}

function buildPayload({ match, type, event }) {
  const teamName = getTeamName(match)
  const matchName = getMatchDayDisplayName({ ...match, teamName })
  const scoreLine = `${matchName}: ${getMatchDayDisplayScore(match)}`
  const eventScorer = normalizeText(event?.scorer_initials || event?.scorer_name)
  const isOpponentGoal = normalizeText(event?.team_side) === 'opponent'
  const minute = event?.minute !== null && event?.minute !== undefined ? `${event.minute}' ` : ''

  if (type === 'goal') {
    return {
      title: isOpponentGoal ? 'Goal update' : 'Goal!',
      body: isOpponentGoal ? `${minute}${scoreLine}` : `${minute}${eventScorer || teamName} ${scoreLine}`,
      tag: `match-day-${match.id}-goal-${event?.id || Date.now()}`,
      renotify: true,
    }
  }

  if (type === 'score_correction') {
    return {
      title: 'Score corrected',
      body: scoreLine,
      tag: `match-day-${match.id}-score-correction-${event?.id || Date.now()}`,
      renotify: true,
    }
  }

  if (type === 'half_time') {
    return {
      title: 'Half time',
      body: scoreLine,
      tag: `match-day-${match.id}-half-time`,
    }
  }

  if (type === 'second_half') {
    return {
      title: 'Second half started',
      body: scoreLine,
      tag: `match-day-${match.id}-second-half`,
    }
  }

  if (type === 'extra_time') {
    return {
      title: 'Extra time',
      body: scoreLine,
      tag: `match-day-${match.id}-extra-time`,
      renotify: true,
    }
  }

  if (type === 'penalties') {
    return {
      title: 'Penalties',
      body: scoreLine,
      tag: `match-day-${match.id}-penalties`,
      renotify: true,
    }
  }

  if (type === 'full_time') {
    return {
      title: 'Full time',
      body: scoreLine,
      tag: `match-day-${match.id}-full-time`,
      renotify: true,
    }
  }

  if (type === 'scorer_selected') {
    return {
      title: 'You are the Match Day scorer',
      body: matchName,
      tag: `match-day-${match.id}-scorer-selected`,
      renotify: true,
    }
  }

  if (type === 'scorer_request') {
    return {
      title: 'Scorer needed',
      body: matchName,
      tag: `match-day-${match.id}-scorer-request`,
    }
  }

  return {
    title: 'Match Day update',
    body: scoreLine,
    tag: `match-day-${match.id}-update`,
  }
}

async function getSubscriptions({ match, targetParentLinkIds }) {
  let query = supabaseAdmin
    .from('parent_push_subscriptions')
    .select('id, endpoint, p256dh, auth')
    .eq('club_id', match.club_id)
    .eq('status', 'active')

  if (match.team_id) {
    query = query.eq('team_id', match.team_id)
  }

  if (targetParentLinkIds.length > 0) {
    query = query.in('parent_link_id', targetParentLinkIds)
  }

  const { data, error } = await query

  if (error) {
    throw error
  }

  return data ?? []
}

async function getMobileDevices({ match, targetParentLinkIds }) {
  let query = supabaseAdmin
    .from('mobile_push_devices')
    .select('id, auth_user_id, device_token, parent_link_id')
    .eq('club_id', match.club_id)
    .eq('app_role', 'parent')
    .eq('status', 'active')
    .eq('notification_enabled', true)

  if (match.team_id) {
    query = query.eq('team_id', match.team_id)
  }

  if (targetParentLinkIds.length > 0) {
    query = query.in('parent_link_id', targetParentLinkIds)
  }

  const { data, error } = await query

  if (error) {
    if (isMissingTableError(error)) {
      console.warn('Mobile push devices table is not available; skipping native match day push.')
      return []
    }

    throw error
  }

  return data ?? []
}

async function markSubscriptionRevoked(subscriptionId) {
  await supabaseAdmin
    .from('parent_push_subscriptions')
    .update({
      status: 'revoked',
      updated_at: new Date().toISOString(),
    })
    .eq('id', subscriptionId)
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

    console.error('Mobile push device revoke failed', error)
  }
}

async function sendToSubscription(subscription, payload) {
  try {
    await webpush.sendNotification(
      {
        endpoint: subscription.endpoint,
        keys: {
          p256dh: subscription.p256dh,
          auth: subscription.auth,
        },
      },
      JSON.stringify(payload),
    )

    return { sent: true }
  } catch (error) {
    if (error.statusCode === 404 || error.statusCode === 410) {
      await markSubscriptionRevoked(subscription.id)
      return { sent: false, revoked: true }
    }

    console.error('Push send failed', error)
    return { sent: false }
  }
}

async function logNotificationEvents({ channel, devices, match, payload, status }) {
  if (devices.length === 0) {
    return
  }

  const now = new Date().toISOString()
  const { error } = await supabaseAdmin
    .from('notification_events')
    .insert(devices.map((device) => ({
      club_id: match.club_id,
      team_id: match.team_id || null,
      parent_link_id: device.parent_link_id || null,
      target_auth_user_id: device.auth_user_id,
      channel,
      notification_type: normalizeText(payload.type) || 'match_day',
      title: payload.title,
      body: payload.body,
      data: payload.data || {},
      status,
      sent_at: status === 'sent' ? now : null,
    })))

  if (error) {
    if (isMissingTableError(error)) {
      console.warn('Notification events table is not available; skipping mobile push event log.')
      return
    }

    console.error('Notification event log failed', error)
  }
}

export async function handler(event) {
  if (event.httpMethod !== 'POST') {
    return failureResponse(405, 'Method Not Allowed')
  }

  try {
    const webPushConfigured = configureWebPush()

    const authUser = await getAuthUser(event)
    const profile = await getProfile(authUser)
    const body = JSON.parse(event.body || '{}')
    const matchDayId = normalizeText(body.matchDayId)
    const type = normalizeText(body.type) || 'update'
    const parentLinkId = normalizeText(body.parentLinkId)
    const targetParentLinkIds = Array.isArray(body.targetParentLinkIds)
      ? body.targetParentLinkIds.map(normalizeText).filter(Boolean)
      : []

    if (!matchDayId) {
      return failureResponse(400, 'Match Day is required.')
    }

    const match = await getMatch(matchDayId)
    const isAllowed = await canSendForMatch({ authUser, profile, match, parentLinkId })

    if (!isAllowed) {
      return failureResponse(403, 'You cannot send notifications for this match.')
    }

    let eventRow = null

    if (body.eventId) {
      const { data, error } = await supabaseAdmin
        .from('match_day_events')
        .select('*')
        .eq('id', body.eventId)
        .eq('match_day_id', match.id)
        .maybeSingle()

      if (error) {
        throw error
      }

      eventRow = data
    }

    const subscriptions = await getSubscriptions({
      match,
      targetParentLinkIds,
    })
    const mobileDevices = await getMobileDevices({
      match,
      targetParentLinkIds,
    })
    const payload = {
      ...buildPayload({ match, type, event: eventRow }),
      url: '/parent-portal',
      icon: '/icons/icon-192.png',
      badge: '/icons/favicon-48.png',
    }
    const results = webPushConfigured
      ? await Promise.all(subscriptions.map((subscription) => sendToSubscription(subscription, payload)))
      : []
    const sent = results.filter((result) => result.sent).length
    const revoked = results.filter((result) => result.revoked).length
    const nativePayload = {
      title: payload.title,
      body: payload.body,
      type,
      data: {
        app: 'parent',
        route: 'parent-portal',
        matchDayId: match.id,
        type,
      },
    }
    const mobileResult = await sendExpoPushMessages(mobileDevices.map((device) => ({
      to: device.device_token,
      title: nativePayload.title,
      body: nativePayload.body,
      data: nativePayload.data,
      sound: 'default',
    })))
    await revokeMobileDeviceTokens(mobileResult.invalidTokens || [])

    await logNotificationEvents({
      channel: 'mobile_push',
      devices: mobileDevices,
      match,
      payload: nativePayload,
      status: mobileResult.failed > 0 && mobileResult.sent === 0 ? 'failed' : 'sent',
    })

    return jsonResponse(200, {
      success: true,
      sent,
      revoked,
      mobileSent: mobileResult.sent,
      mobileFailed: mobileResult.failed,
    })
  } catch (error) {
    console.error(error)
    return failureResponse(error.statusCode || 500, error.message || 'Match Day notifications could not be sent.')
  }
}
