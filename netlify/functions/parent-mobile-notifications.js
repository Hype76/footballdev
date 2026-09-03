import {
  getDateInTimeZone,
  isCurrentMatchDayNotificationReference,
  isCurrentMatchNotificationReference,
  isCurrentParentPollReference,
  isCurrentTrainingNotificationReference,
} from './lib/_parent-notification-validity.js'
import { supabaseAdmin } from './lib/_supabase.js'
import { getParentMatchNotificationGroupKey } from '../../apps/mobile-core/src/parentNotificationInboxCore.js'
import { updateParentNotificationInbox } from './lib/_parent-notification-actions.js'

function response(statusCode, payload) {
  return {
    statusCode,
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  }
}

function normalizeText(value) {
  return String(value ?? '').trim()
}

function bearerToken(event) {
  const header = event.headers.authorization || event.headers.Authorization || ''
  return header.startsWith('Bearer ') ? header.slice(7) : ''
}

async function getAuthorisedParentLink(event, requestedParentLinkId) {
  const token = bearerToken(event)
  if (!token) throw Object.assign(new Error('Sign in before opening notifications.'), { statusCode: 401 })

  const { data: authData, error: authError } = await supabaseAdmin.auth.getUser(token)
  if (authError || !authData?.user) {
    throw Object.assign(new Error('Sign in before opening notifications.'), { statusCode: 401 })
  }

  const { data: link, error: linkError } = await supabaseAdmin
    .from('parent_player_links')
    .select('id, auth_user_id, club_id, team_id, player_id, status, created_at')
    .eq('id', requestedParentLinkId)
    .eq('auth_user_id', authData.user.id)
    .eq('status', 'active')
    .maybeSingle()

  if (linkError || !link) {
    throw Object.assign(new Error('This notification list is not available for the selected child.'), { statusCode: 403 })
  }

  return { authUser: authData.user, link }
}

function mapNotification(row) {
  return {
    body: normalizeText(row.body),
    createdAt: row.sent_at || row.created_at,
    data: row.data && typeof row.data === 'object' ? row.data : {},
    id: String(row.id),
    intentType: normalizeText(row.intent_type),
    isRead: Boolean(row.read_at),
    readAt: row.read_at,
    sentAt: row.sent_at,
    title: normalizeText(row.title) || 'Football Player update',
  }
}

function parentChatRoomId(notification = {}) {
  const intentType = normalizeText(notification.intentType).toLowerCase()
  const route = normalizeText(notification.data?.route).toLowerCase()
  if (intentType !== 'parent_chat' || route !== 'chat') return ''
  return normalizeText(notification.data?.roomId)
}

export function collapseParentNotificationRows(rows = []) {
  const notifications = []
  const chatGroups = new Map()

  const ordered = (Array.isArray(rows) ? [...rows] : []).sort((a, b) =>
    (Date.parse(b?.sent_at || b?.created_at) || 0) - (Date.parse(a?.sent_at || a?.created_at) || 0))
  for (const row of ordered) {
    const notification = mapNotification(row)
    const roomId = parentChatRoomId(notification)
    const groupKey = roomId ? `chat:${roomId}` : getParentMatchNotificationGroupKey(notification)
    if (!groupKey) {
      notifications.push({ ...notification, notificationIds: [notification.id] })
      continue
    }

    const existing = chatGroups.get(groupKey)
    if (existing) {
      existing.notificationIds.push(notification.id)
      if (!groupKey.startsWith('match:') && !notification.isRead) existing.isRead = false
      continue
    }

    const grouped = {
      ...notification,
      notificationIds: [notification.id],
    }
    chatGroups.set(groupKey, grouped)
    notifications.push(grouped)
  }

  return notifications
}

function referenceId(notification, key) {
  return normalizeText(notification?.data?.[key])
}

function uniqueReferenceIds(notifications, intentType, key) {
  return [...new Set(notifications
    .filter((notification) => normalizeText(notification?.intentType).toLowerCase() === intentType)
    .map((notification) => referenceId(notification, key))
    .filter(Boolean))]
}

async function loadValidReferenceIds(table, ids, select, isValid) {
  if (ids.length === 0) return new Set()
  const { data, error } = await supabaseAdmin.from(table).select(select).in('id', ids)
  if (error) throw error
  return new Set((data || []).filter(isValid).map((row) => normalizeText(row.id)).filter(Boolean))
}

async function filterUnavailableNotifications(notifications, link) {
  const matchIds = uniqueReferenceIds(notifications, 'matchday_update', 'availabilityRequestId')
  const matchDayIds = uniqueReferenceIds(notifications, 'matchday_update', 'matchDayId')
  const trainingIds = uniqueReferenceIds(notifications, 'training_update', 'trainingRequestPlayerId')
  const pollIds = [...new Set([
    ...uniqueReferenceIds(notifications, 'parent_poll', 'pollId'),
    ...uniqueReferenceIds(notifications, 'poll_results', 'pollId'),
  ])]
  const resourceIds = uniqueReferenceIds(notifications, 'resource_shared', 'resourceId')
  const reportIds = notifications
    .filter((notification) => normalizeText(notification?.data?.type).toLowerCase() === 'development_report')
    .map((notification) => referenceId(notification, 'reportId'))
    .filter(Boolean)

  const now = Date.now()
  const today = getDateInTimeZone(new Date(now))
  const [validMatches, validMatchDays, validTraining, validPollActions, existingPolls, validResources, validReports] = await Promise.all([
    loadValidReferenceIds(
      'match_day_availability_requests',
      matchIds,
      'id, parent_link_id, status, expires_at, token_revoked_at, match_days:match_day_id(status, match_date, deleted_at)',
      (row) => isCurrentMatchNotificationReference(row, link.id, now, today),
    ),
    loadValidReferenceIds(
      'match_days',
      matchDayIds,
      'id, status, match_date, concluded_at, deleted_at',
      (row) => isCurrentMatchDayNotificationReference(row, today),
    ),
    loadValidReferenceIds(
      'training_availability_request_players',
      trainingIds,
      'id, parent_link_id, recipient_type, status, response_deadline_at, token_revoked_at, training_availability_requests:request_id(status, occurrence_starts_at)',
      (row) => isCurrentTrainingNotificationReference(row, link.id, now),
    ),
    loadValidReferenceIds('polls', pollIds, 'id, status, closes_at', (row) => isCurrentParentPollReference(row, now)),
    loadValidReferenceIds('polls', pollIds, 'id', () => true),
    loadValidReferenceIds('resource_library_items', resourceIds, 'id, archived_at', (row) => !row.archived_at),
    loadValidReferenceIds('evaluations', reportIds, 'id, player_id', (row) => normalizeText(row.player_id) === normalizeText(link.player_id)),
  ])

  return notifications.map((notification) => {
    const intentType = normalizeText(notification.intentType).toLowerCase()
    if (intentType === 'matchday_update') {
      const requestId = referenceId(notification, 'availabilityRequestId')
      const matchDayId = referenceId(notification, 'matchDayId')
      if (requestId && !validMatches.has(requestId)) return null
      return { ...notification, isBadgeEligible: !matchDayId || validMatchDays.has(matchDayId) }
    }
    if (intentType === 'training_update') {
      const id = referenceId(notification, 'trainingRequestPlayerId')
      return !id || validTraining.has(id) ? notification : null
    }
    if (intentType === 'parent_poll') {
      const id = referenceId(notification, 'pollId')
      return !id || validPollActions.has(id) ? notification : null
    }
    if (intentType === 'poll_results') {
      const id = referenceId(notification, 'pollId')
      return !id || existingPolls.has(id) ? { ...notification, isBadgeEligible: false } : null
    }
    if (intentType === 'resource_shared') {
      const id = referenceId(notification, 'resourceId')
      return !id || validResources.has(id) ? notification : null
    }
    if (normalizeText(notification?.data?.type).toLowerCase() === 'development_report') {
      const id = referenceId(notification, 'reportId')
      return !id || validReports.has(id) ? notification : null
    }
    return notification
  }).filter(Boolean)
}

export async function handler(event) {
  if (!['GET', 'POST'].includes(event.httpMethod)) {
    return response(405, { success: false, message: 'Method Not Allowed' })
  }

  try {
    const body = event.httpMethod === 'POST' ? JSON.parse(event.body || '{}') : {}
    const parentLinkId = normalizeText(body.parentLinkId || event.queryStringParameters?.parentLinkId)
    if (!parentLinkId) return response(400, { success: false, message: 'Choose a child before opening notifications.' })

    const { authUser, link } = await getAuthorisedParentLink(event, parentLinkId)

    if (event.httpMethod === 'POST') {
      const notificationIds = [...new Set([
        ...(Array.isArray(body.notificationIds) ? body.notificationIds : []),
        body.notificationId,
      ].map(normalizeText).filter(Boolean))].slice(0, 500)
      return response(200, await updateParentNotificationInbox({ admin: supabaseAdmin, authUser, link, action: body.action || 'read', notificationIds }))
    }

    const { data, error } = await supabaseAdmin
      .from('parent_mobile_notification_events')
      .select('id, intent_type, title, body, data, status, sent_at, read_at, created_at')
      .eq('auth_user_id', authUser.id)
      .eq('parent_link_id', link.id)
      .eq('status', 'sent')
      .is('dismissed_at', null)
      .gte('created_at', link.created_at)
      .order('sent_at', { ascending: false })
      .limit(500)

    if (error) throw error

    const collapsedNotifications = collapseParentNotificationRows(data || [])
    const notifications = await filterUnavailableNotifications(collapsedNotifications, link)
    const availableIds = new Set(notifications.flatMap((notification) => notification.notificationIds || [notification.id]))
    const unavailableIds = collapsedNotifications
      .flatMap((notification) => notification.notificationIds || [notification.id])
      .map(normalizeText)
      .filter((id) => /^\d+$/.test(id) && !availableIds.has(id))

    if (unavailableIds.length > 0) {
      const { error: dismissError } = await supabaseAdmin
        .from('parent_mobile_notification_events')
        .update({ read_at: new Date().toISOString() })
        .eq('auth_user_id', authUser.id)
        .eq('parent_link_id', link.id)
        .in('id', unavailableIds)
      if (dismissError) throw dismissError
    }

    return response(200, {
      notifications,
      success: true,
      unreadCount: notifications.filter((item) => !item.isRead && item.isBadgeEligible !== false).length,
    })
  } catch (error) {
    console.error('Parent notification inbox failed', {
      code: String(error?.code || error?.name || 'unknown').slice(0, 100),
    })
    return response(error.statusCode || 500, {
      success: false,
      message: error.message || 'Notifications could not be loaded.',
    })
  }
}

