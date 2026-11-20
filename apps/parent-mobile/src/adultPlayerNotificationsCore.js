// Player taps are fenced to the current account and verified active team link.
export function adultPlayerNotificationScope(userId, link) {
  return JSON.stringify([userId || '', link?.id || '', link?.clubId || '', link?.teamId || ''])
}

export function resolveAdultPlayerNotificationOpen(data, link, items = {}) {
  if (!link?.id || data?.app !== 'player' || data.adultLinkId !== link.id
    || data.clubId !== link.clubId || data.teamId !== link.teamId
    || !['chat', 'invites'].includes(data.route)) return null
  const targetId = data.route === 'chat' ? data.roomId : data.invitationId
  const available = data.route === 'chat' ? items.chatRooms : items.invitations
  const allowed = (available || []).some(item => (data.route === 'chat' ? item.id : item.invitationId) === targetId)
  return { tab: data.route, targetId: allowed ? targetId : '' }
}
