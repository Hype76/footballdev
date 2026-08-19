import { supabaseAdmin } from './lib/_supabase.js'

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
    createdAt: row.created_at,
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

  for (const row of Array.isArray(rows) ? rows : []) {
    const notification = mapNotification(row)
    const roomId = parentChatRoomId(notification)
    if (!roomId) {
      notifications.push({ ...notification, notificationIds: [notification.id] })
      continue
    }

    const existing = chatGroups.get(roomId)
    if (existing) {
      existing.notificationIds.push(notification.id)
      if (!notification.isRead) existing.isRead = false
      continue
    }

    const grouped = {
      ...notification,
      notificationIds: [notification.id],
    }
    chatGroups.set(roomId, grouped)
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

  const [validMatches, validTraining, validPolls, validResources, validReports] = await Promise.all([
    loadValidReferenceIds(
      'match_day_availability_requests',
      matchIds,
      'id, parent_link_id, token_revoked_at',
      (row) => normalizeText(row.parent_link_id) === normalizeText(link.id) && !row.token_revoked_at,
    ),
    loadValidReferenceIds(
      'training_availability_request_players',
      trainingIds,
      'id, parent_link_id, recipient_type, status',
      (row) => normalizeText(row.parent_link_id) === normalizeText(link.id)
        && normalizeText(row.recipient_type).toLowerCase() === 'parent'
        && !['cancelled', 'expired'].includes(normalizeText(row.status).toLowerCase()),
    ),
    loadValidReferenceIds('polls', pollIds, 'id', () => true),
    loadValidReferenceIds('resource_library_items', resourceIds, 'id, archived_at', (row) => !row.archived_at),
    loadValidReferenceIds('evaluations', reportIds, 'id, player_id', (row) => normalizeText(row.player_id) === normalizeText(link.player_id)),
  ])

  return notifications.filter((notification) => {
    const intentType = normalizeText(notification.intentType).toLowerCase()
    if (intentType === 'matchday_update') {
      const id = referenceId(notification, 'availabilityRequestId')
      return !id || validMatches.has(id)
    }
    if (intentType === 'training_update') {
      const id = referenceId(notification, 'trainingRequestPlayerId')
      return !id || validTraining.has(id)
    }
    if (intentType === 'parent_poll' || intentType === 'poll_results') {
      const id = referenceId(notification, 'pollId')
      return !id || validPolls.has(id)
    }
    if (intentType === 'resource_shared') {
      const id = referenceId(notification, 'resourceId')
      return !id || validResources.has(id)
    }
    if (normalizeText(notification?.data?.type).toLowerCase() === 'development_report') {
      const id = referenceId(notification, 'reportId')
      return !id || validReports.has(id)
    }
    return true
  })
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
      ].map(normalizeText).filter(Boolean))].slice(0, 50)
      const serverNotificationIds = notificationIds.filter((id) => /^\d+$/.test(id))
      const now = new Date().toISOString()
      let query = supabaseAdmin
        .from('parent_mobile_notification_events')
        .update({ read_at: now })
        .eq('auth_user_id', authUser.id)
        .eq('parent_link_id', link.id)
        .is('read_at', null)

      if (serverNotificationIds.length) query = query.in('id', serverNotificationIds)
      if (notificationIds.length && serverNotificationIds.length === 0) {
        return response(200, { readAt: now, success: true })
      }
      const { error } = await query
      if (error) throw error
      return response(200, { readAt: now, success: true })
    }

    const { data, error } = await supabaseAdmin
      .from('parent_mobile_notification_events')
      .select('id, intent_type, title, body, data, status, sent_at, read_at, created_at')
      .eq('auth_user_id', authUser.id)
      .eq('parent_link_id', link.id)
      .eq('status', 'sent')
      .gte('created_at', link.created_at)
      .order('created_at', { ascending: false })
      .limit(50)

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
      unreadCount: notifications.filter((item) => !item.isRead).length,
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

