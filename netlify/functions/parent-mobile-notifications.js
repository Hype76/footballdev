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
    .select('id, auth_user_id, club_id, team_id, player_id, status')
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
      .order('created_at', { ascending: false })
      .limit(50)

    if (error) throw error

    const notifications = (data || []).map(mapNotification)
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

