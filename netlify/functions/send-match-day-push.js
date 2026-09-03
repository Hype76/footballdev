import process from 'node:process'
import webpush from 'web-push'
import { loadActiveAuthorityProfile } from './lib/_authority-profile.js'
import { supabaseAdmin } from './lib/_supabase.js'
import { sendExpoPushMessages } from './lib/_expo-push.js'
import { buildParentMatchDayNotificationCopy } from './lib/_match-day-notification-copy.js'
import { assertWorkspaceBillingAction } from './lib/_billing-access.js'
import { filterParentLinksForAppNotifications } from './lib/_parent-communication-preferences.js'
import { writeParentNotificationInbox } from './lib/_parent-notification-inbox.js'
import { resolveMatchDayNotificationTeamName } from '../../src/lib/team-notification-display.js'
import { sendCoachMatchReviewPush } from './send-coach-mobile-push.js'

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

async function getProfile(authUser, match, parentLinkId = '') {
  const email = normalizeText(authUser.email).toLowerCase()
  if (parentLinkId) {
    const { data: parentLink, error: linkError } = await supabaseAdmin
      .from('parent_player_links')
      .select('id')
      .eq('id', parentLinkId)
      .eq('auth_user_id', authUser.id)
      .eq('club_id', match.club_id)
      .eq('team_id', match.team_id)
      .eq('status', 'active')
      .maybeSingle()
    if (linkError) throw linkError
    if (parentLink) {
      const { data: suspended, error: suspendedError } = await supabaseAdmin
        .from('users').select('id, role, club_id').eq('id', authUser.id).eq('status', 'suspended').maybeSingle()
      if (suspendedError) throw suspendedError
      const club = Array.isArray(match.clubs) ? match.clubs[0] : match.clubs
      if ((suspended && (suspended.role === 'parent_portal' || suspended.club_id === match.club_id))
        || normalizeText(club?.status || 'active') !== 'active') {
        throw Object.assign(new Error('Your Parent access is not active.'), { statusCode: 403 })
      }
      return { id: authUser.id, email, role: 'parent_portal', roleRank: 0, clubId: match.club_id }
    }
  }
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
    .select('*, teams:team_id (name, notification_display_name), clubs:club_id (name, status)')
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
  const { data, error } = ['yellow_card', 'red_card', 'substitution'].includes(type)
    ? await supabaseAdmin.rpc('authorize_match_day_scorer_event_push', rpcArgs)
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

async function getAppNotificationParentLinks(targetParentLinkIds) {
  if (targetParentLinkIds.length === 0) return []

  const { data, error } = await supabaseAdmin
    .from('parent_player_links')
    .select('id, auth_user_id, club_id, team_id')
    .in('id', targetParentLinkIds)
    .eq('status', 'active')

  if (error) throw error

  return filterParentLinksForAppNotifications(supabaseAdmin, data || [])
}

async function getMobileDevices({ targetParentLinks }) {
  if (targetParentLinks.length === 0) {
    return []
  }

  const linksByAuthUser = new Map()
  for (const link of targetParentLinks) {
    const authUserId = normalizeText(link.auth_user_id)
    if (!authUserId) continue
    const links = linksByAuthUser.get(authUserId) || []
    links.push(link)
    linksByAuthUser.set(authUserId, links)
  }

  const authUserIds = [...linksByAuthUser.keys()]
  if (authUserIds.length === 0) return []

  const { data, error } = await supabaseAdmin
    .from('parent_mobile_push_installations')
    .select('installation_id, auth_user_id, expo_push_token, parent_link_id, detail_level')
    .eq('status', 'active')
    .eq('enabled', true)
    .neq('detail_level', 'off')
    .in('auth_user_id', authUserIds)

  if (error) {
    if (isMissingTableError(error)) {
      console.warn('Mobile push devices table is not available; skipping native match day push.')
      return []
    }

    throw error
  }

  return (data ?? []).flatMap((device) => {
    const links = linksByAuthUser.get(normalizeText(device.auth_user_id)) || []
    const targetLink = links.find((link) => link.id === device.parent_link_id) || links[0]
    return targetLink ? [{ ...device, parent_link_id: targetLink.id }] : []
  })
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

export async function handler(event) {
  if (event.httpMethod !== 'POST') {
    return failureResponse(405, 'Method Not Allowed')
  }

  let claimedOperationKey = ''

  try {
    const authUser = await getAuthUser(event)
    const body = JSON.parse(event.body || '{}')
    const matchDayId = normalizeText(body.matchDayId)
    const type = normalizeText(body.type)
    const parentLinkId = normalizeText(body.parentLinkId)
    const eventId = normalizeText(body.eventId)

    if (!matchDayId) {
      return failureResponse(400, 'Match Day is required.')
    }

    const match = await getMatch(matchDayId)
    const profile = await getProfile(authUser, match, parentLinkId)
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

    const coachReview = type === 'full_time' && profile.role === 'parent_portal'
      ? await sendCoachMatchReviewPush({ match })
      : { sent: 0, failed: 0 }
    if (coachReview.failed > 0 && coachReview.sent === 0) {
      throw new Error('The match was saved, but the Coach review notification could not be sent.')
    }

    const delivery = await deliverMatchDayNotification({ match, type, eventId, targetParentLinkIds })
    await completePushOperation({ operationKey, succeeded: true })
    claimedOperationKey = ''

    return jsonResponse(200, {
      success: true,
      ...delivery,
      coachReviewSent: coachReview.sent,
      coachReviewFailed: coachReview.failed,
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

export async function deliverMatchDayNotification({ match, type, eventId = '', targetParentLinkIds, notificationCopy: suppliedCopy, inboxAlreadySaved = false }) {
  const webPushConfigured = configureWebPush()
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

    const appNotificationParentLinks = await getAppNotificationParentLinks(targetParentLinkIds)
    const appNotificationParentLinkIds = appNotificationParentLinks.map((link) => link.id)
    const subscriptions = await getSubscriptions({
      match,
      targetParentLinkIds: appNotificationParentLinkIds,
    })
    const mobileDevices = await getMobileDevices({
      targetParentLinks: appNotificationParentLinks,
    })
    const notificationCopy = suppliedCopy || buildParentMatchDayNotificationCopy({ match, type, event: eventRow })
    const club = Array.isArray(match.clubs) ? match.clubs[0] : match.clubs
    const teamName = resolveMatchDayNotificationTeamName(match)
    const clubName = normalizeText(club?.name)
    const notificationTitle = notificationCopy.matchTitle
    const payload = {
      body: notificationCopy.detailedBody,
      renotify: notificationCopy.renotify,
      tag: notificationCopy.tag,
      title: notificationTitle,
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
      title: notificationTitle,
      detailedBody: notificationCopy.detailedBody,
      minimalBody: notificationCopy.minimalBody,
      type,
      data: {
        app: 'parent',
        clubName,
        eventId,
        route: 'matchday',
        matchDayId: match.id,
        teamId: match.team_id || '',
        teamName,
        type,
      },
    }
    const inboxResult = inboxAlreadySaved ? { available: appNotificationParentLinks.length } : await writeParentNotificationInbox({
      body: nativePayload.minimalBody,
      client: supabaseAdmin,
      clubId: match.club_id,
      data: nativePayload.data,
      intentType: 'matchday_update',
      parentLinks: appNotificationParentLinks,
      teamId: match.team_id,
      title: nativePayload.title,
    })
    const mobileResult = await sendExpoPushMessages(mobileDevices.map((device) => ({
      to: device.expo_push_token,
      collapseId: notificationCopy.tag,
      tag: notificationCopy.tag,
      title: nativePayload.title,
      body: device.detail_level === 'detailed' ? nativePayload.detailedBody : nativePayload.minimalBody,
      data: {
        ...nativePayload.data,
        parentLinkId: device.parent_link_id,
      },
      sound: 'default',
    })))
    await revokeMobileDeviceTokens(mobileResult.invalidTokens || [])
  return { sent, revoked, webFailed: results.filter((result) => !result.sent && !result.revoked).length, mobileSent: mobileResult.sent, mobileFailed: mobileResult.failed, mobileInbox: inboxResult.available }
}

export async function sendGuestMatchDayNotifications({ tokenHash, requestId }) {
  const claimArgs = { token_hash: tokenHash, request_id_value: requestId, completed: false }
  const { data: command, error } = await supabaseAdmin.rpc('claim_guest_match_notification', claimArgs)
  if (error) throw error
  if (!command) return
  if (command.pending) throw new Error('Notification delivery is still being confirmed. Retry shortly.')
  const type = command.action === 'start' ? 'match_started'
    : command.action === 'timer' || command.action === 'extended' ? command.details.action
      : command.action === 'goal' ? 'goal'
        : command.action === 'event' && ['yellow_card', 'red_card', 'substitution'].includes(command.details.eventType) ? command.details.eventType
        : ['score', 'correct_goal', 'remove_goal'].includes(command.action) ? 'score_correction' : ''
  if (type) {
    const match = await getMatch(command.matchId)
    if (type === 'full_time') {
      const result = await sendCoachMatchReviewPush({ match: { ...match, guestScorer: true } })
      if (result.failed > 0) throw new Error('Coach review notification failed.')
    }
    const { data: targets, error: requestError } = await supabaseAdmin.rpc('get_match_day_parent_notification_link_ids', { match_day_id_value: match.id })
    if (requestError) throw requestError
    const targetParentLinkIds = [...new Set((targets || []).filter(Boolean))]
    const result = await deliverMatchDayNotification({ match, type, eventId: command.eventId || '', targetParentLinkIds })
    if (result.mobileFailed > 0) throw new Error('Match notification failed.')
  }
  const complete = await supabaseAdmin.rpc('claim_guest_match_notification', { ...claimArgs, completed: true })
  if (complete.error) throw complete.error
}
