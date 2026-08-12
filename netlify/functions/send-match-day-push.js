import process from 'node:process'
import webpush from 'web-push'
import { loadActiveAuthorityProfile } from './lib/_authority-profile.js'
import { supabaseAdmin } from './lib/_supabase.js'
import { sendExpoPushMessages } from './lib/_expo-push.js'
import { buildParentMatchDayNotificationCopy } from './lib/_match-day-notification-copy.js'
import { assertWorkspaceBillingAction } from './lib/_billing-access.js'
import { filterParentLinksForAppNotifications } from './lib/_parent-communication-preferences.js'

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
  const userProfile = await loadActiveAuthorityProfile(supabaseAdmin, authUser, {
    select: 'id, email, role, role_rank, club_id, status',
  })
  return {
    id: userProfile.id,
    email,
    role: normalizeText(userProfile.role),
    roleRank: Number(userProfile.role_rank ?? 0),
    clubId: userProfile.club_id,
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

async function authorizePush({ authUser, match, parentLinkId, type, eventId }) {
  const rpcArgs = {
    actor_user_id_value: authUser.id,
    match_day_id_value: match.id,
    parent_link_id_value: parentLinkId || null,
    notification_type_value: type,
    event_id_value: eventId || null,
  }
  const { data, error } = ['yellow_card', 'red_card'].includes(type)
    ? await supabaseAdmin.rpc('authorize_match_day_push_v2', rpcArgs)
    : await supabaseAdmin.rpc('authorize_match_day_push', rpcArgs)

  if (error) {
    throw error
  }

  return data || { allowed: false }
}

async function claimPushOperation({ authUser, match, type, eventId, operationKey }) {
  const { data, error } = await supabaseAdmin.rpc('claim_match_day_push_operation', {
    match_day_id_value: match.id,
    operation_key_value: operationKey,
    notification_type_value: type,
    event_id_value: eventId || null,
    actor_user_id_value: authUser.id,
  })

  if (error) {
    throw error
  }

  return data === true
}

async function completePushOperation({ operationKey, succeeded, errorMessage = '' }) {
  const { error } = await supabaseAdmin.rpc('complete_match_day_push_operation', {
    operation_key_value: operationKey,
    succeeded_value: succeeded === true,
    error_message_value: normalizeText(errorMessage),
  })

  if (error) {
    throw error
  }
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

async function getSubscriptions({ match, targetParentLinkIds }) {
  if (targetParentLinkIds.length === 0) {
    return []
  }

  let query = supabaseAdmin
    .from('parent_push_subscriptions')
    .select('id, endpoint, p256dh, auth')
    .eq('club_id', match.club_id)
    .eq('status', 'active')

  if (match.team_id) {
    query = query.eq('team_id', match.team_id)
  }

  query = query.in('parent_link_id', targetParentLinkIds)

  const { data, error } = await query

  if (error) {
    throw error
  }

  return data ?? []
}

async function getAppNotificationParentLinkIds(targetParentLinkIds) {
  if (targetParentLinkIds.length === 0) return []

  const { data, error } = await supabaseAdmin
    .from('parent_player_links')
    .select('id, auth_user_id')
    .in('id', targetParentLinkIds)
    .eq('status', 'active')

  if (error) throw error

  const links = await filterParentLinksForAppNotifications(supabaseAdmin, data || [])
  return links.map((link) => link.id)
}

async function getMobileDevices({ match, targetParentLinkIds }) {
  if (targetParentLinkIds.length === 0) {
    return []
  }

  let query = supabaseAdmin
    .from('parent_mobile_push_installations')
    .select('installation_id, auth_user_id, expo_push_token, parent_link_id, detail_level')
    .eq('club_id', match.club_id)
    .eq('status', 'active')
    .eq('enabled', true)
    .neq('detail_level', 'off')

  if (match.team_id) {
    query = query.eq('team_id', match.team_id)
  }

  query = query.in('parent_link_id', targetParentLinkIds)

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
    .from('parent_mobile_push_installations')
    .update({
      auth_user_id: null,
      parent_link_id: null,
      club_id: null,
      team_id: null,
      expo_push_token: null,
      enabled: false,
      status: 'revoked',
      updated_at: new Date().toISOString(),
    })
    .in('expo_push_token', tokens)

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

async function logNotificationEvents({ devices, match, payload, status }) {
  if (devices.length === 0) {
    return
  }

  const now = new Date().toISOString()
  const { error } = await supabaseAdmin
    .from('parent_mobile_notification_events')
    .insert(devices.map((device) => ({
      installation_id: device.installation_id,
      auth_user_id: device.auth_user_id,
      body: device.detail_level === 'detailed' ? payload.detailedBody : payload.minimalBody,
      club_id: match.club_id,
      data: payload.data || {},
      intent_type: 'matchday_update',
      parent_link_id: device.parent_link_id || null,
      title: payload.title,
      status,
      sent_at: status === 'sent' ? now : null,
      team_id: match.team_id || null,
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

  let claimedOperationKey = ''

  try {
    const webPushConfigured = configureWebPush()

    const authUser = await getAuthUser(event)
    const profile = await getProfile(authUser)
    const body = JSON.parse(event.body || '{}')
    const matchDayId = normalizeText(body.matchDayId)
    const type = normalizeText(body.type)
    const parentLinkId = normalizeText(body.parentLinkId)
    const eventId = normalizeText(body.eventId)

    if (!matchDayId) {
      return failureResponse(400, 'Match Day is required.')
    }

    const match = await getMatch(matchDayId)
    await assertWorkspaceBillingAction({ clubId: match.club_id, profile })
    const authorization = await authorizePush({ authUser, match, parentLinkId, type, eventId })

    if (authorization.allowed !== true) {
      return failureResponse(403, 'You cannot send notifications for this match.')
    }

    const targetParentLinkIds = Array.isArray(authorization.targetParentLinkIds)
      ? authorization.targetParentLinkIds.map(normalizeText).filter(Boolean)
      : []
    const operationKey = normalizeText(authorization.operationKey)
    const claimed = await claimPushOperation({ authUser, match, type, eventId, operationKey })

    if (!claimed) {
      return jsonResponse(200, {
        success: true,
        duplicate: true,
        sent: 0,
        revoked: 0,
        mobileSent: 0,
        mobileFailed: 0,
      })
    }
    claimedOperationKey = operationKey

    let eventRow = null

    if (eventId) {
      const { data, error } = await supabaseAdmin
        .from('match_day_events')
        .select('*')
        .eq('id', eventId)
        .eq('match_day_id', match.id)
        .maybeSingle()

      if (error) {
        throw error
      }

      eventRow = data
    }

    const appNotificationParentLinkIds = await getAppNotificationParentLinkIds(targetParentLinkIds)
    const subscriptions = await getSubscriptions({
      match,
      targetParentLinkIds: appNotificationParentLinkIds,
    })
    const mobileDevices = await getMobileDevices({
      match,
      targetParentLinkIds: appNotificationParentLinkIds,
    })
    const notificationCopy = buildParentMatchDayNotificationCopy({ match, type, event: eventRow })
    const payload = {
      body: notificationCopy.detailedBody,
      renotify: notificationCopy.renotify,
      tag: notificationCopy.tag,
      title: notificationCopy.title,
      url: `/parent-portal?section=matches&matchDayId=${encodeURIComponent(match.id)}`,
      icon: '/icons/icon-192.png',
      badge: '/icons/favicon-48.png',
    }
    const results = webPushConfigured
      ? await Promise.all(subscriptions.map((subscription) => sendToSubscription(subscription, payload)))
      : []
    const sent = results.filter((result) => result.sent).length
    const revoked = results.filter((result) => result.revoked).length
    const nativePayload = {
      title: notificationCopy.title,
      detailedBody: notificationCopy.detailedBody,
      minimalBody: notificationCopy.minimalBody,
      type,
      data: {
        app: 'parent',
        route: 'matchday',
        matchDayId: match.id,
        type,
      },
    }
    const mobileResult = await sendExpoPushMessages(mobileDevices.map((device) => ({
      to: device.expo_push_token,
      title: nativePayload.title,
      body: device.detail_level === 'detailed' ? nativePayload.detailedBody : nativePayload.minimalBody,
      data: {
        ...nativePayload.data,
        parentLinkId: device.parent_link_id,
      },
      sound: 'default',
    })))
    await revokeMobileDeviceTokens(mobileResult.invalidTokens || [])

    await logNotificationEvents({
      devices: mobileDevices,
      match,
      payload: nativePayload,
      status: mobileResult.failed > 0 && mobileResult.sent === 0 ? 'failed' : 'sent',
    })
    await completePushOperation({ operationKey, succeeded: true })
    claimedOperationKey = ''

    return jsonResponse(200, {
      success: true,
      sent,
      revoked,
      mobileSent: mobileResult.sent,
      mobileFailed: mobileResult.failed,
    })
  } catch (error) {
    if (claimedOperationKey) {
      try {
        await completePushOperation({
          operationKey: claimedOperationKey,
          succeeded: false,
          errorMessage: error.message,
        })
      } catch (completionError) {
        console.error('Match Day push operation completion failed', completionError)
      }
    }

    console.error(error)
    return failureResponse(error.statusCode || 500, error.message || 'Match Day notifications could not be sent.')
  }
}
