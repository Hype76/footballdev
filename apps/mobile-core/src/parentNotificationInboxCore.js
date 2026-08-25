const normalize = (value) => String(value ?? '').trim()

function parentChatRoomId(notification = {}) {
  const intentType = normalize(notification.intentType).toLowerCase()
  const route = normalize(notification.data?.route).toLowerCase()
  if (intentType !== 'parent_chat' || route !== 'chat') return ''
  return normalize(notification.data?.roomId)
}

function notificationIds(notification = {}) {
  return [...new Set([
    ...(Array.isArray(notification.notificationIds) ? notification.notificationIds : []),
    notification.id,
  ].map(normalize).filter(Boolean))]
}

export function prepareParentNotificationInbox(notifications = []) {
  const prepared = []
  const chatGroups = new Map()

  for (const notification of Array.isArray(notifications) ? notifications : []) {
    if (!notification || typeof notification !== 'object') continue
    const id = normalize(notification.id)
    if (!id) continue
    const roomId = parentChatRoomId(notification)
    const sourceIds = notificationIds(notification)

    if (!roomId) {
      prepared.push({ ...notification, notificationIds: sourceIds })
      continue
    }

    const existing = chatGroups.get(roomId)
    if (existing) {
      existing.notificationIds = [...new Set([...existing.notificationIds, ...sourceIds])]
      existing.groupedCount = existing.notificationIds.length
      if (!notification.isRead) existing.isRead = false
      continue
    }

    const grouped = {
      ...notification,
      groupedCount: sourceIds.length,
      notificationIds: sourceIds,
    }
    chatGroups.set(roomId, grouped)
    prepared.push(grouped)
  }

  return prepared
}

export function countUnreadNonChatNotifications(notifications = []) {
  return (Array.isArray(notifications) ? notifications : []).filter((notification) => (
    notification && notification.isBadgeEligible !== false && !notification.isRead && !parentChatRoomId(notification)
  )).length
}

