import { getMatchDayDisplayName } from '../../../src/lib/matchday-display.js'

const normalize = (value) => String(value ?? '').trim()

export function getParentNotificationCategory(notification = {}) {
  const kind = normalize(notification.intentType || notification.intent_type).toLowerCase()
  const data = notification.data || {}
  const route = normalize(data.route).toLowerCase()
  const type = normalize(data.type).toLowerCase()
  if (kind === 'parent_chat' || route === 'chat') return 'chat'
  if (['parent_poll', 'poll_results'].includes(kind) || route === 'polls' || normalize(data.pollId)) return 'polls'
  if (route === 'invites' || type === 'scorer_request' || normalize(data.availabilityRequestId) || normalize(data.trainingRequestPlayerId)) return 'invites'
  return 'general'
}

export function getParentMatchNotificationGroupKey(notification = {}) {
  const data = notification.data || {}
  const matchId = normalize(data.matchDayId)
  const kind = normalize(notification.intentType || notification.intent_type)
  return matchId && (kind === 'matchday_update' || ['matchday', 'invites'].includes(normalize(data.route)))
    ? `${getParentNotificationCategory(notification) === 'invites' ? 'invite' : 'match'}:${normalize(data.parentLinkId)}:${matchId}` : ''
}

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
    if (getParentMatchNotificationGroupKey({ data })) return normalize(candidate.matchDayId) === normalize(data.matchDayId)
      && getParentNotificationCategory(notification) === getParentNotificationCategory({ data })
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

  const ordered = (Array.isArray(notifications) ? [...notifications] : []).sort((a, b) =>
    (Date.parse(b?.sentAt || b?.createdAt) || 0) - (Date.parse(a?.sentAt || a?.createdAt) || 0))
  for (const notification of ordered) {
    if (!notification || typeof notification !== 'object') continue
    const id = normalize(notification.id)
    if (!id) continue
    const roomId = parentChatRoomId(notification)
    const groupKey = roomId ? `chat:${roomId}` : getParentMatchNotificationGroupKey(notification) || invitationGroupKey(notification)
    const sourceIds = notificationIds(notification)

    if (!groupKey) {
      prepared.push({ ...notification, notificationIds: sourceIds })
      continue
    }

    const existing = chatGroups.get(groupKey)
    if (existing) {
      existing.notificationIds = [...new Set([...existing.notificationIds, ...sourceIds])]
      existing.groupedCount = existing.notificationIds.length
      if (!groupKey.startsWith('match:') && !notification.isRead) existing.isRead = false
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
    notification && getParentNotificationCategory(notification) !== 'chat' && notification.isBadgeEligible !== false && !notification.isRead
  )).length
}

export function prepareParentUpdates(notifications = []) {
  return prepareParentNotificationInbox(notifications.filter((notification) => getParentNotificationCategory(notification) === 'general'))
}

export function countUnreadGeneralNotifications(notifications = []) {
  return prepareParentUpdates(notifications).filter((notification) => !notification.isRead && notification.isBadgeEligible !== false).length
}

export function applyParentNotificationAction(notifications = [], ids = [], action = 'read', appliedAt = '') {
  const affected = new Set(ids.map(normalize))
  return notifications.flatMap((notification) => {
    // A newer replacement must not be changed by a response for an older event.
    if (!affected.has(normalize(notification.id)) || (appliedAt && Date.parse(notification.sentAt || notification.createdAt) > Date.parse(appliedAt))) return [notification]
    return action === 'clear' ? [] : [{ ...notification, isRead: true }]
  })
}

