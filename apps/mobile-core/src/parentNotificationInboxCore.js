const normalize = (value) => String(value ?? '').trim()

function parentChatRoomId(notification = {}) {
  const intentType = normalize(notification.intentType).toLowerCase()
  const route = normalize(notification.data?.route).toLowerCase()
  if (intentType !== 'parent_chat' || route !== 'chat') return ''
  return normalize(notification.data?.roomId)
}

export function prepareParentNotificationInbox(notifications = []) {
  const prepared = []
  const chatGroups = new Map()

  for (const notification of Array.isArray(notifications) ? notifications : []) {
    if (!notification || typeof notification !== 'object') continue
    const id = normalize(notification.id)
    if (!id) continue
    const roomId = parentChatRoomId(notification)

    if (!roomId) {
      prepared.push({ ...notification, notificationIds: [id] })
      continue
    }

    const existing = chatGroups.get(roomId)
    if (existing) {
      existing.notificationIds.push(id)
      existing.groupedCount = existing.notificationIds.length
      continue
    }

    const grouped = {
      ...notification,
      groupedCount: 1,
      notificationIds: [id],
    }
    chatGroups.set(roomId, grouped)
    prepared.push(grouped)
  }

  return prepared
}

export function countUnreadNonChatNotifications(notifications = []) {
  return (Array.isArray(notifications) ? notifications : []).filter((notification) => (
    notification && !notification.isRead && !parentChatRoomId(notification)
  )).length
}

