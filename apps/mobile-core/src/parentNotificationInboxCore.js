import { getMatchDayDisplayName } from '../../../src/lib/matchday-display.js'

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

function invitationGroupKey(notification = {}) {
  const data = notification.data || {}
  if (normalize(data.route).toLowerCase() !== 'invites' && normalize(data.type) !== 'scorer_request') return ''
  const eventId = normalize(data.matchDayId || data.calendarEventId || data.trainingRequestPlayerId)
  return eventId ? `invite:${normalize(data.parentLinkId)}:${eventId}` : ''
}

export function getParentOpenedNotificationIds(data = {}, notifications = []) {
  const fields = ['availabilityRequestId', 'trainingRequestPlayerId', 'notificationId', 'messageId', 'pollId', 'resourceId', 'reportId', 'roomId', 'eventId']
  const reference = fields.find((field) => normalize(data[field]))
  return notifications.filter((notification) => {
    const candidate = notification.data || {}
    if (normalize(data.parentLinkId) && normalize(candidate.parentLinkId) !== normalize(data.parentLinkId)) return false
    if ((normalize(data.route) === 'invites' || normalize(data.type) === 'scorer_request') && normalize(data.matchDayId)) {
      return (normalize(candidate.route) === 'invites' || normalize(candidate.type) === 'scorer_request') && normalize(candidate.matchDayId) === normalize(data.matchDayId)
    }
    if (reference) return normalize(candidate[reference]) === normalize(data[reference])
    return Boolean(normalize(data.matchDayId)) && normalize(candidate.matchDayId) === normalize(data.matchDayId)
      && normalize(candidate.type) === normalize(data.type)
  }).flatMap(notificationIds)
}

export function getParentNotificationPresentation(notification = {}, matches = []) {
  const data = notification.data || {}
  const isInvitation = normalize(data.route) === 'invites' || normalize(data.type) === 'scorer_request'
  const match = matches.find((item) => normalize(item.id) === normalize(data.matchDayId))
  const title = normalize(notification.title).split(' | ').at(-1) || 'Club update'
  const date = normalize(match?.matchDate).slice(0, 10)
  const dateLabel = /^\d{4}-\d{2}-\d{2}$/.test(date) ? new Intl.DateTimeFormat('en-GB', { day: 'numeric', month: 'short' }).format(new Date(`${date}T12:00:00`)) : ''
  return {
    displayTitle: isInvitation && match ? getMatchDayDisplayName({ ...match, teamName: match.teamName || data.teamName || 'Team' }) : title,
    displayBody: isInvitation && match
      ? [dateLabel, 'Attendance and volunteer requests'].filter(Boolean).join(' | ')
      : normalize(notification.body),
    actionLabel: isInvitation ? 'Open event invitation' : 'Open update',
  }
}

export function prepareParentNotificationInbox(notifications = []) {
  const prepared = []
  const chatGroups = new Map()

  for (const notification of Array.isArray(notifications) ? notifications : []) {
    if (!notification || typeof notification !== 'object') continue
    const id = normalize(notification.id)
    if (!id) continue
    const roomId = parentChatRoomId(notification)
    const groupKey = roomId ? `chat:${roomId}` : invitationGroupKey(notification)
    const sourceIds = notificationIds(notification)

    if (!groupKey) {
      prepared.push({ ...notification, notificationIds: sourceIds })
      continue
    }

    const existing = chatGroups.get(groupKey)
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
    chatGroups.set(groupKey, grouped)
    prepared.push(grouped)
  }

  return prepared
}

export function countUnreadNonChatNotifications(notifications = []) {
  return prepareParentNotificationInbox(notifications).filter((notification) => (
    notification && notification.isBadgeEligible !== false && !notification.isRead && !parentChatRoomId(notification)
  )).length
}

