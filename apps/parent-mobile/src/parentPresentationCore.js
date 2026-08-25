import { getDateInTimeZone } from '../../mobile-core/src/parentCalendarCore.js'

function normalizeText(value) {
  return String(value ?? '').trim()
}

export function getParentChatRoomTypeLabel(value) {
  const type = normalizeText(value).toLowerCase()
  if (type === 'parent_staff') return 'Parent coach'
  const text = type.replaceAll('_', ' ')
  return text ? `${text.charAt(0).toUpperCase()}${text.slice(1)}` : ''
}

export function getParentChatRoomTitle(room = {}) {
  const title = normalizeText(room.title) || 'Parent Chat'
  if (normalizeText(room.type).toLowerCase() !== 'parent_staff') return title
  return title.replace(/\bstaff\b/gi, 'Coach')
}

function invitationOccurrenceKey(invitation = {}) {
  return [
    invitation.childId,
    invitation.sourceRecordId || invitation.eventId,
    invitation.invitationType,
    invitation.roleType,
    invitation.eventStart || invitation.eventDate,
  ].map(normalizeText).join(':')
}

function invitationRecency(invitation = {}) {
  return new Date(invitation.lastRespondedAt || invitation.eventStart || invitation.eventDate || 0).getTime() || 0
}

function invitationVersionRank(invitation = {}) {
  if (normalizeText(invitation.lastRespondedAt)) return 2
  return invitation.isPending ? 0 : 1
}

function isInvitationTerminal(invitation = {}) {
  return ['cancelled', 'closed', 'expired'].includes(normalizeText(invitation.invitationState).toLowerCase())
}

function isInvitationActionable(invitation = {}, now = new Date()) {
  const responseDeadline = Date.parse(normalizeText(invitation.responseDeadline))
  return ['active', 'offered'].includes(normalizeText(invitation.invitationState).toLowerCase())
    && (invitation.canRespond === true || invitation.canChangeResponse === true)
    && (!Number.isFinite(responseDeadline) || responseDeadline > now.getTime())
}

export function getParentInvitationSections(rows = [], now = new Date()) {
  const today = getDateInTimeZone(now)
  const unique = new Map()
  for (const invitation of Array.isArray(rows) ? rows : []) {
    const key = invitationOccurrenceKey(invitation)
    const current = unique.get(key)
    if (
      !current
      || invitationVersionRank(invitation) > invitationVersionRank(current)
      || invitationVersionRank(invitation) === invitationVersionRank(current) && invitationRecency(invitation) >= invitationRecency(current)
    ) unique.set(key, invitation)
  }
  const items = [...unique.values()].filter((item) => !normalizeText(item.lockReason).toLowerCase().includes('another parent contact'))
  const isPast = (invitation) => {
    const eventBoundary = Date.parse(normalizeText(invitation.eventEnd || invitation.eventStart))
    if (Number.isFinite(eventBoundary)) return eventBoundary <= now.getTime()
    const eventDate = normalizeText(invitation.eventDate || invitation.eventStart).slice(0, 10)
    return Boolean(eventDate) && eventDate < today
  }
  const futureSort = (left, right) => String(left.eventStart || left.eventDate || '9999-12-31').localeCompare(String(right.eventStart || right.eventDate || '9999-12-31'))
  const historySort = (left, right) => String(right.eventStart || right.eventDate || '').localeCompare(String(left.eventStart || left.eventDate || ''))
  const future = items.filter((item) => !isPast(item) && !isInvitationTerminal(item))
  const needsResponse = future.filter((item) => item.isPending && isInvitationActionable(item, now)).sort(futureSort)
  const responded = future.filter((item) => !item.isPending && normalizeText(item.responseState) !== 'awaiting_response').sort(futureSort)
  const needsResponseIds = new Set(needsResponse.map(invitationOccurrenceKey))
  const respondedIds = new Set(responded.map(invitationOccurrenceKey))
  return {
    history: items.filter((item) => isPast(item) || isInvitationTerminal(item)).sort(historySort),
    needsResponse,
    responded,
    upcoming: future.filter((item) => {
      const key = invitationOccurrenceKey(item)
      return !needsResponseIds.has(key) && !respondedIds.has(key)
    }).sort(futureSort),
  }
}

export function getParentChatRoomContext(room = {}) {
  if (normalizeText(room.type) === 'team') {
    return `${normalizeText(room.teamName) || 'Team'} | Parents and Team Coaches`
  }
  const matchLabel = room.opponent ? `${room.teamName || 'Team'} v ${room.opponent}` : room.teamName || room.clubName || ''
  const dateLabel = room.matchDate
    ? new Intl.DateTimeFormat('en-GB', { day: 'numeric', month: 'short', year: 'numeric' }).format(new Date(`${String(room.matchDate).slice(0, 10)}T12:00:00`))
    : ''
  const timeLabel = room.kickoffTimeTbc ? 'Time TBC' : normalizeText(room.kickoffTime).slice(0, 5)
  return [matchLabel, [dateLabel, timeLabel].filter(Boolean).join(' at ')].filter(Boolean).join(' | ')
}

export function prepareParentChatMessages(rows = []) {
  return (Array.isArray(rows) ? rows : [])
    .map((message) => ({ ...message, body: normalizeText(message.body), senderName: normalizeText(message.senderName) || 'Chat participant' }))
    .sort((left, right) => String(left.createdAt || '').localeCompare(String(right.createdAt || '')))
}

export function getParentAnnouncementMessages(messages = []) {
  return (Array.isArray(messages) ? messages : [])
    .filter((message) => normalizeText(message.body))
    .map((message) => ({
      body: normalizeText(message.body),
      canDelete: false,
      createdAt: message.createdAt || '',
      deletedAt: '',
      id: `announcement:${message.id}`,
      legacyMessageId: message.id,
      roomId: 'club-announcements',
      senderKind: 'club',
      senderName: message.senderName || 'Your club',
      senderRole: 'club',
      updatedAt: message.createdAt || '',
    }))
    .sort((left, right) => String(left.createdAt).localeCompare(String(right.createdAt)))
}

export function prepareParentChatRooms(rooms = [], messages = []) {
  const normalizedRooms = (Array.isArray(rooms) ? rooms : []).map((room) => ({
    ...room,
    latestMessage: normalizeText(room.latestMessage),
    title: getParentChatRoomTitle(room),
    unreadCount: Number(room.unreadCount || 0),
  }))
  const announcements = getParentAnnouncementMessages(messages)
  if (announcements.length) {
    const latest = announcements.at(-1)
    normalizedRooms.push({
      canPost: false,
      childNames: [],
      clubName: latest.senderName,
      fixtureStatus: '',
      id: 'club-announcements',
      kickoffTime: '',
      kickoffTimeTbc: false,
      latestMessage: latest.body,
      latestMessageAt: latest.createdAt,
      matchDate: '',
      matchDayId: '',
      opponent: '',
      playerName: '',
      status: 'active',
      teamName: '',
      title: 'Club Announcements',
      type: 'announcement',
      unreadCount: messages.filter((message) => normalizeText(message.body) && !message.readAt).length,
    })
  }
  return normalizedRooms.sort((left, right) => (
    String(right.latestMessageAt || '').localeCompare(String(left.latestMessageAt || ''))
    || left.title.localeCompare(right.title)
  ))
}
